import "server-only";
import type { HttpRuntime } from "../runtime/composition";
import { createBookletService } from "../booklet/service";
import { uniqueQuery } from "./query";
import { errorResponse, HttpBoundaryError, privateJson } from "./responses";

// The study booklet's one route (B2): which mode the booklet reads through, and the cover's tutor line. Never under /api/public/.
const BOOKLET = /^\/api\/students\/([^/]+)\/booklet$/;
export function bookletRouteMethods(pathname: string): readonly string[] | null { return BOOKLET.test(pathname) ? ["GET"] : null; }

export async function handleBookletRequest(request: Request, runtime: Pick<HttpRuntime, "access">): Promise<Response | null> {
  const match = BOOKLET.exec(new URL(request.url).pathname);
  if (!match) return null;
  try {
    if (request.method !== "GET") { const response = errorResponse(new HttpBoundaryError(405)); response.headers.set("allow", "GET"); return response; }
    uniqueQuery(request.url, []);
    // A child-practice handle never opens the booklet: the same 404 as everyone the rule refuses.
    if (request.headers.has("X-Practice-Context")) throw new HttpBoundaryError(404);
    const opened = await createBookletService({ access: runtime.access }).open(request, match[1]);
    return privateJson({ ok: true, mode: opened.mode, tutor: opened.tutor });
  } catch (error) { return errorResponse(error); }
}
