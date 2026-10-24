import { afterEach, expect, test, vi } from "vitest";
import { updateSavedReading } from "../../src/components/portal/saved/api";
import { parseReadAddress, readAddress } from "../../src/components/portal/public-reading/urls";
import { TANAKH_VERSE_COUNTS } from "../../src/lib/readings/catalog";
import { canonicalReadingRef } from "../../src/lib/readings/reading-ref";
import { expandReadingRanges } from "../../src/lib/readings/ranges";
import { chapterSpanFor, contextFor, countLine, extendSelection, fitsGroups, nextVerse, positionInRef, selectionFromRanges, selectionPlace, selectionLine, selectionRanges, SELECTION_MAX_GROUPS,
  toggleVerse, wholePortionFor } from "../../src/lib/readings/verse-selection";

// Numbers, book names and invented ids only.
const portion = expandReadingRanges(["Genesis 12:1-17:27"], "torah", TANAKH_VERSE_COUNTS);
const pick = (...refs: string[]) => new Set(refs);

test("neighbouring verses merge into one group and separated verses stay separate, in the passage's order", () => {
  const chosen = pick("Genesis 12:1", "Genesis 12:2", "Genesis 12:3", "Genesis 12:8", "Genesis 12:9");
  expect(selectionRanges(portion, chosen)).toEqual(["Genesis 12:1-3", "Genesis 12:8-9"]);
  expect(selectionLine(selectionRanges(portion, chosen))).toBe("Genesis 12:1–3; 12:8–9");
  expect(countLine(5, selectionRanges(portion, chosen))).toBe("5 verses: Genesis 12:1–3; 12:8–9");
  expect(selectionRanges(portion, pick("Genesis 12:5"))).toEqual(["Genesis 12:5"]);
  expect(countLine(1, ["Genesis 12:5"])).toBe("1 verse: Genesis 12:5");
  expect(countLine(0, [])).toBe("No verses chosen");
  // The order the verses were chosen in never matters.
  expect(selectionRanges(portion, pick("Genesis 12:9", "Genesis 12:1", "Genesis 12:8", "Genesis 12:2"))).toEqual(["Genesis 12:1-2", "Genesis 12:8-9"]);
  expect(selectionRanges(portion, pick())).toEqual([]);
});

test("a chapter's last verse and the next chapter's first are neighbours, and the groups are the canonical form the server stores", () => {
  expect(nextVerse("Genesis 12:20")).toBe("Genesis 13:1");
  expect(nextVerse("Genesis 12:19")).toBe("Genesis 12:20");
  expect(nextVerse("Genesis 50:26")).toBeNull();
  const chosen = pick("Genesis 12:19", "Genesis 12:20", "Genesis 13:1", "Genesis 13:2");
  const groups = selectionRanges(portion, chosen);
  expect(groups).toEqual(["Genesis 12:19-13:2"]);
  expect(groups.every(group => canonicalReadingRef(group, "torah"))).toBe(true);
  expect(selectionLine(["Genesis 12:20-13:1", "Genesis 14:1"])).toBe("Genesis 12:20–13:1; 14:1");
  // A selection that crosses into a new book names it again.
  expect(selectionLine(["Genesis 50:25-26", "Exodus 1:1"])).toBe("Genesis 50:25–26; Exodus 1:1");
});

test("the groups of any selection read back as the same verses, and a haftarah may return to an earlier chapter", () => {
  const chosen = pick("Genesis 12:1", "Genesis 12:3", "Genesis 13:5", "Genesis 14:1", "Genesis 14:2");
  const groups = selectionRanges(portion, chosen);
  expect([...selectionFromRanges(groups, "torah")!].sort()).toEqual([...chosen].sort());
  // Mishpatim's haftarah reads Jeremiah 34 and then 33: the passage's own order is kept.
  const haftarah = expandReadingRanges(["Jeremiah 34:8-22", "Jeremiah 33:25-26"], "haftarah", TANAKH_VERSE_COUNTS);
  const groupsH = selectionRanges(haftarah, pick("Jeremiah 34:22", "Jeremiah 33:25"));
  expect(groupsH).toEqual(["Jeremiah 34:22", "Jeremiah 33:25"]);
  expect(canonicalReadingRef(groupsH.join("; "), "haftarah")).not.toBeNull();
  expect(selectionFromRanges(["Genesis 12:1-3", "Isaiah 1:1"], "torah")).toBeNull();
});

test("toggling adds and removes one verse, and extending takes in everything between the two verses, either way round", () => {
  const one = toggleVerse(pick(), "Genesis 12:4");
  expect([...one]).toEqual(["Genesis 12:4"]);
  expect(toggleVerse(one, "Genesis 12:4").size).toBe(0);
  expect(one.size).toBe(1);
  const forward = extendSelection(portion, pick("Genesis 12:2"), "Genesis 12:2", "Genesis 12:5");
  expect(selectionRanges(portion, forward)).toEqual(["Genesis 12:2-5"]);
  const backward = extendSelection(portion, pick("Genesis 12:7"), "Genesis 12:7", "Genesis 12:4");
  expect(selectionRanges(portion, backward)).toEqual(["Genesis 12:4-7"]);
  // Verses already chosen stay, and a verse outside the passage is just toggled.
  expect(selectionRanges(portion, extendSelection(portion, pick("Genesis 12:1", "Genesis 12:9"), "Genesis 12:9", "Genesis 12:11"))).toEqual(["Genesis 12:1", "Genesis 12:9-11"]);
  expect(extendSelection(portion, pick(), "Genesis 99:1", "Genesis 12:3").has("Genesis 12:3")).toBe(true);
});

test("at most 32 separate groups", () => {
  expect(SELECTION_MAX_GROUPS).toBe(32);
  const every = (count: number) => pick(...Array.from({ length: count }, (_, at) => portion[at * 2]));
  expect(selectionRanges(portion, every(32))).toHaveLength(32);
  expect(fitsGroups(portion, every(32))).toBe(true);
  expect(fitsGroups(portion, every(33))).toBe(false);
  // Taking a verse out of the middle of a group splits it in two: that can be the 33rd.
  const full = pick(...Array.from({ length: 31 }, (_, at) => portion[at * 2]), portion[100], portion[101], portion[102]);
  expect(selectionRanges(portion, full)).toHaveLength(32);
  expect(fitsGroups(portion, toggleVerse(full, portion[101]))).toBe(false);
  // And what fits is what the ref contract accepts.
  expect(canonicalReadingRef(selectionRanges(portion, every(32)).join("; "), "torah")).not.toBeNull();
});

test("the whole portion is the named parashah or haftarah that holds every chosen verse, and the chapters otherwise", () => {
  expect(wholePortionFor("torah", ["Genesis 12:1", "Genesis 12:9"])).toMatchObject({ ref: "Genesis 12:1-17:27", name: "Lech-Lecha", whole: true });
  expect(wholePortionFor("torah", ["Genesis 12:1", "Genesis 18:1"])).toBeNull();
  expect(wholePortionFor("haftarah", ["Jeremiah 34:22", "Jeremiah 33:25"])).toMatchObject({ ref: "Jeremiah 34:8-22; Jeremiah 33:25-26", name: "Mishpatim" });
  expect(wholePortionFor("torah", [])).toBeNull();
  // A maftir is never the portion.
  expect(wholePortionFor("torah", ["Numbers 28:16"])?.name).not.toMatch(/Pesach/);
  expect(chapterSpanFor("haftarah", ["Isaiah 10:1", "Isaiah 11:3"])).toMatchObject({ ref: "Isaiah 10:1-11:16", whole: false });
  expect(chapterSpanFor("haftarah", ["Isaiah 10:1", "Jeremiah 2:3"])).toBeNull();
  expect(contextFor("torah", ["Genesis 12:1"])?.whole).toBe(true);
  expect(contextFor("haftarah", ["Isaiah 10:1"])?.whole).toBe(false);
  expect(positionInRef("Genesis 12:1-17:27", "torah", "Genesis 12:3")).toBe(3);
  expect(positionInRef("Genesis 12:1-17:27", "torah", "Genesis 18:1")).toBeNull();
  expect(positionInRef("Genesis 12:1-17:27", "torah", null)).toBeNull();
});

test("going back to a selection opens at the verse the reader was on, or the selected verse that follows it", () => {
  const selection = "Genesis 12:1-3; Genesis 12:8-9", portionRef = "Genesis 12:1-17:27";
  expect(selectionPlace(selection, portionRef, "torah", "Genesis 12:2")).toBe(2);
  expect(selectionPlace(selection, portionRef, "torah", "Genesis 12:5")).toBe(4);
  expect(selectionPlace(selection, portionRef, "torah", "Genesis 14:1")).toBe(5);
  expect(selectionPlace(selection, portionRef, "torah", "Genesis 99:1")).toBeNull();
  expect(selectionPlace(selection, portionRef, "torah", null)).toBeNull();
});

test("a /read address carries the marked selection only when it is a valid passage inside the whole one", () => {
  const whole = "Genesis 12:1-17:27", mark = "Genesis 12:1-3; Genesis 12:8-9";
  const address = readAddress({ mode: "ref", ref: whole, kind: "torah", mark }, { verse: 4, study: true });
  expect(address).toBe(`/read?ref=${encodeURIComponent(whole).replace(/%20/g, "+")}&kind=torah&mark=${encodeURIComponent(mark).replace(/%20/g, "+")}&verse=4&lens=study`);
  expect(parseReadAddress(address.slice(address.indexOf("?")))).toEqual({ target: { mode: "ref", ref: whole, kind: "torah", mark }, verse: 4, study: true });
  const plain = readAddress({ mode: "ref", ref: whole, kind: "torah" });
  expect(plain).not.toContain("mark");
  expect(parseReadAddress(plain.slice(plain.indexOf("?"))).target).toEqual({ mode: "ref", ref: whole, kind: "torah" });
  // Outside the portion, another kind, or not canonical: simply not marked.
  for (const bad of ["Genesis 18:1", "Isaiah 1:1", "Genesis 12:1-12:3", "nonsense"]) {
    const search = `?ref=${encodeURIComponent(whole)}&kind=torah&mark=${encodeURIComponent(bad)}`;
    expect(parseReadAddress(search).target).toEqual({ mode: "ref", ref: whole, kind: "torah" });
  }
});

afterEach(() => { vi.unstubAllGlobals(); });
const savedRow = { id: "00000000-0000-4000-8000-000000000001", name: "Synthetic reading", date: null, kind: "torah", ranges: "Genesis 12:1-3; Genesis 12:8-9", verseCount: 5, revision: 3,
  createdAt: "2026-10-22T00:00:00.000Z", updatedAt: "2026-10-22T00:00:00.000Z" };
function stubFetch(status: number, body: unknown) {
  const calls: { url: string; body: unknown }[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => { calls.push({ url, body: JSON.parse(String(init.body)) });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }); });
  return calls;
}

test("revising sends ranges with the current revision, never a count, and only when ranges are given", async () => {
  const calls = stubFetch(200, { ok: true, reading: savedRow });
  const result = await updateSavedReading({ id: savedRow.id, revision: 2, name: "Synthetic reading", date: null, ranges: "Genesis 12:1-3; Genesis 12:8-9" });
  expect(result).toMatchObject({ ok: true, value: { revision: 3, verseCount: 5 } });
  expect(calls).toEqual([{ url: "/api/saved/readings/update", body: { id: savedRow.id, revision: 2, name: "Synthetic reading", date: null, ranges: "Genesis 12:1-3; Genesis 12:8-9" } }]);
  expect(Object.keys(calls[0].body as object)).not.toContain("verseCount");
  await updateSavedReading({ id: savedRow.id, revision: 3, name: "Renamed", date: "2026-10-24" });
  expect(calls[1].body).toEqual({ id: savedRow.id, revision: 3, name: "Renamed", date: "2026-10-24" });
});

test("a revision's conflict hands back the saved reading, and a refusal is a plain code", async () => {
  stubFetch(409, { ok: false, code: "conflict", current: savedRow });
  const conflict = await updateSavedReading({ id: savedRow.id, revision: 1, name: "x", date: null, ranges: "Genesis 12:1" });
  expect(conflict).toMatchObject({ ok: false, code: "conflict", current: savedRow });
  stubFetch(400, { error: "invalid-request" });
  expect(await updateSavedReading({ id: savedRow.id, revision: 1, name: "x", date: null, ranges: "Genesis 12:1" })).toEqual({ ok: false, code: "invalid" });
});
