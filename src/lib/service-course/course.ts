import rawCourse from "./course.json";
import rawCrc from "./tenants/crc.json";
import { toneProblems } from "../learn/tone";

/**
 * The service course (Learn the service, release 2.0): units, lessons and per-congregation files, parsed and
 * validated once at module load so a bad edit fails the build and the tests, never a learner's page (A4 5.3).
 *
 * `course.json` holds structure only: ids, titles, goals, glosses, the alphabet table. It never holds a prayer
 * word, Hebrew or English, and never a page number. `tenants/<tenant>.json` holds what is congregation-specific:
 * the siddur book and the printed pages, the approved teaching, the credit and the default path. Licensed text is
 * never in either file; the course reaches the siddur only through `siddurPageLink`.
 */
export const SERVICE_COURSE_SCHEMA = "service-course/v1" as const;
export type LessonKind = "fluency" | "prayer" | "moment";
export type KeyWord = Readonly<{ block: number; word: number; gloss: string; root?: string; check?: boolean }>;
export type TorahRef = Readonly<{ ref: string; kind: "torah" | "haftarah"; words: readonly [number, number] }>;
/** The public volume's unit a Read step shows (SC2). Unit ids and block indices only, never text. */
export type Read = Readonly<{ unit: string; blocks: readonly [number, number]; torahRef?: TorahRef }>;
export type Lesson = Readonly<{ id: string; kind: LessonKind; title: string; summary: string; goal: string; section: string; read?: Read;
  keyWords: readonly KeyWord[]; check?: Readonly<{ items: number }>; prerequisites: readonly string[]; hear: null }>;
export type Unit = Readonly<{ id: string; title: string; summary: string; phase: "morning" | "evening"; map: boolean; lessons: readonly string[] }>;
export type Letter = Readonly<{ id: string; name: string; char: string }>;
export type Mark = Readonly<{ id: string; name: string; mark: string }>;
export type Alphabet = Readonly<{ letters: readonly Letter[]; finals: readonly Letter[]; marks: readonly Mark[] }>;
export type Course = Readonly<{ schema: typeof SERVICE_COURSE_SCHEMA; features: Readonly<{ recordings: boolean; fluency: boolean }>; units: readonly Unit[];
  lessons: readonly Lesson[]; service: readonly string[]; alphabet: Alphabet }>;
export type Teaching = Readonly<{ text: string; approved: string; from?: string }>;
export type TenantLesson = Readonly<{ bm?: readonly string[]; pages: Readonly<{ morning?: number; evening?: number }>; teaching?: Teaching }>;
export type Tenant = Readonly<{ tenant: string; enabled: boolean; siddurBook: string; publicVolume: string; credit: string; defaultPath: readonly string[];
  lessons: Readonly<Record<string, TenantLesson>> }>;

export class CourseError extends Error {
  constructor(readonly problems: readonly string[]) { super(`The service course is invalid: ${problems.slice(0, 5).join("; ")}`); }
}

const LESSON_ID = /^[a-z][a-z0-9-]{1,40}$/, UNIT_ID = /^[a-z][a-z0-9-]{1,30}$/, TENANT_ID = /^[a-z][a-z0-9-]{1,30}$/;
const PUBLIC_UNIT = /^[a-z0-9-]+\.[a-z0-9-]+@(?:shabbat-shacharit|shabbat-maariv)$/, BM_UNIT = /^[a-z0-9-]+\.[a-z0-9-]+$/, SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/, DATE = /^\d{4}-\d{2}-\d{2}$/;
const HEBREW = /[֐-׿]/;
export const COURSE_LIMITS = Object.freeze({ lessons: 96, title: 60, unitSummary: 160, lessonSummary: 60, goal: 240, gloss: 60, root: 12, keyWords: 6, teachingWords: Object.freeze({ min: 60, max: 200 }) });
const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const integer = (value: unknown, min: number, max: number): value is number => Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max;
const wordCount = (text: string) => text.trim().split(/\s+/).length;
/** "After this you can read ..." as the end-of-lesson line: "You can read ...". The same rule as Learn to lein's `presentGoal`. */
export function presentGoal(goal: string): string {
  const rest = goal.replace(/^After this\s+/, "");
  return rest.charAt(0).toUpperCase() + rest.slice(1);
}

type Fail = (message: string) => void;
function exactKeys(value: Record<string, unknown>, allowed: readonly string[], where: string, fail: Fail) {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`${where}: unknown field ${key.slice(0, 30)}`);
}

/** Every Hebrew character outside `alphabet`, anywhere in the course value (keys and strings alike), as paths. Exported for the tests. */
export function hebrewOutsideAlphabet(value: unknown, path = "course"): string[] {
  if (typeof value === "string") return HEBREW.test(value) ? [path] : [];
  if (Array.isArray(value)) return value.flatMap((item, i) => hebrewOutsideAlphabet(item, `${path}[${i}]`));
  if (isObject(value)) return Object.entries(value).flatMap(([key, item]) => (HEBREW.test(key) ? [`${path}.<key>`] : []).concat(path === "course" && key === "alphabet" ? [] : hebrewOutsideAlphabet(item, `${path}.${key}`)));
  return [];
}

function parseRead(value: unknown, where: string, fail: Fail): Read | undefined {
  if (!isObject(value)) { fail(`${where}: read`); return undefined; }
  exactKeys(value, ["unit", "blocks", "torahRef"], where, fail);
  if (typeof value.unit !== "string" || !PUBLIC_UNIT.test(value.unit)) fail(`${where}: read unit`);
  const blocks = value.blocks;
  if (!Array.isArray(blocks) || blocks.length !== 2 || !integer(blocks[0], 0, 255) || !integer(blocks[1], 0, 255) || blocks[0] > blocks[1]) fail(`${where}: read blocks`);
  let torahRef: TorahRef | undefined;
  if (value.torahRef !== undefined) {
    const ref = value.torahRef;
    if (!isObject(ref)) fail(`${where}: torahRef`);
    else {
      exactKeys(ref, ["ref", "kind", "words"], `${where} torahRef`, fail);
      const words = ref.words;
      if (typeof ref.ref !== "string" || !/^(?:I{1,2} )?[A-Z][a-z]+(?: [A-Z][a-z]+)* [1-9]\d{0,2}:[1-9]\d{0,2}(?:-[1-9]\d{0,2})?$/.test(ref.ref) || (ref.kind !== "torah" && ref.kind !== "haftarah")
        || !Array.isArray(words) || words.length !== 2 || !integer(words[0], 0, 400) || !integer(words[1], 0, 400) || words[0] > words[1]) fail(`${where}: torahRef`);
      else torahRef = Object.freeze({ ref: ref.ref, kind: ref.kind, words: Object.freeze([words[0], words[1]] as const) });
    }
  }
  if (typeof value.unit !== "string" || !Array.isArray(blocks)) return undefined;
  return Object.freeze({ unit: value.unit, blocks: Object.freeze([blocks[0], blocks[1]] as const), ...(torahRef ? { torahRef } : {}) });
}

function parseAlphabet(value: unknown, fail: Fail, text: (where: string, field: unknown, max?: number) => string): Alphabet {
  const empty: Alphabet = Object.freeze({ letters: Object.freeze([]), finals: Object.freeze([]), marks: Object.freeze([]) });
  if (!isObject(value)) { fail("alphabet"); return empty; }
  exactKeys(value, ["letters", "finals", "marks"], "alphabet", fail);
  const seen = new Set<string>();
  const rows = <T,>(field: unknown, name: string, key: "char" | "mark", pattern: RegExp): T[] => {
    if (!Array.isArray(field) || field.length < 1 || field.length > 40) { fail(`alphabet ${name}`); return []; }
    return field.flatMap((row, n) => {
      if (!isObject(row) || typeof row.id !== "string" || !/^[a-z][a-z-]{1,20}$/.test(row.id) || typeof row[key] !== "string" || !pattern.test(row[key] as string)) { fail(`alphabet ${name} ${n}`); return []; }
      exactKeys(row, ["id", "name", key], `alphabet ${name} ${row.id}`, fail);
      if (seen.has(row.id)) fail(`alphabet ${name} ${row.id}: duplicate id`); seen.add(row.id);
      return [Object.freeze({ id: row.id, name: text(`alphabet ${row.id}`, row.name, 24), [key]: row[key] }) as T];
    });
  };
  return Object.freeze({ letters: Object.freeze(rows<Letter>(value.letters, "letters", "char", /^[א-ת]$/)), finals: Object.freeze(rows<Letter>(value.finals, "finals", "char", /^[ךםןףץ]$/)),
    marks: Object.freeze(rows<Mark>(value.marks, "marks", "mark", /^[ְ-ּׁׂ]$/)) });
}

/**
 * Parse and check the course and its congregation files against every rule in A4 5.3; every problem is collected
 * and thrown together as one CourseError. `tenants` are the congregation files, enabled or not.
 */
export function validateServiceCourse(courseValue: unknown, tenantValues: readonly unknown[]): { course: Course; tenants: readonly Tenant[] } {
  const problems: string[] = [];
  const fail: Fail = message => { problems.push(message); };
  const strings: [string, string][] = [];
  // Learner-facing text: NFC, bounded, and later run through the tone rule (rule 10).
  const text = (where: string, field: unknown, max = 400): string => {
    if (typeof field !== "string" || !field.trim() || field.length > max || field !== field.normalize("NFC")) { fail(`${where}: text`); return ""; }
    strings.push([where, field]); return field;
  };
  if (!isObject(courseValue)) throw new CourseError(["course is not an object"]);
  exactKeys(courseValue, ["schema", "features", "units", "lessons", "service", "alphabet"], "course", fail);
  // Rule 1.
  if (courseValue.schema !== SERVICE_COURSE_SCHEMA) fail("schema id");
  // Rule 9: no Hebrew outside the alphabet table, so prayer text, licensed or public, cannot enter the repo through this file.
  for (const path of hebrewOutsideAlphabet(courseValue)) fail(`Hebrew outside the alphabet table at ${path}`);
  const features = courseValue.features;
  if (!isObject(features) || typeof features.recordings !== "boolean" || typeof features.fluency !== "boolean") fail("features");
  exactKeys(isObject(features) ? features : {}, ["recordings", "fluency"], "features", fail);
  const recordings = isObject(features) && features.recordings === true, fluencyOn = isObject(features) && features.fluency === true;
  const alphabet = parseAlphabet(courseValue.alphabet, fail, text);

  // Rules 2 to 6: lessons.
  const lessons: Lesson[] = [], ids = new Set<string>();
  const lessonRows = Array.isArray(courseValue.lessons) ? courseValue.lessons : (fail("lessons"), []);
  if (lessonRows.length < 1 || lessonRows.length > COURSE_LIMITS.lessons) fail(`lessons: 1 to ${COURSE_LIMITS.lessons}`);
  for (const [n, row] of lessonRows.slice(0, COURSE_LIMITS.lessons).entries()) {
    if (!isObject(row) || typeof row.id !== "string" || !LESSON_ID.test(row.id)) { fail(`lesson ${n}: id`); continue; }
    const where = `lesson ${row.id}`;
    exactKeys(row, ["id", "kind", "title", "summary", "goal", "section", "read", "keyWords", "check", "prerequisites", "hear"], where, fail);
    if (ids.has(row.id)) fail(`${where}: duplicate id`); ids.add(row.id);
    const kind = row.kind === "fluency" || row.kind === "prayer" || row.kind === "moment" ? row.kind : (fail(`${where}: kind`), "prayer" as LessonKind);
    const title = text(`${where} title`, row.title, COURSE_LIMITS.title), summary = text(`${where} summary`, row.summary, COURSE_LIMITS.lessonSummary);
    const goal = text(`${where} goal`, row.goal, COURSE_LIMITS.goal);
    if (goal && !goal.startsWith("After this you can ")) fail(`${where}: goal must start "After this you can"`);
    if (fluencyOn && /TODO/.test(goal)) fail(`${where}: goal is still a TODO and the fluency strand is on`);
    const section = typeof row.section === "string" && UNIT_ID.test(row.section) ? row.section : (fail(`${where}: section`), "");
    const read = row.read === undefined ? undefined : parseRead(row.read, where, fail);
    const keyWords: KeyWord[] = [];
    if (!Array.isArray(row.keyWords) || row.keyWords.length > COURSE_LIMITS.keyWords) fail(`${where}: keyWords`);
    else for (const [i, word] of row.keyWords.entries()) {
      if (!isObject(word) || !integer(word.block, 0, 255) || !integer(word.word, 0, 400) || (word.root !== undefined && typeof word.root !== "string") || (word.check !== undefined && typeof word.check !== "boolean")) { fail(`${where}: keyWord ${i}`); continue; }
      exactKeys(word, ["block", "word", "gloss", "root", "check"], `${where} keyWord ${i}`, fail);
      if (read && (word.block < read.blocks[0] || word.block > read.blocks[1])) fail(`${where}: keyWord ${i} is outside the read blocks`);
      const root = typeof word.root === "string" ? word.root : undefined;
      if (root !== undefined && (root.length > COURSE_LIMITS.root || !/^[a-z]{1,3}(?:-[a-z]{1,3}){1,3}$/.test(root))) fail(`${where}: keyWord ${i} root`);
      keyWords.push(Object.freeze({ block: word.block, word: word.word, gloss: text(`${where} keyWord ${i}`, word.gloss, COURSE_LIMITS.gloss), ...(root !== undefined ? { root } : {}), ...(word.check !== undefined ? { check: word.check } : {}) }));
    }
    let check: { items: number } | undefined;
    if (row.check !== undefined) {
      if (!isObject(row.check) || Object.keys(row.check).length !== 1 || !integer(row.check.items, 3, 6)) fail(`${where}: check`);
      else check = Object.freeze({ items: row.check.items });
    }
    if (kind === "moment" && (read || keyWords.length || check)) fail(`${where}: a moment lesson has no read, keyWords or check`);
    if ((keyWords.length || check) && !read) fail(`${where}: keyWords and check need a read`);
    // Rule 7: the 2.1 slot.
    if (row.hear !== null && !(recordings && isObject(row.hear))) fail(`${where}: hear must be null while recordings is false`);
    const prerequisites = Array.isArray(row.prerequisites) && row.prerequisites.every(id => typeof id === "string") ? row.prerequisites as string[] : (fail(`${where}: prerequisites`), []);
    lessons.push(Object.freeze({ id: row.id, kind, title, summary, goal, section, ...(read ? { read } : {}), keyWords: Object.freeze(keyWords), ...(check ? { check } : {}), prerequisites: Object.freeze(prerequisites), hear: null }));
  }
  const byId = new Map(lessons.map(lesson => [lesson.id, lesson]));
  for (const lesson of lessons) for (const id of lesson.prerequisites) if (!byId.has(id)) fail(`lesson ${lesson.id}: prerequisite ${id.slice(0, 40)} does not exist`);
  // Prerequisites form no loop.
  const state = new Map<string, 1 | 2>();
  const visit = (id: string): boolean => {
    if (state.get(id) === 2) return false; if (state.get(id) === 1) return true;
    state.set(id, 1); const loop = (byId.get(id)?.prerequisites ?? []).some(next => byId.has(next) && visit(next)); state.set(id, 2); return loop;
  };
  for (const lesson of lessons) if (visit(lesson.id)) { fail(`lesson ${lesson.id}: prerequisites loop`); break; }

  // Rule 3: units, and every lesson in exactly one.
  const units: Unit[] = [], unitIds = new Set<string>(), placed = new Map<string, string>();
  const unitRows = Array.isArray(courseValue.units) ? courseValue.units : (fail("units"), []);
  if (unitRows.length < 1 || unitRows.length > 16) fail("units: 1 to 16");
  for (const [n, row] of unitRows.slice(0, 16).entries()) {
    if (!isObject(row) || typeof row.id !== "string" || !UNIT_ID.test(row.id)) { fail(`unit ${n}: id`); continue; }
    const where = `unit ${row.id}`;
    exactKeys(row, ["id", "title", "summary", "phase", "map", "lessons"], where, fail);
    if (unitIds.has(row.id)) fail(`${where}: duplicate id`); unitIds.add(row.id);
    if (row.phase !== "morning" && row.phase !== "evening") fail(`${where}: phase`);
    if (typeof row.map !== "boolean") fail(`${where}: map`);
    const members = Array.isArray(row.lessons) && row.lessons.length >= 1 && row.lessons.every(id => typeof id === "string") ? row.lessons as string[] : (fail(`${where}: lessons`), []);
    for (const id of members) { if (!byId.has(id)) fail(`${where}: lesson ${id.slice(0, 40)} does not exist`); else if (placed.has(id)) fail(`lesson ${id} is in more than one unit`); else placed.set(id, row.id); }
    units.push(Object.freeze({ id: row.id, title: text(`${where} title`, row.title, COURSE_LIMITS.title), summary: text(`${where} summary`, row.summary, COURSE_LIMITS.unitSummary),
      phase: row.phase === "evening" ? "evening" : "morning", map: row.map === true, lessons: Object.freeze(members) }));
  }
  for (const lesson of lessons) if (!placed.has(lesson.id)) fail(`lesson ${lesson.id} is in no unit`);
  const unitById = new Map(units.map(unit => [unit.id, unit]));
  // A lesson's section is the service section its Where map belongs to: a map unit, never the fluency strand.
  for (const lesson of lessons) {
    const section = unitById.get(lesson.section);
    if (!section) { fail(`lesson ${lesson.id}: section ${lesson.section.slice(0, 30)} is not a unit`); continue; }
    if (lesson.kind === "fluency" ? section.map : !section.map) fail(`lesson ${lesson.id}: section ${section.id} is the wrong kind of unit`);
  }
  for (const unit of units) if (unit.map) for (const id of unit.lessons) if (byId.get(id)?.section !== unit.id) fail(`unit ${unit.id}: lesson ${id} has another section`);
  // The service order: every prayer and moment once, and each section's lessons stay together.
  const service = Array.isArray(courseValue.service) && courseValue.service.every(id => typeof id === "string") ? courseValue.service as string[] : (fail("service"), []);
  const serviceLessons = lessons.filter(lesson => lesson.kind !== "fluency");
  if (new Set(service).size !== service.length || service.length !== serviceLessons.length || serviceLessons.some(lesson => !service.includes(lesson.id))) fail("service: must list every prayer and moment lesson exactly once");
  const sectionsSeen: string[] = [];
  for (const id of service) { const section = byId.get(id)?.section; if (section && sectionsSeen[sectionsSeen.length - 1] !== section) { if (sectionsSeen.includes(section)) fail(`service: section ${section} is split`); sectionsSeen.push(section); } }

  // Rules 8 and 10: the congregation files.
  const tenants: Tenant[] = [], tenantIds = new Set<string>();
  for (const [n, value] of tenantValues.entries()) {
    if (!isObject(value) || typeof value.tenant !== "string" || !TENANT_ID.test(value.tenant)) { fail(`tenant ${n}: id`); continue; }
    const tenant = value.tenant, where = `tenant ${tenant}`;
    exactKeys(value, ["tenant", "enabled", "siddurBook", "publicVolume", "credit", "defaultPath", "lessons"], where, fail);
    if (tenantIds.has(tenant)) fail(`${where}: duplicate`); tenantIds.add(tenant);
    for (const path of hebrewOutsideAlphabet(value, where)) fail(`Hebrew in ${path}`);
    if (typeof value.enabled !== "boolean") fail(`${where}: enabled`);
    const siddurBook = typeof value.siddurBook === "string" && SLUG.test(value.siddurBook) ? value.siddurBook : (fail(`${where}: siddurBook`), "");
    const publicVolume = typeof value.publicVolume === "string" && SLUG.test(value.publicVolume) ? value.publicVolume : (fail(`${where}: publicVolume`), "");
    if (siddurBook && siddurBook === publicVolume) fail(`${where}: the siddur book and the public volume must differ`);
    const credit = text(`${where} credit`, value.credit, 60);
    const defaultPath = Array.isArray(value.defaultPath) && value.defaultPath.length >= 1 && value.defaultPath.every(id => typeof id === "string" && byId.has(id) && byId.get(id)!.kind !== "fluency")
      ? value.defaultPath as string[] : (fail(`${where}: defaultPath names lessons that do not exist`), []);
    const rows: Record<string, TenantLesson> = {};
    if (!isObject(value.lessons)) fail(`${where}: lessons`);
    else for (const [id, row] of Object.entries(value.lessons)) {
      const here = `${where} lesson ${id.slice(0, 40)}`, lesson = byId.get(id);
      if (!lesson) { fail(`${here}: not a lesson of the course`); continue; }
      if (!isObject(row)) { fail(here); continue; }
      exactKeys(row, ["bm", "pages", "teaching"], here, fail);
      const bm = row.bm === undefined ? undefined : Array.isArray(row.bm) && row.bm.length >= 1 && row.bm.every(unit => typeof unit === "string" && BM_UNIT.test(unit)) ? row.bm as string[] : (fail(`${here}: bm unit ids`), undefined);
      const pagesIn = isObject(row.pages) ? row.pages : (fail(`${here}: pages`), {} as Record<string, unknown>);
      exactKeys(pagesIn, ["morning", "evening"], `${here} pages`, fail);
      const pages: { morning?: number; evening?: number } = {};
      for (const slot of ["morning", "evening"] as const) if (pagesIn[slot] !== undefined) { if (integer(pagesIn[slot], 1, 9999)) pages[slot] = pagesIn[slot] as number; else fail(`${here}: ${slot} page`); }
      if ((bm || lesson.kind !== "fluency") && pages.morning === undefined && pages.evening === undefined) fail(`${here}: needs at least one page`);
      let teaching: Teaching | undefined;
      if (row.teaching !== undefined) {
        const t = row.teaching;
        if (!isObject(t) || typeof t.approved !== "string" || !DATE.test(t.approved) || (t.from !== undefined && typeof t.from !== "string")) fail(`${here}: teaching`);
        else {
          exactKeys(t, ["text", "approved", "from"], `${here} teaching`, fail);
          const body = text(`${here} teaching`, t.text, 2400);
          if (body && (wordCount(body) < COURSE_LIMITS.teachingWords.min || wordCount(body) > COURSE_LIMITS.teachingWords.max)) fail(`${here}: teaching is ${wordCount(body)} words, not ${COURSE_LIMITS.teachingWords.min} to ${COURSE_LIMITS.teachingWords.max}`);
          teaching = Object.freeze({ text: body, approved: t.approved, ...(t.from !== undefined ? { from: t.from as string } : {}) });
        }
      }
      rows[id] = Object.freeze({ ...(bm ? { bm: Object.freeze(bm) } : {}), pages: Object.freeze(pages), ...(teaching ? { teaching } : {}) });
    }
    // Rule 8: every prayer and moment lesson of an enabled tenant has an approved teaching.
    if (value.enabled === true) for (const lesson of lessons) if (lesson.kind !== "fluency" && !rows[lesson.id]?.teaching) fail(`${where}: lesson ${lesson.id} has no approved teaching`);
    tenants.push(Object.freeze({ tenant, enabled: value.enabled === true, siddurBook, publicVolume, credit, defaultPath: Object.freeze(defaultPath), lessons: Object.freeze(rows) }));
  }
  // Rule 10: the tone rule on every learner-facing string, the approved teachings included.
  for (const [where, string] of strings) for (const problem of toneProblems(string)) fail(`${where}: tone, ${problem}`);
  if (problems.length) throw new CourseError(problems);
  return { course: Object.freeze({ schema: SERVICE_COURSE_SCHEMA, features: Object.freeze({ recordings, fluency: fluencyOn }), units: Object.freeze(units), lessons: Object.freeze(lessons),
    service: Object.freeze(service), alphabet }), tenants: Object.freeze(tenants) };
}

const PARSED = validateServiceCourse(rawCourse, [rawCrc]);
export const SERVICE_COURSE: Course = PARSED.course;
export const TENANTS: readonly Tenant[] = PARSED.tenants;
/** CRC's file; this app serves one congregation. A second tenant picks its own file here (A4 12). */
export const CRC_TENANT: Tenant = TENANTS.find(tenant => tenant.tenant === "crc")!;

const BY_ID = new Map(SERVICE_COURSE.lessons.map(lesson => [lesson.id, lesson]));
const UNIT_BY_ID = new Map(SERVICE_COURSE.units.map(unit => [unit.id, unit]));
export const lessonById = (id: string): Lesson | null => BY_ID.get(id) ?? null;
export const unitById = (id: string): Unit | null => UNIT_BY_ID.get(id) ?? null;
/** Whether a lesson is reachable now: the fluency strand stays closed until SC3 turns its flag on. */
export const lessonOpen = (lesson: Lesson, course: Course = SERVICE_COURSE) => lesson.kind !== "fluency" || course.features.fluency;
/** Units a learner sees on the home, in order; the fluency unit only when its flag is on. */
export const homeUnits = (course: Course = SERVICE_COURSE): readonly Unit[] =>
  course.units.filter(unit => unit.phase === "morning" && (course.features.fluency || !unit.lessons.every(id => BY_ID.get(id)?.kind === "fluency")));
/** The morning service in printed order: every prayer and moment once. */
export const serviceOrder = (course: Course = SERVICE_COURSE): readonly Lesson[] => course.service.map(id => BY_ID.get(id)!);
/** The prayer before and after a lesson in the service, or null at either end. */
export function serviceNeighbours(id: string, course: Course = SERVICE_COURSE): { before: Lesson | null; after: Lesson | null } {
  const at = course.service.indexOf(id);
  return { before: at > 0 ? BY_ID.get(course.service[at - 1])! : null, after: at >= 0 && at < course.service.length - 1 ? BY_ID.get(course.service[at + 1])! : null };
}
/** The lessons of one Where section in service order (the section's own units plus parts the section borrows from another unit). */
export const sectionLessons = (sectionId: string, course: Course = SERVICE_COURSE): readonly Lesson[] => serviceOrder(course).filter(lesson => lesson.section === sectionId);
/** The Where map's sections, in service order. */
export const mapSections = (course: Course = SERVICE_COURSE): readonly Unit[] => course.units.filter(unit => unit.map);
export const teachingOf = (tenant: Tenant, id: string): Teaching | null => tenant.lessons[id]?.teaching ?? null;
/** The printed page for a lesson in the learner's service; signed out and unknown slot are the morning. */
export const pageOf = (tenant: Tenant, id: string, slot: "morning" | "havdalah" | "unknown" = "morning"): number | undefined => {
  const pages = tenant.lessons[id]?.pages;
  return (slot === "havdalah" ? pages?.evening : pages?.morning) ?? pages?.morning;
};
/** About how long a lesson takes: the teaching and the map, plus a minute to read and a minute for its words; 3 to 6. */
export const lessonMinutes = (lesson: Lesson): number => Math.min(6, 3 + (lesson.read ? 1 : 0) + (lesson.keyWords.length >= 4 ? 1 : 0));
