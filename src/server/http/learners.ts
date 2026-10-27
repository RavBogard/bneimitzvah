import "server-only";
import type { HttpRuntime } from "../runtime/composition";
import { readJsonBody } from "./body";
import { requireCookieMutation } from "./mutations";
import { closedObject, uniqueQuery } from "./query";
import { errorResponse, HttpBoundaryError, privateJson, type JsonValue } from "./responses";

/**
 * Readings for everyone (plan D5): the learner directory and claims for tutors and admins, and the learner's own tutor line.
 * Never under /api/public/ and never cacheable: every response is `private, no-store`. Bodies are closed objects.
 */
const routes = {
  "/api/learners": ["GET"], "/api/learners/claim": ["POST"], "/api/learners/unclaim": ["POST"],
  "/api/mine/tutor": ["GET"], "/api/mine/tutor/remove": ["POST"],
} as const;
type Path = keyof typeof routes;
export function learnersRouteMethods(pathname: string): readonly string[] | null {
  return Object.hasOwn(routes, pathname) ? routes[pathname as Path] : null;
}
export async function handleLearnersRequest(request: Request, runtime: HttpRuntime): Promise<Response | null> {
  const pathname = new URL(request.url).pathname, methods = learnersRouteMethods(pathname);
  if (!methods) return null;
  try {
    if (!methods.includes(request.method)) { const response = errorResponse(new HttpBoundaryError(405)); response.headers.set("allow", methods.join(", ")); return response; }
    const path = pathname as Path, learners = runtime.learners;
    let result: { ok: boolean; code?: string };
    if (request.method === "GET") {
      if (path === "/api/learners") {
        const query = uniqueQuery(request.url, ["q", "after"]);
        result = await learners.list(request, { q: query.get("q"), after: query.get("after") });
      } else { uniqueQuery(request.url, []); result = await learners.myTutor(request); }
    } else {
      uniqueQuery(request.url, []);
      requireCookieMutation(request, runtime.origin);
      const body = await readJsonBody(request);
      if (path === "/api/mine/tutor/remove") { closedObject(body, []); result = await learners.removeMyTutor(request); }
      else result = path === "/api/learners/claim" ? await learners.claim(request, body) : await learners.unclaim(request, body);
    }
    return privateJson(result as unknown as JsonValue, result.ok ? 200 : 409);
  } catch (error) { return errorResponse(error); }
}
