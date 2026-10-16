export const roleNames = { student: "Student", parent: "Parent", tutor: "Tutor", admin: "Rabbi / admin" } as const;
export type Role = keyof typeof roleNames;
export type SessionSummary = Readonly<{ membershipAvailable: boolean; roles: readonly Role[]; sessionBinding: string }>;
export type InvitationReview = Readonly<{ role: "student" | "parent" | "tutor"; student: { firstName: string; lastName: string } | null; expiresAt: string; reviewBinding: string }>;

export class PortalRequestError extends Error {
  constructor(readonly status: number) { super("Portal request unavailable"); }
}
const unavailable = (): never => { throw new PortalRequestError(503); };
function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key))) return unavailable();
  return value as Record<string, unknown>;
}
function role(value: unknown): Role {
  if (typeof value !== "string" || !Object.hasOwn(roleNames, value)) return unavailable();
  return value as Role;
}
export function parseSession(value: unknown): SessionSummary {
  const row = record(value, ["membershipAvailable", "roles", "sessionBinding"]);
  if (typeof row.membershipAvailable !== "boolean" || !Array.isArray(row.roles) || row.roles.length > 4 || typeof row.sessionBinding !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(row.sessionBinding)) return unavailable();
  const roles = row.roles.map(role);
  if (new Set(roles).size !== roles.length || (!row.membershipAvailable && roles.length)) return unavailable();
  return { membershipAvailable: row.membershipAvailable, roles, sessionBinding: row.sessionBinding };
}
export function parseInvitation(value: unknown): InvitationReview {
  const row = record(value, ["role", "student", "expiresAt", "requiresConfirmation", "reviewBinding"]), intendedRole = role(row.role);
  if (intendedRole === "admin" || row.requiresConfirmation !== true || typeof row.expiresAt !== "string" || !Number.isFinite(Date.parse(row.expiresAt))
    || typeof row.reviewBinding !== "string" || !/^[1-9][0-9]{0,15}\.[A-Za-z0-9_-]{43}$/.test(row.reviewBinding)) return unavailable();
  let student = null;
  if (intendedRole === "tutor") { if (row.student !== null) return unavailable(); }
  else {
    const target = record(row.student, ["firstName", "lastName"]);
    for (const value of [target.firstName, target.lastName]) if (typeof value !== "string" || !value.trim() || value.length > 100 || /[\x00-\x1f\x7f]/.test(value)) return unavailable();
    student = { firstName: target.firstName as string, lastName: target.lastName as string };
  }
  return { role: intendedRole, student, expiresAt: row.expiresAt, reviewBinding: row.reviewBinding };
}
export type GoogleChallenge = Readonly<{ challengeId: string; nonce: string; csrfToken: string; clientId: string; expiresAt: number }>;
export function parseGoogleChallenge(value: unknown): GoogleChallenge {
  const row = record(value, ["challengeId", "nonce", "csrfToken", "clientId", "expiresAt"]);
  for (const key of ["challengeId", "nonce", "csrfToken"]) if (typeof row[key] !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(row[key] as string)) return unavailable();
  if (typeof row.clientId !== "string" || !/^[A-Za-z0-9._-]{1,256}$/.test(row.clientId) || !Number.isSafeInteger(row.expiresAt)
    || Number(row.expiresAt) <= Date.now() || Number(row.expiresAt) > Date.now() + 300_000) return unavailable();
  return row as GoogleChallenge;
}
export function parseAuthResult(value: unknown): "/" | "/invitations/accept" {
  const row = record(value, ["ok", "next"]);
  if (row.ok !== true || (row.next !== "/" && row.next !== "/invitations/accept")) return unavailable();
  return row.next;
}
export function parseAcknowledgement(value: unknown, key: "requested" | "ok") {
  if (record(value, [key])[key] !== true) return unavailable();
}
export function parseAcceptance(value: unknown) {
  const row = record(value, ["inviteId", "role", "studentId"]), intendedRole = role(row.role);
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (intendedRole === "admin" || typeof row.inviteId !== "string" || !uuid.test(row.inviteId)
    || (intendedRole === "tutor" ? row.studentId !== null : typeof row.studentId !== "string" || !uuid.test(row.studentId))) return unavailable();
}

// A closed endpoint set prevents callers from turning this helper into an
// arbitrary fetch/redirect surface. No response diagnostics cross the boundary.
type Endpoint = "/api/session" | "/api/auth/sign-in/social" | "/api/auth/google/challenge" | "/api/auth/sign-in/magic-link" | "/api/auth/sign-out" | "/api/invitations/pending" | "/api/invitations/accept";
const endpoints = new Set<string>(["/api/session", "/api/auth/sign-in/social", "/api/auth/google/challenge", "/api/auth/sign-in/magic-link", "/api/auth/sign-out", "/api/invitations/pending", "/api/invitations/accept"]);
export async function requestPortal(endpoint: Endpoint, body?: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
  if (!endpoints.has(endpoint)) return unavailable();
  const controller = new AbortController(), abort = () => controller.abort();
  if (signal?.aborted) abort();
  signal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(abort, 12_000);
  try {
    const response = await fetch(endpoint, { method: body === undefined ? "GET" : "POST", credentials: "same-origin", cache: "no-store", redirect: "error",
      referrerPolicy: "no-referrer", signal: controller.signal, headers: body === undefined ? { accept: "application/json" } : { accept: "application/json", "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body) });
    if (!response.ok) throw new PortalRequestError([400, 401, 403, 404, 409, 429, 503].includes(response.status) ? response.status : 503);
    if (!response.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return unavailable();
    // Known entry DTOs are small. Never buffer an arbitrary provider payload.
    const reader = response.body?.getReader();
    if (!reader) return unavailable();
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      for (;;) {
        const next = await reader.read(); if (next.done) break;
        size += next.value.byteLength;
        if (size > 16_384) { await reader.cancel(); return unavailable(); }
        chunks.push(next.value);
      }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch (error) { if (error instanceof PortalRequestError) throw error; return unavailable(); }
  finally { clearTimeout(timeout); signal?.removeEventListener("abort", abort); }
}
