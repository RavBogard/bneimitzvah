import { PortalRequestError } from "../../api";
import { identifier, type RosterStudent } from "../api";

export type InviteRole = "parent" | "student" | "tutor";
export type Invitation = { id: string; role: InviteRole; recipientEmail: string; student: { id: string; firstName: string; lastName: string } | null;
  status: "pending" | "accepted" | "revoked" | "expired"; createdAt: string; expiresAt: string; acceptedAt: string | null; revokedAt: string | null;
  delivery: { status: "pending" | "sent" | "failed"; attemptedAt: string | null } };
export type InviteDraft = { role: InviteRole; email: string; studentId: string };
export type IssueSelection = { role: InviteRole; email: string; studentId?: string };
export type Receipt = { inviteId: string; delivery: "sent" | "failed" | "unknown" };
export const inviteRoleNames = { parent: "Parent", student: "Student", tutor: "Tutor" } as const;
export const INVITATION_PAGE_SIZE = 25;
const bad = (): never => { throw new PortalRequestError(503); };
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key))) return bad();
  return value as Record<string, unknown>;
}
function name(value: unknown): string { if (typeof value !== "string" || !value.trim() || value.length > 100 || /[<>\x00-\x1f\x7f]/.test(value)) return bad(); return value; }
function instant(value: unknown): string { if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return bad(); return value; }
export function recipient(value: string): string {
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || /[\x00-\x1f\x7f]/.test(email)) throw new PortalRequestError(400);
  return email;
}
export function parseInvitationPage(value: unknown, afterId?: string): Invitation[] {
  const values = object(value, ["invitations"]).invitations;
  if (!Array.isArray(values) || values.length > INVITATION_PAGE_SIZE) return bad();
  let previous = afterId?.toLowerCase() ?? "";
  return values.map(value => {
    const row = object(value, ["id", "role", "recipientEmail", "student", "status", "createdAt", "expiresAt", "acceptedAt", "revokedAt", "delivery"]);
    const id = identifier(row.id); if (id.toLowerCase() <= previous) return bad(); previous = id.toLowerCase();
    if (!["parent", "student", "tutor"].includes(String(row.role)) || !["pending", "accepted", "revoked", "expired"].includes(String(row.status)) || typeof row.recipientEmail !== "string") return bad();
    let email: string; try { email = recipient(row.recipientEmail); } catch { return bad(); } if (email !== row.recipientEmail) return bad();
    const createdAt = instant(row.createdAt), expiresAt = instant(row.expiresAt), acceptedAt = row.acceptedAt === null ? null : instant(row.acceptedAt), revokedAt = row.revokedAt === null ? null : instant(row.revokedAt);
    if (Date.parse(expiresAt) <= Date.parse(createdAt) || (acceptedAt !== null && (Date.parse(acceptedAt) < Date.parse(createdAt) || Date.parse(acceptedAt) >= Date.parse(expiresAt))) || (revokedAt !== null && Date.parse(revokedAt) < Date.parse(createdAt))
      || (row.status === "accepted") !== (acceptedAt !== null) || (row.status === "revoked") !== (revokedAt !== null) || acceptedAt !== null && revokedAt !== null) return bad();
    let student: Invitation["student"] = null;
    if (row.student !== null) { const s = object(row.student, ["id", "firstName", "lastName"]); student = { id: identifier(s.id), firstName: name(s.firstName), lastName: name(s.lastName) }; }
    if ((row.role === "tutor") !== (student === null)) return bad();
    const d = object(row.delivery, ["status", "attemptedAt"]), attemptedAt = d.attemptedAt === null ? null : instant(d.attemptedAt);
    if (!["pending", "sent", "failed"].includes(String(d.status)) || (d.status === "pending") !== (attemptedAt === null) || attemptedAt !== null && Date.parse(attemptedAt) < Date.parse(createdAt)) return bad();
    return { id, role: row.role as InviteRole, recipientEmail: email, student, status: row.status as Invitation["status"], createdAt, expiresAt, acceptedAt, revokedAt, delivery: { status: d.status as Invitation["delivery"]["status"], attemptedAt } };
  });
}
export function issueReview(draft: InviteDraft, students: RosterStudent[]) {
  if (!["parent", "student", "tutor"].includes(draft.role)) throw new PortalRequestError(400);
  const email = recipient(draft.email), student = draft.role === "tutor" ? null : students.find(row => row.id === draft.studentId);
  if (draft.role !== "tutor" && (!student || student.disabledAt)) throw new PortalRequestError(400);
  if (draft.role === "student" && student && student.parentEmail !== null && recipient(student.parentEmail) === email) throw new PortalRequestError(400);
  const selection: IssueSelection = { role: draft.role, email, ...(student ? { studentId: student.id } : {}) };
  return { selection, student, fingerprint: JSON.stringify([selection, student ? [student.id, student.revision, student.firstName, student.lastName, student.ceremonyDate, student.parentEmail, student.disabledAt] : null]) };
}
export const invitationFingerprint = (row: Invitation) => JSON.stringify(row);
export function invitationTargetFingerprint(row: Invitation, students: RosterStudent[]): string {
  const student = row.student ? students.find(student => student.id === row.student!.id) : null;
  return JSON.stringify([row, student ? [student.id, student.revision, student.firstName, student.lastName, student.ceremonyDate, student.parentEmail, student.disabledAt] : null]);
}
async function request(path: string, body?: object, signal?: AbortSignal): Promise<unknown> {
  const controller = new AbortController(), abort = () => controller.abort(); if (signal?.aborted) abort(); signal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(abort, 12_000);
  try {
    const response = await fetch(path, { method: body === undefined ? "GET" : "POST", body: body === undefined ? undefined : JSON.stringify(body), credentials: "same-origin", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer", signal: controller.signal,
      headers: body === undefined ? { accept: "application/json" } : { accept: "application/json", "content-type": "application/json" } });
    if (!response.ok) throw new PortalRequestError([400, 401, 403, 404, 409, 413, 429, 503].includes(response.status) ? response.status : 503);
    if (!response.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return bad();
    const reader = response.body?.getReader(); if (!reader) return bad(); let size = 0; const chunks: Uint8Array[] = [];
    try { for (;;) { const next = await reader.read(); if (next.done) break; size += next.value.byteLength; if (size > 128 * 1024) { await reader.cancel(); return bad(); } chunks.push(next.value); } } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch (error) { if (error instanceof PortalRequestError) throw error; return bad(); }
  finally { clearTimeout(timeout); signal?.removeEventListener("abort", abort); }
}
function receipt(value: unknown): Receipt { const row = object(value, ["inviteId", "delivery"]); if (!["sent", "failed", "unknown"].includes(String(row.delivery))) return bad(); return { inviteId: identifier(row.inviteId), delivery: row.delivery as Receipt["delivery"] }; }
export const invitationApi = {
  async list(afterId?: string, signal?: AbortSignal) { return parseInvitationPage(await request(`/api/admin/invitations?limit=${INVITATION_PAGE_SIZE}${afterId ? `&afterId=${identifier(afterId)}` : ""}`, undefined, signal), afterId); },
  async issue(selection: IssueSelection) { return receipt(await request("/api/admin/invitations", selection)); },
  async reissue(id: string) { const value = receipt(await request(`/api/admin/invitations/${identifier(id)}/reissue`, {})); if (value.inviteId === id) return bad(); return value; },
  async revoke(id: string) { const row = object(await request(`/api/admin/invitations/${identifier(id)}/revoke`, {}), ["inviteId"]); if (identifier(row.inviteId) !== id) return bad(); return { inviteId: id }; },
};
