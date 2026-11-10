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

test('webhook endpoint responds ok to telegram messages', async () => {
  const response = await worker.fetch(new Request('https://example.com/api/telegram/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ update_id: 1, message: { chat: { id: 100 }, text: '/start' } })
  }), { BOT_TOKEN: 'fake_bot_token' });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
});

test('leaderboard returns blocks leaders with mocked D1', async () => {
  const mockDB = {
    prepare(query) {
      assert(query.includes('best_blocks_score') || query.includes('blocks'));
      return {
        async all() {
          return { results: [{ name: 'Alice', score: 450 }] };
        }
      };
    }
  };
  const response = await worker.fetch(new Request('https://example.com/api/leaderboard?game=blocks&mode=classic'), { DB: mockDB });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.game, 'blocks');
  assert.equal(data.mode, 'classic');
  assert.deepEqual(data.leaders, [{ name: 'Alice', score: 450 }]);
});

test('leaderboard returns cascade leaders with mocked D1', async () => {
  const mockDB = {
    prepare(query) {
      assert(query.includes('best_cascade_score') || query.includes('cascade'));
      return {
        async all() {
          return { results: [{ name: 'Bob', score: 1200 }] };
        }
      };
    }
  };
  const response = await worker.fetch(new Request('https://example.com/api/leaderboard?game=cascade&mode=classic'), { DB: mockDB });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.game, 'cascade');
  assert.equal(data.mode, 'classic');
  assert.deepEqual(data.leaders, [{ name: 'Bob', score: 1200 }]);
});



