import "server-only";
import type { HttpRuntime } from "../runtime/composition";
import * as validate from "../recordings/validation";
import { readJsonBody } from "./body";
import { closedObject, uniqueQuery } from "./query";
import { errorResponse, HttpBoundaryError, privateJson, type JsonValue } from "./responses";
import { requireCookieMutation } from "./mutations";

function route(pathname: string) {
  const match = /^\/api\/students\/([^/]+)\/recordings(?:\/([^/]+)\/(submit|delete))?$/.exec(pathname);
  return match ? { studentId: match[1], recordingId: match[2], action: match[3] as "submit" | "delete" | undefined } : null;
}
const methodsOf = (found: NonNullable<ReturnType<typeof route>>): readonly string[] => found.action ? ["POST"] : ["GET"];
// Student recordings are parked (MISSION): while runtime.recordings is null (PORTAL_RECORDINGS_ENABLED unset or
// false) every recordings path is a 404 for every method, so a parked deployment does not reveal the routes.
const ANY = Object.freeze(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);
export function recordingsRouteMethods(pathname: string): readonly string[] | null {
  return route(pathname) ? ANY : null;
}
export async function handleRecordingsRequest(request: Request, runtime: HttpRuntime): Promise<Response | null> {
  const found = route(new URL(request.url).pathname); if (!found) return null;
  const recordings = runtime.recordings;
  if (!recordings) return errorResponse(new HttpBoundaryError(404));
  try {
    const methods = methodsOf(found);
    if (!methods.includes(request.method)) { const response = errorResponse(new HttpBoundaryError(405)); response.headers.set("allow", methods.join(", ")); return response; }
    const query = uniqueQuery(request.url, found.action ? [] : ["mode", "afterId"]);
    let result;
    if (!found.action) {
      result = await recordings.page(request, validate.selection({ mode: query.get("mode"), studentId: found.studentId }), query.has("afterId") ? validate.recordingId(query.get("afterId")) : undefined);
    } else {
      requireCookieMutation(request, runtime.origin);
      const row = closedObject(await readJsonBody(request), ["mode", "expectedRevision"]), selection = validate.selection({ mode: row.mode, studentId: found.studentId });
      const write = validate.write({ recordingId: found.recordingId, expectedRevision: row.expectedRevision });
      result = found.action === "submit" ? await recordings.submit(request, selection, write) : await recordings.remove(request, selection, write);
    }
    return privateJson(result as unknown as JsonValue, result.ok ? 200 : 409);
  } catch (error) { return errorResponse(error); }
}
