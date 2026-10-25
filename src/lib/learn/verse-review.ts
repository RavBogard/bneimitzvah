import type { Melody } from "./course";
import { addDays, answerCard, BOX_DAYS, effectiveDue, gapDays, type Card } from "./progress";
import { TANAKH_VERSE_COUNTS } from "../readings/catalog";
import { TORAH_BOOKS } from "../readings/ranges";

/**
 * 1.9 N19: review cards for a student's own verses, `learn-verses/v1`. A verse the student marked Got it, or the tutor
 * marked Solid, becomes a card in the same Leitner boxes as the phrase cards, with the same ceremony-date cap
 * (progress.ts: gapDays, effectiveDue). It is its own owner-only document (migration 0048), so every stored
 * `learn-progress/v1` document and its strict parser stay exactly as they are. Pure; the clock is always passed in.
 */
export const VERSE_REVIEW_SCHEMA = "learn-verses/v1" as const;
export const VERSE_REVIEW_LIMITS = Object.freeze({ cards: 400, bytes: 32 * 1024 });
export type VerseCardId = `${Melody}|${string}`;
export type VerseReview = Readonly<{ schema: typeof VERSE_REVIEW_SCHEMA; cards: Readonly<Record<string, Card>> }>;
export const emptyVerseReview = (): VerseReview => Object.freeze({ schema: VERSE_REVIEW_SCHEMA, cards: Object.freeze({}) });

const BOOKS = Object.keys(TANAKH_VERSE_COUNTS);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const realDate = (value: unknown): value is string => typeof value === "string" && DATE.test(value) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
type Position = { book: string; chapter: number; verse: number };
/** "Genesis 23:1" as book, chapter and verse, only when the verse exists in that book. */
export function versePosition(ref: string): Position | null {
  const match = /^(.+) ([1-9]\d{0,2}):([1-9]\d{0,2})$/.exec(ref); if (!match) return null;
  const book = match[1], chapter = Number(match[2]), verse = Number(match[3]), counts = Object.hasOwn(TANAKH_VERSE_COUNTS, book) ? TANAKH_VERSE_COUNTS[book] : null;
  return counts && chapter <= counts.length && verse <= counts[chapter - 1] ? { book, chapter, verse } : null;
}
export const verseCardId = (kind: Melody, ref: string): VerseCardId => `${kind}|${ref}`;
/** A card names one real verse in its melody: a Torah card a verse of the five books, a haftarah card any other. */
export function parseVerseCardId(id: string): { kind: Melody; ref: string } | null {
  if (id.length > 80) return null;
  const at = id.indexOf("|"), kind = id.slice(0, at), ref = id.slice(at + 1);
  if (at < 0 || kind !== "torah" && kind !== "haftarah") return null;
  const position = versePosition(ref); if (!position) return null;
  return (TORAH_BOOKS as readonly string[]).includes(position.book) === (kind === "torah") ? { kind, ref } : null;
}
const order = (id: string) => { const card = parseVerseCardId(id)!, p = versePosition(card.ref)!; return [card.kind === "torah" ? 0 : 1, BOOKS.indexOf(p.book), p.chapter, p.verse]; };
/** Torah before haftarah, then in reading order. */
export function compareVerseIds(a: string, b: string): number {
  const x = order(a), y = order(b);
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}
const sorted = (cards: Record<string, Card>) => Object.freeze(Object.fromEntries(Object.keys(cards).sort(compareVerseIds).map(id => [id, cards[id]])));

/** Strict, bounded parse, as parseProgress is: anything unexpected is null. */
export function parseVerseReview(value: unknown): VerseReview | null {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return null;
    const row = value as Record<string, unknown>;
    if (Object.keys(row).length !== 2 || row.schema !== VERSE_REVIEW_SCHEMA) return null;
    const cardsIn = row.cards;
    if (!cardsIn || typeof cardsIn !== "object" || Array.isArray(cardsIn) || Object.getPrototypeOf(cardsIn) !== Object.prototype) return null;
    const entries = Object.entries(cardsIn); if (entries.length > VERSE_REVIEW_LIMITS.cards) return null;
    const cards: Record<string, Card> = {};
    for (const [id, entry] of entries) {
      const card = entry as { box?: unknown; due?: unknown };
      if (!parseVerseCardId(id) || !entry || typeof entry !== "object" || Array.isArray(entry) || Object.keys(entry).length !== 2 || !Number.isSafeInteger(card.box)
        || (card.box as number) < 0 || (card.box as number) >= BOX_DAYS.length || !realDate(card.due)) return null;
      cards[id] = Object.freeze({ box: card.box as number, due: card.due as string });
    }
    return Object.freeze({ schema: VERSE_REVIEW_SCHEMA, cards: sorted(cards) });
  } catch { return null; }
}
export function serializeVerseReview(review: VerseReview): string | null {
  const text = JSON.stringify({ schema: VERSE_REVIEW_SCHEMA, cards: review.cards });
  return Object.keys(review.cards).length <= VERSE_REVIEW_LIMITS.cards && new TextEncoder().encode(text).length <= VERSE_REVIEW_LIMITS.bytes ? text : null;
}

/** Got it and Solid verses become cards: a new card enters box 1, due after box 1's gap (capped by the ceremony). Existing cards keep their place. */
export function addVerseCards(review: VerseReview, ids: readonly VerseCardId[], today: string, until?: string | null): VerseReview {
  const cards: Record<string, Card> = { ...review.cards };
  let changed = false;
  for (const id of ids) {
    if (cards[id] || !parseVerseCardId(id) || Object.keys(cards).length >= VERSE_REVIEW_LIMITS.cards) continue;
    cards[id] = Object.freeze({ box: 1, due: addDays(today, gapDays(1, today, until)) }); changed = true;
  }
  return changed ? Object.freeze({ schema: VERSE_REVIEW_SCHEMA, cards: sorted(cards) }) : review;
}
export const isVerseDue = (card: Card, today: string, until?: string | null) => effectiveDue(card, today, until) <= today;
/**
 * One verse result, Clean or Stumbled, from a review or a Run-through. A stumble always feeds review: a card drops two boxes
 * and comes back today, and a verse with no card gets one in box 0, due today. Clean moves a card up one box only when it is
 * due, and at most once per run (`moved`); Clean on a verse with no card leaves it alone.
 */
export function recordVerse(review: VerseReview, id: VerseCardId, clean: boolean, today: string, options: { moved?: Set<string>; until?: string | null } = {}): VerseReview {
  if (!parseVerseCardId(id)) return review;
  const card = review.cards[id];
  if (clean && (!card || options.moved?.has(id) || !isVerseDue(card, today, options.until))) return review;
  if (!card && Object.keys(review.cards).length >= VERSE_REVIEW_LIMITS.cards) return review;
  options.moved?.add(id);
  // A stumble comes back today whatever box it lands in; Clean takes the next box's gap, capped by the ceremony.
  const next = card && clean ? answerCard(card, true, today, options.until) : Object.freeze({ box: card ? Math.max(0, card.box - 2) : 0, due: today });
  return Object.freeze({ schema: VERSE_REVIEW_SCHEMA, cards: sorted({ ...review.cards, [id]: next }) });
}
/**
 * The verse cards a review asks today, in reading order. Before a known date no card is later than the day before it, and
 * after the date none is asked at all: the reading has been read.
 */
export function dueVerses(review: VerseReview, today: string, until?: string | null): VerseCardId[] {
  if (until && realDate(until) && today > until) return [];
  return Object.entries(review.cards).filter(([, card]) => isVerseDue(card, today, until)).map(([id]) => id as VerseCardId).sort(compareVerseIds);
}
/** Two copies of one student's cards (a conflict between devices): each card at the higher box, on a tie the sooner due. */
export function mergeVerseReview(a: VerseReview, b: VerseReview): VerseReview {
  const cards: Record<string, Card> = {};
  for (const source of [a, b]) for (const [id, card] of Object.entries(source.cards)) {
    const known = cards[id];
    cards[id] = !known || card.box > known.box || card.box === known.box && card.due < known.due ? card : known;
  }
  return Object.freeze({ schema: VERSE_REVIEW_SCHEMA, cards: sorted(cards) });
}

/**
 * The fade: Colors → Marks only → Tikkun. A suggestion only, never a lock: every level stays one tap away. A verse
 * suggests fewer cues as its card climbs; a Run-through starts with the colours off.
 */
export const HELP_LEVELS = Object.freeze(["colors", "marks", "tikkun"] as const);
export type HelpLevel = typeof HELP_LEVELS[number];
export function suggestedHelp(card: Card | undefined, mode: "review" | "run-through"): HelpLevel {
  const box = card?.box ?? 0, byBox: HelpLevel = box >= 3 ? "tikkun" : box >= 2 ? "marks" : "colors";
  return mode === "run-through" && byBox === "colors" ? "marks" : byBox;
}

/** One run over verses (a review of due cards, or a Run-through of the reading): a result per verse, nothing scored. */
export type VerseResult = "clean" | "stumbled";
export type VerseRun = Readonly<{ order: readonly VerseCardId[]; at: number; results: Readonly<Record<string, VerseResult>> }>;
export const startVerseRun = (ids: readonly VerseCardId[]): VerseRun => Object.freeze({ order: Object.freeze([...ids]), at: 0, results: Object.freeze({}) });
export const currentVerse = (run: VerseRun): VerseCardId | null => run.order[run.at] ?? null;
export const verseRunDone = (run: VerseRun) => run.at >= run.order.length;
export function answerVerseRun(run: VerseRun, result: VerseResult): VerseRun {
  const id = currentVerse(run); if (!id) return run;
  return Object.freeze({ order: run.order, at: run.at + 1, results: Object.freeze({ ...run.results, [id]: result }) });
}
/** The stumbled verses' references, in the run's order. */
export const stumbledRefs = (run: VerseRun): string[] => run.order.filter(id => run.results[id] === "stumbled").map(id => parseVerseCardId(id)!.ref);

/**
 * The Run-through's summary (Daniel, 2026-10-24, "Keep, drop the tally"): "Practise verses 3 and 8 again.", built from the
 * stumbled verses alone, with no count of clean ones. Verses are named by number within one chapter, by chapter:verse
 * across chapters, and in full across books. Null when nothing stumbled.
 */
export function practiseAgain(refs: readonly string[]): string | null {
  const positions = [...new Set(refs)].map(versePosition).filter((p): p is Position => p !== null)
    .sort((a, b) => BOOKS.indexOf(a.book) - BOOKS.indexOf(b.book) || a.chapter - b.chapter || a.verse - b.verse);
  if (!positions.length) return null;
  const oneBook = positions.every(p => p.book === positions[0].book), oneChapter = oneBook && positions.every(p => p.chapter === positions[0].chapter);
  const names = positions.map(p => oneChapter ? `${p.verse}` : oneBook ? `${p.chapter}:${p.verse}` : `${p.book} ${p.chapter}:${p.verse}`);
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
  return `Practise ${names.length === 1 ? "verse" : "verses"} ${list} again.`;
}

/**
 * The stumble's join (CHANTING-RECONCILIATION §2, N19): a stumbled verse with its neighbour in the run, the one before it,
 * or after it for the first verse. Only the structure is built; its wording is a gap, so nothing renders it yet.
 */
export const JOIN_OFFER_ENABLED = false;
export function joinWith(run: VerseRun, id: VerseCardId): readonly [VerseCardId, VerseCardId] | null {
  const at = run.order.indexOf(id); if (at < 0 || run.order.length < 2) return null;
  return at === 0 ? [id, run.order[1]] : [run.order[at - 1], id];
}
