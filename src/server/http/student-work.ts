import "server-only";
import type { HttpRuntime } from "../runtime/composition";
import * as validate from "../student-work/validation";
import { readJsonBody } from "./body";
import { closedObject, uniqueQuery } from "./query";
import { errorResponse, HttpBoundaryError, privateJson, type JsonValue } from "./responses";
import { requireCookieMutation } from "./mutations";

function route(pathname: string) {
  const match = /^\/api\/students\/([^/]+)\/work(?:\/(history|receipt|draft|note))?$/.exec(pathname);
  return match ? { studentId: match[1], operation: match[2] ?? "page" } : null;
}
export function studentWorkRouteMethods(pathname: string): readonly string[] | null {
  const found = route(pathname);
  return found ? [found.operation === "draft" || found.operation === "note" ? "POST" : "GET"] : null;
}
const binding = ["mode", "kind", "assignmentId", "assignmentRevision"];
function number(value: unknown) {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,9})$/.test(value)) throw new HttpBoundaryError();
  return Number(value);
}
export async function handleStudentWorkRequest(request: Request, runtime: HttpRuntime): Promise<Response | null> {
  const found = route(new URL(request.url).pathname);
  if (!found) return null;
  try {
    const methods = studentWorkRouteMethods(new URL(request.url).pathname)!;
    if (!methods.includes(request.method)) {
      const response = errorResponse(new HttpBoundaryError(405)); response.headers.set("allow", methods.join(", ")); return response;
    }
    const mutation = methods[0] === "POST";
    const allowed = mutation ? [] : [...binding, ...(found.operation === "page" ? ["offset"] : ["stream", "verseRef", found.operation === "history" ? "beforeVersion" : "mutationId"])];
    const query = uniqueQuery(request.url, allowed);
    let result: unknown;
    if (mutation) {
      requireCookieMutation(request, runtime.origin);
      const body = closedObject(await readJsonBody(request, "work"), [...binding, "verseRef", "text", "expectedVersion", "mutationId"]);
      const selection = validate.selection({ studentId: found.studentId, ...Object.fromEntries(binding.map(key => [key, body[key]])) });
      result = await runtime.studentWork.append(request, selection, validate.stream(found.operation), validate.write(Object.fromEntries(["verseRef", "text", "expectedVersion", "mutationId"].map(key => [key, body[key]])), validate.stream(found.operation)));
    } else {
      const selection = validate.selection({ studentId: found.studentId, ...Object.fromEntries(binding.map(key => [key, key === "assignmentRevision" ? number(query.get(key)) : query.get(key)])) });
      if (found.operation === "page") result = await runtime.studentWork.page(request, selection, query.has("offset") ? number(query.get("offset")) : 0);
      else if (found.operation === "history") result = await runtime.studentWork.history(request, selection, validate.stream(query.get("stream")), validate.verse(query.get("verseRef")), query.has("beforeVersion") ? number(query.get("beforeVersion")) : undefined);
      else result = await runtime.studentWork.receipt(request, selection, validate.stream(query.get("stream")), validate.verse(query.get("verseRef")), validate.uuid(query.get("mutationId")));
    }
    if (Buffer.byteLength(JSON.stringify(result)) > 256 * 1024) throw new Error("Work response unavailable");
    const failure = result as { ok: boolean; code?: string };
    return privateJson(result as JsonValue, failure.ok ? 200 : failure.code === "invalid-request" ? 400 : 409);
  } catch (error) { return errorResponse(error); }
}
