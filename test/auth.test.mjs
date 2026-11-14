import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ChatGptAuth } from '../src/auth.js';
import { openStore } from '../src/store.js';

const issuer = 'https://auth.openai.com';
const clientId = 'oaiapp_fixture';
const plan = 'chatgpt.tokens.use.direct';
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');

function jwt(params, wrongNonce) {
  const now = Math.floor(Date.now() / 1000);
  const content = encode({ alg: 'RS256', kid: 'test' }) + '.' + encode({
    iss: issuer, aud: clientId, iat: now, exp: now + 300, sub: 'fixture',
    nonce: wrongNonce ? 'wrong-nonce' : params.get('nonce'),
  });
  return content + '.' + sign('sha256', Buffer.from(content), privateKey).toString('base64url');
}

async function signInFixture(t, { wrongNonce, scope = plan } = {}) {
  let document;
  let params;
  let exchanges = 0;
  const account = await ChatGptAuth.create({
    read: async () => document,
    write: async value => { document = structuredClone(value); },
    close: async () => {},
  }, { fetcher: async (url, options) => {
    switch (new URL(url).pathname) {
      case '/.well-known/openid-configuration':
        return Response.json({ issuer, jwks_uri: `${issuer}/jwks` });
      case '/jwks':
        return Response.json({ keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'test', alg: 'RS256' }] });
      default:
        exchanges++;
        assert.equal(options.body.get('client_id'), clientId);
        assert.equal(params.get('code_challenge'), createHash('sha256').update(options.body.get('code_verifier')).digest('base64url'));
        return Response.json({
          scope, id_token: jwt(params, wrongNonce), expires_in: 3600,
          access_token: 'fixture-access',
          ...(scope.includes(plan) ? { refresh_token: 'fixture-refresh' } : {}),
        });
    }
  } });
  t.after(() => account.close());
  params = new URL((await account.begin()).pending).searchParams;
  assert.match(document.hostId, /^urn:uuid:/);
  const callback = new URL(params.get('redirect_uri'));
  assert.ok(Number(callback.port) >= 49152, 'The callback uses a browser-compatible dynamic port');
  callback.search = new URLSearchParams({ state: params.get('state'), client_id: clientId, code: 'test' });
  return { account, callback, exchanges: () => exchanges };
}

test('OAuth rejects a mismatched state before exchanging and accepts the matching PKCE callback', async t => {
  const { account, callback, exchanges } = await signInFixture(t);
  const wrong = new URL(callback);
  wrong.searchParams.set('state', 'unexpected');
  assert.equal((await fetch(wrong)).status, 400);
  assert.equal(exchanges(), 0);
  assert.equal((await fetch(callback)).status, 200);
  assert.equal((await account.usable()).accessToken, 'fixture-access');
  assert.ok(!JSON.stringify(account.status()).includes('fixture-access'));
});

test('OAuth refuses a signed identity with a mismatched nonce', async t => {
  const { account, callback } = await signInFixture(t, { wrongNonce: true });
  assert.equal((await fetch(callback)).status, 400);
  assert.match(account.status().error, /could not be verified/);
  await assert.rejects(account.usable(), /Connect a ChatGPT account/);
});

test('identity-only consent never enables plan inference', async t => {
  const { account, callback } = await signInFixture(t, { scope: 'openid profile' });
  assert.equal((await fetch(callback)).status, 200);
  assert.equal(account.status().accounts[0].authorized, false);
  await assert.rejects(account.usable(), /Connect a ChatGPT account/);
  const retry = new URL((await account.begin(clientId)).pending);
  assert.equal(retry.searchParams.get('prompt'), 'consent');
});

test('concurrent renewals rotate a refresh token once despite caller cancellation', async t => {
  let calls = 0;
  let snapshot;
  const finish = Promise.withResolvers();
  const account = await ChatGptAuth.create({
    read: async () => ({ version: 1, hostId: 'urn:uuid:fixture', active: clientId, accounts: [{
      clientId, replayNamespace: 'fixture', accessToken: 'old', refreshToken: 'refresh-old',
      scopes: [plan], refreshAt: 0,
    }] }),
    write: async value => { snapshot = value; },
    close: async () => {},
  }, { fetcher: async (_url, options) => {
    assert.equal(options.body.get('refresh_token'), 'refresh-old');
    calls++;
    await finish.promise;
    return Response.json({ access_token: 'new', refresh_token: 'refresh-new', expires_in: 3600 });
  } });
  t.after(() => account.close());
  const abort = new AbortController();
  const cancelled = account.usable(abort.signal);
  const active = account.usable();
  abort.abort();
  finish.resolve();
  await assert.rejects(cancelled, { name: 'AbortError' });
  assert.equal((await active).accessToken, 'new');
  assert.equal(snapshot.accounts[0].refreshToken, 'refresh-new');
  assert.equal(calls, 1);
});

test('Windows credential file is DPAPI protected and can be reloaded', { skip: process.platform !== 'win32' }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-chatgpt-test-'));
  let store;
  try {
    store = await openStore(dir);
    await store.write({ accessToken: 'fixture-do-not-store-in-plaintext' });
    assert.equal((await readFile(join(dir, 'accounts.dpapi'))).includes('fixture-do-not-store-in-plaintext'), false);
    await store.close();
    store = await openStore(dir);
    assert.equal((await store.read()).accessToken, 'fixture-do-not-store-in-plaintext');
  } finally {
    await store?.close();
    await rm(dir, { recursive: true, force: true });
  }
});
