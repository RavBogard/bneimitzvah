import { PortalRequestError } from "../../api";
import { call, identifier } from "../api";
import type { FamilyState, StudentStatus } from "./model";

// Release 1.9 N14/N15 clients. Closed parsers: an unexpected key, an address-shaped name or a malformed id is refused whole.
const bad = (): never => { throw new PortalRequestError(503); };
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key))) return bad();
  return value as Record<string, unknown>;
}
const list = (value: unknown, max: number) => Array.isArray(value) && value.length <= max ? value : bad();
const count = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 1000 ? Number(value) : bad();
const name = (value: unknown) => typeof value === "string" && value.trim() && value.length <= 160 && !/[<>@\x00-\x1f\x7f]/.test(value) ? value : bad();
const families: readonly (FamilyState | null)[] = ["joined", "invited", "expiring", "expired", "none", null];

export function parseStatuses(value: unknown): StudentStatus[] {
  const rows = list(object(value, ["students"]).students, 5000).map(item => {
    const row = object(item, ["id", "tutors", "family", "reading", "honors"]);
    if (!families.includes(row.family as FamilyState | null) || !["none", "confirmed", "review"].includes(row.reading as string) || typeof row.honors !== "boolean") return bad();
    return { id: identifier(row.id), tutors: count(row.tutors), family: row.family as FamilyState | null, reading: row.reading as StudentStatus["reading"], honors: row.honors };
  });
  if (new Set(rows.map(row => row.id)).size !== rows.length) return bad();
  return rows;
}
export type Teaching = { tutorGrantId: string; students: { id: string; firstName: string; lastName: string }[] };
export function parseTeaching(value: unknown): Teaching[] {
  return list(object(value, ["tutors"]).tutors, 5000).map(item => {
    const row = object(item, ["tutorGrantId", "students"]);
    return { tutorGrantId: identifier(row.tutorGrantId), students: list(row.students, 5000).map(student => { const s = object(student, ["id", "firstName", "lastName"]); return { id: identifier(s.id), firstName: name(s.firstName), lastName: name(s.lastName) }; }) };
  });
}
export type Family = { kind: "child" | "adult"; joined: string[]; invited: boolean };
export function parseFamily(value: unknown): Family {
  const row = object(value, ["kind", "joined", "invited"]);
  if ((row.kind !== "child" && row.kind !== "adult") || typeof row.invited !== "boolean") return bad();
  const joined = list(row.joined, 8).map(name);
  if (joined.length && row.invited) return bad();
  return { kind: row.kind, joined, invited: row.invited };
}

export const staffApi = {
  async status(signal?: AbortSignal) { return parseStatuses(await call("/api/admin/student-status", undefined, undefined, signal, 2 * 1024 * 1024)); },
  async teaching(signal?: AbortSignal) { return parseTeaching(await call("/api/admin/tutor-students", undefined, undefined, signal, 2 * 1024 * 1024)); },
  async family(mode: "tutor" | "admin", studentId: string, signal?: AbortSignal) { return parseFamily(await call(`/api/students/${identifier(studentId)}/family?mode=${mode}`, undefined, undefined, signal)); },
  /** Moves the reviewed students to another tutor and removes the departing tutor, in one transaction on the server. */
  async handOver(tutor: { id: string; revision: number }, toTutorGrantId: string, studentIds: string[]) {
    const row = object(await call(`/api/admin/tutors/${identifier(tutor.id)}/hand-over`, { expectedRevision: tutor.revision, toTutorGrantId: identifier(toTutorGrantId), studentIds: studentIds.map(identifier) }), ["ok", "id", "revision", "moved"]);
    if (row.ok !== true || row.id !== tutor.id || row.revision !== tutor.revision + 1 || row.moved !== studentIds.length) return bad();
  },
  /** "Confirm reading is still right": the same verses, recorded as reviewed for the current date and service. */
  async reconfirm(mode: "tutor" | "admin", studentId: string, reading: { kind: "torah" | "haftarah"; revision: number }) {
    const row = object(await call(`/api/students/${identifier(studentId)}/reading/reconfirm`, { mode, kind: reading.kind, expectedRevision: reading.revision }), ["ok", "assignmentId", "revision"]);
    if (row.ok !== true || row.revision !== reading.revision + 1) return bad();
  },
};
