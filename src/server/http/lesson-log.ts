import "server-only";
import type { HttpRuntime } from "../runtime/composition";
import * as validate from "../lesson-log/validation";
import { readJsonBody } from "./body";
import { closedObject, uniqueQuery } from "./query";
import { errorResponse, HttpBoundaryError, privateJson, type JsonValue } from "./responses";
import { requireCookieMutation } from "./mutations";

function route(pathname: string) {
  const match = /^\/api\/students\/([^/]+)\/lesson-log(?:\/([^/]+)\/(edit|delete))?$/.exec(pathname);
  return match ? { studentId: match[1], entryId: match[2], action: match[3] as "edit" | "delete" | undefined } : null;
}
export function lessonLogRouteMethods(pathname: string): readonly string[] | null {
  const found = route(pathname); return found ? found.action ? ["POST"] : ["GET", "POST"] : null;
}
export async function handleLessonLogRequest(request: Request, runtime: HttpRuntime): Promise<Response | null> {
  const found = route(new URL(request.url).pathname); if (!found) return null;
  try {
    const methods = lessonLogRouteMethods(new URL(request.url).pathname)!;
    if (!methods.includes(request.method)) { const response = errorResponse(new HttpBoundaryError(405)); response.headers.set("allow", methods.join(", ")); return response; }
    const read = request.method === "GET", query = uniqueQuery(request.url, read ? ["mode", "beforeDate", "beforeId"] : []);
    let result;
    if (read) {
      if (query.has("beforeDate") !== query.has("beforeId")) throw new HttpBoundaryError();
      result = await runtime.lessonLog.page(request, validate.selection({ mode: query.get("mode"), studentId: found.studentId }),
        query.has("beforeDate") ? validate.cursor({ lessonDate: query.get("beforeDate"), entryId: query.get("beforeId") }) : undefined);
    } else {
      requireCookieMutation(request, runtime.origin);
      const fields = found.action === "delete" ? ["mode", "expectedVersion"] : found.action === "edit" ? ["mode", "expectedVersion", "lessonDate", "summary"] : ["mode", "entryId", "lessonDate", "summary"];
      const row = closedObject(await readJsonBody(request), fields, found.action === "delete" ? [] : ["beforeNext"]), selection = validate.selection({ mode: row.mode, studentId: found.studentId });
      result = found.action === "delete" ? await runtime.lessonLog.remove(request, selection, validate.remove({ entryId: found.entryId, expectedVersion: row.expectedVersion }))
        : found.action === "edit" ? await runtime.lessonLog.edit(request, selection, validate.edit({ entryId: found.entryId, expectedVersion: row.expectedVersion, lessonDate: row.lessonDate, summary: row.summary, ...("beforeNext" in row ? { beforeNext: row.beforeNext } : {}) }))
        : await runtime.lessonLog.create(request, selection, validate.create({ entryId: row.entryId, lessonDate: row.lessonDate, summary: row.summary, ...("beforeNext" in row ? { beforeNext: row.beforeNext } : {}) }));
    }
    if (Buffer.byteLength(JSON.stringify(result)) > 512 * 1024) throw new Error("Lesson unavailable");
    return privateJson(result as unknown as JsonValue, result.ok ? 200 : 409);
  } catch (error) { return errorResponse(error); }
}
