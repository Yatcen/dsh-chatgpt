import { join } from 'node:path';
import z from '@deepseek-ai/schemastery';
import { attributionHeaders, LlmAdapter, LlmError } from '@deepseek-ai/dsh-llm';
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { APP_NAME, ChatGptAuth } from './auth.js';
import { createCodexProvider } from './codex.js';
import { openStore } from './store.js';
import { createTransport } from './transport.js';
import { ChatGptAdapter, isCodedError } from './vendor/chatgpt/adapter.js';
import { requestOf } from './vendor/chatgpt/convert/harness.js';

export const name = APP_NAME;
export const inject = ['llm', 'subagents', 'subprocess', 'profileContext'];
export const Config = z.object({
  codexExecutable: z.string().description('Absolute path to the official Codex codex.exe.').volatile(),
  codexModel: z.string().description('ChatGPT model slug for Codex tasks. Leave blank to use the first available model.').volatile(),
  proxyUrl: z.string().description('HTTP proxy for ChatGPT requests and Codex, e.g. http://127.0.0.1:7897. Empty uses the Harness network settings.').volatile(),
});

const displayName = 'ChatGPT';

function modelsError(error) {
  if (isCodedError(error)) {
    return new LlmError(error.message, error.code, { status: error.status, requestId: error.requestId });
  }
  return new LlmError('The ChatGPT request could not be completed.', 'chatgpt_request_failed');
}

class Adapter extends LlmAdapter {
  constructor(inner) {
    super();
    this.inner = inner;
  }

  providerInfo(provider) { return { id: provider, name: displayName }; }

  async listModels(provider) {
    try {
      return (await this.inner.listModels()).map(({ id, name }) => ({ provider, id, name, inputModalities: ['text'] }));
    } catch (error) {
      throw modelsError(error);
    }
  }

  async resolveModel(provider, model, signal) {
    signal?.throwIfAborted();
    const resolved = await this.inner.resolveModel(provider, model);
    signal?.throwIfAborted();
    return { ...resolved, inputModalities: ['text'] };
  }

  async *stream(options) {
    try {
      yield* this.inner.stream(options.provider, requestOf(options));
    } catch (error) {
      options.signal?.throwIfAborted();
      throw modelsError(error);
    }
  }
}

class Controller extends TypertRemoteService {
  constructor(ctx, auth) {
    super(ctx, 'dshChatgptAccount', { namespace: 'dshChatgpt' });
    this.auth = auth;
    for (const method of ['status', 'begin', 'cancel', 'activate', 'signOut']) {
      Remote(this[method], {
        name: method, private: false, static: false, addInitializer: initialize => initialize.call(this),
      });
    }
  }

  owner() {
    if (this.ctx.invocation?.peer.principal?.kind !== 'owner') throw new Error('Only the Harness owner can manage ChatGPT accounts.');
  }

  status() { this.owner(); return this.auth.status(); }
  begin(clientId) { this.owner(); return this.auth.begin(clientId ?? undefined); }
  cancel() { this.owner(); return this.auth.cancel(); }
  activate(clientId) { this.owner(); return this.auth.activate(clientId); }
  signOut(clientId) { this.owner(); return this.auth.signOut(clientId); }
}

export async function apply(ctx, config) {
  const stateDir = join(ctx.profileContext.home, 'dsh-chatgpt');
  const store = await openStore(stateDir);
  const transport = createTransport(() => config.proxyUrl.get());
  let auth;
  let codex;
  const dispose = async () => {
    try {
      await codex?.close();
    } finally {
      try {
        await transport.close();
      } finally {
        if (auth) await auth.close();
        else await store.close();
      }
    }
  };
  let inner;
  try {
    auth = await ChatGptAuth.create(store, {
      fetcher: transport.fetch,
      onChange() {
        inner.forgetListing();
        ctx.emit('llm/models-updated', APP_NAME);
      },
    });
    inner = new ChatGptAdapter({
      auth, displayName, includeUnlisted: false,
      async fetch(url, options = {}) {
        const headers = new Headers(options.headers);
        for (const [key, val] of Object.entries(attributionHeaders())) headers.set(key, val);
        return transport.fetch(url, { ...options, headers,
          signal: options.signal ?? AbortSignal.timeout(45_000) });
      },
      onListingRecovered: () => ctx.emit('llm/models-updated', APP_NAME),
    });
    const adapter = new Adapter(inner);
    const removeAdapter = ctx.llm.registerAdapter([APP_NAME], adapter);
    ctx.effect(() => removeAdapter);
    const removeDirectory = ctx.llm.registerConfigurableProviders([{
      provider: APP_NAME, displayName, settingsNs: APP_NAME, settingsPath: [],
    }]);
    ctx.effect(() => removeDirectory);
    codex = createCodexProvider({
      subprocess: ctx.subprocess, auth, listModels: () => adapter.listModels(APP_NAME), stateDir,
      executable: () => config.codexExecutable.get() || process.env.DSH_CHATGPT_CODEX_EXECUTABLE,
      model: () => config.codexModel.get(),
      proxyEnvironment: transport.codexEnvironment,
    });
    const removeProvider = ctx.subagents.registerProvider(codex.provider);
    ctx.effect(() => removeProvider);
    new Controller(ctx, auth);
    ctx.effect(() => dispose);
  } catch (error) {
    await dispose();
    throw error;
  }
}
