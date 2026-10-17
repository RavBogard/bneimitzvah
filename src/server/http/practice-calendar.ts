import "server-only";
import type { HttpRuntime } from "../runtime/composition";
import * as validate from "../practice-calendar/validation";
import { readJsonBody } from "./body";
import { closedObject, uniqueQuery } from "./query";
import { errorResponse, HttpBoundaryError, privateJson, type JsonValue } from "./responses";
import { requireCookieMutation } from "./mutations";

function route(pathname: string) {
  const match = /^\/api\/students\/([^/]+)\/(practice-calendar|practice-events)$/.exec(pathname);
  return match ? { studentId: match[1], calendar: match[2] === "practice-calendar" } : null;
}
export function practiceCalendarRouteMethods(pathname: string): readonly string[] | null {
  const found = route(pathname); return found ? found.calendar ? ["GET"] : ["GET", "POST"] : null;
}
export async function handlePracticeCalendarRequest(request: Request, runtime: HttpRuntime): Promise<Response | null> {
  const found = route(new URL(request.url).pathname); if (!found) return null;
  try {
    const methods = practiceCalendarRouteMethods(new URL(request.url).pathname)!;
    if (!methods.includes(request.method)) { const response = errorResponse(new HttpBoundaryError(405)); response.headers.set("allow", methods.join(", ")); return response; }
    const mutation = request.method === "POST", query = uniqueQuery(request.url, mutation ? [] : found.calendar ? ["mode", "fromDate", "throughDate"] : ["mode", "beforeReceivedAt", "beforeId"]);
    let result;
    if (mutation) {
      requireCookieMutation(request, runtime.origin);
      const row = closedObject(await readJsonBody(request), ["mode", "eventId", "expectedDay", "action", "target"]);
      result = await runtime.practiceCalendar.record(request, validate.selection({ mode: row.mode, studentId: found.studentId }), validate.write({ eventId: row.eventId, expectedDay: row.expectedDay, action: row.action, target: row.target }));
    } else {
      const selection = validate.selection({ mode: query.get("mode"), studentId: found.studentId });
      if (found.calendar) result = await runtime.practiceCalendar.calendar(request, selection, validate.window({ fromDate: query.get("fromDate"), throughDate: query.get("throughDate") }));
      else {
        if (query.has("beforeReceivedAt") !== query.has("beforeId")) throw new HttpBoundaryError();
        result = await runtime.practiceCalendar.events(request, selection, query.has("beforeReceivedAt") ? validate.cursor({ receivedAt: query.get("beforeReceivedAt"), eventId: query.get("beforeId") }) : undefined);
      }
    }
    if (Buffer.byteLength(JSON.stringify(result)) > 128 * 1024) throw new Error("Practice unavailable");
    return privateJson(result as unknown as JsonValue, result.ok ? 200 : 409);
  } catch (error) { return errorResponse(error); }
}
