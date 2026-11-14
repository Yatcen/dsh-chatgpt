import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import test from 'node:test';
import { createTransport } from '../src/transport.js';

test('routes the sign-in and Responses domains through the same proxy and exposes it to Codex', async () => {
  const destinations = [];
  const server = createServer();
  server.on('connect', (request, socket) => {
    destinations.push(request.url);
    socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const proxy = `http://127.0.0.1:${server.address().port}`;
  const transport = createTransport(() => proxy);
  try {
    for (const host of ['auth.openai.com', 'api.openai.com']) {
      await assert.rejects(transport.fetch(`https://${host}/`, { signal: AbortSignal.timeout(2000) }),
        { code: 'TRANSPORT', message: new RegExp(host.replaceAll('.', '\\.')) });
    }
    assert.deepEqual(destinations, ['auth.openai.com:443', 'api.openai.com:443']);
    assert.equal(transport.codexEnvironment().HTTPS_PROXY, proxy);
    assert.match(transport.codexEnvironment().NO_PROXY, /127\.0\.0\.1/);
  } finally {
    await transport.close();
    await new Promise(resolve => server.close(resolve));
  }
});

test('reports an invalid proxy configuration without including its value', async () => {
  const transport = createTransport(() => 'http://secret:password@127.0.0.1:7897');
  await assert.rejects(transport.fetch('https://api.openai.com/'), error => {
    assert.equal(error.code, 'chatgpt_invalid_proxy');
    assert.doesNotMatch(error.message, /secret|password/);
    return true;
  });
});
