import "server-only";
import type { HttpRuntime } from "../runtime/composition";
import * as validate from "../honors/validation";
import { readJsonBody } from "./body";
import { closedObject, uniqueQuery } from "./query";
import { requireCookieMutation } from "./mutations";
import { errorResponse, HttpBoundaryError, privateJson, type JsonValue } from "./responses";
function route(path: string) { const match = /^\/api\/students\/([^/]+)\/honors(?:\/(receipt))?$/.exec(path); return match ? { studentId: match[1], receipt: !!match[2] } : null; }
export function honorsRouteMethods(path: string): readonly string[] | null { const found = route(path); return found ? found.receipt ? ["POST"] : ["GET", "POST"] : null; }
export async function handleHonorsRequest(request: Request, runtime: HttpRuntime): Promise<Response | null> {
  const found = route(new URL(request.url).pathname); if (!found) return null;
  try {
    const methods = honorsRouteMethods(new URL(request.url).pathname)!;
    if (!methods.includes(request.method)) { const response = errorResponse(new HttpBoundaryError(405)); response.headers.set("allow", methods.join(", ")); return response; }
    let result;
    if (request.method === "GET") {
      if (request.body !== null || request.headers.has("transfer-encoding") || request.headers.has("content-length") && request.headers.get("content-length") !== "0") throw new HttpBoundaryError();
      const query = uniqueQuery(request.url, ["mode"]);
      result = await runtime.honors.read(request, validate.selection({ studentId: found.studentId, mode: query.get("mode") }));
    } else {
      uniqueQuery(request.url, []); requireCookieMutation(request, runtime.origin);
      // 64KiB form plus bounded intent envelope; the validator separately caps the form.
      const body = closedObject(await readJsonBody(request, "honors"), ["mode", "expectedVersion", "mutationId", "contextHash", "form"]);
      const selected = validate.selection({ studentId: found.studentId, mode: body.mode }), write = validate.intent({ expectedVersion: body.expectedVersion, mutationId: body.mutationId, contextHash: body.contextHash, form: body.form });
      result = found.receipt ? await runtime.honors.receipt(request, selected, write) : await runtime.honors.replace(request, selected, write);
    }
    if (Buffer.byteLength(JSON.stringify(result)) > validate.LIMITS.responseBytes) throw new Error("Honors unavailable");
    return privateJson(result as JsonValue, result.ok ? 200 : result.code === "invalid-request" ? 400 : 409);
  } catch (error) { return errorResponse(error); }
}
