import { parseRange } from "./leyning.mjs";

export type CeremonyDate = string & { readonly ceremonyDate: unique symbol };
export type ReadingKind = "torah" | "haftarah" | "blessing-before" | "blessing-after";
// Trusted metadata only: each array holds the verse count of chapters 1..N.
export type VerseCounts = Readonly<Record<string, readonly number[]>>;
export const TORAH_BOOKS = ["Genesis", "Exodus", "Leviticus", "Numbers", "Deuteronomy"] as const;

export function parseCeremonyDate(input: unknown): CeremonyDate {
  if (typeof input !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(input)) throw new Error("Invalid ceremony date");
  const [year,month,day] = input.split("-").map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31,leap ? 29 : 28,31,30,31,30,31,31,30,31,30,31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month-1]) throw new Error("Invalid ceremony date");
  return input as CeremonyDate;
}

export function expandReadingRanges(refs: readonly string[], kind: ReadingKind, counts: VerseCounts, limit = 1000): string[] {
  if (!Array.isArray(refs) || refs.length < 1 || refs.length > 32 || !Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error("Invalid reading range set");
  if (kind !== "torah" && kind !== "haftarah") throw new Error("Blessings require a separate liturgical definition");
  const verses: string[] = [];
  const seen = new Set<string>();
  let previous: { book: string; chapter: number; verse: number } | undefined;
  for (const ref of refs) {
    if (typeof ref !== "string" || ref.length > 160) throw new Error("Invalid reading reference");
    const range = parseRange(ref);
    if (!range || (kind === "torah" && !(TORAH_BOOKS as readonly string[]).includes(range.book))) throw new Error("Unknown or noncanonical reading book");
    const endpoints=ref.slice(range.book.length+1);
    if (ref!==`${range.book} ${endpoints}` || !/^[1-9]\d*:[1-9]\d*(?:-(?:[1-9]\d*:)?[1-9]\d*)?$/.test(endpoints)) throw new Error("Noncanonical reading reference");
    const chapters = Object.hasOwn(counts,range.book) ? counts[range.book] : undefined;
    if (!chapters) throw new Error("Trusted verse-count metadata required");
    if (!Array.isArray(chapters) || chapters.length < 1 || chapters.length > 200) throw new Error("Invalid trusted verse-count metadata");
    const [c1,v1] = range.from, [c2,v2] = range.to;
    if (![c1,v1,c2,v2].every(Number.isSafeInteger) || c1 < 1 || c2 > chapters.length || c2 < c1 || v1 < 1 || v2 < 1
        || v1 > chapters[c1-1] || v2 > chapters[c2-1] || (c1 === c2 && v2 < v1)) throw new Error("Reading reference outside chapter/verse boundaries");
    if (previous && (previous.book !== range.book || c1 < previous.chapter || (c1 === previous.chapter && v1 <= previous.verse))) throw new Error("Reading ranges must be ordered and nonoverlapping within one book");
    let expansionSize=0;
    for (let chapter=c1;chapter<=c2;chapter++) {
      const chapterSize=chapters[chapter-1];
      if (!Number.isSafeInteger(chapterSize) || chapterSize<1 || chapterSize>200) throw new Error("Invalid trusted verse-count metadata");
      expansionSize+=(chapter===c2 ? v2 : chapterSize)-(chapter===c1 ? v1 : 1)+1;
    }
    if (verses.length+expansionSize>limit) throw new Error("Duplicate or excessive reading verses");
    for (let chapter=c1; chapter<=c2; chapter++) {
      const chapterSize = chapters[chapter-1];
      for (let verse=chapter === c1 ? v1 : 1; verse <= (chapter === c2 ? v2 : chapterSize); verse++) {
        const key = `${range.book} ${chapter}:${verse}`;
        if (seen.has(key) || verses.length >= limit) throw new Error("Duplicate or excessive reading verses");
        seen.add(key); verses.push(key);
      }
    }
    previous = { book: range.book, chapter: c2, verse: v2 };
  }
  return verses;
}
