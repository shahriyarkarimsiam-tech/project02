import test from 'node:test';
import assert from 'node:assert/strict';
import { validateTelegramInitData, mintSession, verifySession } from '../src/auth.mjs';

async function sign(key, value) {
  const cryptoKey = await crypto.subtle.importKey('raw', typeof key === 'string' ? new TextEncoder().encode(key) : key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(value)));
}
function hex(bytes) { return Array.from(bytes, x => x.toString(16).padStart(2, '0')).join(''); }

test('Telegram initData requires valid hash, date and Telegram ID', async () => {
  const botToken = '123:xyz';
  const now = 1783670000;
  const params = new URLSearchParams({ user: JSON.stringify({ id: 1234567, first_name: 'Example' }), auth_date: String(now - 10), query_id: 'AA' });
  const check = [...params.entries()].sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => `${k}=${v}`).join('\n');
  params.set('hash', hex(await sign(await sign('WebAppData', botToken), check)));
  const valid = await validateTelegramInitData(params.toString(), botToken, now);
  assert.equal(valid?.id, '1234567');
  params.set('user', JSON.stringify({ id: 999999, first_name: 'Attacker' }));
  assert.equal(await validateTelegramInitData(params.toString(), botToken, now), null);
  params.set('auth_date', String(now - 90000));
  assert.equal(await validateTelegramInitData(params.toString(), botToken, now), null);
});
test('Signed session is invalid if changed or expired', async () => {
  const token = await mintSession('12345', 'very-long-signing-key', 1700000000);
  assert.equal(await verifySession(token, 'very-long-signing-key', 1700000001), '12345');
  assert.equal(await verifySession(token, 'wrong-key', 1700000001), null);
  assert.equal(await verifySession(token, 'very-long-signing-key', 1800000000), null);
  assert.equal(await verifySession(token.slice(0,-2)+'aa', 'very-long-signing-key', 1700000001), null);
});
