import type { FamilyId } from "../trope/chart-catalog";
import { COURSE, FAMILY_IDS, MELODIES, MELODY_FAMILIES, SKILLS, isDrill, drillSkill, lessonById, pathLessons, type Lesson, type Melody, type Skill } from "./course";

/**
 * A learner's progress, `learn-progress/v1` (plan, Decided 5): lessons done and review cards in
 * Leitner boxes. Pure; the clock is always passed in. Signed out it lives in this browser only.
 */
export const PROGRESS_SCHEMA = "learn-progress/v1" as const;
export const PROGRESS_KEY = "crc-torah:learn-progress/v1";
export const PROGRESS_LIMITS = Object.freeze({ bytes: 64 * 1024, cards: FAMILY_IDS.length * MELODIES.length * SKILLS.length });
/** Days until a card in each box is asked again: box 0 comes back in the same session. */
export const BOX_DAYS = Object.freeze([0, 1, 3, 7, 16, 35]);
export type CardId = `${FamilyId}:${Melody}:${Skill}`;
export type Card = Readonly<{ box: number; due: string }>;
export type Progress = Readonly<{ schema: typeof PROGRESS_SCHEMA; lessons: Readonly<Record<string, Readonly<{ done: string }>>>; cards: Readonly<Record<string, Card>> }>;
export const emptyProgress = (): Progress => Object.freeze({ schema: PROGRESS_SCHEMA, lessons: Object.freeze({}), cards: Object.freeze({}) });

const DAY = 86_400_000;
const DATE = /^\d{4}-\d{2}-\d{2}$/, INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const realDate = (value: unknown): value is string => typeof value === "string" && DATE.test(value) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const realInstant = (value: unknown): value is string => typeof value === "string" && INSTANT.test(value) && Number.isFinite(Date.parse(value));
export const cardId = (family: FamilyId, melody: Melody, skill: Skill): CardId => `${family}:${melody}:${skill}`;
export function parseCardId(id: string): { family: FamilyId; melody: Melody; skill: Skill } | null {
  const [family, melody, skill, ...rest] = id.split(":");
  if (rest.length || !MELODIES.includes(melody as Melody) || !SKILLS.includes(skill as Skill) || !MELODY_FAMILIES[melody as Melody].includes(family as FamilyId)) return null;
  return { family: family as FamilyId, melody: melody as Melody, skill: skill as Skill };
}
/** A local calendar day, as YYYY-MM-DD, for a clock reading in this browser. */
export function localDay(now: number): string {
  const date = new Date(now);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export const addDays = (day: string, days: number) => new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);

/** Strict, bounded parse. Anything unexpected is null, and the caller starts fresh. */
export function parseProgress(value: unknown): Progress | null {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return null;
    const row = value as Record<string, unknown>;
    if (Object.keys(row).length !== 3 || row.schema !== PROGRESS_SCHEMA) return null;
    const lessonsIn = row.lessons, cardsIn = row.cards;
    if (!lessonsIn || typeof lessonsIn !== "object" || Array.isArray(lessonsIn) || !cardsIn || typeof cardsIn !== "object" || Array.isArray(cardsIn)) return null;
    const lessons: Record<string, { done: string }> = {}, cards: Record<string, Card> = {};
    const lessonEntries = Object.entries(lessonsIn), cardEntries = Object.entries(cardsIn);
    if (lessonEntries.length > COURSE.lessons.length || cardEntries.length > PROGRESS_LIMITS.cards) return null;
    for (const [id, entry] of lessonEntries) {
      if (!lessonById(id) || !entry || typeof entry !== "object" || Object.keys(entry).length !== 1 || !realInstant((entry as { done?: unknown }).done)) return null;
      lessons[id] = Object.freeze({ done: (entry as { done: string }).done });
    }
    for (const [id, entry] of cardEntries) {
      const card = entry as { box?: unknown; due?: unknown };
      if (!parseCardId(id) || !entry || typeof entry !== "object" || Object.keys(entry).length !== 2 || !Number.isSafeInteger(card.box) || (card.box as number) < 0 || (card.box as number) >= BOX_DAYS.length || !realDate(card.due)) return null;
      cards[id] = Object.freeze({ box: card.box as number, due: card.due as string });
    }
    return Object.freeze({ schema: PROGRESS_SCHEMA, lessons: Object.freeze(lessons), cards: Object.freeze(cards) });
  } catch { return null; }
}
export function serializeProgress(progress: Progress): string | null {
  const text = JSON.stringify({ schema: PROGRESS_SCHEMA, lessons: progress.lessons, cards: progress.cards });
  return new TextEncoder().encode(text).length <= PROGRESS_LIMITS.bytes ? text : null;
}

/** The modified Leitner step: right moves up one box, wrong drops two and comes back today. */
export function answerCard(card: Card, right: boolean, today: string): Card {
  const box = right ? Math.min(BOX_DAYS.length - 1, card.box + 1) : Math.max(0, card.box - 2);
  return Object.freeze({ box, due: addDays(today, BOX_DAYS[box]) });
}
/** Record one answer. Only cards that already exist move; a lesson's own cards arrive when it is done.
 * `moved` is the run's (a lesson's or a review's) record: a card goes up at most one box per run, however
 * often it comes up right; a miss still drops it. */
export function recordAnswer(progress: Progress, id: CardId, right: boolean, today: string, moved?: Set<string>): Progress {
  const card = progress.cards[id]; if (!card) return progress;
  if (right && moved?.has(id)) return progress;
  moved?.add(id);
  return Object.freeze({ ...progress, cards: Object.freeze({ ...progress.cards, [id]: answerCard(card, right, today) }) });
}
/** The skills a lesson's drills practise, for its family in its melody. */
export function lessonCards(lesson: Lesson): CardId[] {
  if (!lesson.family) return [];
  const skills = new Set(lesson.activities.filter(isDrill).map(drillSkill));
  return SKILLS.filter(skill => skills.has(skill)).map(skill => cardId(lesson.family!, lesson.melody, skill));
}
/** A lesson is done: it is marked, and its new cards enter box 1, due tomorrow. Existing cards keep their place. */
export function completeLesson(progress: Progress, lesson: Lesson, now: number): Progress {
  const today = localDay(now), cards: Record<string, Card> = { ...progress.cards };
  for (const id of lessonCards(lesson)) if (!cards[id]) cards[id] = Object.freeze({ box: 1, due: addDays(today, BOX_DAYS[1]) });
  const lessons = progress.lessons[lesson.id] ? progress.lessons : Object.freeze({ ...progress.lessons, [lesson.id]: Object.freeze({ done: new Date(now).toISOString() }) });
  return Object.freeze({ ...progress, lessons, cards: Object.freeze(cards) });
}

export const isDone = (progress: Progress, id: string) => Object.hasOwn(progress.lessons, id);
export const isUnlocked = (progress: Progress, lesson: Lesson) => isDone(progress, lesson.id) || lesson.prerequisites.every(id => isDone(progress, id));
/** The one next step: the Torah path first, then the haftarah path; null when both are done. */
export function nextLesson(progress: Progress): Lesson | null {
  for (const melody of MELODIES) { const lesson = pathLessons(melody).find(row => !isDone(progress, row.id) && isUnlocked(progress, row)); if (lesson) return lesson; }
  return null;
}
export const courseDone = (progress: Progress) => isDone(progress, "torah-first-verse") && isDone(progress, "haftarah-first-verse");
/** "Can hear": the families whose lesson is done, per path. */
export function heard(progress: Progress, melody: Melody): { heard: number; of: number } {
  const lessons = pathLessons(melody).filter(lesson => lesson.family);
  return { heard: lessons.filter(lesson => isDone(progress, lesson.id)).length, of: lessons.length };
}

export const REVIEW_LIMITS = Object.freeze({ min: 8, max: 12, secondsPerItem: 10 });
export function dueCards(progress: Progress, today: string): CardId[] {
  return Object.entries(progress.cards).filter(([, card]) => card.due <= today).map(([id]) => id as CardId).sort();
}
/** The home's review line: phrases due (family and tune), and about how long a run of them takes. */
export function reviewSummary(progress: Progress, today: string): { phrases: number; minutes: number } | null {
  const due = dueCards(progress, today); if (!due.length) return null;
  const phrases = new Set(due.map(id => id.split(":").slice(0, 2).join(":"))).size;
  const items = Math.min(REVIEW_LIMITS.max, Math.max(REVIEW_LIMITS.min, due.length));
  return { phrases, minutes: Math.max(1, Math.ceil(items * REVIEW_LIMITS.secondsPerItem / 60)) };
}
/** "These come back on Thursday", or "next week" when the soonest card is more than a week away. */
export function comesBack(progress: Progress, cards: readonly CardId[], today: string): { weekday: string } | { nextWeek: true } | null {
  const dues = cards.map(id => progress.cards[id]?.due).filter((due): due is string => !!due && due > today).sort();
  if (!dues.length) return null;
  if (daysBetween(today, dues[0]) > 7) return { nextWeek: true };
  return { weekday: new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" }).format(new Date(`${dues[0]}T00:00:00Z`)) };
}

export type ReviewSlot = Readonly<{ card: CardId; family: FamilyId; melody: Melody; skill: Skill }>;
/**
 * The run of a review: 8 to 12 slots over the due cards (or, off schedule, every card), each card at
 * least once, confusable families placed back to back. The caller fills each slot with an item from a
 * verse other than the last one's.
 */
export function composeReview(progress: Progress, today: string, rng: () => number): ReviewSlot[] {
  let ids = dueCards(progress, today);
  if (!ids.length) ids = Object.keys(progress.cards).sort() as CardId[];
  if (!ids.length) return [];
  const cards = ids.map(id => ({ card: id, ...parseCardId(id)! }));
  const length = Math.min(REVIEW_LIMITS.max, Math.max(REVIEW_LIMITS.min, cards.length));
  const order = [...cards];
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  const slots: ReviewSlot[] = [];
  while (slots.length < length) slots.push(order[slots.length % order.length]);
  // Chain confusable neighbours: after each slot, prefer a remaining slot whose family confuses with it.
  const chained: ReviewSlot[] = [], rest = [...slots];
  while (rest.length) {
    const last = chained.at(-1), near = last ? COURSE.families[last.family].confusedWith : [];
    let index = rest.findIndex(slot => last && near.includes(slot.family) && slot.card !== last.card);
    if (index < 0) index = rest.findIndex(slot => !last || slot.card !== last.card);
    if (index < 0) index = 0;
    chained.push(rest.splice(index, 1)[0]);
  }
  return chained.map(slot => Object.freeze(slot));
}

/** Browser storage for signed-out learners: one key, every access guarded; corrupt or missing means fresh. */
export type ProgressStore = Readonly<{ load(): Progress; save(progress: Progress): boolean }>;
export function browserProgressStore(storage: () => Storage | null = () => { try { return window.localStorage; } catch { return null; } }): ProgressStore {
  return Object.freeze({
    load() {
      try {
        const text = storage()?.getItem(PROGRESS_KEY);
        if (!text || text.length > PROGRESS_LIMITS.bytes) return emptyProgress();
        return parseProgress(JSON.parse(text)) ?? emptyProgress();
      } catch { return emptyProgress(); }
    },
    save(progress) {
      try { const text = serializeProgress(progress); if (!text) return false; storage()?.setItem(PROGRESS_KEY, text); return true; } catch { return false; }
    },
  });
}
