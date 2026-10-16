import { expect, it } from "vitest";
import type { Reading } from "../../src/components/portal/workspace/api";
import { currentReadingDraft, draftCuts, emptyReadingDraft } from "../../src/components/portal/workspace/reading-draft";

function reading(aliyahStarts: string[] | null, kind: Reading["kind"] = "torah"): Reading {
  return { id: "10000000-0000-4000-8000-000000000001", kind, revision: 7, basis: "custom",
    ranges: [kind === "torah" ? "Genesis 1:1-3" : "Isaiah 1:1-3"],
    verses: [1, 2, 3].map(n => `${kind === "torah" ? "Genesis" : "Isaiah"} 1:${n}`), aliyahStarts,
    confirmationDate: "2027-01-02", needsReview: true,
    source: { status: "unknown", fetchedAt: null, date: null, calendar: null, attribution: null } };
}

it("distinguishes unrecorded Torah cuts from an explicit one-aliyah seed without sharing the assignment array", () => {
  const unrecorded = currentReadingDraft(reading(null));
  expect(unrecorded.current).toEqual({ id: reading(null).id, revision: 7 });
  expect(draftCuts(unrecorded)).toBeUndefined();
  expect(draftCuts(currentReadingDraft(reading([])))).toEqual([]);
  const assignment = reading(["Genesis 1:2"]), seeded = currentReadingDraft(assignment);
  expect(draftCuts(seeded)).toEqual(["Genesis 1:2"]);
  assignment.aliyahStarts!.push("Genesis 1:3");
  expect(draftCuts(seeded)).toEqual(["Genesis 1:2"]);
});

it("seeds haftarah as an ordinary reference draft with no Torah-only metadata", () => {
  const seeded = currentReadingDraft(reading(null, "haftarah"));
  expect(seeded.custom).toBe("Isaiah 1:1-3");
  expect(seeded.current).toBeNull();
  expect(draftCuts(seeded)).toBeUndefined();
});

it("keeps independently created drafts separate and normalizes deliberate cuts without deduplicating or reordering them", () => {
  const torah = emptyReadingDraft(), haftarah = emptyReadingDraft();
  torah.custom = "Genesis 1:1-3"; torah.cutsEdited = true; torah.cuts = " Genesis 1:3 \r\n\nGenesis 1:2\nGenesis 1:2";
  expect(haftarah).toEqual(emptyReadingDraft());
  expect(draftCuts(torah)).toEqual(["Genesis 1:3", "Genesis 1:2", "Genesis 1:2"]);
  expect(draftCuts({ ...torah, cuts: " \n " })).toEqual([]);
});

it("rejects excessive or control-bearing cut entries before transport", () => {
  for (const cuts of ["x".repeat(101), "Genesis 1:\t2", Array(1000).fill("Genesis 1:2").join("\n")])
    expect(() => draftCuts({ ...emptyReadingDraft(), cutsEdited: true, cuts })).toThrow("Invalid aliyah starts");
});
