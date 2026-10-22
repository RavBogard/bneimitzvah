import { PortalRequestError } from "../../api";

export type ConnectionAccess = "read" | "study" | "roster";
export type Connection = Readonly<{ id: string; client: string; role: "admin" | "tutor"; access: readonly ConnectionAccess[]; routine: boolean; approvedAt: string; expiresAt: string; mine: boolean; staffName: string | null }>;
export type ConnectionsView = Readonly<{ role: "admin" | "tutor"; connections: readonly Connection[]; truncated: boolean }>;
export type MavenLink = Readonly<{ mavenContactId: string; linkKind: "created" | "linked"; linkedAt: string }>;

const bad = (): never => { throw new PortalRequestError(503); };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || keys.some(key => !Object.hasOwn(value, key)) || Object.keys(value).some(key => !keys.includes(key))) return bad();
  return value as Record<string, unknown>;
}
const line = (value: unknown, max: number) => typeof value === "string" && value.length > 0 && value.length <= max && !/[\x00-\x1f\x7f<>@]/.test(value) ? value : bad();
const instant = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : bad();

async function request(path: string, body?: object, signal?: AbortSignal): Promise<{ status: number; value: unknown }> {
  const controller = new AbortController(), abort = () => controller.abort(); if (signal?.aborted) abort(); signal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(abort, 12_000);
  try {
    const response = await fetch(path, { method: body === undefined ? "GET" : "POST", body: body === undefined ? undefined : JSON.stringify(body), credentials: "same-origin", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer", signal: controller.signal,
      headers: body === undefined ? { accept: "application/json" } : { accept: "application/json", "content-type": "application/json" } });
    // A refused unlink (409) carries its reason; every other failure is only a status.
    if (!response.ok && response.status !== 409) throw new PortalRequestError([400, 401, 403, 404, 413, 429, 503].includes(response.status) ? response.status : 503);
    if (!response.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return bad();
    const text = await response.text(); if (text.length > 64 * 1024) return bad();
    return { status: response.status, value: JSON.parse(text) };
  } catch (error) { if (error instanceof PortalRequestError) throw error; return bad(); }
  finally { clearTimeout(timeout); signal?.removeEventListener("abort", abort); }
}

export function parseConnections(value: unknown): ConnectionsView {
  const outer = object(value, ["ok", "view"]); if (outer.ok !== true) return bad();
  const view = object(outer.view, ["role", "connections", "truncated"]);
  if ((view.role !== "admin" && view.role !== "tutor") || typeof view.truncated !== "boolean" || !Array.isArray(view.connections) || view.connections.length > 100) return bad();
  const connections = view.connections.map((raw): Connection => {
    const row = object(raw, ["id", "client", "role", "access", "routine", "approvedAt", "expiresAt", "mine", "staffName"]);
    if (typeof row.id !== "string" || !UUID.test(row.id) || (row.role !== "admin" && row.role !== "tutor") || typeof row.routine !== "boolean" || typeof row.mine !== "boolean"
      || !Array.isArray(row.access) || row.access.length > 3 || row.access.some(a => a !== "read" && a !== "study" && a !== "roster") || (row.mine ? row.staffName !== null : row.staffName === null)) return bad();
    return { id: row.id, client: line(row.client, 120), role: row.role, access: row.access as ConnectionAccess[], routine: row.routine, approvedAt: instant(row.approvedAt), expiresAt: instant(row.expiresAt),
      mine: row.mine, staffName: row.staffName === null ? null : line(row.staffName, 80) };
  });
  return { role: view.role, connections, truncated: view.truncated };
}
export function parseMavenLink(value: unknown): MavenLink | null {
  const outer = object(value, ["ok", "link"]); if (outer.ok !== true) return bad();
  if (outer.link === null) return null;
  const link = object(outer.link, ["mavenContactId", "linkKind", "linkedAt"]);
  if (typeof link.mavenContactId !== "string" || !/^[A-Za-z0-9]{18}$/.test(link.mavenContactId) || (link.linkKind !== "created" && link.linkKind !== "linked")) return bad();
  return { mavenContactId: link.mavenContactId, linkKind: link.linkKind, linkedAt: instant(link.linkedAt) };
}

export const connectionsApi = {
  async list(signal?: AbortSignal) { return parseConnections((await request("/api/staff/claude-connections", undefined, signal)).value); },
  async revoke(connectionId: string) {
    const row = object((await request("/api/staff/claude-connections/revoke", { connectionId })).value, ["ok", "ended"]);
    if (row.ok !== true || typeof row.ended !== "boolean") return bad();
    return { ended: row.ended };
  },
  async mavenLink(studentId: string, signal?: AbortSignal) { return parseMavenLink((await request(`/api/admin/maven-link?studentId=${encodeURIComponent(studentId)}`, undefined, signal)).value); },
  /** True when the link ended; false when it was no longer that student's current link (nothing changed). */
  async unlinkMaven(studentId: string, mavenContactId: string) {
    const { status, value } = await request("/api/admin/maven-link/unlink", { studentId, mavenContactId });
    if (status === 409) { const row = object(value, ["ok", "code"]); if (row.ok !== false || row.code !== "not-linked") return bad(); return false; }
    const row = object(value, ["ok", "unlinkedAt"]); if (row.ok !== true) return bad(); instant(row.unlinkedAt);
    return true;
  },
};
