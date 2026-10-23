import "server-only";
import type { HttpRuntime } from "../runtime/composition";
import { readJsonBody } from "./body";
import { requireCookieMutation } from "./mutations";
import { uniqueQuery } from "./query";
import { errorResponse, HttpBoundaryError, privateJson, type JsonValue } from "./responses";

/**
 * A member's own Learn to lein progress (plan, slice 3). Never under /api/public/ (that runtime has no
 * auth) and never cacheable: every response is `private, no-store`. Bodies are closed objects, checked in
 * src/server/course-progress/validation.ts.
 */
const routes = { "/api/learn/progress": ["GET"], "/api/learn/progress/put": ["POST"], "/api/learn/progress/merge": ["POST"] } as const;
type Path = keyof typeof routes;
export function courseProgressRouteMethods(pathname: string): readonly string[] | null {
  return Object.hasOwn(routes, pathname) ? routes[pathname as Path] : null;
}
export async function handleCourseProgressRequest(request: Request, runtime: HttpRuntime): Promise<Response | null> {
  const pathname = new URL(request.url).pathname, methods = courseProgressRouteMethods(pathname);
  if (!methods) return null;
  try {
    if (!methods.includes(request.method)) { const response = errorResponse(new HttpBoundaryError(405)); response.headers.set("allow", methods.join(", ")); return response; }
    uniqueQuery(request.url, []);
    const service = runtime.courseProgress;
    let result: { ok: boolean; code?: string };
    if (request.method === "GET") result = await service.get(request);
    else {
      requireCookieMutation(request, runtime.origin);
      const body = await readJsonBody(request, "progress");
      result = pathname === "/api/learn/progress/put" ? await service.put(request, body) : await service.merge(request, body);
    }
    return privateJson(result as unknown as JsonValue, result.ok ? 200 : 409);
  } catch (error) { return errorResponse(error); }
}
