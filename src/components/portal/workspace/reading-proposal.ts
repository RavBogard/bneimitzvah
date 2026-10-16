import { PortalRequestError } from "../api";
import type { Assigned } from "./api";

export type ReadingKind = "torah" | "haftarah";
export type StaffMode = "admin" | "tutor";
export type CalendarChoice = { pick: string; label: string; ref: string | null };
type Source = { sourceFetchedAt: number | null; sourceStatus: "available" | "unavailable"; warning: "calendar-source-unavailable" | null };
export type PreparedReading = Source & { status: "prepared"; binding: string; kind: ReadingKind; basis: "triennial" | "selection" | "full" | "custom"; ranges: string[]; verseCount: number; maftir: { ref: string; reason: string | null } | null };
export type NeedsSelection = Source & { status: "needs-selection"; date: string; calendar: "diaspora" | "israel"; parashah: string | null; choices: CalendarChoice[]; haftarah: string | null };
export type ReadingProposal = PreparedReading | NeedsSelection;
const bad = (): never => { throw new PortalRequestError(503); };
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key))) return bad();
  return value as Record<string, unknown>;
}
function text(value: unknown, max = 160): string { if (typeof value !== "string" || !value.trim() || value.length > max || /[\x00-\x1f\x7f]/.test(value)) return bad(); return value; }
function source(row: Record<string, unknown>): Source {
  if (row.sourceStatus !== "available" && row.sourceStatus !== "unavailable") return bad();
  if (row.sourceStatus === "available" ? !Number.isFinite(row.sourceFetchedAt) || !Number.isFinite(new Date(Number(row.sourceFetchedAt)).getTime()) || Number(row.sourceFetchedAt) < 0 || row.warning !== null
    : row.sourceFetchedAt !== null || row.warning !== "calendar-source-unavailable") return bad();
  return { sourceStatus: row.sourceStatus, sourceFetchedAt: row.sourceFetchedAt as number | null, warning: row.warning as Source["warning"] };
}
function aliyot(value: unknown): { n: number | "M"; ref: string }[] {
  if (!Array.isArray(value) || value.length > 8) return bad();
  const rows = value.map(value => {
    const row = object(value, ["n", "ref", "verses", "reason"]);
    if (row.n !== "M" && (!Number.isInteger(row.n) || Number(row.n) < 1 || Number(row.n) > 7)) return bad();
    if (row.verses !== null && (!Number.isInteger(row.verses) || Number(row.verses) < 1 || Number(row.verses) > 1000)) return bad();
    if (row.reason !== null) text(row.reason);
    return { n: row.n as number | "M", ref: text(row.ref, 100) };
  });
  if (new Set(rows.map(row => row.n)).size !== rows.length) return bad();
  return rows;
}
export function parseReadingProposal(value: unknown, kind: ReadingKind, ceremonyDate: string): ReadingProposal {
  if (!value || typeof value !== "object" || Array.isArray(value)) return bad();
  const status = (value as Record<string, unknown>).status;
  const keys = ["status", "requiresConfirmation", "sourceFetchedAt", "sourceStatus", "warning", "toConfirm"];
  const row = object(value, status === "prepared" ? [...keys, "binding", "kind", "basis", "ranges", "verseCount", "maftir"] : [...keys, "snapshot"]);
  if (row.requiresConfirmation !== true || !Array.isArray(row.toConfirm) || row.toConfirm.length !== 3 || row.toConfirm.join(",") !== "torah,entryCap,nusach") return bad();
  const metadata = source(row);
  if (status === "prepared") {
    if (row.kind !== kind || !["triennial", "selection", "full", "custom"].includes(String(row.basis)) || !Array.isArray(row.ranges) || row.ranges.length < 1 || row.ranges.length > 32
      || !Number.isInteger(row.verseCount) || Number(row.verseCount) < 1 || Number(row.verseCount) > 1000) return bad();
    const binding = text(row.binding, 48000); if (!/^v1\.[A-Za-z0-9_-]+$/.test(binding)) return bad();
    let maftir: PreparedReading["maftir"] = null;
    if (row.maftir !== null) { const m = object(row.maftir, ["ref", "reason"]); maftir = { ref: text(m.ref, 100), reason: m.reason === null ? null : text(m.reason) }; }
    return { status, ...metadata, binding, kind, basis: row.basis as PreparedReading["basis"], ranges: row.ranges.map(ref => text(ref, 100)), verseCount: Number(row.verseCount), maftir };
  }
  if (status !== "needs-selection") return bad();
  const snapshot = object(row.snapshot, ["date", "calendar", "haftarah", "reading"]);
  if (snapshot.date !== ceremonyDate || !["diaspora", "israel"].includes(String(snapshot.calendar))) return bad();
  const choices: CalendarChoice[] = []; let parashah: string | null = null;
  if (snapshot.reading !== null) {
    const r = object(snapshot.reading, ["parashah", "type", "source", "aliyot", "triennial"]);
    parashah = text(r.parashah); text(r.type); if (r.source !== "Hebcal") return bad();
    const rows = aliyot(r.aliyot);
    if (rows.some(row => row.n !== "M")) choices.push({ pick: "full", label: "Full calendar reading", ref: null });
    if (r.triennial !== null) {
      const tri = object(r.triennial, ["year", "aliyot"]);
      if (tri.year !== null && ![1, 2, 3].includes(Number(tri.year))) return bad();
      if (aliyot(tri.aliyot).some(row => row.n !== "M")) choices.push({ pick: "triennial", label: tri.year === null ? "Triennial reading" : `Triennial year ${tri.year}`, ref: null });
    }
    rows.forEach(row => choices.push({ pick: `aliyah:${row.n}`, label: row.n === "M" ? "Calendar maftir" : `Aliyah ${row.n}`, ref: row.ref }));
  }
  return { status, ...metadata, date: ceremonyDate, calendar: snapshot.calendar as NeedsSelection["calendar"], parashah, choices, haftarah: snapshot.haftarah === null ? null : text(snapshot.haftarah, 100) };
}

export function readingBaseline(value: Assigned, kind: ReadingKind): string {
  const row = value.readings.find(row => row.kind === kind);
  return JSON.stringify([value.mode, value.student.id, value.student.revision, value.student.ceremonyDate, kind, row ? [row.id, row.revision, row.needsReview] : null]);
}
export function customReadingRanges(value: string): string[] {
  const ranges = value.split(/\r?\n/).map(row => row.trim()).filter(Boolean);
  if (ranges.length < 1 || ranges.length > 32 || ranges.some(ref => ref.length > 100 || /[\x00-\x1f\x7f]/.test(ref))) throw new PortalRequestError(400);
  return ranges;
}
