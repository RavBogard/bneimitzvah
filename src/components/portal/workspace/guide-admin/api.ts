import { gatedFetch } from "../session-gate";
import { PortalRequestError } from "../../api";

/**
 * The admin's Guides page (gap A6) talks to /api/admin/guides. Every answer is read defensively and rendered as text only.
 * The writes send exactly what the MCP tools send: a discussion's slug, or a parashah and summary revision, with the revision the
 * page last read (none of these tools takes a mutation id).
 */
export type Reading = { slug: string; name: string; order: number };
export type GuideState = "reviewed" | "draft" | "held";
export type GuideVersionInfo = { version: number; origin: "claude" | "rabbi"; reviewed: boolean; importedFrom?: string; changedAt: string };
export type GuideRow = { kind: "torah" | "haftarah"; readingKey: string; reading: Reading | null; state: GuideState; current: GuideVersionInfo; visible: GuideVersionInfo | null; href: string | null };
export type DiscussionRow = { slug: string; title: string; kind: "torah" | "haftarah"; status: "published" | "withdrawn"; revision: number; sourceCount: number; reading: Reading | null; changedAt: string; href: string | null };
export type SummaryRow = { reading: string; readingPlace: Reading | null; revision: number; status: "draft" | "approved" | "withdrawn"; summary: string; outline: { aliyah: number; line: string }[];
  credit?: string; importedFrom?: string; changedAt: string; href: string | null };
export type Overview = { rabbiName: string; guides: GuideRow[]; discussions: DiscussionRow[]; summaries: SummaryRow[]; truncated: boolean };
export type GuideText = { kind: "torah" | "haftarah"; readingKey: string; version: number; hold: boolean; rabbiName: string;
  label: { origin: "claude" | "rabbi"; reviewed: boolean; importedFrom?: string }; body: GuideBody; changedAt: string };
export type GuideTextNote = { verseRef: string; body: string; sources: { ref: string }[] };
export type GuideTextTheme = { id: string; title: string; intro: string; notes: GuideTextNote[] };
export type GuideBody = { overview?: string; themes: GuideTextTheme[] };
export type WriteOutcome = { ok: true } | { ok: false; code: string };

const bad = (): never => { throw new PortalRequestError(503); };
const rec = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : bad();
const text = (value: unknown, max = 20000): string => typeof value === "string" && value.length <= max ? value : bad();
const int = (value: unknown): number => Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : bad();
const list = (value: unknown, max = 5000): unknown[] => Array.isArray(value) && value.length <= max ? value : bad();
const kind = (value: unknown) => value === "torah" || value === "haftarah" ? value : bad();
const date = (value: unknown) => { const v = text(value, 40); return Number.isFinite(Date.parse(v)) ? v : bad(); };
/** A reader's address is only ever a /read page on this site. */
const href = (value: unknown) => value === null ? null : (() => { const v = text(value, 400); return v.startsWith("/read?") ? v : bad(); })();
const reading = (value: unknown): Reading | null => value === null ? null : (() => { const r = rec(value); return { slug: text(r.slug, 80), name: text(r.name, 120), order: int(r.order) }; })();
const optional = (value: unknown) => value === undefined ? {} : { importedFrom: text(value, 240) };
function versionInfo(value: unknown): GuideVersionInfo {
  const r = rec(value);
  return { version: int(r.version), origin: r.origin === "rabbi" ? "rabbi" : r.origin === "claude" ? "claude" : bad(), reviewed: typeof r.reviewed === "boolean" ? r.reviewed : bad(), ...optional(r.importedFrom), changedAt: date(r.changedAt) };
}
export function parseOverview(value: unknown): Overview {
  const r = rec(value);
  if (r.ok !== true) return bad();
  return {
    rabbiName: text(r.rabbiName, 240), truncated: r.truncated === true,
    guides: list(r.guides).map(raw => { const g = rec(raw);
      return { kind: kind(g.kind), readingKey: text(g.readingKey, 160), reading: reading(g.reading), state: g.state === "held" || g.state === "draft" || g.state === "reviewed" ? g.state : bad(),
        current: versionInfo(g.current), visible: g.visible === null ? null : versionInfo(g.visible), href: href(g.href) }; }),
    discussions: list(r.discussions).map(raw => { const d = rec(raw);
      return { slug: text(d.slug, 80), title: text(d.title, 400), kind: kind(d.kind), status: d.status === "published" || d.status === "withdrawn" ? d.status : bad(), revision: int(d.revision),
        sourceCount: int(d.sourceCount), reading: reading(d.reading), changedAt: date(d.changedAt), href: href(d.href) }; }),
    summaries: list(r.summaries).map(raw => { const s = rec(raw);
      return { reading: text(s.reading, 80), readingPlace: reading(s.readingPlace), revision: int(s.revision), status: s.status === "draft" || s.status === "approved" || s.status === "withdrawn" ? s.status : bad(),
        summary: text(s.summary), outline: list(s.outline, 7).map(line => { const o = rec(line); return { aliyah: int(o.aliyah), line: text(o.line, 2000) }; }),
        ...(s.credit === undefined ? {} : { credit: text(s.credit, 240) }), ...optional(s.importedFrom), changedAt: date(s.changedAt), href: href(s.href) }; }),
  };
}
function themeOf(raw: unknown): GuideTextTheme {
  const t = rec(raw);
  return { id: text(t.id, 200), title: text(t.title, 2000), intro: text(t.intro, 40000), notes: list(t.notes, 2000).map(n => { const note = rec(n);
    return { verseRef: text(note.verseRef, 100), body: text(note.body, 40000), sources: list(note.sources, 200).map(x => ({ ref: text(rec(x).ref, 400) })) }; }) };
}
export function parseGuideText(value: unknown): GuideText {
  const r = rec(value); if (r.ok !== true) return bad();
  const g = rec(r.guide), label = rec(g.label), body = rec(g.body);
  return { kind: kind(g.kind), readingKey: text(g.readingKey, 160), version: int(g.version), hold: g.hold === true, rabbiName: text(g.rabbiName, 240),
    label: { origin: label.origin === "rabbi" ? "rabbi" : "claude", reviewed: label.reviewed === true, ...optional(label.importedFrom) },
    body: { ...(body.overview === undefined ? {} : { overview: text(body.overview, 40000) }), themes: list(body.themes, 200).map(themeOf) }, changedAt: date(g.changedAt) };
}

async function call(path: string, body?: unknown, signal?: AbortSignal): Promise<{ status: number; value: unknown }> {
  let response: Response;
  try {
    response = await gatedFetch(path, { method: body === undefined ? "GET" : "POST", credentials: "same-origin", cache: "no-store", redirect: "error", referrerPolicy: "same-origin", signal,
      headers: body === undefined ? { accept: "application/json" } : { accept: "application/json", "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  } catch { return bad(); }
  if (!response.ok && response.status !== 409) throw new PortalRequestError([401, 403, 404, 429].includes(response.status) ? response.status : 503);
  if (!response.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return bad();
  try { return { status: response.status, value: await response.json() }; } catch { return bad(); }
}
function outcome({ status, value }: { status: number; value: unknown }): WriteOutcome {
  const r = rec(value);
  if (status === 200 && r.ok === true) return { ok: true };
  if (status === 409 && r.ok === false) return { ok: false, code: typeof r.code === "string" ? r.code.slice(0, 40) : "unknown" };
  return bad();
}

export const guideAdminApi = {
  async overview(signal?: AbortSignal) { const r = await call("/api/admin/guides", undefined, signal); return r.status === 200 ? parseOverview(r.value) : bad(); },
  async guideText(row: { kind: string; readingKey: string; version: number }, signal?: AbortSignal) {
    const query = new URLSearchParams({ kind: row.kind, readingKey: row.readingKey, version: String(row.version) });
    const r = await call(`/api/admin/guides/text?${query}`, undefined, signal); return r.status === 200 ? parseGuideText(r.value) : bad();
  },
  withdrawDiscussion: async (slug: string, revision: number) => outcome(await call("/api/admin/guides/discussions/withdraw", { slug, revision })),
  approveSummary: async (reading: string, revision: number) => outcome(await call("/api/admin/guides/summaries/approve", { reading, revision })),
  withdrawSummary: async (reading: string, revision: number) => outcome(await call("/api/admin/guides/summaries/withdraw", { reading, revision })),
};
