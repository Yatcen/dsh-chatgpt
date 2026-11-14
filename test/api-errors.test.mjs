import assert from 'node:assert/strict';
import test from 'node:test';
import { listModels, streamTurn } from '../src/vendor/chatgpt/api/client.js';

test('a gateway failure before the stream starts is retryable and carries the OpenAI request ID', async () => {
  const events = streamTurn({
    accessToken: 'fixture',
    request: { model: 'fixture-model', messages: [] },
    endpoints: {
      fetch: async () => new Response('<html>Bad Gateway</html>', {
        status: 502,
        headers: { 'x-request-id': 'req_example' },
      }),
    },
  });

  await assert.rejects(events.next(), {
    code: 'SERVER', status: 502, requestId: 'req_example',
    message: /HTTP 502/,
  });
});

test('an exhausted ChatGPT allowance retains its code', async () => {
  const code = 'subscription_sharing_usage_limit_exceeded';
  const endpoints = { fetch: async () => Response.json({ error: { code } }, { status: 429 }) };
  await assert.rejects(listModels('fixture', endpoints), { code, status: 429, planUsage: true });
});
