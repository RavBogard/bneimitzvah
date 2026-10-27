import type { StudyKind } from "../workspace/study/api";
import { canonicalReadingRef } from "../../../lib/readings/reading-ref";
import { namedReading } from "../../../lib/readings/named-readings";
import { isSaturday, shabbatOnOrAfter } from "../../../lib/readings/public-shabbat";
import { isPortionPick, type PortionPick } from "../../../lib/print/portions";

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
 * - `/read?ref=<canonical ref>&kind=torah|haftarah` (any passage);
 * - `/read?saved=<id>` (a member's own saved reading: its passage comes from the member's account, never the address).
 * A `ref` address may add `&mark=<canonical ref>`: the verses of a selection, marked in the whole portion it came from (1.7).
 * Any of them may add `&verse=<n>` (1-based, within the passage shown: that verse opens selected, in the
 * player when recordings are on) and `&lens=study`.
 * A Shabbat's Torah may add `&pick=` (release 1.9 N3), the words /print takes: `triennial`, `aliyah-1` to `aliyah-7` or `maftir`
 * (`full`, the whole portion, is left out). An aliyah or the maftir opens on that section; the triennial opens that reading.
 */
export type ReadTarget = Readonly<{ mode: "week"; date: string | null; kind: StudyKind | null }>
  | Readonly<{ mode: "named"; slug: string; passage: number }>
  | Readonly<{ mode: "ref"; ref: string; kind: StudyKind; mark?: string }>
  | Readonly<{ mode: "saved"; id: string }>;
export type ReadAddress = Readonly<{ target: ReadTarget | null; verse: number | null; study: boolean; pick?: PortionPick }>;
export const READ_VERSE_MAX = 1000;

const SAVED_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const kindOf = (value: string | null): StudyKind | null => value === "torah" || value === "haftarah" ? value : null;
const positive = (value: string | null, max: number): number | null => value !== null && /^[1-9]\d{0,3}$/.test(value) && Number(value) <= max ? Number(value) : null;

/** Reads a /read query. `target` is null when the address names something that cannot be opened. */
export function parseReadAddress(search: string): ReadAddress {
  let params: URLSearchParams;
  try { params = new URLSearchParams(search); } catch { return { target: null, verse: null, study: false }; }
  const verse = positive(params.get("verse"), READ_VERSE_MAX), study = params.get("lens") === "study";
  const slug = params.get("reading"), ref = params.get("ref"), saved = params.get("saved");
  if (saved !== null) return { target: SAVED_ID.test(saved) ? { mode: "saved", id: saved.toLowerCase() } : null, verse, study };
  if (slug !== null) {
    const reading = namedReading(slug), passage = params.get("passage") === null ? 1 : positive(params.get("passage"), 64);
    return { target: reading && passage !== null && passage <= reading.passages.length ? { mode: "named", slug: reading.slug, passage } : null, verse, study };
  }
  if (ref !== null) {
    const kind = kindOf(params.get("kind")), canonical = kind && canonicalReadingRef(ref, kind);
    // The marked selection must itself be a valid passage of the same kind inside this one; anything else is simply not marked.
    const markParam = params.get("mark"), marked = canonical && markParam !== null ? canonicalReadingRef(markParam, canonical.kind) : null;
    const inside = canonical && marked && marked.verses.every(item => canonical.verses.includes(item));
    return { target: canonical ? { mode: "ref", ref: canonical.ref, kind: canonical.kind, ...inside ? { mark: marked.ref } : {} } : null, verse, study };
  }
  const date = params.get("date");
  let shabbat: string | null = null;
  if (date !== null && /^\d{4}-\d{2}-\d{2}$/.test(date)) { try { shabbat = isSaturday(date) ? date : shabbatOnOrAfter(date); } catch { shabbat = null; } }
  const kind = kindOf(params.get("kind")), pick = params.get("pick");
  // Only a Shabbat's Torah has aliyot; anything else carries no pick.
  return { target: { mode: "week", date: shabbat, kind }, verse, study, ...kind !== "haftarah" && isPortionPick(pick) && pick !== "full" ? { pick } : {} };
}

/** The shareable address of a target; this week's Lein with nothing selected is plain /read. */
export function readAddress(target: ReadTarget, options: { today?: string | null; verse?: number | null; study?: boolean; pick?: PortionPick | null } = {}): string {
  const entries: [string, string][] = [];
  if (target.mode === "week") {
    if (target.date && target.date !== options.today) entries.push(["date", target.date]);
    if (target.kind === "haftarah") entries.push(["kind", "haftarah"]);
    else if (options.pick && options.pick !== "full") entries.push(["pick", options.pick]);
  } else if (target.mode === "named") {
    entries.push(["reading", target.slug]);
    if (target.passage !== 1) entries.push(["passage", String(target.passage)]);
  } else if (target.mode === "saved") entries.push(["saved", target.id]);
  else entries.push(["ref", target.ref], ["kind", target.kind], ...target.mark ? [["mark", target.mark] as [string, string]] : []);
  if (options.verse) entries.push(["verse", String(options.verse)]);
  if (options.study) entries.push(["lens", "study"]);
  return entries.length ? `/read?${query(entries)}` : "/read";
}

/**
 * Coming back from "Sign in to save" (release 1.9 N20). The way back to the reader adds `save=1`, and, for a selection
 * from Choose verses, `choose=<ranges>`, to the reading's own address: the reader then opens choosing with those verses
 * and offers Save at once. Both are read once and left out of the address the page writes back; the verses are checked
 * again against the passage on screen, so anything else is simply not chosen.
 */
export type SaveReturn = Readonly<{ choose: readonly string[] | null; offer: boolean }>;
const CHOSEN = /^[A-Za-z0-9 :;,.-]{1,1000}$/;
export function parseSaveReturn(search: string): SaveReturn {
  let params: URLSearchParams;
  try { params = new URLSearchParams(search); } catch { return { choose: null, offer: false }; }
  const offer = params.getAll("save").length === 1 && params.get("save") === "1", chosen = params.getAll("choose");
  const choose = offer && chosen.length === 1 && CHOSEN.test(chosen[0]) ? chosen[0].split("; ").filter(Boolean) : null;
  return { choose: choose?.length ? choose : null, offer };
}
/** A reading's address with the save offer (and a selection's verses) added, for the way back from sign-in. */
export function saveReturnAddress(address: string, ranges?: readonly string[]): string {
  const mark = address.indexOf("?"), path = mark === -1 ? address : address.slice(0, mark), params = new URLSearchParams(mark === -1 ? "" : address.slice(mark + 1));
  params.delete("save"); params.delete("choose");
  if (ranges?.length) params.set("choose", ranges.join("; "));
  params.set("save", "1");
  return `${path}?${params.toString()}`;
}
/** The public calendar: no query at all (a closed keyset of none). */
export const publicCalendarPath = () => "/api/public/calendar";
