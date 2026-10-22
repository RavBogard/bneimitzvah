import { HIDDEN, plain } from "../study-guides/validation";

/**
 * Congregation settings (MISSION rulings 9, 21/52). A closed set of optional fields; a field that is
 * absent takes the portal's current behaviour. The SQL function portal_tenant_settings_valid enforces
 * the same shape and limits; both must agree, and the database is never the stricter side.
 * No "server-only": the admin page checks a draft with the same rules before it saves.
 */
export const SETTINGS_LIMITS = Object.freeze({
  rabbiDisplayName: 80, serviceLabel: 40, preferredSources: 12, sourceTitle: 160, urlBytes: 512, consentNotice: 600, bodyBytes: 16384,
});
export const SETTINGS_KEYS = ["rabbiDisplayName", "services", "preferredSources", "siddurUrl", "musicUrl", "rosterSheetId", "consentNotice", "notifications"] as const;
export const NOTIFICATION_SWITCHES = ["tutorDraft", "weeklyDigest", "studentReminder"] as const;
export const SERVICE_SLOTS = ["morning", "havdalah"] as const;
export type SettingsKey = (typeof SETTINGS_KEYS)[number];
export type ServiceSlot = (typeof SERVICE_SLOTS)[number];
export type ServiceSetting = { label?: string; start?: string };
/** Each kind's admin switch (absent or false is off) and the weekly digest's day, Sunday 0 to Saturday 6. */
export type NotificationSettings = { tutorDraft?: boolean; weeklyDigest?: boolean; studentReminder?: boolean; digestWeekday?: number };
export type CongregationSettings = {
  rabbiDisplayName?: string; services?: Partial<Record<ServiceSlot, ServiceSetting>>; preferredSources?: string[];
  siddurUrl?: string; musicUrl?: string; rosterSheetId?: string; consentNotice?: string; notifications?: NotificationSettings;
};
type Result<T> = { ok: true; value: T } | { ok: false; problems: string[] };

/** What the portal links today when a congregation has not set its own. */
export const DEFAULT_SIDDUR_URL = "https://siddur.centralreform.org/";
export const START_TIME = /^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/;
export const ROSTER_SHEET_ID = /^[A-Za-z0-9_-]{25,100}$/;
// https only, no port or credentials, and only CRC's own hosts: centralreform.live and any
// subdomain of centralreform.org. The path may carry a query but never a fragment.
export const SETTINGS_URL = /^https:\/\/(?:centralreform\.live|(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+centralreform\.org)\/[A-Za-z0-9._~!$&()*+,;=:@%/?-]*$/;

const bytes = (text: string) => new TextEncoder().encode(text).length;
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const onlyKeys = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).every(key => keys.includes(key));

/** One plain line of at most `chars` characters. */
export function settingsLine(value: unknown, chars: number): value is string {
  // A lone surrogate cannot be stored in jsonb; refuse it here rather than fail in the database.
  return plain(value, chars * 4) && value.isWellFormed() && [...value].length <= chars;
}
/** Plain text that may hold line breaks, of at most `chars` characters. */
export function settingsParagraph(value: unknown, chars: number): value is string {
  return typeof value === "string" && value.length > 0 && value.isWellFormed() && bytes(value) <= chars * 4 && [...value].length <= chars && value.trim() === value
    && value.normalize("NFC") === value && !/[\x00-\x09\x0b-\x1f\x7f-\x9f<>]/.test(value) && !HIDDEN.test(value);
}
/** A canonical https link on an allowed host; the parser must leave it unchanged. */
export function settingsUrl(value: unknown): value is string {
  if (typeof value !== "string" || bytes(value) > SETTINGS_LIMITS.urlBytes || !SETTINGS_URL.test(value)) return false;
  try { const url = new URL(value); return url.href === value && !url.username && !url.password && !url.port && !url.hash; } catch { return false; }
}

function service(value: unknown): value is ServiceSetting {
  return record(value) && Object.keys(value).length > 0 && onlyKeys(value, ["label", "start"])
    && (value.label === undefined || settingsLine(value.label, SETTINGS_LIMITS.serviceLabel))
    && (value.start === undefined || (typeof value.start === "string" && START_TIME.test(value.start)));
}

/**
 * Problems are field names only (never the submitted text), so a caller can say which field to fix
 * without echoing what was typed.
 */
export function validateSettings(body: unknown): Result<CongregationSettings> {
  if (!record(body) || !onlyKeys(body, SETTINGS_KEYS)) return { ok: false, problems: ["body"] };
  let size: number;
  try { size = bytes(JSON.stringify(body)); } catch { return { ok: false, problems: ["body"] }; }
  if (size > SETTINGS_LIMITS.bodyBytes) return { ok: false, problems: ["body"] };
  const problems: string[] = [];
  if (body.rabbiDisplayName !== undefined && !settingsLine(body.rabbiDisplayName, SETTINGS_LIMITS.rabbiDisplayName)) problems.push("rabbiDisplayName");
  if (body.services !== undefined) {
    const services = body.services;
    if (!record(services) || Object.keys(services).length === 0 || !onlyKeys(services, SERVICE_SLOTS)) problems.push("services");
    else for (const slot of SERVICE_SLOTS) if (services[slot] !== undefined && !service(services[slot])) problems.push(`services.${slot}`);
  }
  if (body.preferredSources !== undefined) {
    const titles = body.preferredSources;
    if (!Array.isArray(titles) || titles.length < 1 || titles.length > SETTINGS_LIMITS.preferredSources
      || !titles.every(title => settingsLine(title, SETTINGS_LIMITS.sourceTitle)) || new Set(titles).size !== titles.length) problems.push("preferredSources");
  }
  for (const key of ["siddurUrl", "musicUrl"] as const) if (body[key] !== undefined && !settingsUrl(body[key])) problems.push(key);
  if (body.rosterSheetId !== undefined && (typeof body.rosterSheetId !== "string" || !ROSTER_SHEET_ID.test(body.rosterSheetId))) problems.push("rosterSheetId");
  if (body.consentNotice !== undefined && !settingsParagraph(body.consentNotice, SETTINGS_LIMITS.consentNotice)) problems.push("consentNotice");
  if (body.notifications !== undefined) {
    const n = body.notifications;
    if (!record(n) || Object.keys(n).length === 0 || !onlyKeys(n, [...NOTIFICATION_SWITCHES, "digestWeekday"])
      || NOTIFICATION_SWITCHES.some(key => n[key] !== undefined && typeof n[key] !== "boolean")
      || (n.digestWeekday !== undefined && !(Number.isInteger(n.digestWeekday) && (n.digestWeekday as number) >= 0 && (n.digestWeekday as number) <= 6))) problems.push("notifications");
  }
  return problems.length ? { ok: false, problems } : { ok: true, value: body as CongregationSettings };
}

/** The legacy reader: tenant.customs.credits.rabbiDisplayName, as the study guides first shipped. */
export function legacyRabbiName(customs: unknown): string | null {
  const credits = record(customs) ? customs.credits : undefined;
  const name = record(credits) ? credits.rabbiDisplayName : undefined;
  return settingsLine(name, SETTINGS_LIMITS.rabbiDisplayName) ? name : null;
}
/** Settings first, then the legacy customs key, then the neutral default. */
export function effectiveRabbiName(settings: CongregationSettings | null, customs: unknown): string {
  return settings?.rabbiDisplayName ?? legacyRabbiName(customs) ?? "the rabbi";
}

/**
 * Preferred works first, in the congregation's order; everything else keeps its existing order.
 * A preference names a Sefaria index title ("Rashi on Exodus") or a work's collective title ("Rashi"),
 * compared without regard to case.
 */
export function preferredFirst<T extends { indexTitle: string; labels: { en: string | null } }>(entries: readonly T[], preferred: readonly string[]): T[] {
  if (!preferred.length) return [...entries];
  const rank = new Map<string, number>();
  preferred.forEach((title, i) => { const key = title.toLowerCase(); if (!rank.has(key)) rank.set(key, i); });
  const of = (entry: T) => Math.min(rank.get(entry.indexTitle.toLowerCase()) ?? Infinity, entry.labels.en === null ? Infinity : rank.get(entry.labels.en.toLowerCase()) ?? Infinity);
  return entries.map((entry, index) => ({ entry, index, rank: of(entry) }))
    .sort((a, b) => a.rank === b.rank ? a.index - b.index : a.rank < b.rank ? -1 : 1).map(row => row.entry);
}
