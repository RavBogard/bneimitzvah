import { itemRefs, type DrillItem } from "./pools";

/**
 * One drill run (ACTIVITIES.md): the learner answers before the answer is shown; a miss comes back
 * three to five items later and again at the end until it has been answered right once. Nothing is
 * scored. Pure, so the lesson screen and the tests share it.
 */
export type Run = Readonly<{ queue: readonly DrillItem[]; at: number; right: ReadonlySet<string>; missed: ReadonlySet<string>; misses: ReadonlyMap<string, number> }>;
/** A missed item comes back at most this many times in one run; after that it is left to review. */
export const REASKS = 2;
export const startRun = (items: readonly DrillItem[]): Run => Object.freeze({ queue: Object.freeze([...items]), at: 0, right: new Set<string>(), missed: new Set<string>(), misses: new Map<string, number>() });
export const currentItem = (run: Run): DrillItem | null => run.queue[run.at] ?? null;
export const runDone = (run: Run) => run.at >= run.queue.length;

/** Where a missed item comes back: 3 to 5 items on, never next to an item from the same verse. */
function reaskAt(queue: readonly DrillItem[], from: number, item: DrillItem, rng: () => number): number {
  const shares = (a: DrillItem | undefined) => !!a && itemRefs(a).some(ref => itemRefs(item).includes(ref));
  const start = from + 3 + Math.floor(rng() * 3);
  for (let at = Math.min(start, queue.length); at <= queue.length; at++) if (!shares(queue[at - 1]) && !shares(queue[at])) return at;
  return queue.length;
}
export function answerRun(run: Run, right: boolean, rng: () => number): Run {
  const item = currentItem(run); if (!item) return run;
  const queue = [...run.queue], next = run.at + 1;
  const rightSet = new Set(run.right), missed = new Set(run.missed), misses = new Map(run.misses);
  if (right) rightSet.add(item.key);
  else {
    missed.add(item.key); const count = (misses.get(item.key) ?? 0) + 1; misses.set(item.key, count);
    if (count <= REASKS) queue.splice(reaskAt(queue, next, item, rng), 0, item);
  }
  return Object.freeze({ queue: Object.freeze(queue), at: next, right: rightSet, missed, misses });
}

/** Across a lesson's drills: eight right in a row with no miss lets the rest of the drills go. */
export const EARLY_STOP = 8;
export type LessonPace = Readonly<{ streak: number; missed: boolean }>;
export const freshPace = (): LessonPace => Object.freeze({ streak: 0, missed: false });
export const pace = (value: LessonPace, right: boolean): LessonPace => Object.freeze({ streak: right ? value.streak + 1 : 0, missed: value.missed || !right });
export const mayStopEarly = (value: LessonPace) => !value.missed && value.streak >= EARLY_STOP;
