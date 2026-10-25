import "server-only";
import type { HttpRuntime } from "../runtime/composition";
import { readJsonBody } from "./body";
import { requireCookieMutation } from "./mutations";
import { uniqueQuery } from "./query";
import { errorResponse, HttpBoundaryError, privateHeaders, privateJson, type JsonValue } from "./responses";
import { ServiceCourseRefused } from "../service-course/progress-access";
import type { Path } from "../../lib/service-course/path";

/**
 * A member's own progress in the service course and a student's own path through it (2.0 SC4). Never under /api/public/
 * (that runtime has no auth) and never cacheable: every response is `private, no-store`. Bodies are closed objects, checked in
 * src/server/service-course/progress-validation.ts; the path takes no query and no body.
 */
const routes = { "/api/learn/service/progress": ["GET"], "/api/learn/service/progress/put": ["POST"], "/api/learn/service/progress/merge": ["POST"], "/api/learn/service/path": ["GET"] } as const;
type Route = keyof typeof routes;
export function serviceCourseRouteMethods(pathname: string): readonly string[] | null {
  return Object.hasOwn(routes, pathname) ? routes[pathname as Route] : null;
}
/** The path as it goes on the wire: each field copied by name, so nothing a later change adds to the domain value is sent. */
function pathJson(path: Path): JsonValue {
  return { ok: true, state: path.state, slot: path.slot, review: path.review, items: path.items.map((item): JsonValue => item.page === undefined ? { lesson: item.lesson } : { lesson: item.lesson, page: item.page }),
    ...(path.serviceStart !== undefined ? { serviceStart: path.serviceStart } : {}),
    ...(path.plan ? { plan: { id: path.plan.id, revision: path.plan.revision, catalogId: path.plan.catalogId, catalogIdentity: path.plan.catalogIdentity } } : {}) };
}
export async function handleServiceCourseRequest(request: Request, runtime: HttpRuntime): Promise<Response | null> {
  const pathname = new URL(request.url).pathname, methods = serviceCourseRouteMethods(pathname);
  if (!methods) return null;
  try {
    if (!methods.includes(request.method)) { const response = errorResponse(new HttpBoundaryError(405)); response.headers.set("allow", methods.join(", ")); return response; }
    uniqueQuery(request.url, []);
    if (pathname === "/api/learn/service/path") {
      const { tenantId } = await runtime.resolveHost(request);
      return privateJson(pathJson(await runtime.serviceCoursePath.read(request, tenantId)));
    }
    const service = runtime.serviceCourseProgress;
    let result: { ok: boolean; code?: string };
    if (request.method === "GET") result = await service.get(request);
    else {
      requireCookieMutation(request, runtime.origin);
      const body = await readJsonBody(request, "progress");
      result = pathname === "/api/learn/service/progress/put" ? await service.put(request, body) : await service.merge(request, body);
    }
    return privateJson(result as unknown as JsonValue, result.ok ? 200 : 409);
  } catch (error) {
    // A verified membership without progress here: the 403 names its own owner, and only to it.
    if (error instanceof ServiceCourseRefused) {
      const headers = privateHeaders(); headers.set("content-type", "application/json; charset=utf-8");
      return new Response(JSON.stringify({ error: "forbidden", owner: error.owner }), { status: 403, headers });
    }
    return errorResponse(error);
  }
}
