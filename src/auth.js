import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { createLocalJWKSet, jwtVerify } from 'jose';
import { RefreshRefusedError } from './vendor/chatgpt/auth/refresh.js';
import {
  AUTHORIZE_URL, TOKEN_URL, RESOURCE, SCOPE, DIRECT_TOKEN_SCOPE,
  DYNAMIC_CLIENT_ID, CALLBACK_HOST, CALLBACK_PATH, AUTHORIZATION_TIMEOUT_MS,
} from './vendor/chatgpt/auth/protocol.js';

export const APP_NAME = 'dsh-chatgpt';
const issuer = 'https://auth.openai.com';
const nonEmpty = value => typeof value === 'string' && value.length > 0;
const expiredGrant = new Set(['invalid_grant', 'invalid_refresh_token', 'token_expired',
  'refresh_token_expired', 'refresh_token_invalidated', 'refresh_token_reused']);
const planEnabled = grant => grant?.scopes.includes(DIRECT_TOKEN_SCOPE) === true;

function waitWithSignal(promise, signal) {
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    void promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

function tokenFields(body, existing) {
  const { access_token, refresh_token, expires_in, scope, token_type } = body;
  const scopes = scope === undefined && existing ? existing.scopes : String(scope ?? '').split(/\s+/).filter(Boolean);
  if (!nonEmpty(access_token) || ((existing || scopes.includes('offline_access')) && !nonEmpty(refresh_token)) ||
      !Number.isFinite(expires_in) || expires_in <= 0 ||
      (token_type !== undefined && (!nonEmpty(token_type) || token_type.toLowerCase() !== 'bearer'))) {
    throw new Error('OpenAI returned an incomplete ChatGPT token response.');
  }
  const expiresAt = Date.now() + expires_in * 1000;
  return { accessToken: access_token, refreshToken: refresh_token, scopes, expiresAt,
    refreshAt: expiresAt - Math.min(180_000, expires_in * 100) };
}

async function listenForCallback(server) {
  // Use the dynamic/private range so browsers can follow the OAuth redirect.
  for (let attempt = 0; attempt < 12; attempt++) {
    server.listen(randomInt(49152, 65536), CALLBACK_HOST);
    try {
      await once(server, 'listening');
      return server.address().port;
    } catch (error) {
      if (error.code !== 'EADDRINUSE' && error.code !== 'EACCES') throw error;
    }
  }
  throw new Error('Could not open a local ChatGPT sign-in port. Start sign-in again.');
}

export class ChatGptAuth {
  #queue = Promise.resolve();
  #refresh;
  #pending;
  #error;
  #closed = false;

  static async create(store, { fetcher = fetch, onChange = () => {} } = {}) {
    const document = await store.read();
    if (document !== undefined && (document.version !== 1 || !nonEmpty(document.hostId) ||
        !Array.isArray(document.accounts))) {
      throw new Error('The ChatGPT credential store has an invalid format.');
    }
    return new ChatGptAuth(store, document ?? {
      version: 1, hostId: `urn:uuid:${randomUUID()}`, accounts: [],
    }, fetcher, onChange);
  }

  constructor(store, document, fetcher, onChange) {
    this.store = store;
    this.document = document;
    this.fetch = fetcher;
    this.onChange = onChange;
  }

  #serialize(operation) {
    const next = this.#queue.then(operation);
    this.#queue = next.catch(() => {});
    return next;
  }

  async #save(document, notify = true) {
    await this.store.write(document);
    this.document = document;
    if (notify) this.onChange();
  }

  active() {
    const account = this.document.accounts.find(entry => entry.clientId === this.document.active);
    return planEnabled(account) && account.accessToken && !account.revoking ? account : undefined;
  }

  status() {
    return {
      accounts: this.document.accounts.map(({ clientId, email, expiresAt, accessToken, scopes, revoking }) => ({
        clientId, email, expiresAt, authorized: Boolean(accessToken && !revoking && scopes.includes(DIRECT_TOKEN_SCOPE)),
        active: clientId === this.document.active,
      })),
      pending: this.#pending?.url,
      error: this.#error,
    };
  }

  async #json(url, options = {}) {
    const signal = options.signal
      ? AbortSignal.any([options.signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000);
    const result = await this.fetch(url, { ...options, redirect: 'error', signal });
    return { ok: result.ok, status: result.status, body: await result.json().catch(() => ({})) };
  }

  #token(form, signal) {
    return this.#json(TOKEN_URL, {
      method: 'POST', signal,
      headers: { accept: 'application/json' },
      body: new URLSearchParams({ ...form, resource: RESOURCE }),
    });
  }

  async #discovery(signal) {
    const { ok, body } = await this.#json(`${issuer}/.well-known/openid-configuration`, { signal });
    if (!ok || body.issuer !== issuer) throw new Error('Could not load OpenAI’s sign-in configuration.');
    return body;
  }

  #openAiUrl(value) {
    const url = new URL(value);
    if (url.origin !== issuer || url.username || url.password) {
      throw new Error('OpenAI returned an unexpected sign-in endpoint.');
    }
    return url;
  }

  async #identity(token, clientId, nonce, signal) {
    const { jwks_uri } = await this.#discovery(signal);
    const { ok, body } = await this.#json(this.#openAiUrl(jwks_uri), { signal });
    if (!ok || !Array.isArray(body.keys)) throw new Error('Could not load OpenAI’s signing keys.');
    try {
      const { payload } = await jwtVerify(token, createLocalJWKSet(body), {
        issuer, audience: clientId, requiredClaims: ['sub', 'exp', 'iat', 'nonce'], clockTolerance: 5,
      });
      if (payload.nonce !== nonce || !nonEmpty(payload.sub) ||
          (payload.azp !== undefined && payload.azp !== clientId) ||
          (Array.isArray(payload.aud) && payload.aud.length > 1 && payload.azp !== clientId)) {
        throw new Error('Invalid identity claims.');
      }
      return { subject: payload.sub, email: typeof payload.email === 'string' ? payload.email : undefined };
    } catch {
      throw new Error('The ChatGPT identity token could not be verified. Start sign-in again.');
    }
  }

  async begin(clientId) {
    return this.#serialize(async () => {
      if (this.#closed) throw new Error('The ChatGPT plugin is stopping.');
      this.cancel();
      const existing = clientId === undefined ? undefined
        : this.document.accounts.find(account => account.clientId === clientId);
      if (clientId !== undefined && !existing) throw new Error('Unknown ChatGPT registration.');
      this.#error = undefined;
      await this.#save(this.document, false);
      const state = randomBytes(32).toString('base64url');
      const nonce = randomBytes(32).toString('base64url');
      const verifier = randomBytes(48).toString('base64url');
      const controller = new AbortController();
      const attempt = { controller, accepting: true };
      const server = createServer(async (request, response) => {
        const reply = (status, message) => {
          response.writeHead(status, { 'content-type': 'text/plain; charset=utf-8',
            'cache-control': 'no-store', 'referrer-policy': 'no-referrer' });
          response.end(message);
        };
        let callback;
        try { callback = new URL(request.url, attempt.redirectUri); } catch {}
        if (request.method !== 'GET' || request.headers.host !== new URL(attempt.redirectUri).host ||
            callback?.origin !== new URL(attempt.redirectUri).origin ||
            callback.pathname !== CALLBACK_PATH || callback.searchParams.get('state') !== state) {
          reply(400, 'This request did not match the ChatGPT sign-in attempt.');
          return;
        }
        if (!attempt.accepting) {
          reply(409, 'This sign-in callback was already received.');
          return;
        }
        attempt.accepting = false;
        try {
          if (callback.searchParams.has('error')) throw new Error('ChatGPT sign-in was declined.');
          const issued = callback.searchParams.get('client_id') ?? existing?.clientId;
          const code = callback.searchParams.get('code');
          if (!code || !issued || !/^oaiapp_[\w-]+$/.test(issued) ||
              (existing && issued !== existing.clientId)) throw new Error('ChatGPT did not return the expected registration and code.');
          const result = await this.#token({
            grant_type: 'authorization_code', client_id: issued, code,
            code_verifier: verifier, redirect_uri: attempt.redirectUri,
          }, controller.signal);
          if (!result.ok) throw new Error(`OpenAI declined the token exchange (HTTP ${result.status}). Start sign-in again.`);
          const { id_token } = result.body;
          const identity = await this.#identity(id_token, issued, nonce, controller.signal);
          if (existing && identity.subject !== existing.subject) {
            throw new Error('This ChatGPT account differs from the saved registration.');
          }
          const account = {
            clientId: issued, ...identity, ...tokenFields(result.body), idToken: id_token,
            replayNamespace: randomUUID(),
          };
          account.needsConsent = !planEnabled(account);
          await this.#serialize(async () => {
            controller.signal.throwIfAborted();
            await this.#replaceAccount(account, issued);
          });
          reply(200, planEnabled(account)
            ? 'ChatGPT plan access is connected. You can close this tab and return to DeepSeek Harness.'
            : 'ChatGPT signed in. Authorize plan usage in ChatGPT settings and sign in again to enable model access.');
        } catch (error) {
          if (this.#pending === attempt && !controller.signal.aborted) this.#error =
            error instanceof Error && ['AbortError', 'TimeoutError', 'TypeError'].includes(error.name)
              ? 'Could not complete ChatGPT sign-in. Check the connection and start again.'
              : error.message;
          reply(400, 'ChatGPT sign-in could not be completed. Return to DeepSeek Harness for details.');
        } finally {
          if (this.#pending === attempt) this.cancel();
        }
      });
      const port = await listenForCallback(server);
      attempt.redirectUri = `http://${CALLBACK_HOST}:${port}${CALLBACK_PATH}`;
      const authUrl = new URL(AUTHORIZE_URL);
      authUrl.search = new URLSearchParams({
        client_id: existing?.clientId ?? DYNAMIC_CLIENT_ID, ext_agent_host_id: this.document.hostId,
        ...(!existing ? { agent_name_hint: APP_NAME } : {
          ...(existing.email ? { login_hint: existing.email } : {}),
          ...(existing.needsConsent ? { prompt: 'consent' } : {}),
        }),
        response_type: 'code', redirect_uri: attempt.redirectUri, scope: SCOPE, resource: RESOURCE,
        state, nonce, code_challenge_method: 'S256',
        code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      });
      attempt.url = authUrl.href;
      attempt.server = server;
      attempt.timer = setTimeout(() => {
        this.#error = 'ChatGPT sign-in timed out. Start a new sign-in.';
        this.cancel();
      }, AUTHORIZATION_TIMEOUT_MS);
      attempt.timer.unref();
      this.#pending = attempt;
      return this.status();
    });
  }

  #replaceAccount(account, active = this.document.active, notify = true) {
    return this.#save({ ...this.document, active, accounts: [
      ...this.document.accounts.filter(entry => entry.clientId !== account.clientId), account,
    ] }, notify);
  }

  cancel() {
    const attempt = this.#pending;
    this.#pending = undefined;
    if (attempt) {
      clearTimeout(attempt.timer);
      attempt.controller.abort();
      attempt.server.close();
    }
    return this.status();
  }

  async activate(clientId) {
    return this.#serialize(async () => {
      if (!this.document.accounts.some(account => account.clientId === clientId)) throw new Error('Unknown ChatGPT registration.');
      this.cancel();
      this.#error = undefined;
      await this.#save({ ...this.document, active: clientId });
      return this.status();
    });
  }

  async signOut(clientId) {
    return this.#serialize(async () => {
      this.cancel();
      const account = this.document.accounts.find(entry => entry.clientId === clientId);
      if (!account) throw new Error('Unknown ChatGPT registration.');
      await this.#replaceAccount({ ...account, revoking: true });
      let confirmed = !account.refreshToken;
      if (account.refreshToken) {
        try {
          const { revocation_endpoint } = await this.#discovery();
          const response = await this.fetch(this.#openAiUrl(revocation_endpoint), {
            method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20_000),
            body: new URLSearchParams({ token: account.refreshToken, token_type_hint: 'refresh_token', client_id: clientId }),
          });
          confirmed = response.status === 200;
          await response.body?.cancel();
        } catch {}
      }
      const { subject, email } = account;
      this.#error = confirmed ? undefined : 'Signed out locally. OpenAI did not confirm revocation. Manage access in ChatGPT settings.';
      await this.#replaceAccount({ subject, email, clientId, scopes: [] });
      return this.status();
    });
  }

  usable(signal) { return this.#grant(false, signal); }
  renew(signal, previous) { return this.#grant(true, signal, previous); }

  async #grant(force, signal, previous) {
    signal?.throwIfAborted();
    if (this.#closed) throw new Error('The ChatGPT plugin is stopping.');
    const account = this.active();
    if (!account) throw new Error('Connect a ChatGPT account with plan access in Settings → Models.');
    if (previous && previous.replayNamespace !== account.replayNamespace) {
      throw new Error('The selected ChatGPT registration changed. Retry the request.');
    }
    if ((!force && account.refreshAt > Date.now()) ||
        (previous && previous.accessToken !== account.accessToken)) return account;
    if (!account.refreshToken) {
      if (!force && account.expiresAt > Date.now()) return account;
      throw new RefreshRefusedError('Sign in again to restore ChatGPT plan access.', true);
    }
    if (this.#refresh?.namespace !== account.replayNamespace) {
      const promise = this.#serialize(async () => {
        const current = this.active();
        if (current?.replayNamespace !== account.replayNamespace) throw new Error('The selected ChatGPT registration changed.');
        const result = await this.#token({
          grant_type: 'refresh_token', client_id: current.clientId, refresh_token: current.refreshToken,
        });
        if (!result.ok) {
          const code = result.body.error?.code ?? result.body.error?.type ?? result.body.error;
          if (expiredGrant.has(code)) {
            const { clientId, subject, email } = current;
            await this.#replaceAccount({ clientId, subject, email, scopes: [] });
            throw new RefreshRefusedError('Sign in again to restore ChatGPT plan access.', true);
          }
          throw new RefreshRefusedError(`OpenAI could not refresh ChatGPT access (HTTP ${result.status}).`, false);
        }
        const updated = { ...current, ...tokenFields(result.body, current) };
        updated.needsConsent = !planEnabled(updated);
        await this.#replaceAccount(updated, this.document.active, !planEnabled(updated));
        if (!planEnabled(updated)) throw new RefreshRefusedError('The account no longer grants ChatGPT plan access.', true);
        return updated;
      });
      this.#refresh = { namespace: account.replayNamespace, promise };
      const clear = () => { if (this.#refresh?.promise === promise) this.#refresh = undefined; };
      void promise.then(clear, clear);
    }
    return waitWithSignal(this.#refresh.promise, signal);
  }

  async close() {
    this.#closed = true;
    this.cancel();
    await this.#queue;
    await this.store.close();
  }
}
