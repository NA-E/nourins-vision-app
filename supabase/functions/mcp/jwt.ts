// Minimal HS256 JWT sign/verify using Web Crypto.
// Used for OAuth auth codes and access tokens.

const SECRET_RAW = Deno.env.get('JWT_SIGNING_SECRET');
if (!SECRET_RAW) throw new Error('JWT_SIGNING_SECRET env var required');
const SECRET = new TextEncoder().encode(SECRET_RAW);

const enc = new TextEncoder();
const dec = new TextDecoder();

function b64urlEncode(input: string | Uint8Array): string {
  const bytes = typeof input === 'string' ? enc.encode(input) : input;
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function b64urlDecode(input: string): Uint8Array {
  let b64 = input.replaceAll('-', '+').replaceAll('_', '/');
  while (b64.length % 4) b64 += '=';
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

let _key: CryptoKey | null = null;
async function key(): Promise<CryptoKey> {
  if (_key) return _key;
  _key = await crypto.subtle.importKey(
    'raw', SECRET, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'],
  );
  return _key;
}

export async function signJWT(
  payload: Record<string, unknown>,
  expiresInSec: number,
): Promise<string> {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const fullPayload = { iat: now, exp: now + expiresInSec, ...payload };
  const headerB64 = b64urlEncode(JSON.stringify(header));
  const payloadB64 = b64urlEncode(JSON.stringify(fullPayload));
  const data = enc.encode(`${headerB64}.${payloadB64}`);
  const sig = await crypto.subtle.sign('HMAC', await key(), data);
  return `${headerB64}.${payloadB64}.${b64urlEncode(new Uint8Array(sig))}`;
}

export async function verifyJWT(token: string): Promise<Record<string, unknown> | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts;
  const data = enc.encode(`${headerB64}.${payloadB64}`);
  let ok: boolean;
  try {
    ok = await crypto.subtle.verify('HMAC', await key(), b64urlDecode(sigB64), data);
  } catch { return null; }
  if (!ok) return null;
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(dec.decode(b64urlDecode(payloadB64)));
  } catch { return null; }
  if (typeof payload.exp === 'number' && payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}

// PKCE S256: SHA-256 then base64url
export async function s256(verifier: string): Promise<string> {
  const data = enc.encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return b64urlEncode(new Uint8Array(digest));
}
