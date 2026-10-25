import { SERVICE_COURSE, type Alphabet, type Letter, type Mark } from "./course";
import { COPY, fill } from "./copy";
import { shuffle } from "./check";

/**
 * The Reading Hebrew strand's letters, vowels and dots (2.0 SC3, A4 4): what each of f1 to f4 shows first and the questions it asks.
 * Pure: the screens and the tests share it. Every Hebrew character here is composed from the course's alphabet table at run time, so
 * this file holds no Hebrew and no prayer word. Nothing is scored; an item carries only what it says after each answer.
 *
 * A lesson names only what it has shown. Each lesson opens on its Intro (the letters, or the vowels with their sounds, or the dot pairs),
 * and its questions draw only on what that Intro and the lessons before it showed (Learn's rule: recognition only names what the
 * learner has met).
 */
export type Face = Readonly<{ text: string; he: boolean }>;
/** One question: a prompt, an optional thing to look at, the choices, the right one, and what is said after each choice. */
export type ChoiceItem = Readonly<{
  key: string;
  /** The review card this answer moves, when the learner has one (`letter:alef:name`, `vowel:chirik:sound`, `word:shma:read`). */
  card?: string;
  prompt: string;
  stimulus?: Face;
  choices: readonly Face[];
  right: number;
  /** What is said after choosing choice `i`, right or not. */
  feedback: readonly string[];
  /** The line a word sits in and the word's place in it, shown after the answer (Quick ten). */
  context?: Readonly<{ he: string; mark: number }>;
}>;
export type IntroRow = Readonly<{ key: string; he: string; label: string; note?: string }>;

/** The letters each of the two letter lessons shows, by alphabet id (A4 4: Alef to Kaf/Chaf, then Lamed to Tav). */
export const F1_LETTERS = Object.freeze(["alef", "bet", "gimel", "dalet", "hei", "vav", "zayin", "chet", "tet", "yod", "kaf"] as const);
export const F2_LETTERS = Object.freeze(["lamed", "mem", "nun", "samech", "ayin", "pei", "tzadi", "kuf", "reish", "shin", "tav"] as const);
/** Pairs that look alike, as the lesson that has shown both can ask about them (a pair waits for the later letter's lesson). */
const LOOKALIKES: Readonly<Record<string, readonly (readonly [string, string])[]>> = Object.freeze({
  f1: [["bet", "kaf"], ["vav", "zayin"], ["hei", "chet"]],
  f2: [["dalet", "reish"], ["chet", "tav"], ["hei", "tav"]],
});
/** How many plain "Which letter is this?" items a lesson asks: all of f1's eleven, five of f2's (its finals and look-alikes fill the rest). */
const PLAIN_ITEMS: Readonly<Record<string, number>> = Object.freeze({ f1: 11, f2: 5 });

/** The consonant of a syllable, in the house transliteration, for letters that carry one sound (bet, kaf, pei and shin wait for f4). */
const SYLLABLE_LETTERS: Readonly<Record<string, string>> = Object.freeze({
  gimel: "g", dalet: "d", hei: "h", zayin: "z", chet: "ch", tet: "t", yod: "y", lamed: "l", mem: "m", nun: "n", samech: "s", tzadi: "tz", kuf: "k", reish: "r", tav: "t",
});
export type VowelForm = Readonly<{ id: string; /** the alphabet ids written after the consonant */ marks: readonly string[]; /** the vowel in a syllable */ vowel: string; /** how the tell line says it */ say: string; name?: string; card: boolean }>;
/** The ten ways a vowel is written in prayer Hebrew: the seven marks, the sh'va, and the two vav forms (shuruk, cholam male). */
export const VOWELS: readonly VowelForm[] = Object.freeze([
  { id: "kamatz", marks: ["kamatz"], vowel: "a", say: "ah", card: true }, { id: "patach", marks: ["patach"], vowel: "a", say: "ah", card: true },
  { id: "segol", marks: ["segol"], vowel: "e", say: "eh", card: true }, { id: "tzere", marks: ["tzere"], vowel: "e", say: "eh", card: true },
  { id: "chirik", marks: ["chirik"], vowel: "i", say: "ee", card: true }, { id: "cholam", marks: ["cholam"], vowel: "o", say: "oh", card: true },
  { id: "kubutz", marks: ["kubutz"], vowel: "u", say: "oo", card: true }, { id: "shva", marks: ["shva"], vowel: "’", say: "uh", card: true },
  { id: "shuruk", marks: ["vav", "dagesh"], vowel: "u", say: "oo", name: "Shuruk", card: false },
  { id: "cholam-male", marks: ["vav", "cholam"], vowel: "o", say: "oh", name: "Cholam", card: false },
] as const);
/** The letters of the three dot pairs, with the sound each makes with its dot and without (A4 4, f4). */
const DOT_PAIRS = Object.freeze([{ id: "bet", dot: "b", plain: "v" }, { id: "kaf", dot: "k", plain: "ch" }, { id: "pei", dot: "p", plain: "f" }] as const);
const SAMPLE_LETTER = "gimel";

export const LESSON_LETTERS: Readonly<Record<string, readonly string[]>> = Object.freeze({ f1: F1_LETTERS, f2: F2_LETTERS });
export const letterCardId = (id: string) => `letter:${id}:name`;
export const vowelCardId = (id: string) => `vowel:${id}:sound`;

type Table = Readonly<{ letter(id: string): Letter | undefined; final(id: string): Letter | undefined; mark(id: string): Mark | undefined; alphabet: Alphabet }>;
const table = (alphabet: Alphabet): Table => {
  const letters = new Map(alphabet.letters.map(row => [row.id, row])), finals = new Map(alphabet.finals.map(row => [row.id, row])), marks = new Map(alphabet.marks.map(row => [row.id, row]));
  return { letter: id => letters.get(id), final: id => finals.get(id), mark: id => marks.get(id), alphabet };
};
const he = (text: string): Face => Object.freeze({ text, he: true });
const latin = (text: string): Face => Object.freeze({ text, he: false });

/** A consonant with the marks that follow it: the letter, then each mark or vav-and-mark of the form. */
function written(t: Table, letter: string, marks: readonly string[]): string {
  const base = t.letter(letter)?.char ?? "";
  return base + marks.map(id => t.letter(id)?.char ?? t.mark(id)?.mark ?? "").join("");
}
const vowelName = (t: Table, form: VowelForm) => form.name ?? t.mark(form.marks[0])?.name ?? form.id;
const tellVowel = (t: Table, form: VowelForm) => fill(COPY.fluency.vowelTell, { vowel: vowelName(t, form), sound: `“${form.say}”` });
const tellDot = (a: string, b: string) => fill(COPY.fluency.dotTell, { a, b });
/** The name of a letter as the course writes it ("Bet/Vet"). */
const nameOf = (t: Table, id: string) => t.letter(id)?.name ?? t.final(id)?.name ?? id;
const syllable = (consonant: string, vowel: string) => `${consonant}${vowel}`;

/** What a letter item says after a choice: right is "Yes. {letter} is Bet/Vet."; a wrong choice names the one the learner touched or, when the choices are names, the shown letter. */
const right = (word: string, translit: string) => fill(COPY.check.right, { word, translit });
const miss = (translit: string) => fill(COPY.check.miss, { translit });

/** The Intro a fluency lesson opens on: what its questions will name, shown with names and sounds first. Null for f5 and f6, which read the text itself. */
export function fluencyIntro(lessonId: string, alphabet: Alphabet = SERVICE_COURSE.alphabet): readonly IntroRow[] | null {
  const t = table(alphabet);
  if (lessonId === "f1" || lessonId === "f2") {
    const rows: IntroRow[] = LESSON_LETTERS[lessonId].map(id => ({ key: id, he: t.letter(id)!.char, label: t.letter(id)!.name }));
    if (lessonId === "f2") for (const final of alphabet.finals) rows.push({ key: final.id, he: final.char, label: final.name });
    return Object.freeze(rows.map(row => Object.freeze(row)));
  }
  if (lessonId === "f3") return Object.freeze(VOWELS.map(form => Object.freeze({ key: form.id, he: written(t, SAMPLE_LETTER, form.marks), label: vowelName(t, form), note: tellVowel(t, form) })));
  if (lessonId === "f4") {
    const shin = t.letter("shin")!.char, rows: IntroRow[] = DOT_PAIRS.map(pair => ({ key: pair.id, he: `${written(t, pair.id, ["dagesh", "patach"])} ${written(t, pair.id, ["patach"])}`, label: nameOf(t, pair.id), note: tellDot(pair.dot, pair.plain) }));
    rows.push({ key: "shin", he: shin + (t.mark("shin-dot")?.mark ?? ""), label: COPY.fluency.shin }, { key: "sin", he: shin + (t.mark("sin-dot")?.mark ?? ""), label: COPY.fluency.sin });
    return Object.freeze(rows.map(row => Object.freeze(row)));
  }
  return null;
}

/** Two other names to stand beside a letter's own, from the letters the lessons so far have shown, a look-alike partner first. */
function otherLetters(target: string, known: readonly string[], rng: () => number, pairs: readonly (readonly [string, string])[] = []): string[] {
  const partners = pairs.flatMap(pair => pair[0] === target ? [pair[1]] : pair[1] === target ? [pair[0]] : []).filter(id => known.includes(id));
  const rest = shuffle(known.filter(id => id !== target && !partners.includes(id)), rng);
  return [...partners.slice(0, 1), ...rest].slice(0, 2);
}
/** "Which letter is this?": a letter to look at and three names. */
export function letterNameItem(alphabet: Alphabet, id: string, known: readonly string[], rng: () => number, pairs: readonly (readonly [string, string])[] = []): ChoiceItem | null {
  const t = table(alphabet), letter = t.letter(id);
  if (!letter) return null;
  const others = otherLetters(id, known.filter(other => t.letter(other)), rng, pairs);
  if (others.length < 2) return null;
  const ids = shuffle([id, ...others], rng);
  return Object.freeze({ key: `letter:${id}`, card: letterCardId(id), prompt: COPY.fluency.letterPrompt, stimulus: he(letter.char), choices: Object.freeze(ids.map(other => latin(nameOf(t, other)))), right: ids.indexOf(id),
    feedback: Object.freeze(ids.map(other => other === id ? right(letter.char, letter.name) : miss(letter.name))) });
}
/** "These two look alike. Which one is {name}?": two letters to choose between. */
export function lookAlikeItem(alphabet: Alphabet, pair: readonly [string, string], rng: () => number): ChoiceItem | null {
  const t = table(alphabet), [first, second] = pair, a = t.letter(first), b = t.letter(second);
  if (!a || !b) return null;
  const target = rng() < 0.5 ? a : b, ids = shuffle([first, second], rng);
  return Object.freeze({ key: `look:${first}-${second}:${target.id}`, card: letterCardId(target.id), prompt: fill(COPY.fluency.letterLookalike, { name: target.name }),
    choices: Object.freeze(ids.map(id => he(t.letter(id)!.char))), right: ids.indexOf(target.id),
    feedback: Object.freeze(ids.map(id => id === target.id ? right(target.char, target.name) : miss(t.letter(id)!.name))) });
}
/** "This letter comes only at the end of a word. Which letter is it?": a final form and three final-form names. */
export function finalItem(alphabet: Alphabet, id: string, rng: () => number): ChoiceItem | null {
  const t = table(alphabet), final = t.final(id);
  if (!final) return null;
  const ids = shuffle([id, ...shuffle(alphabet.finals.map(row => row.id).filter(other => other !== id), rng).slice(0, 2)], rng);
  if (ids.length < 3) return null;
  return Object.freeze({ key: `final:${id}`, card: letterCardId(id), prompt: COPY.fluency.finalPrompt, stimulus: he(final.char), choices: Object.freeze(ids.map(other => latin(nameOf(t, other)))), right: ids.indexOf(id),
    feedback: Object.freeze(ids.map(other => other === id ? right(final.char, final.name) : miss(final.name))) });
}
/** "Which sound does this make?": a consonant with a vowel, and three syllables that differ in the vowel. */
export function vowelItem(alphabet: Alphabet, form: VowelForm, rng: () => number, letterIds: readonly string[] = Object.keys(SYLLABLE_LETTERS)): ChoiceItem | null {
  const t = table(alphabet), usable = letterIds.filter(id => SYLLABLE_LETTERS[id] && t.letter(id));
  if (!usable.length) return null;
  const consonant = usable[Math.floor(rng() * usable.length)], sound = SYLLABLE_LETTERS[consonant];
  const rivals = shuffle(VOWELS.filter(other => other.vowel !== form.vowel), rng).filter((other, i, all) => all.findIndex(row => row.vowel === other.vowel) === i).slice(0, 2);
  if (rivals.length < 2) return null;
  const forms = shuffle([form, ...rivals], rng), tell = tellVowel(t, form);
  return Object.freeze({ key: `vowel:${form.id}`, ...(form.card ? { card: vowelCardId(form.id) } : {}), prompt: COPY.fluency.vowelPrompt, stimulus: he(written(t, consonant, form.marks)),
    choices: Object.freeze(forms.map(other => latin(syllable(sound, other.vowel)))), right: forms.indexOf(form), feedback: Object.freeze(forms.map(() => tell)) });
}
/** "With the dot or without it?": the sound as letters, and the letter written both ways. */
export function dotItem(alphabet: Alphabet, pairId: string, withDot: boolean, rng: () => number): ChoiceItem | null {
  const t = table(alphabet), pair = DOT_PAIRS.find(row => row.id === pairId);
  if (!pair || !t.letter(pairId)) return null;
  const forms = shuffle([true, false], rng), tell = tellDot(pair.dot, pair.plain);
  return Object.freeze({ key: `dot:${pairId}:${withDot ? "dot" : "plain"}`, prompt: COPY.fluency.dotPrompt, stimulus: latin(syllable(withDot ? pair.dot : pair.plain, "a")),
    choices: Object.freeze(forms.map(dot => he(written(t, pairId, dot ? ["dagesh", "patach"] : ["patach"])))), right: forms.indexOf(withDot), feedback: Object.freeze(forms.map(() => tell)) });
}
/** "Is this shin or sin?": a shin with its dot on the right or the left, and the two names. */
export function shinItem(alphabet: Alphabet, shin: boolean, rng: () => number): ChoiceItem | null {
  const t = table(alphabet), letter = t.letter("shin"), dot = t.mark(shin ? "shin-dot" : "sin-dot");
  if (!letter || !dot) return null;
  const names = shuffle([COPY.fluency.shin, COPY.fluency.sin], rng), name = shin ? COPY.fluency.shin : COPY.fluency.sin, char = letter.char + dot.mark;
  return Object.freeze({ key: `shin:${shin ? "shin" : "sin"}`, prompt: COPY.fluency.shinPrompt, stimulus: he(char), choices: Object.freeze(names.map(latin)), right: names.indexOf(name),
    feedback: Object.freeze(names.map(other => other === name ? right(char, name) : miss(name))) });
}

/** The questions of f1 to f4, in a seeded order. Every key is distinct, so a miss can come back by key. */
export function fluencyItems(lessonId: string, rng: () => number, alphabet: Alphabet = SERVICE_COURSE.alphabet): readonly ChoiceItem[] {
  const out: (ChoiceItem | null)[] = [];
  if (lessonId === "f1" || lessonId === "f2") {
    const known = lessonId === "f1" ? [...F1_LETTERS] : [...F1_LETTERS, ...F2_LETTERS], own = shuffle(LESSON_LETTERS[lessonId], rng).slice(0, PLAIN_ITEMS[lessonId]);
    const pairs = LOOKALIKES[lessonId];
    for (const id of own) out.push(letterNameItem(alphabet, id, known, rng, [...LOOKALIKES.f1, ...(lessonId === "f2" ? LOOKALIKES.f2 : [])]));
    for (const pair of pairs) out.push(lookAlikeItem(alphabet, pair, rng));
    if (lessonId === "f2") for (const final of alphabet.finals) out.push(finalItem(alphabet, final.id, rng));
  } else if (lessonId === "f3") {
    const taught = [...F1_LETTERS, ...F2_LETTERS];
    for (const form of VOWELS) out.push(vowelItem(alphabet, form, rng, taught));
  } else if (lessonId === "f4") {
    for (const pair of DOT_PAIRS) for (const withDot of [true, false]) out.push(dotItem(alphabet, pair.id, withDot, rng));
    out.push(shinItem(alphabet, true, rng), shinItem(alphabet, false, rng));
  }
  return Object.freeze(shuffle(out.filter((item): item is ChoiceItem => !!item), rng));
}

/** The review cards a fluency lesson plants when it is done (A4 4 "Cards"): its letters and finals, or its vowels. f4 to f6 plant none. */
export function fluencyCards(lessonId: string, alphabet: Alphabet = SERVICE_COURSE.alphabet): readonly string[] {
  if (lessonId === "f1" || lessonId === "f2") return [...LESSON_LETTERS[lessonId], ...(lessonId === "f2" ? alphabet.finals.map(row => row.id) : [])].map(letterCardId);
  if (lessonId === "f3") return VOWELS.filter(form => form.card).map(form => vowelCardId(form.id));
  return [];
}
/** The letters a learner has met, for a review's distractors: those with a card, never one a lesson has not shown yet. */
export const knownLetters = (cards: ReadonlySet<string>): string[] => [...F1_LETTERS, ...F2_LETTERS].filter(id => cards.has(letterCardId(id)));
/** The consonants a syllable may be built on in a review: letters the learner has cards for, or the one f3's Intro showed every vowel on. */
export const knownSyllableLetters = (cards: ReadonlySet<string>): string[] => { const known = knownLetters(cards).filter(id => SYLLABLE_LETTERS[id]); return known.length ? known : [SAMPLE_LETTER]; };
/** Every look-alike pair, for a review's choices: a partner only appears when the learner has that letter's card too. */
export const ALL_LOOKALIKES: readonly (readonly [string, string])[] = Object.freeze([...LOOKALIKES.f1, ...LOOKALIKES.f2]);
