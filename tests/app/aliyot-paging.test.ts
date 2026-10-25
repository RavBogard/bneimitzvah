import { expect, test } from "vitest";
import { labelsIn, pickOfSection, sectionIndexAt, sectionLabel, sectionOfPick, sectionsFromStarts, sectionsOf } from "../../src/lib/readings/sections";
import { parsePortions, portionLabel, portionPicks, PORTION_LABELS, portionRef } from "../../src/lib/print/portions";
import { parsePrintAddress, printAddress } from "../../src/lib/print/print-address";
import { parseReadAddress, readAddress } from "../../src/components/portal/public-reading/urls";
import { TANAKH_VERSE_COUNTS } from "../../src/lib/readings/catalog";
import { expandReadingRanges } from "../../src/lib/readings/ranges";
import { countLine, selectionRanges, tapVerse } from "../../src/lib/readings/verse-selection";

// Release 1.9 N3: references and numbers only (Vayera's calendar divisions); no text.
const verses = (ref: string) => expandReadingRanges(ref.split("; "), "torah", TANAKH_VERSE_COUNTS);
const VAYERA = verses("Genesis 18:1-22:24");
const FULL = [["1", "Genesis 18:1-14"], ["2", "Genesis 18:15-33"], ["3", "Genesis 19:1-20"], ["4", "Genesis 19:21-21:4"], ["5", "Genesis 21:5-21"], ["6", "Genesis 21:22-34"],
  ["7", "Genesis 22:1-24"], ["M", "Genesis 22:20-24"]].map(([n, ref]) => ({ n, ref }));
const week = (full: readonly { n: string; ref: string }[], triennial: unknown = null) => parsePortions({ date: "2026-10-31", parashah: "Vayera", full, triennial }, "2026-10-31")!;

test("Vayera's calendar divisions become eight sections, aliyot 1 to 7 and the maftir, by verse position", () => {
  const sections = sectionsOf(FULL, VAYERA);
  expect(sections.map(row => row.label)).toEqual(["Aliyah 1", "Aliyah 2", "Aliyah 3", "Aliyah 4", "Aliyah 5", "Aliyah 6", "Aliyah 7", "Maftir"]);
  expect(sections[0]).toMatchObject({ n: "1", start: 0, end: 14 });
  expect(VAYERA[sections[3].start]).toBe("Genesis 19:21");
  expect(VAYERA[sections[3].end - 1]).toBe("Genesis 21:4");
  // Aliyah 1 to 7 cover the whole portion, in order, with no gap; the maftir repeats the end of aliyah 7.
  expect(sections.slice(0, 7).every((row, at) => row.start === (at === 0 ? 0 : sections[at - 1].end))).toBe(true);
  expect(sections[6].end).toBe(VAYERA.length);
  expect(sections[7]).toMatchObject({ n: "M", end: VAYERA.length });
  expect(sections[7].start).toBeGreaterThan(sections[6].start);
  expect(sectionLabel("M")).toBe("Maftir");
});

test("a reading with no aliyah breakdown, or with one the text does not hold, is not paged by aliyah", () => {
  expect(sectionsOf([], VAYERA)).toEqual([]);
  expect(sectionsOf(FULL.slice(0, 1), VAYERA)).toEqual([]);
  // A festival Saturday gives its Torah as one range: one section is no paging.
  expect(sectionsOf([{ n: "1", ref: "Exodus 12:21-51" }], verses("Exodus 12:21-51"))).toEqual([]);
  // A division that names verses outside the passage, or that is not one run in it, is left out; the rest still page.
  const mixed = sectionsOf([...FULL, { n: "9", ref: "Genesis 30:1-5" }, { n: "8", ref: "Genesis 18:1-3; Genesis 18:6-7" }], VAYERA);
  expect(mixed.map(row => row.n)).toEqual(["1", "2", "3", "4", "5", "6", "7", "M"]);
  // The picker offers what the calendar gives and nothing else: Full only on a festival Saturday, and when the aliyot did not load.
  expect(portionPicks(week([]))).toEqual(["full"]);
  expect(portionPicks(null)).toEqual(["full"]);
  expect(portionPicks(week(FULL))).toEqual(["full", "aliyah-1", "aliyah-2", "aliyah-3", "aliyah-4", "aliyah-5", "aliyah-6", "aliyah-7", "maftir"]);
});

test("the picker words are print's, with the triennial year", () => {
  const triennial = { year: 2, aliyot: [{ n: "1", ref: "Genesis 18:1-14" }, { n: "2", ref: "Genesis 18:15-33" }] };
  const portions = week(FULL, triennial);
  expect(portionPicks(portions)).toContain("triennial");
  expect(portionLabel("triennial", portions)).toBe("Triennial portion (year 2)");
  expect(portionLabel("full", portions)).toBe("Full calendar portion");
  expect(portionLabel("aliyah-4", portions)).toBe("Aliyah 4");
  expect(portionLabel("maftir", portions)).toBe("Maftir");
  expect(Object.keys(PORTION_LABELS)).toHaveLength(10);
  expect(portionRef(portions, "aliyah-4")).toBe("Genesis 19:21-21:4");
});

test("which section a verse is in: the maftir only where nothing else holds the verse", () => {
  const sections = sectionsOf(FULL, VAYERA);
  const at = (ref: string) => sections[sectionIndexAt(sections, VAYERA.indexOf(ref))].n;
  expect(at("Genesis 18:1")).toBe("1");
  expect(at("Genesis 19:21")).toBe("4");
  expect(at("Genesis 22:20")).toBe("7");
  expect(at("Genesis 22:24")).toBe("7");
});

test("print's labels sit above the verse where a section begins, the open section's first where two begin together", () => {
  const sections = sectionsOf(FULL, VAYERA), seven = sections[6], maftir = sections[7];
  // Aliyah 7's page names Aliyah 7 at its first verse and the Maftir where it begins inside.
  expect(labelsIn(sections, 6, seven.start, seven.end)).toEqual([{ index: 0, label: "Aliyah 7" }, { index: maftir.start - seven.start, label: "Maftir" }]);
  // The maftir's own page is named for the maftir, not for the aliyah that also begins there on another division.
  expect(labelsIn(sections, 7, maftir.start, maftir.end)).toEqual([{ index: 0, label: "Maftir" }]);
  // Aliyah 1's page has only its own label.
  expect(labelsIn(sections, 0, 0, 14)).toEqual([{ index: 0, label: "Aliyah 1" }]);
});

test("a tutor's recorded aliyot are the sections; unrecorded, or one aliyah, is no paging", () => {
  const assigned = verses("Genesis 1:1-4:24");
  const sections = sectionsFromStarts(assigned, ["Genesis 4:19"]);
  expect(sections).toHaveLength(2);
  expect(sections[0]).toMatchObject({ label: "Aliyah 1", start: 0, end: 98 });
  expect(sections[1]).toMatchObject({ label: "Aliyah 2", start: 98, end: assigned.length });
  expect(sectionsFromStarts(assigned, null)).toEqual([]);
  expect(sectionsFromStarts(assigned, [])).toEqual([]);
  expect(sectionsFromStarts(assigned, ["Genesis 9:9"])).toEqual([]);
  expect(sectionsFromStarts(assigned, ["Genesis 2:1", "Genesis 1:5"])).toEqual([]);
});

test("a pick names a section, and a section names a pick", () => {
  expect(sectionOfPick("aliyah-4")).toBe("4");
  expect(sectionOfPick("maftir")).toBe("M");
  expect(sectionOfPick("full")).toBeNull();
  expect(sectionOfPick("triennial")).toBeNull();
  expect(sectionOfPick(null)).toBeNull();
  expect(pickOfSection("full", "4")).toBe("aliyah-4");
  expect(pickOfSection("full", "M")).toBe("maftir");
  expect(pickOfSection("triennial", "3")).toBe("triennial");
});

test("&pick= is read and written for a Shabbat's Torah, and for nothing else", () => {
  expect(parseReadAddress("?date=2026-10-31&pick=aliyah-4")).toEqual({ target: { mode: "week", date: "2026-10-31", kind: null }, verse: null, study: false, pick: "aliyah-4" });
  expect(parseReadAddress("?date=2026-10-31&pick=maftir&lens=study").pick).toBe("maftir");
  expect(parseReadAddress("?date=2026-10-31&pick=triennial").pick).toBe("triennial");
  // Full is the default and is left out; nonsense and a haftarah carry none.
  for (const search of ["?date=2026-10-31&pick=full", "?date=2026-10-31&pick=aliyah-8", "?date=2026-10-31&pick=", "?date=2026-10-31&pick=__proto__", "?date=2026-10-31&kind=haftarah&pick=aliyah-4", "?reading=bereshit&pick=aliyah-4", "?ref=Genesis+18%3A1-10&kind=torah&pick=aliyah-4"])
    expect(parseReadAddress(search), search).not.toHaveProperty("pick");
  const target = { mode: "week", date: "2026-10-31", kind: null } as const;
  expect(readAddress(target, { today: "2026-10-24", pick: "aliyah-4" })).toBe("/read?date=2026-10-31&pick=aliyah-4");
  expect(readAddress(target, { today: "2026-10-24", pick: "aliyah-4", verse: 3, study: true })).toBe("/read?date=2026-10-31&pick=aliyah-4&verse=3&lens=study");
  expect(readAddress(target, { today: "2026-10-31", pick: "aliyah-4" })).toBe("/read?pick=aliyah-4");
  expect(readAddress(target, { today: "2026-10-24", pick: "full" })).toBe("/read?date=2026-10-31");
  expect(readAddress({ ...target, kind: "haftarah" }, { today: "2026-10-24", pick: "aliyah-4" })).toBe("/read?date=2026-10-31&kind=haftarah");
  // The same words reach /print, which already takes them.
  expect(printAddress({ mode: "week", date: "2026-10-31", kind: null, pick: "aliyah-4" }, undefined, { today: "2026-10-24" })).toBe("/print?date=2026-10-31&pick=aliyah-4");
  expect(parsePrintAddress("?date=2026-10-31&pick=aliyah-4").target).toMatchObject({ mode: "week", pick: "aliyah-4" });
});

test("tapping 18:1 then 18:10 chooses Genesis 18:1 to 18:10, and /print prints those verses only", () => {
  const order = VAYERA;
  const first = tapVerse(order, new Set(), null, "Genesis 18:1");
  expect(selectionRanges(order, first)).toEqual(["Genesis 18:1"]);
  const second = tapVerse(order, first, "Genesis 18:1", "Genesis 18:10");
  expect(selectionRanges(order, second)).toEqual(["Genesis 18:1-10"]);
  expect(countLine(second.size, selectionRanges(order, second))).toBe("10 verses: Genesis 18:1–10");
  // The sheet for those verses is named by that ref and holds exactly those ten verses.
  const ranges = selectionRanges(order, second), address = printAddress({ mode: "ref", ref: ranges.join("; "), kind: "torah" });
  expect(address).toBe("/print?ref=Genesis+18%3A1-10&kind=torah");
  const target = parsePrintAddress(address.slice("/print".length)).target;
  expect(target).toMatchObject({ mode: "ref", ref: "Genesis 18:1-10", kind: "torah" });
  expect(verses((target as { ref: string }).ref)).toEqual(order.slice(0, 10));
  // A third tap is one verse added, not another range; an earlier verse after one is its own verse, not a range.
  expect(selectionRanges(order, tapVerse(order, second, "Genesis 18:10", "Genesis 18:15"))).toEqual(["Genesis 18:1-10", "Genesis 18:15"]);
  expect(selectionRanges(order, tapVerse(order, tapVerse(order, new Set(), null, "Genesis 18:10"), "Genesis 18:10", "Genesis 18:1"))).toEqual(["Genesis 18:1", "Genesis 18:10"]);
  // The same verse again lets it go. Shift still extends from the last verse tapped when several are chosen.
  expect(tapVerse(order, first, "Genesis 18:1", "Genesis 18:1").size).toBe(0);
  const spread = tapVerse(order, tapVerse(order, tapVerse(order, new Set(), null, "Genesis 18:1"), "Genesis 18:1", "Genesis 18:3"), "Genesis 18:3", "Genesis 18:9");
  expect(selectionRanges(order, spread)).toEqual(["Genesis 18:1-3", "Genesis 18:9"]);
  expect(selectionRanges(order, tapVerse(order, spread, "Genesis 18:9", "Genesis 18:12", { shift: true }))).toEqual(["Genesis 18:1-3", "Genesis 18:9-12"]);
});
