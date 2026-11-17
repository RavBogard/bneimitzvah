import { describe, expect, it } from "vitest";
import { nextStep, runThroughHref, upCloseHref, upCloseTarget, UP_CLOSE_HREF } from "../../src/components/portal/workspace/today/model";
import type { Reading } from "../../src/components/portal/workspace/api";

// Student gaps A3 (2026-11-16 review): the pinned card's and the front door's next step. Synthetic readings, real verse references.
const SOURCE = { status: "unknown", fetchedAt: null, date: null, calendar: null, attribution: null };
const reading = (kind: Reading["kind"], verses: string[], aliyahStarts: string[] | null = null) => ({ id: `00000000-0000-4000-8000-00000000000${kind === "torah" ? 1 : 2}`, kind, revision: 1,
  ranges: [], verses, needsReview: false, aliyahStarts, source: SOURCE, confirmationDate: null, basis: "synthetic" }) as unknown as Reading;
const marks = (got: Record<string, string[]>) => new Map(Object.entries(got).map(([kind, refs]) => [kind as Reading["kind"], refs.map(verseRef => ({ verseRef, selfCheck: { state: "got-it" as const, version: 1 } }))]));
const torah = reading("torah", ["Genesis 37:1", "Genesis 37:2", "Genesis 37:3", "Genesis 37:4"], ["Genesis 37:3"]);
const haftarah = reading("haftarah", ["Amos 2:6", "Amos 2:7"]);

describe("the next step on a student's own reading", () => {
  it("opens Up close at the first verse not marked Got it, by its address, and names its aliyah when the tutor recorded them", () => {
    const step = nextStep([torah, haftarah], marks({ torah: ["Genesis 37:1", "Genesis 37:2"] }));
    expect(step).toMatchObject({ kind: "verse", reading: "torah", ref: "Genesis 37:3", href: upCloseHref("torah", "Genesis 37:3") });
    expect(step?.label).toContain("Aliyah 2");
    expect(nextStep([torah, haftarah], marks({}))).toMatchObject({ ref: "Genesis 37:1" });
  });
  it("moves on to the haftarah once the Torah is all Got it, and to the Run-through once everything is", () => {
    expect(nextStep([torah, haftarah], marks({ torah: torah.verses as string[] }))).toMatchObject({ kind: "verse", reading: "haftarah", ref: "Amos 2:6" });
    expect(nextStep([torah, haftarah], marks({ torah: torah.verses as string[], haftarah: ["Amos 2:6", "Amos 2:7"] }))).toMatchObject({ kind: "run-through", href: "/learn/run-through" });
    expect(nextStep([haftarah], marks({ haftarah: ["Amos 2:6", "Amos 2:7"] }))).toMatchObject({ kind: "run-through", href: "/learn/run-through?kind=haftarah" });
    expect(nextStep([], marks({}))).toBeNull();
  });
  it("reads its own address back, and nothing else", () => {
    expect(upCloseTarget(new URL(`https://example.test${upCloseHref("haftarah", "Amos 2:6")}`).hash)).toEqual({ kind: "haftarah", ref: "Amos 2:6" });
    expect(upCloseTarget(new URL(`https://example.test${UP_CLOSE_HREF}`).hash)).toBe("first");
    for (const hash of ["", "#lessons", "#service-parts", "#up-close:midrash:Genesis%201%3A1", "#up-close:torah:%E0%A4%A"]) expect(upCloseTarget(hash), hash).toBeNull();
    expect(runThroughHref([{ kind: "torah" }, { kind: "haftarah" }])).toBe("/learn/run-through");
  });
  it("is one deliberate wording test: the verse, with its aliyah, as the button says it", () => {
    expect(nextStep([torah], marks({ torah: ["Genesis 37:1", "Genesis 37:2"] }))?.label).toBe("Practice Aliyah 2 · Genesis 37:3");
    expect(nextStep([haftarah], marks({}))?.label).toBe("Practice Amos 2:6");
    expect(nextStep([haftarah], marks({ haftarah: ["Amos 2:6", "Amos 2:7"] }))?.label).toBe("Run-through");
  });
});
