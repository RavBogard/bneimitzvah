import { describe, expect, it } from "vitest";
import raw from "../../src/lib/learn/lessons.json";
import { ALWAYS_RUN, COURSE, CourseError, drillSkill, isDrill, lessonById, lookAlikeExamples, lookAlikeRefs, melodyOfRef, practiceById, READING_ONLY_PAIRS, validateCourse,
  type LookAlikes, type WhichHalf } from "../../src/lib/learn/course";
import { lessonCards } from "../../src/lib/learn/progress";
import { lookAlikeMatches, markPlace } from "../../src/lib/learn/verse";

import { DRAFTED, lookTell, NEW } from "../../src/components/learn/activity-copy";
import { toneProblems } from "../../src/lib/learn/tone";
import { A, end, verse, w } from "./learn-synthetic";

const copy = () => JSON.parse(JSON.stringify(raw)) as Record<string, any>;
const problems = (value: unknown) => { try { validateCourse(value); return []; } catch (error) { return error instanceof CourseError ? [...error.problems] : ["other error"]; } };
const lesson = (value: Record<string, any>, id: string) => value.lessons.find((row: any) => row.id === id);
const activity = (value: Record<string, any>, id: string, type: string) => lesson(value, id).activities.find((row: any) => row.type === type);

describe("1.6 placements (learn-next-activities.md)", () => {
  it("adds look-alikes, which-half and Quick ten where the draft places them, inside the 22-item lesson bound", () => {
    const types = (id: string) => lessonById(id)!.activities.map(row => row.type);
    expect(types("intro-phrases")).toContain("which-half");
    expect(types("torah-zakef")).toEqual(expect.arrayContaining(["look-alikes", "which-half"]));
    expect(types("torah-azla")).toContain("look-alikes");
    expect(types("haftarah-zakef")).toContain("which-half");
    expect(types("haftarah-azla")).toContain("look-alikes");
    for (const row of COURSE.lessons) {
      const items = row.activities.filter(isDrill).reduce((sum, a) => sum + a.params.items, 0);
      if (row.activities.some(isDrill)) expect(items, row.id).toBeLessThanOrEqual(22);
      // Quick ten is a practice run, never a lesson activity.
      expect(row.activities.some(a => (a.type as string) === "quick-ten"), row.id).toBe(false);
    }
    const look = lessonById("torah-azla")!.activities.find((a): a is LookAlikes => a.type === "look-alikes")!;
    expect(look.params).toEqual({ pairs: ["pashta-kadma", "kadma-azla"], items: 4, mode: "read" });
    const half = lessonById("torah-zakef")!.activities.find((a): a is WhichHalf => a.type === "which-half")!;
    expect(half.params).toEqual({ families: ["zakef"], items: 4, audio: "lead-in", verseWords: [6, 18] });
    expect(lessonById("haftarah-azla")!.activities.find((a): a is LookAlikes => a.type === "look-alikes")!.params.pairs).toEqual(["pashta-kadma", "azla-geresh"]);
    expect(COURSE.practice.map(row => [row.id, row.melody, row.unlockAfter, row.activity.params.items])).toEqual([["quick-ten-torah", "torah", "torah-zakef", 10], ["quick-ten-haftarah", "haftarah", "haftarah-zakef", 10]]);
  });
  it("gives look-alikes and which-half no review card and lets them run after an early stop", () => {
    for (const id of ["torah-zakef", "torah-azla", "intro-phrases"]) for (const a of lessonById(id)!.activities.filter(isDrill)) {
      if (a.type === "look-alikes" || a.type === "which-half") { expect(drillSkill(a)).toBeNull(); expect(ALWAYS_RUN.has(a.type)).toBe(true); }
      else expect(ALWAYS_RUN.has(a.type)).toBe(false);
    }
    expect(lessonCards(lessonById("torah-zakef")!)).toEqual(["zakef:torah:name", "zakef:torah:find"]);
    expect(lessonCards(lessonById("torah-azla")!)).toEqual(["azla:torah:name", "azla:torah:find"]);
  });
  it("keeps azla against geresh reading only (Daniel, 2026-10-23), and every pair's examples in one melody each", () => {
    expect([...READING_ONLY_PAIRS]).toEqual(["azla-geresh"]);
    for (const pair of Object.values(COURSE.lookAlikes)) for (const example of pair.examples) {
      expect(melodyOfRef(example.a.ref), `${pair.id} ${example.a.ref}`).toBe(example.melody);
      expect(melodyOfRef(example.b.ref), `${pair.id} ${example.b.ref}`).toBe(example.melody);
      expect([example.a.mark, example.b.mark]).toEqual(pair.marks);
    }
    expect(COURSE.lookAlikes["azla-geresh"].examples.filter(e => e.melody === "torah")).toHaveLength(2);
    expect(COURSE.lookAlikes["azla-geresh"].examples.filter(e => e.melody === "haftarah")).toHaveLength(2);
    expect(lookAlikeExamples(lessonById("haftarah-azla")!.activities.find((a): a is LookAlikes => a.type === "look-alikes")!, "haftarah").every(row => row.example.melody === "haftarah")).toBe(true);
    expect(lookAlikeRefs("haftarah")).toEqual(expect.arrayContaining(["Isaiah 60:17", "I Kings 19:8"]));
    expect(lookAlikeRefs("torah")).toEqual(expect.arrayContaining(["Deuteronomy 30:13", "Deuteronomy 6:10"]));
  });
});

describe("the course validator refuses what 1.6 does not allow", () => {
  const expectProblem = (value: unknown, pattern: RegExp) => expect(problems(value).some(p => pattern.test(p)), JSON.stringify(problems(value).slice(0, 4))).toBe(true);
  it("accepts the shipped course", () => { expect(problems(raw)).toEqual([]); });
  it("refuses a hear-mode azla against geresh, an unknown pair, a pair with no example in the lesson's melody, and stray params", () => {
    const hear = copy(); activity(hear, "haftarah-azla", "look-alikes").params.mode = "hear"; expectProblem(hear, /azla-geresh is reading only/);
    const unknown = copy(); activity(unknown, "torah-azla", "look-alikes").params.pairs = ["pashta-kadma", "segol-zakef"]; expectProblem(unknown, /pair segol-zakef/);
    const melody = copy(); activity(melody, "torah-azla", "look-alikes").params.pairs = ["azla-geresh"];
    melody.lookAlikes["azla-geresh"].examples = melody.lookAlikes["azla-geresh"].examples.filter((e: any) => melodyOfRef(e.a.ref) === "haftarah"); expectProblem(melody, /no torah example/);
    const stray = copy(); activity(stray, "torah-azla", "look-alikes").params.timer = 5; expectProblem(stray, /unknown params timer/);
    const mode = copy(); activity(mode, "torah-azla", "look-alikes").params.mode = "sing"; expectProblem(mode, /mode/);
    const twice = copy(); activity(twice, "torah-azla", "look-alikes").params.pairs = ["kadma-azla", "kadma-azla"]; expectProblem(twice, /pairs/);
  });
  it("keeps every lesson drill at eight items or fewer; only Quick ten runs ten", () => {
    const nine = copy(); activity(nine, "torah-azla", "look-alikes").params.items = 9; expectProblem(nine, /items/);
    const half = copy(); activity(half, "torah-zakef", "which-half").params.items = 9; expectProblem(half, /items/);
    const zero = copy(); activity(zero, "torah-zakef", "which-half").params.items = 0; expectProblem(zero, /items/);
    const eleven = copy(); eleven.practice[0].activity.params.items = 11; expectProblem(eleven, /practice quick-ten-torah: items/);
    const none = copy(); none.practice[0].activity.params.items = 0; expectProblem(none, /practice quick-ten-torah: items/);
    const fraction = copy(); fraction.practice[0].activity.params.items = 9.5; expectProblem(fraction, /items/);
    const inLesson = copy(); lesson(inLesson, "torah-zakef").activities.push(inLesson.practice[0].activity); expectProblem(inLesson, /unknown type quick-ten/);
  });
  it("refuses a which-half that asks only the rest or the ending, a bad audio mode and verse lengths out of range", () => {
    const trivial = copy(); activity(trivial, "torah-zakef", "which-half").params.families = ["etnachta"]; expectProblem(trivial, /which-half|families/);
    const audio = copy(); activity(audio, "torah-zakef", "which-half").params.audio = "whole-verse"; expectProblem(audio, /audio/);
    const long = copy(); activity(long, "torah-zakef", "which-half").params.verseWords = [6, 40]; expectProblem(long, /verseWords/);
    const other = copy(); activity(other, "haftarah-zakef", "which-half").params.families = ["sof-haftarah", "zakef"]; expect(problems(other)).toEqual([]);
    const outside = copy(); activity(outside, "torah-zakef", "which-half").params.families = ["sof-haftarah", "zakef"]; expectProblem(outside, /families/);
  });
  it("checks the look-alike data itself: the four pairs, their marks, words that carry them, neighbours for kadma and azla", () => {
    const missing = copy(); delete missing.lookAlikes["mahpach-yetiv"]; expectProblem(missing, /four pairs/);
    const extra = copy(); extra.lookAlikes["segol-zakef"] = extra.lookAlikes["kadma-azla"]; expectProblem(extra, /four pairs/);
    const marks = copy(); marks.lookAlikes["pashta-kadma"].marks = ["kadma", "pashta"]; expectProblem(marks, /pashta-kadma: marks/);
    const wrongMark = copy(); wrongMark.lookAlikes["pashta-kadma"].examples[0].a.text = wrongMark.lookAlikes["pashta-kadma"].examples[0].b.text; expectProblem(wrongMark, /does not carry pashta/);
    const latin = copy(); latin.lookAlikes["mahpach-yetiv"].examples[0].a.text = "word֤"; expectProblem(latin, /does not carry mahpach/);
    const apart = copy(); apart.lookAlikes["kadma-azla"].examples[0].b.word = 3; expectProblem(apart, /not the word after its kadma/);
    const mixed = copy(); mixed.lookAlikes["pashta-kadma"].examples[0].b.ref = "Isaiah 54:11"; expectProblem(mixed, /two melodies/);
    const listening = copy(); delete listening.lookAlikes["azla-geresh"].readingOnly; expectProblem(listening, /readingOnly/);
    const context = copy(); context.lookAlikes["azla-geresh"].context = "word"; expectProblem(context, /context/);
    const first = copy(); first.lookAlikes["azla-geresh"].examples[0].b.word = 0; expectProblem(first, /no word before/);
    const field = copy(); field.lookAlikes["pashta-kadma"].examples[0].a.audio = "x.mp3"; expectProblem(field, /shape/);
    const many = copy(); many.lookAlikes["kadma-azla"].examples = Array.from({ length: 9 }, () => many.lookAlikes["kadma-azla"].examples[0]); expectProblem(many, /examples/);
    const tone = copy(); tone.lookAlikes["pashta-kadma"].title = "Pashta or kadma!"; expectProblem(tone, /exclamation/);
  });
  it("checks practice runs: one per melody, a real unlock lesson in that melody, only Quick ten, families heard", () => {
    const melody = copy(); melody.practice[0].unlockAfter = "haftarah-zakef"; expectProblem(melody, /unlockAfter/);
    const lessonId = copy(); lessonId.practice[0].id = "torah-zakef"; expectProblem(lessonId, /duplicate id/);
    const two = copy(); two.practice[1].melody = "torah"; two.practice[1].unlockAfter = "torah-zakef"; expectProblem(two, /two practice runs/);
    const type = copy(); type.practice[0].activity.type = "hear-and-name"; expectProblem(type, /only a quick-ten/);
    const families = copy(); families.practice[0].activity.params.families = ["zakef"]; expectProblem(families, /families/);
    const fast = copy(); fast.practice[0].activity.params.autoAdvanceMs = 100; expectProblem(fast, /autoAdvanceMs/);
    const stray = copy(); stray.practice[0].activity.params.timer = 60; expectProblem(stray, /unknown params/);
    const field = copy(); field.practice[0].streak = true; expectProblem(field, /unknown field/);
    const empty = copy(); empty.practice = []; expectProblem(empty, /practice/);
    expect(practiceById("quick-ten-torah")!.activity.params).toEqual({ families: "heard", items: 10, choices: 3, autoAdvanceMs: 1500 });
    expect(practiceById("torah-zakef")).toBeNull();
    const choices = copy(); choices.practice[0].activity.params.choices = 5; expectProblem(choices, /choices/);
    const badId = copy(); badId.practice[0].id = "Quick Ten"; expectProblem(badId, /practice 0: id/);
    const many = copy(); many.practice = [...many.practice, ...many.practice, many.practice[0]]; expectProblem(many, /^practice$/);
  });
  it("refuses the remaining malformed shapes: prototype keys, readingOnly on a listening pair, a non-boolean hard, bad word numbers, empty or long pair lists, stray which-half params", () => {
    const proto = copy(); activity(proto, "torah-azla", "look-alikes").params = JSON.parse('{"pairs":["kadma-azla"],"items":2,"mode":"read","__proto__":{"x":1}}'); expectProblem(proto, /unknown params __proto__/);
    const protoPair = copy(); protoPair.lookAlikes = JSON.parse(JSON.stringify(protoPair.lookAlikes).replace('"pashta-kadma":{', '"pashta-kadma":{"__proto__":{"x":1},')); expectProblem(protoPair, /unknown field/);
    const reading = copy(); reading.lookAlikes["kadma-azla"].readingOnly = true; expectProblem(reading, /kadma-azla: readingOnly/);
    const hard = copy(); hard.lookAlikes["pashta-kadma"].examples[0].hard = "yes"; expectProblem(hard, /shape/);
    for (const word of [-1, 1.5, 121, "3"]) { const bad = copy(); bad.lookAlikes["mahpach-yetiv"].examples[0].a.word = word; expectProblem(bad, /shape/); }
    const ref = copy(); ref.lookAlikes["mahpach-yetiv"].examples[0].a.ref = "Genesis 1"; expectProblem(ref, /shape/);
    const nfd = copy(); nfd.lookAlikes["mahpach-yetiv"].examples[0].a.text = nfd.lookAlikes["mahpach-yetiv"].examples[0].a.text.normalize("NFD") + "\u05B0\u05B1".normalize("NFD").split("").reverse().join(""); expectProblem(nfd, /text/);
    const none = copy(); activity(none, "torah-azla", "look-alikes").params.pairs = []; expectProblem(none, /pairs/);
    const five = copy(); activity(five, "torah-azla", "look-alikes").params.pairs = ["pashta-kadma", "kadma-azla", "mahpach-yetiv", "azla-geresh", "pashta-kadma"]; expectProblem(five, /pairs/);
    const stray = copy(); activity(stray, "torah-zakef", "which-half").params.speed = 2; expectProblem(stray, /unknown params speed/);
    const families = copy(); activity(families, "torah-zakef", "which-half").params.families = []; expectProblem(families, /families/);
  });
});

describe("look-alike words against a verse", () => {
  const kadmaAzla = () => verse("Genesis 4:4", [w(A.kadma, 0), w(A.geresh, 1), w(A.mahpach, 2), w(A.pashta, 3), w(A.zakef, 4), w(A.munach, 5), w(A.geresh, 6), w(A.tipcha, 7), w(A.etnachta, 8), w(A.tipcha, 9), end(10)]);
  it("tells azla from geresh by the word before, and drops a word whose text or mark has drifted", () => {
    const value = kadmaAzla(), text = (n: number) => value.units[n].text;
    expect(lookAlikeMatches(value, { word: 1, text: text(1), mark: "azla" })).toBe(true);
    expect(lookAlikeMatches(value, { word: 1, text: text(1), mark: "geresh" })).toBe(false);
    expect(lookAlikeMatches(value, { word: 6, text: text(6), mark: "geresh" })).toBe(true);
    expect(lookAlikeMatches(value, { word: 6, text: text(6), mark: "azla" })).toBe(false);
    expect(lookAlikeMatches(value, { word: 3, text: text(3), mark: "pashta" })).toBe(true);
    expect(lookAlikeMatches(value, { word: 3, text: text(2), mark: "pashta" })).toBe(false);
    expect(lookAlikeMatches(value, { word: 2, text: text(2), mark: "kadma" })).toBe(false);
    expect(lookAlikeMatches(value, { word: 40, text: text(2), mark: "mahpach" })).toBe(false);
  });
  it("picks the tell by where the mark sits", () => {
    expect(markPlace("תֹ֙הוּ֙", "pashta")).toBe("doubled");
    expect(markPlace("שָׁם֙", "pashta")).toBeNull();
    expect(markPlace("יִשָּׂ֨א", "kadma")).toBe("near-end");
    expect(markPlace("נָתַ֨תִּי", "kadma")).toBeNull();
    // A kadma on the last letter is not "close to the end, but not on the last letter".
    expect(markPlace("בָּא֨", "kadma")).toBeNull();
    const side = (text: string, mark: "pashta" | "kadma" | "geresh") => ({ word: { ref: "Genesis 1:2", word: 0, text, mark } });
    expect(lookTell(side("תֹ֙הוּ֙", "pashta"))).toBe(DRAFTED.lookAlikes.tells["pashta-doubled"]);
    expect(lookTell(side("יִשָּׂ֨א", "kadma"))).toBe(DRAFTED.lookAlikes.tells["kadma-near-end"]);
    expect(lookTell(side("נָתַ֨תִּי", "kadma"))).toBe(DRAFTED.lookAlikes.tells.kadma);
    expect(lookTell(side("אֵלָ֜יו", "geresh"))).toBe(DRAFTED.lookAlikes.tells.geresh);
  });
});

describe("the 1.6 strings", () => {
  const all = (value: unknown): string[] => typeof value === "string" ? [value] : typeof value === "function" ? [String((value as (m: string) => string)("kadma"))] : value && typeof value === "object" ? Object.values(value).flatMap(all) : [];
  it("keep the tone rule, at 80 characters or fewer for prompts and labels", () => {
    for (const text of [...all(DRAFTED), ...all(NEW)]) { expect(toneProblems(text), text).toEqual([]); expect(text.length, text).toBeLessThanOrEqual(120); }
    for (const text of [DRAFTED.lookAlikes.readPrompt("geresh"), DRAFTED.lookAlikes.hearPrompt, DRAFTED.whichHalf.promptLeadIn, DRAFTED.whichHalf.promptPhrase, DRAFTED.quickTen.homeRow]) expect(text.length).toBeLessThanOrEqual(80);
    expect(Object.keys(NEW)).toEqual(["quickTenLoading"]);
  });
});
