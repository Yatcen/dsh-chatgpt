import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';
import { model, mountFixture, provider } from './fixtures/dsh-contract.mjs';

function startFixture(t) {
  const adapters = new Map();
  const providers = new Map();
  t.after(mountFixture({
    llm: {
      registerAdapter(routes, adapter) {
        assert.deepEqual(routes, [provider]);
        adapters.set(provider, adapter);
        return () => adapters.delete(provider);
      },
    },
    subagents: {
      registerProvider(backend) {
        providers.set(backend.name, backend);
        return () => providers.delete(backend.name);
      },
    },
  }));
  return { adapter: adapters.get(provider), backend: providers.get(provider) };
}

const textBlock = text => ({ type: 'text', text });
const userMessage = text => ({ role: 'user', content: [textBlock(text)] });

test('discovers a fixture model and emits one terminal chunk', async t => {
  const { adapter } = startFixture(t);
  const [entry] = await adapter.listModels(provider);
  assert.equal(entry.id, model);
  const call = await adapter.prepareCall(entry.provider, entry.id);
  const chunks = await Array.fromAsync(call.stream({
    provider, model, messages: [userMessage('main conversation')],
  }));
  assert.deepEqual(chunks, [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text: 'main conversation' },
    { type: 'block-end', index: 0, block: textBlock('main conversation') },
    { type: 'finish', reason: { kind: 'stop' } },
  ]);
});

test('cancels the model stream before reporting a successful finish', async t => {
  const { adapter } = startFixture(t);
  const controller = new AbortController();
  const stream = adapter.stream({
    provider, model, messages: [userMessage('cancel')], signal: controller.signal,
  });
  assert.equal((await stream.next()).value.type, 'block-start');
  controller.abort();
  const remaining = await Array.fromAsync(stream);
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].type, 'finish');
  assert.equal(remaining[0].reason.kind, 'aborted');
});

test('concurrent external subagents keep distinct identities and return their own outputs', async t => {
  const { backend } = startFixture(t);
  const signal = new AbortController().signal;
  const alphaDir = resolve('alpha');
  const betaDir = resolve('beta');
  const [alpha, beta] = await Promise.all([
    backend.start({ cwd: alphaDir, prompt: [textBlock('alpha task')], signal }),
    backend.start({ cwd: betaDir, prompt: [textBlock('beta task')], signal }),
  ]);
  assert.equal(backend.inheritsParentContext, false);
  assert.notEqual(alpha.id, beta.id);
  assert.deepEqual(await Promise.all([alpha.result, beta.result]), [
    { output: [textBlock(`${alphaDir}: alpha task`)], stopReason: 'completed' },
    { output: [textBlock(`${betaDir}: beta task`)], stopReason: 'completed' },
  ]);
  await Promise.all([alpha.dispose(), beta.dispose()]);
});

test('disposing a child is idempotent and leaves the other run independent', async t => {
  const { backend } = startFixture(t);
  const signal = new AbortController().signal;
  const [first, second] = await Promise.all([
    backend.start({ cwd: resolve('alpha'), prompt: [textBlock('cancelled')], signal }),
    backend.start({ cwd: resolve('beta'), prompt: [textBlock('active')], signal }),
  ]);
  await Promise.all([first.dispose(), first.dispose()]);
  assert.deepEqual(await first.result, { output: [], stopReason: 'aborted' });
  assert.equal((await second.result).stopReason, 'completed');
  await second.dispose();
});
