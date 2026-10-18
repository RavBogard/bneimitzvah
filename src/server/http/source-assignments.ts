import "server-only";
import type { HttpRuntime } from "../runtime/composition";
import * as validate from "../study/source-assignments-validation";
import { readJsonBody } from "./body";
import { closedObject, uniqueQuery } from "./query";
import { requireCookieMutation } from "./mutations";
import { errorResponse, HttpBoundaryError, privateJson, type JsonValue } from "./responses";
const binding = ["mode", "kind", "assignmentId", "assignmentRevision"];
function route(path: string) { const found = /^\/api\/students\/([^/]+)\/source-assignments(?:\/(receipt))?$/.exec(path); return found ? { studentId: found[1], receipt: !!found[2] } : null; }
export function sourceAssignmentsRouteMethods(path: string): readonly string[] | null { const found = route(path); return found ? found.receipt ? ["POST"] : ["GET", "POST"] : null; }
export async function handleSourceAssignmentsRequest(request: Request, runtime: HttpRuntime): Promise<Response | null> {
  const found = route(new URL(request.url).pathname); if (!found) return null;
  try {
    if (!sourceAssignmentsRouteMethods(new URL(request.url).pathname)!.includes(request.method)) { const response = errorResponse(new HttpBoundaryError(405)); response.headers.set("allow", sourceAssignmentsRouteMethods(new URL(request.url).pathname)!.join(", ")); return response; }
    let result;
    if (request.method === "GET") {
      if (request.body !== null || request.headers.has("transfer-encoding") || request.headers.has("content-length") && request.headers.get("content-length") !== "0") throw new HttpBoundaryError();
      const query = uniqueQuery(request.url, [...binding, "verseRef"]), revision = query.get("assignmentRevision");
      if (!revision || !/^[1-9][0-9]{0,9}$/.test(revision)) throw new HttpBoundaryError();
      const selection = validate.selection({ studentId: found.studentId, ...Object.fromEntries(binding.map(key => [key, key === "assignmentRevision" ? Number(revision) : query.get(key)])) });
      result = await runtime.sourceAssignments.read(request, selection, validate.verse(query.get("verseRef")));
    } else {
      uniqueQuery(request.url, []); requireCookieMutation(request, runtime.origin);
      const body = closedObject(await readJsonBody(request, "ordinary"), [...binding, "verseRef", "expectedVersion", "mutationId", "sourceIds"], ["catalogHash"]);
      const selection = validate.selection({ studentId: found.studentId, ...Object.fromEntries(binding.map(key => [key, body[key]])) });
      const write = validate.intent(Object.fromEntries(["verseRef", "expectedVersion", "mutationId", "sourceIds", ...(Object.hasOwn(body, "catalogHash") ? ["catalogHash"] : [])].map(key => [key, body[key]])));
      result = found.receipt ? await runtime.sourceAssignments.receipt(request, selection, write) : await runtime.sourceAssignments.replace(request, selection, write);
    }
    // All service results are already closed; keep an independent complete-body cap.
    if (Buffer.byteLength(JSON.stringify(result)) > 128 * 1024) throw new Error("Source assignments unavailable");
    return privateJson(result as JsonValue, result.ok ? 200 : result.code === "invalid-request" ? 400 : 409);
  } catch (error) { return errorResponse(error); }
}
