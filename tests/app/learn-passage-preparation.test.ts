import { describe, expect, it } from "vitest";
import { adjacentPassageVerses, passageBoundary, passageReference, passageRunEnd, preparationHref, preparationTarget, referencePassageFlags, selectedPassage } from "../../src/lib/learn/passage-preparation";
import { preparationParts } from "../../src/lib/learn/preparation";
import { verse, threePhrases } from "./learn-synthetic";

const make = (ref: string, wordReady = true) => verse(ref, threePhrases(), "torah", { wordReady });
describe("public passage preparation", () => {
  it("does not turn the end of a selected haftarah excerpt into the special ending or a recording boundary", () => {
    expect(referencePassageFlags(["same", "same"], 1)).toEqual({ final: false, endsRecording: null });
    expect(referencePassageFlags(["same", "same"], 0)).toEqual({ final: false, endsRecording: false });
    expect(referencePassageFlags(["first", "next"], 0)).toEqual({ final: false, endsRecording: true });
    expect(referencePassageFlags([null, null], 0)).toEqual({ final: false, endsRecording: null });
  });
  it("keeps canonical reading order and stops a section before a missing model or omitted verse", () => {
    const verses = [make("Genesis 1:1"), make("Genesis 1:2"), make("Genesis 1:3", false), make("Genesis 1:4"), make("Genesis 1:6")];
    expect(passageRunEnd(verses, 0)).toBe(1);
    expect(selectedPassage(verses, 0, 1).map(v => v.ref)).toEqual(["Genesis 1:1", "Genesis 1:2"]);
    expect(selectedPassage(verses, 0, 3)).toEqual([]);
    expect(passageRunEnd(verses, 2)).toBe(1);
    expect(passageRunEnd(verses, 3)).toBe(3);
    expect(selectedPassage(verses, -1, 1)).toEqual([]);
    expect(selectedPassage(verses, .5, 1)).toEqual([]);
  });
  it("requires true canonical adjacency, including across chapters", () => {
    expect(adjacentPassageVerses(make("Genesis 1:31"), make("Genesis 2:1"))).toBe(true);
    expect(adjacentPassageVerses(make("Genesis 1:30"), make("Genesis 2:1"))).toBe(false);
    expect(adjacentPassageVerses(make("Genesis 1:1"), make("Genesis 1:3"))).toBe(false);
    expect(adjacentPassageVerses(make("Genesis 50:26"), make("Exodus 1:1"))).toBe(false);
  });
  it("uses the last and first full canonical phrases, with no guessed tiny cuts", () => {
    const a = make("Genesis 1:1"), b = make("Genesis 1:2");
    expect(passageBoundary(a, b)).toEqual({ left: preparationParts(a).at(-1), right: preparationParts(b)[0] });
    expect(passageBoundary(a, make("Genesis 1:3"))).toBeNull();
    expect(passageBoundary(a, make("Genesis 1:2", false))).toBeNull();
  });
  it("makes exact canonical public return references without private context", () => {
    expect(passageReference([make("Genesis 1:1"), make("Genesis 1:2")])).toBe("Genesis 1:1-2");
    expect(passageReference([make("Genesis 1:31"), make("Genesis 2:1")])).toBe("Genesis 1:31-2:1");
    expect(passageReference([make("Genesis 1:1"), make("Genesis 1:3")])).toBeNull();
    expect(passageReference([])).toBeNull();
    expect(new URL(preparationHref("Genesis 1:1-2", "torah"), "https://example.test").searchParams.get("ref")).toBe("Genesis 1:1-2");
  });
  it("validates optional public targets against the existing reading contract", () => {
    expect(preparationTarget({})).toEqual({ ref: null, kind: "torah" });
    expect(preparationTarget({ kind: "haftarah" })).toEqual({ ref: null, kind: "haftarah" });
    expect(preparationTarget({ ref: "Isaiah 40:1-2", kind: "haftarah" })).toEqual({ ref: "Isaiah 40:1-2", kind: "haftarah" });
    expect(preparationTarget({ ref: "Isaiah 40:1-2" })).toBeNull();
    expect(preparationTarget({ ref: ["Genesis 1:1", "Genesis 1:2"] })).toBeNull();
    expect(preparationTarget({ kind: "saved", ref: "Genesis 1:1" })).toBeNull();
    expect(preparationTarget({ ref: "Genesis 1:999" })).toBeNull();
  });
});
