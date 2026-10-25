import { expect, test } from "vitest";
import { RARE_TROPES, rareTropeNote, rareTropesIn } from "../../src/lib/readings/rare-tropes";
import { expandReadingRanges } from "../../src/lib/readings/ranges";
import { TANAKH_VERSE_COUNTS } from "../../src/lib/readings/catalog";

// The reader's note for a rare trope (1.9 N5): places only, checked against the verses of the week's Torah reading.
const verses = (...ranges: string[]) => expandReadingRanges(ranges, "torah", TANAKH_VERSE_COUNTS);

test("shalshelet stands at four places in the Torah, and each is a verse that exists", () => {
  expect(RARE_TROPES.flatMap(row => row.verses)).toEqual(["Genesis 19:16", "Genesis 24:12", "Genesis 39:8", "Leviticus 8:23"]);
  for (const verse of RARE_TROPES.flatMap(row => row.verses)) expect(verses(verse)).toEqual([verse]);
});

test("Vayera, Chayei Sarah, Vayeshev and Tzav have a note; other weeks have none", () => {
  expect(rareTropeNote(rareTropesIn(verses("Genesis 18:1-22:24")))).toBe("Rare trope this week: shalshelet, 19:16");
  expect(rareTropeNote(rareTropesIn(verses("Genesis 23:1-25:18")))).toBe("Rare trope this week: shalshelet, 24:12");
  expect(rareTropeNote(rareTropesIn(verses("Genesis 37:1-40:23")))).toBe("Rare trope this week: shalshelet, 39:8");
  expect(rareTropeNote(rareTropesIn(verses("Leviticus 6:1-8:36")))).toBe("Rare trope this week: shalshelet, 8:23");
  expect(rareTropeNote(rareTropesIn(verses("Genesis 6:9-11:32")))).toBeNull();
  expect(rareTropeNote(rareTropesIn([]))).toBeNull();
});

test("a single aliyah is checked against its own verses", () => {
  expect(rareTropesIn(verses("Genesis 19:1-20"))).toEqual([{ trope: "shalshelet", verse: "Genesis 19:16" }]);
  expect(rareTropesIn(verses("Genesis 18:1-14"))).toEqual([]);
});
