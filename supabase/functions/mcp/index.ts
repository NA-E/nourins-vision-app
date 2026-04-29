// Vision App — MCP Server (Supabase Edge Function)
//
// Routes:
//   GET  /                                       → health check
//   POST /                                       → MCP JSON-RPC traffic (auth required)
//   GET  /.well-known/oauth-protected-resource   → RFC 9728 metadata
//   GET  /.well-known/oauth-authorization-server → RFC 8414 metadata
//   POST /oauth/register                         → RFC 7591 dynamic client registration
//   GET  /oauth/authorize                        → consent page (HTML)
//   POST /oauth/authorize                        → consent submission, redirects with code
//   POST /oauth/token                            → auth code → access token / refresh
//
// Auth on MCP traffic accepts either:
//   - Static MCP_BEARER_TOKEN (Claude Code, Claude Desktop)
//   - Signed JWT issued via OAuth (claude.ai web/mobile)

import { tools, Tool } from './tools/_registry.ts';
import {
  protectedResourceMetadata,
  authorizationServerMetadata,
  register,
  authorize,
  token,
  isAuthorized,
} from './oauth.ts';

const PROTOCOL_VERSION = '2025-06-18';
const SERVER_INFO = { name: 'vision-app-mcp', version: '1.0.0' };

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, mcp-session-id, mcp-protocol-version',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

type JsonRpcRequest = {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
};
type JsonRpcResponse = {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

function ok(id: JsonRpcRequest['id'], result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id: id ?? null, result };
}
function err(id: JsonRpcRequest['id'], code: number, message: string): JsonRpcResponse {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

async function dispatch(req: JsonRpcRequest): Promise<JsonRpcResponse | null> {
  switch (req.method) {
    case 'initialize':
      return ok(req.id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
      });
    case 'notifications/initialized':
    case 'notifications/cancelled':
      return null;
    case 'ping':
      return ok(req.id, {});
    case 'tools/list':
      return ok(req.id, {
        tools: tools.map((t: Tool) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.schema,
        })),
      });
    case 'tools/call': {
      const name = req.params?.name as string | undefined;
      const args = (req.params?.arguments ?? {}) as Record<string, unknown>;
      if (!name) return err(req.id, -32602, 'Missing tool name');
      const tool = tools.find((t: Tool) => t.name === name);
      if (!tool) return err(req.id, -32601, `Unknown tool: ${name}`);
      try {
        const result = await tool.handler(args);
        return ok(req.id, {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          isError: false,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return ok(req.id, {
          content: [{ type: 'text', text: `Error: ${msg}` }],
          isError: true,
        });
      }
    }
    default:
      return err(req.id, -32601, `Method not found: ${req.method}`);
  }
}

// Strip the function-mount prefix to get the route relative to our service.
// Supabase routes us internally at /mcp/<route>; the public-facing URL is
// /functions/v1/mcp/<route> (the gateway strips /functions/v1 before
// forwarding to us).
function routeOf(req: Request): string {
  const u = new URL(req.url);
  const idx = u.pathname.indexOf('/mcp');
  if (idx < 0) return '/';
  let path = u.pathname.slice(idx + '/mcp'.length) || '/';
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
  return path;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });

  const route = routeOf(req);

  // ───── OAuth discovery (no auth required) ─────
  if (req.method === 'GET' && route === '/.well-known/oauth-protected-resource') {
    return protectedResourceMetadata(req);
  }
  if (req.method === 'GET' && route === '/.well-known/oauth-authorization-server') {
    return authorizationServerMetadata(req);
  }

  // ───── OAuth flow (no auth required to reach these) ─────
  if (req.method === 'POST' && route === '/oauth/register') return await register(req);
  if (route === '/oauth/authorize' && (req.method === 'GET' || req.method === 'POST')) {
    return await authorize(req);
  }
  if (req.method === 'POST' && route === '/oauth/token') return await token(req);

  // ───── MCP root (auth required) ─────
  if (route !== '/') {
    return new Response('Not Found', { status: 404, headers: cors });
  }

  if (!(await isAuthorized(req))) {
    const u = new URL(req.url);
    const metadataUrl = `https://${u.host}/functions/v1/mcp/.well-known/oauth-protected-resource`;
    return new Response('Unauthorized', {
      status: 401,
      headers: {
        ...cors,
        // Per RFC 9728: point clients at the resource metadata so they can
        // discover the auth server and start the OAuth flow.
        'WWW-Authenticate': `Bearer realm="vision-app-mcp", resource_metadata="${metadataUrl}"`,
      },
    });
  }

  if (req.method === 'GET') {
    return new Response(JSON.stringify({ status: 'ok', ...SERVER_INFO }), {
      headers: { ...cors, 'content-type': 'application/json' },
    });
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: cors });
  }

  let body: unknown;
  try { body = await req.json(); }
  catch {
    return new Response(JSON.stringify(err(null, -32700, 'Parse error')), {
      status: 400,
      headers: { ...cors, 'content-type': 'application/json' },
    });
  }

  if (Array.isArray(body)) {
    const responses = await Promise.all(body.map(r => dispatch(r as JsonRpcRequest)));
    const filtered = responses.filter((r): r is JsonRpcResponse => r !== null);
    return new Response(JSON.stringify(filtered), {
      headers: { ...cors, 'content-type': 'application/json' },
    });
  }

  const response = await dispatch(body as JsonRpcRequest);
  if (response === null) return new Response(null, { status: 204, headers: cors });
  return new Response(JSON.stringify(response), {
    headers: { ...cors, 'content-type': 'application/json' },
  });
});
