import { expect, it } from "vitest";
import { TANAKH_VERSE_COUNTS } from "../../src/lib/readings/catalog";
import { expandReadingRanges } from "../../src/lib/readings/ranges";
import { changePassage, passageFromCustom, passageReference, readingBooks } from "../../src/components/portal/workspace/reading-selection";

it("keeps dependent chapter and verse controls canonical at every book's chapter boundaries", () => {
  for (const book of readingBooks("haftarah")) {
    const counts = TANAKH_VERSE_COUNTS[book];
    for (let chapter = 1; chapter <= counts.length; chapter++) {
      const original = { book, startChapter: 1, startVerse: counts[0], endChapter: 1, endVerse: counts[0] };
      const start = changePassage(original, "startChapter", String(chapter));
      const lastVerse = changePassage(start, "startVerse", String(counts[chapter - 1]));
      const ref = passageReference(lastVerse);
      expect(passageFromCustom(ref, "haftarah")).toEqual(lastVerse);
      expect(expandReadingRanges([ref], "haftarah", TANAKH_VERSE_COUNTS).length).toBeGreaterThan(0);
      expect(lastVerse.startVerse).toBeLessThanOrEqual(counts[lastVerse.startChapter - 1]);
      expect(lastVerse.endVerse).toBeLessThanOrEqual(counts[lastVerse.endChapter - 1]);
    }
  }
});

it("leaves ordered multi-range, invalid and foreign-kind references to explicit advanced editing", () => {
  for (const ref of ["Genesis 1:1-2\nGenesis 2:1-2", "Genesis 2:1-2\nGenesis 1:1-2", "Genesis 1:99", "Isaiah 1:1-2"]) {
    expect(passageFromCustom(ref, "torah")).toBeNull();
  }
  expect(passageFromCustom("Genesis 1:31-2:2", "torah")).toEqual({ book: "Genesis", startChapter: 1, startVerse: 31, endChapter: 2, endVerse: 2 });
});
