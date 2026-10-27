import { expect, test } from "vitest";
import { parseReadAddress, publicReadingPath, publicShortPath, publicTextPath, publicWordAidsPath, publicWordDetailsPath, readAddress, selectorKey, type ReadTarget } from "../../src/components/portal/public-reading/urls";
import { customRef, parashotByBook } from "../../src/lib/readings/named-groups";
import { readingBooks } from "../../src/components/portal/workspace/reading-selection";
import { NEVIIM_BOOKS } from "../../src/lib/readings/commentary";
import { NAMED_READINGS } from "../../src/lib/readings/named-readings";

// Numbers, book names and catalog slugs only.
test("the /api/public paths are the server's closed keysets, in order, for a date or a ref", () => {
  const date = { by: "date", date: "2026-10-24" } as const, ref = { by: "ref", ref: "Exodus 32:11-14; Exodus 34:1-10", kind: "torah" } as const;
  expect(publicReadingPath(date)).toBe("/api/public/reading?date=2026-10-24");
  expect(publicReadingPath(ref)).toBe("/api/public/reading?ref=Exodus+32%3A11-14%3B+Exodus+34%3A1-10&kind=torah");
  expect(publicTextPath(date, "haftarah", 0)).toBe("/api/public/text?date=2026-10-24&kind=haftarah&offset=0");
  expect(publicTextPath(ref, "torah", 100)).toBe("/api/public/text?ref=Exodus+32%3A11-14%3B+Exodus+34%3A1-10&kind=torah&offset=100");
  expect(publicWordAidsPath(ref, "torah", 3)).toBe("/api/public/word-aids?ref=Exodus+32%3A11-14%3B+Exodus+34%3A1-10&kind=torah&verse=3");
  expect(publicWordDetailsPath(ref, "torah", 3, 1)).toBe("/api/public/word-details?ref=Exodus+32%3A11-14%3B+Exodus+34%3A1-10&kind=torah&verse=3&word=1");
  expect(publicShortPath(date, "torah", 0)).toBe("/api/public/reference/short?date=2026-10-24&kind=torah&offset=0");
  // A ref names one kind: asking it for the other is a programming error, never a request.
  expect(() => publicTextPath(ref, "haftarah", 0)).toThrow();
  expect(selectorKey(date)).not.toBe(selectorKey(ref));
});

test("page addresses round-trip for every mode, with verse and Study", () => {
  const targets: ReadTarget[] = [{ mode: "week", date: "2026-10-31", kind: null }, { mode: "week", date: "2026-10-31", kind: "haftarah" },
    { mode: "named", slug: "simchat-torah", passage: 2 }, { mode: "named", slug: "bereshit", passage: 1 }, { mode: "ref", ref: "Jonah 1:1-5", kind: "haftarah" }];
  for (const target of targets) for (const verse of [null, 3]) for (const study of [false, true]) {
    const address = readAddress(target, { verse, study });
    expect(parseReadAddress(address.slice("/read".length)), address).toEqual({ target, verse, study });
  }
  expect(readAddress({ mode: "week", date: "2026-10-24", kind: null }, { today: "2026-10-24" })).toBe("/read");
  expect(readAddress({ mode: "named", slug: "bereshit", passage: 1 })).toBe("/read?reading=bereshit");
  expect(readAddress({ mode: "ref", ref: "Genesis 1:1-5", kind: "torah" }, { verse: 2, study: true })).toBe("/read?ref=Genesis+1%3A1-5&kind=torah&verse=2&lens=study");
  expect(parseReadAddress("")).toEqual({ target: { mode: "week", date: null, kind: null }, verse: null, study: false });
  // A weekday date opens its Shabbat, as before.
  expect(parseReadAddress("?date=2026-10-22").target).toEqual({ mode: "week", date: "2026-10-24", kind: null });
});

test("an address that names nothing openable has no target; a bad verse is ignored, never guessed", () => {
  for (const search of ["?reading=no-such", "?reading=__proto__", "?reading=bereshit&passage=3", "?reading=bereshit&passage=0", "?reading=bereshit&passage=01",
    "?ref=Psalms+1%3A1-6&kind=haftarah", "?ref=Genesis+12%3A1-12%3A20&kind=torah", "?ref=Genesis+1%3A1&kind=megillah", "?ref=Genesis+1%3A1", "?ref=Isaiah+1%3A1&kind=torah"]) {
    expect(parseReadAddress(search).target, search).toBeNull();
  }
  for (const verse of ["0", "-1", "01", "1.5", "1001", "x", ""]) expect(parseReadAddress(`?ref=Genesis+1%3A1-5&kind=torah&verse=${verse}`).verse, verse).toBeNull();
  expect(parseReadAddress("?ref=Genesis+1%3A1-5&kind=torah&verse=1000").verse).toBe(1000);
});

test("the chooser lists every parashah under its book, and a custom passage opens only in canonical form", () => {
  const books = parashotByBook();
  expect(books.map(row => row.book)).toEqual(["Genesis", "Exodus", "Leviticus", "Numbers", "Deuteronomy"]);
  expect(books.flatMap(row => row.readings).length).toBe(NAMED_READINGS.filter(reading => reading.group === "parashah").length);
  expect(books[0].readings[0].slug).toBe("bereshit"); expect(books[4].readings.at(-1)!.slug).toBe("vezot-haberakhah");
  expect(customRef("Genesis 1:1-5", "torah")).toBe("Genesis 1:1-5");
  expect(customRef("Exodus 32:11-14\nExodus 34:1-10", "torah")).toBe("Exodus 32:11-14; Exodus 34:1-10");
  expect(customRef("Hosea 14:2-10\nJoel 2:15-27", "haftarah")).toBe("Hosea 14:2-10; Joel 2:15-27");
  for (const [lines, kind] of [["", "torah"], ["Exodus 34:1-10\nExodus 32:11-14", "torah"], ["Genesis 1:1\nExodus 1:1", "torah"], ["Psalms 1:1-6", "haftarah"], ["Isaiah 1:1-3\nIsaiah 1:2", "haftarah"]] as const) {
    expect(customRef(lines, kind), lines).toBeNull();
  }
  // The Prophets-only picker; every other caller keeps the whole Tanakh for a haftarah.
  expect(readingBooks("haftarah", { neviim: true })).toEqual(NEVIIM_BOOKS);
  expect(readingBooks("haftarah")).not.toEqual(NEVIIM_BOOKS);
});
