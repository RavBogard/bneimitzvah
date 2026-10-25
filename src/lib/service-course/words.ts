import type { Corpus, Lesson } from "./course";
import { COPY, fill } from "./copy";
import { isDivine, letters, meaningItems, readWords, resolveKeyWords, sayChoices, saysItems, shuffle, type CheckItem, type ReadWord } from "./check";
import { alignedTranslit, hebrewWords, plainWord, type ServiceText } from "./text";
import type { ChoiceItem, Face } from "./reading";

/**
 * Words and lines from the pinned public text, turned into questions (2.0 SC3): the words and lines of f5 and f6, Quick ten and the
 * review of word cards. Pure. The text arrives as a `ServiceText` the page fetched; nothing here holds or remembers any of it.
 * A word is used only when its line's transliteration lines up with its Hebrew word for word, and the divine name is never the thing
 * asked about, since its letters and its spoken "Adonai" do not match (A8): that would test a convention, not reading.
 */
export type PoolWord = ReadWord & Readonly<{ unit: string }>;
export type LineStep = Readonly<{ key: string; kind: "line"; unit: string; line: number; he: readonly string[]; tr: readonly string[]; text: string }>;
export type WordStep = Readonly<{ key: string; kind: "word"; word: PoolWord }>;
export type ItemStep = Readonly<{ key: string; kind: "item"; item: ChoiceItem }>;
export type FluencyStep = LineStep | WordStep | ItemStep;

const he = (text: string): Face => Object.freeze({ text, he: true });
/** Words a learner can be asked to read: a transliteration that lines up, not the divine name, a few letters long. */
const usable = (word: ReadWord) => !!word.translit && !isDivine(word.he) && letters(word.he).length >= 2 && letters(word.he).length <= 9;

/** Every word of a text's lines in a block range, with its transliteration where its line lines up. */
export function wordsIn(text: ServiceText, blocks: readonly [number, number]): ReadWord[] {
  const out: ReadWord[] = [];
  for (let line = blocks[0]; line <= blocks[1] && line < text.lines.length; line++) {
    const words = hebrewWords(text.lines[line].he), translit = alignedTranslit(text.lines[line]);
    words.forEach((word, i) => out.push(Object.freeze({ line, word: i, he: plainWord(word), translit: translit ? translit[i] : null })));
  }
  return out;
}
/** The words of a lesson's corpus: usable words of each unit's lines, distinct by letters and by sound, each tagged with its unit. */
export function corpusWords(corpus: readonly Corpus[], texts: ReadonlyMap<string, ServiceText>): PoolWord[] {
  const out: PoolWord[] = [];
  for (const entry of corpus) {
    const text = texts.get(entry.unit); if (!text) continue;
    for (const word of wordsIn(text, entry.blocks)) {
      if (usable(word) && !out.some(other => letters(other.he) === letters(word.he) || other.translit!.toLowerCase() === word.translit!.toLowerCase())) out.push(Object.freeze({ ...word, unit: entry.unit }));
    }
  }
  return out;
}
/** A reading question on one word: three Hebrew words, and the one that says the transliteration shown. */
export function wordItem(target: PoolWord, pool: readonly PoolWord[], rng: () => number, card?: string, template: string = COPY.fluency.wordPrompt): ChoiceItem | null {
  const choices = sayChoices(target, [], pool, rng);
  if (!choices) return null;
  return Object.freeze({ key: `word:${target.unit}:${target.line}:${target.word}`, ...(card ? { card } : {}), prompt: fill(template, { translit: target.translit ?? "" }),
    choices: Object.freeze(choices.map(choice => he(choice.he))), right: choices.indexOf(target),
    feedback: Object.freeze(choices.map(choice => choice === target ? fill(COPY.check.right, { word: choice.he, translit: choice.translit ?? "" }) : fill(COPY.check.miss, { translit: choice.translit ?? "" }))) });
}

/** How many words f5 reads one syllable at a time, and then asks about. */
export const F5_WORDS = 5;
/** f5: read five words, then find each by its transliteration. Words come from every unit in turn, so no one prayer supplies them all. */
export function wordSteps(corpus: readonly Corpus[], texts: ReadonlyMap<string, ServiceText>, rng: () => number): readonly FluencyStep[] {
  const pool = corpusWords(corpus, texts);
  const by = corpus.map(entry => shuffle(pool.filter(word => word.unit === entry.unit && letters(word.he).length >= 3 && letters(word.he).length <= 7), rng));
  const picked: PoolWord[] = [];
  for (let round = 0; picked.length < F5_WORDS && round < 40; round++) for (const list of by) if (list[round] && picked.length < F5_WORDS) picked.push(list[round]);
  if (picked.length < 3) return [];
  const reading: FluencyStep[] = picked.map(word => Object.freeze({ key: `read:${word.unit}:${word.line}:${word.word}`, kind: "word" as const, word }));
  const asking: FluencyStep[] = shuffle(picked, rng).flatMap(word => { const item = wordItem(word, pool, rng); return item ? [Object.freeze({ key: item.key, kind: "item" as const, item })] : []; });
  return Object.freeze([...reading, ...asking]);
}

/** A line with a transliteration that lines up, two to fourteen words long: the first such line of the unit's range. */
export function firstReadableLine(text: ServiceText, blocks: readonly [number, number]): LineStep | null {
  for (let line = blocks[0]; line <= blocks[1] && line < text.lines.length; line++) {
    const words = hebrewWords(text.lines[line].he), tr = alignedTranslit(text.lines[line]);
    if (tr && words.length >= 2 && words.length <= 14) return Object.freeze({ key: "", kind: "line", unit: text.unit, line, he: Object.freeze(words.map(plainWord)), tr: Object.freeze([...tr]), text: text.lines[line].he });
  }
  return null;
}
/** f6: each unit's first readable line, then two reading questions on its words. A line the learner marks "Not yet" comes back once (the screen asks). */
export function lineSteps(corpus: readonly Corpus[], texts: ReadonlyMap<string, ServiceText>, rng: () => number): readonly FluencyStep[] {
  const pool = corpusWords(corpus, texts), out: FluencyStep[] = [];
  for (const entry of corpus) {
    const text = texts.get(entry.unit), line = text ? firstReadableLine(text, entry.blocks) : null;
    if (!text || !line) continue;
    const step: LineStep = Object.freeze({ ...line, key: `line:${entry.unit}:${line.line}` });
    out.push(step);
    const own = wordsIn(text, [line.line, line.line]).filter(usable).map(word => Object.freeze({ ...word, unit: entry.unit }));
    for (const target of shuffle(own.filter((word, i) => own.findIndex(other => letters(other.he) === letters(word.he)) === i), rng).slice(0, 2)) {
      const item = wordItem(target, [...own, ...pool], rng);
      if (item) out.push(Object.freeze({ key: item.key, kind: "item" as const, item }));
    }
  }
  return Object.freeze(out);
}

/** A Check item as a choice item, so the review and Quick ten show it like any other question. */
export function fromCheck(item: CheckItem, card: string | undefined, context?: ChoiceItem["context"]): ChoiceItem {
  const base = { key: item.key, ...(card ? { card } : {}), ...(context ? { context } : {}) };
  if (item.kind === "says") {
    return Object.freeze({ ...base, prompt: fill(COPY.check.whichSays, { translit: item.target.translit ?? "" }), choices: Object.freeze(item.choices.map(choice => he(choice.he))),
      right: item.choices.findIndex(choice => choice.line === item.target.line && choice.word === item.target.word),
      feedback: Object.freeze(item.choices.map(choice => choice.line === item.target.line && choice.word === item.target.word ? fill(COPY.check.right, { word: choice.he, translit: choice.translit ?? "" }) : fill(COPY.check.miss, { translit: choice.translit ?? "" }))) });
  }
  if (item.kind === "means-word") {
    return Object.freeze({ ...base, prompt: fill(COPY.check.whichMeans, { gloss: item.target.gloss }), choices: Object.freeze(item.choices.map(choice => he(choice.he))),
      right: item.choices.findIndex(choice => choice.line === item.target.line && choice.word === item.target.word),
      feedback: Object.freeze(item.choices.map(choice => choice.line === item.target.line && choice.word === item.target.word ? fill(COPY.check.rightMeaning, { word: choice.he, gloss: choice.gloss }) : fill(COPY.check.missMeaning, { gloss: choice.gloss }))) });
  }
  return Object.freeze({ ...base, prompt: COPY.check.whatMeans, stimulus: he(item.target.he), choices: Object.freeze(item.choices.map(text => Object.freeze({ text, he: false }))), right: item.choices.indexOf(item.target.gloss),
    feedback: Object.freeze(item.choices.map(choice => choice === item.target.gloss ? fill(COPY.check.rightMeaning, { word: item.target.he, gloss: choice }) : fill(COPY.check.missMeaning, { gloss: choice }))) });
}

/** One review question for a word card of a lesson, from that lesson's loaded text; null when the text cannot make one. */
export function wordCardItem(lesson: Lesson, kind: "read" | "meaning", text: ServiceText, rng: () => number): ChoiceItem | null {
  const keys = resolveKeyWords(lesson, text), card = `word:${lesson.id}:${kind}`;
  const found = kind === "read" ? saysItems(keys, readWords(lesson, text), rng)[0] : meaningItems(keys, rng)[0];
  return found ? fromCheck(found, card) : null;
}

/** Quick ten's size and its pause: ten reading questions, the word shown in its line for 1.5 seconds after each answer (A4 8.4). */
export const QUICK_TEN = Object.freeze({ items: 10, showMs: 1500, sources: 3 });
export type QuickSource = Readonly<{ lessonId: string | null; unit: string; blocks: readonly [number, number]; text: ServiceText }>;
/**
 * Quick ten's ten questions from the loaded sources, one word at a time, taking each source in turn. A word of a lesson moves that
 * lesson's `word:{id}:read` card; a word from the strand's corpus moves none. Only reading questions: no meaning, no audio.
 */
export function quickTenItems(sources: readonly QuickSource[], rng: () => number): readonly ChoiceItem[] {
  const pools = sources.map(source => {
    const words = wordsIn(source.text, source.blocks).filter(usable).map(word => Object.freeze({ ...word, unit: source.unit }));
    const targets = shuffle(words.filter((word, i) => words.findIndex(other => letters(other.he) === letters(word.he)) === i), rng);
    return { source, words, targets };
  });
  const out: ChoiceItem[] = [], used = new Set<string>();
  for (let round = 0; out.length < QUICK_TEN.items && round < 60; round++) {
    let any = false;
    for (const { source, words, targets } of pools) {
      const target = targets[round]; if (!target || out.length >= QUICK_TEN.items) continue;
      any = true;
      const item = wordItem(target, words, rng, source.lessonId ? `word:${source.lessonId}:read` : undefined, COPY.quickTen.prompt);
      if (!item || used.has(item.key)) continue;
      used.add(item.key);
      out.push(Object.freeze({ ...item, context: Object.freeze({ he: source.text.lines[target.line].he, mark: target.word }) }));
    }
    if (!any) break;
  }
  return Object.freeze(out);
}
