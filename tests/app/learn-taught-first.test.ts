import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import raw from "../../src/lib/learn/lessons.json";
import { COURSE, CourseError, isDrill, MELODIES, pathLessons, validateCourse, type Drill, type Lesson, type Melody } from "../../src/lib/learn/course";
import type { FamilyId } from "../../src/lib/trope/chart-catalog";
import { buildPools, drillItems, seededRandom } from "../../src/lib/learn/pools";
import { completeLesson, emptyProgress, lessonCards, nextLesson, type Progress } from "../../src/lib/learn/progress";
import { lessonById } from "../../src/lib/learn/course";
import { coursePassages } from "../../src/components/learn/verses-api";
import { snapshot } from "./learn-opening-main-snapshot";
import { A, end, verse, w } from "./learn-synthetic";

vi.mock("server-only", () => ({}));
// 1.9 N17a: sounds before recognition. Made-up data only; the snapshot holds lesson ids, card ids and passage names.
const { reviewItems } = await import("../../src/components/learn/review");
const lessonModule = await import("../../src/components/learn/lesson");
const { lessonSteps } = lessonModule;

/** An orientation lesson: no family of its own and no first-verse step (course.ts). */
const orientation = (lesson: Lesson) => !lesson.family && !lesson.activities.some(activity => activity.type === "first-verse");
/** The families a recognition drill names, as a lesson's drill lists them (build-the-phrase names its one family). */
const named = (drill: Drill): FamilyId[] => drill.type === "build-the-phrase" ? [drill.params.family] : drill.type === "look-alikes" ? [] : [...drill.params.families];
/** Per lesson, along its own path in order: the families a drill names that no earlier lesson (same melody) or whole-verse example taught. */
function untaught(melody: Melody): Record<string, FamilyId[]> {
  const out: Record<string, FamilyId[]> = {}, taught = new Set<FamilyId>();
  for (const lesson of pathLessons(melody)) {
    const own = new Set<FamilyId>(lesson.family ? [lesson.family] : []);
    // A phrase of a whole-verse example in this orientation lesson or an earlier one has been heard as a phrase.
    if (orientation(lesson)) for (const example of lesson.examples) for (const phrase of example.phrases ?? []) taught.add(phrase.family);
    const missing = lesson.activities.filter(isDrill).flatMap(named).filter(family => !own.has(family) && !taught.has(family));
    if (missing.length) out[lesson.id] = [...new Set(missing)];
    if (lesson.family) taught.add(lesson.family);
  }
  return out;
}

describe("taught first: every family a recognition drill names has been heard before it is asked about", () => {
  it("holds along the Torah path, family by family, with no exception", () => { expect(untaught("torah")).toEqual({}); });
  it("holds along the haftarah path except its opening lesson, the one named exception (open item 2)", () => {
    // haftarah-sof-pasuk asks Torah or haftarah and names haftarah etnachta, which the next lesson models; it waits for N19a's haftarah orientation verse.
    expect(untaught("haftarah")).toEqual({ "haftarah-sof-pasuk": ["etnachta"] });
  });
  it("lets an orientation lesson count only for its own melody", () => {
    expect(pathLessons("haftarah").filter(orientation)).toEqual([]);
    expect(pathLessons("torah").filter(orientation).map(lesson => lesson.id)).toEqual(["intro-phrases"]);
  });
  it("has no same-or-different in Torah lessons 1 to 3; the haftarah opening is the one named exception", () => {
    const hasSame = (lesson: Lesson) => lesson.activities.some(activity => activity.type === "same-or-different");
    expect(pathLessons("torah").slice(0, 3).map(lesson => lesson.id)).toEqual(["intro-phrases", "torah-sof-pasuk", "torah-etnachta"]);
    expect(pathLessons("torah").slice(0, 3).filter(hasSame)).toEqual([]);
    expect(MELODIES.map(melody => pathLessons(melody)[0]).filter(hasSame).map(lesson => lesson.id)).toEqual(["haftarah-sof-pasuk"]);
  });
});

describe("the opening, run twenty times", () => {
  const books = ["Genesis", "Exodus", "Leviticus", "Numbers", "Deuteronomy"];
  const pools = buildPools(books.flatMap((book, b) => [1, 2, 3].map(c => verse(`${book} ${c + 1}:${b + 1}`,
    [w(A.mercha, 0), w(A.tipcha, 1), w(A.mercha, 2), w(A.etnachta, 3), w(A.munach, 4), w(A.zakef, 5), w(A.mercha, 6), w(A.tipcha, 7), end(8)]))));
  it("never builds a same-or-different item in Torah lessons 1 to 3, nor shows its question", () => {
    for (let seed = 1; seed <= 20; seed++) for (const lesson of pathLessons("torah").slice(0, 3)) for (const activity of lesson.activities.filter(isDrill)) {
      for (const item of drillItems(activity, pools, { melody: lesson.melody, focus: lesson.family }, seededRandom(seed))) expect(item.type, `${lesson.id} seed ${seed}`).not.toBe("same-or-different");
    }
    for (const lesson of pathLessons("torah").slice(0, 3)) {
      const html = renderToStaticMarkup(createElement(lessonModule.LessonScreen, { id: lesson.id }));
      expect(html).not.toContain("Same tune or different?");
    }
  });
  it("keeps the same-or-different the later lessons already had, for the 8 to 22 item rule's sake", () => {
    expect(lessonById("torah-revia")!.activities.some(activity => activity.type === "same-or-different")).toBe(true);
    expect(lessonById("torah-sof-pasuk")!.activities.filter(isDrill).reduce((sum, activity) => sum + activity.params.items, 0)).toBe(8);
    expect(lessonById("torah-etnachta")!.activities.filter(isDrill).reduce((sum, activity) => sum + activity.params.items, 0)).toBe(10);
  });
});
describe("How a verse is built is Hear it, a first phrase to try, In verses, Done", () => {
  const intro = lessonById("intro-phrases")!;
  // Integrated with the sound-first curriculum: the orientation adds one production step (a real engine phrase to echo and try) and still asks no question.
  it("keeps its id and goal, has no drill at all, and is a four-step rail with no question", () => {
    expect(intro.activities).toEqual([]);
    expect(intro.goal).toBe("After this you can hear that a verse is made of short phrases, each with its own small tune.");
    expect(lessonSteps(intro).map(step => step.kind)).toEqual(["hear", "sound", "verses", "done"]);
    expect(renderToStaticMarkup(createElement(lessonModule.LessonScreen, { id: "intro-phrases" }))).toContain('aria-label="Step 1 of 4"');
    expect(lessonCards(intro)).toEqual([]);
  });
  it("is the only lesson with no activities, and the validator allows that only without a family", () => {
    expect(COURSE.lessons.filter(lesson => !lesson.activities.length).map(lesson => lesson.id)).toEqual(["intro-phrases"]);
    const problems = (value: unknown) => { try { validateCourse(value); return []; } catch (error) { return error instanceof CourseError ? [...error.problems] : ["other error"]; } };
    const copy = () => JSON.parse(JSON.stringify(raw)) as { lessons: Record<string, unknown>[] };
    expect(problems(copy())).toEqual([]);
    const bare = copy(); bare.lessons.find(row => row.id === "torah-sof-pasuk")!.activities = [];
    expect(problems(bare).some(problem => /torah-sof-pasuk: activities/.test(problem))).toBe(true);
  });
  it("gives each phrase chip of a whole-verse example a play control named Hear {family}, cut from the same recording, in both steps", () => {
    const source = readFileSync(new URL("../../src/components/learn/lesson.tsx", import.meta.url), "utf8");
    expect(source).toContain("label={`Hear ${familyName(phrase.family)}`}");
    expect(source).toContain("requests={[phraseRequest(verse, phrase.units)]}");
    expect((source.match(/<Legend /g) ?? []).length).toBe(2);
    // The control is a PlayTile over a PhraseRequest, the course's one cut of the human recording; the screen imports no other audio source.
    expect(source).not.toMatch(/from "[^"]*(?:generated|chant-render|render)[^"]*"/i);
  });
});

describe("review: one family done", () => {
  const done = (...ids: string[]): Progress => ids.reduce((value, id) => completeLesson(value, lessonById(id)!, Date.parse("2026-10-20T12:00:00Z")), emptyProgress());
  const slot = (family: FamilyId, skill: "name" | "find" | "end" = "name") => ({ card: `${family}:torah:${skill}` as never, family, melody: "torah" as const, skill });
  const books = ["Genesis", "Exodus", "Leviticus", "Numbers", "Deuteronomy"];
  // Etnachta, zakef and tevir each have a phrase in every verse, so a naming item can be built for any of them.
  const verses = books.flatMap((book, b) => [1, 2, 3].map(c => verse(`${book} ${c + 1}:${b + 1}`,
    [w(A.mercha, 0), w(A.tipcha, 1), w(A.mercha, 2), w(A.tevir, 3), w(A.munach, 4), w(A.zakef, 5), w(A.mercha, 6), w(A.tipcha, 7), w(A.etnachta, 8), w(A.mahpach, 9), w(A.tipcha, 10), end(11)])));
  const pools = buildPools(verses);
  const families = (items: ReturnType<typeof reviewItems>) => items.flatMap(({ item }) => item.type === "hear-and-name" ? item.choices : []);
  it("takes the second choice from confusedWith, for a family taught in a finished lesson or heard as a phrase in the finished orientation lesson", () => {
    // sof-pasuk is confused with etnachta, heard as a phrase in the finished orientation lesson.
    const withIntro = reviewItems([slot("sof-pasuk")], pools, done("intro-phrases", "torah-sof-pasuk"), 5);
    expect(withIntro).toHaveLength(1);
    expect(families(withIntro).sort()).toEqual(["etnachta", "sof-pasuk"]);
    // tevir is confused with etnachta and revia; only etnachta has been taught.
    const tevir = reviewItems([slot("tevir")], pools, done("intro-phrases", "torah-tevir"), 5);
    expect(families(tevir).sort()).toEqual(["etnachta", "tevir"]);
  });
  it("skips the slot when no family it is confused with has been taught, never naming an untaught family", () => {
    expect(reviewItems([slot("sof-pasuk")], pools, done("torah-sof-pasuk"), 5)).toEqual([]);
    // zakef is confused with revia, zakef gadol and segol, none taught by the intro and the zakef lesson.
    expect(reviewItems([slot("zakef")], pools, done("intro-phrases", "torah-zakef"), 5)).toEqual([]);
    // A find or end slot still runs on its own family when its naming slot is skipped.
    const find = reviewItems([slot("zakef", "find")], pools, done("intro-phrases", "torah-zakef"), 5);
    expect(find.map(row => row.item.type)).toEqual(["tap-the-phrase"]);
  });
});

describe("what the re-order leaves alone", () => {
  const stamp = new Date(Date.parse("2026-10-20T12:00:00Z")).getTime();
  const doneIds = (ids: readonly string[]) => ids.reduce((value, id) => completeLesson(value, lessonById(id)!, stamp), emptyProgress());
  it("keeps lessonCards for all 24 lessons as main had them", () => {
    expect(COURSE.lessons).toHaveLength(24);
    expect(Object.fromEntries(COURSE.lessons.map((lesson: Lesson) => [lesson.id, lessonCards(lesson)]))).toEqual(snapshot.cards);
  });
  it("keeps nextLesson for the empty, intro-done, every-Torah-prefix and all-done documents", () => {
    const torah = pathLessons("torah").map(lesson => lesson.id);
    const rows = [["empty", []], ...torah.map((_, i) => [`torah-prefix-${i + 1}`, torah.slice(0, i + 1)]), ["all", COURSE.lessons.map(lesson => lesson.id)]] as [string, string[]][];
    expect(rows.map(([name, ids]) => [name, nextLesson(doneIds(ids))?.id ?? null])).toEqual(snapshot.next);
    expect(snapshot.next[1]).toEqual(["torah-prefix-1", "torah-sof-pasuk"]);
  });
  it("keeps the course passages of both melodies, so the offline pack is unchanged", () => {
    expect({ torah: coursePassages("torah"), haftarah: coursePassages("haftarah") }).toEqual(snapshot.passages);
  });
  it("keeps the lesson ids and their order (no lesson added, removed or renamed)", () => {
    expect(COURSE.lessons.map(lesson => lesson.id)).toEqual(Object.keys(snapshot.cards));
  });
});
