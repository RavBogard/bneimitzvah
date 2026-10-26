import { PortalRequestError } from "../../api";
import { DEFAULT_SIDDUR_URL, SETTINGS_LIMITS, settingsParagraph, settingsUrl, validateSettings, type CongregationSettings, type ServiceSetting, type ServiceSlot } from "../../../../server/settings/validation";

export type SettingsView = { version: number; settings: CongregationSettings; updatedAt: string | null; defaults: { rabbiDisplayName: string; siddurUrl: string };
  /** G21: the operator's email switch, and whether this congregation sets its own roster sheet here. Absent from an older server: email unknown, field shown. */
  portal: { email: boolean | null; rosterSheetId: boolean } };
export type SaveOutcome = { ok: true; version: number } | { ok: false; code: "conflict" | "no-change" | "invalid"; problems: string[] };
export type Links = { siddurUrl: string; musicUrl: string | null };
export type ServiceSettings = Partial<Record<ServiceSlot, ServiceSetting>>;
/** What every member's pages show from the congregation settings. */
export type Congregation = { links: Links; services: ServiceSettings; consentNotice: string | null };
const bad = (): never => { throw new PortalRequestError(503); };
function object(value: unknown, keys: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || keys.some(key => !Object.hasOwn(value, key)) || Object.keys(value).some(key => !keys.includes(key) && !optional.includes(key))) return bad();
  return value as Record<string, unknown>;
}
const line = (value: unknown, max: number) => typeof value === "string" && value.length > 0 && value.length <= max && !/[\x00-\x1f\x7f<>]/.test(value) ? value : bad();

async function request(path: string, body?: object, signal?: AbortSignal): Promise<{ status: number; value: unknown }> {
  const controller = new AbortController(), abort = () => controller.abort(); if (signal?.aborted) abort(); signal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(abort, 12_000);
  try {
    const response = await fetch(path, { method: body === undefined ? "GET" : "POST", body: body === undefined ? undefined : JSON.stringify(body), credentials: "same-origin", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer", signal: controller.signal,
      headers: body === undefined ? { accept: "application/json" } : { accept: "application/json", "content-type": "application/json" } });
    // A refused save (409) carries its reason; every other failure is only a status.
    if (!response.ok && response.status !== 409) throw new PortalRequestError([400, 401, 403, 404, 413, 429, 503].includes(response.status) ? response.status : 503);
    if (!response.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return bad();
    const text = await response.text(); if (text.length > 64 * 1024) return bad();
    return { status: response.status, value: JSON.parse(text) };
  } catch (error) { if (error instanceof PortalRequestError) throw error; return bad(); }
  finally { clearTimeout(timeout); signal?.removeEventListener("abort", abort); }
}

export function parseSettingsView(value: unknown): SettingsView {
  const view = object(object(value, ["ok", "view"]).view, ["version", "settings", "updatedAt", "defaults"], ["portal"]);
  const portal = view.portal === undefined ? null : object(view.portal, ["email", "rosterSheetId"]);
  if (portal && (typeof portal.email !== "boolean" || typeof portal.rosterSheetId !== "boolean")) return bad();
  if (!Number.isSafeInteger(view.version) || Number(view.version) < 0) return bad();
  const checked = validateSettings(view.settings); if (!checked.ok) return bad();
  const defaults = object(view.defaults, ["rabbiDisplayName", "siddurUrl"]);
  if (view.updatedAt !== null && (typeof view.updatedAt !== "string" || !Number.isFinite(Date.parse(view.updatedAt)))) return bad();
  if (!settingsUrl(defaults.siddurUrl)) return bad();
  return { version: Number(view.version), settings: checked.value, updatedAt: view.updatedAt as string | null,
    defaults: { rabbiDisplayName: line(defaults.rabbiDisplayName, 80), siddurUrl: defaults.siddurUrl },
    portal: portal ? { email: portal.email as boolean, rosterSheetId: portal.rosterSheetId as boolean } : { email: null, rosterSheetId: true } };
}
export function parseSaveOutcome(status: number, value: unknown): SaveOutcome {
  if (status === 200) {
    const row = object(value, ["ok", "replayed", "version"]);
    if (row.ok !== true || typeof row.replayed !== "boolean" || !Number.isSafeInteger(row.version) || Number(row.version) < 1) return bad();
    return { ok: true, version: Number(row.version) };
  }
  const row = object(value, ["ok", "code"], ["problems"]);
  if (row.ok !== false || !["conflict", "no-change", "invalid"].includes(String(row.code))) return bad();
  const problems = row.problems === undefined ? [] : Array.isArray(row.problems) && row.problems.length <= 32 && row.problems.every(p => typeof p === "string" && p.length <= 40) ? row.problems as string[] : bad();
  return { ok: false, code: row.code as "conflict" | "no-change" | "invalid", problems };
}
export function parseCongregation(value: unknown): Congregation {
  const row = object(value, ["ok", "links", "services", "consentNotice"]);
  const links = object(row.links, ["siddurUrl", "musicUrl"]);
  if (row.ok !== true || !settingsUrl(links.siddurUrl) || (links.musicUrl !== null && !settingsUrl(links.musicUrl))) return bad();
  // The same rules the settings page saves with: a slot is present only when it has a name or a time.
  const services = object(row.services, [], ["morning", "havdalah"]);
  if (Object.keys(services).length && !validateSettings({ services }).ok) return bad();
  if (row.consentNotice !== null && !settingsParagraph(row.consentNotice, SETTINGS_LIMITS.consentNotice)) return bad();
  return { links: { siddurUrl: links.siddurUrl, musicUrl: links.musicUrl as string | null }, services: services as ServiceSettings, consentNotice: row.consentNotice as string | null };
}

export const settingsApi = {
  async read(signal?: AbortSignal) { return parseSettingsView((await request("/api/admin/congregation-settings", undefined, signal)).value); },
  async save(input: { expectedVersion: number; settings: CongregationSettings; mutationId: string }) {
    const result = await request("/api/admin/congregation-settings", input);
    return parseSaveOutcome(result.status, result.value);
  },
  async congregation(signal?: AbortSignal) { return parseCongregation((await request("/api/congregation/links", undefined, signal)).value); },
};
export const DEFAULT_LINKS: Links = Object.freeze({ siddurUrl: DEFAULT_SIDDUR_URL, musicUrl: null });
/** What pages show until the settings read settles, or when it fails: the portal's standard wording and links. */
export const DEFAULT_CONGREGATION: Congregation = Object.freeze({ links: DEFAULT_LINKS, services: Object.freeze({}), consentNotice: null });
