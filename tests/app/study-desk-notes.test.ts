import { expect, test } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { additionsFor, fromRabbi, themeHeadings, verseEntries, verseSpan, workKind } from "../../src/components/portal/workspace/study/notes-model";
import { chooseOpen, FOLLOW } from "../../src/components/portal/workspace/study/rail-follow";
import { AboutCard, splitOverview } from "../../src/components/portal/workspace/study/about-card";
import { GuideCard } from "../../src/components/portal/workspace/study/guide-card";
import { GuideStore } from "../../src/components/portal/workspace/study/guide-store";
import { VersePanelScope } from "../../src/components/portal/workspace/study/verse-panel";
import { StudyRows } from "../../src/components/portal/workspace/study/study-rows";
import { StudyLensScope } from "../../src/components/portal/workspace/study-lens";
import { DiscussionsProvider } from "../../src/components/portal/workspace/study/discussions";
import { discussionsView, type DiscussionsAnswer } from "../../src/lib/discussions/answer";
import type { StudentGuideView } from "../../src/components/portal/workspace/study/guide-api";
import type { CommentaryVerseState } from "../../src/components/portal/workspace/study/commentary-api";
import type { CommentaryComment } from "../../src/lib/readings/commentary";
import type { StudyVerse } from "../../src/components/portal/workspace/study/api";
import type { Assigned } from "../../src/components/portal/workspace/api";

// Invented syllables only: never a verse, a translation or a commentary.
const hebrew = "אָבָ֑ג דֵּ֖ה וְזַ֥ח טִֽים׃";
const verse = (ref: string): StudyVerse => ({ ref, english: `Synthetic verse ${ref}`, hebrew: { text: hebrew, readingText: hebrew, segments: [{ kind: "text", text: hebrew }], paragraphAfter: null } });
const comment = (lead: string, english: string): CommentaryComment => ({ hebrew: [{ text: lead, bold: true }, { text: " חִי" }], english: [{ text: english }] });
const ready = (comments: CommentaryComment[]): CommentaryVerseState => ({ status: "ready", comments, editions: [], sefariaUrl: "https://www.sefaria.org/x" });
const LABEL = { origin: "rabbi" as const, reviewed: true, rabbiName: "Rabbi Synthetic" };
const note = (verseRef: string, body: string) => ({ verseRef, body, sources: [] });
const theme = (id: string, title: string, notes: ReturnType<typeof note>[]) => ({ id, title, intro: "A synthetic line.", notes, read: false, readVersion: 0 });
const guideView = (): StudentGuideView => ({ kind: "haftarah", readingKey: null, tickable: false,
  base: { version: 1, label: { origin: "claude", reviewed: false, rabbiName: "Rabbi Synthetic" }, overview: "First synthetic paragraph.\n\nSecond synthetic paragraph.", updatedAt: "2026-10-28T00:00:00Z",
    themes: [theme("claude-theme", "A Claude theme title", [note("II Kings 4:1", "A Claude base note.")])] },
  additions: { version: 1, label: LABEL, updatedAt: "2026-10-28T00:00:00Z", themes: [theme("student--one", "A rabbi theme title", [note("II Kings 4:2", "A rabbi note for this student."), note("II Kings 4:4", "Another.")])] } });

test("a classical commentary is rust, the Women's Commentary is modern, and the rabbi's are plum", () => {
  expect(workKind("rashi")).toBe("classic"); expect(workKind("radak")).toBe("classic"); expect(workKind("womens")).toBe("modern");
  const entries = verseEntries({ ref: "Genesis 1:1", works: [{ work: "rashi", state: ready([comment("דה", "one")]) }, { work: "womens", state: ready([comment("וזח", "two")]) }],
    discussions: [], additions: additionsFor(guideView() as never, "Genesis 1:1"), rabbiName: "Rabbi Synthetic", words: ["אבג", "דה", "וזח", "טים"] });
  expect(entries.kinds).toEqual(["classic", "modern"]);
  expect(entries.names).toEqual(["Rashi", "Women’s Commentary"]);
  expect(fromRabbi("Rabbi Synthetic")).toBe("From Rabbi Synthetic"); expect(fromRabbi(null)).toBe("From the rabbi");
});

test("lemma letters go on the word and the note, in order of the word, and only where the words are found once", () => {
  const words = ["אבג", "דה", "וזח", "טים"];
  const entries = verseEntries({ ref: "Genesis 1:1", discussions: [], additions: [], words, works: [{ work: "rashi", state: ready([comment("וזח", "later word"), comment("דה", "earlier word"), comment("קרש", "not in the verse")]) }] });
  expect(entries.notes.map(row => row.letter)).toEqual(["b", "a", undefined]);
  expect([...entries.marks]).toEqual([[1, "a"], [2, "b"]]);
  expect(verseEntries({ ref: "x 1:1", discussions: [], additions: [], words: [], works: [{ work: "rashi", state: ready([comment("דה", "x")]) }] }).marks.size).toBe(0);
});

test("only the rabbi-written additions reach the notes: the base guide's notes and themes are not even offered", () => {
  const view = guideView();
  expect(additionsFor(view, "II Kings 4:1")).toEqual([]);
  expect(additionsFor(view, "II Kings 4:2").map(row => row.note.body)).toEqual(["A rabbi note for this student."]);
  const headings = themeHeadings(view, ["II Kings 4:1", "II Kings 4:2", "II Kings 4:3", "II Kings 4:4"], text => text);
  expect(headings).toEqual([{ id: "student--one", title: "A rabbi theme title", intro: "A synthetic line.", span: "4:2–4", first: "II Kings 4:2" }]);
  expect(themeHeadings({ additions: null }, ["II Kings 4:1"], text => text)).toEqual([]);
  expect(verseSpan("II Kings 4:30", "II Kings 5:2")).toBe("4:30–5:2");
});

test("the notes column opens the first verse with entries at or after the first row past the reading line, and keeps the open one while it is on screen above the line", () => {
  const entries = ["v2", "v5", "v9"], height = 1000, line = height * FOLLOW.line;
  const rows = (tops: number[]) => tops.map((top, index) => ({ ref: `v${index + 1}`, top, bottom: top + 100 }));
  // Rows 1..3 stand above the line, row 4 is the first whose bottom passes it: the first entry at or after v4 is v5.
  expect(chooseOpen(rows([-300, -200, -100, 280, 400, 500, 600, 700, 800]), entries, null, height)).toBe("v5");
  // Row 3 (v3) is the first whose bottom passes the line, so the first entry at or after it, v5, opens; with the line above row 2 instead, v2 does.
  expect(chooseOpen(rows([0, 100, 200, 300, 400, 500, 600, 700, 800]), entries, null, height)).toBe("v5");
  expect(chooseOpen(rows([200, 300, 400, 500, 600, 700, 800, 900, 1000]), entries, null, height)).toBe("v2");
  // v2 is still on screen above the line (bottom 150 > 80, top 50 < line), so it stays open although v3 is the first row past the line (v5 would be next).
  expect(chooseOpen(rows([-150, 50, 260, 360, 460, 560, 660, 760, 860]), entries, "v2", height)).toBe("v2");
  expect(chooseOpen(rows([-150, 50, 260, 360, 460, 560, 660, 760, 860]), entries, null, height)).toBe("v5");
  // Once v2 has scrolled off the top (its bottom is under 80), the column moves on.
  expect(chooseOpen(rows([-300, -140, 260, 360, 460, 560, 660, 760, 860]), entries, "v2", height)).toBe("v5");
  // Past the last entry: the last one stays.
  expect(chooseOpen(rows([-900, -800, -700, -600, -500, -400, -300, -200, 300]), entries, "v9", height)).toBe("v9");
  expect(chooseOpen(rows([0]), [], null, height)).toBeNull();
  expect(line).toBe(330);
});

const baseline = { student: { id: "10000000-0000-4000-8000-000000000001" }, mode: "student", context: null,
  readings: [{ id: "10000000-0000-4000-8000-000000000002", kind: "haftarah", revision: 1, ranges: ["II Kings 4:1-4"], verses: ["II Kings 4:1", "II Kings 4:2", "II Kings 4:3", "II Kings 4:4"], readingKey: null }] } as unknown as Assigned;
async function store(view: StudentGuideView) {
  const guide = new GuideStore(async () => ({ view, sheet: null })); guide.configure(baseline); await guide.load("haftarah"); return guide;
}

test("the About card: the medallion, the heading, the first paragraph, Read more for the rest, the label; no themes, no ticks, no link to themes", async () => {
  const markup = renderToStaticMarkup(createElement(AboutCard, { store: await store(guideView()), kind: "haftarah" }));
  expect(markup).toContain('src="/brand/mural-512.png"'); expect(markup).toContain('alt=""');
  expect(markup).toContain(">About this haftarah</h3>"); expect(markup).toContain('data-study-about="guide"'); expect(markup).not.toContain("data-portion-summary-credit");
  expect(markup).toContain("First synthetic paragraph."); expect(markup).toContain("Second synthetic paragraph.");
  expect(markup).toContain(">Read more</button>");
  expect(markup).toContain('data-guide-label="claude-draft"');
  expect(markup).not.toContain("Claude theme"); expect(markup).not.toContain("A Claude base note"); expect(markup).not.toMatch(/Study the themes|I read this|theme/i);
  expect(splitOverview("One.\n\nTwo.\n\nThree.")).toEqual({ first: "One.", rest: "Two.\n\nThree." });
  // One paragraph: nothing to expand.
  expect(renderToStaticMarkup(createElement(AboutCard, { store: await store({ ...guideView(), base: { ...guideView().base!, overview: "Only one." } }), kind: "haftarah" }))).not.toContain("Read more");
  // No overview (a rabbi-written guide only): no card at all.
  expect(renderToStaticMarkup(createElement(AboutCard, { store: await store({ ...guideView(), base: null }), kind: "haftarah" }))).toBe("");
});

test("Lein's overview card has no tick and no walk, and shows only the rabbi-written themes for this student", async () => {
  const markup = renderToStaticMarkup(createElement(GuideCard, { store: await store(guideView()), kind: "haftarah", firstName: "Noa", learner: true }));
  expect(markup).not.toContain("guide-tick"); expect(markup).not.toContain("I read this"); expect(markup).not.toContain("data-guide-study"); expect(markup).not.toContain("Study the themes");
  expect(markup).not.toContain("A Claude theme title");
  expect(markup).toContain("A rabbi theme title"); expect(markup).toContain("Added for you");
});

test("Study draws the rabbi's notes and headings, labelled from the setting, and never the base guide's; a verse with nothing has no line in the column", () => {
  const view = guideView(), verses = ["II Kings 4:1", "II Kings 4:2", "II Kings 4:3", "II Kings 4:4"].map(verse);
  const answer: DiscussionsAnswer = { productName: "Synthetic Torah", rabbiName: "Rabbi Synthetic", complete: true, truncated: false, discussions: [{ slug: "d1", title: "A curated discussion", kind: "haftarah", anchors: ["II Kings 4:3"],
    sources: [{ position: 1, ref: "Shemot Rabbah 31:1", anchorRef: "II Kings 4:3", kind: "edition", edition: "E", credit: null, sefariaUrl: "https://www.sefaria.org/x", selectedBy: "Selected by Rabbi Synthetic", text: null }] }] } as never;
  const markup = renderToStaticMarkup(createElement(StudyLensScope, { storageKey: null, query: "study", children: createElement(DiscussionsProvider, { value: discussionsView(answer), children:
    createElement(VersePanelScope, { children: createElement(StudyRows, { verses, group: "g", works: () => [], additions: (ref: string) => additionsFor(view, ref), headings: themeHeadings(view, verses.map(row => row.ref), text => text) }) }) }) }));
  // The column lists the two verses that have the rabbi's entries (4:2 a note for this student, 4:3 a curated discussion, 4:4 a note), and not 4:1.
  expect([...markup.matchAll(/data-rail-item="([^"]+)"/g)].map(row => row[1])).toEqual(["II Kings 4:2", "II Kings 4:3", "II Kings 4:4"]);
  expect(markup).toContain("From Rabbi Synthetic");
  expect(markup).toContain("A rabbi note for this student."); expect(markup).toContain("A curated discussion");
  expect(markup).not.toContain("A Claude base note."); expect(markup).not.toContain("A Claude theme title");
  // The rabbi's guide has its heading where the theme starts: its title, its line and its verses.
  expect(markup).toMatch(/data-theme-heading="student--one"[^>]*><h4>A rabbi theme title<\/h4><p>A synthetic line\.<\/p><span class="[^"]*" dir="ltr">4:2–4<\/span>/);
  expect(markup).toContain('data-note-dots="rabbi"');
  // The reading's curated sources close the page.
  expect(markup.indexOf("data-sources-rail")).toBeGreaterThan(markup.indexOf("data-study-rail"));
});
