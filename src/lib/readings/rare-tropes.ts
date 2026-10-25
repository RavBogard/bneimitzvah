/**
 * The Torah verses whose mark is a rare trope, for the reader's note (1.9 N5, G17): where the mark stands, never the text. A reader
 * who has chanted the Torah for years meets shalshelet four times in all, and a student should know before the week it comes. The
 * list is a table of places in the Torah (Genesis 19:16, 24:12, 39:8 and Leviticus 8:23), checked only against the verses of the reading.
 *
 * Verified 2026-10-25 against the text, not from memory: Genesis, Exodus, Leviticus, Numbers and Deuteronomy were fetched live from Sefaria's
 * public API (/api/v3/texts/<book>, version "Miqra according to the Masorah", the edition the app reads) and every verse containing U+0593 was
 * listed. There are exactly four: Genesis 19:16, Genesis 24:12, Genesis 39:8 and Leviticus 8:23, none in Exodus, Numbers or Deuteronomy.
 * Shalshelet is the only rare mark this note covers (yerach ben yomo, U+05AA, stands once in the Torah, Numbers 35:5, and is not in the note).
 * The text was read in a temporary folder and is not kept here. tests/app/rare-tropes.test.ts ties "shalshelet" to U+0593 through the engine's own
 * accent table and parser over an invented verse; the places themselves can only be re-checked against the text, as above.
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
