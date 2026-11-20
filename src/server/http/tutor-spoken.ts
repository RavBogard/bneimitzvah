import "server-only";
import type { HttpRuntime } from "../runtime/composition";
import { spokenSelection } from "../tutor-spoken/service";
import type { ActiveMode } from "../access/types";
import { boundedAudio, MAX_SPOKEN_BYTES, mediaType } from "../tutor-spoken/media";
import { readJsonBody } from "./body";
import { closedObject, uniqueQuery } from "./query";
import { requireCookieMutation } from "./mutations";
import { errorResponse, HttpBoundaryError, privateHeaders, privateJson, type JsonValue } from "./responses";

const binding = ["mode", "assignmentId", "assignmentRevision", "startVerse"];
function route(path: string) { const found = /^\/api\/students\/([^/]+)\/tutor-spoken(?:\/(audio|withdraw))?$/.exec(path); return found ? { studentId: found[1], audio: found[2] === "audio", withdraw: found[2] === "withdraw" } : null; }
export function tutorSpokenRouteMethods(path: string): readonly string[] | null { const found = route(path); return found ? found.audio ? ["GET"] : found.withdraw ? ["POST"] : ["GET", "POST"] : null; }
export async function handleTutorSpokenRequest(request: Request, runtime: HttpRuntime): Promise<Response | null> {
  const found = route(new URL(request.url).pathname); if (!found) return null;
  try {
    const write = request.method !== "GET";
    const query = uniqueQuery(request.url, [...binding, ...(found.audio ? ["clipId"] : write ? ["expectedClipRevision", "expectedClipId"] : [])]);
    const number = (key: string, zero = false) => { const value = query.get(key); if (!value || !(zero ? /^(0|[1-9][0-9]{0,9})$/ : /^[1-9][0-9]{0,9}$/).test(value)) throw new HttpBoundaryError(); return Number(value); };
    const selection = spokenSelection({ studentId: found.studentId, mode: query.get("mode") as ActiveMode, assignmentId: query.get("assignmentId") ?? "", assignmentRevision: number("assignmentRevision"), startVerse: query.get("startVerse") ?? "" });
    if (write) requireCookieMutation(request, runtime.origin);
    if (found.audio) {
      const result = await runtime.tutorSpoken.audio(request, selection, query.get("clipId") ?? "");
      const headers = privateHeaders(); headers.set("content-type", result.mediaType); headers.set("content-length", String(result.bytes.length)); headers.set("content-disposition", "inline");
      return new Response(Buffer.from(result.bytes), { headers });
    }
    let result;
    if (!write) result = await runtime.tutorSpoken.read(request, selection);
    else {
      const expected = { revision: number("expectedClipRevision", true), id: query.get("expectedClipId") };
      if (found.withdraw) { closedObject(await readJsonBody(request), []); result = await runtime.tutorSpoken.withdraw(request, selection, expected); }
      else {
        const length = request.headers.get("content-length");
        if (length !== null && (!/^[1-9][0-9]*$/.test(length) || Number(length) > MAX_SPOKEN_BYTES)) throw new HttpBoundaryError(413);
        if (![null, "identity"].includes(request.headers.get("content-encoding"))) throw new HttpBoundaryError(415);
        const type = mediaType(request.headers.get("content-type"));
        // Establish relationship authority before accepting the bounded upload body.
        await runtime.tutorSpoken.read(request, selection);
        const bytes = await boundedAudio(request.body, { signal: request.signal, expectedLength: length === null ? undefined : Number(length) });
        result = await runtime.tutorSpoken.replace(request, selection, expected, bytes, type);
      }
    }
    return privateJson(result as unknown as JsonValue, result.ok ? 200 : 409);
  } catch (error) { return errorResponse(error); }
}
