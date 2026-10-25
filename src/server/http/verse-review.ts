import "server-only";
import type { HttpRuntime } from "../runtime/composition";
import { readJsonBody } from "./body";
import { requireCookieMutation } from "./mutations";
import { uniqueQuery } from "./query";
import { errorResponse, HttpBoundaryError, privateJson, type JsonValue } from "./responses";

/**
 * A student's own verse review cards (1.9 N19). Never under /api/public/ (that runtime has no auth) and never cacheable:
 * every response is `private, no-store`. Bodies are closed objects, checked in src/server/verse-review/validation.ts.
 */
const routes = { "/api/learn/verses": ["GET"], "/api/learn/verses/put": ["POST"] } as const;
type Path = keyof typeof routes;
export function verseReviewRouteMethods(pathname: string): readonly string[] | null {
  return Object.hasOwn(routes, pathname) ? routes[pathname as Path] : null;
}
export async function handleVerseReviewRequest(request: Request, runtime: HttpRuntime): Promise<Response | null> {
  const pathname = new URL(request.url).pathname, methods = verseReviewRouteMethods(pathname);
  if (!methods) return null;
  try {
    if (!methods.includes(request.method)) { const response = errorResponse(new HttpBoundaryError(405)); response.headers.set("allow", methods.join(", ")); return response; }
    uniqueQuery(request.url, []);
    const service = runtime.verseReview;
    let result: { ok: boolean };
    if (request.method === "GET") result = await service.get(request);
    else {
      requireCookieMutation(request, runtime.origin);
      result = await service.put(request, await readJsonBody(request, "progress"));
    }
    return privateJson(result as unknown as JsonValue, result.ok ? 200 : 409);
  } catch (error) { return errorResponse(error); }
}
