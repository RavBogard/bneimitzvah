import { expect, it } from "vitest";
import { changePassage, passageFromCustom, passageReference, readingBooks } from "../../src/components/portal/workspace/reading-selection";
import { TANAKH_VERSE_COUNTS } from "../../src/lib/readings/catalog";
import { expandReadingRanges } from "../../src/lib/readings/ranges";

it("initializes single-range selectors without flattening multiple ranges or repairing invalid manual references", () => {
  expect(passageFromCustom("Genesis 1:31-2:3", "torah")).toEqual({ book: "Genesis", startChapter: 1, startVerse: 31, endChapter: 2, endVerse: 3 });
  expect(passageFromCustom("Isaiah 6:1-8", "haftarah")).toMatchObject({ book: "Isaiah", endVerse: 8 });
  for (const custom of ["", "Genesis 1:1-2\nGenesis 1:4-5", "Genesis 1:32", "Isaiah 6:1-8", "Genesis 2:3-1:1"]) expect(passageFromCustom(custom, "torah")).toBeNull();
});

it("bounds dependent endpoints when a chapter gets shorter or the start moves past the end", () => {
  const initial = passageFromCustom("Genesis 1:31-2:25", "torah")!;
  const later = changePassage(initial, "startChapter", "3");
  expect(later).toEqual({ book: "Genesis", startChapter: 3, startVerse: 24, endChapter: 3, endVerse: 24 });
  expect(passageReference(later)).toBe("Genesis 3:24");
  const changed = changePassage(initial, "endChapter", "3");
  expect(changed.endVerse).toBe(24);
  expect(expandReadingRanges([passageReference(changed)], "torah", TANAKH_VERSE_COUNTS)).toHaveLength(50);
});

it("keeps Torah books restricted and all supported haftarah books available from canonical metadata", () => {
  expect(readingBooks("torah")).toEqual(["Genesis", "Exodus", "Leviticus", "Numbers", "Deuteronomy"]);
  expect(readingBooks("haftarah")).toEqual(Object.keys(TANAKH_VERSE_COUNTS));
  expect(changePassage(passageFromCustom("Genesis 50:20-26", "torah")!, "book", "Exodus")).toEqual({ book: "Exodus", startChapter: 1, startVerse: 1, endChapter: 1, endVerse: 1 });
});

it("round trips every canonical book's last verse and adjacent chapter boundary through the existing validator", () => {
  for (const book of readingBooks("haftarah")) {
    const counts = TANAKH_VERSE_COUNTS[book], chapter = counts.length;
    const final = `${book} ${chapter}:${counts[chapter - 1]}`;
    expect(passageReference(passageFromCustom(final, "haftarah")!)).toBe(final);
    if (chapter > 1) {
      const boundary = `${book} 1:${counts[0]}-2:1`;
      expect(expandReadingRanges([passageReference(passageFromCustom(boundary, "haftarah")!)], "haftarah", TANAKH_VERSE_COUNTS)).toHaveLength(2);
    }
  }
});
