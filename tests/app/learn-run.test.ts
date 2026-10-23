import { describe, expect, it } from "vitest";
import { answerRun, currentItem, freshPace, mayStopEarly, pace, REASKS, runDone, startRun } from "../../src/lib/learn/run";
import { buildPools, drillItems, itemRefs, seededRandom } from "../../src/lib/learn/pools";
import type { Drill } from "../../src/lib/learn/course";
import { threePhrases, verse } from "./learn-synthetic";

const books = ["Genesis", "Exodus", "Leviticus", "Numbers", "Deuteronomy"];
const items = () => drillItems({ type: "hear-and-name", params: { families: ["sof-pasuk", "etnachta", "zakef"], items: 8, choices: 3, weight: {} } } as Drill,
  buildPools(books.flatMap((book, b) => [1, 2, 3].map(c => verse(`${book} ${c + 1}:${b + 1}`, threePhrases())))), { melody: "torah", focus: "zakef" }, seededRandom(9));

describe("a drill run", () => {
  it("is done when every item has been answered right once, a miss coming back three to five items later", () => {
    let run = startRun(items());
    const missed = currentItem(run)!;
    run = answerRun(run, false, seededRandom(1));
    const back = run.queue.findIndex((item, i) => i >= run.at && item.key === missed.key);
    expect(back - run.at + 1).toBeGreaterThanOrEqual(3);
    expect(back - run.at + 1).toBeLessThanOrEqual(5);
    let guard = 0;
    while (!runDone(run) && guard++ < 50) run = answerRun(run, true, seededRandom(guard));
    expect(runDone(run)).toBe(true);
    expect(run.right.has(missed.key)).toBe(true);
    expect(run.queue).toHaveLength(9);
  });
  it("brings a miss near the end back at the end, and again until it is right", () => {
    let run = startRun(items());
    while (run.at < run.queue.length - 1) run = answerRun(run, true, seededRandom(2));
    const last = currentItem(run)!;
    run = answerRun(run, false, seededRandom(3));
    expect(currentItem(run)!.key).toBe(last.key);
    run = answerRun(run, false, seededRandom(3));
    expect(currentItem(run)!.key).toBe(last.key);
    run = answerRun(run, true, seededRandom(3));
    expect(runDone(run)).toBe(true);
  });
  it("re-asks a missed item at most twice, so a run always ends", () => {
    let run = startRun(items());
    for (let guard = 0; guard < 200 && !runDone(run); guard++) run = answerRun(run, false, seededRandom(guard));
    expect(runDone(run)).toBe(true);
    expect(run.queue.length).toBe(items().length * (1 + REASKS));
  });
  it("keeps a re-asked item away from a neighbour from the same verse where it can", () => {
    let run = startRun(items());
    run = answerRun(run, false, seededRandom(5));
    for (let i = 1; i < run.queue.length; i++) expect(itemRefs(run.queue[i]).some(ref => itemRefs(run.queue[i - 1]).includes(ref)), `position ${i}`).toBe(false);
  });
  it("lets a lesson stop early after eight right in a row with no miss", () => {
    let value = freshPace();
    for (let i = 0; i < 7; i++) value = pace(value, true);
    expect(mayStopEarly(value)).toBe(false);
    expect(mayStopEarly(pace(value, true))).toBe(true);
    let missed = pace(freshPace(), false);
    for (let i = 0; i < 12; i++) missed = pace(missed, true);
    expect(mayStopEarly(missed)).toBe(false);
  });
});
