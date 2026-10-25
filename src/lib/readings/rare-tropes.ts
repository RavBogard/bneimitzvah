/**
 * The Torah verses whose mark is a rare trope, for the reader's note (1.9 N5, G17): where the mark stands, never the text. A reader
 * who has chanted the Torah for years meets shalshelet four times in all, and a student should know before the week it comes. The
 * list is a table of places in the Torah (Genesis 19:16, 24:12, 39:8 and Leviticus 8:23), checked only against the verses of the reading.
 */
export const RARE_TROPES = Object.freeze([
  Object.freeze({ trope: "shalshelet", verses: Object.freeze(["Genesis 19:16", "Genesis 24:12", "Genesis 39:8", "Leviticus 8:23"]) }),
]);

export type RareTrope = Readonly<{ trope: string; verse: string }>;

/** The rare tropes among a Torah reading's verses ("Genesis 19:16", in the reading's order). */
export function rareTropesIn(verses: readonly string[]): readonly RareTrope[] {
  const present = new Set(verses);
  return RARE_TROPES.flatMap(row => row.verses.filter(verse => present.has(verse)).map(verse => ({ trope: row.trope, verse })));
}

/** "Rare trope this week: shalshelet, 19:16" (approved 2026-10-24). The verse drops its book: the reading's own page names it. */
export function rareTropeNote(found: readonly RareTrope[]): string | null {
  return found.length ? `Rare trope this week: ${found.map(row => `${row.trope}, ${row.verse.slice(row.verse.lastIndexOf(" ") + 1)}`).join("; ")}` : null;
}
