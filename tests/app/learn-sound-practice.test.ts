import { describe, expect, it } from "vitest";
import { COURSE, FAMILY_IDS, lessonById, type Drill } from "../../src/lib/learn/course";
import { completeLesson, emptyProgress } from "../../src/lib/learn/progress";
import { buildPools, drillItems, phraseKey, seededRandom } from "../../src/lib/learn/pools";
import { optionalSoundDrills, soundAnchorPools, soundAnchors, soundRange, soundStep, startSound, taughtSoundFamilies } from "../../src/lib/learn/sound-practice";
import { recommendedLesson } from "../../src/lib/learn/recommendation";
import { lessonSteps } from "../../src/components/learn/lesson";
import { reviewItems } from "../../src/components/learn/review";
import { threePhrases, verse } from "./learn-synthetic";

const lesson = (id: string) => lessonById(id)!;
const now = Date.parse("2026-10-24T12:00:00Z");
const done = (...ids: string[]) => ids.reduce((p, id) => completeLesson(p, lesson(id), now), emptyProgress());

describe("sound production before optional recognition", () => {
  it("places an actual phrase attempt immediately after teaching and removes every introductory quiz", () => {
    const intro = lesson("intro-phrases"), v = verse("Genesis 1:1", threePhrases());
    expect(soundRange(intro, v, [0, 8])).toEqual(v.phrases[0].units);
    expect(soundRange(lesson("torah-etnachta"), v, [0, 3])).toEqual([0, 3]);
    expect(soundRange(intro, { ...v, wordReady: false }, [0, 8])).toBeNull();
    expect(lessonSteps(intro, intro.activities.filter(a => a.type !== "this-week") as Drill[]).map(step => step.kind)).toEqual(["hear", "sound", "verses", "done"]);
    for (const l of COURSE.lessons.filter(row => row.family)) {
      const steps = lessonSteps(l, optionalSoundDrills(l, new Set(FAMILY_IDS)));
      expect(steps.slice(0, 3).map(step => step.kind)).toEqual(["hear", "sound", "verses"]);
      expect(steps.filter(step => step.kind === "drill").some(step => step.activity.type === "same-or-different")).toBe(false);
    }
  });
  it("accepts a self-comparison only after an independent attempt and never creates a voice score", () => {
    let state = startSound(); expect(soundStep(state, { type: "compare", comparison: "familiar" })).toEqual(state);
    state = soundStep(state, { type: "stage", stage: "attempt" });
    state = soundStep(state, { type: "stage", stage: "compare" });
    state = soundStep(state, { type: "compare", comparison: "familiar" });
    expect(state.comparison).toBe("familiar");
    state = soundStep(state, { type: "stage", stage: "word" });
    state = soundStep(state, { type: "word", word: 2 });
    state = soundStep(state, { type: "stage", stage: "model" });
    expect(state).toEqual({ stage: "model", word: 2, comparison: null });
  });
  it("never gives a novice an untaught naming alternative or an obligatory question quota", () => {
    const current = lesson("torah-sof-pasuk"), taught = taughtSoundFamilies(current, emptyProgress(), new Set());
    expect([...taught]).toEqual(["sof-pasuk"]);
    expect(optionalSoundDrills(current, taught).some(a => a.type === "hear-and-name")).toBe(false);
    const modeled = taughtSoundFamilies(current, emptyProgress(), new Set(["etnachta"]));
    const naming = optionalSoundDrills(current, modeled).find(a => a.type === "hear-and-name");
    expect(naming?.params.families).toEqual(["sof-pasuk", "etnachta"]);
    expect(optionalSoundDrills(lesson("intro-phrases"), modeled)).toEqual([]);
    const mixed = taughtSoundFamilies(lesson("haftarah-sof-pasuk"), done("torah-sof-pasuk", "torah-etnachta"), new Set());
    expect([...mixed]).toEqual(["sof-pasuk"]); // Torah completion does not pretend to teach the new melody.
  });
  it("uses exact displayed authored anchors for the first naming questions, retaining full structural verses", () => {
    const a = verse("Genesis 7:1", threePhrases()), b = verse("Exodus 7:1", threePhrases()), incidental = verse("Numbers 7:1", threePhrases());
    const examples = new Map([
      ["torah-etnachta", [{ verse: a, example: { words: [0, 3] as const } }]],
      ["torah-sof-pasuk", [{ verse: b, example: { words: [6, 8] as const } }]],
    ]);
    const anchors = soundAnchors(lesson("torah-sof-pasuk"), examples), full = buildPools([a, b, incidental]), naming = soundAnchorPools(full, anchors);
    expect(anchors).toHaveLength(2); expect(naming.verses).toBe(full.verses);
    const asked = drillItems({ type: "hear-and-name", params: { families: ["etnachta", "sof-pasuk"], choices: 2, items: 4, weight: {} } }, naming, { melody: "torah", focus: null }, seededRandom(4));
    expect(asked.length).toBeGreaterThan(0); // A single exemplar per family can shorten a run without repeating a verse consecutively.
    const visible = new Set(anchors.map(anchor => phraseKey(anchor.phrase)));
    for (const item of asked) { if (item.type !== "hear-and-name") throw Error("Unexpected activity"); expect(visible.has(phraseKey(item.answer))).toBe(true); }
    expect(soundAnchors(lesson("torah-sof-pasuk"), new Map())).toEqual([]);
  });
  it("skips review naming if only one family is taught and never introduces random unknown alternatives", () => {
    const v = [verse("Genesis 7:1", threePhrases()), verse("Exodus 7:1", threePhrases())], pools = buildPools(v);
    const slots = [{ card: "sof-pasuk:torah:name" as const, family: "sof-pasuk" as const, melody: "torah" as const, skill: "name" as const }];
    expect(reviewItems(slots, pools, done("torah-sof-pasuk"), 4)).toEqual([]);
    const items = reviewItems([...slots, ...slots, ...slots], pools, done("torah-sof-pasuk", "torah-etnachta"), 4);
    // Daniel 2026-10-24: no same-or-different anywhere, review included; naming uses only taught families.
    expect(items.length).toBeGreaterThan(0); expect(items.every(row => row.item.type === "hear-and-name")).toBe(true);
    for (const { item } of items) if (item.type === "hear-and-name") for (const family of item.choices) expect(["sof-pasuk", "etnachta"]).toContain(family);
  });
});

describe("an early usable verse recommendation", () => {
  it("keeps the old fallback until the endings are visited, then offers a verse before the rest of the catalogue", () => {
    expect(recommendedLesson(emptyProgress())?.id).toBe("intro-phrases");
    expect(recommendedLesson(done("intro-phrases", "torah-sof-pasuk"))?.id).toBe("torah-etnachta");
    expect(recommendedLesson(done("intro-phrases", "torah-sof-pasuk", "torah-etnachta"))?.id).toBe("torah-first-verse");
    expect(recommendedLesson(done("intro-phrases", "torah-sof-pasuk", "torah-etnachta", "torah-first-verse"))?.id).toBe("torah-zakef");
    expect(recommendedLesson(done("torah-first-verse", "haftarah-sof-pasuk", "haftarah-etnachta"))?.id).toBe("haftarah-first-verse");
  });
});
