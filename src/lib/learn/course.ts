import raw from "./lessons.json";
import { PHRASE_FAMILIES, type FamilyId } from "../trope/chart-catalog";
import { toneProblems } from "./tone";

/**
 * The Learn to lein course (Cowork's lessons.json), parsed and validated once at module load. A
 * malformed course throws here, so a bad edit fails the build and the tests, never a learner's page.
 * The repo copy carries no field derived from the private PocketTorah index (plan, Decided 1).
 */
export const COURSE_SCHEMA = "learn-to-lein-course/v1" as const;
export type Melody = "torah" | "haftarah";
export const MELODIES: readonly Melody[] = Object.freeze(["torah", "haftarah"]);
export type Skill = "name" | "find" | "end";
export const SKILLS: readonly Skill[] = Object.freeze(["name", "find", "end"]);
export const FAMILY_IDS: readonly FamilyId[] = Object.freeze(PHRASE_FAMILIES.map(family => family.id));
/** The ten Torah families; the haftarah path adds the end-of-haftarah context as an eleventh. */
export const MELODY_FAMILIES: Readonly<Record<Melody, readonly FamilyId[]>> = Object.freeze({
  torah: Object.freeze(FAMILY_IDS.filter(id => id !== "sof-haftarah")),
  haftarah: FAMILY_IDS,
});
/** The engine's unitTrope ids (trope/melody.mjs), the spelling examples and build patterns use. */
export const TROPE_IDS = Object.freeze(["silluq", "mercha", "tipcha", "etnachta", "munach", "zakef-katan", "pashta", "mahpach", "kadma", "yetiv", "revia",
  "munach-legarmeh", "tevir", "darga", "mercha-kefula", "geresh", "gershayim", "zakef-gadol", "telisha-ketana", "telisha-gedola", "pazer", "zarka", "segol",
  "shalshelet", "yerach-ben-yomo", "karnei-farah"] as const);
export type TropeId = typeof TROPE_IDS[number];
/** Lesson accents use the chart catalogue's spellings; these are the two that differ. */
const ACCENT_ALIASES: Readonly<Record<string, TropeId>> = Object.freeze({ merkha: "mercha", "karnei-para": "karnei-farah" });

export type ExamplePhrase = Readonly<{ family: FamilyId; words: readonly [number, number] }>;
export type Example = Readonly<{ ref: string; words: readonly [number, number]; firstWord: string; lastWord: string; why: string;
  tropes?: readonly TropeId[]; phrases?: readonly ExamplePhrase[] }>;
/** `mode: "read"` (N18, mark to sound): the phrase is shown as text and no recording plays until the learner has picked a tune. */
export type HearAndName = Readonly<{ type: "hear-and-name"; params: Readonly<{ families: readonly FamilyId[]; items: number; choices: number; weight: Readonly<Partial<Record<FamilyId, number>>>; label?: string; mode?: "read" }> }>;
export type SameOrDifferent = Readonly<{ type: "same-or-different"; params: Readonly<{ families: readonly FamilyId[]; items: number; melodies?: readonly Melody[]; label?: string }> }>;
export type WhereDoesItEnd = Readonly<{ type: "where-does-it-end"; params: Readonly<{ families: readonly FamilyId[]; items: number; audio: boolean; prompt?: string; verseWords: readonly [number, number] }> }>;
export type TapThePhrase = Readonly<{ type: "tap-the-phrase"; params: Readonly<{ families: readonly FamilyId[]; items: number; verseWords: readonly [number, number] }> }>;
export type BuildThePhrase = Readonly<{ type: "build-the-phrase"; params: Readonly<{ family: FamilyId; items: number; patterns: readonly (readonly TropeId[])[]; extraMarks: number }> }>;
export type ThisWeek = Readonly<{ type: "this-week"; params: Readonly<{ family: FamilyId; kind?: Melody; show: number; find: number }> }>;
export type FirstVerse = Readonly<{ type: "first-verse"; params: Readonly<{ kind: Melody; maxWords: number; steps: readonly FirstVerseStep[]; celebrate: boolean; openInLein: boolean }> }>;
export type FirstVerseStep = "phrases" | "whole" | "along-0.75" | "along-1";
/** 1.6: Same sign, different place. Two words carrying look-alike signs; read them (or hear one) and tap. */
export type LookAlikes = Readonly<{ type: "look-alikes"; params: Readonly<{ pairs: readonly LookAlikePairId[]; items: number; mode: "read" | "hear" }> }>;
/** 1.6: Which half of the verse. The verse plays from its start up to one phrase (ruling 2026-10-23); before or after the rest? */
export type WhichHalf = Readonly<{ type: "which-half"; params: Readonly<{ families: readonly FamilyId[]; items: number; audio: "lead-in" | "phrase"; verseWords: readonly [number, number] }> }>;
/** 1.6: Quick ten. Hear-and-name items one after another, over the families heard; a practice run, never inside a lesson. */
export type QuickTen = Readonly<{ type: "quick-ten"; params: Readonly<{ families: "heard"; items: number; choices: number; autoAdvanceMs: number }> }>;
export type Activity = HearAndName | SameOrDifferent | WhereDoesItEnd | TapThePhrase | BuildThePhrase | LookAlikes | WhichHalf | ThisWeek | FirstVerse;
/** The drills a lesson scores and repeats; this-week and first-verse are not scored. */
export type Drill = HearAndName | SameOrDifferent | WhereDoesItEnd | TapThePhrase | BuildThePhrase | LookAlikes | WhichHalf;
export const DRILL_TYPES = Object.freeze(["hear-and-name", "same-or-different", "where-does-it-end", "tap-the-phrase", "build-the-phrase", "look-alikes", "which-half"] as const);
export const isDrill = (activity: Activity): activity is Drill => (DRILL_TYPES as readonly string[]).includes(activity.type);
/** Which review card a drill answers. Look-alikes and which-half teach marks and halves, not families, so they answer none. */
export const drillSkill = (activity: Drill): Skill | null => activity.type === "look-alikes" || activity.type === "which-half" ? null
  : activity.type === "tap-the-phrase" ? "find" : activity.type === "where-does-it-end" ? "end" : "name";
/** Drills that always run, even after eight right in a row has let a lesson's other drills go: each is the lesson's one look at its skill. */
export const ALWAYS_RUN: ReadonlySet<Drill["type"]> = new Set<Drill["type"]>(["look-alikes", "which-half"]);

/** The look-alike signs (ACTIVITIES.md #9). Azla and geresh are one stroke; the word before decides which it is. */
export const LOOK_ALIKE_MARKS = Object.freeze(["pashta", "kadma", "mahpach", "yetiv", "azla", "geresh"] as const);
export type LookAlikeMark = typeof LOOK_ALIKE_MARKS[number];
export const LOOK_ALIKE_PAIRS = Object.freeze({
  "pashta-kadma": ["pashta", "kadma"], "mahpach-yetiv": ["mahpach", "yetiv"], "kadma-azla": ["kadma", "azla"], "azla-geresh": ["azla", "geresh"],
} as const satisfies Record<string, readonly [LookAlikeMark, LookAlikeMark]>);
export type LookAlikePairId = keyof typeof LOOK_ALIKE_PAIRS;
/** Daniel, 2026-10-23: azla against geresh is a reading-only item, with no listening version, now or later. */
export const READING_ONLY_PAIRS: ReadonlySet<LookAlikePairId> = new Set<LookAlikePairId>(["azla-geresh"]);
export type LookAlikeWord = Readonly<{ ref: string; word: number; text: string; mark: LookAlikeMark }>;
export type LookAlikeExample = Readonly<{ a: LookAlikeWord; b: LookAlikeWord; melody: Melody; why: string; hard: boolean }>;
export type LookAlikePair = Readonly<{ id: LookAlikePairId; title: string; marks: readonly [LookAlikeMark, LookAlikeMark]; context: "word" | "previous-word"; examples: readonly LookAlikeExample[] }>;
export type Practice = Readonly<{ id: string; melody: Melody; title: string; summary: string; unlockAfter: string; activity: QuickTen }>;
const TORAH_BOOKS = Object.freeze(["Genesis", "Exodus", "Leviticus", "Numbers", "Deuteronomy"]);
/** A verse's tune by its book: the five books are read in the Torah melody, every other book in the haftarah melody. */
export const melodyOfRef = (ref: string): Melody => TORAH_BOOKS.includes(ref.replace(/ \d+:\d+$/, "")) ? "torah" : "haftarah";

export type Lesson = Readonly<{ id: string; melody: Melody; family: FamilyId | null; accents: readonly TropeId[]; title: string; summary: string; goal: string;
  body: readonly string[]; listenFor: string; examples: readonly Example[]; activities: readonly Activity[]; prerequisites: readonly string[] }>;
export type CourseUnit = Readonly<{ id: string; melody: Melody; title: string; summary: string; lessons: readonly string[] }>;
export type Course = Readonly<{ schema: typeof COURSE_SCHEMA; families: Readonly<Record<FamilyId, Readonly<{ name: string; confusedWith: readonly FamilyId[] }>>>;
  units: readonly CourseUnit[]; lessons: readonly Lesson[]; lookAlikes: Readonly<Record<LookAlikePairId, LookAlikePair>>; practice: readonly Practice[] }>;

export class CourseError extends Error {
  constructor(readonly problems: readonly string[]) { super(`Learn to lein course is invalid: ${problems.slice(0, 5).join("; ")}`); }
}
const BODY_WORDS = 130;
const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const integer = (value: unknown, min: number, max: number): value is number => Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max;
const REF = /^(?:I{1,2} )?[A-Z][a-z]+(?: [A-Z][a-z]+)* [1-9]\d{0,2}:[1-9]\d{0,2}$/;

/** A build pattern ("mahpach-pashta-zakef-katan") split into trope ids, longest id first; null if it is not one. */
export function parsePattern(pattern: string): TropeId[] | null {
  const ids = [...TROPE_IDS].sort((a, b) => b.length - a.length), out: TropeId[] = [];
  let rest = pattern;
  while (rest) {
    const id = ids.find(candidate => rest === candidate || rest.startsWith(`${candidate}-`));
    if (!id) return null;
    out.push(id); rest = rest.slice(id.length + 1);
  }
  return out.length ? out : null;
}
/** "After this you can hear ..." as the end-of-lesson line: "You can hear ...". */
export function presentGoal(goal: string): string {
  const rest = goal.replace(/^After this\s+/, "");
  return rest.charAt(0).toUpperCase() + rest.slice(1);
}

/** Parse and check the whole course; every problem is collected, then thrown together. */
export function validateCourse(value: unknown): Course {
  const problems: string[] = [];
  const fail = (message: string) => { problems.push(message); };
  if (!isObject(value)) throw new CourseError(["not an object"]);
  if (value.schema !== COURSE_SCHEMA) fail("schema id");
  const strings: [string, string][] = [];
  const text = (where: string, field: unknown, max = 400): string => {
    if (typeof field !== "string" || !field.trim() || field.length > max || field !== field.normalize("NFC")) { fail(`${where}: text`); return ""; }
    strings.push([where, field]); return field;
  };
  // Families: exactly the chart's eleven ids, each confusable neighbour one of them.
  const families = {} as Record<FamilyId, { name: string; confusedWith: FamilyId[] }>;
  if (!isObject(value.families) || Object.keys(value.families).length !== FAMILY_IDS.length || FAMILY_IDS.some(id => !Object.hasOwn(value.families as object, id))) fail("families are not the chart's eleven ids");
  else for (const id of FAMILY_IDS) {
    const row = (value.families as Record<string, unknown>)[id];
    if (!isObject(row) || !Array.isArray(row.confusedWith) || row.confusedWith.some(other => !FAMILY_IDS.includes(other as FamilyId) || other === id)) { fail(`family ${id}`); continue; }
    families[id] = { name: text(`family ${id}`, row.name, 40), confusedWith: row.confusedWith as FamilyId[] };
  }
  const lookAlikes = parseLookAlikes(value.lookAlikes, fail, text);
  const lessons: Lesson[] = [];
  const ids = new Set<string>();
  if (!Array.isArray(value.lessons) || value.lessons.length < 1 || value.lessons.length > 64) throw new CourseError([...problems, "lessons"]);
  for (const [n, row] of value.lessons.entries()) {
    if (!isObject(row) || typeof row.id !== "string" || !/^[a-z][a-z0-9-]{1,40}$/.test(row.id)) { fail(`lesson ${n}: id`); continue; }
    const where = `lesson ${row.id}`;
    if (ids.has(row.id)) fail(`${where}: duplicate id`); ids.add(row.id);
    if (!MELODIES.includes(row.melody as Melody)) fail(`${where}: melody`);
    const melody = row.melody as Melody;
    const family = row.family === null ? null : FAMILY_IDS.includes(row.family as FamilyId) ? row.family as FamilyId : (fail(`${where}: family`), null);
    if (family === "sof-haftarah" && melody !== "haftarah") fail(`${where}: sof-haftarah outside the haftarah path`);
    const accents = Array.isArray(row.accents) ? row.accents.map(accent => {
      const id = ACCENT_ALIASES[accent as string] ?? accent;
      if (!(TROPE_IDS as readonly string[]).includes(id as string)) fail(`${where}: accent ${String(accent)}`);
      return id as TropeId;
    }) : (fail(`${where}: accents`), []);
    const body = Array.isArray(row.body) && row.body.length >= 1 && row.body.length <= 6 ? row.body.map((p, i) => text(`${where} body ${i}`, p, 1200)) : (fail(`${where}: body`), []);
    if (body.join(" ").split(/\s+/).filter(Boolean).length > BODY_WORDS) fail(`${where}: body longer than ${BODY_WORDS} words`);
    const goal = text(`${where} goal`, row.goal, 240);
    if (goal && !/^After this you (?:can|have) /.test(goal)) fail(`${where}: goal does not start "After this you can"`);
    const examples: Example[] = !Array.isArray(row.examples) || row.examples.length < 1 || row.examples.length > 8 ? (fail(`${where}: examples`), []) : row.examples.map((example, i) => {
      const at = `${where} example ${i}`;
      if (!isObject(example) || typeof example.ref !== "string" || !REF.test(example.ref)) { fail(`${at}: ref`); return null; }
      const words = example.words;
      if (!Array.isArray(words) || words.length !== 2 || !integer(words[0], 0, 120) || !integer(words[1], words[0] as number, 120) || (words[1] as number) - (words[0] as number) > 40) { fail(`${at}: words`); return null; }
      const known = ["ref", "words", "firstWord", "lastWord", "why", "tropes", "phrases"];
      if (Object.keys(example).some(key => !known.includes(key))) fail(`${at}: unknown field`);
      const out: { ref: string; words: [number, number]; firstWord: string; lastWord: string; why: string; tropes?: TropeId[]; phrases?: ExamplePhrase[] } = {
        ref: example.ref, words: [words[0] as number, words[1] as number], firstWord: text(`${at} firstWord`, example.firstWord, 80), lastWord: text(`${at} lastWord`, example.lastWord, 80), why: text(`${at} why`, example.why, 240) };
      if (example.tropes !== undefined) {
        if (!Array.isArray(example.tropes) || example.tropes.length !== out.words[1] - out.words[0] + 1 || example.tropes.some(t => !(TROPE_IDS as readonly string[]).includes(t as string))) fail(`${at}: tropes`);
        else out.tropes = example.tropes as TropeId[];
      }
      if (example.phrases !== undefined) {
        const phrases = example.phrases;
        if (!Array.isArray(phrases) || !phrases.length) { fail(`${at}: phrases`); return out; }
        let next = out.words[0];
        out.phrases = phrases.map(phrase => {
          if (!isObject(phrase) || !FAMILY_IDS.includes(phrase.family as FamilyId) || !Array.isArray(phrase.words) || phrase.words[0] !== next || !integer(phrase.words[1], next, out.words[1])) fail(`${at}: phrase list`);
          next = Array.isArray(phrase?.words) ? Number(phrase.words[1]) + 1 : next;
          return { family: phrase.family as FamilyId, words: [Number(phrase.words[0]), Number(phrase.words[1])] as const };
        });
        if (next !== out.words[1] + 1) fail(`${at}: phrases do not span the example`);
      }
      if (family && !out.tropes) fail(`${at}: a family example needs tropes`);
      if (!family && !out.phrases) fail(`${at}: a whole-verse example needs phrases`);
      return out;
    }).filter((example): example is NonNullable<typeof example> => example !== null);
    // An orientation lesson (no family) may have no activities at all: it is Hear it and In verses, then Done (N17a).
    const activities = Array.isArray(row.activities) && row.activities.length >= (family === null ? 0 : 1) && row.activities.length <= 8 ? row.activities.flatMap((activity, i) => {
      const parsed = parseActivity(activity, family, melody, lookAlikes, message => fail(`${where} activity ${i}: ${message}`));
      return parsed ? [parsed] : [];
    }) : (fail(`${where}: activities`), []);
    for (const activity of activities) for (const [key, label] of [["label", "label"], ["prompt", "prompt"]] as const) {
      const value = (activity.params as Record<string, unknown>)[key]; if (value !== undefined) text(`${where} ${activity.type} ${label}`, value, 80);
    }
    const drillItems = activities.filter(isDrill).reduce((sum, activity) => sum + activity.params.items, 0);
    if (activities.some(isDrill) && (drillItems < 8 || drillItems > 22)) fail(`${where}: drills plan ${drillItems} items`);
    const prerequisites = Array.isArray(row.prerequisites) && row.prerequisites.every(p => typeof p === "string") ? row.prerequisites as string[] : (fail(`${where}: prerequisites`), []);
    lessons.push(Object.freeze({ id: row.id, melody, family, accents: Object.freeze(accents), title: text(`${where} title`, row.title, 60), summary: text(`${where} summary`, row.summary, 60),
      goal, body: Object.freeze(body), listenFor: text(`${where} listenFor`, row.listenFor, 300), examples: Object.freeze(examples), activities: Object.freeze(activities), prerequisites: Object.freeze(prerequisites) }));
  }
  // Units: every lesson in exactly one, in its own melody's path.
  const units: CourseUnit[] = [];
  const placed = new Map<string, string>();
  if (!Array.isArray(value.units) || !value.units.length) fail("units");
  else for (const row of value.units) {
    if (!isObject(row) || typeof row.id !== "string" || !MELODIES.includes(row.melody as Melody) || !Array.isArray(row.lessons) || !row.lessons.length) { fail("unit shape"); continue; }
    for (const id of row.lessons) {
      if (typeof id !== "string" || !ids.has(id)) { fail(`unit ${row.id}: unknown lesson ${String(id)}`); continue; }
      if (placed.has(id)) fail(`lesson ${id} is in two units`); placed.set(id, row.id);
      if (lessons.find(lesson => lesson.id === id)?.melody !== row.melody) fail(`unit ${row.id}: lesson ${id} in the other path`);
    }
    units.push(Object.freeze({ id: row.id, melody: row.melody as Melody, title: text(`unit ${row.id} title`, row.title, 60), summary: text(`unit ${row.id} summary`, row.summary, 160), lessons: Object.freeze(row.lessons as string[]) }));
  }
  for (const id of ids) if (!placed.has(id)) fail(`lesson ${id} is in no unit`);
  // Prerequisites exist and form no cycle.
  const byId = new Map(lessons.map(lesson => [lesson.id, lesson]));
  for (const lesson of lessons) for (const p of lesson.prerequisites) if (!byId.has(p)) fail(`lesson ${lesson.id}: unknown prerequisite ${p}`);
  const state = new Map<string, "open" | "done">();
  const visit = (id: string, trail: string[]): void => {
    if (state.get(id) === "done") return;
    if (state.get(id) === "open") { fail(`prerequisite cycle ${[...trail, id].join(" > ")}`); return; }
    state.set(id, "open"); for (const p of byId.get(id)?.prerequisites ?? []) if (byId.has(p)) visit(p, [...trail, id]); state.set(id, "done");
  };
  for (const id of byId.keys()) visit(id, []);
  const first = byId.get("haftarah-sof-pasuk");
  if (!first || !["torah-sof-pasuk", "torah-etnachta"].every(id => first.prerequisites.includes(id))) fail("haftarah-sof-pasuk must require the two Torah endings");
  const practice = parsePractice(value.practice, byId, fail, text);
  for (const [where, field] of strings) for (const problem of toneProblems(field)) fail(`${where}: ${problem}`);
  if (problems.length) throw new CourseError(problems);
  return Object.freeze({ schema: COURSE_SCHEMA, families: Object.freeze(families), units: Object.freeze(units), lessons: Object.freeze(lessons),
    lookAlikes: Object.freeze(lookAlikes), practice: Object.freeze(practice) });
}

type Text = (where: string, field: unknown, max?: number) => string;
/** The codepoints a look-alike mark is written with (azla and geresh share one stroke, in either form). */
const MARK_CODEPOINTS: Readonly<Record<LookAlikeMark, readonly string[]>> = Object.freeze({
  pashta: ["֙"], kadma: ["֨"], mahpach: ["֤"], yetiv: ["֚"], azla: ["֜", "֝"], geresh: ["֜", "֝"] });
const HEBREW_WORD = /^[֑-ׇא-ת׳״־]+$/;
/** The look-alike pairs: exactly the four ids, each with its two marks and examples whose words carry them. */
function parseLookAlikes(value: unknown, fail: (message: string) => void, text: Text): Record<LookAlikePairId, LookAlikePair> {
  const out = {} as Record<LookAlikePairId, LookAlikePair>, ids = Object.keys(LOOK_ALIKE_PAIRS) as LookAlikePairId[];
  if (!isObject(value) || Object.keys(value).length !== ids.length || ids.some(id => !Object.hasOwn(value, id))) { fail("lookAlikes are not the four pairs"); return out; }
  for (const id of ids) {
    const row = value[id], where = `lookAlikes ${id}`, marks = LOOK_ALIKE_PAIRS[id], context = id === "azla-geresh" ? "previous-word" : "word";
    if (!isObject(row)) { fail(where); continue; }
    if (Object.keys(row).some(key => !["title", "marks", "context", "readingOnly", "examples"].includes(key))) fail(`${where}: unknown field`);
    if (!Array.isArray(row.marks) || row.marks.length !== 2 || row.marks[0] !== marks[0] || row.marks[1] !== marks[1]) fail(`${where}: marks`);
    if ((row.context ?? "word") !== context) fail(`${where}: context`);
    if (READING_ONLY_PAIRS.has(id) ? row.readingOnly !== true : row.readingOnly !== undefined) fail(`${where}: readingOnly`);
    const word = (side: unknown, mark: LookAlikeMark, at: string): LookAlikeWord | null => {
      if (!isObject(side) || Object.keys(side).length !== 4 || typeof side.ref !== "string" || !REF.test(side.ref) || !integer(side.word, 0, 120) || side.mark !== mark) { fail(`${at}: shape`); return null; }
      const hebrew = text(`${at} text`, side.text, 80);
      if (hebrew && (!HEBREW_WORD.test(hebrew) || !MARK_CODEPOINTS[mark].some(cp => hebrew.includes(cp)))) fail(`${at}: text does not carry ${mark}`);
      return Object.freeze({ ref: side.ref, word: side.word as number, text: hebrew, mark });
    };
    const examples = !Array.isArray(row.examples) || row.examples.length < 1 || row.examples.length > 8 ? (fail(`${where}: examples`), []) : row.examples.flatMap((example, i) => {
      const at = `${where} example ${i}`;
      if (!isObject(example) || Object.keys(example).some(key => !["a", "b", "why", "hard"].includes(key)) || example.hard !== undefined && typeof example.hard !== "boolean") { fail(`${at}: shape`); return []; }
      const a = word(example.a, marks[0], `${at} a`), b = word(example.b, marks[1], `${at} b`), why = text(`${at} why`, example.why, 240);
      if (!a || !b) return [];
      if (melodyOfRef(a.ref) !== melodyOfRef(b.ref)) fail(`${at}: the two words are in two melodies`);
      if (a.ref === b.ref && a.word === b.word) fail(`${at}: one word twice`);
      // Kadma and azla are neighbours: one example gives both. Azla and geresh are shown with the word before, so neither is a verse's first word.
      if (id === "kadma-azla" && (a.ref !== b.ref || b.word !== a.word + 1)) fail(`${at}: azla is not the word after its kadma`);
      if (id === "azla-geresh" && (a.word < 1 || b.word < 1)) fail(`${at}: no word before`);
      return [Object.freeze({ a, b, melody: melodyOfRef(a.ref), why, hard: example.hard === true })];
    });
    out[id] = Object.freeze({ id, title: text(`${where} title`, row.title, 60), marks, context, examples: Object.freeze(examples) });
  }
  return out;
}
/** Practice runs that are not lessons (1.6: Quick ten, one per melody), each opening once its lesson is done. */
function parsePractice(value: unknown, lessons: ReadonlyMap<string, Lesson>, fail: (message: string) => void, text: Text): Practice[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 4) { fail("practice"); return []; }
  const seen = new Set<string>();
  return value.flatMap((row, n) => {
    if (!isObject(row) || typeof row.id !== "string" || !/^[a-z][a-z0-9-]{1,40}$/.test(row.id)) { fail(`practice ${n}: id`); return []; }
    const where = `practice ${row.id}`;
    if (seen.has(row.id) || lessons.has(row.id)) fail(`${where}: duplicate id`); seen.add(row.id);
    if (value.filter(other => isObject(other) && other.melody === row.melody).length > 1) fail(`${where}: two practice runs in one melody`);
    if (Object.keys(row).some(key => !["id", "melody", "title", "summary", "unlockAfter", "activity"].includes(key))) fail(`${where}: unknown field`);
    if (!MELODIES.includes(row.melody as Melody)) fail(`${where}: melody`);
    const melody = row.melody as Melody, after = typeof row.unlockAfter === "string" ? lessons.get(row.unlockAfter) : undefined;
    if (!after || after.melody !== melody) fail(`${where}: unlockAfter`);
    const activity = row.activity;
    if (!isObject(activity) || Object.keys(activity).length !== 2 || activity.type !== "quick-ten" || !isObject(activity.params)) { fail(`${where}: only a quick-ten activity`); return []; }
    const p = activity.params;
    if (Object.keys(p).some(key => !["families", "items", "choices", "autoAdvanceMs"].includes(key))) fail(`${where}: unknown params`);
    if (p.families !== "heard") fail(`${where}: families`);
    // Quick ten is the one run longer than eight: ten items, never more.
    const items = integer(p.items, 1, 10) ? p.items as number : (fail(`${where}: items`), 10);
    const choices = integer(p.choices, 2, 4) ? p.choices as number : (fail(`${where}: choices`), 3);
    const autoAdvanceMs = integer(p.autoAdvanceMs, 500, 4000) ? p.autoAdvanceMs as number : (fail(`${where}: autoAdvanceMs`), 1500);
    return [Object.freeze({ id: row.id, melody, title: text(`${where} title`, row.title, 60), summary: text(`${where} summary`, row.summary, 60), unlockAfter: String(row.unlockAfter),
      activity: Object.freeze({ type: "quick-ten" as const, params: Object.freeze({ families: "heard" as const, items, choices, autoAdvanceMs }) }) })];
  });
}

function familyList(value: unknown, fail: (message: string) => void, melody: Melody): FamilyId[] {
  if (!Array.isArray(value) || !value.length || value.length > FAMILY_IDS.length || new Set(value).size !== value.length || value.some(id => !MELODY_FAMILIES[melody].includes(id as FamilyId))) { fail("families"); return []; }
  return value as FamilyId[];
}
function parseActivity(value: unknown, family: FamilyId | null, melody: Melody, lookAlikes: Readonly<Partial<Record<LookAlikePairId, LookAlikePair>>>, fail: (message: string) => void): Activity | null {
  if (!isObject(value) || typeof value.type !== "string" || !isObject(value.params)) { fail("shape"); return null; }
  const p = value.params, keys = Object.keys(p);
  const only = (allowed: string[]) => { const extra = keys.filter(key => !allowed.includes(key)); if (extra.length) fail(`unknown params ${extra.join(", ")}`); };
  const items = () => integer(p.items, 1, 8) ? p.items as number : (fail("items"), 1);
  const words = (fallback: [number, number]): [number, number] => {
    if (p.verseWords === undefined) return fallback;
    const v = p.verseWords;
    if (!Array.isArray(v) || v.length !== 2 || !integer(v[0], 3, 20) || !integer(v[1], v[0] as number, 20)) { fail("verseWords"); return fallback; }
    return [v[0] as number, v[1] as number];
  };
  switch (value.type) {
    case "hear-and-name": {
      only(["families", "items", "choices", "weight", "label", "mode"]);
      if (p.mode !== undefined && p.mode !== "read") fail("mode");
      const families = familyList(p.families, fail, melody), choices = p.choices === undefined ? Math.min(families.length, 2) : integer(p.choices, 2, 4) ? p.choices as number : (fail("choices"), 2);
      if (choices > families.length) fail("more choices than families");
      const weight: Partial<Record<FamilyId, number>> = {};
      if (p.weight !== undefined) {
        if (!isObject(p.weight)) fail("weight");
        else for (const [id, w] of Object.entries(p.weight)) { if (!families.includes(id as FamilyId) || !integer(w, 1, 4)) fail(`weight ${id}`); else weight[id as FamilyId] = w; }
      }
      return { type: "hear-and-name", params: { families, items: items(), choices, weight, ...(p.label !== undefined ? { label: String(p.label) } : {}), ...(p.mode === "read" ? { mode: "read" as const } : {}) } };
    }
    case "same-or-different": {
      only(["families", "items", "melodies", "label"]);
      const families = familyList(p.families, fail, "haftarah");
      let melodies: Melody[] | undefined;
      if (p.melodies !== undefined) { if (!Array.isArray(p.melodies) || p.melodies.length !== 2 || !MELODIES.every(m => (p.melodies as unknown[]).includes(m))) fail("melodies"); else melodies = [...MELODIES]; }
      if (!melodies && families.length < 2 && families.some(id => !MELODY_FAMILIES[melody].includes(id))) fail("families");
      if (!melodies && families.length < 2) fail("a same-or-different run needs two families or two melodies");
      return { type: "same-or-different", params: { families, items: items(), ...(melodies ? { melodies } : {}), ...(p.label !== undefined ? { label: String(p.label) } : {}) } };
    }
    case "where-does-it-end": {
      only(["families", "items", "audio", "prompt", "verseWords"]);
      if (p.audio !== undefined && typeof p.audio !== "boolean") fail("audio");
      return { type: "where-does-it-end", params: { families: familyList(p.families, fail, melody), items: items(), audio: p.audio !== false, verseWords: words([5, 12]), ...(p.prompt !== undefined ? { prompt: String(p.prompt) } : {}) } };
    }
    case "tap-the-phrase": {
      only(["families", "items", "verseWords"]);
      return { type: "tap-the-phrase", params: { families: familyList(p.families, fail, melody), items: items(), verseWords: words([5, 12]) } };
    }
    case "build-the-phrase": {
      only(["family", "items", "patterns", "extraMarks"]);
      if (!MELODY_FAMILIES[melody].includes(p.family as FamilyId)) fail("family");
      const patterns = Array.isArray(p.patterns) && p.patterns.length && p.patterns.length <= 6 ? p.patterns.map(pattern => {
        const parsed = typeof pattern === "string" ? parsePattern(pattern) : null;
        if (!parsed || parsed.length < 2 || parsed.length > 4) fail(`pattern ${String(pattern)}`);
        return parsed ?? [];
      }) : (fail("patterns"), []);
      const extraMarks = p.extraMarks === undefined ? 1 : integer(p.extraMarks, 0, 3) ? p.extraMarks as number : (fail("extraMarks"), 1);
      return { type: "build-the-phrase", params: { family: p.family as FamilyId, items: items(), patterns, extraMarks } };
    }
    case "look-alikes": {
      only(["pairs", "items", "mode"]);
      const mode = p.mode === undefined ? "read" : p.mode === "read" || p.mode === "hear" ? p.mode : (fail("mode"), "read");
      const pairs = Array.isArray(p.pairs) && p.pairs.length >= 1 && p.pairs.length <= 4 && new Set(p.pairs).size === p.pairs.length ? p.pairs.flatMap(id => {
        const pair = typeof id === "string" && Object.hasOwn(LOOK_ALIKE_PAIRS, id) ? lookAlikes[id as LookAlikePairId] : undefined;
        if (!pair) { fail(`pair ${String(id)}`); return []; }
        if (mode === "hear" && READING_ONLY_PAIRS.has(pair.id)) fail(`pair ${pair.id} is reading only`);
        if (!pair.examples.some(example => example.melody === melody)) fail(`pair ${pair.id} has no ${melody} example`);
        return [pair.id];
      }) : (fail("pairs"), []);
      return { type: "look-alikes", params: { pairs, items: items(), mode } };
    }
    case "which-half": {
      only(["families", "items", "audio", "verseWords"]);
      const families = familyList(p.families, fail, melody);
      // The etnachta phrase and the verse's ending are trivially one half or the other; some other family must be asked.
      if (families.every(id => id === "etnachta" || id === "sof-pasuk" || id === "sof-haftarah")) fail("families");
      const audio = p.audio === undefined ? "lead-in" : p.audio === "lead-in" || p.audio === "phrase" ? p.audio : (fail("audio"), "lead-in");
      return { type: "which-half", params: { families, items: items(), audio, verseWords: words([6, 18]) } };
    }
    case "this-week": {
      only(["family", "kind", "show", "find"]);
      if (!MELODY_FAMILIES[melody].includes(p.family as FamilyId) || family !== null && p.family !== family) fail("family");
      if (p.kind !== undefined && !MELODIES.includes(p.kind as Melody)) fail("kind");
      const show = integer(p.show, 0, 5) ? p.show as number : (fail("show"), 3), find = integer(p.find, 0, 5) ? p.find as number : (fail("find"), 3);
      return { type: "this-week", params: { family: p.family as FamilyId, ...(p.kind !== undefined ? { kind: p.kind as Melody } : {}), show, find } };
    }
    case "first-verse": {
      only(["source", "kind", "pick", "maxWords", "steps", "celebrate", "openInLein"]);
      if (p.source !== "this-week" || p.pick !== "shortest-word-ready" || p.kind !== melody || family !== null) fail("source, pick or kind");
      const steps = ["phrases", "whole", "along-0.75", "along-1"];
      if (!Array.isArray(p.steps) || p.steps.length !== steps.length || p.steps.some((step, i) => step !== steps[i])) fail("steps");
      if (typeof p.celebrate !== "boolean" || typeof p.openInLein !== "boolean") fail("celebrate or openInLein");
      return { type: "first-verse", params: { kind: melody, maxWords: integer(p.maxWords, 3, 20) ? p.maxWords as number : (fail("maxWords"), 12), steps: steps as FirstVerseStep[], celebrate: p.celebrate === true, openInLein: p.openInLein === true } };
    }
    default: fail(`unknown type ${value.type}`); return null;
  }
}

export const COURSE: Course = validateCourse(raw);
const BY_ID = new Map(COURSE.lessons.map(lesson => [lesson.id, lesson]));
export const lessonById = (id: string): Lesson | null => BY_ID.get(id) ?? null;
/** A path's lessons in teaching order (unit order, then the unit's own order). */
export const pathLessons = (melody: Melody): Lesson[] => COURSE.units.filter(unit => unit.melody === melody).flatMap(unit => unit.lessons.map(id => BY_ID.get(id)!));
export const unitOf = (id: string): CourseUnit | null => COURSE.units.find(unit => unit.lessons.includes(id)) ?? null;
export const practiceById = (id: string): Practice | null => COURSE.practice.find(row => row.id === id) ?? null;
/** A look-alikes activity's examples in one melody, pair by pair. */
export const lookAlikeExamples = (activity: LookAlikes, melody: Melody): { pair: LookAlikePair; example: LookAlikeExample }[] =>
  activity.params.pairs.flatMap(id => COURSE.lookAlikes[id].examples.filter(example => example.melody === melody).map(example => ({ pair: COURSE.lookAlikes[id], example })));
/** Every verse the look-alike pairs name, in one melody: they join the course's fixed passages, so the course pack holds them. */
export const lookAlikeRefs = (melody: Melody): string[] => [...new Set(Object.values(COURSE.lookAlikes).flatMap(pair => pair.examples.filter(example => example.melody === melody).flatMap(example => [example.a.ref, example.b.ref])))];
export const familyName = (id: FamilyId): string => PHRASE_FAMILIES.find(family => family.id === id)!.label;
export const familyColor = (id: FamilyId): string => PHRASE_FAMILIES.find(family => family.id === id)!.color;
/** About how long a lesson takes: half a minute to hear, a minute in verses, ten seconds a drill item; 3 to 5 minutes. */
export function lessonMinutes(lesson: Lesson): number {
  const items = lesson.activities.filter(isDrill).reduce((sum, activity) => sum + activity.params.items, 0);
  return Math.min(5, Math.max(3, Math.round(1.5 + items * 12 / 60)));
}
