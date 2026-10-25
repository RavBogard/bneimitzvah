import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { COURSE } from "../../src/lib/learn/course";
import { PHRASE_FAMILIES } from "../../src/lib/trope/chart-catalog";

vi.mock("server-only", () => ({}));
// 1.8.2 P4: Learn and trope chart defects (D12, D23, F6 finding 10 and 22, G19's visual part). Made-up data only.
const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const { CourseHome } = await import("../../src/components/learn/home");
const { LessonScreen } = await import("../../src/components/learn/lesson");
const { ReviewScreen } = await import("../../src/components/learn/review");
const { QuickTenScreen } = await import("../../src/components/learn/quick-ten");
const { default: TropeChartPage } = await import("../../src/app/trope-chart/page");

const headingLevels = (html: string) => [...html.matchAll(/<h([1-6])[\s>]/g)].map(match => Number(match[1]));
/** One h1, and no heading more than one level deeper than the one before it. */
function expectSoundOutline(html: string, label: string) {
  const levels = headingLevels(html);
  expect(levels.filter(level => level === 1), `${label}: one h1`).toHaveLength(1);
  expect(levels[0], `${label}: the h1 comes first`).toBe(1);
  levels.forEach((level, i) => { if (i > 0) expect(level, `${label}: heading ${i + 1} (h${level}) after h${levels[i - 1]}`).toBeLessThanOrEqual(levels[i - 1] + 1); });
}

describe("D12: every Learn page has one h1 and no skipped level", () => {
  it("the course home", () => expectSoundOutline(renderToStaticMarkup(createElement(CourseHome)), "course home"));
  it("each lesson's opening screen, the lesson title being the h1", () => {
    for (const lesson of COURSE.lessons) {
      const html = renderToStaticMarkup(createElement(LessonScreen, { id: lesson.id }));
      expectSoundOutline(html, lesson.id);
      expect(html).toMatch(/<h1 class="[^"]*barTitle[^"]*">/);
    }
  });
  it("Review and each Quick ten, the screen's own name being the h1", () => {
    const review = renderToStaticMarkup(createElement(ReviewScreen));
    expectSoundOutline(review, "review");
    expect(review).toMatch(/<h1 class="[^"]*barTitle[^"]*">Review<\/h1>/);
    for (const practice of COURSE.practice) {
      const html = renderToStaticMarkup(createElement(QuickTenScreen, { id: practice.id }));
      expectSoundOutline(html, practice.id);
      expect(html).toMatch(new RegExp(`<h1 class="[^"]*barTitle[^"]*">${practice.title}</h1>`));
    }
  });
  it("the screens that appear later (Done, the end of Quick ten) keep the bar's h1 and put their own title at h2", () => {
    for (const path of ["src/components/learn/lesson.tsx", "src/components/learn/quick-ten.tsx", "src/components/learn/review.tsx"]) {
      const source = read(path);
      expect(source.match(/<h1[\s>]/g), path).toHaveLength(1);
      expect(source, path).toMatch(/<h1 className=\{styles\.barTitle\}>/);
    }
    expect(read("src/components/learn/lesson.tsx")).toMatch(/<h2 className=\{styles\.doneTitle\}>/);
    expect(read("src/components/learn/quick-ten.tsx")).toMatch(/<h2 className=\{styles\.doneTitle\}>/);
  });
  it("keeps the Back to the path link and the Next button inside main", () => {
    for (const path of ["src/components/learn/quick-ten.tsx", "src/components/learn/review.tsx"]) expect(read(path), path).toMatch(/<main[^\n]*\{body\}\{footer && [^\n]*<\/main>/);
  });
});

describe("D23 and the chart half of F6 14: each trope-chart family links to its lesson by the lesson's title", () => {
  const html = renderToStaticMarkup(createElement(TropeChartPage));
  const familyBlocks = [...html.matchAll(/<li[^>]*data-chart-family="([^"]+)"[^>]*>(.*?)<h3>(.*?)<\/h3>/g)];
  it("has a link in every one of the eleven family headings, to a real lesson of that family", () => {
    expect(familyBlocks).toHaveLength(PHRASE_FAMILIES.length);
    for (const [, family, , heading] of familyBlocks) {
      const link = /<a [^>]*href="\/learn\/([^"]+)"[^>]*>([^<]+)<\/a>/.exec(heading);
      expect(link, `${family} has a link`).not.toBeNull();
      const lesson = COURSE.lessons.find(row => row.id === link![1]);
      expect(lesson, `${family} links to a lesson that exists`).toBeDefined();
      expect(lesson!.family).toBe(family);
      expect(link![2].replace(/&#x27;/g, "'")).toBe(lesson!.title);
    }
  });
  it("sends the families both melodies teach to the Torah lesson, and the haftarah-only ending to its own", () => {
    const target = (family: string) => /href="\/learn\/([^"]+)"/.exec(familyBlocks.find(block => block[1] === family)![3])![1];
    expect(target("sof-pasuk")).toBe("torah-sof-pasuk");
    expect(target("zakef-gadol")).toBe("torah-zakef-gadol");
    expect(target("sof-haftarah")).toBe("haftarah-sof-haftarah");
  });
  it("no longer shows a developer credit or a standing status, and keeps the code points out of the visible text", () => {
    expect(html).not.toContain("portal trope catalog");
    expect(html).not.toContain("Chart ready to print.");
    expect(read("src/components/portal/trope-chart/print.tsx")).not.toContain("Chart ready to print.");
    expect(html.replace(/ title="U\+[0-9A-F]{4}"/g, "").replace(/data-chart-accent="[0-9A-F]{4}"/g, "")).not.toMatch(/U\+[0-9A-F]{4}/);
  });
});

describe("F6 finding 10: every lesson on the path is a link, and Next still recommends one", () => {
  const html = renderToStaticMarkup(createElement(CourseHome));
  it("links every lesson of both paths", () => {
    const path = html.slice(html.indexOf('aria-labelledby="path-torah"'));
    for (const lesson of COURSE.lessons) expect(path, lesson.id).toContain(`href="/learn/${lesson.id}"`);
    expect(path.match(/<li class="[^"]*step[^"]*">/g)).toHaveLength(COURSE.lessons.length);
    expect(path.match(/<li class="[^"]*step[^"]*"><a /g)).toHaveLength(COURSE.lessons.length);
  });
  it("still names exactly one Next lesson and keeps the haftarah's advice line", () => {
    expect(html.match(/data-next="/g)).toHaveLength(1);
    expect(html.match(/<a [^>]*data-state="next"/g)).toHaveLength(1);
    expect(html).toContain("Best after The two endings.");
  });
});

describe("F6 finding 20: the Sign in in /learn's saved line is a link", () => {
  it("keeps the sentence and links its two words", () => {
    const html = renderToStaticMarkup(createElement(CourseHome));
    expect(html).toContain('Progress is saved on this device. <a href="/sign-in">Sign in</a> to keep it.');
  });
});

describe("F6 finding 23: Quick ten's tab title carries the product name like every other Learn page", () => {
  it("builds it from the shared page-title helper", () => {
    const source = read("src/app/learn/practice/[id]/page.tsx");
    expect(source).toMatch(/pageTitle\(await readPublicProductName\(\), practice\.title, "Learn to lein"\)/);
    expect(source).not.toContain("| Learn to lein`");
  });
});

describe("F6 finding 22: the drill answer is announced", () => {
  const drills = read("src/components/learn/drills.tsx");
  it("gives every drill that has a choice a polite status region (same or different with the right button's own label)", () => {
    expect(drills).toMatch(/<p role="status" className="sr-only">\{chosen !== null \? item\.same \? "Same tune" : "Different tune" : ""\}<\/p>/);
    expect(drills.match(/role="status"/g)!.length).toBeGreaterThanOrEqual(6);
  });
});

describe("G19's visual part: a wrong choice is an x on a muted fill, never the heavier outline", () => {
  const css = read("src/components/learn/learn.module.css");
  const rule = (selector: string) => {
    const start = css.indexOf(`${selector} {`);
    expect(start, selector).toBeGreaterThanOrEqual(0);
    return css.slice(start, css.indexOf("}", start));
  };
  it("styles the wrong choice with a fill and no outline, in the choice buttons, the look-alike words and the tapped-wrong words", () => {
    for (const selector of ['.choice[data-state="chosen"]', ".lookWord[data-state=\"chosen\"]", ".missed"]) {
      const body = rule(selector);
      expect(body, selector).toMatch(/background: var\(--color-hover\)/);
      expect(body, selector).not.toMatch(/box-shadow: inset 0 0 0 2px/);
    }
    expect(rule('.choice[data-state="chosen"]')).toMatch(/box-shadow: none/);
  });
  it("leaves the right answer the most prominent: a phrase-coloured fill and a check", () => {
    expect(rule('.choice[data-state="right"]')).toMatch(/background: var\(--phrase-color\)/);
    expect(rule('.choice[data-state="chosen"]')).not.toMatch(/--phrase-color/);
  });
  it("marks the wrong choice with the x icon in every choice drill", () => {
    const drills = read("src/components/learn/drills.tsx");
    expect(drills.match(/icons\.wrong/g)).toHaveLength(4);
    expect(read("src/components/learn/bits.tsx")).toMatch(/wrong: svg\(/);
  });
  it("adds no 'one more try' text", () => {
    for (const path of ["src/components/learn/drills.tsx", "src/components/learn/lesson.tsx", "src/components/learn/activity-copy.ts"]) expect(read(path).toLowerCase(), path).not.toContain("one more try");
  });
});
