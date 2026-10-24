import { expect, test } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { appendixChapters, buildAppendix, isPrintableLicense, printableCoverage, type AppendixSource, type AppendixVerse } from "../../src/lib/print/appendix";
import { COMMENTARY_WORKS, commentaryCandidates, parseCommentaryChapter, type CommentaryComment, type CommentaryEdition, type CommentaryLicense } from "../../src/lib/readings/commentary";
import { createCommentaryChapterStore } from "../../src/components/portal/workspace/study/commentary-api";
import { DEFAULT_FORMAT } from "../../src/lib/print/sheet-format";
import { PrintDocument } from "../../src/components/portal/print/document";
import { studyEditions } from "../../src/components/portal/workspace/study/credits";
import type { StudyVerse } from "../../src/components/portal/workspace/study/api";

// The print sheet's commentary appendix. Synthetic only: invented Hebrew built from code points and numbered English; no commentary text
// of any edition is ever in the repository.
const invented = (n: number) => `${String.fromCodePoint(0x05d0 + (n % 20), 0x05d1, 0x05d2)} ${n}`;
const comment = (n: number, hebrew = true, english = true): CommentaryComment => ({
  hebrew: hebrew ? [{ text: invented(n), bold: true }, { text: ` ${invented(n + 1)}` }] : null,
  english: english ? [{ text: `Synthetic English comment ${n}.` }] : null,
});
const edition = (language: "he" | "en", license: CommentaryLicense, title = `Synthetic ${language} edition`): CommentaryEdition =>
  ({ language, title, license, credit: `${title}, via Sefaria (${license}). Synthetic credit.`, url: "https://www.sefaria.org/Synthetic" });
const ready = (comments: readonly CommentaryComment[], editions: readonly CommentaryEdition[]): AppendixVerse => ({ status: "ready", comments, editions });
const source = (work: string, rows: Record<string, AppendixVerse>): AppendixSource => ({ work, label: work.toUpperCase(), forVerse: ref => rows[ref] ?? { status: "none" } });
const REFS = ["Genesis 1:1", "Genesis 1:2", "Genesis 1:3"];

test("the licence filter prints public domain, CC0, CC BY and CC BY-NC in any version, and nothing else", () => {
  for (const license of ["Public Domain", "public domain", "Public-Domain", "CC0", "CC0 1.0", "CC-BY", "CC BY", "CC BY 4.0", "CC-BY-3.0", "CC-BY-NC", "CC BY-NC", "CC BY-NC 3.0", "cc-by-nc-4.0"])
    expect(isPrintableLicense(license), license).toBe(true);
  for (const license of ["unknown", "", "  ", "CC-BY-SA", "CC BY-SA 4.0", "CC-BY-ND", "CC BY-ND 4.0", "CC-BY-NC-SA", "CC BY-NC-SA 4.0", "CC-BY-NC-ND", "Copyrighted", "All rights reserved", "CC", "CC-BY-SA-NC"])
    expect(isPrintableLicense(license), license).toBe(false);
});

test("every pinned edition's licence class is decided by the filter: which works print, in which language, on which books", () => {
  const verdict = (work: string, book: string, language: "he" | "en") => {
    const chapter = parseCommentaryChapter(work, `${book} 1`)!;
    const rows = commentaryCandidates(chapter)[language];
    return rows.length ? rows.some(row => isPrintableLicense(row.license)) : null;
  };
  expect(verdict("rashi", "Genesis", "he")).toBe(true);
  expect(verdict("rashi", "Genesis", "en")).toBe(true);
  expect(verdict("womens", "Genesis", "en")).toBe(true); // CC BY-NC
  expect(verdict("womens", "Genesis", "he")).toBeNull();
  expect(verdict("ibn-ezra", "Genesis", "en")).toBe(true); // CC BY-NC
  expect(verdict("ramban", "Genesis", "he")).toBe(true);
  expect(verdict("ramban", "Exodus", "he")).toBe(false); // Sefaria states no licence for that Hebrew
  expect(verdict("ramban", "Exodus", "en")).toBe(true);
  expect(verdict("radak", "Isaiah", "he")).toBe(false); // no stated licence
  expect(verdict("radak", "Isaiah", "en")).toBe(true); // CC0
  expect(verdict("metzudat-david", "Isaiah", "en")).toBe(true); // the community translation (CC0) is the printable one for the three books with no stated CC BY
  expect(verdict("metzudat-david", "Isaiah", "he")).toBe(true);
  // Every work has a printable edition on every book it covers: none is wholly left out of print.
  for (const work of Object.keys(COMMENTARY_WORKS)) {
    const refs = work === "radak" || work === "metzudat-david" ? ["Isaiah 40:1"] : ["Genesis 1:1"];
    expect(printableCoverage(work, refs), work).toBe("printable");
  }
  // A work that does not cover the reading is not offered at all.
  expect(printableCoverage("womens", ["Isaiah 40:1"])).toBe("uncovered");
  expect(printableCoverage("radak", ["Genesis 1:1"])).toBe("uncovered");
  expect(printableCoverage("rashi", ["Isaiah 40:1", "Genesis 1:1"])).toBe("printable");
});

test("the appendix is grouped by verse in reading order, each work's comments in order, each followed by its credit", () => {
  const rashi = source("rashi", { "Genesis 1:1": ready([comment(1), comment(2)], [edition("he", "Public Domain", "Rashi HE"), edition("en", "Public Domain", "Rashi EN")]), "Genesis 1:3": ready([comment(3)], [edition("he", "CC0", "Rashi HE"), edition("en", "CC-BY", "Rashi EN")]) });
  const womens = source("womens", { "Genesis 1:1": ready([comment(9, false, true)], [edition("en", "CC-BY-NC", "Women EN")]), "Genesis 1:2": ready([comment(8, false, true)], [edition("en", "CC-BY-NC", "Women EN")]) });
  const groups = buildAppendix(REFS, [rashi, womens], "both");
  expect(groups.map(group => group.ref)).toEqual(["Genesis 1:1", "Genesis 1:2", "Genesis 1:3"]);
  expect(groups[0].works.map(work => work.work)).toEqual(["rashi", "womens"]);
  expect(groups[0].works[0].comments).toEqual([comment(1), comment(2)]);
  expect(groups[0].works[0].credits).toEqual(["Rashi HE, via Sefaria (Public Domain). Synthetic credit.", "Rashi EN, via Sefaria (Public Domain). Synthetic credit."]);
  expect(groups[0].works[1].credits).toEqual(["Women EN, via Sefaria (CC-BY-NC). Synthetic credit."]);
  expect(groups[1].works.map(work => work.work)).toEqual(["womens"]);
  expect(groups[2].works.map(work => work.work)).toEqual(["rashi"]);
  // Verses with nothing, loading or failed verses, and an empty choice, make no group.
  expect(buildAppendix(["Genesis 1:9"], [rashi, womens], "both")).toEqual([]);
  expect(buildAppendix(REFS, [{ work: "rashi", label: "R", forVerse: () => ({ status: "loading" }) }, { work: "womens", label: "W", forVerse: () => ({ status: "failed" }) }], "both")).toEqual([]);
  expect(buildAppendix(REFS, [], "both")).toEqual([]);
});

test("each licence class is kept or left out per edition, per language, and credits name only what prints", () => {
  const verses = (licenses: Record<"he" | "en", CommentaryLicense>) => source("rashi", { "Genesis 1:1": ready([comment(1)], [edition("he", licenses.he, "H"), edition("en", licenses.en, "E")]) });
  for (const printable of ["Public Domain", "CC0", "CC-BY", "CC-BY-NC"] as const) {
    const [group] = buildAppendix(REFS, [verses({ he: printable, en: printable })], "both");
    expect(group.works[0].comments).toEqual([comment(1)]);
    expect(group.works[0].credits).toHaveLength(2);
  }
  for (const blocked of ["CC-BY-SA", "unknown"] as const) {
    // Both languages blocked: nothing prints, and no credit is printed for what is not.
    expect(buildAppendix(REFS, [verses({ he: blocked, en: blocked })], "both")).toEqual([]);
    // One language blocked: only the other prints, with only its credit.
    const [hebrewOnly] = buildAppendix(REFS, [verses({ he: "CC0", en: blocked })], "both");
    expect(hebrewOnly.works[0].comments).toEqual([{ hebrew: comment(1).hebrew, english: null }]);
    expect(hebrewOnly.works[0].credits).toEqual(["H, via Sefaria (CC0). Synthetic credit."]);
    const [englishOnly] = buildAppendix(REFS, [verses({ he: blocked, en: "CC-BY-NC" })], "both");
    expect(englishOnly.works[0].comments).toEqual([{ hebrew: null, english: comment(1).english }]);
    expect(englishOnly.works[0].credits).toEqual(["E, via Sefaria (CC-BY-NC). Synthetic credit."]);
  }
  // A comment that has only the blocked language is dropped, and a verse left with none is not listed.
  const mixed = source("rashi", { "Genesis 1:1": ready([comment(1, true, false), comment(2, true, true)], [edition("he", "unknown"), edition("en", "CC-BY")]) });
  expect(buildAppendix(REFS, [mixed], "both")[0].works[0].comments).toEqual([{ hebrew: null, english: comment(2).english }]);
  expect(buildAppendix(REFS, [source("rashi", { "Genesis 1:1": ready([comment(1, true, false)], [edition("he", "CC-BY-SA"), edition("en", "CC-BY")]) })], "both")).toEqual([]);
});

test("the sheet's Languages choice picks the commentary language, falling back to the one the work has", () => {
  const both = source("rashi", { "Genesis 1:1": ready([comment(1), comment(2, false, true)], [edition("he", "CC0"), edition("en", "CC0")]) });
  const english = buildAppendix(REFS, [both], "english")[0].works[0];
  expect(english.comments).toEqual([{ hebrew: null, english: comment(1).english }, { hebrew: null, english: comment(2).english }]);
  expect(english.credits).toEqual(["Synthetic en edition, via Sefaria (CC0). Synthetic credit."]);
  const hebrew = buildAppendix(REFS, [both], "hebrew")[0].works[0];
  // The second comment has no Hebrew, so its English stands in rather than the comment vanishing.
  expect(hebrew.comments).toEqual([{ hebrew: comment(1).hebrew, english: null }, { hebrew: null, english: comment(2).english }]);
  expect(hebrew.credits).toHaveLength(2);
});

test("the chapters asked for are the distinct covered chapters of the reading, uncapped", () => {
  expect(appendixChapters("rashi", ["Genesis 1:31", "Genesis 2:1", "Genesis 2:2"])).toEqual(["Genesis 1", "Genesis 2"]);
  expect(appendixChapters("womens", ["Isaiah 40:1"])).toEqual([]);
  const long = Array.from({ length: 24 }, (_, i) => `Psalms ${i + 1}:1`);
  expect(appendixChapters("rashi", long)).toEqual([]);
  const genesis = Array.from({ length: 50 }, (_, i) => `Genesis ${i + 1}:1`);
  expect(appendixChapters("rashi", genesis)).toHaveLength(50);
});

test("the page's chapter store (the one Study uses) feeds the appendix, and a failed work stays out", async () => {
  const chapter = { work: "rashi", chapter: "Genesis 1", verses: { "1": { comments: [comment(1)] } }, editions: [edition("he", "Public Domain"), edition("en", "Public Domain")] };
  const store = createCommentaryChapterStore("rashi", async () => chapter as never);
  const broken = createCommentaryChapterStore("womens", async () => { throw new Error("offline"); });
  await new Promise<void>(resolve => { let n = 0; const done = () => { if (++n >= 2) resolve(); }; store.load(["Genesis 1"], done); broken.load(["Genesis 1"], done); });
  const sources = [store, broken].map(s => ({ work: s.work, label: s.work, forVerse: (ref: string) => s.forVerse(ref) }));
  expect(buildAppendix(["Genesis 1:1", "Genesis 1:2"], sources, "both").map(group => [group.ref, group.works.map(work => work.work)])).toEqual([["Genesis 1:1", ["rashi"]]]);
  expect(broken.forVerse("Genesis 1:1").status).toBe("failed");
});

const verse = (ref: string, n: number): StudyVerse => {
  const text = invented(n);
  return { ref, english: `Synthetic English for verse ${n}.`, hebrew: { text, readingText: text, segments: [{ kind: "text", text }], paragraphAfter: null } };
};
const render = (appendix: Parameters<typeof PrintDocument>[0]["appendix"]) => renderToStaticMarkup(createElement(PrintDocument, {
  heading: { title: "Synthetic portion", passage: "Torah Genesis 1:1–2", date: null },
  text: { verses: [verse("Genesis 1:1", 1), verse("Genesis 1:2", 2)], chapters: [{ ref: "Genesis 1", sefariaUrl: "https://www.sefaria.org/Genesis.1", fetchedAt: 0, hash: "a".repeat(64), editions: [studyEditions.mam, studyEditions.jps2023] }] },
  markers: new Map(), format: DEFAULT_FORMAT, productName: "Test Torah", appendix }));

test("the document prints the appendix on its own section after the reading, with verse headings and credits; none by default", () => {
  expect(render(undefined)).not.toContain("data-print-appendix");
  expect(render([])).not.toContain("data-print-appendix");
  const groups = buildAppendix(REFS.slice(0, 2), [source("rashi", { "Genesis 1:1": ready([comment(1)], [edition("he", "CC0", "Synthetic HE"), edition("en", "CC-BY", "Synthetic EN")]), "Genesis 1:2": ready([comment(2, false, true)], [edition("en", "CC-BY-NC", "Synthetic EN")]) })], "both");
  const html = render(groups);
  expect(html.indexOf("</table>")).toBeGreaterThan(0);
  expect(html.indexOf("data-print-appendix")).toBeGreaterThan(html.indexOf("</table>"));
  expect(html).toContain(`aria-label="Commentary"`);
  const refs = [...html.matchAll(/data-appendix-ref="([^"]+)"/g)].map(match => match[1]);
  expect(refs).toEqual(["Genesis 1:1", "Genesis 1:2"]);
  expect(html).toMatch(/<h2[^>]*><bdi dir="ltr">Genesis 1:1<\/bdi><\/h2>/);
  expect(html).toContain("Synthetic English comment 1.");
  expect(html).toContain("<strong>");
  expect(html).toContain("Synthetic HE, via Sefaria (CC0). Synthetic credit.");
  // Each work's credit follows its comments within the verse's group.
  const first = html.slice(html.indexOf(`data-appendix-ref="Genesis 1:1"`), html.indexOf(`data-appendix-ref="Genesis 1:2"`));
  expect(first.indexOf("Synthetic English comment 1.")).toBeLessThan(first.indexOf("Synthetic EN, via Sefaria (CC-BY)."));
  expect(html).toContain('lang="he" dir="rtl"');
});
