import type { KeyWord, Lesson } from "./course";
import { alignedTranslit, hebrewWords, plainWord, type ServiceText } from "./text";

/**
 * The words of a lesson's Read, and the Check built from them at runtime (A4 8.2). Pure: the lesson screen and the tests share it.
 * A reading item names a word by its transliteration and asks for it among three Hebrew words; it uses a word only when its line's
 * transliteration lines up word for word with the Hebrew. A meaning item asks what a key word means, or which key word means a
 * gloss. Nothing is scored: a run only knows which items came back.
 */
export type ReadWord = Readonly<{ line: number; word: number; he: string; translit: string | null }>;
export type ResolvedKeyWord = ReadWord & Readonly<{ gloss: string; root?: string; checkable: boolean }>;
export type CheckItem =
  | Readonly<{ kind: "says"; key: string; target: ReadWord; choices: readonly ReadWord[] }>
  | Readonly<{ kind: "means-word"; key: string; target: ResolvedKeyWord; choices: readonly ResolvedKeyWord[] }>
  | Readonly<{ kind: "what-means"; key: string; target: ResolvedKeyWord; choices: readonly string[] }>;

/** The divine name, written yod-yod or yod-hei-vav-hei, is said "Adonai": a reading item on it would test a convention, not decoding (A8). */
const DIVINE = /^(?:\u05D9\u05D9|\u05D9\u05D4\u05D5\u05D4)$/;
export const letters = (word: string) => word.replace(/[^\u05D0-\u05EA]/g, "");
export const isDivine = (word: string) => DIVINE.test(letters(word));

/** Every word of the Read's lines, with its transliteration where the line lines up. */
export function readWords(lesson: Lesson, text: ServiceText): readonly ReadWord[] {
  if (!lesson.read) return [];
  const [first, last] = lesson.read.blocks, out: ReadWord[] = [];
  for (let line = first; line <= last && line < text.lines.length; line++) {
    const words = hebrewWords(text.lines[line].he), translit = alignedTranslit(text.lines[line]);
    words.forEach((he, word) => out.push(Object.freeze({ line, word, he: plainWord(he), translit: translit ? translit[word] : null })));
  }
  return Object.freeze(out);
}
/** The lesson's key words as they stand in the loaded text; a key word whose line or word the text does not have is left out. */
export function resolveKeyWords(lesson: Lesson, text: ServiceText): readonly ResolvedKeyWord[] {
  const words = readWords(lesson, text);
  return Object.freeze(lesson.keyWords.flatMap((key: KeyWord) => {
    const found = words.find(word => word.line === key.block && word.word === key.word);
    return found && found.he ? [Object.freeze({ ...found, gloss: key.gloss, ...(key.root ? { root: key.root } : {}), checkable: key.check !== false && !isDivine(found.he) })] : [];
  }));
}

/** A small seeded generator (mulberry32), so a run's order is stable for its seed and different from the next run's. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export const shuffle = <T,>(items: readonly T[], rng: () => number): T[] => { const out = [...items]; for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; } return out; };
const sameTranslit = (a: string, b: string) => a.toLocaleLowerCase("en") === b.toLocaleLowerCase("en");

/** Two other words to stand beside a reading target: key words first, then any word of the Read, never one that looks or sounds the same. */
export function sayChoices(target: ReadWord, keys: readonly ResolvedKeyWord[], words: readonly ReadWord[], rng: () => number): ReadWord[] | null {
  const ok = (word: ReadWord) => word.translit && word.he !== target.he && letters(word.he) !== letters(target.he) && !sameTranslit(word.translit, target.translit!) && !isDivine(word.he);
  const pool: ReadWord[] = [];
  for (const word of [...shuffle(keys, rng), ...shuffle(words, rng)]) if (ok(word) && !pool.some(other => letters(other.he) === letters(word.he) || sameTranslit(other.translit!, word.translit!))) pool.push(word);
  return pool.length >= 2 ? shuffle([target, ...pool.slice(0, 2)], rng) : null;
}

/** Reading items for the key words that can be read from the loaded text, in a seeded order: each names a word and asks for it among three. */
export function saysItems(keys: readonly ResolvedKeyWord[], words: readonly ReadWord[], rng: () => number): CheckItem[] {
  const says: CheckItem[] = [];
  for (const target of shuffle(keys.filter(key => key.checkable && key.translit), rng)) {
    const choices = sayChoices(target, keys, words, rng);
    if (choices) says.push(Object.freeze({ kind: "says", key: `says:${target.line}:${target.word}`, target, choices: Object.freeze(choices) }));
  }
  return says;
}
/** Meaning items for a lesson's key words, alternating Hebrew-to-English and English-to-Hebrew; none with fewer than three different words. */
export function meaningItems(keys: readonly ResolvedKeyWord[], rng: () => number): CheckItem[] {
  const meaning: CheckItem[] = [];
  const distinct = keys.filter((key, i) => keys.findIndex(other => letters(other.he) === letters(key.he)) === i);
  if (distinct.length >= 3) shuffle(distinct, rng).forEach((target, i) => {
    const others = shuffle(distinct.filter(key => key !== target), rng).slice(0, 2);
    meaning.push(i % 2 === 0
      ? Object.freeze({ kind: "what-means", key: `what:${target.line}:${target.word}`, target, choices: Object.freeze(shuffle([target.gloss, ...others.map(other => other.gloss)], rng)) })
      : Object.freeze({ kind: "means-word", key: `means:${target.line}:${target.word}`, target, choices: Object.freeze(shuffle([target, ...others], rng)) }));
  });
  return meaning;
}

/** The Check for one lesson and its loaded text: `check.items` items, about half reading and half meaning, or fewer when the text gives fewer. */
export function buildCheck(lesson: Lesson, text: ServiceText, rng: () => number): readonly CheckItem[] {
  if (!lesson.read || !lesson.check) return [];
  const keys = resolveKeyWords(lesson, text), wanted = lesson.check.items;
  const says = saysItems(keys, readWords(lesson, text), rng), meaning = meaningItems(keys, rng);
  const reading = Math.min(says.length, Math.ceil(wanted / 2)), picked = [...says.slice(0, reading), ...meaning.slice(0, wanted - reading)];
  if (picked.length < wanted) picked.push(...says.slice(reading, reading + wanted - picked.length));
  return picked.length >= 3 ? Object.freeze(shuffle(picked, rng)) : Object.freeze([]);
}

/** One run through the Check: a miss comes back three to five items later, at most twice; then it is left for review. */
export type CheckRun<T extends { key: string } = CheckItem> = Readonly<{ queue: readonly T[]; at: number; misses: ReadonlyMap<string, number> }>;
export const CHECK_REASKS = 2;
export const startCheck = <T extends { key: string }>(items: readonly T[]): CheckRun<T> => Object.freeze({ queue: Object.freeze([...items]), at: 0, misses: new Map() });
export const currentCheck = <T extends { key: string }>(run: CheckRun<T>): T | null => run.queue[run.at] ?? null;
export const checkDone = <T extends { key: string }>(run: CheckRun<T>) => run.at >= run.queue.length;
/** `reasks` is how many times one step may come back (a line read again: once); `at: "end"` brings a miss back after the planned items (Quick ten) rather than three to five on. */
export function answerCheck<T extends { key: string }>(run: CheckRun<T>, right: boolean, rng: () => number, options: { reasks?: number; at?: "soon" | "end" } = {}): CheckRun<T> {
  const reasks = options.reasks ?? CHECK_REASKS;
  const item = currentCheck(run); if (!item) return run;
  const queue = [...run.queue], next = run.at + 1, misses = new Map(run.misses);
  if (!right) {
    const count = (misses.get(item.key) ?? 0) + 1; misses.set(item.key, count);
    if (count <= reasks) queue.splice(options.at === "end" ? queue.length : Math.min(next + 3 + Math.floor(rng() * 3), queue.length), 0, item);
  }
  return Object.freeze({ queue: Object.freeze(queue), at: next, misses });
}
