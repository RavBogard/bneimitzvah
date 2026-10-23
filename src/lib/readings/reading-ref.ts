import { TANAKH_VERSE_COUNTS } from "./catalog";
import { NEVIIM_BOOKS } from "./commentary";
import { hebcalRef, parseRange } from "./leyning.mjs";
import { expandReadingRanges, TORAH_BOOKS, type VerseCounts } from "./ranges";

/**
 * A reading reference any caller may name (1.3 "Any reading"): the ordered segments of one
 * passage, each in Hebcal's own form ("Genesis 12:1-20", never "Genesis 12:1-12:20"), joined by
 * exactly "; ". These are the same bounds the 1.4 saved readings store (at most 1000 characters,
 * 1000 verses), so anything a member can save, the public ref routes can open. A Torah passage
 * stays inside one book, in order; a haftarah stays inside the Nevi'im (no Ketuvim: the megillot
 * are release 2.5). Numbers and book names only; nothing here reads a text.
 */
export type ReadingRefKind = "torah" | "haftarah";
export type ReadingCorpus = "torah" | "neviim";
export const READING_REF_SEPARATOR = "; ";
export const READING_REF_LIMITS = Object.freeze({ chars: 1000, segments: 32, verses: 1000 });
export type CanonicalReadingRef = Readonly<{ ref: string; kind: ReadingRefKind; segments: readonly string[]; verses: readonly string[] }>;

const torahBooks: ReadonlySet<string> = new Set(TORAH_BOOKS);
const neviimBooks: ReadonlySet<string> = new Set(NEVIIM_BOOKS);
// Book names and numbers are printable ASCII, so characters and bytes (the 1.4 octet_length check) agree.
const PRINTABLE = /^[\x20-\x7e]+$/;

/** The book of one segment when it is already in Hebcal's form, else null. Bounds are checked by expansion. */
function segmentBook(segment: string, counts: VerseCounts): string | null {
  const range = parseRange(segment);
  if (!range || !Object.hasOwn(counts, range.book)) return null;
  const [c1, v1] = range.from, [c2, v2] = range.to;
  return hebcalRef({ k: range.book, b: `${c1}:${v1}`, e: `${c2}:${v2}` }) === segment ? range.book : null;
}

function segmentsOf(ref: unknown): string[] | null {
  if (typeof ref !== "string" || ref.length < 1 || ref.length > READING_REF_LIMITS.chars || !PRINTABLE.test(ref)) return null;
  const segments = ref.split(READING_REF_SEPARATOR);
  return segments.length <= READING_REF_LIMITS.segments ? segments : null;
}

/** "torah" or "neviim" when every segment is canonical and in that one corpus; null otherwise (Ketuvim included). */
export function refCorpus(ref: unknown, counts: VerseCounts = TANAKH_VERSE_COUNTS): ReadingCorpus | null {
  const segments = segmentsOf(ref);
  if (!segments) return null;
  let corpus: ReadingCorpus | null = null;
  for (const segment of segments) {
    const book = segmentBook(segment, counts);
    const own: ReadingCorpus | null = book === null ? null : torahBooks.has(book) ? "torah" : neviimBooks.has(book) ? "neviim" : null;
    if (own === null || corpus !== null && own !== corpus) return null;
    corpus = own;
  }
  return corpus;
}

/** The validated passage, or null for anything that is not already canonical, in its kind's corpus and in bounds. */
export function canonicalReadingRef(ref: unknown, kind: unknown, counts: VerseCounts = TANAKH_VERSE_COUNTS): CanonicalReadingRef | null {
  if (kind !== "torah" && kind !== "haftarah") return null;
  if (refCorpus(ref, counts) !== (kind === "torah" ? "torah" : "neviim")) return null;
  const segments = Object.freeze(segmentsOf(ref)!);
  let verses: string[];
  try { verses = expandReadingRanges(segments, kind, counts, READING_REF_LIMITS.verses); } catch { return null; }
  return Object.freeze({ ref: ref as string, kind, segments, verses: Object.freeze(verses) });
}

/** Segments → the one reference string, the form every ref route and saved reading uses. */
export const joinReadingRef = (segments: readonly string[]): string => segments.join(READING_REF_SEPARATOR);
