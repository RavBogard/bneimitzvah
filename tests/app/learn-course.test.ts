import { describe, expect, it } from "vitest";
import raw from "../../src/lib/learn/lessons.json";
import { COURSE, COURSE_SCHEMA, CourseError, FAMILY_IDS, isDrill, lessonById, lessonMinutes, parsePattern, pathLessons, presentGoal, validateCourse } from "../../src/lib/learn/course";
import { PHRASE_FAMILIES } from "../../src/lib/trope/chart-catalog";

const copy = () => JSON.parse(JSON.stringify(raw)) as Record<string, any>;
const problems = (value: unknown) => { try { validateCourse(value); return []; } catch (error) { return error instanceof CourseError ? [...error.problems] : ["other error"]; } };

describe("the Learn to lein course data", () => {
  it("parses with its schema id, eight units and twenty-four lessons", () => {
    expect(COURSE.schema).toBe(COURSE_SCHEMA);
    expect(COURSE.units).toHaveLength(8);
    expect(COURSE.lessons).toHaveLength(24);
    expect(pathLessons("torah").map(lesson => lesson.id)[0]).toBe("intro-phrases");
    expect(pathLessons("torah").at(-1)!.id).toBe("torah-first-verse");
    expect(pathLessons("haftarah").at(-1)!.id).toBe("haftarah-first-verse");
  });
  it("uses exactly the chart catalogue's eleven family ids, with sof-haftarah only as the haftarah context", () => {
    expect([...FAMILY_IDS].sort()).toEqual(PHRASE_FAMILIES.map(family => family.id).sort());
    expect(Object.keys(COURSE.families).sort()).toEqual([...FAMILY_IDS].sort());
    for (const lesson of COURSE.lessons) if (lesson.family === "sof-haftarah") expect(lesson.melody).toBe("haftarah");
  });
  it("puts every lesson in exactly one unit and keeps prerequisites real and acyclic", () => {
    const placed = COURSE.units.flatMap(unit => unit.lessons);
    expect(new Set(placed).size).toBe(placed.length);
    expect([...placed].sort()).toEqual(COURSE.lessons.map(lesson => lesson.id).sort());
    expect(lessonById("haftarah-sof-pasuk")!.prerequisites).toEqual(expect.arrayContaining(["torah-sof-pasuk", "torah-etnachta"]));
    const doubled = copy(); doubled.units[1].lessons.push("intro-phrases");
    expect(problems(doubled).some(p => p.includes("two units"))).toBe(true);
    const missing = copy(); missing.lessons[2].prerequisites = ["no-such-lesson"];
    expect(problems(missing).some(p => p.includes("unknown prerequisite"))).toBe(true);
    const cycle = copy(); cycle.lessons[0].prerequisites = ["torah-etnachta"];
    expect(problems(cycle).some(p => p.includes("cycle"))).toBe(true);
    const crossing = copy(); crossing.lessons.find((l: any) => l.id === "haftarah-sof-pasuk").prerequisites = ["torah-sof-pasuk"];
    expect(problems(crossing).some(p => p.includes("two Torah endings"))).toBe(true);
  });
  it("knows every activity type and keeps params inside ACTIVITIES.md's ranges", () => {
    const unknown = copy(); unknown.lessons[1].activities[0].type = "quick-ten";
    expect(problems(unknown).some(p => p.includes("unknown type"))).toBe(true);
    const many = copy(); many.lessons[1].activities[0].params.choices = 5;
    expect(problems(many).some(p => p.includes("choices"))).toBe(true);
    const family = copy(); family.lessons[1].activities[0].params.families = ["sof-pasuk", "sof-haftarah"];
    expect(problems(family).some(p => p.includes("families"))).toBe(true);
    const stray = copy(); stray.lessons[1].activities[0].params.timer = 10;
    expect(problems(stray).some(p => p.includes("unknown params"))).toBe(true);
    for (const lesson of COURSE.lessons) {
      const items = lesson.activities.filter(isDrill).reduce((sum, a) => sum + a.params.items, 0);
      if (lesson.family) expect(items, lesson.id).toBeGreaterThanOrEqual(8);
      expect(lessonMinutes(lesson)).toBeGreaterThanOrEqual(3);
      expect(lessonMinutes(lesson)).toBeLessThanOrEqual(5);
    }
  });
  it("splits build patterns on whole trope ids", () => {
    expect(parsePattern("munach-zakef-katan")).toEqual(["munach", "zakef-katan"]);
    expect(parsePattern("mahpach-pashta-zakef-katan")).toEqual(["mahpach", "pashta", "zakef-katan"]);
    expect(parsePattern("mercha-tipcha-silluq")).toEqual(["mercha", "tipcha", "silluq"]);
    expect(parsePattern("mercha-nothing")).toBeNull();
  });
  it("keeps bodies to about 120 words and every string inside the tone rule", () => {
    for (const lesson of COURSE.lessons) expect(lesson.body.join(" ").split(/\s+/).length, lesson.id).toBeLessThanOrEqual(130);
    const long = copy(); long.lessons[0].body = [Array.from({ length: 140 }, () => "word").join(" ")];
    expect(problems(long).some(p => p.includes("longer than"))).toBe(true);
    for (const bad of ["Great job!", "You got this", "Keep it up", "Level up your leining", "Your streak", "A badge", "Awesome", "Nice 🎉"]) {
      const value = copy(); value.lessons[3].listenFor = bad;
      expect(problems(value).length, bad).toBeGreaterThan(0);
    }
  });
  it("leads each kadma v'azla lesson with kadma and azla together, as its description opens", () => {
    // The haftarah lesson once led with gershayim alone (Isaiah 6:8), against its own first sentence.
    for (const id of ["torah-azla", "haftarah-azla"]) expect(lessonById(id)!.examples[0].tropes).toEqual(["kadma", "geresh"]);
    expect(lessonById("haftarah-azla")!.examples.map(example => example.ref)).toEqual(["Isaiah 54:11", "Isaiah 6:8", "Micah 6:8", "Isaiah 54:10", "Amos 9:12", "I Kings 18:9"]);
  });
  it("words each lesson's goal for the end screen in the present", () => {
    expect(presentGoal(lessonById("torah-etnachta")!.goal)).toBe("You can hear where a verse rests in the middle, and tell that rest from the ending.");
    expect(presentGoal(lessonById("torah-first-verse")!.goal)).toBe("You have leined Genesis 1:1, one part at a time and then whole.");
  });
  it("never carries a field derived from the private index", () => {
    const text = JSON.stringify(raw);
    expect(text).not.toMatch(/"(?:alignScore|recording|indexWords)"\s*:/);
    const leaked = copy(); leaked.lessons[1].examples[0].alignScore = 0.5;
    expect(problems(leaked).some(p => p.includes("unknown field"))).toBe(true);
  });
});
