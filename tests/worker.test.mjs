import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.mjs';

test('health endpoint explicitly keeps monetization disabled', async () => {
  const result = await worker.fetch(new Request('https://example.com/api/health'), {});
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { ok: true, version: '0.2.0', adsEnabled: false, withdrawalsEnabled: false });
});
test('private endpoints refuse requests without signed Telegram session', async () => {
  const response = await worker.fetch(new Request('https://example.com/api/me'), { SESSION_SECRET: 'secret' });
  assert.equal(response.status, 401);
});
test('auth endpoint refuses cross-origin requests', async () => {
  const response = await worker.fetch(new Request('https://example.com/api/auth/telegram', {
    method: 'POST', headers: { origin: 'https://attacker.example', 'content-type': 'application/json' }, body: '{}'
  }), {});
  assert.equal(response.status, 403);
});
test('auth fails closed when secrets or D1 are missing', async () => {
  const response = await worker.fetch(new Request('https://example.com/api/auth/telegram', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}'
  }), {});
  assert.equal(response.status, 503);
});
