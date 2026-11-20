import { expect, it } from "vitest";
import { canAutosaveDivisions, divisionsSaved } from "../../src/components/portal/workspace/aliyah-autosave";
import { currentReadingDraft } from "../../src/components/portal/workspace/reading-draft";
import type { Assigned, Reading } from "../../src/components/portal/workspace/api";

const reading: Reading = { id: "10000000-0000-4000-8000-000000000001", kind: "torah", revision: 7, basis: "custom", ranges: ["Genesis 1:1-3"], verses: ["Genesis 1:1", "Genesis 1:2", "Genesis 1:3"], aliyahStarts: null, confirmationDate: "2027-01-02", needsReview: true, source: { status: "unknown", fetchedAt: null, date: null, calendar: null, attribution: null } };

it("permits valid explicit divisions only on the exact saved Torah passage and revision", () => {
  const draft = currentReadingDraft(reading);
  expect(canAutosaveDivisions(draft, reading, reading.verses, ["Genesis 1:2"])).toBe(true);
  expect(canAutosaveDivisions(draft, reading, reading.verses, [])).toBe(true);
  for (const [choice, current, verses, starts] of [
    [{ ...draft, current: null }, reading, reading.verses, []],
    [draft, { ...reading, revision: 8 }, reading.verses, []],
    [draft, reading, reading.verses.slice(1), []],
    [draft, reading, reading.verses, ["Genesis 1:1"]],
    [draft, reading, reading.verses, ["Genesis 1:3", "Genesis 1:2"]],
  ] as const) expect(canAutosaveDivisions(choice, current, verses, starts)).toBe(false);
});

it("accepts only the confirmed receipt and an authoritative reload preserving the passage and provenance", () => {
  const starts = ["Genesis 1:2"], saved = { ...reading, revision: 8, aliyahStarts: starts }, current = { readings: [saved] } as Assigned;
  const receipt = { assignmentId: saved.id, revision: 8 };
  expect(divisionsSaved(current, reading, starts, receipt)).toBe(saved);
  for (const changed of [{ ...saved, revision: 9 }, { ...saved, verses: reading.verses.slice(1) }, { ...saved, aliyahStarts: [] }, { ...saved, confirmationDate: null }, { ...saved, needsReview: false }, { ...saved, source: { ...saved.source, date: "2027-02-01" } }])
    expect(divisionsSaved({ ...current, readings: [changed] }, reading, starts, receipt)).toBeNull();
});
