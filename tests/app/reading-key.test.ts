import { expect, test } from "vitest";
import golden from "../fixtures/portal/reading-key-golden.json";
import { assignmentReadingKey, readingKeyFor, versesInside } from "../../src/lib/readings/reading-key";
import { TANAKH_VERSE_COUNTS } from "../../src/lib/readings/catalog";
import type { Snapshot } from "../../src/lib/readings/proposals";

const named = { ...golden.parashot, ...golden.combined, ...golden.holidays } as Record<string, string>;

test("maps every golden name to its slug", () => {
  expect(Object.keys(golden.parashot)).toHaveLength(54);
  expect(Object.keys(golden.combined)).toHaveLength(7);
  for (const [name, slug] of Object.entries(named)) expect(readingKeyFor({ kind: "torah", parashah: name }), name).toBe(slug);
});

test("haftarah keys by passage", () => {
  expect(readingKeyFor({ kind: "haftarah", haftarahRef: "Ezekiel 45:16-46:18" })).toBe("ezekiel-45-16-46-18");
  expect(readingKeyFor({ kind: "haftarah", haftarahRef: "I Kings 8:1-21" })).toBe("i-kings-8-1-8-21");
  expect(readingKeyFor({ kind: "haftarah", haftarahRef: "Isaiah 61:10" })).toBe("isaiah-61-10-61-10");
});

test("two parashot sharing a special haftarah share the key", () => {
  // Shekalim's haftarah is read with Vayakhel in some years and with Vayakhel-Pekudei or Mishpatim in others.
  const withVayakhel = readingKeyFor({ kind: "haftarah", haftarahRef: "II Kings 12:1-17" });
  const withDouble = readingKeyFor({ kind: "haftarah", haftarahRef: "II Kings 12:1-17" });
  expect(withVayakhel).toBe("ii-kings-12-1-12-17");
  expect(withDouble).toBe(withVayakhel);
});

test("returns null for empty name", () => {
  expect(readingKeyFor({ kind: "torah", parashah: "" })).toBeNull();
  expect(readingKeyFor({ kind: "torah", parashah: "  '  " })).toBeNull();
  expect(readingKeyFor({ kind: "haftarah", haftarahRef: "" })).toBeNull();
  expect(readingKeyFor({ kind: "haftarah", haftarahRef: "Isaiah 61" })).toBeNull();
  expect(readingKeyFor({ kind: "haftarah", haftarahRef: "Isaiah 61:10-9" })).toBeNull();
  expect(readingKeyFor({ kind: "torah", parashah: "x".repeat(161) })).toBeNull();
});

test("versesInside is false when one verse is outside", () => {
  expect(versesInside(["Exodus 38:21", "Exodus 38:22"], ["Exodus 38:21-40:38"], "torah", TANAKH_VERSE_COUNTS)).toBe(true);
  expect(versesInside(["Exodus 38:21", "Exodus 35:1"], ["Exodus 38:21-40:38"], "torah", TANAKH_VERSE_COUNTS)).toBe(false);
  expect(versesInside([], ["Exodus 38:21-40:38"], "torah", TANAKH_VERSE_COUNTS)).toBe(false);
  expect(versesInside(["Exodus 38:21"], [], "torah", TANAKH_VERSE_COUNTS)).toBe(false);
});

const vayakhelShekalim = {
  date: "2027-03-06", calendar: "diaspora", classification: "regular", haftarah: "II Kings 12:1-17",
  reading: {
    parashah: "Vayakhel", type: "shabbat", summary: "", source: "Hebcal", triennial: null,
    aliyot: [
      { n: 1, ref: "Exodus 35:1-20" }, { n: 2, ref: "Exodus 35:21-29" }, { n: 3, ref: "Exodus 35:30-36:7" }, { n: 4, ref: "Exodus 36:8-19" },
      { n: 5, ref: "Exodus 36:20-37:16" }, { n: 6, ref: "Exodus 37:17-29" }, { n: 7, ref: "Exodus 38:1-20" }, { n: "M", ref: "Exodus 30:11-16", reason: "Shabbat Shekalim" },
    ],
  },
} as unknown as Snapshot;

test("assignment key: Torah custom range inside the week's kriyah, outside it, and without a snapshot", () => {
  expect(assignmentReadingKey(vayakhelShekalim, "torah", ["Exodus 35:1", "Exodus 35:2"], TANAKH_VERSE_COUNTS)).toBe("vayakhel");
  expect(assignmentReadingKey(vayakhelShekalim, "torah", ["Exodus 30:11"], TANAKH_VERSE_COUNTS)).toBe("vayakhel");
  expect(assignmentReadingKey(vayakhelShekalim, "torah", ["Exodus 40:1"], TANAKH_VERSE_COUNTS)).toBeNull();
  expect(assignmentReadingKey(null, "torah", ["Exodus 35:1"], TANAKH_VERSE_COUNTS)).toBeNull();
  expect(assignmentReadingKey({ ...vayakhelShekalim, reading: null } as Snapshot, "torah", ["Exodus 35:1"], TANAKH_VERSE_COUNTS)).toBeNull();
});

test("haftarah on a special Shabbat keys by its passage", () => {
  expect(assignmentReadingKey(vayakhelShekalim, "haftarah", ["II Kings 12:1", "II Kings 12:17"], TANAKH_VERSE_COUNTS)).toBe("ii-kings-12-1-12-17");
  // Vayakhel's regular haftarah (I Kings 7) is not what was read that week.
  expect(assignmentReadingKey(vayakhelShekalim, "haftarah", ["I Kings 7:40"], TANAKH_VERSE_COUNTS)).toBeNull();
  expect(assignmentReadingKey({ ...vayakhelShekalim, haftarah: null } as Snapshot, "haftarah", ["II Kings 12:1"], TANAKH_VERSE_COUNTS)).toBeNull();
});

test("malformed snapshot data never throws and yields null", () => {
  const broken = { ...vayakhelShekalim, reading: { ...vayakhelShekalim.reading, aliyot: [{ n: 1, ref: "Not a ref" }] } } as unknown as Snapshot;
  expect(assignmentReadingKey(broken, "torah", ["Exodus 35:1"], TANAKH_VERSE_COUNTS)).toBeNull();
  expect(assignmentReadingKey(vayakhelShekalim, "torah", ["nonsense"], TANAKH_VERSE_COUNTS)).toBeNull();
});
