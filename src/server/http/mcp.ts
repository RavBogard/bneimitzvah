import "server-only";
import type { HttpRuntime } from "../runtime/composition";
import { readJsonBody, readFormBody } from "./body";
import { closedObject, uniqueQuery } from "./query";
import { HttpBoundaryError, privateHeaders, privateJson } from "./responses";
import { requireCookieMutation } from "./mutations";
import { AccessDenied } from "../access/errors";
import { authorizationMetadata, resourceMetadata, MCP_PATH, SCOPES } from "../mcp/oauth";

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
    uniqueQuery(request.url, []);
    const actor = await mcp.authenticate(request, resolved);
    if (!actor) return challenge(resolved.origin);
    let body: unknown;
    try { body = await readJsonBody(request, "mcp", 5000); }
    catch (error) { if (error instanceof HttpBoundaryError && error.status === 413) return json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Request too large" } }, 413); return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, 400); }
    const reply = await mcp.answer(body, actor, request.signal);
    return reply ? json(reply, 200) : new Response(null, { status: 202, headers: privateHeaders() });
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
    const view = await mcp.describe(request, body.request);
    return view ? privateJson(view as never) : privateJson({ error: "expired" }, 400);
  }
  if (path === "/api/oauth/consent/deny") {
    const body = closedObject(raw, ["request"]);
    const location = mcp.deny(body.request, resolved);
    return location ? privateJson({ redirect: location }) : privateJson({ error: "expired" }, 400);
  }
  const body = closedObject(raw, ["request", "unattended", "viewer"]);
  if (typeof body.unattended !== "boolean") throw new HttpBoundaryError();
  const result = await mcp.approve(request, body.request, body.unattended, body.viewer);
  return result.ok ? privateJson({ redirect: result.redirect }) : privateJson({ error: result.reason }, 400);
}
