import "server-only";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import { AccessDenied } from "../access/errors";
import { errorResult, textResult, validateInput, type Tool, type ToolContext, type ToolResult } from "./tools";

// The MCP Streamable HTTP transport, stateless and JSON-only, as in the haftarah connector: every
// JSON-RPC request arrives by POST and is answered in one JSON body. No SSE stream, no batch, no
// server-initiated message, so nothing private can leave after the authorization checks.
export const SUPPORTED_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26"] as const;
export const DEFAULT_VERSION = "2025-06-18";
/** The newest supported version, whatever the list's order (YYYY-MM-DD compares as text in date order). */
const NEWEST_VERSION = [...SUPPORTED_VERSIONS].sort().at(-1)!;
/** A protocol version's shape: a calendar date, YYYY-MM-DD. */
export const VERSION_SHAPE = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/;
/**
 * Whether an MCP-Protocol-Version header may proceed (1.0.1, future-safe): a supported version, or a well-formed
 * version newer than the newest supported one, handled as that newest (nothing here depends on the version), so a
 * client that moves ahead never loses the connector. Malformed values, versions older than the oldest supported
 * and unknown dates between supported ones are refused.
 */
export function protocolHeaderAccepted(value: string): boolean {
  if ((SUPPORTED_VERSIONS as readonly string[]).includes(value)) return true;
  return VERSION_SHAPE.test(value) && value > NEWEST_VERSION;
}
export const MAX_RESULT_CHARS = 200_000;
const DEFAULT_DEADLINE_MS = 25_000;

type Rpc = Readonly<{ jsonrpc: "2.0"; id: string | number | null } & ({ result: unknown } | { error: { code: number; message: string } })>;
const rpcError = (id: unknown, code: number, message: string): Rpc => ({ jsonrpc: "2.0", id: validId(id) ? id : null, error: { code, message } });
const rpcResult = (id: string | number, result: unknown): Rpc => ({ jsonrpc: "2.0", id, result });
const validId = (id: unknown): id is string | number => (typeof id === "string" && id.length <= 200) || (typeof id === "number" && Number.isSafeInteger(id));
// A last guard on every result: no bearer-shaped secret or e-mail address leaves the server.
const LEAK = /\bBearer\s+[A-Za-z0-9_-]{20,}|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}|postgres(?:ql)?:\/\//i;

function finish(result: ToolResult): ToolResult {
  const text = result.content.map(c => c.text).join("");
  if (text.length > MAX_RESULT_CHARS) return errorResult(`The result is too large (${text.length} characters); narrow the request or follow the page offset.`);
  if (LEAK.test(text)) return errorResult("A result would have included private contact or credential data; it was withheld.");
  return result;
}
function message(error: unknown): string {
  if (error instanceof AccessDenied) return error.status === 401 ? "This connection has ended or expired; reconnect from Claude's settings." : "Not found, or not available to this connection.";
  return "The portal could not complete this request just now; try again.";
}

async function callTool<Q extends PgQueryResultHKT>(tool: Tool<Q>, args: unknown, ctx: Omit<ToolContext<Q>, "signal">, outer: AbortSignal): Promise<ToolResult> {
  const input = args && typeof args === "object" && !Array.isArray(args) ? args as Record<string, unknown> : {};
  const problems = validateInput(tool.inputSchema, input);
  if (problems.length) return errorResult(problems.join("; "));
  const deadline = tool.deadlineMs ?? DEFAULT_DEADLINE_MS, controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deadline);
  const relay = () => controller.abort();
  outer.addEventListener("abort", relay, { once: true });
  let late: (() => void) | undefined;
  const expired = new Promise<"timeout">(resolve => { late = () => resolve("timeout"); controller.signal.addEventListener("abort", late, { once: true }); });
  try {
    const value = await Promise.race([tool.handler(input, { ...ctx, signal: controller.signal }), expired]);
    if (value === "timeout") return errorResult(`${tool.name} took too long; nothing more is reported for this call. Saves are idempotent by mutationId, so read again before resending.`);
    return textResult(value);
  } catch (error) { return errorResult(message(error)); }
  finally { clearTimeout(timer); outer.removeEventListener("abort", relay); if (late) controller.signal.removeEventListener("abort", late); }
}

export async function answerRpc<Q extends PgQueryResultHKT>(body: unknown, input: {
  tools: readonly Tool<Q>[]; instructions: string; serverInfo: Readonly<{ name: string; version: string }>; ctx: Omit<ToolContext<Q>, "signal">; signal: AbortSignal;
}): Promise<Rpc | null> {
  if (Array.isArray(body)) return rpcError(null, -32600, "Batches are not accepted; send one request at a time.");
  // A client's response to a server request (this server sends none): accepted, nothing to answer.
  if (body && typeof body === "object" && (body as Record<string, unknown>).jsonrpc === "2.0" && !Object.hasOwn(body, "method")
    && (Object.hasOwn(body, "result") || Object.hasOwn(body, "error"))) return null;
  if (!body || typeof body !== "object" || (body as Record<string, unknown>).jsonrpc !== "2.0" || typeof (body as Record<string, unknown>).method !== "string") return rpcError((body as Record<string, unknown> | null)?.id, -32600, "Invalid Request");
  const msg = body as Record<string, unknown>;
  if (!Object.hasOwn(msg, "id")) return null; // A notification: nothing to answer.
  if (!validId(msg.id)) return rpcError(null, -32600, "Invalid Request");
  const id = msg.id, p = msg.params && typeof msg.params === "object" && !Array.isArray(msg.params) ? msg.params as Record<string, unknown> : {};
  // Only the tools this connection's role and scopes allow exist for it.
  const visible = input.tools.filter(t => t.roles.includes(input.ctx.actor.role) && input.ctx.actor.scopes.has(t.scope));
  try {
    switch (msg.method) {
      case "initialize": {
        const asked = p.protocolVersion;
        return rpcResult(id, { protocolVersion: typeof asked === "string" && (SUPPORTED_VERSIONS as readonly string[]).includes(asked) ? asked : DEFAULT_VERSION,
          capabilities: { tools: { listChanged: false } }, serverInfo: input.serverInfo, instructions: input.instructions });
      }
      case "ping": return rpcResult(id, {});
      case "tools/list": return rpcResult(id, { tools: visible.map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema, annotations: t.annotations })) });
      case "tools/call": {
        const tool = visible.find(t => t.name === p.name);
        if (!tool) return rpcError(id, -32602, "Unknown tool");
        return rpcResult(id, finish(await callTool(tool, p.arguments, input.ctx, input.signal)));
      }
      default: return rpcError(id, -32601, "Method not found");
    }
  } catch { return rpcError(id, -32603, "Internal error"); }
}
