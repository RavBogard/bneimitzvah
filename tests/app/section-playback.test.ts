import { expect, test } from "vitest";
import { nextAssignedVerse } from "../../src/components/portal/workspace/study/section-playback";

test("uses the assignment window even when the next verse is in another range", () => {
  const assigned = ["Genesis 1:1", "Genesis 18:3", "Genesis 32:1"];
  const page = { offset: 0, verses: assigned, nextOffset: null };
  const next = nextAssignedVerse({ at: 0, end: 2 }, page);
  expect(next).toEqual({ kind: "verse", at: 1 });
  expect(next.kind === "verse" && assigned[next.at]).toBe("Genesis 18:3");
  expect(nextAssignedVerse({ at: 1, end: 2 }, page)).toEqual({ kind: "complete" });
});

test("crosses an actual text page and stops at the exclusive aliyah boundary", () => {
  const page = { offset: 31, verses: Array(100).fill(null), nextOffset: 131 };
  expect(nextAssignedVerse({ at: 130, end: 145 }, page)).toEqual({ kind: "page", at: 131 });
  expect(nextAssignedVerse({ at: 130, end: 131 }, page)).toEqual({ kind: "complete" });
  expect(nextAssignedVerse({ at: 130, end: 145 }, { ...page, nextOffset: 132 })).toEqual({ kind: "invalid" });
});
