import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { COURSE } from "../../src/lib/learn/course";

vi.mock("server-only", () => ({}));
// 1.9 N17: Learn wired to the student's own reading. The account answer is mocked (Noa is a synthetic student); the course home is rendered as the page does.
const own = vi.hoisted(() => ({ value: { status: "none" } as unknown }));
vi.mock("../../src/components/learn/own-reading", async importOriginal => ({ ...await importOriginal<typeof import("../../src/components/learn/own-reading")>(), useOwnReading: () => own.value }));
const { CourseHome } = await import("../../src/components/learn/home");
const { LoadFailure } = await import("../../src/components/learn/bits");
const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const reading = (kind: "torah" | "haftarah", verses: string[]) => ({ id: "22222222-2222-4222-8222-222222222222", kind, verses, ranges: verses, needsReview: false });
const render = (value: unknown) => { own.value = value; return renderToStaticMarkup(createElement(CourseHome)); };
const ids = (html: string) => [...html.matchAll(/id="(path-torah|path-haftarah)"/g)].map(match => match[1]);

describe("the course home for a student's own reading", () => {
  it("is exactly today's page for a signed-out visitor, with no row, no link and the Torah path first", () => {
    for (const value of [{ status: "none" }, { status: "pending" }]) {
      const html = render(value);
      expect(html).not.toContain("First phrase of your verse"); expect(html).not.toContain(">My Readings</a>");
      expect(ids(html)).toEqual(["path-torah", "path-haftarah"]);
    }
  });
  it("gives Noa, assigned Genesis 23:1, a first-phrase row after the endings and a link back to her reading", () => {
    const html = render({ status: "ready", torah: reading("torah", ["Genesis 23:1", "Genesis 23:2"]), haftarah: null });
    expect(html).toContain('data-first-phrase="torah"'); expect(html).toContain("First phrase of your verse");
    expect(html).toContain('href="/learn/prepare?ref=Genesis+23%3A1&amp;kind=torah"');
    expect(html).toContain('href="/mine">My Readings</a>');
    expect(html.indexOf("The two endings")).toBeLessThan(html.indexOf("First phrase of your verse"));
    expect(html.indexOf("First phrase of your verse")).toBeLessThan(html.indexOf("Inside the verse"));
    expect(ids(html)).toEqual(["path-torah", "path-haftarah"]);
  });
  it("puts the haftarah path first for a student whose own reading is a haftarah, and keeps Torah first when a Torah is assigned too", () => {
    const only = render({ status: "ready", torah: null, haftarah: reading("haftarah", ["Isaiah 40:1"]) });
    expect(ids(only)).toEqual(["path-haftarah", "path-torah"]);
    expect(only).toContain('data-first-phrase="haftarah"'); expect(only).not.toContain('data-first-phrase="torah"');
    const both = render({ status: "ready", torah: reading("torah", ["Genesis 23:1"]), haftarah: reading("haftarah", ["Isaiah 40:1"]) });
    expect(ids(both)).toEqual(["path-torah", "path-haftarah"]);
    expect(both.match(/data-first-phrase=/g)).toHaveLength(2);
  });
  it("names real units for the rows", () => {
    expect(COURSE.units.map(unit => unit.id)).toEqual(expect.arrayContaining(["u1-the-two-endings", "u5-haftarah-same-phrases-new-tune"]));
  });
  it("reads the assignment only through the existing student workspace API, and only when the progress sync says signed in", () => {
    const source = read("src/components/learn/own-reading.ts");
    expect(source).toMatch(/workspaceApi\.students\("student"\)/); expect(source).toMatch(/workspaceApi\.reading\("student"/);
    expect(source).not.toMatch(/fetch\(/);
    expect(source).toMatch(/state !== "synced"/);
  });
  it("carries the approved strings word for word", () => {
    const text = [read("src/components/learn/own-reading.ts"), read("src/components/learn/home.tsx"), read("src/components/learn/first-verse.tsx"), read("src/components/learn/this-week.tsx")].join("\n");
    for (const line of ["In your reading", "My Readings", "First phrase of your verse"]) expect(text).toContain(line);
  });
});

describe("the ways back from Learn's dead ends (student walk finding 10)", () => {
  const link = (html: string, id: string) => html.match(new RegExp(`<a [^>]*data-testid="${id}"[^>]*>`))?.[0] ?? null;
  it("links a signed-in student's course home and failure screen to their reading, and anyone else's failure screen only back to Learn", () => {
    const ready = { status: "ready", torah: reading("torah", ["Genesis 23:1"]), haftarah: null };
    expect(link(render(ready), "learn-open-reading")).toContain('href="/mine/reading"');
    expect(link(render({ status: "none" }), "learn-open-reading")).toBeNull();
    own.value = ready; const failed = renderToStaticMarkup(createElement(LoadFailure, { onRetry: () => undefined }));
    expect(link(failed, "learn-back")).toContain('href="/learn"'); expect(link(failed, "learn-open-reading")).toContain('href="/mine/reading"');
    own.value = { status: "none" }; const plain = renderToStaticMarkup(createElement(LoadFailure, { onRetry: () => undefined }));
    expect(link(plain, "learn-back")).toContain('href="/learn"'); expect(link(plain, "learn-open-reading")).toBeNull();
  });
});
