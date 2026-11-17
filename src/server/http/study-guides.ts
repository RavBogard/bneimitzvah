import "server-only";
import type { HttpRuntime } from "../runtime/composition";
import { uniqueQuery } from "./query";
import { errorResponse, HttpBoundaryError, privateJson, type JsonValue } from "./responses";

// Web routes for study guides. Guide and voice bodies are never written from the web (S10):
// those writes arrive only through the portal MCP. The web reads the student view and shows the
// rabbi status and held drafts. The "I read this" theme tick was retired (Study v6, Daniel 2026-10-28),
// and its route with it: a POST to .../study-guide/theme-read is now an unknown route (404).
type Found =
  | { route: "student"; studentId: string }
  | { route: "admin-guide"; kind: string; readingKey: string } | { route: "admin-voice" };
function route(pathname: string): Found | null {
  let m = /^\/api\/students\/([^/]+)\/study-guide$/.exec(pathname); if (m) return { route: "student", studentId: m[1] };
  m = /^\/api\/admin\/study-guides\/(torah|haftarah)\/([a-z0-9-]{1,160})$/.exec(pathname); if (m) return { route: "admin-guide", kind: m[1], readingKey: m[2] };
  if (pathname === "/api/admin/study-voice") return { route: "admin-voice" };
  return null;
}
export function studyGuidesRouteMethods(pathname: string): readonly string[] | null {
  const found = route(pathname); return found ? ["GET"] : null;
}
const MODES = ["student", "parent", "tutor", "admin", "child-practice"] as const;
function mode(value: unknown): (typeof MODES)[number] {
  if (typeof value !== "string" || !(MODES as readonly string[]).includes(value)) throw new HttpBoundaryError();
  return value as (typeof MODES)[number];
}
export async function handleStudyGuidesRequest(request: Request, runtime: HttpRuntime): Promise<Response | null> {
  const pathname = new URL(request.url).pathname, found = route(pathname); if (!found) return null;
  try {
    let result: unknown;
    if (found.route === "student") {
      const query = uniqueQuery(request.url, ["mode", "kind"]), selection = { mode: mode(query.get("mode")), studentId: found.studentId, kind: query.get("kind") };
      const view = await runtime.studyGuides.studentGuide(request, selection);
      // The haftarah card also links that week's public study sheet; the lookup runs after the authorized read, outside it.
      result = selection.kind === "haftarah" ? { ok: true, view, sheet: await runtime.haftarahSheets.sheetFor(await runtime.studyGuides.readingDate(request, selection)) } : { ok: true, view };
    } else if (found.route === "admin-guide") {
      uniqueQuery(request.url, []);
      result = { ok: true, guide: await runtime.studyGuides.staffGuide(request, { kind: found.kind, readingKey: found.readingKey }) };
    } else {
      uniqueQuery(request.url, []);
      result = { ok: true, voice: await runtime.studyGuides.staffVoice(request) };
    }
    if (Buffer.byteLength(JSON.stringify(result)) > 320 * 1024) throw new Error("Study guide unavailable");
    const ok = (result as { ok?: unknown }).ok === true;
    return privateJson(result as JsonValue, ok ? 200 : 409);
  } catch (error) { return errorResponse(error); }
}
