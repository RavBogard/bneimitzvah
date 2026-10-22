import "server-only";
import { randomUUID } from "node:crypto";

const hostFrames = ["configured", "incoming", "service"] as const;
const hostStages = ["scope", "url", "url-authority", "scheme", "host", "forwarded", "forwarded-host", "forwarded-proto", "forwarded-port", "directory-query", "directory-missing"] as const;
export type HostFrame = typeof hostFrames[number];
export type HostDenialStage = typeof hostStages[number];
type HostDenialEvent = `host.denied.${HostFrame}.${HostDenialStage}`;
const frames = new Set<string>(hostFrames), stages = new Set<string>(hostStages);
const events = new Set<string>(["runtime.unavailable", "request.complete", "mail.failed", "reading.unavailable",
  ...hostFrames.flatMap(frame => hostStages.map(stage => `host.denied.${frame}.${stage}`))]);
const statuses = new Set([200, 201, 204, 400, 401, 403, 404, 409, 429, 500, 503]);
export type LogEvent = "runtime.unavailable" | "request.complete" | "mail.failed" | "reading.unavailable" | HostDenialEvent;

// Validate unknown runtime callers before interpolation: never coerce objects,
// errors or request-derived strings into a diagnostic event.
export function hostDenialEvent(frame: unknown, stage: unknown): HostDenialEvent | null {
  if (typeof frame !== "string" || !frames.has(frame) || typeof stage !== "string" || !stages.has(stage)) return null;
  return `host.denied.${frame}.${stage}` as HostDenialEvent;
}

// One line per /api/mcp request (1.0.1), so real Claude traffic can be confirmed in the deployment logs. A closed
// projection only: whether an Origin was sent; the Origin when it is exactly one of the allowed ones, else "other";
// the MCP-Protocol-Version header when it has a version's shape, else "absent" or "malformed"; and the JSON-RPC
// method from a fixed list, else a fixed class. Never a bearer, cookie, body, id, argument, IP or user.
const MCP_METHODS = new Set(["initialize", "ping", "tools/list", "tools/call", "resources/list", "resources/templates/list", "resources/read",
  "prompts/list", "prompts/get", "logging/setLevel", "completion/complete",
  "notifications/initialized", "notifications/cancelled", "notifications/progress", "notifications/roots/list_changed"]);
const MCP_VERSION_SHAPE = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/;
/** Stands for a body the request never got as far as reading (refused or challenged first). */
export const MCP_BODY_UNREAD: unique symbol = Symbol("unread");
export type McpRequestInput = { origin: string | null; allowedOrigins: readonly string[]; version: string | null; body: unknown };
export function mcpRequestLine(input: McpRequestInput) {
  const origin = typeof input.origin === "string" ? input.origin : null, version = typeof input.version === "string" ? input.version : null;
  const allowed = origin !== null && input.allowedOrigins.some(entry => entry === origin);
  const body = input.body;
  let method: string;
  if (body === MCP_BODY_UNREAD) method = "unread";
  else if (Array.isArray(body)) method = "batch";
  else if (body && typeof body === "object") {
    const name = Object.hasOwn(body, "method") ? (body as Record<string, unknown>).method : undefined;
    method = typeof name === "string" ? (MCP_METHODS.has(name) ? name : "other")
      : name === undefined && (Object.hasOwn(body, "result") || Object.hasOwn(body, "error")) ? "response" : "invalid";
  } else method = "invalid";
  return Object.freeze({ event: "mcp.request" as const, originPresent: origin !== null, origin: origin === null ? "absent" : allowed ? origin : "other",
    protocolVersion: version === null ? "absent" : MCP_VERSION_SHAPE.test(version) ? version : "malformed", method });
}

// Never serialize an input object, Error, request, provider response or cause.
export function createLogger(sink: (line: string) => void = (line) => console.info(line)) {
  return Object.freeze({
    /** The /api/mcp request line: only mcpRequestLine's closed fields are ever written. */
    mcpRequest(input: McpRequestInput) {
      try { sink(JSON.stringify(mcpRequestLine(input))); } catch { /* Logging cannot change the operation outcome. */ }
    },
    request() {
      const requestId = randomUUID();
      return Object.freeze({
        requestId,
        emit(event: LogEvent, status: number) {
          if (typeof event !== "string" || !events.has(event) || !statuses.has(status)) return;
          try { sink(JSON.stringify({ event, status, requestId })); } catch { /* Logging cannot change the operation outcome. */ }
        },
      });
    },
  });
}
