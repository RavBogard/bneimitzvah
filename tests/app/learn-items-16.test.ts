import { describe, expect, it } from "vitest";
import { syntheticWords } from "../../e2e/learn-synthetic";
import { COURSE, lessonById, type LookAlikes, type Melody, type WhichHalf } from "../../src/lib/learn/course";
import { buildPools, drillItems, itemCard, itemRefs, phraseAt, restUnit, seededRandom, type HalfItem, type LookItem } from "../../src/lib/learn/pools";
import { heardFamilies, openPractice, practiceOpen, quickTenDrill } from "../../src/lib/learn/practice";
import { completeLesson, emptyProgress } from "../../src/lib/learn/progress";
import { answerRun, currentItem, runDone, startRun } from "../../src/lib/learn/run";
import { lessonExtraRefs, lessonSources } from "../../src/components/learn/course-data";
import { A, end, threePhrases, verse, w } from "./learn-synthetic";

/** Every verse a lesson loads, as the e2e's synthetic public routes serve it (invented words, lessons.json's own edge and look-alike words). */
function lessonPools(id: string) {
  const lesson = lessonById(id)!, refs = new Map<string, Melody>();
  for (const row of lessonSources(lesson)) for (const example of row.examples) refs.set(example.ref, row.melody);
  for (const ref of lessonExtraRefs(lesson)) refs.set(ref, lesson.melody);
  return { lesson, pools: buildPools([...refs].map(([ref, kind]) => verse(ref, syntheticWords(ref, kind), kind, { endsRecording: null }))) };
}
const lookActivity = (id: string) => lessonById(id)!.activities.find((a): a is LookAlikes => a.type === "look-alikes")!;

describe("Same sign, different place: items", () => {
  it("shows two words of the lesson's melody, asks one of their two marks, never starts on a hard item, and answers no card", () => {
    for (const id of ["torah-zakef", "torah-azla", "haftarah-azla"]) for (const seed of [1, 2, 3, 4, 5, 6]) {
      const { lesson, pools } = lessonPools(id), activity = lookActivity(id);
      const items = drillItems(activity, pools, { melody: lesson.melody, focus: lesson.family }, seededRandom(seed)) as LookItem[];
      expect(items, id).toHaveLength(activity.params.items);
      expect(items[0].hard, `${id} seed ${seed}`).toBe(false);
      expect(items.map(item => item.first)).toEqual(items.map((_, n) => n === 0));
      for (const item of items) {
        expect(activity.params.pairs).toContain(item.pair);
        expect(COURSE.lookAlikes[item.pair].marks).toContain(item.ask);
        expect(item.shown[item.answer].word.mark).toBe(item.ask);
        expect(item.shown[1 - item.answer].word.mark).not.toBe(item.ask);
        expect(item.shown.every(side => side.verse.kind === lesson.melody)).toBe(true);
        expect(item.mode).toBe("read");
        expect(itemCard(item)).toBeNull();
        expect(item.context).toBe(item.pair === "azla-geresh" ? "previous-word" : "word");
      }
      for (let i = 1; i < items.length; i++) expect(itemRefs(items[i]).some(ref => itemRefs(items[i - 1]).includes(ref)), `${id} seed ${seed} at ${i}`).toBe(false);
      expect(new Set(items.map(item => item.key)).size).toBe(items.length);
    }
  });
  it("takes the pairs in turn and each example once", () => {
    const { lesson, pools } = lessonPools("torah-azla");
    const items = drillItems(lookActivity("torah-azla"), pools, { melody: "torah", focus: lesson.family }, seededRandom(9)) as LookItem[];
    expect(items.filter(item => item.pair === "pashta-kadma")).toHaveLength(2);
    expect(items.filter(item => item.pair === "kadma-azla")).toHaveLength(2);
    const haftarah = drillItems(lookActivity("haftarah-azla"), lessonPools("haftarah-azla").pools, { melody: "haftarah", focus: "azla" }, seededRandom(9)) as LookItem[];
    expect(haftarah.filter(item => item.pair === "azla-geresh")).toHaveLength(2);
    expect(haftarah.filter(item => item.pair === "pashta-kadma")).toHaveLength(1);
  });
  it("drops an example whose words no longer match the loaded verse, and shows nothing it cannot match", () => {
    // The look-alike verses replaced by invented text: none of the words match, so no item is built.
    const activity = lookActivity("torah-zakef");
    const refs = [...new Set(COURSE.lookAlikes["mahpach-yetiv"].examples.flatMap(e => [e.a.ref, e.b.ref]))];
    const pools = buildPools(refs.map(ref => verse(ref, threePhrases())));
    expect(drillItems(activity, pools, { melody: "torah", focus: "zakef" }, seededRandom(1))).toEqual([]);
  });
  it("never builds a hear-mode item whose two words sit in one phrase", () => {
    const { pools } = lessonPools("torah-azla");
    const hear = { type: "look-alikes", params: { pairs: ["kadma-azla"], items: 4, mode: "hear" } } as LookAlikes;
    expect(drillItems(hear, pools, { melody: "torah", focus: "azla" }, seededRandom(1))).toEqual([]);
    const read = { ...hear, params: { ...hear.params, mode: "read" } } as LookAlikes;
    expect(drillItems(read, pools, { melody: "torah", focus: "azla" }, seededRandom(1)).length).toBeGreaterThan(0);
  });
  it("plays the answer word's phrase in hear mode", () => {
    const value = verse("Genesis 4:4", [w(A.kadma, 0), w(A.mahpach, 1), w(A.pashta, 2), w(A.zakef, 3), w(A.tipcha, 4), end(5)]);
    expect(phraseAt(value, 2)).toMatchObject({ ref: "Genesis 4:4", family: "zakef", words: [0, 3] });
    expect(phraseAt(value, 9)).toBeNull();
  });
});

describe("Which half of the verse: items", () => {
  // One etnachta at unit 3: a zakef phrase before it, a zakef phrase after it, then the ending.
  const twoHalves = (n: number) => [w(A.munach, n), w(A.zakef, n + 1), w(A.tipcha, n + 2), w(A.etnachta, n + 3), w(A.mahpach, n + 4), w(A.pashta, n + 5), w(A.zakef, n + 6), w(A.tipcha, n + 7), end(n + 8)];
  const books = ["Genesis", "Exodus", "Leviticus", "Numbers", "Deuteronomy"];
  const activity = (params: Partial<WhichHalf["params"]> = {}): WhichHalf => ({ type: "which-half", params: { families: ["zakef"], items: 4, audio: "lead-in", verseWords: [6, 18], ...params } });
  it("asks about half before and half after, never the rest's own phrase or the ending, from verses of one rest and 6 to 18 words", () => {
    const pools = buildPools([
      ...books.map((book, b) => verse(`${book} 7:${b + 1}`, twoHalves(b))),
      verse("Genesis 9:9", [w(A.zakef, 0), w(A.etnachta, 1), w(A.zakef, 2), w(A.etnachta, 3), w(A.zakef, 4), w(A.tipcha, 5), end(6)]),
      verse("Exodus 9:9", [w(A.zakef, 0), w(A.etnachta, 1), w(A.tipcha, 2), end(3)]),
      verse("Leviticus 9:9", [w(A.munach, 0), w(A.zakef, 1), w(A.mercha, 2), w(A.tipcha, 3), w(A.mercha, 4), w(A.zakef, 5), w(A.tipcha, 6), end(7)]),
    ]);
    for (const seed of [1, 2, 3, 4]) {
      const items = drillItems(activity(), pools, { melody: "torah", focus: "zakef" }, seededRandom(seed)) as HalfItem[];
      expect(items).toHaveLength(4);
      expect(items.filter(item => item.half === "before")).toHaveLength(2);
      for (const item of items) {
        const v = pools.verses.get(item.target.ref)!;
        expect(["Genesis 9:9", "Exodus 9:9", "Leviticus 9:9"]).not.toContain(item.target.ref);
        expect(restUnit(v)).toBe(item.rest);
        expect(item.target.family).toBe("zakef");
        expect(item.half === "before" ? item.target.words[1] < item.rest : item.target.words[0] > item.rest).toBe(true);
        expect(item.target.words[1]).toBeLessThan(v.units.length - 1);
        expect(item.audio).toBe("lead-in");
        expect(itemCard(item)).toBeNull();
      }
      for (let i = 1; i < items.length; i++) expect(items[i].target.ref).not.toBe(items[i - 1].target.ref);
    }
    expect(restUnit(pools.verses.get("Genesis 9:9")!)).toBeNull();
    expect(restUnit(pools.verses.get("Leviticus 9:9")!)).toBeNull();
  });
  it("uses the other half when one half has no phrase, and nothing when no verse fits", () => {
    const after = buildPools(books.map((book, b) => verse(`${book} 8:${b + 1}`, [w(A.tipcha, b), w(A.munach, b + 1), w(A.etnachta, b + 2), w(A.mahpach, b + 3), w(A.pashta, b + 4), w(A.zakef, b + 5), w(A.tipcha, b + 6), end(b + 7)])));
    const items = drillItems(activity(), after, { melody: "torah", focus: "zakef" }, seededRandom(2)) as HalfItem[];
    expect(items.length).toBeGreaterThan(0);
    expect(items.every(item => item.half === "after")).toBe(true);
    expect(drillItems(activity({ verseWords: [12, 18] }), after, { melody: "torah", focus: "zakef" }, seededRandom(2))).toEqual([]);
    expect(drillItems(activity({ families: ["revia"] }), after, { melody: "torah", focus: null }, seededRandom(2))).toEqual([]);
  });
  it("fills the shipped placements from the lessons' own verses", () => {
    for (const id of ["haftarah-zakef"]) {
      const { lesson, pools } = lessonPools(id), half = lesson.activities.find((a): a is WhichHalf => a.type === "which-half")!;
      expect(drillItems(half, pools, { melody: lesson.melody, focus: lesson.family }, seededRandom(4)).length, id).toBeGreaterThanOrEqual(2);
    }
  });
});

describe("Quick ten", () => {
  const done = (...ids: string[]) => ids.reduce((value, id) => completeLesson(value, lessonById(id)!, Date.parse("2026-10-20T12:00:00Z")), emptyProgress());
  const torah = COURSE.practice.find(row => row.melody === "torah")!, haftarah = COURSE.practice.find(row => row.melody === "haftarah")!;
  it("opens once three families are heard in its melody, never before", () => {
    expect(practiceOpen(emptyProgress(), torah)).toBe(false);
    expect(practiceOpen(done("intro-phrases", "torah-sof-pasuk", "torah-etnachta"), torah)).toBe(false);
    const three = done("intro-phrases", "torah-sof-pasuk", "torah-etnachta", "torah-zakef");
    expect(heardFamilies(three, "torah")).toEqual(["sof-pasuk", "etnachta", "zakef"]);
    expect(practiceOpen(three, torah)).toBe(true);
    expect(practiceOpen(three, haftarah)).toBe(false);
    expect(openPractice(three).map(row => row.id)).toEqual(["quick-ten-torah"]);
    // Done out of order (a lesson done on another device), the unlock lesson alone is not enough.
    expect(practiceOpen(done("torah-zakef"), torah)).toBe(false);
    const both = done("intro-phrases", "torah-sof-pasuk", "torah-etnachta", "torah-zakef", "haftarah-sof-pasuk", "haftarah-etnachta", "haftarah-zakef");
    expect(openPractice(both).map(row => row.id)).toEqual(["quick-ten-torah", "quick-ten-haftarah"]);
  });
  it("runs ten hear-and-name items over the heard families with three choices, answering the name cards", () => {
    const families = ["sof-pasuk", "etnachta", "zakef"] as const, drill = quickTenDrill(torah, families);
    expect(drill).toEqual({ type: "hear-and-name", params: { families: [...families], items: 10, choices: 3, weight: {} } });
    expect(quickTenDrill(torah, ["sof-pasuk", "etnachta"]).params.choices).toBe(2);
    const pools = buildPools(books().flatMap((book, b) => [1, 2, 3].map(c => verse(`${book} ${c + 1}:${b + 1}`, threePhrases()))));
    const items = drillItems(drill, pools, { melody: "torah", focus: null }, seededRandom(5));
    expect(items).toHaveLength(10);
    for (const item of items) { expect(item.type).toBe("hear-and-name"); expect(itemCard(item)?.melody).toBe("torah"); }
  });
  it("brings a miss back after the ten, not three to five items on", () => {
    const pools = buildPools(books().flatMap((book, b) => [1, 2, 3].map(c => verse(`${book} ${c + 1}:${b + 1}`, threePhrases()))));
    let run = startRun(drillItems(quickTenDrill(torah, ["sof-pasuk", "etnachta", "zakef"]), pools, { melody: "torah", focus: null }, seededRandom(5)));
    const missed = currentItem(run)!;
    run = answerRun(run, false, seededRandom(1), { reask: "end" });
    expect(run.queue).toHaveLength(11);
    expect(run.queue.at(-1)!.key).toBe(missed.key);
    let guard = 0;
    while (!runDone(run) && guard++ < 20) run = answerRun(run, true, seededRandom(guard), { reask: "end" });
    expect(runDone(run)).toBe(true);
    expect(run.missed.has(missed.key)).toBe(true);
  });
  function books() { return ["Genesis", "Exodus", "Leviticus", "Numbers", "Deuteronomy"]; }
});
