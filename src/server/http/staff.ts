import "server-only";
import type { HttpRuntime } from "../runtime/composition";
import type { ActiveMode } from "../access/types";
import { readJsonBody } from "./body";
import { requireCookieMutation } from "./mutations";
import { closedObject, uniqueQuery } from "./query";
import { errorResponse, HttpBoundaryError, privateJson } from "./responses";

/**
 * Release 1.9 N14/N15 staff-screen routes (src/server/staff/service.ts). Kept apart from portal.ts so the routes stay small and
 * closed. Every response is private and no-store (privateJson); bodies and queries are closed.
 */
type Route = { kind: "status" | "teaching" | "hand-over" | "family" | "reconfirm"; methods: readonly string[]; id?: string };
function route(pathname: string): Route | null {
  if (pathname === "/api/admin/student-status") return { kind: "status", methods: ["GET"] };
  if (pathname === "/api/admin/tutor-students") return { kind: "teaching", methods: ["GET"] };
  const handOver = /^\/api\/admin\/tutors\/([^/]+)\/hand-over$/.exec(pathname);
  if (handOver) return { kind: "hand-over", methods: ["POST"], id: handOver[1] };
  const family = /^\/api\/students\/([^/]+)\/family$/.exec(pathname);
  if (family) return { kind: "family", methods: ["GET"], id: family[1] };
  const reconfirm = /^\/api\/students\/([^/]+)\/reading\/reconfirm$/.exec(pathname);
  if (reconfirm) return { kind: "reconfirm", methods: ["POST"], id: reconfirm[1] };
  return null;
}
export const staffRouteMethods = (pathname: string): readonly string[] | null => route(pathname)?.methods ?? null;
function staffMode(value: unknown): ActiveMode { if (value !== "tutor" && value !== "admin") throw new HttpBoundaryError(); return value; }
const stale = () => privateJson({ ok: false, code: "stale-state" }, 409);

export async function handleStaffRequest(request: Request, runtime: HttpRuntime): Promise<Response | null> {
  const found = route(new URL(request.url).pathname); if (!found) return null;
  try {
    if (!found.methods.includes(request.method)) { const response = errorResponse(new HttpBoundaryError(405)); response.headers.set("allow", found.methods.join(", ")); return response; }
    switch (found.kind) {
      case "status": {
        uniqueQuery(request.url, []);
        const rows = await runtime.staff.status(request, { mode: "admin" });
        return privateJson({ students: rows.map(row => ({ id: row.id, tutors: row.tutors, family: row.family, reading: row.reading, honors: row.honors })) });
      }
      case "teaching": {
        uniqueQuery(request.url, []);
        const rows = await runtime.staff.teaching(request, { mode: "admin" });
        return privateJson({ tutors: rows.map(row => ({ tutorGrantId: row.tutorGrantId, students: row.students.map(student => ({ id: student.id, firstName: student.firstName, lastName: student.lastName })) })) });
      }
      case "hand-over": {
        uniqueQuery(request.url, []); requireCookieMutation(request, runtime.origin);
        const body = closedObject(await readJsonBody(request), ["expectedRevision", "toTutorGrantId", "studentIds"]);
        const value = await runtime.staff.handOver(request, { mode: "admin", tutorGrantId: found.id!, expectedRevision: body.expectedRevision as number, toTutorGrantId: body.toTutorGrantId as string, studentIds: body.studentIds });
        return value.ok ? privateJson({ ok: true, id: value.id, revision: value.revision, moved: value.moved }) : stale();
      }
      case "family": {
        const query = uniqueQuery(request.url, ["mode"]);
        const value = await runtime.staff.family(request, { mode: staffMode(query.get("mode")), studentId: found.id! });
        return privateJson({ kind: value.kind, joined: [...value.joined], invited: value.invited });
      }
      case "reconfirm": {
        uniqueQuery(request.url, []); requireCookieMutation(request, runtime.origin);
        const body = closedObject(await readJsonBody(request), ["mode", "kind", "expectedRevision"]);
        const value = await runtime.staff.reconfirm(request, { mode: staffMode(body.mode), studentId: found.id!, kind: body.kind, expectedRevision: body.expectedRevision });
        return value.ok ? privateJson({ ok: true, assignmentId: value.assignmentId, revision: value.revision }) : stale();
      }
    }
  } catch (error) { return errorResponse(error); }
}
