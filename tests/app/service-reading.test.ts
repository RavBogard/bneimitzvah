import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { SERVICE_COURSE, SERVICE_TEXT_UNITS, lessonById } from "../../src/lib/service-course/course";
import { COPY } from "../../src/lib/service-course/copy";
import { toneProblems } from "../../src/lib/learn/tone";
import { CHECK_REASKS, answerCheck, checkDone, currentCheck, isDivine, seeded, startCheck, buildCheck } from "../../src/lib/service-course/check";
import { F1_LETTERS, F2_LETTERS, VOWELS, fluencyCards, fluencyIntro, fluencyItems, knownLetters, type ChoiceItem } from "../../src/lib/service-course/reading";
import { corpusWords, firstReadableLine, lineSteps, quickTenItems, wordSteps, wordsIn, QUICK_TEN, type QuickSource } from "../../src/lib/service-course/words";
import { dueCards, lessonCards, quickTenOpen, readLessonsDone, recordAnswer, reviewCards, reviewSummary, withLessonCards } from "../../src/lib/service-course/cards";
import { reviewItems, reviewUnits } from "../../src/lib/service-course/practice";
import { completeLesson, emptyProgress, parseProgress, serializeProgress, type Progress } from "../../src/lib/service-course/progress";
import type { ServiceText } from "../../src/lib/service-course/text";
import { SHMA_TR, SHMA_WORDS, SYNTHETIC_NAME, syntheticWord } from "../helpers/course-text";

const NOW = Date.parse("2026-10-24T12:00:00Z"), TODAY = "2026-10-24";
const credit = { title: "Shirei Tfilah", licence: "CC BY-NC-SA 4.0" };
/** A synthetic line: invented letters, transliteration that lines up one word for one word (invented too). */
const line = (seed: number, words = 5) => ({ he: Array.from({ length: words }, (_, i) => syntheticWord(seed * 10 + i, 3 + (i % 3))).join(" "), tr: Array.from({ length: words }, (_, i) => `sy${seed}x${i}`).join(" ") });
const textOf = (unit: string, seed: number, lines = 3): ServiceText => ({ unit, volume: "shabbat-shacharit", credit, lines: Array.from({ length: lines }, (_, i) => line(seed + i)) });
const SHMA_TEXT: ServiceText = { ...textOf("shma.the-shma@shabbat-shacharit", 1), lines: [{ he: SHMA_WORDS.join(" "), tr: SHMA_TR }, line(21), line(22)] };
const texts = (): Map<string, ServiceText> => new Map([...SERVICE_TEXT_UNITS].map((unit, i) => [unit, unit === SHMA_TEXT.unit ? SHMA_TEXT : textOf(unit, 30 + i * 4)] as const));
const f5 = lessonById("f5")!, f6 = lessonById("f6")!;
const strings = (value: unknown): string[] => typeof value === "string" ? [value] : value && typeof value === "object" ? Object.values(value).flatMap(strings) : [];
const done = (ids: readonly string[], start: Progress = emptyProgress()) => ids.reduce((p, id) => completeLesson(p, lessonById(id)!, NOW), start);

describe("the letters, vowels and dots of f1 to f4 (A4 4)", () => {
  it("hold the whole alphabet exactly once across f1 and f2, and every vowel the course writes", () => {
    expect([...F1_LETTERS, ...F2_LETTERS].sort()).toEqual(SERVICE_COURSE.alphabet.letters.map(row => row.id).sort());
    expect(F1_LETTERS).toHaveLength(11); expect(F2_LETTERS).toHaveLength(11);
    expect(fluencyCards("f1").length + fluencyCards("f2").length).toBe(22 + 5);
    expect(new Set([...fluencyCards("f1"), ...fluencyCards("f2")]).size).toBe(27);
    expect(VOWELS.map(form => form.id)).toEqual(["kamatz", "patach", "segol", "tzere", "chirik", "cholam", "kubutz", "shva", "shuruk", "cholam-male"]);
    expect(fluencyCards("f3")).toEqual(["vowel:kamatz:sound", "vowel:patach:sound", "vowel:segol:sound", "vowel:tzere:sound", "vowel:chirik:sound", "vowel:cholam:sound", "vowel:kubutz:sound", "vowel:shva:sound"]);
    for (const id of ["f4", "f5", "f6"]) expect(fluencyCards(id)).toEqual([]);
  });
  it("show each lesson's Intro first, with names, sounds and dot pairs, and none for the word and line lessons", () => {
    expect(fluencyIntro("f1")).toHaveLength(11);
    expect(fluencyIntro("f2")).toHaveLength(11 + 5);
    const vowels = fluencyIntro("f3")!;
    expect(vowels).toHaveLength(10); expect(vowels.find(row => row.key === "chirik")!.note).toBe("Chirik sounds like “ee”.");
    const dots = fluencyIntro("f4")!;
    expect(dots.find(row => row.key === "bet")!.note).toBe("The dot makes b. Without it, v.");
    expect(dots.map(row => row.label).slice(-2)).toEqual(["Shin", "Sin"]);
    expect(fluencyIntro("f5")).toBeNull(); expect(fluencyIntro("f6")).toBeNull();
  });
  it("ask 8 to 16 questions each, every key distinct, three choices (two for look-alikes, dots and shin or sin), one right, one line said per choice", () => {
    for (const [id, min, max] of [["f1", 11, 16], ["f2", 11, 16], ["f3", 8, 16], ["f4", 8, 16]] as const) for (let seed = 1; seed <= 40; seed++) {
      const items = fluencyItems(id, seeded(seed));
      expect(items.length, `${id} ${seed}`).toBeGreaterThanOrEqual(min); expect(items.length).toBeLessThanOrEqual(max);
      expect(new Set(items.map(item => item.key)).size, `${id} ${seed} keys`).toBe(items.length);
      for (const item of items) {
        expect(item.choices.length).toBeGreaterThanOrEqual(2); expect(item.choices.length).toBeLessThanOrEqual(3);
        expect(new Set(item.choices.map(choice => choice.text)).size, item.key).toBe(item.choices.length);
        expect(item.right).toBeGreaterThanOrEqual(0); expect(item.right).toBeLessThan(item.choices.length);
        expect(item.feedback, item.key).toHaveLength(item.choices.length);
      }
    }
  });
  it("name only what the lessons so far have shown", () => {
    const names = (ids: readonly string[]) => new Set(ids.map(id => SERVICE_COURSE.alphabet.letters.find(row => row.id === id)!.name));
    for (let seed = 1; seed <= 40; seed++) {
      const one = names(F1_LETTERS), two = names([...F1_LETTERS, ...F2_LETTERS]);
      for (const item of fluencyItems("f1", seeded(seed))) if (item.key.startsWith("letter:")) for (const choice of item.choices) expect(one.has(choice.text), `${seed} ${choice.text}`).toBe(true);
      for (const item of fluencyItems("f2", seeded(seed))) if (item.stimulus && item.key.startsWith("letter:")) for (const choice of item.choices) expect(two.has(choice.text), `${seed} ${choice.text}`).toBe(true);
      // The look-alike partners of f1 are f1's own letters: a pair waits until both letters have been shown.
      for (const item of fluencyItems("f1", seeded(seed))) if (item.key.startsWith("look:")) expect(item.key).toMatch(/^look:(?:bet-kaf|vav-zayin|hei-chet):/);
    }
  });
  it("never ask same or different, anywhere in the strand's questions or strings", () => {
    for (const id of ["f1", "f2", "f3", "f4"]) for (let seed = 1; seed <= 20; seed++) for (const item of fluencyItems(id, seeded(seed))) {
      expect(item.prompt, item.key).not.toMatch(/\bsame\b|\bdifferent\b/i);
      for (const said of item.feedback) expect(said, item.key).not.toMatch(/\bsame\b|\bdifferent\b/i);
    }
    expect(strings(COPY).join(" ")).not.toMatch(/\bsame\b|\bdifferent\b/i);
  });
  it("say after each choice only the approved shapes, and never a score, a count or a pep line", () => {
    const said = new Set<string>();
    for (const id of ["f1", "f2", "f3", "f4"]) for (let seed = 1; seed <= 12; seed++) for (const item of fluencyItems(id, seeded(seed))) for (const line of [item.prompt, ...item.feedback]) said.add(line);
    for (const line of said) {
      expect(toneProblems(line), line).toEqual([]);
      expect(line, line).not.toMatch(/\d+ (?:of|out of) \d+|score|correct|streak|point/i);
      expect(line, line).toMatch(/^(?:Which letter is this\?|These two look alike\. Which one is .+\?|This letter comes only at the end of a word\. Which letter is it\?|Which sound does this make\?|With the dot or without it\?|Is this shin or sin\?|Yes\. .+ is .+\.|That one is .+\.|.+ sounds like “.+”\.|The dot makes .+\. Without it, .+\.)$/);
    }
  });
  it("hold no Hebrew in any source file of the strand: every character is composed from the alphabet table", () => {
    for (const file of ["reading", "words", "cards", "practice"]) expect(readFileSync(`src/lib/service-course/${file}.ts`, "utf8"), file).not.toMatch(/[֐-׿]/);
    for (const file of ["fluency", "practice", "frame"]) expect(readFileSync(`src/components/learn/service/${file}.tsx`, "utf8"), file).not.toMatch(/[֐-׿]/);
  });
});

describe("words and lines from the public text (f5, f6)", () => {
  const all = texts();
  it("take f5's words from every unit in turn, never the divine name, each with a transliteration that lines up", () => {
    for (let seed = 1; seed <= 30; seed++) {
      const steps = wordSteps(f5.corpus!, all, seeded(seed));
      expect(steps.filter(step => step.kind === "word")).toHaveLength(5);
      expect(steps.filter(step => step.kind === "item")).toHaveLength(5);
      expect(new Set(steps.map(step => step.key)).size).toBe(steps.length);
      expect(new Set(steps.flatMap(step => step.kind === "word" ? [step.word.unit] : [])).size).toBeGreaterThanOrEqual(2);
      for (const step of steps) {
        if (step.kind === "word") { expect(step.word.translit).toBeTruthy(); expect(isDivine(step.word.he)).toBe(false); }
        if (step.kind === "item") { expect(step.item.choices).toHaveLength(3); expect(step.item.prompt).toMatch(/^Which word says .+\?$/); expect(step.item.choices.some(choice => isDivine(choice.text))).toBe(false); }
      }
    }
  });
  it("find f6's lines: the first line of each unit whose transliteration lines up, two to fourteen words, and skip a unit with none", () => {
    const steps = lineSteps(f6.corpus!, all, seeded(3));
    expect(steps.filter(step => step.kind === "line")).toHaveLength(3);
    for (const step of steps) if (step.kind === "line") { expect(step.he.length).toBe(step.tr.length); expect(step.he.length).toBeGreaterThanOrEqual(2); }
    const unaligned = new Map(all); unaligned.set("shma.barchu@shabbat-shacharit", { ...textOf("shma.barchu@shabbat-shacharit", 5), lines: [{ he: line(9).he, tr: "one two" }, { he: line(10).he }] });
    expect(lineSteps(f6.corpus!, unaligned, seeded(3)).filter(step => step.kind === "line")).toHaveLength(2);
    expect(firstReadableLine(textOf("x.y@shabbat-shacharit", 1, 1), [0, 0])).not.toBeNull();
    expect(firstReadableLine({ ...textOf("x.y@shabbat-shacharit", 1, 1), lines: [{ he: syntheticWord(1) }] }, [0, 0])).toBeNull();
    expect(wordsIn(SHMA_TEXT, [0, 0]).find(word => word.translit === "Adonai")).toBeTruthy();
    expect(corpusWords(f5.corpus!, all).some(word => isDivine(word.he))).toBe(false);
  });
  it("give no steps, rather than a broken lesson, when the text yields too few words", () => {
    const thin = new Map(f5.corpus!.map(entry => [entry.unit, { ...textOf(entry.unit, 1, 1), lines: [{ he: SYNTHETIC_NAME + " " + syntheticWord(1), tr: "Adonai one" }] }] as const));
    expect(wordSteps(f5.corpus!, thin, seeded(1))).toEqual([]);
    expect(lineSteps(f6.corpus!, new Map(), seeded(1))).toEqual([]);
  });
  it("bring a line marked Not yet back once, and a missed question back at most twice", () => {
    const steps = lineSteps(f6.corpus!, all, seeded(4));
    let run = startCheck(steps); const first = currentCheck(run)!;
    expect(first.kind).toBe("line");
    run = answerCheck(run, false, seeded(1), { reasks: 1 });
    expect(run.queue.filter(step => step.key === first.key)).toHaveLength(2);
    while (!checkDone(run)) run = answerCheck(run, currentCheck(run)!.key !== first.key ? true : false, seeded(2), { reasks: 1 });
    expect(run.queue.filter(step => step.key === first.key)).toHaveLength(2);
    expect(CHECK_REASKS).toBe(2);
  });
});

describe("cards (A4 8.1)", () => {
  it("plant a lesson's cards in box 1, due tomorrow, when it is done; a prayer with a Check plants a reading and a meaning card", () => {
    expect(lessonCards(lessonById("f1")!)).toHaveLength(11);
    expect(lessonCards(lessonById("shma")!)).toEqual(["word:shma:read", "word:shma:meaning"]);
    for (const id of ["torah-reading", "commentary", "psukei-dzimrah", "mi-shebeirach", "f4", "f5", "f6"]) expect(lessonCards(lessonById(id)!), id).toEqual([]);
    const progress = done(["f1", "shma"]);
    expect(Object.keys(progress.cards)).toHaveLength(13);
    expect(progress.cards["letter:alef:name"]).toEqual({ box: 1, due: "2026-10-25" });
    expect(progress.cards["word:shma:read"]).toEqual({ box: 1, due: "2026-10-25" });
  });
  it("let a lesson finished before cards existed plant them on its next Done, and never move a card that is there", () => {
    const old: Progress = Object.freeze({ ...emptyProgress(), lessons: Object.freeze({ shma: Object.freeze({ done: "2026-10-01T00:00:00.000Z" }) }) });
    const again = completeLesson(old, lessonById("shma")!, NOW);
    expect(again.lessons.shma.done).toBe("2026-10-01T00:00:00.000Z");
    expect(Object.keys(again.cards)).toEqual(["word:shma:read", "word:shma:meaning"]);
    const moved = recordAnswer(again, "word:shma:read", true, TODAY);
    expect(completeLesson(moved, lessonById("shma")!, NOW + 1e9).cards["word:shma:read"]).toEqual(moved.cards["word:shma:read"]);
    expect(withLessonCards(again, lessonById("shma")!, NOW)).toBe(again);
  });
  it("hold the whole course's cards inside the stored limits, and survive the strict parse", () => {
    const everything = done(SERVICE_COURSE.lessons.map(lesson => lesson.id));
    expect(Object.keys(everything.cards).length).toBeLessThanOrEqual(250);
    expect(Object.keys(everything.cards)).toHaveLength(27 + 8 + 2 * SERVICE_COURSE.lessons.filter(lesson => lesson.read && lesson.check).length);
    const text = serializeProgress(everything)!;
    expect(parseProgress(JSON.parse(text))!.cards).toEqual(everything.cards);
  });
  it("move one box up per run however often a card is right, drop two on a miss, and ignore a card the learner has not got", () => {
    const start = done(["f1"]), moved = new Set<string>();
    const up = recordAnswer(start, "letter:alef:name", true, TODAY, moved);
    expect(up.cards["letter:alef:name"].box).toBe(2);
    expect(recordAnswer(up, "letter:alef:name", true, TODAY, moved)).toBe(up);
    expect(recordAnswer(up, "letter:alef:name", false, TODAY, moved).cards["letter:alef:name"]).toEqual({ box: 0, due: TODAY });
    expect(recordAnswer(start, "letter:lamed:name", true, TODAY)).toBe(start);
  });
  it("count what is due and draw the review from it: up to twelve, in a seeded order, none when nothing is due", () => {
    const progress = done(["f1", "f2", "f3"]);
    expect(dueCards(progress, TODAY)).toEqual([]);
    expect(reviewSummary(progress, TODAY)).toBeNull();
    const later = dueCards(progress, "2026-10-26");
    expect(later).toHaveLength(22 + 5 + 8);
    expect(reviewSummary(progress, "2026-10-26")).toEqual({ cards: 35, minutes: 2 });
    expect(reviewCards(progress, "2026-10-26", seeded(1))).toHaveLength(12);
    expect(reviewCards(progress, "2026-10-26", seeded(1))).not.toEqual(reviewCards(progress, "2026-10-26", seeded(2)));
    expect(reviewCards(progress, TODAY, seeded(1))).toEqual([]);
    expect(reviewSummary(done(["f2"]), "2026-10-26")).toEqual({ cards: 16, minutes: 2 });
  });
  it("build a review question for every kind of card, among letters the learner has", () => {
    const progress = done(["f1", "f2", "f3", "shma", "barchu"]), cards = Object.keys(progress.cards), owned = new Set(cards);
    const all = texts();
    for (let seed = 1; seed <= 10; seed++) {
      const items = reviewItems(cards, owned, all, seeded(seed));
      expect(items.length).toBe(cards.length);
      for (const item of items) {
        expect(item.card).toBe(item.key); expect(cards).toContain(item.key);
        expect(item.choices.length).toBeGreaterThanOrEqual(2); expect(item.feedback).toHaveLength(item.choices.length);
        if (item.key.startsWith("letter:")) for (const choice of item.choices.filter(c => !c.he)) expect(choice.text).toMatch(/^(?:Final )?[A-Z]/);
      }
    }
    expect(reviewUnits(cards).sort()).toEqual(["shma.barchu@shabbat-shacharit", "shma.the-shma@shabbat-shacharit"]);
    // A word card whose text did not give a question is left out, not invented.
    expect(reviewItems(["word:shma:read"], new Set(), new Map(), seeded(1))).toEqual([]);
    // A learner who has only f2 can still be asked a letter: the choices come from letters they hold, never one not yet shown.
    const only = done(["f2"]), items = reviewItems(Object.keys(only.cards).filter(id => id.startsWith("letter:l")), new Set(Object.keys(only.cards)), new Map(), seeded(3));
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) for (const choice of item.choices.filter(c => !c.he)) expect(knownLetters(new Set(Object.keys(only.cards))).concat(["final"]).length).toBeGreaterThan(0), expect(choice.text).not.toBe("Alef");
  });
});

describe("Quick ten (A4 8.4)", () => {
  const sources = (n: number): QuickSource[] => ["shma", "barchu", "vahavta", "torah-before"].slice(0, n).map((id, i) => {
    const read = lessonById(id)!.read!;
    return { lessonId: id, unit: read.unit, blocks: read.blocks, text: i === 0 ? SHMA_TEXT : textOf(read.unit, 40 + i * 5) };
  });
  it("opens after three prayers with a Read step are done, or after f6, and not for moments, lessons with no text, or fewer", () => {
    expect(quickTenOpen(emptyProgress())).toBe(false);
    expect(quickTenOpen(done(["shma", "vahavta"]))).toBe(false);
    expect(quickTenOpen(done(["shma", "vahavta", "torah-reading", "commentary", "psukei-dzimrah", "mi-shebeirach"]))).toBe(false);
    expect(readLessonsDone(done(["shma", "torah-reading"])).map(lesson => lesson.id)).toEqual(["shma"]);
    expect(quickTenOpen(done(["shma", "vahavta", "barchu"]))).toBe(true);
    expect(quickTenOpen(done(["f1", "f2", "f3", "f4", "f5"]))).toBe(false);
    expect(quickTenOpen(done(["f6"]))).toBe(true);
  });
  it("asks ten reading questions only, each naming a word by its transliteration among three Hebrew words, never the divine name", () => {
    for (let seed = 1; seed <= 25; seed++) {
      const items = quickTenItems(sources(3), seeded(seed));
      expect(items).toHaveLength(QUICK_TEN.items);
      expect(new Set(items.map(item => item.key)).size).toBe(items.length);
      for (const item of items) {
        expect(item.prompt).toMatch(/^Which says .+\?$/);
        expect(item.choices).toHaveLength(3); expect(item.choices.every(choice => choice.he)).toBe(true);
        expect(item.stimulus).toBeUndefined();
        expect(item.choices.some(choice => isDivine(choice.text))).toBe(false);
        expect(item.card).toMatch(/^word:(?:shma|barchu|vahavta):read$/);
        expect(item.context!.he).toContain(item.choices[item.right].text.replace(/[^א-תְ-ׇ ]/g, ""));
      }
    }
  });
  it("brings a miss back after the ten, takes its words from the strand's own lines when only f6 is done, and moves no card for them", () => {
    const items = quickTenItems(sources(2), seeded(5)); let run = startCheck(items);
    run = answerCheck(run, false, seeded(1), { at: "end" });
    expect(run.queue.at(-1)!.key).toBe(items[0].key); expect(run.queue).toHaveLength(items.length + 1);
    const strand = f6.corpus!.map(entry => ({ lessonId: null, unit: entry.unit, blocks: entry.blocks, text: texts().get(entry.unit)! }));
    for (const item of quickTenItems(strand, seeded(2))) expect(item.card).toBeUndefined();
    expect(quickTenItems([], seeded(1))).toEqual([]);
  });
  it("shows no counter, score or tally in any string it can say", () => {
    const said = new Set(quickTenItems(sources(3), seeded(9)).flatMap(item => [item.prompt, ...item.feedback]));
    for (const line of [...said, ...strings(COPY.quickTen), ...strings(COPY.review)]) { expect(toneProblems(line), line).toEqual([]); expect(line, line).not.toMatch(/\d+ (?:of|out of) \d+|score|correct|tally/i); }
    expect(COPY.quickTen.empty).toBe("Quick ten opens after three prayers you have read.");
  });
});

describe("the Check's divine-name rule (the Adonai flake)", () => {
  it("never makes a reading question of the divine name, and says Adonai in a prompt only through an approved gloss", () => {
    const shma = lessonById("shma")!, glosses = new Set(shma.keyWords.map(word => word.gloss));
    for (let seed = 1; seed <= 300; seed++) for (const item of buildCheck(shma, SHMA_TEXT, seeded(seed))) {
      if (item.kind === "says") {
        expect(item.target.translit).not.toBe("Adonai");
        expect(item.choices.some(choice => choice.translit === "Adonai" || isDivine(choice.he))).toBe(false);
        expect(COPY.check.whichSays.replace("{translit}", item.target.translit ?? "")).not.toContain("Adonai");
      } else if (item.kind === "means-word") {
        // Which word means "God's name, said as Adonai": the prompt is the approved gloss, and its choices are Hebrew words, so it gives nothing away.
        expect(glosses.has(item.target.gloss)).toBe(true);
        expect(item.choices.filter(choice => choice.gloss === item.target.gloss)).toHaveLength(1);
      }
    }
  });
});
