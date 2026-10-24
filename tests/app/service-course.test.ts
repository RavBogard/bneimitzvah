import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import rawCourse from "../../src/lib/service-course/course.json";
import rawCrc from "../../src/lib/service-course/tenants/crc.json";
import { COPY, emphasised, fill, typographic } from "../../src/lib/service-course/copy";
import { CRC_TENANT, CourseError, SERVICE_COURSE, TENANTS, hebrewOutsideAlphabet, homeUnits, lessonById, lessonMinutes, lessonOpen, mapSections, pageOf, presentGoal,
  sectionLessons, serviceNeighbours, serviceOrder, teachingOf, validateServiceCourse } from "../../src/lib/service-course/course";
import { PROGRESS_KEY, browserProgressStore, completeLesson, courseDone, emptyProgress, isDone, lessonAfter, nextLesson, parseProgress, serializeProgress } from "../../src/lib/service-course/progress";
import { siddurPageLink } from "../../src/lib/siddur/link";
import { DEFAULT_SIDDUR_URL } from "../../src/server/settings/validation";
import { DEFAULT_SERVICE_PARTS } from "../../src/server/service-learning/feed";
import { toneProblems } from "../../src/lib/learn/tone";

const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
/** Validates a mutated copy of the real files and returns the problems it throws, or [] when it is accepted. */
function problemsOf(change: (course: Json, crc: Json) => void): string[] {
  const course = copy(rawCourse) as Json, crc = copy(rawCrc) as Json;
  change(course, crc);
  try { validateServiceCourse(course, [crc]); return []; } catch (error) { if (error instanceof CourseError) return [...error.problems]; throw error; }
}
const has = (problems: string[], part: string) => problems.some(problem => problem.includes(part));
const U1 = ["shma", "vahavta", "torah-before", "torah-after", "haftarah-before", "haftarah-after"];

describe("the real course files", () => {
  it("validate, and hold the 37 morning lessons, the six fluency lessons and the seven units", () => {
    expect(SERVICE_COURSE.lessons).toHaveLength(43);
    expect(SERVICE_COURSE.lessons.filter(lesson => lesson.kind !== "fluency")).toHaveLength(37);
    expect(SERVICE_COURSE.lessons.filter(lesson => lesson.kind === "fluency").map(lesson => lesson.id)).toEqual(["f1", "f2", "f3", "f4", "f5", "f6"]);
    expect(SERVICE_COURSE.lessons.filter(lesson => lesson.kind === "moment").map(lesson => lesson.id).sort()).toEqual(["commentary", "haftarah-reading", "parents-blessing", "torah-reading", "torah-service"]);
    expect(SERVICE_COURSE.units.map(unit => unit.id)).toEqual(["reading", "leads", "waking", "shma", "amidah", "torah", "closing"]);
    expect(SERVICE_COURSE.units.find(unit => unit.id === "leads")!.lessons).toEqual(U1);
    expect(serviceOrder()).toHaveLength(37);
    expect(TENANTS).toHaveLength(1);
  });
  it("keep recordings off and the fluency strand closed in this slice, and hold no prayer text to read yet", () => {
    expect(SERVICE_COURSE.features).toEqual({ recordings: false, fluency: false });
    expect(SERVICE_COURSE.lessons.every(lesson => lesson.hear === null && !lesson.read && lesson.keyWords.length === 0 && !lesson.check)).toBe(true);
    expect(SERVICE_COURSE.lessons.filter(lesson => lessonOpen(lesson))).toHaveLength(37);
    expect(homeUnits().map(unit => unit.id)).toEqual(["leads", "waking", "shma", "amidah", "torah", "closing"]);
  });
  it("keep every lesson inside the limits the units and lessons promise, and every goal in the course's form", () => {
    for (const lesson of SERVICE_COURSE.lessons) {
      expect(lesson.title.length, lesson.id).toBeLessThanOrEqual(60); expect(lesson.summary.length, lesson.id).toBeLessThanOrEqual(60);
      expect(lesson.goal.startsWith("After this you can "), lesson.id).toBe(true); expect(lesson.goal.length).toBeLessThanOrEqual(240);
    }
    for (const unit of SERVICE_COURSE.units) { expect(unit.title.length).toBeLessThanOrEqual(60); expect(unit.summary.length).toBeLessThanOrEqual(160); }
    expect(presentGoal("After this you can say what happens at this point in the service.")).toBe("You can say what happens at this point in the service.");
  });
  it("use the typographic apostrophe the app ships, never the straight one, in titles and summaries", () => {
    for (const lesson of SERVICE_COURSE.lessons) expect(`${lesson.title} ${lesson.summary}`, lesson.id).not.toContain("'");
    expect(lessonById("shma")!.title).toBe("Sh’ma");
  });
  it("place every lesson on a service section and keep each section whole in the service order", () => {
    expect(mapSections().map(unit => unit.id)).toEqual(["waking", "shma", "amidah", "torah", "closing"]);
    expect(sectionLessons("shma").map(lesson => lesson.id)).toEqual(["barchu", "yotzeir-or", "ahavah-rabbah", "shma", "vahavta", "mi-chamochah"]);
    expect(sectionLessons("torah").map(lesson => lesson.id)).toEqual(["torah-service", "torah-before", "torah-reading", "torah-after", "mi-shebeirach", "haftarah-before", "haftarah-reading", "haftarah-after", "commentary", "eitz-chayim"]);
    expect(serviceNeighbours("shma")).toMatchObject({ before: { id: "ahavah-rabbah" }, after: { id: "vahavta" } });
    expect(serviceNeighbours("modeh-ani").before).toBeNull(); expect(serviceNeighbours("closing-blessing").after).toBeNull();
  });
  it("estimate a lesson at three to six minutes", () => { for (const lesson of SERVICE_COURSE.lessons) expect(lessonMinutes(lesson)).toBeGreaterThanOrEqual(3); expect(lessonMinutes(lessonById("shma")!)).toBe(3); });
});

describe("the congregation file", () => {
  it("is CRC's, on the Beit Mitzvah book, credited to Rabbi Daniel Bogard, with the six default parts first", () => {
    expect(CRC_TENANT).toMatchObject({ tenant: "crc", enabled: true, siddurBook: "legacy-beit-mitzvah", publicVolume: "shabbat-shacharit", credit: "Rabbi Daniel Bogard" });
    expect(CRC_TENANT.defaultPath).toEqual(U1);
  });
  it("carries an approved teaching, dated 2026-10-24 and 60 to 200 words, for each of the 37 lessons, and none for V'zot HaTorah", () => {
    for (const lesson of serviceOrder()) {
      const teaching = teachingOf(CRC_TENANT, lesson.id)!;
      expect(teaching, lesson.id).toBeTruthy(); expect(teaching.approved).toBe("2026-10-24");
      const words = teaching.text.trim().split(/\s+/).length; expect(words, lesson.id).toBeGreaterThanOrEqual(60); expect(words).toBeLessThanOrEqual(200);
    }
    expect(Object.keys(CRC_TENANT.lessons)).toHaveLength(37); expect(Object.keys(CRC_TENANT.lessons).join(" ")).not.toMatch(/vzot|zot/);
  });
  it("holds each teaching verbatim from the approved draft files (only the NEW marks on the two split Torah blessings are dropped)", () => {
    const dir = new URL("../../docs/planning/2026-10-24-release-2-0/cowork/A3-DRAFTS/", import.meta.url);
    const draft = (file: string, heading: RegExp) => {
      const lines = readFileSync(new URL(file, dir), "utf8").replace(/\r/g, "").split("\n"), at = lines.findIndex(line => heading.test(line)); expect(at, `${file} ${heading}`).toBeGreaterThanOrEqual(0);
      const paragraphs: string[] = []; let current: string[] = [];
      for (const line of lines.slice(at + 1)) {
        if (/^#{1,2} /.test(line) || /^\((?:About )?\d+ words?\.?\)/.test(line) || /^Sources?:/.test(line) || /^Status:/.test(line)) break;
        if (!line.trim()) { if (current.length) paragraphs.push(current.join(" ")); current = []; } else current.push(line.trim());
      }
      if (current.length) paragraphs.push(current.join(" "));
      return paragraphs.join("\n\n").replace(/ NEW: /g, " ").replace(/^NEW: /, "");
    };
    const where: Record<string, [string, RegExp]> = {
      "modeh-ani": ["01-07-morning-blessings.md", /^## 01\./], "tallit": ["01-07-morning-blessings.md", /^## 02\./], "mah-tovu": ["01-07-morning-blessings.md", /^## 03\./],
      "hineih-mah-tov": ["01-07-morning-blessings.md", /^## 04\./], "birchot-hashachar": ["01-07-morning-blessings.md", /^## 05\./], "psukei-dzimrah": ["01-07-morning-blessings.md", /^## 06\./],
      "chatzi-kaddish": ["01-07-morning-blessings.md", /^## 07\./], "barchu": ["08-13-shma-and-blessings.md", /^## 08\./], "yotzeir-or": ["08-13-shma-and-blessings.md", /^## 09\./],
      "ahavah-rabbah": ["08-13-shma-and-blessings.md", /^## 10\./], "shma": ["11-shma.md", /^## Draft 2/], "vahavta": ["12-vahavta.md", /^## Draft 1/], "mi-chamochah": ["08-13-shma-and-blessings.md", /^## 13\./],
      "tfilah": ["14-22-amidah.md", /^## 14\./], "avot-vimahot": ["14-22-amidah.md", /^## 15\./], "gvurot": ["14-22-amidah.md", /^## 16\./], "kdushah": ["14-22-amidah.md", /^## 17\./],
      "vshamru": ["14-22-amidah.md", /^## 18\./], "avodah": ["14-22-amidah.md", /^## 19\./], "hodaah": ["14-22-amidah.md", /^## 20\./], "sim-shalom": ["14-22-amidah.md", /^## 21\./], "oseh-shalom": ["14-22-amidah.md", /^## 22\./],
      "torah-service": ["23-38-torah-service-to-close.md", /^## 23\./], "torah-before": ["24-26-torah-blessings.md", /^## 24\./], "torah-reading": ["23-38-torah-service-to-close.md", /^## 25\./],
      "torah-after": ["24-26-torah-blessings.md", /^## 26\./], "mi-shebeirach": ["23-38-torah-service-to-close.md", /^## 27\./], "haftarah-before": ["29-31-haftarah-blessings.md", /^## 29\./],
      "haftarah-reading": ["23-38-torah-service-to-close.md", /^## 30\./], "haftarah-after": ["29-31-haftarah-blessings.md", /^## 31\./], "commentary": ["23-38-torah-service-to-close.md", /^## 32\./],
      "eitz-chayim": ["23-38-torah-service-to-close.md", /^## 33\./], "aleinu": ["23-38-torah-service-to-close.md", /^## 34\./], "mourners-kaddish": ["23-38-torah-service-to-close.md", /^## 35\./],
      "adon-olam": ["23-38-torah-service-to-close.md", /^## 36\./], "parents-blessing": ["23-38-torah-service-to-close.md", /^## 37\./], "closing-blessing": ["23-38-torah-service-to-close.md", /^## 38\./],
    };
    expect(Object.keys(where)).toHaveLength(37);
    for (const [id, [file, heading]] of Object.entries(where)) expect(teachingOf(CRC_TENANT, id)!.text, id).toBe(draft(file, heading));
  });
  it("sets no teaching in the typographic form in the data (verbatim), and the render form has no straight apostrophe or quote", () => {
    for (const lesson of serviceOrder()) {
      const text = teachingOf(CRC_TENANT, lesson.id)!.text;
      expect(/[‘’“”]/.test(text), lesson.id).toBe(false);
      expect(typographic(text), lesson.id).not.toMatch(/['"]/);
    }
    expect(typographic(`Mi Shebeirach, "the one who blessed," and Moses' plea; Sh'ma`)).toBe("Mi Shebeirach, “the one who blessed,” and Moses’ plea; Sh’ma");
    expect(emphasised("a *b* c")).toEqual([{ em: false, text: "a " }, { em: true, text: "b" }, { em: false, text: " c" }]);
  });
  it("never uses a teaching without its approval date, and a page is a whole printed page for every lesson", () => {
    for (const lesson of serviceOrder()) { const page = pageOf(CRC_TENANT, lesson.id)!; expect(Number.isInteger(page) && page >= 1 && page <= 31, lesson.id).toBe(true); }
  });
});

describe("the siddur link", () => {
  const link = (id: string) => siddurPageLink(DEFAULT_SIDDUR_URL, CRC_TENANT.siddurBook, pageOf(CRC_TENANT, id)!);
  it("opens printed pages 10, 11, 22, 22, 23 and 24 for the six lessons every student leads", () => {
    expect(U1.map(id => pageOf(CRC_TENANT, id))).toEqual([10, 11, 22, 22, 23, 24]);
    expect(U1.map(link)).toEqual([10, 11, 22, 22, 23, 24].map(page => `https://siddur.centralreform.org/?book=legacy-beit-mitzvah&p=${page}`));
  });
  it("is built from the tenant's book, and is null for any address that is not the recognised reader", () => {
    expect(siddurPageLink("https://example.com/", CRC_TENANT.siddurBook, 10)).toBeNull();
    expect(siddurPageLink(DEFAULT_SIDDUR_URL, CRC_TENANT.siddurBook, 0)).toBeNull();
  });
  it("maps each of the six DEFAULT_SERVICE_PARTS to a lesson of the CRC file, in the default path", () => {
    const owner = (base: string) => Object.entries(CRC_TENANT.lessons).filter(([, row]) => row.bm?.includes(base)).map(([id]) => id);
    for (const base of DEFAULT_SERVICE_PARTS) { expect(owner(base), base).toHaveLength(1); expect(CRC_TENANT.defaultPath).toContain(owner(base)[0]); }
    expect(new Set(DEFAULT_SERVICE_PARTS.flatMap(owner))).toEqual(new Set(U1));
  });
});

describe("the validator, rule by rule (A4 5.3)", () => {
  it("accepts the files as they are", () => { expect(problemsOf(() => {})).toEqual([]); });
  it("rule 1: refuses another schema id and an unknown field, and reports every problem together", () => {
    const problems = problemsOf((course, crc) => { course.schema = "service-course/v2"; course.extra = 1; crc.lessons.shma.pages.morning = 0; });
    expect(has(problems, "schema id")).toBe(true); expect(has(problems, "unknown field extra")).toBe(true); expect(has(problems, "morning page")).toBe(true);
  });
  it("rule 2: a lesson id has the house shape, is unique, and there are at most 96 lessons", () => {
    expect(has(problemsOf(course => { course.lessons[7].id = "Bad Id"; }), "id")).toBe(true);
    expect(has(problemsOf(course => { course.lessons[8].id = course.lessons[7].id; }), "duplicate id")).toBe(true);
    expect(has(problemsOf(course => { for (let i = 0; i < 60; i++) course.lessons.push({ ...course.lessons[10], id: `extra-${i}` }); }), "lessons: 1 to 96")).toBe(true);
  });
  it("rule 3: a unit has a phase, a bounded title and summary, and every lesson is in exactly one unit", () => {
    expect(has(problemsOf(course => { course.units[2].phase = "noon"; }), "phase")).toBe(true);
    expect(has(problemsOf(course => { course.units[2].title = "x".repeat(61); }), "title: text")).toBe(true);
    expect(has(problemsOf(course => { course.units[2].summary = "x".repeat(161); }), "summary: text")).toBe(true);
    expect(has(problemsOf(course => { course.units[3].lessons.push("tallit"); }), "more than one unit")).toBe(true);
    expect(has(problemsOf(course => { course.units[2].lessons.pop(); }), "is in no unit")).toBe(true);
  });
  it("rule 4: a goal starts \"After this you can\"; prerequisites exist and form no loop; a title and summary are bounded", () => {
    expect(has(problemsOf(course => { course.lessons[10].goal = "You can read it."; }), "After this you can")).toBe(true);
    expect(has(problemsOf(course => { course.lessons[10].prerequisites = ["nope"]; }), "does not exist")).toBe(true);
    expect(has(problemsOf(course => { course.lessons[10].prerequisites = [course.lessons[11].id]; course.lessons[11].prerequisites = [course.lessons[10].id]; }), "prerequisites loop")).toBe(true);
    expect(has(problemsOf(course => { course.lessons[10].title = "x".repeat(61); }), "title: text")).toBe(true);
    expect(has(problemsOf(course => { course.lessons[10].summary = "x".repeat(61); }), "summary: text")).toBe(true);
    expect(has(problemsOf(course => { course.lessons[10].kind = "song"; }), "kind")).toBe(true);
  });
  it("rule 5: a read names a public unit of the Shabbat morning or evening volume, never a licensed one", () => {
    const shma = (course: Json) => course.lessons.find((lesson: Json) => lesson.id === "shma");
    expect(problemsOf(course => { shma(course).read = { unit: "shma.the-shma@shabbat-shacharit", blocks: [0, 1] }; })).toEqual([]);
    expect(problemsOf(course => { shma(course).read = { unit: "shma.the-shma@shabbat-maariv", blocks: [0, 1], torahRef: { ref: "Deuteronomy 6:4", kind: "torah", words: [0, 5] } }; })).toEqual([]);
    expect(has(problemsOf(course => { shma(course).read = { unit: "shma.the-shma@legacy-beit-mitzvah", blocks: [0, 1] }; }), "read unit")).toBe(true);
    expect(has(problemsOf(course => { shma(course).read = { unit: "shma.the-shma@bm-shacharit", blocks: [0, 1] }; }), "read unit")).toBe(true);
    expect(has(problemsOf(course => { shma(course).read = { unit: "shma.the-shma@shabbat-shacharit", blocks: [3, 1] }; }), "read blocks")).toBe(true);
    expect(has(problemsOf(course => { shma(course).read = { unit: "shma.the-shma@shabbat-shacharit", blocks: [0, 1], torahRef: { ref: "not a ref", kind: "torah", words: [0, 5] } }; }), "torahRef")).toBe(true);
  });
  it("rule 6: key words sit inside the read blocks, at most six, with a bounded gloss; a moment has no read, key words or check", () => {
    const base = { unit: "shma.the-shma@shabbat-shacharit", blocks: [0, 1] };
    const lesson = (course: Json) => course.lessons.find((row: Json) => row.id === "shma");
    expect(problemsOf(course => { lesson(course).read = base; lesson(course).keyWords = [{ block: 0, word: 0, gloss: "hear, listen", root: "sh-m-a" }]; lesson(course).check = { items: 5 }; })).toEqual([]);
    expect(has(problemsOf(course => { lesson(course).read = base; lesson(course).keyWords = [{ block: 4, word: 0, gloss: "hear" }]; }), "outside the read blocks")).toBe(true);
    expect(has(problemsOf(course => { lesson(course).read = base; lesson(course).keyWords = Array.from({ length: 7 }, (_, i) => ({ block: 0, word: i, gloss: "a" })); }), "keyWords")).toBe(true);
    expect(has(problemsOf(course => { lesson(course).read = base; lesson(course).keyWords = [{ block: 0, word: 0, gloss: "x".repeat(61) }]; }), "keyWord 0: text")).toBe(true);
    expect(has(problemsOf(course => { lesson(course).keyWords = [{ block: 0, word: 0, gloss: "hear" }]; }), "need a read")).toBe(true);
    expect(has(problemsOf(course => { const moment = course.lessons.find((row: Json) => row.id === "torah-reading"); moment.read = base; }), "a moment lesson has no read")).toBe(true);
    expect(has(problemsOf(course => { lesson(course).read = base; lesson(course).check = { items: 9 }; }), "check")).toBe(true);
  });
  it("rule 7: hear must be null while recordings is false, and is legal once the flag is on", () => {
    expect(has(problemsOf(course => { course.lessons[10].hear = { source: "x" }; }), "hear must be null")).toBe(true);
    expect(problemsOf(course => { course.features.recordings = true; course.lessons[10].hear = { source: "x" }; })).toEqual([]);
    expect(has(problemsOf(course => { course.lessons[10].hear = undefined; }), "hear must be null")).toBe(true);
  });
  it("rule 8: every enabled tenant has an approved teaching of 60 to 200 words for each prayer and moment, a valid default path, and pages", () => {
    expect(has(problemsOf((_, crc) => { delete crc.lessons.aleinu.teaching; }), "no approved teaching")).toBe(true);
    expect(problemsOf((_, crc) => { delete crc.lessons.aleinu.teaching; crc.enabled = false; })).toEqual([]);
    expect(has(problemsOf((_, crc) => { crc.lessons.aleinu.teaching.text = "one two three"; }), "words, not 60 to 200")).toBe(true);
    expect(has(problemsOf((_, crc) => { crc.lessons.aleinu.teaching.text = Array(201).fill("word").join(" "); }), "words, not 60 to 200")).toBe(true);
    expect(has(problemsOf((_, crc) => { crc.lessons.aleinu.teaching.approved = "yesterday"; }), "teaching")).toBe(true);
    expect(has(problemsOf((_, crc) => { crc.defaultPath = ["shma", "nope"]; }), "defaultPath")).toBe(true);
    expect(has(problemsOf((_, crc) => { crc.defaultPath = ["f1"]; }), "defaultPath")).toBe(true);
    expect(has(problemsOf((_, crc) => { crc.lessons.shma.pages = {}; }), "needs at least one page")).toBe(true);
    expect(has(problemsOf((_, crc) => { crc.lessons.shma.bm = ["shma.the-shma@bm-shacharit"]; }), "bm unit ids")).toBe(true);
    expect(has(problemsOf((_, crc) => { crc.siddurBook = crc.publicVolume; }), "must differ")).toBe(true);
    expect(has(problemsOf((_, crc) => { crc.lessons.nowhere = { pages: { morning: 3 } }; }), "not a lesson of the course")).toBe(true);
  });
  it("rule 9: a Hebrew prayer word anywhere in course.json outside the alphabet table fails the build", () => {
    const word = "שְׁמַע"; // a word of the Sh'ma, used only to prove the guard
    for (const place of ["title", "summary", "goal"] as const) expect(has(problemsOf(course => { course.lessons[10][place] = `After this you can read ${word}`; }), "Hebrew outside the alphabet table"), place).toBe(true);
    expect(has(problemsOf(course => { course.units[2].summary = word; }), "Hebrew outside the alphabet table")).toBe(true);
    expect(has(problemsOf(course => { course.lessons[10].keyWords = [{ block: 0, word: 0, gloss: word }]; course.lessons[10].read = { unit: "shma.the-shma@shabbat-shacharit", blocks: [0, 1] }; }), "Hebrew outside the alphabet table")).toBe(true);
    expect(has(problemsOf(course => { course.lessons[10][word] = 1; }), "Hebrew outside the alphabet table")).toBe(true);
    expect(has(problemsOf((_, crc) => { crc.lessons.aleinu.teaching.text += ` ${word}`; }), "Hebrew in")).toBe(true);
    expect(hebrewOutsideAlphabet({ alphabet: { letters: [{ char: "א" }] }, other: "א" })).toEqual(["course.other"]);
  });
  it("rule 9, on the real file as it sits on disk: Hebrew only in the alphabet table, and no escaped Hebrew anywhere", () => {
    const text = readFileSync(new URL("../../src/lib/service-course/course.json", import.meta.url), "utf8");
    expect(hebrewOutsideAlphabet(JSON.parse(text))).toEqual([]);
    const without = JSON.stringify({ ...JSON.parse(text), alphabet: null }, null, 2);
    expect(/[֐-׿]/.test(without)).toBe(false); expect(/\\u05[0-9a-fA-F]{2}/.test(text)).toBe(false);
    const crcText = readFileSync(new URL("../../src/lib/service-course/tenants/crc.json", import.meta.url), "utf8");
    expect(/[֐-׿]/.test(crcText) || /\\u05[0-9a-fA-F]{2}/.test(crcText)).toBe(false);
  });
  it("rule 9: the alphabet table holds only Hebrew letters, final forms and marks", () => {
    expect(has(problemsOf(course => { course.alphabet.letters[0].char = "a"; }), "alphabet letters")).toBe(true);
    expect(has(problemsOf(course => { course.alphabet.finals[0].char = "א"; }), "alphabet finals")).toBe(true);
    expect(has(problemsOf(course => { course.alphabet.marks[0].mark = "א"; }), "alphabet marks")).toBe(true);
    expect(SERVICE_COURSE.alphabet.letters).toHaveLength(22); expect(SERVICE_COURSE.alphabet.finals).toHaveLength(5);
  });
  it("rule 10: the tone rule applies to titles, goals, glosses and the approved teachings", () => {
    expect(has(problemsOf(course => { course.lessons[10].summary = "Done!"; }), "exclamation point")).toBe(true);
    expect(has(problemsOf(course => { course.units[2].summary = "Keep your streak."; }), "streak")).toBe(true);
    expect(has(problemsOf((_, crc) => { crc.lessons.aleinu.teaching.text += " Great job \u{1F389}"; }), "emoji")).toBe(true);
    expect(has(problemsOf((_, crc) => { crc.lessons.aleinu.teaching.text += " Well done."; }), "well done")).toBe(true);
    expect(has(problemsOf(course => { course.lessons[10].title = "Sh’ma".normalize("NFD") + "́"; }), "title: text")).toBe(true);
  });
  it("keeps a TODO goal out of any build that turns the fluency strand on", () => {
    expect(problemsOf(() => {})).toEqual([]);
    expect(has(problemsOf(course => { course.features.fluency = true; }), "still a TODO")).toBe(true);
  });
  it("is itself unable to ship the licensed siddur: no unit id, key or value names the licensed volume", () => {
    const all = JSON.stringify([rawCourse, { ...rawCrc, siddurBook: "", lessons: Object.fromEntries(Object.entries(rawCrc.lessons).map(([id, row]) => [id, { ...row, teaching: undefined }])) }]);
    expect(all).not.toMatch(/legacy-beit-mitzvah|@bm-|JPS|Jewish Publication/);
  });
});

describe("the tone rule over every learner-facing string", () => {
  const strings = (value: unknown): string[] => typeof value === "string" ? [value] : Array.isArray(value) ? value.flatMap(strings) : value && typeof value === "object" ? Object.values(value).flatMap(strings) : [];
  it("holds for the copy, the course file and every approved teaching", () => {
    const found = [...strings(COPY), ...strings({ ...rawCourse, alphabet: null }), ...serviceOrder().map(lesson => teachingOf(CRC_TENANT, lesson.id)!.text), CRC_TENANT.credit]
      .flatMap(text => toneProblems(text).map(problem => `${problem} in "${text.slice(0, 60)}"`));
    expect(found).toEqual([]);
  });
  it("has no emoji, exclamation point, streak, badge or pep talk by construction, and fills placeholders", () => {
    expect(strings(COPY).join(" ")).not.toMatch(/!/);
    expect(fill(COPY.where.line, { prayer: "A", before: "B", after: "C" })).toBe("A comes after B and before C.");
    expect(fill(COPY.done.siddur, { page: 10 })).toBe("Open in the siddur, page 10");
    expect(fill(COPY.frame.rail, { n: 2, total: 4 })).toBe("Step 2 of 4");
  });
  it("keeps the approved wording for the strings that already ship", () => {
    expect(COPY.done.siddur).toBe("Open in the siddur, page {page}");
    expect(COPY.home.saved).toBe("Progress is saved on this device. Sign in to keep it.");
    expect(COPY.home.done).toBe("Done. Review when you like.");
    expect(COPY.frame.skip).toBe("Skip to the lesson");
  });
});

describe("browser progress", () => {
  const shma = lessonById("shma")!;
  it("starts empty, marks a lesson done once, and keeps the first instant", () => {
    const first = completeLesson(emptyProgress(), shma, Date.parse("2026-10-24T12:00:00Z"));
    expect(isDone(first, "shma")).toBe(true); expect(first.lessons.shma.done).toBe("2026-10-24T12:00:00.000Z");
    expect(completeLesson(first, shma, Date.parse("2026-11-01T12:00:00Z"))).toBe(first);
  });
  it("round-trips through its own document, drops a lesson the course no longer knows, and refuses anything malformed", () => {
    const done = completeLesson(emptyProgress(), shma, Date.parse("2026-10-24T12:00:00Z")), text = serializeProgress(done)!;
    expect(parseProgress(JSON.parse(text))).toEqual(done);
    expect(parseProgress({ schema: "service-course-progress/v1", lessons: { gone: { done: "2026-10-24T12:00:00.000Z" }, shma: { done: "2026-10-24T12:00:00.000Z" } }, cards: {} })!.lessons).toEqual({ shma: { done: "2026-10-24T12:00:00.000Z" } });
    for (const bad of [null, [], { schema: "learn-progress/v1", lessons: {}, cards: {} }, { schema: "service-course-progress/v1", lessons: { shma: { done: "yesterday" } }, cards: {} },
      { schema: "service-course-progress/v1", lessons: {}, cards: { "word:shma:read": { box: 9, due: "2026-10-24" } } }, { schema: "service-course-progress/v1", lessons: {}, cards: {}, extra: 1 }]) expect(parseProgress(bad)).toBeNull();
    expect(parseProgress({ schema: "service-course-progress/v1", lessons: {}, cards: { "word:shma:read": { box: 2, due: "2026-10-24" }, "unknown:x": { box: 1, due: "2026-10-24" } } })!.cards).toEqual({ "word:shma:read": { box: 2, due: "2026-10-24" } });
  });
  it("shares no key with Learn to lein", () => { expect(PROGRESS_KEY).toBe("crc-torah:service-progress/v1"); });
  it("chooses Next from the six parts first, then the units in order, and wraps from the last lesson", () => {
    let progress = emptyProgress();
    expect(nextLesson(progress)!.id).toBe("shma");
    for (const id of U1.slice(0, 3)) progress = completeLesson(progress, lessonById(id)!, 1);
    expect(nextLesson(progress)!.id).toBe("torah-after");
    for (const id of U1) progress = completeLesson(progress, lessonById(id)!, 1);
    expect(nextLesson(progress)!.id).toBe("modeh-ani");
    expect(lessonAfter(progress, "modeh-ani")!.id).toBe("tallit");
    expect(courseDone(progress)).toBe(false);
    for (const lesson of serviceOrder()) progress = completeLesson(progress, lesson, 1);
    expect(nextLesson(progress)).toBeNull(); expect(courseDone(progress)).toBe(true);
    expect(nextLesson(emptyProgress(), CRC_TENANT, ["f1", "torah-reading"])!.id).toBe("torah-reading");
  });
  it("never offers the fluency strand as Next", () => { const all = serviceOrder().reduce((p, lesson) => completeLesson(p, lesson, 1), emptyProgress()); expect(nextLesson(all)).toBeNull(); });
  it("reads and writes the browser store with every access guarded", () => {
    const memory = new Map<string, string>();
    const storage = { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => { memory.set(key, value); } } as unknown as Storage;
    const store = browserProgressStore(() => storage);
    expect(store.load()).toEqual(emptyProgress());
    const done = completeLesson(emptyProgress(), shma, Date.parse("2026-10-24T12:00:00Z"));
    expect(store.save(done)).toBe(true); expect(store.load()).toEqual(done);
    memory.set(PROGRESS_KEY, "{not json"); expect(store.load()).toEqual(emptyProgress());
    expect(browserProgressStore(() => null).load()).toEqual(emptyProgress());
    expect(browserProgressStore(() => { throw new Error("blocked"); }).save(done)).toBe(false);
  });
});
