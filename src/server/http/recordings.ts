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
export function recordingsRouteMethods(pathname: string): readonly string[] | null {
  const found = route(pathname); return found ? found.action ? ["POST"] : ["GET"] : null;
}
export async function handleRecordingsRequest(request: Request, runtime: HttpRuntime): Promise<Response | null> {
  const found = route(new URL(request.url).pathname); if (!found) return null;
  try {
    const methods = recordingsRouteMethods(new URL(request.url).pathname)!;
    if (!methods.includes(request.method)) { const response = errorResponse(new HttpBoundaryError(405)); response.headers.set("allow", methods.join(", ")); return response; }
    const query = uniqueQuery(request.url, found.action ? [] : ["mode", "afterId"]);
    let result;
    if (!found.action) {
      result = await runtime.recordings.page(request, validate.selection({ mode: query.get("mode"), studentId: found.studentId }), query.has("afterId") ? validate.recordingId(query.get("afterId")) : undefined);
    } else {
      requireCookieMutation(request, runtime.origin);
      const row = closedObject(await readJsonBody(request), ["mode", "expectedRevision"]), selection = validate.selection({ mode: row.mode, studentId: found.studentId });
      const write = validate.write({ recordingId: found.recordingId, expectedRevision: row.expectedRevision });
      result = found.action === "submit" ? await runtime.recordings.submit(request, selection, write) : await runtime.recordings.remove(request, selection, write);
    }
    return privateJson(result as unknown as JsonValue, result.ok ? 200 : 409);
  } catch (error) { return errorResponse(error); }
}
