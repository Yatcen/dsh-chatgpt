import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

export const provider = 'dsh-chatgpt-fixture';
export const model = 'fixture-text';

export function mountFixture(ctx) {
  const providerInfo = { id: provider, name: 'ChatGPT fixture' };
  const modelInfo = { provider, id: model, name: 'Fixture text model' };
  const removeAdapter = ctx.llm.registerAdapter([provider], {
    providerInfo: () => ({ ...providerInfo }),
    listModels: async () => [{ ...modelInfo }],
    resolveModel: async (_provider, id, signal) => {
      signal?.throwIfAborted();
      if (id !== model) throw new Error('Unknown fixture model');
      return { ...modelInfo, inputModalities: ['text'] };
    },
    async prepareCall(route, id, signal) {
      return {
        model: await this.resolveModel(route, id, signal),
        stream: options => this.stream(options),
      };
    },
    async *stream({ messages, signal }) {
      const latestUserMessage = messages.findLast(message => message.role === 'user');
      const text = latestUserMessage?.content.map(block => block.text).join('') ?? '';
      try {
        signal?.throwIfAborted();
        yield { type: 'block-start', index: 0, blockType: 'text' };
        signal?.throwIfAborted();
        yield { type: 'text-delta', index: 0, text };
        yield { type: 'block-end', index: 0, block: { type: 'text', text } };
        yield { type: 'finish', reason: { kind: 'stop' } };
      } catch (error) {
        if (!signal?.aborted) throw error;
        yield {
          type: 'finish',
          reason: { kind: 'aborted', failure: { code: 'ABORTED', message: 'Fixture request cancelled' } },
        };
      }
    },
  });

  let removeProvider;
  try {
    removeProvider = ctx.subagents.registerProvider({
      name: provider,
      capabilities: { agentOptions: false, agentPreset: false, outputSchema: false, depthLimit: false },
      inheritsParentContext: false,
      async start({ cwd, prompt, signal }) {
        signal.throwIfAborted();
        const id = randomUUID();
        const controller = new AbortController();
        const runSignal = AbortSignal.any([signal, controller.signal]);
        const text = prompt.map(block => block.text).join('');
        const result = delay(0, undefined, { signal: runSignal }).then(
          () => ({ output: [{ type: 'text', text: `${cwd}: ${text}` }], stopReason: 'completed' }),
          error => {
            if (!runSignal.aborted) throw error;
            return { output: [], stopReason: 'aborted' };
          },
        );

        return {
          id,
          result,
          async dispose() {
            controller.abort();
            await result;
          },
        };
      },
    });
  } catch (error) {
    removeAdapter();
    throw error;
  }
  return () => {
    removeProvider();
    removeAdapter();
  };
}
