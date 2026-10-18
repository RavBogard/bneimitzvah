import { expect, it } from "vitest";
import { addedDivision, changePassage, divisionChoices, followingPassage, passageFromCustom, passageReference, passagesFromCustom, readingBooks } from "../../src/components/portal/workspace/reading-selection";
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

it("reads several plain passages for separate pickers and keeps any manual line out of them", () => {
  expect(passagesFromCustom("", "torah")).toEqual([]);
  expect(passagesFromCustom("Genesis 1:1-5\nGenesis 2:1-3", "torah")).toEqual([
    { book: "Genesis", startChapter: 1, startVerse: 1, endChapter: 1, endVerse: 5 },
    { book: "Genesis", startChapter: 2, startVerse: 1, endChapter: 2, endVerse: 3 }]);
  expect(passagesFromCustom("Genesis 1:1-5\nGenesis 1:99", "torah")).toBeNull();
});

it("starts an added passage right after the previous one without leaving the book", () => {
  expect(followingPassage({ book: "Genesis", startChapter: 1, startVerse: 1, endChapter: 1, endVerse: 5 })).toMatchObject({ startChapter: 1, startVerse: 6, endVerse: 6 });
  expect(followingPassage({ book: "Genesis", startChapter: 1, startVerse: 1, endChapter: 1, endVerse: 31 })).toMatchObject({ startChapter: 2, startVerse: 1 });
  expect(followingPassage({ book: "Genesis", startChapter: 50, startVerse: 1, endChapter: 50, endVerse: 26 })).toMatchObject({ startChapter: 50, startVerse: 26 });
});

it("offers aliyah starts only in order inside the selected verses", () => {
  const verses = expandReadingRanges(["Genesis 1:1-10"], "torah", TANAKH_VERSE_COUNTS);
  expect(addedDivision(verses, [])).toBe("Genesis 1:6");
  expect(addedDivision(verses, ["Genesis 1:6"])).toBe("Genesis 1:9");
  expect(addedDivision(verses, ["Genesis 1:10"])).toBeNull();
  expect(divisionChoices(verses, ["Genesis 1:4", "Genesis 1:8"], 0)).toEqual(["Genesis 1:2", "Genesis 1:3", "Genesis 1:4", "Genesis 1:5", "Genesis 1:6", "Genesis 1:7"]);
  expect(divisionChoices(verses, ["Genesis 1:4", "Genesis 1:8"], 1)).toEqual(["Genesis 1:5", "Genesis 1:6", "Genesis 1:7", "Genesis 1:8", "Genesis 1:9", "Genesis 1:10"]);
});
