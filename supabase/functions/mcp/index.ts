// Vision App — MCP Server (Supabase Edge Function)
//
// Implements the MCP protocol directly over HTTP/JSON-RPC. Stateless JSON mode:
//   - Single endpoint: POST /
//   - Bearer token in Authorization header
//   - One JSON-RPC request → one JSON-RPC response (no SSE, no session state)
//
// claude.ai supports this via the "custom MCP" connector form.
// Claude Code / Claude desktop also support it.
//
// We hand-roll the protocol rather than use the SDK's transport adapter
// because the SDK's transports are Node-shaped (req/res) and adapting them
// to Deno is more work than just handling the four methods we need.

import { tools, Tool } from './tools/_registry.ts';

const MCP_BEARER_TOKEN = Deno.env.get('MCP_BEARER_TOKEN');
if (!MCP_BEARER_TOKEN) throw new Error('MCP_BEARER_TOKEN env var required');

const PROTOCOL_VERSION = '2025-06-18';
const SERVER_INFO = { name: 'vision-app-mcp', version: '1.0.0' };

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

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
function err(id: JsonRpcRequest['id'], code: number, message: string, data?: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message, data } };
}

async function dispatch(req: JsonRpcRequest): Promise<JsonRpcResponse | null> {
  switch (req.method) {
    case 'initialize': {
      return ok(req.id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
      });
    }
    case 'notifications/initialized':
    case 'notifications/cancelled':
      // Notifications have no id and expect no response.
      return null;
    case 'ping':
      return ok(req.id, {});
    case 'tools/list': {
      return ok(req.id, {
        tools: tools.map((t: Tool) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.schema,
        })),
      });
    }
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

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, mcp-session-id, mcp-protocol-version',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });

  // Bearer auth
  const auth = req.headers.get('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!constantTimeEqual(token, MCP_BEARER_TOKEN!)) {
    return new Response('Unauthorized', { status: 401, headers: cors });
  }

  // GET = health check
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
      status: 400, headers: { ...cors, 'content-type': 'application/json' },
    });
  }

  // Single request or batch
  if (Array.isArray(body)) {
    const responses = await Promise.all(body.map(r => dispatch(r as JsonRpcRequest)));
    const filtered = responses.filter((r): r is JsonRpcResponse => r !== null);
    return new Response(JSON.stringify(filtered), {
      headers: { ...cors, 'content-type': 'application/json' },
    });
  }

  const response = await dispatch(body as JsonRpcRequest);
  if (response === null) {
    // Notification — empty 204
    return new Response(null, { status: 204, headers: cors });
  }
  return new Response(JSON.stringify(response), {
    headers: { ...cors, 'content-type': 'application/json' },
  });
});
