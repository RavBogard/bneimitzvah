import { PortalRequestError } from "../../api";
import { identifier } from "../api";

export const invalid = (): never => { throw new PortalRequestError(503); };
export function record(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key))) return invalid();
  return value as Record<string, unknown>;
}
export function positive(value: unknown): number { if (!Number.isSafeInteger(value) || Number(value) < 1) return invalid(); return Number(value); }
export function flag(value: unknown): boolean { if (typeof value !== "boolean") return invalid(); return value; }
function label(value: unknown, max = 160): string { if (typeof value !== "string" || !value.trim() || value.length > max || /[<>@\x00-\x1f\x7f]/.test(value)) return invalid(); return value; }
function studentName(value: unknown): string { if (typeof value !== "string" || !value.trim() || value.length > 100 || /[<>\x00-\x1f\x7f]/.test(value)) return invalid(); return value; }
export type Tutor = { id: string; displayName: string; revision: number; isCantor: boolean };
export type Guardian = { id: string; revision: number; parentGrantId: string; parentGrantRevision: number; displayName: string; practiceEnabled: boolean; effectiveRead: boolean; effectivePractice: boolean };
export type Identity = { id: string; studentGrantId: string; studentGrantRevision: number; displayName: string; effectivePractice: boolean };
export type TutorLink = { id: string; tutorGrantId: string; tutorGrantRevision: number; displayName: string; isCantor: boolean; effectiveRead: boolean };
export type Relationships = { student: { id: string; firstName: string; lastName: string; ceremonyDate: string; revision: number; disabled: boolean }; guardians: Guardian[]; identities: Identity[]; tutors: TutorLink[] };
export function identityLabels(rows: readonly { id: string; displayName: string }[]): Map<string, string> {
  const names = new Map<string, string[]>();
  for (const row of rows) { const name = row.displayName.trim().toLowerCase(); names.set(name, [...(names.get(name) ?? []), row.id]); }
  return new Map(rows.map(row => {
    const peers = names.get(row.displayName.trim().toLowerCase())!;
    if (peers.length === 1) return [row.id, row.displayName];
    let length = 8;
    while (length < row.id.length && peers.some(id => id !== row.id && id.slice(-length) === row.id.slice(-length))) length += 4;
    return [row.id, `${row.displayName} · ${row.id.slice(-length)}`];
  }));
}
function rows<T>(value: unknown, parse: (row: unknown) => T & { id: string }): T[] {
  if (!Array.isArray(value) || value.length > 500) return invalid();
  const result = value.map(parse); if (new Set(result.map(row => row.id)).size !== result.length) return invalid(); return result;
}
export function parseTutors(value: unknown, afterId?: string): Tutor[] {
  const result = rows(record(value, ["tutors"]).tutors, value => {
    const r = record(value, ["id", "displayName", "revision", "isCantor"]);
    return { id: identifier(r.id), displayName: label(r.displayName), revision: positive(r.revision), isCantor: flag(r.isCantor) };
  });
  if (result.length > 100) return invalid(); let previous = afterId?.toLowerCase() ?? "";
  for (const row of result) { if (row.id.toLowerCase() <= previous) return invalid(); previous = row.id.toLowerCase(); } return result;
}
export function parseRelationships(value: unknown, studentId: string): Relationships {
  const r = record(value, ["student", "guardians", "identities", "tutors"]), s = record(r.student, ["id", "firstName", "lastName", "ceremonyDate", "revision", "disabled"]);
  if (identifier(s.id) !== studentId || typeof s.ceremonyDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s.ceremonyDate) || !Number.isFinite(Date.parse(s.ceremonyDate)) || new Date(s.ceremonyDate).toISOString().slice(0, 10) !== s.ceremonyDate) return invalid();
  const student = { id: studentId, firstName: studentName(s.firstName), lastName: studentName(s.lastName), ceremonyDate: s.ceremonyDate, revision: positive(s.revision), disabled: flag(s.disabled) };
  const guardians = rows(r.guardians, value => {
    const row = record(value, ["id", "revision", "parentGrantId", "parentGrantRevision", "displayName", "practiceEnabled", "effectiveRead", "effectivePractice"]);
    const result = { id: identifier(row.id), revision: positive(row.revision), parentGrantId: identifier(row.parentGrantId), parentGrantRevision: positive(row.parentGrantRevision), displayName: label(row.displayName), practiceEnabled: flag(row.practiceEnabled), effectiveRead: flag(row.effectiveRead), effectivePractice: flag(row.effectivePractice) };
    if (result.effectivePractice && (!result.practiceEnabled || !result.effectiveRead)) return invalid(); return result;
  });
  const identities = rows(r.identities, value => { const row = record(value, ["id", "studentGrantId", "studentGrantRevision", "displayName", "effectivePractice"]); return { id: identifier(row.id), studentGrantId: identifier(row.studentGrantId), studentGrantRevision: positive(row.studentGrantRevision), displayName: label(row.displayName), effectivePractice: flag(row.effectivePractice) }; });
  const tutors = rows(r.tutors, value => { const row = record(value, ["id", "tutorGrantId", "tutorGrantRevision", "displayName", "isCantor", "effectiveRead"]); return { id: identifier(row.id), tutorGrantId: identifier(row.tutorGrantId), tutorGrantRevision: positive(row.tutorGrantRevision), displayName: label(row.displayName), isCantor: flag(row.isCantor), effectiveRead: flag(row.effectiveRead) }; });
  if (student.disabled && (guardians.some(row => row.effectiveRead || row.effectivePractice) || identities.some(row => row.effectivePractice) || tutors.some(row => row.effectiveRead))) return invalid();
  return { student, guardians, identities, tutors };
}
// Private bounded transport shared only by the two admin clients below. Paths
// are constructed by their closed operations, never supplied by a form field.
export async function adminRequest(path: string, body?: object, signal?: AbortSignal): Promise<unknown> {
  const controller = new AbortController(), abort = () => controller.abort(); if (signal?.aborted) abort(); signal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(abort, 12_000);
  try {
    const response = await fetch(path, { method: body === undefined ? "GET" : "POST", body: body === undefined ? undefined : JSON.stringify(body), credentials: "same-origin", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer", signal: controller.signal,
      headers: body === undefined ? { accept: "application/json" } : { accept: "application/json", "content-type": "application/json" } });
    if (!response.ok) throw new PortalRequestError([400, 401, 403, 404, 409, 413, 429, 503].includes(response.status) ? response.status : 503);
    if (!response.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return invalid();
    const reader = response.body?.getReader(); if (!reader) return invalid(); const chunks: Uint8Array[] = []; let size = 0;
    try { for (;;) { const next = await reader.read(); if (next.done) break; size += next.value.byteLength; if (size > 1024 * 1024) { await reader.cancel(); return invalid(); } chunks.push(next.value); } } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch (error) { if (error instanceof PortalRequestError) throw error; return invalid(); }
  finally { clearTimeout(timeout); signal?.removeEventListener("abort", abort); }
}
export type Group = "tutors" | "guardians" | "identities";
export type Action = { kind: "assign"; grantId: string } | { kind: "link"; group: Group; linkId: string } | { kind: "practice"; linkId: string; enabled: boolean }
  | { kind: "grant"; group?: Group; linkId?: string; grantId: string } | { kind: "cantor"; grantId: string; enabled: boolean };
// scope says who is affected before the consequence: this student only, every student, or a congregation setting.
export type Review = { action: Action; title: string; person: string; student?: Relationships["student"]; grantId: string; linkId?: string; scope: "student" | "congregation" | "setting"; consequence: string; path: string; body: Record<string, unknown>; fingerprint: string };
export function makeReview(action: Action, data: Relationships | null, tutors: Tutor[]): Review {
  const student = data?.student, base = student ? `/api/admin/students/${identifier(student.id)}/relationships` : "";
  let person: string, grantId: string, linkId: string | undefined, title: string, scope: Review["scope"] = "student", consequence: string, path: string, body: Record<string, unknown>, target: unknown;
  if (action.kind === "assign" || action.kind === "cantor" || action.kind === "grant" && !action.group) {
    const tutor = tutors.find(row => row.id === action.grantId); if (!tutor) throw new PortalRequestError(409);
    person = tutor.displayName; grantId = tutor.id; target = tutor;
    if (action.kind === "assign") {
      if (!student || student.disabled || data!.tutors.some(row => row.tutorGrantId === tutor.id)) throw new PortalRequestError(409);
      title = "Assign tutor"; consequence = "This tutor will be able to open and teach this student's reading, service parts and lessons."; path = `${base}/tutors`; body = { tutorGrantId: tutor.id, expectedState: "unassigned" };
    } else if (action.kind === "cantor") {
      title = action.enabled ? "Mark as cantor" : "Remove cantor flag"; scope = "setting"; consequence = "This changes only the cantor label on this tutor. Their students and access stay the same."; path = `/api/admin/tutors/${tutor.id}/cantor`; body = { expectedRevision: tutor.revision, isCantor: action.enabled };
    } else {
      title = "Remove as a tutor"; scope = "congregation"; consequence = "This tutor loses access to every student they teach in this congregation. To stop them teaching one student only, open that student's People page."; path = `/api/admin/grants/${tutor.id}/revoke`; body = { expectedRevision: tutor.revision, expectedState: "active" };
    }
  } else {
    if (!student || !data) throw new PortalRequestError(409);
    const group: Group = action.kind === "practice" ? "guardians" : action.group!;
    const row = data[group].find(row => row.id === action.linkId); if (!row) throw new PortalRequestError(409);
    person = row.displayName; linkId = row.id; target = row;
    grantId = "parentGrantId" in row ? row.parentGrantId : "studentGrantId" in row ? row.studentGrantId : row.tutorGrantId;
    const revision = "parentGrantRevision" in row ? row.parentGrantRevision : "studentGrantRevision" in row ? row.studentGrantRevision : row.tutorGrantRevision;
    if (action.kind === "practice") {
      if (!("practiceEnabled" in row) || action.enabled && (student.disabled || !row.effectiveRead)) throw new PortalRequestError(409);
      title = action.enabled ? "Allow child practice" : "Stop child practice"; consequence = action.enabled ? "This parent will be able to practise as this child from their own account. Nothing changes for their other children." : "This parent will no longer practise as this child. They can still read this child's work, and nothing changes for their other children."; path = `${base}/guardians/${row.id}/practice`; body = { expectedRevision: row.revision, practiceEnabled: action.enabled };
    } else if (action.kind === "link") {
      title = group === "tutors" ? "Remove tutor from this student" : group === "guardians" ? "Remove parent from this student" : "Remove this student sign-in";
      consequence = group === "identities" ? "This account will no longer open this student's practice. Nothing else changes." : `This person loses access to ${student.firstName} only. Anyone else they ${group === "tutors" ? "teach" : "are linked to"} keeps the same access.`; path = `${base}/${group}/${row.id}/revoke`; body = { expectedState: "active" };
    } else {
      if (action.kind !== "grant" || action.grantId !== grantId) throw new PortalRequestError(409);
      title = group === "guardians" ? "Remove as a parent" : group === "identities" ? "Remove as a student" : "Remove as a tutor"; scope = "congregation";
      consequence = group === "guardians" ? `This parent loses access to every linked child in this congregation, not only ${student.firstName}.` : group === "identities" ? `This account loses student access everywhere in this congregation, not only for ${student.firstName}.` : `This tutor loses access to every student they teach in this congregation, not only ${student.firstName}.`;
      path = `/api/admin/grants/${grantId}/revoke`; body = { expectedRevision: revision, expectedState: "active" };
    }
  }
  return { action, title, person, student, grantId, linkId, scope, consequence, path, body, fingerprint: JSON.stringify([action, student ?? null, target]) };
}
export const relationshipApi = {
  async inspect(id: string, signal?: AbortSignal) { return parseRelationships(await adminRequest(`/api/admin/students/${identifier(id)}/relationships`, undefined, signal), id); },
  async tutors(afterId?: string, signal?: AbortSignal) { return parseTutors(await adminRequest(`/api/admin/tutors?limit=100${afterId ? `&afterId=${identifier(afterId)}` : ""}`, undefined, signal), afterId); },
  async mutate(review: Review) {
    const value = await adminRequest(review.path, review.body), revision = review.body.expectedRevision;
    const keys = review.action.kind === "assign" ? ["ok", "id", "studentId", "tutorGrantId"] : review.action.kind === "practice" ? ["ok", "id", "revision", "practiceEnabled"] : review.action.kind === "cantor" ? ["ok", "id", "revision", "isCantor"] : review.action.kind === "grant" ? ["ok", "id", "revision"] : ["ok", "id"];
    const row = record(value, keys), id = identifier(row.id); if (row.ok !== true) return invalid();
    if (review.action.kind === "assign") { if (row.studentId !== review.student?.id || row.tutorGrantId !== review.grantId) return invalid(); }
    else if (id !== (review.action.kind === "grant" || review.action.kind === "cantor" ? review.grantId : review.linkId)) return invalid();
    if (revision !== undefined && (positive(row.revision) < Number(revision) || review.action.kind === "grant" && row.revision !== Number(revision) + 1)) return invalid();
    if (review.action.kind === "practice" && row.practiceEnabled !== review.action.enabled || review.action.kind === "cantor" && row.isCantor !== review.action.enabled) return invalid();
  },
};
