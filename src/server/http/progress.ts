import "server-only";
import type { HttpRuntime } from "../runtime/composition";
import * as validate from "../progress/validation";
import { readJsonBody } from "./body";
import { closedObject, uniqueQuery } from "./query";
import { errorResponse, HttpBoundaryError, privateJson, type JsonValue } from "./responses";
import { requireCookieMutation } from "./mutations";

function route(pathname: string) {
  const match = /^\/api\/students\/([^/]+)\/progress(?:\/(self-check|assessment))?$/.exec(pathname);
  return match ? { studentId: match[1], stream: match[2] as validate.ProgressStream | undefined } : null;
}
export function progressRouteMethods(pathname: string): readonly string[] | null {
  const found = route(pathname); return found ? [found.stream ? "POST" : "GET"] : null;
}
function number(value: unknown) {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,9})$/.test(value)) throw new HttpBoundaryError();
  return Number(value);
}
export async function handleProgressRequest(request: Request, runtime: HttpRuntime): Promise<Response | null> {
  const found = route(new URL(request.url).pathname); if (!found) return null;
  try {
    const methods = progressRouteMethods(new URL(request.url).pathname)!;
    if (!methods.includes(request.method)) { const response = errorResponse(new HttpBoundaryError(405)); response.headers.set("allow", methods.join(", ")); return response; }
    const query = uniqueQuery(request.url, found.stream ? [] : [...validate.bindingKeys, "offset"]);
    let value: Record<string, unknown>;
    if (found.stream) {
      requireCookieMutation(request, runtime.origin);
      value = closedObject(await readJsonBody(request), [...validate.bindingKeys, "verseRef", "state", "expectedVersion"]);
    } else value = Object.fromEntries(validate.bindingKeys.map(key => [key, key === "assignmentRevision" ? number(query.get(key)) : query.get(key)]));
    const selection = validate.selection({ studentId: found.studentId, ...Object.fromEntries(validate.bindingKeys.map(key => [key, value[key]])) });
    const result = found.stream
      ? await runtime.progress[found.stream === "self-check" ? "setSelfCheck" : "setAssessment"](request, selection, validate.write(Object.fromEntries(["verseRef", "state", "expectedVersion"].map(key => [key, value[key]])), found.stream))
      : await runtime.progress.page(request, selection, query.has("offset") ? number(query.get("offset")) : 0);
    if (Buffer.byteLength(JSON.stringify(result)) > 128 * 1024) throw new Error("Progress unavailable");
    return privateJson(result as unknown as JsonValue, result.ok ? 200 : 409);
  } catch (error) { return errorResponse(error); }
}
