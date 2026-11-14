import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { createInterface } from 'node:readline';
import { APP_NAME } from './auth.js';
import { RESOURCE } from './vendor/chatgpt/auth/protocol.js';
import manifest from '../package.json' with { type: 'json' };

const provider = 'openai_chatgpt_plan';
const maxReplyBytes = 4 * 1024 * 1024;

function codexArgs() {
  const key = `model_providers.${provider}`;
  const settings = [
    `model_provider="${provider}"`,
    `${key}.name="ChatGPT plan"`,
    `${key}.base_url="${RESOURCE}"`,
    `${key}.env_key="ACCESS_TOKEN"`,
    `${key}.wire_api="responses"`,
    `${key}.requires_openai_auth=false`,
    `${key}.supports_websockets=false`,
    'web_search="disabled"',
    'shell_environment_policy.inherit="none"',
    'shell_environment_policy.exclude=["*TOKEN*", "*KEY*", "*SECRET*", "*PASSWORD*", "*CREDENTIAL*"]',
    'features.apps=false',
    'features.plugins=false',
    'features.skill_mcp_dependency_install=false',
  ];
  return ['app-server', '--listen', 'stdio://', ...settings.flatMap(value => ['-c', value])];
}

function rpc(handle, signal, onEvent) {
  const input = handle.stdin;
  const output = handle.stdout;
  if (!input || !output) throw new Error('Codex app-server did not expose its stdio pipes.');
  const reader = createInterface({ input: output, crlfDelay: Infinity });
  const pending = new Map();
  let nextId = 1;
  let failure;

  function close(error) {
    if (failure) return;
    failure = error;
    reader.close();
    for (const { reject } of pending.values()) reject(error);
    pending.clear();
    onEvent(undefined, error);
  }

  function send(message) {
    if (failure) throw failure;
    input.write(`${JSON.stringify(message)}\n`, error => {
      if (error) close(new Error('Could not write to Codex app-server.'));
    });
  }

  function abort() {
    close(signal.reason);
  }

  signal.addEventListener('abort', abort, { once: true });
  input.on('error', () => close(new Error('Codex app-server stdin closed.')));
  reader.on('error', () => close(new Error('Codex app-server stdout failed.')));
  void handle.done.then(
    () => close(new Error('Codex app-server exited before completing the turn.')),
    () => close(new Error('Codex app-server could not start. Check the configured codex.exe path.')),
  );
  reader.on('line', line => {
    try {
      if (Buffer.byteLength(line) > maxReplyBytes) throw new Error();
      const message = JSON.parse(line);
      if (message.method && message.id !== undefined) {
        send({ id: message.id, error: { code: -32601, message: 'This read-only subagent does not accept approval requests.' } });
      } else if (message.method) {
        onEvent(message);
      } else {
        const request = pending.get(message.id);
        if (!request) return;
        pending.delete(message.id);
        if (message.error) request.reject(new Error(`Codex app-server rejected ${request.method}.`));
        else request.resolve(message.result);
      }
    } catch {
      close(new Error('Invalid message from Codex app-server.'));
    }
  });

  return {
    request(method, params) {
      if (failure) return Promise.reject(failure);
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { method, resolve, reject });
        send({ id, method, params });
      });
    },
    notify(method) { send({ method }); },
    close() {
      signal.removeEventListener('abort', abort);
      close(new Error('Codex app-server connection closed.'));
    },
  };
}

export function createCodexProvider({ subprocess, auth, listModels, executable, model, stateDir }) {
  const activeRuns = new Set();
  const shutdown = new AbortController();
  const providerImpl = {
    name: APP_NAME,
    capabilities: { agentOptions: false, agentPreset: false, outputSchema: false, depthLimit: false },
    inheritsParentContext: false,
    async start({ cwd, prompt, signal: parentSignal }) {
      if (!prompt.length || prompt.some(block => block.type !== 'text')) {
        throw new Error('The ChatGPT Codex subagent accepts a text task.');
      }
      const controller = new AbortController();
      const lifetime = AbortSignal.any([parentSignal, shutdown.signal, controller.signal, AbortSignal.timeout(15 * 60_000)]);
      lifetime.throwIfAborted();
      const client = executable();
      if (!isAbsolute(client ?? '') || !/\.exe$/i.test(client)) {
        throw new Error('Set the full path to the official Codex codex.exe in the dsh-chatgpt plugin settings.');
      }

      const account = await auth.usable(lifetime);
      const models = await listModels();
      const selected = model() || models[0]?.id;
      if (!models.some(entry => entry.id === selected)) {
        throw new Error('Select a Codex model from the connected ChatGPT model catalog.');
      }
      const grant = await auth.usable(lifetime);
      if (account.replayNamespace !== grant.replayNamespace) {
        throw new Error('The selected ChatGPT account changed. Start the subagent again.');
      }
      lifetime.throwIfAborted();
      const root = join(stateDir, 'codex-runs');
      await mkdir(root, { recursive: true, mode: 0o700 });
      const home = await mkdtemp(join(root, 'run-'));
      let handle;
      let peer;
      let disposing;
      function dispose() {
        disposing ??= (async () => {
          controller.abort();
          peer?.close();
          try {
            handle?.terminate();
            if (handle && !await handle.waitForExit(AbortSignal.timeout(10_000))) {
              throw new Error('The Codex process did not exit after cancellation.');
            }
          } finally {
            await rm(home, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
          }
        })().finally(() => activeRuns.delete(dispose));
        return disposing;
      }
      activeRuns.add(dispose);
      try {
        lifetime.throwIfAborted();
        handle = subprocess.spawn({
          argv: [client, ...codexArgs()], cwd,
          env: { CODEX_HOME: home, ACCESS_TOKEN: grant.accessToken },
          stdio: { stdin: 'pipe', stdout: 'pipe', stderr: 'ignore' },
          graceMs: 2_000, signal: lifetime,
        });
        const turn = Promise.withResolvers();
        void turn.promise.catch(() => {});
        let threadId;
        let activeTurnId;
        let streamed = '';
        let lastMessage = '';
        let collectedBytes = 0;
        let earlyCompletion;
        const startupTimer = setTimeout(() => controller.abort(new Error('Codex app-server startup timed out.')), 45_000);
        startupTimer.unref();
        peer = rpc(handle, lifetime, (message, error) => {
          if (error) return turn.reject(error);
          const { method, params } = message;
          if (!threadId || params?.threadId !== threadId ||
              (activeTurnId && params.turnId && params.turnId !== activeTurnId)) return;
          if (method === 'item/agentMessage/delta' && typeof params.delta === 'string') {
            collectedBytes += Buffer.byteLength(params.delta);
            if (collectedBytes > maxReplyBytes) return controller.abort(new Error('The Codex response exceeded the local limit.'));
            streamed += params.delta;
          }
          if (method === 'item/completed' && params.item?.type === 'agentMessage' && typeof params.item.text === 'string') {
            lastMessage = params.item.text;
            streamed = '';
          }
          if (method === 'turn/completed') {
            if (activeTurnId) {
              if (params.turn?.id === activeTurnId) turn.resolve(params.turn.status);
            } else {
              earlyCompletion = params.turn;
            }
          }
        });
        let started;
        try {
          await peer.request('initialize', { clientInfo: { name: APP_NAME, title: APP_NAME, version: manifest.version } });
          peer.notify('initialized');
          const thread = await peer.request('thread/start', {
            model: selected, modelProvider: provider, cwd, ephemeral: true, approvalPolicy: 'never',
            sandbox: 'read-only',
          });
          threadId = thread?.thread?.id;
          if (typeof threadId !== 'string' || !threadId) throw new Error('Codex did not return a new thread ID.');
          started = await peer.request('turn/start', {
            threadId, input: [{ type: 'text', text: prompt.map(block => block.text).join('\n'), text_elements: [] }],
          });
        } finally {
          clearTimeout(startupTimer);
        }
        activeTurnId = started?.turn?.id;
        if (typeof activeTurnId !== 'string' || !activeTurnId) throw new Error('Codex did not return a turn ID.');
        if (earlyCompletion?.id === activeTurnId) turn.resolve(earlyCompletion.status);
        const result = turn.promise.then(status => {
          const text = lastMessage || streamed;
          const output = text ? [{ type: 'text', text }] : [];
          if (status === 'completed' && output.length) return { output, stopReason: 'completed' };
          if (status === 'interrupted') return { output, stopReason: 'aborted' };
          return { output, stopReason: 'error',
            diagnostic: status === 'completed' ? 'Codex completed without an answer.'
              : 'Codex could not complete the turn. Check the selected model and ChatGPT plan access.' };
        }, () => lifetime.aborted
          ? { output: [], stopReason: 'aborted' }
          : { output: [], stopReason: 'error', diagnostic: 'Codex app-server connection ended.' });
        return { id: randomUUID(), result, dispose };
      } catch (error) {
        await dispose();
        if (parentSignal.aborted) throw parentSignal.reason;
        throw error;
      }
    },
  };
  return {
    provider: providerImpl,
    async close() {
      shutdown.abort();
      const results = await Promise.allSettled([...activeRuns].map(dispose => dispose()));
      if (results.some(result => result.status === 'rejected')) throw new Error('Could not clean up all Codex subagent processes.');
    },
  };
}
