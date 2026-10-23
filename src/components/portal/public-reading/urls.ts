import type { StudyKind } from "../workspace/study/api";
import { canonicalReadingRef } from "../../../lib/readings/reading-ref";
import { namedReading } from "../../../lib/readings/named-readings";
import { isSaturday, shabbatOnOrAfter } from "../../../lib/readings/public-shabbat";

/**
 * Every signed-out reading URL, in one place: the /api/public requests the reader makes (and the 1.5
 * offline packer will make, byte for byte), and the /read page addresses people share.
 *
 * A passage is named by a Shabbat (`{ by: "date" }`, the weekly page) or by a canonical reading ref
 * (`{ by: "ref" }`, "Any reading"). The query keys and their order are the server's closed keysets.
 */
export type ReadingSelector = Readonly<{ by: "date"; date: string }> | Readonly<{ by: "ref"; ref: string; kind: StudyKind }>;
const query = (entries: [string, string][]) => new URLSearchParams(entries).toString();
function named(selector: ReadingSelector, kind: StudyKind): [string, string][] {
  if (selector.by === "date") return [["date", selector.date], ["kind", kind]];
  if (selector.kind !== kind) throw new Error("A ref names one kind of passage");
  return [["ref", selector.ref], ["kind", kind]];
}
export const publicReadingPath = (selector: ReadingSelector) =>
  `/api/public/reading?${query(selector.by === "date" ? [["date", selector.date]] : [["ref", selector.ref], ["kind", selector.kind]])}`;
export const publicTextPath = (selector: ReadingSelector, kind: StudyKind, offset: number) => `/api/public/text?${query([...named(selector, kind), ["offset", String(offset)]])}`;
export const publicWordAidsPath = (selector: ReadingSelector, kind: StudyKind, verse: number) => `/api/public/word-aids?${query([...named(selector, kind), ["verse", String(verse)]])}`;
export const publicWordDetailsPath = (selector: ReadingSelector, kind: StudyKind, verse: number, word: number) =>
  `/api/public/word-details?${query([...named(selector, kind), ["verse", String(verse)], ["word", String(word)]])}`;
export const publicShortPath = (selector: ReadingSelector, kind: StudyKind, offset: number) => `/api/public/reference/short?${query([...named(selector, kind), ["offset", String(offset)]])}`;
/** Stable identity of a selector, for cache and page keys. */
export const selectorKey = (selector: ReadingSelector) => selector.by === "date" ? `date:${selector.date}` : `ref:${selector.kind}:${selector.ref}`;

/**
 * The /read page address. One of:
 * - `/read` (this week) or `/read?date=YYYY-MM-DD` (another Shabbat), optionally `&kind=haftarah`;
 * - `/read?reading=<slug>` (a named reading from the catalog), optionally `&passage=<n>` (1-based);
 * - `/read?ref=<canonical ref>&kind=torah|haftarah` (any passage).
 * Any of them may add `&verse=<n>` (1-based, within the passage shown: that verse opens selected, in the
 * player when recordings are on) and `&lens=study`.
 */
export type ReadTarget = Readonly<{ mode: "week"; date: string | null; kind: StudyKind | null }>
  | Readonly<{ mode: "named"; slug: string; passage: number }>
  | Readonly<{ mode: "ref"; ref: string; kind: StudyKind }>;
export type ReadAddress = Readonly<{ target: ReadTarget | null; verse: number | null; study: boolean }>;
export const READ_VERSE_MAX = 1000;

const kindOf = (value: string | null): StudyKind | null => value === "torah" || value === "haftarah" ? value : null;
const positive = (value: string | null, max: number): number | null => value !== null && /^[1-9]\d{0,3}$/.test(value) && Number(value) <= max ? Number(value) : null;

/** Reads a /read query. `target` is null when the address names something that cannot be opened. */
export function parseReadAddress(search: string): ReadAddress {
  let params: URLSearchParams;
  try { params = new URLSearchParams(search); } catch { return { target: null, verse: null, study: false }; }
  const verse = positive(params.get("verse"), READ_VERSE_MAX), study = params.get("lens") === "study";
  const slug = params.get("reading"), ref = params.get("ref");
  if (slug !== null) {
    const reading = namedReading(slug), passage = params.get("passage") === null ? 1 : positive(params.get("passage"), 64);
    return { target: reading && passage !== null && passage <= reading.passages.length ? { mode: "named", slug: reading.slug, passage } : null, verse, study };
  }
  if (ref !== null) {
    const kind = kindOf(params.get("kind")), canonical = kind && canonicalReadingRef(ref, kind);
    return { target: canonical ? { mode: "ref", ref: canonical.ref, kind: canonical.kind } : null, verse, study };
  }
  const date = params.get("date");
  let shabbat: string | null = null;
  if (date !== null && /^\d{4}-\d{2}-\d{2}$/.test(date)) { try { shabbat = isSaturday(date) ? date : shabbatOnOrAfter(date); } catch { shabbat = null; } }
  return { target: { mode: "week", date: shabbat, kind: kindOf(params.get("kind")) }, verse, study };
}

/** The shareable address of a target; this week's Lein with nothing selected is plain /read. */
export function readAddress(target: ReadTarget, options: { today?: string | null; verse?: number | null; study?: boolean } = {}): string {
  const entries: [string, string][] = [];
  if (target.mode === "week") {
    if (target.date && target.date !== options.today) entries.push(["date", target.date]);
    if (target.kind === "haftarah") entries.push(["kind", "haftarah"]);
  } else if (target.mode === "named") {
    entries.push(["reading", target.slug]);
    if (target.passage !== 1) entries.push(["passage", String(target.passage)]);
  } else entries.push(["ref", target.ref], ["kind", target.kind]);
  if (options.verse) entries.push(["verse", String(options.verse)]);
  if (options.study) entries.push(["lens", "study"]);
  return entries.length ? `/read?${query(entries)}` : "/read";
}
