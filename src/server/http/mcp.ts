import "server-only";
import type { HttpRuntime } from "../runtime/composition";
import { readJsonBody, readFormBody } from "./body";
import { closedObject, uniqueQuery } from "./query";
import { HttpBoundaryError, privateHeaders, privateJson } from "./responses";
import { requireCookieMutation } from "./mutations";
import { AccessDenied } from "../access/errors";
import { authorizationMetadata, resourceMetadata, CLAUDE_ORIGINS, MCP_PATH, SCOPES } from "../mcp/oauth";
import { SUPPORTED_VERSIONS, protocolHeaderAccepted } from "../mcp/transport";
import { createLogger, MCP_BODY_UNREAD } from "../logging/logger";

// Every method reaches the handler, which answers 404 while the MCP is disabled and 405 otherwise,
// so a disabled deployment does not even reveal which methods the routes take.
const ANY = Object.freeze(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);
const methods: Record<string, readonly string[]> = {
  [MCP_PATH]: ["POST"],
  "/.well-known/oauth-protected-resource": ["GET"], "/.well-known/oauth-protected-resource/api/mcp": ["GET"],
  "/.well-known/oauth-authorization-server": ["GET"], "/.well-known/oauth-authorization-server/api/mcp": ["GET"],
  "/api/oauth/register": ["POST"], "/api/oauth/authorize": ["GET"], "/api/oauth/token": ["POST"], "/api/oauth/revoke": ["POST"],
  "/api/oauth/consent/view": ["POST"], "/api/oauth/consent/approve": ["POST"], "/api/oauth/consent/deny": ["POST"],
};
export function mcpRouteMethods(pathname: string): readonly string[] | null {
  return Object.hasOwn(methods, pathname) ? ANY : null;
}

/** OAuth and MCP answers: JSON, never cached, never carrying a cookie. */
function json(body: unknown, status: number, extra: Record<string, string> = {}): Response {
  const headers = privateHeaders(); headers.set("content-type", "application/json; charset=utf-8");
  for (const [k, v] of Object.entries(extra)) headers.set(k, v);
  return new Response(JSON.stringify(body), { status, headers });
}
function redirect(location: string): Response {
  const headers = privateHeaders(); headers.set("location", location);
  return new Response(null, { status: 302, headers });
}
const publicMetadata = (body: unknown) => json(body, 200, { "cache-control": "public, max-age=300", "access-control-allow-origin": "*" });
function challenge(origin: string): Response {
  // Every scope: the server grants each staff member only what their role allows (a tutor, read; roster never to a routine).
  return json({ error: "invalid_token" }, 401, { "www-authenticate": `Bearer error="invalid_token", resource_metadata="${origin}/.well-known/oauth-protected-resource${MCP_PATH}", scope="${SCOPES.read} ${SCOPES.study} ${SCOPES.roster}"` });
}
const rpcRefusal = (status: 400 | 403, message: string) => json({ jsonrpc: "2.0", id: null, error: { code: -32000, message } }, status);
/**
 * MCP Streamable HTTP, "Security Warning": an Origin, when present, must be one this server expects, so a
 * page reached through DNS rebinding cannot talk to it. Claude's connector calls from its servers and
 * sends none; server-to-server clients are unaffected. Claude's own origins are accepted as well: a
 * browser could never use them anyway (no CORS here, and the bearer is never a cookie), so allowing
 * them costs nothing and keeps the live connector working if Claude's servers ever add the header.
 */
const originAllowed = (origin: string, own: string) => origin === own || CLAUDE_ORIGINS.includes(origin);
/** An initialize request negotiates its version in the body; every other message carries the header. */
const isInitialize = (body: unknown) => !!body && typeof body === "object" && !Array.isArray(body) && (body as Record<string, unknown>).method === "initialize";

const answer = (a: { status: number; body: Record<string, unknown> } | { redirect: string }) => "redirect" in a ? redirect(a.redirect) : json(a.body, a.status);

// Only called after dispatcher resolves the actual exact incoming host.
export async function handleMcpRequest(request: Request, runtime: HttpRuntime): Promise<Response | null> {
  const url = new URL(request.url), path = url.pathname;
  if (!Object.hasOwn(methods, path)) return null;
  const allowed = methods[path];
  // Until its review is accepted the endpoint is disabled by configuration and does not exist.
  const mcp = runtime.mcp;
  if (!mcp) throw new HttpBoundaryError(404);
  if (!allowed.includes(request.method)) throw new HttpBoundaryError(405);
  const resolved = await runtime.resolveHost(request);
  if (path.startsWith("/.well-known/oauth-protected-resource")) { uniqueQuery(request.url, []); return publicMetadata(resourceMetadata(resolved.origin)); }
  if (path.startsWith("/.well-known/oauth-authorization-server")) { uniqueQuery(request.url, []); return publicMetadata(authorizationMetadata(resolved.origin)); }
  // Token-authenticated endpoints never read a browser cookie; the consent endpoints only a cookie.
  if (path === MCP_PATH) {
    const origin = request.headers.get("origin"), version = request.headers.get("mcp-protocol-version");
    let body: unknown = MCP_BODY_UNREAD;
    // Exactly one closed, non-secret line per request, whatever the outcome (see mcpRequestLine).
    try {
      if (origin !== null && !originAllowed(origin, resolved.origin)) return rpcRefusal(403, "Forbidden: this origin may not use the portal MCP.");
      uniqueQuery(request.url, []);
      const actor = await mcp.authenticate(request, resolved);
      if (!actor) return challenge(resolved.origin);
      let parsed: unknown;
      try { parsed = await readJsonBody(request, "mcp", 5000); }
      catch (error) { body = null; if (error instanceof HttpBoundaryError && error.status === 413) return json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Request too large" } }, 413); return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, 400); }
      body = parsed;
      // MCP-Protocol-Version (2025-06-18 onward): absent means the client predates it (the spec says to assume
      // 2025-03-26, which is supported); present, it must be a supported version or a well-formed newer one
      // (protocolHeaderAccepted), or 400. The initialize request is exempt: its version is negotiated in the
      // body (as in the MCP TypeScript SDK).
      if (version !== null && !isInitialize(parsed) && !protocolHeaderAccepted(version))
        return rpcRefusal(400, `Bad Request: unsupported MCP-Protocol-Version (supported: ${SUPPORTED_VERSIONS.join(", ")} or later).`);
      const reply = await mcp.answer(parsed, actor, request.signal);
      return reply ? json(reply, 200) : new Response(null, { status: 202, headers: privateHeaders() });
    } finally {
      createLogger().mcpRequest({ origin, allowedOrigins: [resolved.origin, ...CLAUDE_ORIGINS], version, body });
    }
  }
  if (request.headers.has("authorization") && path !== "/api/oauth/token" && path !== "/api/oauth/revoke") throw new AccessDenied(403);
  if (path === "/api/oauth/register") {
    uniqueQuery(request.url, []);
    return answer(mcp.register(await readJsonBody(request)));
  }
  if (path === "/api/oauth/authorize") {
    return answer(mcp.authorize(url, resolved));
  }
  if (path === "/api/oauth/token") {
    uniqueQuery(request.url, []);
    return answer(await mcp.token(await readFormBody(request), resolved));
  }
  if (path === "/api/oauth/revoke") {
    uniqueQuery(request.url, []);
    await mcp.revoke(await readFormBody(request), resolved);
    return json({}, 200);
  }
  // The consent page: same-origin, cookie-authenticated, JSON.
  uniqueQuery(request.url, []);
  requireCookieMutation(request, resolved.origin);
  const raw = await readJsonBody(request);
  if (path === "/api/oauth/consent/view") {
    const body = closedObject(raw, ["request"]);
    const view = await mcp.describe(request, body.request, resolved);
    // "used": this request was already allowed; the page says so instead of offering Allow again.
    return view === "expired" ? privateJson({ error: "expired" }, 400) : view === "used" ? privateJson({ error: "used" }, 409) : privateJson(view as never);
  }
  if (path === "/api/oauth/consent/deny") {
    const body = closedObject(raw, ["request"]);
    const denied = await mcp.deny(body.request, resolved);
    return "redirect" in denied ? privateJson({ redirect: denied.redirect }) : privateJson({ error: denied.error }, denied.error === "used" ? 409 : 400);
  }
  const body = closedObject(raw, ["request", "unattended", "viewer"]);
  if (typeof body.unattended !== "boolean") throw new HttpBoundaryError();
  const result = await mcp.approve(request, body.request, body.unattended, body.viewer);
  return result.ok ? privateJson({ redirect: result.redirect }) : privateJson({ error: result.reason }, result.reason === "used" ? 409 : 400);
}
