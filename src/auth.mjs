const encoder = new TextEncoder();

function hex(buffer) {
  return [...new Uint8Array(buffer)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
function bytesOfHex(value) {
  if (!/^[a-fA-F0-9]{64}$/.test(value)) return null;
  return Uint8Array.from(value.match(/.{2}/g).map(v => parseInt(v, 16)));
}
async function hmac(key, text) {
  const cryptoKey = await crypto.subtle.importKey('raw', key instanceof Uint8Array ? key : encoder.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(text)));
}
function equalBytes(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a[i] ^ b[i];
  return result === 0;
}
function toBase64Url(input) {
  const data = input instanceof Uint8Array ? input : encoder.encode(input);
  return btoa(String.fromCharCode(...data)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}
function fromBase64Url(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Bad token');
  const raw = atob(value.replaceAll('-', '+').replaceAll('_', '/'));
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}

export async function validateTelegramInitData(raw, botToken, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!raw || typeof raw !== 'string' || raw.length > 8192 || !botToken) return null;
  const params = new URLSearchParams(raw);
  if (Array.from(params.keys()).length !== new Set(params.keys()).size) return null;
  const signature = bytesOfHex(params.get('hash') || '');
  const authDate = Number(params.get('auth_date'));
  if (!Number.isInteger(authDate) || authDate > nowSeconds + 120 || nowSeconds - authDate > 86400) return null;
  const check = [...params.entries()]
    .filter(([key]) => key !== 'hash' && key !== 'signature')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`).join('\n');
  const secret = await hmac('WebAppData', botToken);
  if (!equalBytes(signature, await hmac(secret, check))) return null;
  try {
    const user = JSON.parse(params.get('user') || 'null');
    if (!user || !Number.isSafeInteger(user.id) || user.id <= 0) return null;
    return {
      id: String(user.id),
      firstName: String(user.first_name || 'Player').slice(0, 40),
      username: typeof user.username === 'string' ? user.username.slice(0, 32) : null,
      startParam: params.get('start_param') || null
    };
  } catch { return null; }
}

export async function mintSession(uid, secret, nowSeconds = Math.floor(Date.now() / 1000)) {
  const payload = toBase64Url(JSON.stringify({ uid, iat: nowSeconds, exp: nowSeconds + 604800 }));
  return `${payload}.${toBase64Url(await hmac(secret, payload))}`;
}
export async function verifySession(token, secret, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!token || !secret || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  try {
    if (!equalBytes(fromBase64Url(parts[1]), await hmac(secret, parts[0]))) return null;
    const data = JSON.parse(new TextDecoder().decode(fromBase64Url(parts[0])));
    if (!/^\d{1,20}$/.test(data.uid) || !Number.isInteger(data.iat) || !Number.isInteger(data.exp) || data.iat > nowSeconds + 120 || data.exp < nowSeconds) return null;
    return data.uid;
  } catch { return null; }
}

export function getCookie(request, name) {
  const values = (request.headers.get('cookie') || '').split(';').map(x => x.trim());
  const entry = values.find(x => x.startsWith(`${name}=`));
  return entry ? entry.slice(name.length + 1) : null;
}
