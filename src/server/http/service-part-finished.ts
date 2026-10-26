import "server-only";
import type { HttpRuntime } from "../runtime/composition";
import { uniqueQuery } from "./query";
import { errorResponse, HttpBoundaryError, privateJson, type JsonValue } from "./responses";

/**
 * The per-part finished mark for a student's tutor or an admin (2.0 SC5, A4 9, W13): `GET /api/students/{id}/service-finished?mode=`,
 * tutor and admin modes only. Never under /api/public/ and never cacheable (privateJson is `private, no-store`). No body; the
 * only query is the mode. A practice context is refused. The answer is copied field by field: each part's lesson id and the day
 * it was finished, or null.
 */
function route(path: string) {
  const match = /^\/api\/students\/([^/]+)\/service-finished$/.exec(path);
  return match ? { studentId: match[1] } : null;
}
export function servicePartFinishedRouteMethods(path: string): readonly string[] | null {
  return route(path) ? ["GET"] : null;
}
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export async function handleServicePartFinishedRequest(request: Request, runtime: HttpRuntime): Promise<Response | null> {
  const found = route(new URL(request.url).pathname); if (!found) return null;
  try {
    if (request.method !== "GET") { const response = errorResponse(new HttpBoundaryError(405)); response.headers.set("allow", "GET"); return response; }
    const query = uniqueQuery(request.url, ["mode"]), mode = query.get("mode");
    if (mode !== "tutor" && mode !== "admin") throw new HttpBoundaryError();
    if (!UUID.test(found.studentId)) throw new HttpBoundaryError();
    if (request.headers.has("X-Practice-Context")) throw new HttpBoundaryError();
    const result = await runtime.servicePartFinished.read(request, { mode, studentId: found.studentId });
    const output: JsonValue = { parts: result.parts.map((part): JsonValue => ({ lesson: part.lesson, finished: part.finished })) };
    return privateJson(output);
  } catch (error) { return errorResponse(error); }
}
