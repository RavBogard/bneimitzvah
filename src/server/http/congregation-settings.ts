import "server-only";
import type { HttpRuntime } from "../runtime/composition";
import { readJsonBody } from "./body";
import { closedObject, uniqueQuery } from "./query";
import { requireCookieMutation } from "./mutations";
import { errorResponse, HttpBoundaryError, privateJson, type JsonValue } from "./responses";

// The admin's congregation settings page reads and saves here; every member's pages read the links, service names and consent notice.
const routes = { "/api/admin/congregation-settings": ["GET", "POST"], "/api/congregation/links": ["GET"] } as const;
export function congregationSettingsRouteMethods(pathname: string): readonly string[] | null {
  return Object.hasOwn(routes, pathname) ? routes[pathname as keyof typeof routes] : null;
}
export async function handleCongregationSettingsRequest(request: Request, runtime: HttpRuntime): Promise<Response | null> {
  const pathname = new URL(request.url).pathname, methods = congregationSettingsRouteMethods(pathname); if (!methods) return null;
  try {
    if (!methods.includes(request.method)) { const response = errorResponse(new HttpBoundaryError(405)); response.headers.set("allow", methods.join(", ")); return response; }
    uniqueQuery(request.url, []);
    let result: unknown;
    if (pathname === "/api/congregation/links") result = { ok: true, ...await runtime.congregationSettings.display(request) };
    else if (request.method === "GET") result = { ok: true, view: await runtime.congregationSettings.read(request) };
    else {
      requireCookieMutation(request, runtime.origin);
      const body = closedObject(await readJsonBody(request), ["expectedVersion", "settings", "mutationId"]);
      result = await runtime.congregationSettings.save(request, { expectedVersion: body.expectedVersion, settings: body.settings, mutationId: body.mutationId });
    }
    if (Buffer.byteLength(JSON.stringify(result)) > 64 * 1024) throw new Error("Settings unavailable");
    return privateJson(result as JsonValue, (result as { ok?: unknown }).ok === true ? 200 : 409);
  } catch (error) { return errorResponse(error); }
}
