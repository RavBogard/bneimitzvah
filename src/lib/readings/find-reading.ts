import { NAMED_READINGS, type NamedReading, type NamedReadingGroup } from "./named-readings";
import { preparationHref } from "../learn/passage-preparation";
import { TANAKH_VERSE_COUNTS } from "./catalog";
import { canonicalReadingRef } from "./reading-ref";
import { shabbatOnOrAfter } from "./public-shabbat";
import { parseCeremonyDate } from "./ranges";
import type { CalendarRow } from "./calendar";
import { readAddress, saveReturnAddress } from "../../components/portal/public-reading/urls";
import type { StudyKind } from "../../components/portal/workspace/study/api";

/**
 * Find a reading: one text field with three kinds of answer. A name (a parashah, a holiday or a special Shabbat), a date (the Shabbat
 * on or after it) or verses (a reference the reader can open). Pure and synchronous: the calendar is passed in, so the field answers
 * names and verses even while the calendar is still loading or has failed.
 */
export type FindResult =
  | Readonly<{ kind: "named"; slug: string; name: string; group: NamedReadingGroup; next: string | null }>
  | Readonly<{ kind: "date"; date: string; name: string | null }>
  | Readonly<{ kind: "ref"; ref: string; readingKind: StudyKind }>;
export const FIND_LIMIT = 8;
export const NO_MATCH_LINE = (text: string) => `No reading called ${text}. Try a parashah, a holiday, a date like Nov 14, or verses like Genesis 25:19.`;

/** Lower case with apostrophes, hyphens, spaces, other punctuation and diacritics gone: "Beha'alotcha" and "behaalotcha" are one name. */
export const normalizeName = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
function validDate(year: number, month: number, day: number): string | null {
  const text = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  try { return parseCeremonyDate(text); } catch { return null; }
}
/** A date the text names; a date with no year is the next occurrence on or after `today`. Null when the text is not a date. */
export function parseDateText(text: string, today: string): string | null {
  const t = text.trim().replace(/\s+/g, " ");
  const year = Number(today.slice(0, 4));
  const withYear = (month: number, day: number, given: string | undefined): string | null => {
    if (given !== undefined) return validDate(given.length === 2 ? 2000 + Number(given) : Number(given), month, day);
    const thisYear = validDate(year, month, day);
    if (thisYear && thisYear >= today) return thisYear;
    return validDate(year + 1, month, day);
  };
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (m) return validDate(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}|\d{2}))?$/.exec(t);
  if (m) return withYear(Number(m[1]), Number(m[2]), m[3]);
  m = /^([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?$/i.exec(t);
  if (m) {
    const word = m[1].toLowerCase(), month = MONTHS.findIndex(name => name.startsWith(word));
    return month === -1 ? null : withYear(month + 1, Number(m[2]), m[3]);
  }
  return null;
}

const bookKey = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "")
  .replace(/^1(?=[a-z])/, "i").replace(/^2(?=[a-z])/, "ii");
const BOOK_BY_KEY: ReadonlyMap<string, string> = new Map(Object.keys(TANAKH_VERSE_COUNTS).map(name => [bookKey(name), name]));
/**
 * Verses as people write them: "Genesis 25:19-26:5", "Genesis 25:19-34", "Genesis 25:19", "Isaiah 54" or "Isaiah 54-55" (whole chapters),
 * with "1 Samuel" for "I Samuel". Returns the canonical reference string and the kind it can be opened as (Torah first, then the
 * Prophets), or null.
 */
function lenientRef(text: string): { ref: string; kind: StudyKind } | null {
  const m = /^(.+?)\s+(\d+)(?::(\d+))?(?:\s*[-–]\s*(?:(\d+):)?(\d+))?$/.exec(text.trim().replace(/\s+/g, " "));
  if (!m) return null;
  const book = BOOK_BY_KEY.get(bookKey(m[1]));
  if (!book) return null;
  const chapters = TANAKH_VERSE_COUNTS[book], c1 = Number(m[2]);
  let v1: number, c2: number, v2: number;
  if (m[3] === undefined) { // whole chapters: "Isaiah 54" or "Isaiah 54-55"
    if (m[4] !== undefined) return null;
    c2 = m[5] !== undefined ? Number(m[5]) : c1; v1 = 1;
    if (c1 < 1 || c2 < c1 || c2 > chapters.length) return null;
    v2 = chapters[c2 - 1];
  } else {
    v1 = Number(m[3]);
    if (m[5] === undefined) { c2 = c1; v2 = v1; }
    else if (m[4] !== undefined) { c2 = Number(m[4]); v2 = Number(m[5]); }
    else { c2 = c1; v2 = Number(m[5]); }
  }
  if (c1 < 1 || c1 > chapters.length || c2 < c1 || c2 > chapters.length || v1 < 1 || v1 > chapters[c1 - 1] || v2 < 1 || v2 > chapters[c2 - 1]) return null;
  const ref = c1 === c2 && v1 === v2 ? `${book} ${c1}:${v1}` : c1 === c2 ? `${book} ${c1}:${v1}-${v2}` : `${book} ${c1}:${v1}-${c2}:${v2}`;
  for (const kind of ["torah", "haftarah"] as const) if (canonicalReadingRef(ref, kind)) return { ref, kind };
  return null;
}

/** At most eight answers: an exact name, a date, names that start with the text (parashiyot in Torah order, then the rest), then verses. */
export function findReadings(text: string, context: { calendar: readonly CalendarRow[]; today: string }): FindResult[] {
  const query = text.trim();
  if (!query) return [];
  const key = normalizeName(query), { calendar, today } = context;
  const nextOf = (name: string): string | null => {
    const wanted = normalizeName(name);
    return calendar.find(row => row.date >= today && row.name !== null && normalizeName(row.name) === wanted)?.date ?? null;
  };
  const named = (reading: (typeof NAMED_READINGS)[number]): FindResult => ({ kind: "named", slug: reading.slug, name: reading.name, group: reading.group, next: nextOf(reading.name) });
  const out: FindResult[] = [], seen = new Set<string>();
  const add = (result: FindResult) => { if (out.length < FIND_LIMIT) out.push(result); };
  if (key) {
    const exact = NAMED_READINGS.find(reading => normalizeName(reading.name) === key);
    if (exact) { seen.add(exact.slug); add(named(exact)); }
  }
  const day = parseDateText(query, today);
  if (day) {
    const date = shabbatOnOrAfter(day);
    add({ kind: "date", date, name: calendar.find(row => row.date === date)?.name ?? null });
  }
  if (key) {
    // The catalog lists parashiyot in Torah order, then special Shabbatot, festivals and fasts: its own order is the order wanted.
    for (const reading of NAMED_READINGS) if (!seen.has(reading.slug) && normalizeName(reading.name).startsWith(key)) add(named(reading));
  }
  const verses = lenientRef(query);
  if (verses) add({ kind: "ref", ref: verses.ref, readingKind: verses.kind });
  return out;
}

/** The preparation page for a named reading's first passage that can be prepared, or null. */
export function preparePassageHref(reading: NamedReading): string | null {
  for (const passage of reading.passages) {
    const canonical = canonicalReadingRef(passage.ref, passage.kind);
    if (canonical) return preparationHref(canonical.ref, canonical.kind);
  }
  return null;
}
/** Where a result opens: the reader's address, with the save offer when the person came to add a reading to My Readings. */
export function addressOf(result: FindResult, options: { study?: boolean; add?: boolean; prepare?: boolean } = {}): string {
  if (options.prepare) {
    // Learn's preparation page (for=prepare): a verse reference, or the named reading a name or a date lands on.
    if (result.kind === "ref") return preparationHref(result.ref, result.readingKind);
    const name = result.name, reading = result.kind === "named" ? NAMED_READINGS.find(row => row.slug === result.slug) : name ? NAMED_READINGS.find(row => normalizeName(row.name) === normalizeName(name)) : undefined;
    const href = reading ? preparePassageHref(reading) : null;
    if (href) return href;
  }
  const address = result.kind === "named" ? readAddress({ mode: "named", slug: result.slug, passage: 1 }, { study: options.study })
    : result.kind === "date" ? readAddress({ mode: "week", date: result.date, kind: null }, { study: options.study })
    : readAddress({ mode: "ref", ref: result.ref, kind: result.readingKind }, { study: options.study });
  return options.add ? saveReturnAddress(address) : address;
}
