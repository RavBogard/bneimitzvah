import { TANAKH_VERSE_COUNTS } from "./catalog";
import { hebcalRef, parseRange } from "./leyning.mjs";
import { NAMED_READINGS } from "./named-readings";
import { canonicalReadingRef, joinReadingRef, READING_REF_LIMITS } from "./reading-ref";
import { expandReadingRanges, type VerseCounts } from "./ranges";

/**
 * The model behind "Choose verses" (release 1.7, M2b). A selection is a set of verse refs inside the verses of
 * the passage on screen (`order`, in the passage's own order). It becomes the canonical "; "-joined groups a
 * saved reading stores: neighbouring verses merge into one range, separated verses stay separate groups, and
 * there are never more than 32 groups (the server's own cap). Pure and dependency-light so it is tested alone.
 */
export const SELECTION_MAX_GROUPS = READING_REF_LIMITS.segments;
type Kind = "torah" | "haftarah";

const VERSE = /^(.+) ([1-9]\d*):([1-9]\d*)$/;
function parseVerse(ref: string): { book: string; chapter: number; verse: number } | null {
  const match = VERSE.exec(ref);
  return match ? { book: match[1], chapter: Number(match[2]), verse: Number(match[3]) } : null;
}

/** The verse that follows this one in the book (the next chapter's first verse after a chapter's last), or null at the book's end. */
export function nextVerse(ref: string, counts: VerseCounts = TANAKH_VERSE_COUNTS): string | null {
  const at = parseVerse(ref), chapters = at && Object.hasOwn(counts, at.book) ? counts[at.book] : undefined;
  if (!at || !chapters || at.chapter > chapters.length) return null;
  if (at.verse < chapters[at.chapter - 1]) return `${at.book} ${at.chapter}:${at.verse + 1}`;
  return at.chapter < chapters.length ? `${at.book} ${at.chapter + 1}:1` : null;
}

function segment(first: string, last: string): string {
  const a = parseVerse(first)!, b = parseVerse(last)!;
  return hebcalRef({ k: a.book, b: `${a.chapter}:${a.verse}`, e: `${b.chapter}:${b.verse}` });
}

/** The canonical groups that cover `selected`, in the order of `order`; verses that follow one another in the book share a group. */
export function selectionRanges(order: readonly string[], selected: ReadonlySet<string>, counts: VerseCounts = TANAKH_VERSE_COUNTS): string[] {
  const groups: string[] = [];
  let first: string | null = null, last: string | null = null;
  const close = () => { if (first !== null && last !== null) groups.push(segment(first, last)); };
  for (const ref of order) {
    if (!selected.has(ref)) continue;
    if (last !== null && nextVerse(last, counts) === ref) { last = ref; continue; }
    close(); first = last = ref;
  }
  close();
  return groups;
}

export const countSelected = (order: readonly string[], selected: ReadonlySet<string>) => order.reduce((total, ref) => total + (selected.has(ref) ? 1 : 0), 0);

/** Whether the selection can be kept: at most 32 groups. */
export const fitsGroups = (order: readonly string[], selected: ReadonlySet<string>, counts: VerseCounts = TANAKH_VERSE_COUNTS) =>
  selectionRanges(order, selected, counts).length <= SELECTION_MAX_GROUPS;

/** One verse added or taken away. */
export function toggleVerse(selected: ReadonlySet<string>, ref: string): ReadonlySet<string> {
  const next = new Set(selected);
  if (!next.delete(ref)) next.add(ref);
  return next;
}

/** Every verse from `anchor` to `ref` (either way round, both included) added to the selection; verses already chosen stay. */
export function extendSelection(order: readonly string[], selected: ReadonlySet<string>, anchor: string, ref: string): ReadonlySet<string> {
  const from = order.indexOf(anchor), to = order.indexOf(ref);
  if (from < 0 || to < 0) return toggleVerse(selected, ref);
  const next = new Set(selected);
  for (let at = Math.min(from, to); at <= Math.max(from, to); at++) next.add(order[at]);
  return next;
}

/**
 * What a tap on a verse number does to the selection. A second tap after exactly one verse chosen, on a later verse, makes the range from the
 * first to it (F4: most people choosing verses mean "from this verse to that one"). Shift, or Select range, extends from the last verse tapped
 * (`anchor`); any other tap adds or takes away that one verse.
 */
export function tapVerse(order: readonly string[], selected: ReadonlySet<string>, anchor: string | null, ref: string, options: { shift?: boolean; rangeMode?: boolean } = {}): ReadonlySet<string> {
  const lone = selected.size === 1 ? [...selected][0] : null, afterOne = lone !== null && order.indexOf(ref) > order.indexOf(lone);
  const from = afterOne && !(options.shift || options.rangeMode) ? lone : anchor;
  return (afterOne || options.shift || options.rangeMode) && from !== null && from !== ref ? extendSelection(order, selected, from, ref) : toggleVerse(selected, ref);
}

/** The selection as people read it: "Genesis 12:1–3; 12:8–9" (a book already named by the group before it is not named again). */
export function selectionLine(ranges: readonly string[]): string {
  let book: string | null = null;
  return ranges.map(group => {
    const range = parseRange(group);
    const text = range && book === range.book ? group.slice(range.book.length + 1) : group;
    book = range ? range.book : null;
    return text.replace(/(\d)-(\d)/g, "$1–$2");
  }).join("; ");
}
/** "5 verses: Genesis 12:1–3; 12:8–9", "1 verse: Genesis 12:5", or "No verses chosen". */
export function countLine(count: number, ranges: readonly string[]): string {
  return count < 1 ? "No verses chosen" : `${count} ${count === 1 ? "verse" : "verses"}: ${selectionLine(ranges)}`;
}

/** The verses a stored or chosen list of groups names, as a set; null when the groups are not a valid passage of this kind. */
export function selectionFromRanges(ranges: readonly string[], kind: Kind): ReadonlySet<string> | null {
  try { return new Set(expandReadingRanges(ranges, kind, TANAKH_VERSE_COUNTS)); } catch { return null; }
}

/** The whole passage that holds a selection: the parashah or haftarah (a named reading's own passage), or, failing that, the chapters it spans. */
export type Portion = Readonly<{ ref: string; kind: Kind; name: string | null; whole: boolean }>;

const portionVerses = new Map<string, ReadonlySet<string>>();
function versesOf(ref: string, kind: Kind): ReadonlySet<string> {
  const key = `${kind}|${ref}`;
  let found = portionVerses.get(key);
  if (!found) {
    try { found = new Set(expandReadingRanges(ref.split("; "), kind, TANAKH_VERSE_COUNTS)); } catch { found = new Set(); }
    portionVerses.set(key, found);
  }
  return found;
}
// Parashiyot first, so a verse that a festival also reads is shown in its own week's portion.
const ORDERED = [...NAMED_READINGS.filter(reading => reading.group === "parashah"), ...NAMED_READINGS.filter(reading => reading.group !== "parashah")];

/** The named reading's own Torah or haftarah that holds every one of these verses, or null. Never a maftir or a part of a passage. */
export function wholePortionFor(kind: Kind, verses: readonly string[]): Portion | null {
  if (verses.length < 1) return null;
  for (const reading of ORDERED) for (const passage of reading.passages) {
    if (passage.kind !== kind || passage.label === "Maftir") continue;
    const held = versesOf(passage.ref, kind);
    if (held.size > 0 && verses.every(ref => held.has(ref))) return Object.freeze({ ref: passage.ref, kind, name: reading.name, whole: true });
  }
  return null;
}

/** Whole chapters from the first selected verse's chapter to the last one's, inside one book; null across books or past the verse limit. */
export function chapterSpanFor(kind: Kind, verses: readonly string[], counts: VerseCounts = TANAKH_VERSE_COUNTS): Portion | null {
  const parsed = verses.map(parseVerse);
  if (!parsed.length || parsed.some(row => row === null)) return null;
  const book = parsed[0]!.book;
  if (parsed.some(row => row!.book !== book) || !Object.hasOwn(counts, book)) return null;
  const chapters = parsed.map(row => row!.chapter), first = Math.min(...chapters), last = Math.max(...chapters);
  const ref = segment(`${book} ${first}:1`, `${book} ${last}:${counts[book][last - 1]}`);
  return canonicalReadingRef(ref, kind, counts) ? Object.freeze({ ref, kind, name: null, whole: false }) : null;
}

/** Where a selection can be seen and changed with its surroundings: its whole portion when there is one, else its chapters. */
export const contextFor = (kind: Kind, verses: readonly string[]): Portion | null => wholePortionFor(kind, verses) ?? chapterSpanFor(kind, verses);

/** The 1-based place of a verse in a passage's own order, for the `verse` of a /read address; null when the passage does not hold it. */
export function positionInRef(ref: string, kind: Kind, verse: string | null): number | null {
  if (verse === null) return null;
  const at = [...versesOf(ref, kind)].indexOf(verse);
  return at >= 0 ? at + 1 : null;
}

/**
 * Going from a whole portion back to its selection: the 1-based place, in the selection, of the verse the reader was on, or of the selected
 * verse that follows it in the portion (the last selected one when none does); null when the reader's place is unknown.
 */
export function selectionPlace(selectionRef: string, portionRef: string, kind: Kind, place: string | null): number | null {
  if (place === null) return null;
  const chosen = versesOf(selectionRef, kind), order = [...versesOf(portionRef, kind)], at = order.indexOf(place);
  if (chosen.has(place)) return positionInRef(selectionRef, kind, place);
  if (at < 0 || chosen.size < 1) return null;
  const after = order.slice(at).find(ref => chosen.has(ref)) ?? order.slice(0, at).reverse().find(ref => chosen.has(ref)) ?? null;
  return positionInRef(selectionRef, kind, after);
}

/** Groups → the one reference string a ref route or a saved reading takes. */
export const selectionRef = (ranges: readonly string[]) => joinReadingRef(ranges);
