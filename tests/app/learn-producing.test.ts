import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { COURSE, isDrill, lessonById, pathLessons, type Drill } from "../../src/lib/learn/course";
import { buildPools, drillItems, seededRandom, type EndItem, type NameItem, type Phrase } from "../../src/lib/learn/pools";
import { fromZakef, HARDER_FROM_BOX, isHarder } from "../../src/lib/learn/production";
import { cardId, emptyProgress, type Progress, type ReviewSlot } from "../../src/lib/learn/progress";
import { A, end, verse, w } from "./learn-synthetic";

// N18, producing the chant: the end drill is silent from zakef on, a box 3+ card gets the harder item, and the
// "Read it, then pick the tune" drill shows text and plays nothing until a tune is picked.
const player = vi.hoisted(() => ({ play: vi.fn(async () => true), stop: vi.fn(), subscribe: () => () => {}, state: { id: null, status: "idle", seconds: 0, part: 0 } }));
vi.mock("../../src/components/learn/services", () => ({
  useLearnServices: () => ({ player, audio: {}, loader: {} }),
  usePlayerState: () => player.state,
}));
const { HearAndName, WhereDoesItEnd } = await import("../../src/components/learn/drills");
const { reviewItems } = await import("../../src/components/learn/review");
afterEach(() => { player.play.mockClear(); });

const three = () => [w(A.mercha, 0), w(A.tipcha, 1), w(A.mercha, 2), w(A.etnachta, 3), w(A.munach, 4), w(A.zakef, 5), w(A.mercha, 6), w(A.tipcha, 7), end(8)];
const verses = () => [verse("Genesis 4:4", three()), verse("Genesis 5:5", three()), verse("Genesis 6:6", three()), verse("Genesis 7:7", three())];
const pools = buildPools(verses());
const phrase = (family: "etnachta" | "zakef"): Phrase => { const value = pools.verses.get("Genesis 4:4")!, row = value.phrases.find(item => item.family === family)!;
  return { ref: value.ref, kind: "torah", family, words: row.units, tropes: [], book: value.book, verseUnits: value.units.length }; };
const props = { pools, melody: "torah" as const, contrast: () => null, onAnswer: vi.fn() };

describe("from zakef on", () => {
  it("is every family whose lesson comes at or after zakef on its own path, in both melodies", () => {
    for (const melody of ["torah", "haftarah"] as const) {
      const path = pathLessons(melody).filter(lesson => lesson.family), at = path.findIndex(lesson => lesson.family === "zakef");
      expect(at).toBe(2);
      for (const [n, lesson] of path.entries()) expect(fromZakef(lesson.family!, melody), `${melody} ${lesson.id}`).toBe(n >= at);
    }
    expect(fromZakef("sof-pasuk", "torah")).toBe(false);
    expect(fromZakef("etnachta", "haftarah")).toBe(false);
    expect(fromZakef("sof-haftarah", "torah")).toBe(false); // not on the Torah path
  });
  it("puts the read-the-tune drill in every lesson from zakef on, and in none before", () => {
    for (const lesson of COURSE.lessons) {
      const reads = lesson.activities.filter(isDrill).filter(activity => activity.type === "hear-and-name" && activity.params.mode === "read");
      expect(reads.length, lesson.id).toBe(lesson.family && fromZakef(lesson.family, lesson.melody) ? 1 : 0);
      for (const read of reads) if (read.type === "hear-and-name") {
        // Only families the learner has been taught by that lesson: its own and earlier ones on its path.
        const path = pathLessons(lesson.melody).map(row => row.family), here = path.indexOf(lesson.family);
        for (const family of read.params.families) expect(path.indexOf(family), `${lesson.id}: ${family}`).toBeLessThanOrEqual(here);
        expect(read.params.choices).toBeGreaterThanOrEqual(2);
      }
    }
    expect(lessonById("torah-first-verse")!.activities.filter(isDrill)).toHaveLength(0);
  });
});

describe("where does it end", () => {
  const drill: Drill = { type: "where-does-it-end", params: { families: ["etnachta", "zakef"], items: 4, audio: true, verseWords: [5, 12] } };
  it("marks every zakef phrase silent and keeps etnachta with its recording", () => {
    const items = drillItems(drill, pools, { melody: "torah", focus: "zakef" }, seededRandom(7)) as EndItem[];
    expect(items.length).toBeGreaterThan(1);
    expect(items.some(item => item.target.family === "zakef")).toBe(true);
    for (const item of items) expect(item.audio, item.target.family).toBe(item.target.family === "etnachta");
  });
  it("plays no tile and no sound before an answer when it is silent, and has the tile when it is not", () => {
    const silent = renderToStaticMarkup(createElement(WhereDoesItEnd, { ...props, item: { type: "where-does-it-end", key: "z", target: phrase("zakef"), audio: false } }));
    expect(silent).not.toContain("Hear it");
    const heard = renderToStaticMarkup(createElement(WhereDoesItEnd, { ...props, item: { type: "where-does-it-end", key: "e", target: phrase("etnachta"), audio: true } }));
    expect(heard).toContain("Hear it");
    expect(player.play).not.toHaveBeenCalled();
  });
});

describe("read it, then pick the tune", () => {
  it("shows the phrase as text with the approved lines, and no play tile before a pick", () => {
    const item: NameItem = { type: "hear-and-name", key: "r", answer: phrase("zakef"), choices: ["zakef", "etnachta"], read: true };
    const html = renderToStaticMarkup(createElement(HearAndName, { ...props, item }));
    expect(html).toContain("Read it, then pick the tune");
    expect(html).toContain("Sing it (in your head or out loud), then check.");
    expect(html).not.toContain("Hear it");
    expect(html).not.toContain("Which phrase is this?");
    expect(html).toContain("data-unit=");
    expect(player.play).not.toHaveBeenCalled();
  });
  it("leaves the ordinary naming item as it was", () => {
    const html = renderToStaticMarkup(createElement(HearAndName, { ...props, item: { type: "hear-and-name", key: "h", answer: phrase("zakef"), choices: ["zakef", "etnachta"] } }));
    expect(html).toContain("Which phrase is this?");
    expect(html).toContain("Hear it");
    expect(html).not.toContain("Sing it");
  });
  it("builds read items from a drill with mode read", () => {
    const drill: Drill = { type: "hear-and-name", params: { families: ["zakef", "etnachta"], items: 2, choices: 2, weight: {}, mode: "read" } };
    const items = drillItems(drill, pools, { melody: "torah", focus: "zakef" }, seededRandom(3)) as NameItem[];
    expect(items.length).toBeGreaterThan(0);
    expect(items.every(item => item.read === true)).toBe(true);
    const plain = drillItems({ ...drill, params: { ...drill.params, mode: undefined } } as Drill, pools, { melody: "torah", focus: "zakef" }, seededRandom(3)) as NameItem[];
    expect(plain.some(item => item.read)).toBe(false);
  });
});

describe("review difficulty", () => {
  const done = (id: string) => ({ done: "2026-10-20T15:00:00.000Z" });
  const progress = (box: number): Progress => ({ ...emptyProgress(), lessons: { "torah-etnachta": done("a"), "torah-zakef": done("b") } as Progress["lessons"],
    cards: Object.fromEntries((["name", "end"] as const).flatMap(skill => (["zakef", "etnachta"] as const).map(family => [cardId(family, "torah", skill), { box, due: "2026-10-25" }]))) as Progress["cards"] });
  const slot = (family: "zakef" | "etnachta", skill: "name" | "end"): ReviewSlot => ({ card: cardId(family, "torah", skill), family, melody: "torah", skill });
  const first = (box: number, family: "zakef" | "etnachta", skill: "name" | "end") => reviewItems([slot(family, skill)], pools, progress(box), 11)[0]?.item;
  it("starts at box 3", () => { expect(HARDER_FROM_BOX).toBe(3); expect(isHarder(2)).toBe(false); expect(isHarder(3)).toBe(true); expect(isHarder(5)).toBe(true); });
  it("asks a box 3 or higher naming card from zakef on from the text, and a lower box as before", () => {
    expect((first(3, "zakef", "name") as NameItem).read).toBe(true);
    expect((first(5, "zakef", "name") as NameItem).read).toBe(true);
    expect((first(2, "zakef", "name") as NameItem).read).toBeFalsy();
    expect((first(4, "etnachta", "name") as NameItem).read).toBeFalsy(); // before zakef the recording still leads
  });
  it("asks a box 3 or higher ending card with no recording first, and a lower box silently only from zakef on", () => {
    expect((first(3, "etnachta", "end") as EndItem).audio).toBe(false);
    expect((first(2, "etnachta", "end") as EndItem).audio).toBe(true);
    expect((first(2, "zakef", "end") as EndItem).audio).toBe(false);
    expect((first(0, "zakef", "end") as EndItem).audio).toBe(false);
  });
});
