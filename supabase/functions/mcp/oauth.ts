// OAuth 2.1 endpoints for the Vision App MCP server.
// Single-user app: the bearer token is the shared secret that gates /authorize.
// Once the user enters it on the consent page, an auth code is issued and the
// browser is redirected back to claude.ai with the code. claude.ai then
// exchanges the code at /oauth/token for an access token (JWT) which is
// presented as Bearer on every subsequent MCP request.

import { signJWT, verifyJWT, s256 } from './jwt.ts';

const MCP_BEARER_TOKEN = Deno.env.get('MCP_BEARER_TOKEN');
const NOURIN_USER_ID = Deno.env.get('NOURIN_USER_ID');
// Optional: pre-registered OAuth client (for clients that don't use DCR
// or that require a pre-registered client_id/secret pair, like some
// claude.ai connector flows). DCR still works alongside.
const OAUTH_CLIENT_ID = Deno.env.get('OAUTH_CLIENT_ID') ?? '';
const OAUTH_CLIENT_SECRET = Deno.env.get('OAUTH_CLIENT_SECRET') ?? '';
if (!MCP_BEARER_TOKEN || !NOURIN_USER_ID) {
  throw new Error('MCP_BEARER_TOKEN and NOURIN_USER_ID env vars required');
}

const ACCESS_TOKEN_TTL = 60 * 60 * 24 * 30;  // 30 days
const REFRESH_TOKEN_TTL = 60 * 60 * 24 * 90; // 90 days
const AUTH_CODE_TTL = 60 * 5;                // 5 minutes

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, mcp-session-id, mcp-protocol-version',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

// Compute the function's public base URL.
// Supabase delivers requests internally at /mcp/<route>, but the public URL
// users hit is /functions/v1/mcp/<route> (gateway strips /functions/v1).
// We hardcode the public prefix because metadata is consumed by external
// clients (claude.ai), not by Supabase's internal routing.
// Also force https — internally req.url often has http:// even for HTTPS
// origins because Supabase terminates TLS at the edge.
function baseUrl(req: Request): string {
  const u = new URL(req.url);
  return `https://${u.host}/functions/v1/mcp`;
}

// ============================================================================
// Discovery
// ============================================================================

export function protectedResourceMetadata(req: Request): Response {
  const base = baseUrl(req);
  return jsonResponse({
    resource: base,
    authorization_servers: [base],
    bearer_methods_supported: ['header'],
    scopes_supported: ['mcp'],
  });
}

export function authorizationServerMetadata(req: Request): Response {
  const base = baseUrl(req);
  return jsonResponse({
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    registration_endpoint: `${base}/oauth/register`,
    scopes_supported: ['mcp'],
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
  });
}

// claude.ai's OAuth probe uses /.well-known/openid-configuration (OIDC
// Discovery) rather than /.well-known/oauth-authorization-server (RFC 8414).
// We reuse the same metadata and add the OIDC-required fields. Even though
// we don't actually issue id_tokens, claude.ai uses this purely to discover
// the authorization/token/registration endpoints — and gives up if the
// document 404s. So this is the load-bearing endpoint.
export function openidConfigurationMetadata(req: Request): Response {
  const base = baseUrl(req);
  return jsonResponse({
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    registration_endpoint: `${base}/oauth/register`,
    scopes_supported: ['mcp'],
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
    // OIDC-required fields. We don't actually issue id_tokens; these satisfy
    // discovery validators without committing us to OIDC userinfo flows.
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['HS256'],
  });
}

// ============================================================================
// Dynamic Client Registration (RFC 7591)
// ============================================================================
// Single-user app: we accept any client metadata and return a client_id.
// No persistence — the client_id is just an opaque string the client echoes
// back later. We don't enforce per-client rules.
export async function register(req: Request): Promise<Response> {
  let metadata: Record<string, unknown>;
  try { metadata = await req.json(); }
  catch { return errorResponse(400, 'invalid_client_metadata', 'Body must be JSON'); }

  const client_id = `vision-${crypto.randomUUID()}`;
  // Echo back the metadata the client sent, plus our assigned id.
  // No client_secret — this is a public client (PKCE-based).
  return jsonResponse({
    ...metadata,
    client_id,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    token_endpoint_auth_method: 'none',
  });
}

// ============================================================================
// /oauth/authorize — consent page
// ============================================================================
// GET: render HTML form with Bearer token field
// POST: validate Bearer, issue auth code, redirect to redirect_uri

export async function authorize(req: Request): Promise<Response> {
  const u = new URL(req.url);
  const params = req.method === 'POST'
    ? Object.fromEntries(new URLSearchParams(await req.text()))
    : Object.fromEntries(u.searchParams);

  const {
    response_type, client_id, redirect_uri, state,
    code_challenge, code_challenge_method, scope,
    bearer_token, // form field, only present on POST
  } = params;

  if (response_type !== 'code') return errorPage(400, 'response_type must be "code"');
  if (!redirect_uri) return errorPage(400, 'redirect_uri required');
  if (code_challenge_method && code_challenge_method !== 'S256') {
    return errorPage(400, 'only S256 PKCE supported');
  }

  if (req.method === 'GET') {
    return new Response(consentHTML({
      client_id: client_id ?? '',
      redirect_uri,
      state: state ?? '',
      code_challenge: code_challenge ?? '',
      code_challenge_method: code_challenge_method ?? '',
      scope: scope ?? 'mcp',
      response_type,
    }), { headers: { ...cors, 'content-type': 'text/html; charset=utf-8' } });
  }

  // POST — validate the bearer token
  if (!bearer_token || !constantTimeEqual(bearer_token, MCP_BEARER_TOKEN!)) {
    return new Response(consentHTML({
      client_id: client_id ?? '',
      redirect_uri,
      state: state ?? '',
      code_challenge: code_challenge ?? '',
      code_challenge_method: code_challenge_method ?? '',
      scope: scope ?? 'mcp',
      response_type,
      error: 'Invalid key. Check the MCP_BEARER_TOKEN value from your .env.local.',
    }), { status: 401, headers: { ...cors, 'content-type': 'text/html; charset=utf-8' } });
  }

  // Issue auth code (signed JWT, 5 min TTL, single-use binding to redirect_uri + PKCE)
  const code = await signJWT({
    typ: 'auth_code',
    sub: NOURIN_USER_ID,
    redirect_uri,
    code_challenge: code_challenge ?? null,
    client_id: client_id ?? null,
  }, AUTH_CODE_TTL);

  const target = new URL(redirect_uri);
  target.searchParams.set('code', code);
  if (state) target.searchParams.set('state', state);

  return new Response(null, { status: 302, headers: { ...cors, location: target.toString() } });
}

// ============================================================================
// /oauth/token — exchange code or refresh
// ============================================================================
export async function token(req: Request): Promise<Response> {
  let params: Record<string, string>;
  try {
    const text = await req.text();
    params = Object.fromEntries(new URLSearchParams(text));
  } catch { return errorResponse(400, 'invalid_request', 'Body must be x-www-form-urlencoded'); }

  // Client authentication: support client_secret_post (body), client_secret_basic
  // (HTTP Basic header), or none (DCR clients with PKCE only).
  let clientId = params.client_id ?? '';
  let clientSecret = params.client_secret ?? '';
  const basic = req.headers.get('authorization');
  if (basic && basic.startsWith('Basic ')) {
    try {
      const decoded = atob(basic.slice(6));
      const sep = decoded.indexOf(':');
      if (sep >= 0) {
        clientId = clientId || decoded.slice(0, sep);
        clientSecret = clientSecret || decoded.slice(sep + 1);
      }
    } catch { /* ignore */ }
  }

  // If a static client is configured AND the client identifies itself as that
  // client_id, validate the secret. Otherwise, trust PKCE for the security
  // floor (DCR public client flow).
  if (OAUTH_CLIENT_ID && clientId === OAUTH_CLIENT_ID) {
    if (!constantTimeEqual(clientSecret, OAUTH_CLIENT_SECRET)) {
      return errorResponse(401, 'invalid_client', 'Bad client credentials');
    }
  }

  const grant = params.grant_type;

  if (grant === 'authorization_code') {
    const { code, redirect_uri, code_verifier, client_id } = params;
    if (!code) return errorResponse(400, 'invalid_request', 'code required');

    const claims = await verifyJWT(code);
    if (!claims || claims.typ !== 'auth_code') {
      return errorResponse(400, 'invalid_grant', 'Bad or expired auth code');
    }
    if (claims.redirect_uri !== redirect_uri) {
      return errorResponse(400, 'invalid_grant', 'redirect_uri mismatch');
    }
    if (claims.client_id && claims.client_id !== client_id) {
      return errorResponse(400, 'invalid_grant', 'client_id mismatch');
    }
    if (claims.code_challenge) {
      if (!code_verifier) return errorResponse(400, 'invalid_grant', 'code_verifier required');
      const computed = await s256(code_verifier);
      if (computed !== claims.code_challenge) {
        return errorResponse(400, 'invalid_grant', 'PKCE verification failed');
      }
    }

    const access_token = await signJWT({ typ: 'access', sub: claims.sub, scope: 'mcp' }, ACCESS_TOKEN_TTL);
    const refresh_token = await signJWT({ typ: 'refresh', sub: claims.sub }, REFRESH_TOKEN_TTL);

    return jsonResponse({
      access_token,
      token_type: 'Bearer',
      expires_in: ACCESS_TOKEN_TTL,
      refresh_token,
      scope: 'mcp',
    });
  }

  if (grant === 'refresh_token') {
    const { refresh_token } = params;
    if (!refresh_token) return errorResponse(400, 'invalid_request', 'refresh_token required');
    const claims = await verifyJWT(refresh_token);
    if (!claims || claims.typ !== 'refresh') {
      return errorResponse(400, 'invalid_grant', 'Bad or expired refresh token');
    }
    const access_token = await signJWT({ typ: 'access', sub: claims.sub, scope: 'mcp' }, ACCESS_TOKEN_TTL);
    return jsonResponse({
      access_token,
      token_type: 'Bearer',
      expires_in: ACCESS_TOKEN_TTL,
      scope: 'mcp',
    });
  }

  return errorResponse(400, 'unsupported_grant_type', `Unknown grant_type: ${grant}`);
}

// ============================================================================
// MCP request authentication: accept either static bearer (Claude Code) or
// signed JWT access token (claude.ai web/mobile via OAuth).
// ============================================================================
export async function isAuthorized(req: Request): Promise<boolean> {
  const auth = req.headers.get('authorization') ?? '';
  if (!auth.startsWith('Bearer ')) return false;
  const token = auth.slice(7);

  // Path 1: static bearer matches MCP_BEARER_TOKEN
  if (constantTimeEqual(token, MCP_BEARER_TOKEN!)) return true;

  // Path 2: token is a JWT issued by us
  const claims = await verifyJWT(token);
  if (claims && claims.typ === 'access' && claims.sub === NOURIN_USER_ID) return true;

  return false;
}

// ============================================================================
// Helpers
// ============================================================================
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { ...cors, 'content-type': 'application/json' },
  });
}

function errorResponse(status: number, error: string, error_description: string): Response {
  return jsonResponse({ error, error_description }, status);
}

function errorPage(status: number, message: string): Response {
  const html = `<!DOCTYPE html><html><body style="font-family:system-ui;padding:40px;background:#0A0812;color:#F5EDD8;text-align:center"><h1 style="color:#D4AF6A">Error</h1><p>${escapeHTML(message)}</p></body></html>`;
  return new Response(html, { status, headers: { ...cors, 'content-type': 'text/html; charset=utf-8' } });
}

function escapeHTML(s: string): string {
  return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
}

// ============================================================================
// Consent page (on-brand: gold + deep purple)
// ============================================================================
function consentHTML(p: {
  client_id: string; redirect_uri: string; state: string;
  code_challenge: string; code_challenge_method: string;
  scope: string; response_type: string; error?: string;
}): string {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Authorize Vision App</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,600;1,400&family=DM+Sans:wght@300;400;500&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'DM Sans',sans-serif;background:#0A0812;color:#F5EDD8;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px}
.card{max-width:440px;width:100%;padding:44px 32px;border:0.5px solid rgba(212,175,106,.3);border-radius:14px;background:#06050F}
.brand{font-family:'Cormorant Garamond',serif;font-size:22px;font-weight:600;color:#D4AF6A;letter-spacing:.18em;text-align:center;margin-bottom:6px}
.brand em{font-weight:300;font-style:italic;opacity:.85}
.tag{font-size:9px;letter-spacing:.24em;text-transform:uppercase;color:#5C5275;text-align:center;margin-bottom:32px}
h1{font-family:'Cormorant Garamond',serif;font-style:italic;font-size:24px;color:#F5EDD8;text-align:center;margin-bottom:12px}
.note{font-size:12.5px;color:#A29080;line-height:1.7;text-align:center;margin-bottom:22px;font-weight:300}
label{font-size:9px;letter-spacing:.18em;text-transform:uppercase;color:#5C5275;display:block;margin-bottom:6px}
input{width:100%;padding:11px 14px;background:rgba(255,255,255,.04);border:0.5px solid rgba(212,175,106,.26);border-radius:8px;color:#F5EDD8;font-family:'DM Sans',sans-serif;font-size:13px}
input:focus{outline:none;border-color:#D4AF6A}
.btn{width:100%;margin-top:16px;padding:11px;background:#D4AF6A;color:#110800;border:none;border-radius:8px;font-family:'DM Sans',sans-serif;font-weight:500;font-size:13px;cursor:pointer;letter-spacing:.04em}
.btn:hover{opacity:.9}
.err{margin-top:14px;padding:10px;border:0.5px solid #C97A7A;border-radius:6px;color:#C97A7A;font-size:12px;text-align:center}
.fine{margin-top:18px;font-size:10px;color:#5C5275;text-align:center;line-height:1.6}
</style></head><body>
<form class="card" method="POST" action="">
  <div class="brand">N O U R I N <em>&amp;</em></div>
  <div class="tag">her vision · year one</div>
  <h1>Authorize this app</h1>
  <p class="note">An app is requesting access to your vision dashboard.<br>Paste your Vision App key to approve.</p>
  <label>Vision App key</label>
  <input name="bearer_token" type="password" autocomplete="off" placeholder="paste your key" autofocus>
  <input type="hidden" name="response_type" value="${escapeHTML(p.response_type)}">
  <input type="hidden" name="client_id" value="${escapeHTML(p.client_id)}">
  <input type="hidden" name="redirect_uri" value="${escapeHTML(p.redirect_uri)}">
  <input type="hidden" name="state" value="${escapeHTML(p.state)}">
  <input type="hidden" name="code_challenge" value="${escapeHTML(p.code_challenge)}">
  <input type="hidden" name="code_challenge_method" value="${escapeHTML(p.code_challenge_method)}">
  <input type="hidden" name="scope" value="${escapeHTML(p.scope)}">
  <button class="btn" type="submit">Authorize</button>
  ${p.error ? `<div class="err">${escapeHTML(p.error)}</div>` : ''}
  <div class="fine">If you didn't initiate this, close this tab.</div>
</form>
</body></html>`;
}
