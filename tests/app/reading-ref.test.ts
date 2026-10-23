import { expect, test } from "vitest";
import { TANAKH_VERSE_COUNTS } from "../../src/lib/readings/catalog";
import { canonicalReadingRef, joinReadingRef, READING_REF_LIMITS, READING_REF_SEPARATOR, refCorpus } from "../../src/lib/readings/reading-ref";

// Numbers and book names only.
test("the limits are the 1.4 saved-reading limits: 1000 characters, 1000 verses, 32 segments, joined by \"; \"", () => {
  expect(READING_REF_LIMITS).toEqual({ chars: 1000, segments: 32, verses: 1000 });
  expect(READING_REF_SEPARATOR).toBe("; ");
  expect(Object.isFrozen(READING_REF_LIMITS)).toBe(true);
});

test("canonical Hebcal forms are accepted, whole, with their verses in order", () => {
  const torah = canonicalReadingRef("Genesis 12:1-20", "torah")!;
  expect(torah).toMatchObject({ ref: "Genesis 12:1-20", kind: "torah", segments: ["Genesis 12:1-20"] });
  expect(torah.verses).toHaveLength(20); expect(torah.verses[0]).toBe("Genesis 12:1"); expect(torah.verses.at(-1)).toBe("Genesis 12:20");
  expect(Object.isFrozen(torah) && Object.isFrozen(torah.segments) && Object.isFrozen(torah.verses)).toBe(true);
  for (const [ref, kind, verses] of [
    ["Genesis 1:1-6:8", "torah", 31 + 25 + 24 + 26 + 32 + 8], ["Exodus 30:11", "torah", 1], ["Exodus 32:11-14; Exodus 34:1-10", "torah", 14],
    ["Deuteronomy 33:1-34:12", "torah", 29 + 12], ["Isaiah 27:6-28:13; Isaiah 29:22-23", "haftarah", 8 + 13 + 2],
    // A haftarah may cross books or return to an earlier chapter, as those haftarot are read.
    ["Hosea 14:2-10; Joel 2:15-27", "haftarah", 9 + 13], ["Jeremiah 34:8-22; Jeremiah 33:25-26", "haftarah", 17], ["Joshua 3:5-7; Joshua 5:2-6:1; Joshua 6:27", "haftarah", 3 + 14 + 1 + 1],
    ["I Samuel 20:18-42", "haftarah", 25], ["Obadiah 1:1-21", "haftarah", 21],
  ] as const) {
    const value = canonicalReadingRef(ref, kind);
    expect(value?.ref, ref).toBe(ref); expect(value?.verses.length, ref).toBe(verses);
    expect(joinReadingRef(value!.segments)).toBe(ref);
  }
});

test("non-canonical spellings are refused, never repaired", () => {
  for (const ref of ["Genesis 12:1-12:20", "Genesis 12:1-1", "Genesis 12:01-20", "Genesis 012:1", "Genesis 12:1-020", "Genesis  12:1-20", " Genesis 12:1-20", "Genesis 12:1-20 ",
    "Genesis 12:1 -20", "Genesis 12 :1", "genesis 12:1-20", "GENESIS 12:1", "Gen 12:1", "Genesis 12", "Genesis 12:", "Genesis 12:1-", "Genesis 12:1-20:", "Genesis",
    "Genesis 12:1-20;", "Genesis 12:1-20; ", "Genesis 12:1-20;Genesis 13:1", "Genesis 12:1-20;  Genesis 13:1", "Genesis 12:1-20 ; Genesis 13:1", "Genesis 12:1-20, 13:1",
    "Genesis 12:1-20;; Genesis 13:1", "; Genesis 12:1", "Genesis 12:1\tGenesis 13:1", "Genesis 12:1-20\n", "", "1 Samuel 1:1", "Exodus 30:11-11", "Genesis 12.1"]) {
    expect(canonicalReadingRef(ref, "torah"), JSON.stringify(ref)).toBeNull();
  }
  expect(canonicalReadingRef("1 Kings 1:1", "haftarah")).toBeNull();
  expect(canonicalReadingRef("Isaiah 66:1-24; Isaiah 66:23", "haftarah")).toBeNull(); // a repeated verse
});

test("Ketuvim, and a kind that does not match the corpus, are refused", () => {
  for (const ref of ["Psalms 1:1-6", "Ruth 1:1-22", "Esther 1:1", "Song of Songs 1:1", "Lamentations 1:1", "Ecclesiastes 1:1", "Isaiah 1:1; Psalms 1:1"]) {
    expect(canonicalReadingRef(ref, "haftarah"), ref).toBeNull();
    expect(canonicalReadingRef(ref, "torah"), ref).toBeNull();
    expect(refCorpus(ref), ref).toBeNull();
  }
  expect(canonicalReadingRef("Isaiah 1:1-3", "torah")).toBeNull();
  expect(canonicalReadingRef("Genesis 1:1-3", "haftarah")).toBeNull();
  expect(canonicalReadingRef("Genesis 1:1; Isaiah 1:1", "torah")).toBeNull();
  expect(canonicalReadingRef("Genesis 1:1; Isaiah 1:1", "haftarah")).toBeNull();
  expect(refCorpus("Genesis 1:1; Isaiah 1:1")).toBeNull();
  expect(refCorpus("Exodus 32:11-14; Exodus 34:1-10")).toBe("torah");
  expect(refCorpus("Hosea 14:2-10; Joel 2:15-27")).toBe("neviim");
  for (const kind of ["megillah", "Torah", "", undefined, null, 1]) expect(canonicalReadingRef("Genesis 1:1", kind), String(kind)).toBeNull();
});

test("a Torah passage stays in one book, in order, without overlap; no passage repeats a verse", () => {
  for (const ref of ["Genesis 50:26; Exodus 1:1", "Genesis 2:1; Genesis 1:1", "Genesis 1:1-5; Genesis 1:3-8", "Genesis 1:1; Genesis 1:1", "Genesis 1:5; Genesis 1:5-6"]) {
    expect(canonicalReadingRef(ref, "torah"), ref).toBeNull();
  }
  for (const ref of ["Isaiah 1:1-3; Isaiah 1:1-3", "Isaiah 1:1-5; Isaiah 1:5-9", "Isaiah 1:1-9; Isaiah 1:2"]) expect(canonicalReadingRef(ref, "haftarah"), ref).toBeNull();
  expect(canonicalReadingRef("Genesis 1:1; Genesis 1:3", "torah")?.verses).toEqual(["Genesis 1:1", "Genesis 1:3"]);
});

test("bounds: chapters and verses inside the book, at most 32 segments and 1000 verses, at most 1000 characters", () => {
  for (const ref of ["Genesis 51:1", "Genesis 1:32", "Genesis 0:1", "Genesis 1:0", "Genesis 1:31-2:26", "Malachi 4:1", "Obadiah 2:1"]) {
    expect(canonicalReadingRef(ref, ref.startsWith("Genesis") ? "torah" : "haftarah"), ref).toBeNull();
  }
  const segments = (n: number) => joinReadingRef(Array.from({ length: n }, (_, i) => `Genesis ${i + 1}:1`));
  expect(canonicalReadingRef(segments(32), "torah")?.segments).toHaveLength(32);
  expect(canonicalReadingRef(segments(33), "torah")).toBeNull();
  // Exactly 1000 verses from Genesis 1:1, then one more.
  const genesis = TANAKH_VERSE_COUNTS.Genesis; let chapter = 0, total = 0;
  while (total + genesis[chapter] < 1000) total += genesis[chapter++];
  const end = `${chapter + 1}:${1000 - total}`, next = 1000 - total + 1 <= genesis[chapter] ? `${chapter + 1}:${1000 - total + 1}` : `${chapter + 2}:1`;
  expect(canonicalReadingRef(`Genesis 1:1-${end}`, "torah")?.verses).toHaveLength(1000);
  expect(canonicalReadingRef(`Genesis 1:1-${next}`, "torah")).toBeNull();
  expect(canonicalReadingRef("Genesis 1:1-50:26", "torah")).toBeNull();
  expect(canonicalReadingRef("Genesis 1:1" + " ".repeat(990) + "x", "torah")).toBeNull();
  expect(canonicalReadingRef("a".repeat(1001), "torah")).toBeNull();
});

test("lookalike digits, letters, spaces and separators are refused", () => {
  for (const ref of ["Genesis １２:1", "Genesis ١٢:١", "Genesis 12：1", "Gеnesis 12:1", "Genesis 12:1", "Genesis 12:1‏", "‪Genesis 12:1",
    "Genesis 12:1-20； Genesis 13:1", "Genesis 12:1-20; Genesis 13:1", "Genesis 12:1–20", "Genesis 12:1−20", "Genesis \u{1d7f7}:1"]) {
    expect(canonicalReadingRef(ref, "torah"), JSON.stringify(ref)).toBeNull();
    expect(refCorpus(ref), JSON.stringify(ref)).toBeNull();
  }
  for (const value of [undefined, null, 12, ["Genesis 1:1"], { toString: () => "Genesis 1:1" }]) expect(canonicalReadingRef(value, "torah")).toBeNull();
});
