import { addDays, answerCard, effectiveDue, gapDays, localDay, REVIEW_LIMITS } from "../learn/progress";
import { SERVICE_COURSE, lessonById, type Lesson } from "./course";
import { fluencyCards } from "./reading";
import { shuffle } from "./check";
import type { Card, Progress } from "./progress";

/**
 * The service course's review cards and the two practice runs (2.0 SC3, A4 8.1, 8.3, 8.4). Pure; the clock is always passed in.
 * The boxes, the one-box-per-run rule and the gaps are Learn to lein's, imported as they are. Nothing here counts right answers: a
 * card only knows its box and the day it is next asked.
 */

/** The cards a lesson plants when it is done: a fluency lesson's letters or vowels, a prayer's reading and meaning of its key words. */
export function lessonCards(lesson: Lesson): string[] {
  if (lesson.kind === "fluency") return [...fluencyCards(lesson.id)];
  return lesson.read && lesson.check ? [`word:${lesson.id}:read`, `word:${lesson.id}:meaning`] : [];
}
/** A lesson's new cards enter box 1, due tomorrow; a card the learner already has keeps its place. */
export function withLessonCards(progress: Progress, lesson: Lesson, now: number): Progress {
  const ids = lessonCards(lesson).filter(id => !progress.cards[id]);
  if (!ids.length) return progress;
  const today = localDay(now), cards: Record<string, Card> = { ...progress.cards };
  for (const id of ids) cards[id] = Object.freeze({ box: 1, due: addDays(today, gapDays(1, today, null)) });
  return Object.freeze({ ...progress, cards: Object.freeze(cards) });
}

/** What one answer moves: a card the learner has, one box up per run however often it is right, and down on a miss. */
export function recordAnswer(progress: Progress, id: string, right: boolean, today: string, moved?: Set<string>): Progress {
  const card = progress.cards[id]; if (!card) return progress;
  if (right && moved?.has(id)) return progress;
  moved?.add(id);
  return Object.freeze({ ...progress, cards: Object.freeze({ ...progress.cards, [id]: answerCard(card, right, today, null) }) });
}

/** The cards due today or earlier, in a stable order. */
export const dueCards = (progress: Progress, today: string): string[] => Object.entries(progress.cards).filter(([, card]) => effectiveDue(card, today, null) <= today).map(([id]) => id).sort();
/** The home's review line: how many cards are due and about how many minutes a run takes; null when none is due (A4 8.3). */
export function reviewSummary(progress: Progress, today: string): { cards: number; minutes: number } | null {
  const due = dueCards(progress, today).length; if (!due) return null;
  return { cards: due, minutes: Math.max(1, Math.ceil(Math.min(REVIEW_LIMITS.max, due) * REVIEW_LIMITS.secondsPerItem / 60)) };
}
/** A review's cards: the due ones in a seeded order, at most twelve; all of them when fewer than eight are due. */
export function reviewCards(progress: Progress, today: string, rng: () => number): string[] {
  return shuffle(dueCards(progress, today), rng).slice(0, REVIEW_LIMITS.max);
}

/** The prayers with a Read step that are done: Quick ten's words come from these. */
export const readLessonsDone = (progress: Progress): Lesson[] => SERVICE_COURSE.lessons.filter(lesson => lesson.read && Object.hasOwn(progress.lessons, lesson.id));
/** Quick ten opens after three prayers with a Read step are done, or after f6 (A4 8.4). */
export const quickTenOpen = (progress: Progress): boolean => readLessonsDone(progress).length >= 3 || Object.hasOwn(progress.lessons, "f6");
/** Where a Quick ten's words may come from: every done prayer's Read, and, once f6 is done, the strand's own lines. */
export function quickTenSources(progress: Progress, rng: () => number, count: number): { lessonId: string | null; unit: string; blocks: readonly [number, number] }[] {
  const lessons = readLessonsDone(progress).map(lesson => ({ lessonId: lesson.id as string | null, unit: lesson.read!.unit, blocks: lesson.read!.blocks }));
  const strand = Object.hasOwn(progress.lessons, "f6") ? (lessonById("f6")?.corpus ?? []).map(entry => ({ lessonId: null as string | null, unit: entry.unit, blocks: entry.blocks })) : [];
  return shuffle([...lessons, ...strand], rng).slice(0, count);
}
