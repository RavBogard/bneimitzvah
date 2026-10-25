import { SERVICE_COURSE, lessonById, type Alphabet } from "./course";
import type { ServiceText } from "./text";
import { ALL_LOOKALIKES, VOWELS, finalItem, knownLetters, knownSyllableLetters, letterNameItem, vowelItem, type ChoiceItem } from "./reading";
import { wordCardItem } from "./words";

/**
 * The questions of a review (2.0 SC3, A4 8.3): one for each due card, in the order the cards were drawn. A letter or vowel card asks
 * about the letter or vowel itself, among letters the learner has cards for; a word card asks one reading or meaning question from its
 * lesson's text. A card whose question cannot be made (its text did not give one, or the learner has too few letters yet) is
 * left out and keeps its place. Pure: the text is passed in.
 */
export type ReviewTexts = ReadonlyMap<string, ServiceText>;
export const cardLesson = (card: string): string | null => /^word:([a-z][a-z0-9-]*):(?:read|meaning)$/.exec(card)?.[1] ?? null;
/** The public units a review's word cards need, each once. */
export function reviewUnits(cards: readonly string[]): string[] {
  return [...new Set(cards.flatMap(card => { const id = cardLesson(card), unit = id ? lessonById(id)?.read?.unit : undefined; return unit ? [unit] : []; }))];
}
export function reviewItems(cards: readonly string[], owned: ReadonlySet<string>, texts: ReviewTexts, rng: () => number, alphabet: Alphabet = SERVICE_COURSE.alphabet): readonly ChoiceItem[] {
  const known = knownLetters(owned), out: ChoiceItem[] = [];
  for (const card of cards) {
    const [kind, id, skill] = card.split(":");
    let item: ChoiceItem | null = null;
    if (kind === "letter" && skill === "name") {
      item = id.startsWith("final-") ? finalItem(alphabet, id, rng) : letterNameItem(alphabet, id, known.includes(id) ? known : [...known, id], rng, ALL_LOOKALIKES);
    } else if (kind === "vowel" && skill === "sound") {
      const form = VOWELS.find(row => row.id === id);
      item = form ? vowelItem(alphabet, form, rng, knownSyllableLetters(owned)) : null;
    } else if (kind === "word" && (skill === "read" || skill === "meaning")) {
      const lesson = lessonById(id), text = lesson?.read ? texts.get(lesson.read.unit) : undefined;
      item = lesson && text ? wordCardItem(lesson, skill, text, rng) : null;
    }
    // The item keys of a review are the card's own, so a card the learner meets twice (a miss coming back) is the same item.
    if (item) out.push(Object.freeze({ ...item, key: card, card }));
  }
  return Object.freeze(out);
}
