import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import raw from "../../src/lib/learn/lessons.json";
import { COURSE, CourseError, lessonById, validateCourse } from "../../src/lib/learn/course";
import type { FirstVerse } from "../../src/lib/learn/course";
import { coursePassages } from "../../src/components/learn/verses-api";
import { toneProblems } from "../../src/lib/learn/tone";

vi.mock("server-only", () => ({}));
// 1.9 T3 wording (Daniel, 2026-10-25) and N19a (the first-verse lesson fixed on Genesis 1:1). Made-up data only.
const own = vi.hoisted(() => ({ value: { status: "none" } as unknown }));
vi.mock("../../src/components/learn/own-reading", async importOriginal => ({ ...await importOriginal<typeof import("../../src/components/learn/own-reading")>(), useOwnReading: () => own.value }));
const { CourseHome } = await import("../../src/components/learn/home");
const { POSITION, BUILD_SAY } = await import("../../src/components/learn/activity-copy");
const { SiddurLink, SiddurPageLink } = await import("../../src/components/portal/siddur-link");
const { default: TropeChartPage } = await import("../../src/app/trope-chart/page");
const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const copy = () => JSON.parse(JSON.stringify(raw)) as Record<string, any>;
const problems = (value: unknown) => { try { validateCourse(value); return []; } catch (error) { return error instanceof CourseError ? [...error.problems] : ["other error"]; } };
const render = (value: unknown) => { own.value = value; return renderToStaticMarkup(createElement(CourseHome)); };
const text = (html: string) => html.replace(/&#x27;/g, "'");
const firstVerse = (id: string) => lessonById(id)!.activities.find((activity): activity is FirstVerse => activity.type === "first-verse")!;

describe("N19a: the Torah first-verse lesson is fixed on Genesis 1:1, with Exodus 25:8 after it", () => {
  it("takes a course source in the validator, and the haftarah lesson keeps the week's", () => {
    expect(firstVerse("torah-first-verse").params.source).toBe("course");
    expect(firstVerse("haftarah-first-verse").params.source).toBe("this-week");
    const course = copy(); const params = course.lessons.find((lesson: any) => lesson.id === "torah-first-verse").activities[0].params;
    expect(problems(course)).toEqual([]);
    params.pick = "shortest-word-ready"; expect(problems(course).some(problem => problem.includes("source or pick"))).toBe(true);
    params.pick = "course-order"; params.source = "elsewhere"; expect(problems(course).some(problem => problem.includes("source or pick"))).toBe(true);
    const week = copy(); const weekParams = week.lessons.find((lesson: any) => lesson.id === "haftarah-first-verse").activities[0].params;
    weekParams.pick = "course-order"; expect(problems(week).some(problem => problem.includes("source or pick"))).toBe(true);
  });
  it("lists Genesis 1:1 (parts 0-2 and 3-6) first and Exodus 25:8 (parts 0-2 and 3-4) second, as whole verses with two phrases", () => {
    const [first, second] = lessonById("torah-first-verse")!.examples;
    expect(first.ref).toBe("Genesis 1:1"); expect(first.phrases).toEqual([{ family: "etnachta", words: [0, 2] }, { family: "sof-pasuk", words: [3, 6] }]);
    expect(second.ref).toBe("Exodus 25:8"); expect(second.words).toEqual([0, 4]); expect(second.phrases).toEqual([{ family: "etnachta", words: [0, 2] }, { family: "sof-pasuk", words: [3, 4] }]);
  });
  it("keeps both verses in the offline course pack", () => {
    const members = coursePassages("torah").flatMap(ref => ref.split("; "));
    expect(members).toEqual(expect.arrayContaining(["Genesis 1:1", "Exodus 25:8"]));
  });
  it("carries the approved lesson wording word for word (N19a-2 to N19a-6, N19a-9)", () => {
    const lesson = lessonById("torah-first-verse")!, unit = COURSE.units.find(row => row.id === "u4-your-first-verse")!;
    expect(lesson.title).toBe("Your first verse");
    expect(lesson.summary).toBe("Lein the Torah's first verse, Genesis 1:1");
    expect(lesson.goal).toBe("After this you have leined Genesis 1:1, one part at a time and then whole.");
    expect(lesson.body).toEqual([
      "You can hear all ten phrases. Now put them together on one verse: Genesis 1:1, the first verse of the Torah. It has two parts, and you have learned every mark in it.",
      "Learn it one part at a time. Hear the first part, chant it back, then try it without the recording. Do the same with the second part, then connect the two and chant the whole verse. Breathe at the rest and at the end.",
      "The reader's version is one good version. If your cantor or tutor sings a phrase differently, theirs wins. For another verse after this one, try Exodus 25:8. It is shorter.",
    ]);
    expect(unit.summary).toBe("Lein Genesis 1:1, one part at a time.");
    for (const line of [lesson.summary, lesson.goal, ...lesson.body]) expect(toneProblems(line), line).toEqual([]);
  });
  it("prefers the course verse and never asks for this week's reading (the student's own reading still comes first)", () => {
    const source = read("src/components/learn/first-verse.tsx");
    expect(source).toContain('useReadingVerses(kind, 0, activity.params.source !== "course")');
    expect(source).toContain('"Genesis 1:1": "The first verse of the Torah."'); expect(source).toContain('"Exodus 25:8": "A shorter verse from Exodus."');
    expect(source).toContain('fromWeek ? "One verse from this week\'s reading."');
    expect(source).toMatch(/own \? "In your reading"/);
    expect(source).toMatch(/!weekCandidates\.length && activity\.params\.source !== "course" &&/);
    const week = read("src/components/learn/week-data.ts");
    expect(week).toContain("weekFallback && (own.status ===");
    expect(week).toContain('if (!weekFallback) return { status: "none" };');
  });
});

describe("CUR-1: the first-phrase row for visitors with no assigned reading", () => {
  it("shows \"This week's first phrase\" on both paths when signed out, opening this week's reading", () => {
    const html = text(render({ status: "none" }));
    expect(html.match(/This week's first phrase/g)).toHaveLength(2);
    expect(html).toContain('href="/learn/prepare" data-first-phrase="torah" data-first-phrase-source="week"');
    expect(html).toContain('href="/learn/prepare?kind=haftarah" data-first-phrase="haftarah" data-first-phrase-source="week"');
    expect(html).not.toContain("First phrase of your verse");
  });
  it("shows nothing while the account answer is pending, and a student's own row is unchanged", () => {
    expect(text(render({ status: "pending" }))).not.toContain("data-first-phrase");
    const html = text(render({ status: "ready", torah: { id: "x", kind: "torah", verses: ["Genesis 23:1"], ranges: ["Genesis 23:1"], needsReview: false }, haftarah: null }));
    expect(html).toContain("First phrase of your verse"); expect(html).not.toContain("This week's first phrase");
  });
});

describe("P4-3 to P4-7: Quick ten's position and Build the phrase's announcements", () => {
  it("words the position as a place in the run, never a count of right answers", () => {
    expect(POSITION.quickTen(3)).toBe("Phrase 3 of 10"); expect(POSITION.quickTenAgain).toBe("One more try");
    const quick = read("src/components/learn/quick-ten.tsx");
    expect(quick).toContain("shown.n < items.length ? POSITION.quickTen(shown.n + 1) : POSITION.quickTenAgain");
  });
  it("words the three announcements", () => {
    expect(BUILD_SAY.placed("Munach", 2, 5)).toBe("Munach, 2 of 5 in place.");
    expect(BUILD_SAY.later("Revia")).toBe("Revia comes later in the phrase.");
    expect(BUILD_SAY.complete).toBe("All the marks are in order.");
    for (const line of [POSITION.quickTen(1), POSITION.quickTenAgain, BUILD_SAY.placed("Munach", 1, 2), BUILD_SAY.later("Revia"), BUILD_SAY.complete]) expect(toneProblems(line), line).toEqual([]);
    const drills = read("src/components/learn/drills.tsx");
    expect(drills).toContain('<p role="status" className="sr-only">{say && <span key={say.n}>{say.text}</span>}</p>');
  });
});

describe("P4-8: every siddur link says it opens a new tab, to screen readers only", () => {
  it("adds the hidden cue to SiddurLink, and so to every link made through it", () => {
    const html = renderToStaticMarkup(createElement(SiddurLink, { href: "https://siddur.example/p/23", children: "Haftarah blessings: siddur page 23" }));
    expect(html).toContain('target="_blank"'); expect(html).toContain('Haftarah blessings: siddur page 23<span class="sr-only">, opens in a new tab</span></a>');
    const page = renderToStaticMarkup(createElement(SiddurPageLink, { siddurUrl: "https://nope.example/", page: 3, children: "x" }));
    expect(page).toBe("");
  });
  it("leaves no siddur link of the app outside SiddurLink", () => {
    for (const path of ["src/components/learn/service/bits.tsx", "src/components/learn/service/home.tsx", "src/components/portal/public-reading/siddur-blessings.tsx", "src/components/portal/workspace/service-learning/my-service.tsx", "src/components/portal/workspace/service-learning/panel.tsx"])
      expect(read(path), path).not.toMatch(/<a [^>]*siddur/i);
  });
});

describe("P4-1 and P4-2: the trope chart's Other signs section", () => {
  const html = text(renderToStaticMarkup(createElement(TropeChartPage)));
  const section = /<details[^>]*data-chart-poetic[^>]*>(.*?)<\/details>/.exec(html)![1];
  it("is a closed section titled Other signs holding exactly ole, dehi, iluy and atnach hafukh, with the approved line", () => {
    expect(html).toMatch(/<details[^>]*data-chart-poetic/); expect(html).not.toMatch(/<details[^>]*data-chart-poetic[^>]*\sopen/);
    expect(section).toContain("<summary");  expect(section).toContain(">Other signs</summary>");
    expect(section).toContain("These signs mark Psalms, Proverbs and Job. They don't appear in a Torah or haftarah reading.");
    expect([...section.matchAll(/data-chart-accent="([0-9A-F]+)"/g)].map(match => match[1]).sort()).toEqual(["05A2", "05AB", "05AC", "05AD"]);
  });
  it("drops the last clause of the context-signs line and keeps every other sign out of the new section", () => {
    expect(html).toContain("Tipcha, pashta, yetiv and zarka join the following phrase. Conjunctive signs take their phrase's color. Both zarka forms are shown.");
    expect(html).not.toContain("additional poetic system");
    expect((html.match(/data-chart-accent=/g) ?? [])).toHaveLength(30);
  });
});
