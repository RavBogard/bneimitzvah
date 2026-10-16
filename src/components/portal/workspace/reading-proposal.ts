import { PortalRequestError } from "../api";
import { readingDate, serviceSlot } from "../../../lib/readings/reading-date";
import type { Assigned, Reading } from "./api";
import { aliyahStarts } from "../../../lib/readings/aliyah-starts";
import { expandReadingRanges,parseCeremonyDate } from "../../../lib/readings/ranges";
import { TANAKH_VERSE_COUNTS } from "../../../lib/readings/catalog";

export type ReadingKind = "torah" | "haftarah";
export type StaffMode = "admin" | "tutor";
export type CalendarChoice = { pick: string; label: string; ref: string | null };
export const fallbackLabels = {
  "unknown-slot": "The service slot is not yet set. Choose custom references; no calendar date has been assumed.",
  "calendar-date-out-of-range": "The following reading date is outside the supported date range. Choose custom references.",
  "non-saturday": "This ceremony is not on Saturday. Choose custom references; no calendar date has been assumed.",
  holiday: "The calendar date has a holiday reading. Choose custom references after checking the congregation's practice.",
  multiple: "The calendar returned multiple readings. Choose custom references after checking the congregation's practice.",
  nonregular: "A regular Shabbat portion could not be established. Choose custom references.",
  missing: "No regular calendar reading was returned. Choose custom references.",
  "calendar-source-unavailable": "The calendar source is unavailable. Verify custom references independently."
} as const;
type Source = { ceremonyDate: string; serviceSlot: "morning"|"havdalah"|"unknown"; readingDate: string|null; manualFallback: keyof typeof fallbackLabels|null; sourceFetchedAt: number | null; sourceStatus: "available" | "unavailable" | "not-requested" | "preserved"; warning: "calendar-source-unavailable" | null };
export type PreparedReading = Source & { status: "prepared"; binding: string; kind: ReadingKind; basis: "triennial" | "selection" | "full" | "custom"; ranges: string[]; verseCount: number; maftir: { ref: string; reason: string | null } | null;
  aliyahStarts:string[]|null;preparationMode:"replace"|"current-assignment";preserved:{confirmationDate:string|null;needsReview:boolean;source:Reading["source"]}|null };
export type NeedsSelection = Source & { status: "needs-selection"; date: string; calendar: "diaspora" | "israel"; parashah: string | null; choices: CalendarChoice[]; haftarah: string | null };
export type ReadingProposal = PreparedReading | NeedsSelection;
const bad = (): never => { throw new PortalRequestError(503); };
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key))) return bad();
  return value as Record<string, unknown>;
}
function text(value: unknown, max = 160): string { if (typeof value !== "string" || !value.trim() || value.length > max || /[\x00-\x1f\x7f]/.test(value)) return bad(); return value; }
function source(row: Record<string, unknown>, ceremonyDate: string): Source {
  let slot: Source["serviceSlot"], derived: ReturnType<typeof readingDate>;
  try{slot=serviceSlot(row.serviceSlot);derived=readingDate(ceremonyDate,slot);}catch{return bad();}
  if(row.ceremonyDate!==ceremonyDate || row.readingDate!==derived.readingDate || (row.manualFallback!==null && !Object.hasOwn(fallbackLabels,String(row.manualFallback))) || (derived.manualFallback!==null && row.manualFallback!==derived.manualFallback))return bad();
  if(row.sourceStatus==="preserved"){
    if(row.preparationMode!=="current-assignment" || row.sourceFetchedAt!==null || row.warning!==null)return bad();
    return {ceremonyDate,serviceSlot:slot,readingDate:derived.readingDate,manualFallback:row.manualFallback as Source["manualFallback"],sourceStatus:"preserved" as const,sourceFetchedAt:null,warning:null};
  }
  if (row.sourceStatus !== "available" && row.sourceStatus !== "unavailable" && row.sourceStatus !== "not-requested") return bad();
  if (row.sourceStatus === "available" ? !Number.isFinite(row.sourceFetchedAt) || !Number.isFinite(new Date(Number(row.sourceFetchedAt)).getTime()) || Number(row.sourceFetchedAt) < 0 || row.warning !== null
    : row.sourceFetchedAt !== null || row.warning !== (row.sourceStatus==="unavailable"?"calendar-source-unavailable":null)) return bad();
  if((row.sourceStatus==="not-requested")!==(derived.readingDate===null) || (row.sourceStatus==="unavailable" && row.manualFallback!=="calendar-source-unavailable"))return bad();
  return { ceremonyDate, serviceSlot:slot, readingDate:derived.readingDate, manualFallback:row.manualFallback as Source["manualFallback"], sourceStatus: row.sourceStatus, sourceFetchedAt: row.sourceFetchedAt as number | null, warning: row.warning as Source["warning"] };
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
  const keys = ["ceremonyDate", "serviceSlot", "readingDate", "manualFallback", "status", "requiresConfirmation", "sourceFetchedAt", "sourceStatus", "warning", "toConfirm"];
  const row = object(value, status === "prepared" ? [...keys, "binding", "kind", "basis", "ranges", "verseCount", "maftir", "aliyahStarts", "preparationMode", "preserved"] : [...keys, "snapshot"]);
  if (row.requiresConfirmation !== true || !Array.isArray(row.toConfirm) || row.toConfirm.length !== 3 || row.toConfirm.join(",") !== "torah,entryCap,nusach") return bad();
  const metadata = source(row,ceremonyDate);
  if (status === "prepared") {
    if (row.kind !== kind || !["triennial", "selection", "full", "custom"].includes(String(row.basis)) || !Array.isArray(row.ranges) || row.ranges.length < 1 || row.ranges.length > 32
      || !Number.isInteger(row.verseCount) || Number(row.verseCount) < 1 || Number(row.verseCount) > 1000) return bad();
    const binding = text(row.binding, 48000); if (!/^v1\.[A-Za-z0-9_-]+$/.test(binding)) return bad();
    let maftir: PreparedReading["maftir"] = null;
    if (row.maftir !== null) { const m = object(row.maftir, ["ref", "reason"]); maftir = { ref: text(m.ref, 100), reason: m.reason === null ? null : text(m.reason) }; }
    const ranges=row.ranges.map(ref=>text(ref,100));let cuts:string[]|null;
    try{const verses=expandReadingRanges(ranges,kind,TANAKH_VERSE_COUNTS);if(verses.length!==row.verseCount)return bad();cuts=aliyahStarts(kind,row.aliyahStarts,verses);}catch{return bad();}
    let preserved:PreparedReading["preserved"]=null;
    if(row.preparationMode==="current-assignment"){
      if(kind!=="torah" || metadata.sourceStatus!=="preserved" || maftir!==null)return bad();
      const p=object(row.preserved,["confirmationDate","needsReview","source"]),s=object(p.source,["status","fetchedAt","date","calendar","attribution"]);
      if(typeof p.needsReview!=="boolean" || !["available","unavailable","unknown"].includes(String(s.status)) || s.fetchedAt!==null && (typeof s.fetchedAt!=="number" || !Number.isFinite(s.fetchedAt) || s.fetchedAt<0) || ![null,"diaspora","israel"].includes(s.calendar as string|null))return bad();
      let confirmationDate:string|null=null,date:string|null=null,attribution:Reading["source"]["attribution"]=null;
      try{confirmationDate=p.confirmationDate===null?null:parseCeremonyDate(p.confirmationDate);date=s.date===null?null:parseCeremonyDate(s.date);}catch{return bad();}
      if(s.attribution!==null){const a=object(s.attribution,["name","url"]);if(a.name!=="Hebcal" || a.url!=="https://www.hebcal.com/")return bad();attribution={name:"Hebcal",url:"https://www.hebcal.com/"};}
      preserved={confirmationDate,needsReview:p.needsReview,source:{status:s.status as Reading["source"]["status"],fetchedAt:s.fetchedAt as number|null,date,calendar:s.calendar as Reading["source"]["calendar"],attribution}};
    }else if(row.preparationMode!=="replace" || row.preserved!==null || metadata.sourceStatus==="preserved")return bad();
    return { status, ...metadata, binding, kind, basis: row.basis as PreparedReading["basis"], ranges, verseCount: Number(row.verseCount), maftir,aliyahStarts:cuts,preparationMode:row.preparationMode,preserved };
  }
  if (status !== "needs-selection") return bad();
  const snapshot = object(row.snapshot, ["date", "calendar", "haftarah", "reading"]);
  if (snapshot.date !== (metadata.readingDate??ceremonyDate) || !["diaspora", "israel"].includes(String(snapshot.calendar))) return bad();
  const choices: CalendarChoice[] = []; let parashah: string | null = null;
  if (snapshot.reading !== null) {
    const r = object(snapshot.reading, ["parashah", "type", "source", "aliyot", "triennial"]);
    parashah = text(r.parashah); text(r.type); if (r.source !== "Hebcal") return bad();
    const rows = aliyot(r.aliyot);
    if (metadata.manualFallback===null && rows.some(row => row.n !== "M")) choices.push({ pick: "full", label: "Full calendar reading", ref: null });
    if (r.triennial !== null) {
      const tri = object(r.triennial, ["year", "aliyot"]);
      if (tri.year !== null && ![1, 2, 3].includes(Number(tri.year))) return bad();
      if (metadata.manualFallback===null && aliyot(tri.aliyot).some(row => row.n !== "M")) choices.push({ pick: "triennial", label: tri.year === null ? "Triennial reading" : `Triennial year ${tri.year}`, ref: null });
    }
    if(metadata.manualFallback===null)rows.forEach(row => choices.push({ pick: `aliyah:${row.n}`, label: row.n === "M" ? "Calendar maftir" : `Aliyah ${row.n}`, ref: row.ref }));
  }
  return { status, ...metadata, date: snapshot.date as string, calendar: snapshot.calendar as NeedsSelection["calendar"], parashah, choices, haftarah: snapshot.haftarah === null ? null : text(snapshot.haftarah, 100) };
}

export function readingBaseline(value: Assigned, kind: ReadingKind): string {
  const row = value.readings.find(row => row.kind === kind);
  return JSON.stringify([value.mode, value.student.id, value.student.revision, value.student.ceremonyDate, kind, row ? [row.id, row.revision, row.needsReview,row.ranges,row.aliyahStarts] : null]);
}
export function customReadingRanges(value: string): string[] {
  const ranges = value.split(/\r?\n/).map(row => row.trim()).filter(Boolean);
  if (ranges.length < 1 || ranges.length > 32 || ranges.some(ref => ref.length > 100 || /[\x00-\x1f\x7f]/.test(ref))) throw new PortalRequestError(400);
  return ranges;
}
