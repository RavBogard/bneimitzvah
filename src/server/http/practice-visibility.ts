import "server-only";
import type { HttpRuntime } from "../runtime/composition";
import { uniqueQuery } from "./query";
import { errorResponse, HttpBoundaryError, privateJson, type JsonValue } from "./responses";

/**
 * 1.9 N23 (decision 7): `GET /api/students/{id}/practice-visibility?mode=tutor|parent`, the one route of practice visibility.
 * mode=tutor is the assigned tutor's view; mode=parent is a linked parent's counts. Every other mode (admin, student,
 * child-practice) is refused at the boundary, as is a practice context. Never under /api/public/ and never cacheable (privateJson
 * is `private, no-store`). No body; the only query is the mode. The answer is copied field by field, so nothing the service did
 * not choose to show can ride along.
 */
function route(path: string) {
  const match = /^\/api\/students\/([^/]+)\/practice-visibility$/.exec(path);
  return match ? { studentId: match[1] } : null;
}
export function practiceVisibilityRouteMethods(path: string): readonly string[] | null {
  return route(path) ? ["GET"] : null;
}
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export async function handlePracticeVisibilityRequest(request: Request, runtime: HttpRuntime): Promise<Response | null> {
  const found = route(new URL(request.url).pathname); if (!found) return null;
  try {
    if (request.method !== "GET") { const response = errorResponse(new HttpBoundaryError(405)); response.headers.set("allow", "GET"); return response; }
    const query = uniqueQuery(request.url, ["mode"]), mode = query.get("mode");
    if (mode !== "tutor" && mode !== "parent") throw new HttpBoundaryError();
    if (!UUID.test(found.studentId)) throw new HttpBoundaryError();
    if (request.headers.has("X-Practice-Context")) throw new HttpBoundaryError();
    if (mode === "parent") {
      const counts = await runtime.practiceVisibility.parent(request, { mode, studentId: found.studentId });
      return privateJson({ gotIt: counts.gotIt, working: counts.working });
    }
    const view = await runtime.practiceVisibility.tutor(request, { mode, studentId: found.studentId });
    const output: JsonValue = {
      from: view.from, today: view.today,
      days: view.days.map((day): JsonValue => ({ day: day.day, readings: day.readings.map((reading): JsonValue => ({ kind: reading.kind,
        opened: [...reading.opened], marked: reading.marked.map((mark): JsonValue => ({ verseRef: mark.verseRef, state: mark.state })) })) })),
      marks: view.marks.map((mark): JsonValue => ({ kind: mark.kind, verseRef: mark.verseRef, state: mark.state, withParent: mark.withParent })),
      practisedDays: view.practisedDays, lastLesson: view.lastLesson, stillWorking: view.stillWorking,
      learn: view.learn ? { torah: { heard: view.learn.torah.heard, of: view.learn.torah.of }, haftarah: { heard: view.learn.haftarah.heard, of: view.learn.haftarah.of },
        mixedUp: view.learn.mixedUp ? [view.learn.mixedUp[0], view.learn.mixedUp[1]] : null } : null,
    };
    return privateJson(output);
  } catch (error) { return errorResponse(error); }
}
