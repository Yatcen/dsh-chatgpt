import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';

export const name = 'dsh-chatgpt-desktop-fixture';
const auth = 'https://auth.openai.com';
const api = 'https://api.openai.com/v1';
const model = 'gpt-fixture-desktop';
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const key = { ...publicKey.export({ format: 'jwk' }), alg: 'RS256', kid: 'fixture-key' };
const originalFetch = globalThis.fetch;
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const clientId = 'oaiapp_desktop_fixture';
const scope = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const authorized = new Map();

function identity(nonce) {
  const seconds = Date.now() / 1000 | 0;
  const content = encode({ alg: 'RS256', kid: key.kid }) + '.' + encode({
    iss: auth, aud: clientId, exp: seconds + 3600, iat: seconds, nonce,
    sub: 'fixture-subject', email: 'fixture@example.invalid',
  });
  return content + '.' + sign('sha256', Buffer.from(content), privateKey).toString('base64url');
}

function sse(events) {
  const stream = new ReadableStream({
    async start(controller) {
      for (const event of events) {
        controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`));
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      controller.close();
    },
  });
  return new Response(stream, { headers: { 'content-type': 'text/event-stream' } });
}

function message(text) {
  const item = { id: 'msg_fixture', type: 'message', role: 'assistant',
    status: 'completed', content: [{ type: 'output_text', text, annotations: [] }] };
  return [
    { type: 'response.output_text.delta', item_id: item.id, output_index: 0, content_index: 0, delta: text.slice(0, 8) },
    { type: 'response.output_text.delta', item_id: item.id, output_index: 0, content_index: 0, delta: text.slice(8) },
    { type: 'response.output_item.done', item, output_index: 0 },
    { type: 'response.completed', response: { id: 'resp_fixture', output: [item],
      usage: { input_tokens: 20, output_tokens: 10, total_tokens: 30 } } },
  ];
}

function delegation() {
  const item = { id: 'fc_fixture', type: 'function_call', call_id: 'call_fixture', namespace: 'dsh',
    name: 'subagent_dsh_chatgpt', status: 'completed',
    arguments: JSON.stringify({ description: 'Smoke test delegation', name: 'codex-smoke', prompt: 'Return the isolated Codex fixture result.' }) };
  return [
    { type: 'response.output_item.added', item: { ...item, arguments: '' }, output_index: 0 },
    { type: 'response.function_call_arguments.delta', item_id: item.id, output_index: 0, delta: item.arguments },
    { type: 'response.function_call_arguments.done', item_id: item.id, output_index: 0, arguments: item.arguments },
    { type: 'response.output_item.done', item, output_index: 0 },
    { type: 'response.completed', response: { id: 'resp_tool', output: [item] } },
  ];
}

export function apply(ctx) {
  globalThis.fetch = async (url, options = {}) => {
    const target = new URL(url);
    if (target.hostname === '127.0.0.1' && target.pathname === '/fixture/authorize') {
      const query = target.searchParams;
      const code = 'fixture-code';
      authorized.set(code, query);
      const redirect = new URL(query.get('redirect_uri'));
      redirect.searchParams.set('state', query.get('state'));
      redirect.searchParams.set('code', code);
      redirect.searchParams.set('client_id', clientId);
      return Response.redirect(redirect);
    }
    if (target.href === `${auth}/.well-known/openid-configuration`) {
      return Response.json({ issuer: auth, jwks_uri: `${auth}/.well-known/jwks.json`,
        revocation_endpoint: `${auth}/api/accounts/oauth/revoke` });
    }
    if (target.href === `${auth}/.well-known/jwks.json`) return Response.json({ keys: [key] });
    if (target.href === `${auth}/api/accounts/oauth/token`) {
      const body = options.body;
      assert.equal(body.get('resource'), api);
      assert.equal(body.get('client_id'), clientId);
      if (body.get('grant_type') === 'refresh_token') {
        assert.equal(body.get('refresh_token'), 'fixture-refresh-token');
        return Response.json({ access_token: 'fixture-access-token',
          refresh_token: 'fixture-refresh-token', expires_in: 3600, scope });
      }
      const grant = authorized.get(body.get('code'));
      assert.ok(grant);
      assert.equal(grant.get('redirect_uri'), body.get('redirect_uri'));
      assert.equal(grant.get('code_challenge'), createHash('sha256').update(body.get('code_verifier')).digest('base64url'));
      authorized.delete(body.get('code'));
      return Response.json({ id_token: identity(grant.get('nonce')), access_token: 'fixture-access-token',
        refresh_token: 'fixture-refresh-token', expires_in: 3600, scope });
    }
    if (target.href === `${auth}/api/accounts/oauth/revoke`) return new Response();
    if (target.href.startsWith(`${api}/`)) {
      assert.equal(new Headers(options.headers).get('authorization'), 'Bearer fixture-access-token');
      if (target.pathname === '/v1/models') {
        return Response.json({ models: [
          { slug: model, display_name: 'ChatGPT Desktop Fixture', visibility: 'list', context_window: 32000 },
          { slug: 'hidden-fixture', visibility: 'hidden' },
        ] });
      }
      assert.equal(target.pathname, '/v1/responses');
      const body = JSON.parse(options.body);
      assert.equal(body.model, model);
      assert.equal(body.store, false);
      assert.equal(body.stream, true);
      assert.ok(!('previous_response_id' in body));
      const serialized = JSON.stringify(body.input);
      if (serialized.includes('CODEX_FIXTURE_OK')) return sse(message('DESKTOP_DELEGATION_OK CODEX_FIXTURE_OK'));
      if (body.input.some(item => item.type === 'function_call_output')) return sse(message('Delegation started.'));
      if (serialized.includes('DELEGATE_DESKTOP_FIXTURE') &&
          body.tools?.some(group => group.type === 'namespace' &&
            group.tools.some(tool => tool.name === 'subagent_dsh_chatgpt'))) return sse(delegation());
      return sse(message('DESKTOP_STREAM_OK'));
    }
    if (target.hostname.endsWith('.openai.com') || target.hostname.endsWith('.deepseek.com')) {
      throw new Error('Unexpected network request in the isolated fixture.');
    }
    return originalFetch(url, options);
  };
  ctx.effect(() => () => { globalThis.fetch = originalFetch; });

  // Smoke tool uses the actual OAuth loopback handler with a synthetic consent response.
  ctx.inject(['dshChatgptAccount'], child => {
    let completed = false;
    const timer = setInterval(async () => {
      const controller = child.get('dshChatgptAccount');
      const pending = controller?.auth.status().pending;
      if (completed || !pending) return;
      completed = true;
      try {
        const response = await globalThis.fetch(`http://127.0.0.1/fixture/authorize?${new URL(pending).searchParams}`);
        const callback = await originalFetch(response.headers.get('location'));
        assert.equal(callback.status, 200);
      } catch (error) {
        console.error('Desktop fixture callback failed:', error.message);
      }
    }, 350);
    child.effect(() => () => clearInterval(timer));
  });
}
