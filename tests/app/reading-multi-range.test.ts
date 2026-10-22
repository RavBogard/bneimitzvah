import { expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { readFileSync } from "node:fs";
import { expandReadingRanges, readingSegments } from "../../src/lib/readings/ranges";
import { TANAKH_VERSE_COUNTS } from "../../src/lib/readings/catalog";
import { createHebcalReader, type CacheEntry, type HebcalCache } from "../../src/lib/readings/proposals";
import { assignmentReadingKey, haftarahRefForKey, readingKeyFor } from "../../src/lib/readings/reading-key";
import { validatedSnapshot } from "../../src/server/students/preparation";

// Saved Hebcal leyning responses (CC BY 4.0; see tests/fixtures/trope/README.md). Numeric references only.
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../fixtures/trope/hebcal/${name}.json`, import.meta.url), "utf8"));
const counts = TANAKH_VERSE_COUNTS;

function reader(payload: unknown) {
  let cached: CacheEntry | null = null;
  const cache: HebcalCache = { get: vi.fn(async () => cached), set: vi.fn(async (_key, entry) => { cached = entry; }) };
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => new Response(JSON.stringify(payload), { headers: { "content-type": "application/json" } }));
  return { load: createHebcalReader({ fetch, cache, verseCounts: counts, now: () => 100000000 }), fetch, cache };
}
const dateOf = (payload: { range: { start: string } }) => payload.range.start;

test("Shemot's two-range haftarah no longer blanks the week: Torah and both haftarah ranges survive, also from the cache", async () => {
  const payload = fixture("shemot"), h = reader(payload);
  const first = await h.load(dateOf(payload));
  expect(first.snapshot.classification).toBe("regular");
  expect(first.snapshot.reading?.parashah).toBe("Shemot");
  expect(first.snapshot.reading?.aliyot.length).toBe(8);
  expect(first.snapshot.haftarah).toBe("Isaiah 27:6-28:13; Isaiah 29:22-23");
  const verses = expandReadingRanges(readingSegments(first.snapshot.haftarah!), "haftarah", counts);
  expect(verses.length).toBe(23);
  expect(verses.slice(-3)).toEqual(["Isaiah 28:13", "Isaiah 29:22", "Isaiah 29:23"]);
  const again = await h.load(dateOf(payload));
  expect(again.source).toBe("cache");
  expect(again.snapshot).toEqual(first.snapshot);
  expect(h.fetch).toHaveBeenCalledTimes(1);
});

test("a haftarah that crosses books (Shabbat Shuva) keeps its segments in Hebcal's order", async () => {
  const payload = fixture("shabbat-shuva"), { snapshot } = await reader(payload).load(dateOf(payload));
  expect(snapshot.reading?.parashah).toBe("Ha'azinu");
  expect(snapshot.haftarah).toBe("Hosea 14:2-10; Joel 2:15-27");
  const verses = expandReadingRanges(readingSegments(snapshot.haftarah!), "haftarah", counts);
  expect(verses.length).toBe(22);
  expect([verses[0], verses[8], verses[9], verses[21]]).toEqual(["Hosea 14:2", "Hosea 14:10", "Joel 2:15", "Joel 2:27"]);
  // Hosea, then Micah, then Joel: a later book can come first and an earlier one after it.
  expect(expandReadingRanges(["Hosea 14:2-10", "Micah 7:18-20", "Joel 2:15-27"], "haftarah", counts).length).toBe(25);
  expect(expandReadingRanges(["Jonah 1:1-4:11", "Micah 7:18-20"], "haftarah", counts).length).toBe(51);
});

test("a haftarah whose second range comes earlier in the book (Mishpatim) is read in the order given", async () => {
  const payload = fixture("mishpatim"), { snapshot } = await reader(payload).load(dateOf(payload));
  expect(snapshot.reading?.parashah).toBe("Mishpatim");
  expect(snapshot.haftarah).toBe("Jeremiah 34:8-22; Jeremiah 33:25-26");
  const verses = expandReadingRanges(readingSegments(snapshot.haftarah!), "haftarah", counts);
  expect(verses.length).toBe(17);
  expect(verses.slice(13)).toEqual(["Jeremiah 34:21", "Jeremiah 34:22", "Jeremiah 33:25", "Jeremiah 33:26"]);
});

test("each segment still runs forward inside one book, verses never repeat, and Torah keeps its single-book order", () => {
  for (const refs of [["Jeremiah 34:22-8"], ["Jeremiah 34:8-22", "Jeremiah 34:22"], ["Jeremiah 34:8-22", "Jeremiah 34:10-12"], ["Hosea 14:2-10", "Hosea 14:2"]])
    expect(() => expandReadingRanges(refs, "haftarah", counts)).toThrow();
  for (const refs of [["Exodus 21:1-3", "Genesis 1:1"], ["Exodus 21:5", "Exodus 21:1"]])
    expect(() => expandReadingRanges(refs, "torah", counts)).toThrow("ordered and nonoverlapping within one book");
  expect(expandReadingRanges(["Exodus 21:1-3", "Exodus 22:1"], "torah", counts)).toEqual(["Exodus 21:1", "Exodus 21:2", "Exodus 21:3", "Exodus 22:1"]);
  expect(readingSegments("Isaiah 27:6-28:13; Isaiah 29:22-23")).toEqual(["Isaiah 27:6-28:13", "Isaiah 29:22-23"]);
  expect(readingSegments("Isaiah 1:1-3")).toEqual(["Isaiah 1:1-3"]);
});

test("a haftarah that cannot be read never takes the Torah reading with it", async () => {
  const shemot = fixture("shemot");
  const broken = [
    [{ k: "Isaiah", b: "27:6", e: "28:13", v: 21 }, { k: "Isaiah", b: "29:22", e: "29:99", v: 2 }],
    [{ k: "Isaiah", b: "27:6", e: "28:13", v: 21 }, { k: "Isaiah", b: "28:1", e: "28:2", v: 2 }],
    [{ k: "Nowhere", b: "1:1", e: "1:2" }],
    { k: "Isaiah", b: "27:6", e: "28:13", v: 99 },
    [],
    Array.from({ length: 33 }, (_, i) => ({ k: "Isaiah", b: `1:${i + 1}`, e: `1:${i + 1}` })),
    "Isaiah 27:6",
  ];
  for (const haft of broken) {
    const payload = structuredClone(shemot); payload.items[0].haft = haft;
    const h = reader(payload), { snapshot } = await h.load(dateOf(payload));
    expect(snapshot.reading?.parashah).toBe("Shemot");
    expect(snapshot.classification).toBe("regular");
    expect(snapshot.haftarah).toBeNull();
    expect(JSON.stringify(vi.mocked(h.cache.set).mock.calls[0][1].payload)).not.toContain("\"haft\"");
    expect((await h.load(dateOf(payload))).snapshot).toEqual(snapshot);
  }
});

test("single-range readings and their keys are unchanged; multi-range keys round-trip", () => {
  expect(readingKeyFor({ kind: "haftarah", haftarahRef: "II Kings 12:1-17" })).toBe("ii-kings-12-1-12-17");
  expect(haftarahRefForKey("ii-kings-12-1-12-17", counts)).toBe("II Kings 12:1-17");
  const cases: [string, string][] = [
    ["Isaiah 27:6-28:13; Isaiah 29:22-23", "isaiah-27-6-28-13-isaiah-29-22-29-23"],
    ["Hosea 14:2-10; Micah 7:18-20; Joel 2:15-27", "hosea-14-2-14-10-micah-7-18-7-20-joel-2-15-2-27"],
    ["Jeremiah 34:8-22; Jeremiah 33:25-26", "jeremiah-34-8-34-22-jeremiah-33-25-33-26"],
    ["Jeremiah 2:4-28; Jeremiah 3:4; Jeremiah 4:1-2", "jeremiah-2-4-2-28-jeremiah-3-4-3-4-jeremiah-4-1-4-2"],
    ["I Kings 18:46-19:21", "i-kings-18-46-19-21"],
  ];
  for (const [ref, key] of cases) {
    expect(readingKeyFor({ kind: "haftarah", haftarahRef: ref })).toBe(key);
    expect(haftarahRefForKey(key, counts)).toBe(ref);
    expect(key).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  }
  for (const key of ["isaiah-27-6-28-13-isaiah-28-1-28-2", "isaiah-27-6-28-13-", "isaiah-27-6-28-13-nowhere-1-1-1-1", "isaiah-27-6-28-13-isaiah-29-22"])
    expect(haftarahRefForKey(key, counts)).toBeNull();
});

test("an assignment inside a multi-range haftarah carries the passage key; one outside it does not", async () => {
  const payload = fixture("mishpatim"), { snapshot } = await reader(payload).load(dateOf(payload));
  const key = "jeremiah-34-8-34-22-jeremiah-33-25-33-26";
  expect(assignmentReadingKey(snapshot, "haftarah", ["Jeremiah 33:25", "Jeremiah 33:26"], counts)).toBe(key);
  expect(assignmentReadingKey(snapshot, "haftarah", expandReadingRanges(readingSegments(snapshot.haftarah!), "haftarah", counts), counts)).toBe(key);
  expect(assignmentReadingKey(snapshot, "haftarah", ["Jeremiah 33:24"], counts)).toBeNull();
  expect(assignmentReadingKey(snapshot, "torah", ["Exodus 21:1"], counts)).toBe("mishpatim");
});

test("a stored or injected snapshot with a multi-range haftarah validates; a malformed one is refused", async () => {
  const payload = fixture("shabbat-shuva"), date = dateOf(payload), { snapshot } = await reader(payload).load(date);
  expect(validatedSnapshot(JSON.parse(JSON.stringify(snapshot)), date, "diaspora", counts).haftarah).toBe("Hosea 14:2-10; Joel 2:15-27");
  for (const haftarah of ["Hosea 14:2-10; Hosea 14:2", "Hosea 14:2-10;", "Hosea 14:10-2", "Hosea 14:2-10;Joel 2:15-27", "Hosea 14:2-10;  Joel 2:15-27", 7])
    expect(() => validatedSnapshot({ ...snapshot, haftarah }, date, "diaspora", counts)).toThrow();
});
