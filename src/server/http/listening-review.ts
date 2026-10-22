import "server-only";
import type { HttpRuntime } from "../runtime/composition";
import { readJsonBody } from "./body";
import { closedObject, uniqueQuery } from "./query";
import { requireCookieMutation } from "./mutations";
import { errorResponse, HttpBoundaryError, privateJson, type JsonValue } from "./responses";
import { studyPageView } from "./portal";
import { AccessDenied } from "../access/errors";

// Admin-only listening review (Daniel, 2026-10-22). No student route reads these, and these never serve audio bytes.
const OVERVIEW = "/api/admin/listening-review", VERDICTS = "/api/admin/listening-review/verdicts";
const ITEM = /^\/api\/admin\/listening-review\/items\/([a-z]{2}-[a-z0-9-]{1,60})$/;
export function listeningReviewRouteMethods(pathname: string): readonly string[] | null {
  if (pathname === OVERVIEW) return ["GET"];
  if (pathname === VERDICTS) return ["POST"];
  if (pathname.startsWith(`${OVERVIEW}/items/`)) return ["GET"];
  return null;
}
export async function handleListeningReviewRequest(request: Request, runtime: HttpRuntime): Promise<Response | null> {
  const pathname = new URL(request.url).pathname, methods = listeningReviewRouteMethods(pathname); if (!methods) return null;
  try {
    if (!methods.includes(request.method)) { const response = errorResponse(new HttpBoundaryError(405)); response.headers.set("allow", methods.join(", ")); return response; }
    if (request.headers.has("X-Practice-Context")) throw new AccessDenied(403);
    uniqueQuery(request.url, []);
    let result: unknown, status: 200 | 409 = 200;
    if (pathname === OVERVIEW) result = { ok: true, overview: await runtime.listeningReview.overview(request) };
    else if (pathname === VERDICTS) {
      requireCookieMutation(request, runtime.origin);
      const body = closedObject(await readJsonBody(request), ["itemId", "verdict", "asset", "mutationId"], ["reasons", "note", "latencyMs"]);
      result = await runtime.listeningReview.record(request, body); if ((result as { ok?: unknown }).ok !== true) status = 409;
    } else {
      const match = ITEM.exec(pathname); if (!match) throw new HttpBoundaryError(404);
      const value = await runtime.listeningReview.item(request, match[1]);
      result = { ok: true, item: value.item, page: studyPageView(value.page), reference: value.reference as unknown as JsonValue };
    }
    if (Buffer.byteLength(JSON.stringify(result)) > 512 * 1024) throw new Error("Listening review unavailable");
    return privateJson(result as JsonValue, status);
  } catch (error) { return errorResponse(error); }
}
