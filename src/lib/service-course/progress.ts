import { SERVICE_COURSE, CRC_TENANT, isEveningLesson, lessonById, lessonOpen, serviceOrder, type Lesson, type Tenant } from "./course";
import { withLessonCards } from "./cards";

/**
 * A learner's progress in the service course, `service-course-progress/v1`: lessons done and, from release 2.0's
 * reading slices, review cards in boxes. Pure; the clock is always passed in. Signed out it lives in this browser
 * only, under its own key: Learn to lein's progress and this course's do not share a document (A4 8.1).
 * It holds lessons done and, from 2.0 SC3, review cards (cards.ts plants them when a lesson is done).
 */
export const PROGRESS_SCHEMA = "service-course-progress/v1" as const;
export const PROGRESS_KEY = "crc-torah:service-progress/v1";
/** Boxes 0 to 5, the same Leitner ladder as Learn to lein's (its BOX_DAYS has six entries). */
const BOXES = 6;
export const PROGRESS_LIMITS = Object.freeze({ bytes: 64 * 1024, cards: 250 });
export type Card = Readonly<{ box: number; due: string }>;
export type Progress = Readonly<{ schema: typeof PROGRESS_SCHEMA; lessons: Readonly<Record<string, Readonly<{ done: string }>>>; cards: Readonly<Record<string, Card>> }>;
export const emptyProgress = (): Progress => Object.freeze({ schema: PROGRESS_SCHEMA, lessons: Object.freeze({}), cards: Object.freeze({}) });

const DATE = /^\d{4}-\d{2}-\d{2}$/, INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const CARD_ID = /^(?:(?:letter|vowel):[a-z][a-z-]{1,20}:(?:name|sound)|word:[a-z][a-z0-9-]{1,40}:(?:read|meaning))$/;
const realDate = (value: unknown): value is string => typeof value === "string" && DATE.test(value) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const realInstant = (value: unknown): value is string => typeof value === "string" && INSTANT.test(value) && Number.isFinite(Date.parse(value));

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
    if (lessonEntries.length > SERVICE_COURSE.lessons.length || cardEntries.length > PROGRESS_LIMITS.cards) return null;
    // An entry the course no longer knows (a lesson renamed or removed later) is dropped, never fatal, so a stored
    // document always opens; a malformed entry still refuses the whole document.
    for (const [id, entry] of lessonEntries) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry) || Object.keys(entry).length !== 1 || !realInstant((entry as { done?: unknown }).done) || id.length > 80) return null;
      if (lessonById(id)) lessons[id] = Object.freeze({ done: (entry as { done: string }).done });
    }
    for (const [id, entry] of cardEntries) {
      const card = entry as { box?: unknown; due?: unknown };
      if (!entry || typeof entry !== "object" || Array.isArray(entry) || Object.keys(entry).length !== 2 || !Number.isSafeInteger(card.box) || (card.box as number) < 0 || (card.box as number) >= BOXES || !realDate(card.due) || id.length > 80) return null;
      if (CARD_ID.test(id)) cards[id] = Object.freeze({ box: card.box as number, due: card.due as string });
    }
    return Object.freeze({ schema: PROGRESS_SCHEMA, lessons: Object.freeze(lessons), cards: Object.freeze(cards) });
  } catch { return null; }
}
export function serializeProgress(progress: Progress): string | null {
  const text = JSON.stringify({ schema: PROGRESS_SCHEMA, lessons: progress.lessons, cards: progress.cards });
  return new TextEncoder().encode(text).length <= PROGRESS_LIMITS.bytes ? text : null;
}

/**
 * Two copies of one learner's progress (the browser's and the account's) made one, for the first sign-in and for a conflict
 * between devices (2.0 SC4), by Learn to lein's rule: every lesson either copy finished, with its earliest done; every card at the
 * higher box of the two, with that copy's due date (on a tie, the sooner due).
 */
export function mergeProgress(a: Progress, b: Progress): Progress {
  const lessons: Record<string, { done: string }> = {}, cards: Record<string, Card> = {};
  for (const source of [a, b]) for (const [id, entry] of Object.entries(source.lessons)) {
    const known = lessons[id];
    lessons[id] = Object.freeze({ done: !known || Date.parse(entry.done) < Date.parse(known.done) ? entry.done : known.done });
  }
  for (const source of [a, b]) for (const [id, card] of Object.entries(source.cards)) {
    const known = cards[id];
    cards[id] = !known || card.box > known.box || card.box === known.box && card.due < known.due ? card : known;
  }
  const sorted = <T,>(value: Record<string, T>) => Object.freeze(Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])));
  return Object.freeze({ schema: PROGRESS_SCHEMA, lessons: sorted(lessons), cards: sorted(cards) });
}

export const isDone = (progress: Progress, id: string) => Object.hasOwn(progress.lessons, id);
/**
 * Marks a lesson done. Done is done: a second visit keeps the first instant. The lesson's review cards enter box 1 with it (2.0 SC3),
 * and a lesson finished before they existed gets them the next time its Done screen opens; a card the learner already has keeps its place.
 */
export function completeLesson(progress: Progress, lesson: Lesson, now: number): Progress {
  const marked = isDone(progress, lesson.id) ? progress : Object.freeze({ ...progress, lessons: Object.freeze({ ...progress.lessons, [lesson.id]: Object.freeze({ done: new Date(now).toISOString() }) }) });
  return withLessonCards(marked, lesson, now);
}
/**
 * The next lesson: the first one not done on the path, then in unit order. The path is the congregation's default
 * (the six parts most students lead); a signed-in student's own parts replace it when the account slice lands.
 * The fluency strand never becomes "Next" on its own (A4 6.3).
 */
export function nextLesson(progress: Progress, tenant: Tenant = CRC_TENANT, path: readonly string[] = tenant.defaultPath): Lesson | null {
  for (const id of path) { const lesson = lessonById(id); if (lesson && lesson.kind !== "fluency" && lessonOpen(lesson, SERVICE_COURSE, tenant) && !isDone(progress, id)) return lesson; }
  // The morning's units, then (CRC, 2.0 SC7) Saturday evening and Havdalah; a congregation without the evening never reaches them.
  for (const unit of SERVICE_COURSE.units) for (const id of unit.lessons) { const lesson = lessonById(id); if (lesson && lesson.kind !== "fluency" && lessonOpen(lesson, SERVICE_COURSE, tenant) && !isDone(progress, id)) return lesson; }
  return null;
}
/**
 * What follows a lesson on the Done screen: the next lesson not yet done after it in unit order (the six default parts come
 * first, then the morning's units), and from the last one on, the first not done anywhere.
 */
export function lessonAfter(progress: Progress, id: string, tenant: Tenant = CRC_TENANT): Lesson | null {
  const order = SERVICE_COURSE.units.flatMap(unit => unit.lessons).map(lessonId => lessonById(lessonId)!).filter(lesson => lesson.kind !== "fluency" && lessonOpen(lesson, SERVICE_COURSE, tenant));
  const at = order.findIndex(lesson => lesson.id === id);
  for (const lesson of at < 0 ? [] : order.slice(at + 1)) if (!isDone(progress, lesson.id)) return lesson;
  return nextLesson(progress, tenant);
}
/** The first of the learner's own parts not yet done (2.0 SC4), or null when the path is empty or all done. */
export function nextOnPath(progress: Progress, path: readonly string[]): Lesson | null {
  for (const id of path) { const lesson = lessonById(id); if (lesson && lesson.kind !== "fluency" && !isDone(progress, id)) return lesson; }
  return null;
}
/** Every prayer and moment of the service is done: the morning's, and (CRC, 2.0 SC7) the evening's own lessons. */
export const courseDone = (progress: Progress, tenant: Tenant = CRC_TENANT) => serviceOrder().every(lesson => isDone(progress, lesson.id))
  && SERVICE_COURSE.lessons.every(lesson => !isEveningLesson(lesson) || !lessonOpen(lesson, SERVICE_COURSE, tenant) || isDone(progress, lesson.id));

/** Browser storage for signed-out learners: one key, every access guarded; corrupt or missing means fresh. */
export type ProgressStore = Readonly<{ load(): Progress; save(progress: Progress): boolean }>;
export function browserProgressStore(storage: () => Storage | null = () => { try { return window.localStorage; } catch { return null; } }, key: string = PROGRESS_KEY): ProgressStore {
  return Object.freeze({
    load() {
      try {
        const text = storage()?.getItem(key);
        if (!text || text.length > PROGRESS_LIMITS.bytes) return emptyProgress();
        return parseProgress(JSON.parse(text)) ?? emptyProgress();
      } catch { return emptyProgress(); }
    },
    save(progress) {
      try { const text = serializeProgress(progress); if (!text) return false; storage()?.setItem(key, text); return true; } catch { return false; }
    },
  });
}
