import "server-only";
import type { HttpRuntime } from "../runtime/composition";
import { readJsonBody } from "./body";
import { requireCookieMutation } from "./mutations";
import { uniqueQuery } from "./query";
import { errorResponse, HttpBoundaryError, privateJson, type JsonValue } from "./responses";

/**
 * A member's own saved layer (accounts plan §2a). Never under /api/public/ (that runtime has no auth)
 * and never cacheable: every response is `private, no-store`. Bodies are closed objects, checked in
 * src/server/saved/validation.ts.
 */
const routes = {
  "/api/saved/readings": ["GET"], "/api/saved/readings/create": ["POST"], "/api/saved/readings/update": ["POST"], "/api/saved/readings/remove": ["POST"],
  "/api/saved/reading": ["GET"], "/api/saved/work": ["POST"], "/api/saved/mark": ["POST"], "/api/saved/stars": ["GET"], "/api/saved/star": ["POST"],
  // Release 1.7 M3b: the member's own preferred commentaries and reading settings.
  "/api/saved/preferences": ["GET"], "/api/saved/preferences/put": ["POST"],
} as const;
type Path = keyof typeof routes;
export function savedRouteMethods(pathname: string): readonly string[] | null {
  return Object.hasOwn(routes, pathname) ? routes[pathname as Path] : null;
}
function offset(value: string | null) {
  if (value === null) return 0;
  if (!/^(0|[1-9][0-9]{0,3})$/.test(value)) throw new HttpBoundaryError();
  return Number(value);
}
export async function handleSavedRequest(request: Request, runtime: HttpRuntime): Promise<Response | null> {
  const pathname = new URL(request.url).pathname, methods = savedRouteMethods(pathname);
  if (!methods) return null;
  try {
    if (!methods.includes(request.method)) { const response = errorResponse(new HttpBoundaryError(405)); response.headers.set("allow", methods.join(", ")); return response; }
    const path = pathname as Path, saved = runtime.saved;
    let result: { ok: boolean; code?: string };
    if (request.method === "GET") {
      if (path === "/api/saved/reading") {
        const query = uniqueQuery(request.url, ["id", "offset"]);
        result = await saved.reading(request, query.get("id"), offset(query.get("offset")));
      } else {
        uniqueQuery(request.url, []);
        result = path === "/api/saved/stars" ? await saved.stars(request) : path === "/api/saved/preferences" ? await saved.preferences(request) : await saved.list(request);
      }
    } else {
      uniqueQuery(request.url, []);
      requireCookieMutation(request, runtime.origin);
      const body = await readJsonBody(request, path === "/api/saved/work" ? "work" : "ordinary");
      result = path === "/api/saved/readings/create" ? await saved.create(request, body)
        : path === "/api/saved/readings/update" ? await saved.update(request, body)
        : path === "/api/saved/readings/remove" ? await saved.remove(request, body)
        : path === "/api/saved/work" ? await saved.work(request, body)
        : path === "/api/saved/mark" ? await saved.mark(request, body)
        : path === "/api/saved/preferences/put" ? await saved.putPreferences(request, body)
        : await saved.star(request, body);
    }
    return privateJson(result as unknown as JsonValue, result.ok ? 200 : result.code === "invalid-request" ? 400 : 409);
  } catch (error) { return errorResponse(error); }
}
