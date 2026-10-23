import { describe, expect, it } from "vitest";
import { analyseVerse, exampleMatches, isSpecialMelody, unitWords } from "../../src/lib/learn/verse";
import { buildPools, drillItems, itemRefs, phraseKey, poolOf, seededRandom } from "../../src/lib/learn/pools";
import type { Drill, Example } from "../../src/lib/learn/course";
import { A, end, maqafShape, source, threePhrases, verse, w } from "./learn-synthetic";

describe("verse analysis for the course", () => {
  it("groups a maqaf chain as one unit spanning both reading words", () => {
    const value = verse("Genesis 2:2", maqafShape());
    expect(value.units).toHaveLength(9);
    expect(value.wordCount).toBe(10);
    expect(value.units[5].words).toEqual([5, 6]);
    expect(value.units[5].trope).toBe("tipcha");
    expect(value.phrases.map(p => [p.family, ...p.units])).toEqual([["zakef", 0, 3], ["etnachta", 4, 6], ["sof-pasuk", 7, 8]]);
    expect(unitWords(value, [4, 6])).toEqual([4, 7]);
    expect(value.units.map(u => u.trope)).toEqual(["mercha", "tipcha", "mercha", "zakef-katan", "mercha", "tipcha", "etnachta", "tipcha", "silluq"]);
  });
  it("counts munach legarmeh as revia", () => {
    const value = verse("Genesis 3:3", [w(A.munach, 0), "׀", w(A.mercha, 1), w(A.tipcha, 2), end(3)]);
    expect(value.units[0].trope).toBe("munach-legarmeh");
    expect(value.phrases[0]).toMatchObject({ family: "revia", units: [0, 0] });
  });
  it("gives the last verse of a haftarah its own ending family", () => {
    const value = verse("Isaiah 2:2", threePhrases(), "haftarah", { final: true });
    expect(value.phrases.at(-1)!.family).toBe("sof-haftarah");
    expect(verse("Isaiah 2:2", threePhrases(), "haftarah").phrases.at(-1)!.family).toBe("sof-pasuk");
  });
  it("keeps an example only while its edge words and phrase still match the engine", () => {
    const value = verse("Genesis 4:4", threePhrases()), words = threePhrases();
    const example = (first: number, last: number, firstWord = words[first], lastWord = words[last]): Example => ({ ref: "Genesis 4:4", words: [first, last], firstWord, lastWord, why: "Synthetic.", tropes: [] });
    expect(exampleMatches(value, example(4, 5), "zakef")).toBe(true);
    expect(exampleMatches(value, example(4, 5), "revia")).toBe(false);
    expect(exampleMatches(value, example(3, 5), "zakef")).toBe(false);
    expect(exampleMatches(value, example(4, 5, w(A.munach, 9)), "zakef")).toBe(false);
    const whole: Example = { ref: "Genesis 4:4", words: [0, 8], firstWord: words[0], lastWord: words[8], why: "Synthetic.",
      phrases: [{ family: "etnachta", words: [0, 3] }, { family: "zakef", words: [4, 5] }, { family: "sof-pasuk", words: [6, 8] }] };
    expect(exampleMatches(value, whole, null)).toBe(true);
    expect(exampleMatches(value, { ...whole, phrases: whole.phrases!.slice(1) }, null)).toBe(false);
  });
  it("knows the special-melody passages", () => {
    for (const ref of ["Genesis 1:5", "Genesis 1:31", "Exodus 15:1", "Exodus 15:19", "Exodus 20:3", "Numbers 33:11", "Numbers 33:49", "Deuteronomy 5:6", "Genesis 35:22"]) expect(isSpecialMelody(ref), ref).toBe(true);
    for (const ref of ["Genesis 1:1", "Genesis 1:6", "Exodus 15:20", "Numbers 33:10", "Numbers 33:50", "Isaiah 5:5"]) expect(isSpecialMelody(ref), ref).toBe(false);
  });
});

describe("the pool builder", () => {
  it("puts every phrase of a loaded verse into its family's pool, not only the example phrase", () => {
    const pools = buildPools([verse("Genesis 4:4", threePhrases()), verse("Exodus 4:4", threePhrases())]);
    expect(poolOf(pools, "etnachta", "torah").map(p => p.ref)).toEqual(["Genesis 4:4", "Exodus 4:4"]);
    expect(poolOf(pools, "zakef", "torah")).toHaveLength(2);
    expect(poolOf(pools, "sof-pasuk", "torah")[0]).toMatchObject({ words: [6, 8], tropes: ["mercha", "tipcha", "silluq"], book: "Genesis" });
    expect(poolOf(pools, "zakef", "haftarah")).toHaveLength(0);
  });
  it("applies ACTIVITIES.md's rules: 1 to 5 words, no special melody, no unplaced or final sof pasuk, word-ready only", () => {
    const long = [w(A.mercha, 0), w(A.mercha, 1), w(A.mercha, 2), w(A.mercha, 3), w(A.mercha, 4), w(A.etnachta, 5), w(A.tipcha, 6), end(7)];
    const pools = buildPools([
      verse("Genesis 5:5", long),
      verse("Genesis 1:5", threePhrases()),
      verse("Leviticus 4:4", threePhrases(), "torah", { endsRecording: true }),
      verse("Leviticus 5:5", threePhrases(), "torah", { endsRecording: null }),
      verse("Numbers 4:4", threePhrases(), "torah", { wordReady: false }),
      verse("Isaiah 3:3", threePhrases(), "haftarah", { final: true }),
    ]);
    expect(poolOf(pools, "etnachta", "torah").map(p => p.ref)).toEqual(["Leviticus 4:4", "Leviticus 5:5"]);
    expect(poolOf(pools, "sof-pasuk", "torah").map(p => p.ref)).toEqual(["Genesis 5:5"]);
    expect(poolOf(pools, "sof-pasuk", "haftarah")).toHaveLength(0);
    expect(poolOf(pools, "sof-haftarah", "haftarah").map(p => p.ref)).toEqual(["Isaiah 3:3"]);
  });
  it("treats munach legarmeh as revia in the pools", () => {
    const pools = buildPools([verse("Genesis 3:3", [w(A.munach, 0), "׀", w(A.mercha, 1), w(A.tipcha, 2), end(3)])]);
    expect(poolOf(pools, "revia", "torah")[0]).toMatchObject({ words: [0, 0], tropes: ["munach-legarmeh"] });
  });
});

describe("drill items", () => {
  const books = ["Genesis", "Exodus", "Leviticus", "Numbers", "Deuteronomy"];
  const many = () => buildPools(books.flatMap((book, b) => [1, 2, 3].map(c => verse(`${book} ${c + 1}:${b + 1}`, threePhrases()))));
  const hear: Drill = { type: "hear-and-name", params: { families: ["sof-pasuk", "etnachta", "zakef"], items: 8, choices: 3, weight: {} } };
  it("is deterministic for a seed and never plays two items in a row from one verse", () => {
    const one = drillItems(hear, many(), { melody: "torah", focus: "zakef" }, seededRandom(7));
    const two = drillItems(hear, many(), { melody: "torah", focus: "zakef" }, seededRandom(7));
    expect(one.map(item => item.key)).toEqual(two.map(item => item.key));
    expect(one).toHaveLength(8);
    for (let i = 1; i < one.length; i++) expect(itemRefs(one[i]).some(ref => itemRefs(one[i - 1]).includes(ref))).toBe(false);
  });
  it("asks the lesson's own family about half the time and spreads items across books", () => {
    const items = drillItems(hear, many(), { melody: "torah", focus: "zakef" }, seededRandom(3)).filter(item => item.type === "hear-and-name");
    expect(items.filter(item => item.answer.family === "zakef").length).toBe(4);
    expect(new Set(items.map(item => item.answer.book)).size).toBeGreaterThanOrEqual(4);
    for (const item of items) { expect(item.choices).toContain(item.answer.family); expect(new Set(item.choices).size).toBe(3); }
  });
  it("weights distractors 2 to 1 toward confusable neighbours", () => {
    const four: Drill = { type: "hear-and-name", params: { families: ["zakef", "revia", "tevir", "etnachta", "sof-pasuk"], items: 1, choices: 2, weight: {} } };
    const verses = books.flatMap((book, b) => [1, 2].map(c => verse(`${book} ${c + 1}:${b + 1}`, [w(A.munach, 0), w(A.zakef, 1), w(A.darga, 2), w(A.tevir, 3), w(A.munach, 4), w(A.revia, 5), w(A.tipcha, 6), end(7)])));
    const counts = new Map<string, number>(), pools = buildPools(verses);
    for (let seed = 1; seed <= 600; seed++) {
      const [item] = drillItems(four, pools, { melody: "torah", focus: "zakef" }, seededRandom(seed));
      if (item?.type === "hear-and-name" && item.answer.family === "zakef") { const other = item.choices.find(c => c !== "zakef")!; counts.set(other, (counts.get(other) ?? 0) + 1); }
    }
    // zakef confuses with revia (and zakef gadol, segol): revia should come up about twice as often as tevir.
    expect((counts.get("revia") ?? 0) / (counts.get("tevir") ?? 1)).toBeGreaterThan(1.5);
  });
  it("builds same-or-different pairs from two different verses, half the same", () => {
    const drill: Drill = { type: "same-or-different", params: { families: ["sof-pasuk", "etnachta"], items: 6 } };
    const items = drillItems(drill, many(), { melody: "torah", focus: "sof-pasuk" }, seededRandom(11));
    expect(items).toHaveLength(6);
    for (const item of items) if (item.type === "same-or-different") { expect(item.first.ref).not.toBe(item.second.ref); expect(item.same).toBe(item.first.family === item.second.family); }
    expect(items.filter(item => item.type === "same-or-different" && item.same)).toHaveLength(3);
  });
  it("draws the end and tap drills from verses of the right length", () => {
    const short = verse("Genesis 9:9", [w(A.tipcha, 0), w(A.etnachta, 1), w(A.tipcha, 2), end(3)]);
    const pools = buildPools([short, ...[1, 2, 3, 4].map(n => verse(`Exodus ${n}:9`, threePhrases()))]);
    const ending: Drill = { type: "where-does-it-end", params: { families: ["etnachta"], items: 4, audio: true, verseWords: [5, 12] } };
    const items = drillItems(ending, pools, { melody: "torah", focus: "etnachta" }, seededRandom(5));
    expect(items).toHaveLength(4);
    for (const item of items) expect(item.type === "where-does-it-end" && item.target.ref).not.toBe("Genesis 9:9");
    const tap: Drill = { type: "tap-the-phrase", params: { families: ["zakef"], items: 3, verseWords: [6, 12] } };
    expect(drillItems(tap, pools, { melody: "torah", focus: "zakef" }, seededRandom(5)).every(item => item.type === "tap-the-phrase" && item.target.family === "zakef")).toBe(true);
  });
  it("builds the phrase only from phrases matching a pattern with one mark per word, plus decoys", () => {
    const build: Drill = { type: "build-the-phrase", params: { family: "sof-pasuk", items: 2, patterns: [["mercha", "tipcha", "silluq"]], extraMarks: 1 } };
    const items = drillItems(build, many(), { melody: "torah", focus: "sof-pasuk" }, seededRandom(2));
    expect(items).toHaveLength(2);
    for (const item of items) if (item.type === "build-the-phrase") {
      expect(item.phrase.tropes).toEqual(["mercha", "tipcha", "silluq"]);
      expect(item.tiles).toHaveLength(4);
      expect(item.tiles).toEqual(expect.arrayContaining(["mercha", "tipcha", "silluq"]));
    }
    const other: Drill = { ...build, params: { ...build.params, patterns: [["munach", "zakef-katan"]] } } as Drill;
    expect(drillItems(other, many(), { melody: "torah", focus: "sof-pasuk" }, seededRandom(2))).toHaveLength(0);
  });
  it("returns fewer items, never a broken one, when the loaded verses cannot fill a run", () => {
    const pools = buildPools([verse("Genesis 4:4", threePhrases())]);
    const items = drillItems(hear, pools, { melody: "torah", focus: "zakef" }, seededRandom(1));
    for (let i = 1; i < items.length; i++) expect(itemRefs(items[i])[0]).not.toBe(itemRefs(items[i - 1])[0]);
    expect(items.length).toBeLessThanOrEqual(1);
    expect(new Set(items.map(item => item.type === "hear-and-name" ? phraseKey(item.answer) : "")).size).toBe(items.length);
  });
  it("refuses a verse it cannot project", () => {
    expect(analyseVerse({ ref: "Psalms 1:1", kind: "torah", hebrew: source(threePhrases()) })).toBeNull();
  });
});

import { firstVerseCandidates } from "../../src/lib/learn/first-verse";
describe("your first verse", () => {
  it("picks the shortest word-ready verse of common families, preferring two halves over a one-phrase list", () => {
    const list = verse("Genesis 7:1", [w(A.mercha, 0), w(A.tipcha, 1), end(2)]);
    const halves = verse("Genesis 7:2", [w(A.tipcha, 0), w(A.etnachta, 1), w(A.tipcha, 2), end(3)]);
    const rare = verse("Genesis 7:3", [w(A.pazer, 0), w(A.tipcha, 1), end(2)]);
    const quiet = verse("Genesis 7:4", [w(A.tipcha, 0), w(A.etnachta, 1), end(2)], "torah", { wordReady: false });
    const long = verse("Genesis 7:5", threePhrases());
    expect(firstVerseCandidates([long, rare, list, quiet, halves], 12).map(v => v.ref)).toEqual(["Genesis 7:2", "Genesis 7:5", "Genesis 7:1", "Genesis 7:3"]);
    expect(firstVerseCandidates([long], 6)).toEqual([]);
  });
});
