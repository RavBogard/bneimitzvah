import { describe, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { A, end, source, threePhrases, w } from "./learn-synthetic";
import { verseCardId, VERSE_REVIEW_SCHEMA, type VerseReview } from "../../src/lib/learn/verse-review";

vi.mock("server-only", () => ({}));
// 1.9 N19: the Run-through and the verse cards, rendered as the pages do. Noa is a synthetic student; her verses carry invented syllables.
const own = vi.hoisted(() => ({ value: { status: "none" } as unknown }));
vi.mock("../../src/components/learn/own-reading", async importOriginal => ({ ...await importOriginal<typeof import("../../src/components/learn/own-reading")>(), useOwnReading: () => own.value }));
const requested = vi.hoisted(() => ({ paths: [] as string[] }));
// The public text route, faked: every path the text-only loader asks for is recorded, and each page answers the verses it names.
vi.mock("../../src/components/portal/public-reading/api", async importOriginal => ({ ...await importOriginal<typeof import("../../src/components/portal/public-reading/api")>(),
  getJson: async (path: string) => { requested.paths.push(path); const url = new URL(path, "http://localhost"), ref = url.searchParams.get("ref")!, kind = url.searchParams.get("kind");
    return { kind, ref, offset: 0, nextOffset: null, totalVerses: ref.split("; ").length, translation: {}, verses: ref.split("; ").map(member => ({ ref: member })), chapters: [] }; } }));
vi.mock("../../src/components/portal/workspace/study/api", async importOriginal => ({ ...await importOriginal<typeof import("../../src/components/portal/workspace/study/api")>(),
  parseStudyContent: (row: { verses: { ref: string }[] }) => ({ verses: row.verses.map(verse => ({ ref: verse.ref, english: null, hebrew: source(threePhrases()) })) }) }));
const { HelpLine, VerseRunView, VerseText } = await import("../../src/components/learn/verse-run");
const { RunThroughScreen } = await import("../../src/components/learn/run-through");
const { CourseHome } = await import("../../src/components/learn/home");
const { verseTexts } = await import("../../src/components/learn/verses-api");
const { LiftProgress } = await import("../../src/components/portal/workspace/progress/marks");
const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const textOf = (html: string) => html.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, "\"").replace(/&#x27;/g, "'");
const frame = (body: ReactNode, footer?: ReactNode) => createElement("div", null, body, footer);
const reading = (kind: "torah" | "haftarah", verses: string[]) => ({ id: "22222222-2222-4222-8222-222222222222", kind, revision: 1, verses, ranges: verses, needsReview: false });
const NO_AUDIO = /<audio|<video|data-play|aria-label="(Hear|Play)|Hear it|Listen/;

describe("the Run-through", () => {
  it("shows the approved help line word for word, with each level a button that is never locked", () => {
    const html = renderToStaticMarkup(createElement(HelpLine, { value: "marks", onChange: () => {} }));
    expect(textOf(html)).toBe("Help: Colors → Marks only → Tikkun");
    expect(html.match(/<button/g)).toHaveLength(3);
    expect(html).not.toMatch(/disabled/);
    expect(html).toContain('aria-pressed="true">Marks only');
  });
  it("fades from colours to marks only to the scroll's letters", () => {
    const hebrew = source(threePhrases());
    const colors = renderToStaticMarkup(createElement(VerseText, { verseRef: "Genesis 23:1", kind: "torah", hebrew, level: "colors" }));
    const marks = renderToStaticMarkup(createElement(VerseText, { verseRef: "Genesis 23:1", kind: "torah", hebrew, level: "marks" }));
    const tikkun = renderToStaticMarkup(createElement(VerseText, { verseRef: "Genesis 23:1", kind: "torah", hebrew, level: "tikkun" }));
    expect(colors).toContain("--phrase-color"); expect(marks).not.toContain("--phrase-color"); expect(tikkun).not.toContain("--phrase-color");
    expect(textOf(marks)).toContain(A.etnachta);
    expect(textOf(tikkun)).toMatch(/^[א-ת ]+$/);
  });
  it("asks the student to chant each verse with Clean and Stumbled, colours off, and nothing to play", () => {
    const verses = ["Genesis 23:1", "Genesis 23:2"].map(ref => ({ id: verseCardId("torah", ref), ref, kind: "torah" as const, hebrew: source(threePhrases()) }));
    const html = renderToStaticMarkup(createElement(VerseRunView, { verses, review: null, mode: "run-through", onAnswer: () => {}, onDone: () => {}, frame }));
    expect(html).toContain("Chant this verse"); expect(html).toContain(">Clean<"); expect(html).toContain(">Stumbled<");
    expect(html).toContain('data-help="marks"'); expect(html).not.toContain("--phrase-color");
    expect(html).not.toMatch(NO_AUDIO);
    expect(textOf(html)).not.toMatch(/!|\bof 2\b|\d+ of \d+/);
  });
  it("suggests the tikkun for a settled verse in review, and offers the colours back", () => {
    const id = verseCardId("torah", "Genesis 23:1"), review: VerseReview = { schema: VERSE_REVIEW_SCHEMA, cards: { [id]: { box: 4, due: "2026-11-02" } } };
    const html = renderToStaticMarkup(createElement(VerseRunView, { verses: [{ id, ref: "Genesis 23:1", kind: "torah", hebrew: source([w(A.tipcha, 0), end(1)]) }], review, mode: "review", onAnswer: () => {}, onDone: () => {}, frame }));
    expect(html).toContain('data-help="tikkun"');
    expect(html).toContain('aria-pressed="false">Colors');
  });
  it("is the student's own: a signed-in student with a reading gets the screen; anyone else only the way back", () => {
    own.value = { status: "ready", torah: reading("torah", ["Genesis 23:1", "Genesis 23:2"]), haftarah: null };
    const mine = renderToStaticMarkup(createElement(RunThroughScreen, { kind: null }));
    expect(mine).toContain(">Run-through</h1>"); expect(mine).not.toMatch(NO_AUDIO);
    for (const value of [{ status: "none" }, { status: "pending" }]) {
      own.value = value;
      const html = renderToStaticMarkup(createElement(RunThroughScreen, { kind: null }));
      expect(html).not.toContain("Chant this verse"); expect(html).not.toMatch(NO_AUDIO);
    }
  });
  it("loads its verses through the public text route alone, never a recording or its metadata", async () => {
    requested.paths.length = 0;
    vi.stubGlobal("location", { origin: "http://localhost" });
    const texts = await verseTexts(["Genesis 23:1", "Genesis 23:2", "Genesis 23:8"], "torah", new AbortController().signal);
    expect([...texts.keys()]).toEqual(["Genesis 23:1", "Genesis 23:2", "Genesis 23:8"]);
    expect(requested.paths.length).toBeGreaterThan(0);
    for (const path of requested.paths) { expect(path).toMatch(/^\/api\/public\/text\?/); expect(path).not.toMatch(/short|reference|audio/); }
    vi.unstubAllGlobals();
  });
  it("has a row on the course home only for a student with their own reading", () => {
    own.value = { status: "ready", torah: reading("torah", ["Genesis 23:1"]), haftarah: null };
    expect(renderToStaticMarkup(createElement(CourseHome))).toContain('href="/learn/run-through" data-run-through="true"><span>Run-through</span>');
    for (const value of [{ status: "none" }, { status: "pending" }]) { own.value = value; expect(renderToStaticMarkup(createElement(CourseHome))).not.toContain("Run-through"); }
  });
});

describe("the Got it and Solid criteria", () => {
  const store = (mode: "student" | "tutor" | "parent", firstName = "Noa") => ({
    subscribe: () => () => {}, snapshot: () => 0, stream: mode === "student" ? "self-check" : mode === "tutor" ? "assessment" : null, studentName: firstName,
    verse: () => ({ verseRef: "Genesis 23:1", selfCheck: { state: "got-it", version: 1 }, assessment: { state: "solid", version: 1 } }),
    pending: () => false, notice: () => "", loading: () => false, unverified: () => false, failed: () => false, retry: () => {}, set: async () => {},
  });
  const render = (mode: "student" | "tutor" | "parent") => renderToStaticMarkup(createElement(LiftProgress, { store: store(mode) as never, kind: "torah", verseRef: "Genesis 23:1" }));
  it("tells the student what Got it means, word for word", () => {
    expect(render("student")).toContain("Got it means you chanted this verse twice without the recording and it matched the reader.");
    expect(render("student")).not.toContain("Solid means");
  });
  it("tells the tutor what Solid means, with the child's name and no pronoun", () => {
    const html = render("tutor");
    expect(html).toContain("Solid means Noa chanted it to you without help.");
    expect(html).not.toMatch(/Solid means they|\b(he|she|they|him|her|them)\b chanted/);
    expect(html).not.toContain("Got it means");
  });
  it("gives a parent neither line", () => {
    expect(render("parent")).not.toMatch(/Got it means|Solid means/);
  });
});

describe("N19's words", () => {
  const sources = ["src/components/learn/verse-run.tsx", "src/components/learn/run-through.tsx", "src/lib/learn/verse-review.ts", "src/components/portal/workspace/progress/marks.tsx"].map(read).join("\n");
  it("carry Daniel's approved strings word for word, and no tally", () => {
    for (const line of ["Run-through", "Chant this verse", "Clean", "Stumbled", "Help: ", "Colors", "Marks only", "Tikkun", "Try it in the tikkun.", "Practise ", " again.",
      "Got it means you chanted this verse twice without the recording and it matched the reader.", "Solid means ${store.studentName} chanted it to you without help."]) expect(sources).toContain(line);
    expect(sources).not.toMatch(/Clean: |of \$\{|Colours →|Practice verses/);
  });
  it("use straight apostrophes and no exclamation in any string a learner sees", () => {
    const strings = [...sources.matchAll(/"([^"\n]*)"|`([^`\n]*)`|>([^<>{}\n]+)</g)].map(m => m[1] ?? m[2] ?? m[3]).filter(text => /[A-Za-z]{3}/.test(text));
    for (const text of strings) { expect(text, text).not.toMatch(/[‘’“”]/); expect(text, text).not.toMatch(/[A-Za-z]!(\s|$)/); }
  });
});
