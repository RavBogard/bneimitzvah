import "server-only";
import type { HttpRuntime } from "../runtime/composition";
import { readJsonBody } from "./body";
import { closedObject, uniqueQuery } from "./query";
import { requireCookieMutation } from "./mutations";
import { errorResponse, HttpBoundaryError, privateJson, type JsonValue } from "./responses";

// Release 1.1: a staff member's Claude connections page lists and ends connections; an admin's lists every staff
// member's. The Maven link panel in the admin roster reads and undoes one student's link.
const routes = {
  "/api/staff/claude-connections": ["GET"], "/api/staff/claude-connections/revoke": ["POST"],
  "/api/admin/maven-link": ["GET"], "/api/admin/maven-link/unlink": ["POST"],
} as const;
export function claudeConnectionsRouteMethods(pathname: string): readonly string[] | null {
  return Object.hasOwn(routes, pathname) ? routes[pathname as keyof typeof routes] : null;
}
export async function handleClaudeConnectionsRequest(request: Request, runtime: HttpRuntime): Promise<Response | null> {
  const pathname = new URL(request.url).pathname, methods = claudeConnectionsRouteMethods(pathname); if (!methods) return null;
  try {
    if (!methods.includes(request.method)) { const response = errorResponse(new HttpBoundaryError(405)); response.headers.set("allow", methods.join(", ")); return response; }
    let result: JsonValue, status: 200 | 409 = 200;
    if (pathname === "/api/staff/claude-connections") {
      uniqueQuery(request.url, []);
      result = { ok: true, view: await runtime.claudeConnections.list(request) as unknown as JsonValue };
    } else if (pathname === "/api/staff/claude-connections/revoke") {
      uniqueQuery(request.url, []); requireCookieMutation(request, runtime.origin);
      const body = closedObject(await readJsonBody(request), ["connectionId"]);
      result = await runtime.claudeConnections.revoke(request, body.connectionId) as unknown as JsonValue;
    } else if (pathname === "/api/admin/maven-link") {
      const query = uniqueQuery(request.url, ["studentId"]);
      result = { ok: true, link: await runtime.mavenLinks.read(request, query.get("studentId")) as unknown as JsonValue };
    } else {
      uniqueQuery(request.url, []); requireCookieMutation(request, runtime.origin);
      const body = closedObject(await readJsonBody(request), ["studentId", "mavenContactId"]);
      const outcome = await runtime.mavenLinks.unlink(request, { studentId: body.studentId, mavenContactId: body.mavenContactId });
      result = outcome as unknown as JsonValue; if (!outcome.ok) status = 409;
    }
    if (Buffer.byteLength(JSON.stringify(result)) > 64 * 1024) throw new Error("Connections unavailable");
    return privateJson(result, status);
  } catch (error) { return errorResponse(error); }
}
