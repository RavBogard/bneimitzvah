import { expect, test } from "vitest";
import { createElement, type FunctionComponent, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DEFAULT_WORKS, initialLens, LENS_STORAGE, lensFromSearch, normalizeWorks, readRememberedLens, rememberLens, StudyLensScope } from "../../src/components/portal/workspace/study-lens";
import { commentaryCount, commentaryParts, commentarySummary, englishLemma } from "../../src/components/portal/workspace/study/commentary-text";
import { CommentaryCredits, CommentaryStatus, linkedVerse, VerseRashi } from "../../src/components/portal/workspace/study/commentary-view";
import { StudyRows } from "../../src/components/portal/workspace/study/study-rows";
import { ReadingToolbar as Toolbar } from "../../src/components/portal/workspace/reading-toolbar";
const ReadingToolbar = Toolbar as FunctionComponent<NonNullable<Parameters<typeof Toolbar>[0]>>;
import { LensSwitch } from "../../src/components/portal/workspace/lens-switch";
import { readingAddress } from "../../src/components/portal/public-reading/view";
import type { CommentaryVerseState } from "../../src/components/portal/workspace/study/commentary-api";
import type { CommentaryComment, CommentaryEdition } from "../../src/lib/readings/commentary";
import { commentaryCandidates, commentaryEditionUrl, parseCommentaryChapter } from "../../src/lib/readings/commentary";
import type { StudyVerse } from "../../src/components/portal/workspace/study/api";

// Invented syllables and numbered English only: never a verse, a translation or a commentary.
const hebrew = "אָבָ֑ג דֵּ֖ה וְזַ֥ח טִֽים׃";
const verse = (ref: string, english: string | null = `Synthetic verse ${ref}`): StudyVerse => ({ ref, english,
  hebrew: { text: hebrew, readingText: hebrew, segments: [{ kind: "text", text: hebrew }], paragraphAfter: null } });
const comment = (lead: string | null, english: string | null, rest = " חִי כָּל"): CommentaryComment => ({
  hebrew: lead === null ? [{ text: rest.trim() }] : [{ text: lead, bold: true }, { text: rest }], english: english === null ? null : [{ text: english }] });
const chapter = parseCommentaryChapter("rashi", "Genesis 1")!, candidate = commentaryCandidates(chapter).he[0];
const edition = (language: "he" | "en"): CommentaryEdition => ({ language, title: candidate.title, license: candidate.license, credit: candidate.credit, url: commentaryEditionUrl(chapter, { ...candidate, language }) });
const ready = (comments: CommentaryComment[]): CommentaryVerseState => ({ status: "ready", comments, editions: [edition("he"), edition("en")], sefariaUrl: "https://www.sefaria.org/Rashi_on_Genesis.1.1" });
const memory = () => { const data = new Map<string, string>(); return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, data }; };
const inLens = (node: ReactNode, query: "lein" | "study" | null = "study") => renderToStaticMarkup(createElement(StudyLensScope, { storageKey: null, query, children: node }));

test("the link names the lens; anything else names none", () => {
  expect(lensFromSearch("?lens=study")).toBe("study");
  expect(lensFromSearch("?date=2026-10-31&lens=study")).toBe("study");
  expect(lensFromSearch("?lens=lein")).toBe("lein");
  for (const search of ["", "?lens=Study", "?lens=", "?lens=tikkun", "?view=study"]) expect(lensFromSearch(search)).toBeNull();
});

test("students and visitors open in Lein; a remembering scope opens in its last lens; the link always wins", () => {
  expect(initialLens({ query: null, remember: false, remembered: "study" })).toBe("lein");
  expect(initialLens({ query: null, remember: true, remembered: undefined })).toBe("lein");
  expect(initialLens({ query: null, remember: true, remembered: "study" })).toBe("study");
  expect(initialLens({ query: "study", remember: false, remembered: undefined })).toBe("study");
  expect(initialLens({ query: "lein", remember: true, remembered: "study" })).toBe("lein");
});

test("the remembered choice is a display preference only, read and written defensively", () => {
  const storage = memory();
  rememberLens(storage, LENS_STORAGE.staff, { lens: "study", works: ["rashi", "womens"], english: false });
  expect(JSON.parse(storage.data.get(LENS_STORAGE.staff)!)).toEqual({ lens: "study", works: ["rashi", "womens"], english: false });
  expect(readRememberedLens(storage, LENS_STORAGE.staff)).toEqual({ lens: "study", works: ["rashi", "womens"], english: false });
  // Learners have no key: nothing is read or written.
  rememberLens(storage, null, { lens: "study", works: DEFAULT_WORKS, english: true });
  expect(readRememberedLens(storage, null)).toEqual({});
  expect(storage.data.size).toBe(1);
  for (const raw of ["not json", "null", "[]", '{"lens":"tikkun","works":"rashi","english":"yes"}']) {
    storage.setItem(LENS_STORAGE.weekly, raw);
    expect(readRememberedLens(storage, LENS_STORAGE.weekly)).toEqual({});
  }
  const throwing = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
  expect(readRememberedLens(throwing, LENS_STORAGE.weekly)).toEqual({});
  expect(() => rememberLens(throwing, LENS_STORAGE.weekly, { lens: "lein", works: DEFAULT_WORKS, english: true })).not.toThrow();
  expect(readRememberedLens(null, LENS_STORAGE.weekly)).toEqual({});
});

test("Works holds registered works only, in registry order, at most three; none is allowed", () => {
  expect(DEFAULT_WORKS).toEqual(["rashi"]);
  expect(normalizeWorks(["womens", "rashi", "rashi"])).toEqual(["rashi", "womens"]);
  expect(normalizeWorks(["malbim", "womens", "__proto__"])).toEqual(["womens"]);
  expect(normalizeWorks([])).toEqual([]);
  expect(normalizeWorks("rashi")).toEqual(["rashi"]);
});

test("the weekly address carries another Shabbat and the Study lens, and this week's Lein is plain /read", () => {
  expect(readingAddress("2026-10-24", "2026-10-24", "lein")).toBe("/read");
  expect(readingAddress("2026-10-24", "2026-10-24", "study")).toBe("/read?lens=study");
  expect(readingAddress("2026-10-31", "2026-10-24", "lein")).toBe("/read?date=2026-10-31");
  expect(readingAddress("2026-10-31", "2026-10-24", "study")).toBe("/read?date=2026-10-31&lens=study");
});

test("a comment leads with Rashi's quoted words; an English edition's repeat of them is dropped only when its letters match", () => {
  const parts = commentaryParts({ hebrew: [{ text: "דֵּה וְזַח.", bold: true }, { text: " חִי כָּל" }], english: [{ text: "דה וזח SYNTHETIC LEMMA — synthetic comment" }] });
  expect(parts.dibbur).toBe("דֵּה וְזַח");
  expect(parts.hebrew).toEqual([{ text: "חִי כָּל" }]);
  expect(parts.lemma).toEqual({ text: "SYNTHETIC LEMMA", caps: true });
  expect(parts.english).toEqual([{ text: "— synthetic comment" }]);
  // A different leading Hebrew phrase is the English's own; it stays.
  expect(commentaryParts({ hebrew: [{ text: "דה", bold: true }], english: [{ text: "אבג synthetic" }] }).english).toEqual([{ text: "אבג synthetic" }]);
  // A bold English lemma is left alone.
  const bold = commentaryParts({ hebrew: [{ text: "דה", bold: true }], english: [{ text: "Synthetic lemma", bold: true }, { text: " synthetic" }] });
  expect(bold.lemma).toEqual({ text: "Synthetic lemma", caps: false });
  expect(bold.english).toEqual([{ text: "synthetic" }]);
  // No bold lead: no quoted words, the whole Hebrew comment kept.
  const plain = commentaryParts({ hebrew: [{ text: "חִי כָּל" }], english: null });
  expect(plain.dibbur).toBeNull();
  expect(plain.hebrew).toEqual([{ text: "חִי כָּל" }]);
  // English only (the Women's Commentary).
  expect(commentaryParts({ hebrew: null, english: [{ text: "Synthetic heading", italic: true }] })).toEqual({ dibbur: null, hebrew: null, lemma: null, english: [{ text: "Synthetic heading", italic: true }] });
});

test("the English edition's lemma is split off as printed: a bold run, or capitals up to the first dash outside brackets", () => {
  // A bold lemma keeps its case.
  expect(englishLemma([{ text: " Synthetic lemma ", bold: true }, { text: " synthetic rest" }])).toEqual({ lemma: { text: "Synthetic lemma", caps: false }, english: [{ text: "synthetic rest" }] });
  expect(englishLemma([{ text: "SYNTHETIC CAPS", bold: true }, { text: " rest" }]).lemma).toEqual({ text: "SYNTHETIC CAPS", caps: false });
  // Capitals up to the first dash, with an editor's lower-case gloss in brackets kept inside.
  expect(englishLemma([{ text: "SYNTHETIC LEMMA (synthetic gloss) — synthetic rest" }])).toEqual({ lemma: { text: "SYNTHETIC LEMMA (synthetic gloss)", caps: true }, english: [{ text: "— synthetic rest" }] });
  expect(englishLemma([{ text: "[SYNTHETIC] CAPITAL WORDS —synthetic rest" }]).lemma).toEqual({ text: "[SYNTHETIC] CAPITAL WORDS", caps: true });
  expect(englishLemma([{ text: "SYNTHETIC LEMMA – synthetic rest" }]).lemma?.text).toBe("SYNTHETIC LEMMA");
  expect(englishLemma([{ text: "SYNTHETIC LEMMA - synthetic rest" }]).lemma?.text).toBe("SYNTHETIC LEMMA");
  // A hyphen inside a word, and a dash inside brackets, do not end the lemma.
  expect(englishLemma([{ text: "SYNTHETIC-WORD LEMMA (12:1–9) — rest" }]).lemma?.text).toBe("SYNTHETIC-WORD LEMMA (12:1–9)");
  // A whole capitalized paragraph with no dash is a section head (the Women's Commentary).
  expect(englishLemma([{ text: "SYNTHETIC SECTION HEAD (12:1–9)" }])).toEqual({ lemma: { text: "SYNTHETIC SECTION HEAD (12:1–9)", caps: true }, english: [] });
  // Not a lemma: ordinary sentences, one capitalized word, lower case outside brackets, italics, nothing.
  for (const runs of [[{ text: "Synthetic sentence — with a dash" }], [{ text: "I synthetic — rest" }], [{ text: "SYNTHETIC words then — rest" }],
    [{ text: "SYNTHETIC CAPS" }, { text: " more", bold: true as const }], [{ text: "SYNTHETIC TITLE", italic: true as const }], []]) expect(englishLemma(runs).lemma).toBeNull();
});

test("a busy verse shows three comments per work, then one row for the rest", () => {
  const verses = [verse("Genesis 1:1")];
  const many = ready([1, 2, 3, 4, 5].map(n => comment("קרש", `synthetic comment ${n}`)));
  const markup = inLens(createElement(StudyRows, { verses, assignment: { kind: "torah", confirmed: true, verses: ["Genesis 1:1"] }, group: "g", activeWord: null, works: () => [{ work: "rashi", state: many }] }));
  expect(markup).toContain("synthetic comment 3");
  expect(markup).not.toContain("synthetic comment 4");
  expect(markup).toMatch(/<button type="button" class="[^"]*moreComments[^"]*" aria-expanded="false"[^>]*>Rashi: 2 more<\/button>/);
  const three = inLens(createElement(StudyRows, { verses, assignment: { kind: "torah", confirmed: true, verses: ["Genesis 1:1"] }, group: "g", activeWord: null, works: () => [{ work: "rashi", state: ready([1, 2, 3].map(n => comment("קרש", `synthetic ${n}`))) }] }));
  expect(three).not.toContain("more</button>");
});

test("Rashi (n) counts a verse's comments, and is 0 while loading, after a failure and where Rashi is silent", () => {
  expect(commentaryCount(ready([comment("דה", "one"), comment("וזח", "two"), comment(null, null)]))).toBe(3);
  expect(commentaryCount(ready([]))).toBe(0);
  for (const status of ["none", "loading", "failed"] as const) expect(commentaryCount({ status } as CommentaryVerseState)).toBe(0);
  expect(commentarySummary([ready([]), { status: "loading" }, { status: "failed" }])).toBe("failed");
  expect(commentarySummary([ready([]), { status: "loading" }])).toBe("loading");
  expect(commentarySummary([ready([]), { status: "none" }])).toBe("ready");
  expect(commentarySummary([{ status: "none" }])).toBe("none");
});

test("Study rows: Hebrew, then English, then Rashi English-led with bold quoted words, Hebrew and work credit; no tikkun", () => {
  const verses = [verse("Genesis 1:1"), verse("Genesis 1:2")];
  const states: Record<string, CommentaryVerseState> = { "Genesis 1:1": ready([comment("דֵּה וְזַח.", "SYNTHETIC LEMMA — synthetic comment one")]), "Genesis 1:2": ready([]) };
  const markup = inLens(createElement(StudyRows, { verses, assignment: { kind: "torah", confirmed: true, verses: verses.map(row => row.ref) }, group: "g", activeWord: null,
    onVerse: () => {}, onWord: () => {}, works: ref => [{ work: "rashi", state: states[ref] }] }));
  expect(markup).toContain("data-study-rows");
  expect(markup).toContain('aria-label="Hear Genesis 1:1"');
  const first = markup.slice(markup.indexOf('data-verse-ref="Genesis 1:1"'), markup.indexOf('data-verse-ref="Genesis 1:2"'));
  expect(first.indexOf('lang="he"')).toBeLessThan(first.indexOf("Synthetic verse Genesis 1:1"));
  expect(first.indexOf("Synthetic verse Genesis 1:1")).toBeLessThan(first.indexOf(">Rashi</h5>"));
  // The quoted words are found once in the verse, so they are a button that shows them there.
  expect(first).toMatch(/<button type="button" class="[^"]*dibburLink[^"]*" aria-pressed="false"><bdi lang="he" dir="rtl" class="[^"]*">דֵּה וְזַח<\/bdi>/);
  expect(first).toMatch(/<span class="[^"]*lemma[^"]*" data-caps="">SYNTHETIC LEMMA<\/span> — synthetic comment one/);
  expect(first).toContain(">Hebrew</button>");
  expect(first).toContain('data-linkable="true"');
  // A verse Rashi is silent on shows no commentary at all, and no filler.
  const second = markup.slice(markup.indexOf('data-verse-ref="Genesis 1:2"'));
  expect(second).not.toContain("Rashi");
  expect(markup).not.toContain("data-tikkun");
  expect(markup).not.toMatch(/no comment/i);
});

test("quoted words that are not found once in the verse are plain bold text: no link is guessed", () => {
  const verses = [verse("Genesis 1:1")];
  const markup = inLens(createElement(StudyRows, { verses, assignment: { kind: "torah", confirmed: true, verses: ["Genesis 1:1"] }, group: "g", activeWord: null,
    works: () => [{ work: "rashi", state: ready([comment("קרש", "synthetic"), comment("אב״ג", "synthetic")]) }] }));
  expect(markup).not.toContain("dibburLink");
  expect(markup).not.toContain("data-linkable");
  expect(markup).toContain(">קרש</bdi>");
});

test("English off in Study hides the translation and keeps the commentary", () => {
  const verses = [verse("Genesis 1:1")];
  const markup = inLens(createElement(StudyRows, { verses, assignment: { kind: "torah", confirmed: true, verses: ["Genesis 1:1"] }, group: "g", activeWord: null, showEnglish: false,
    works: () => [{ work: "rashi", state: ready([comment("דה", "synthetic comment")]) }] }));
  expect(markup).not.toContain("Synthetic verse Genesis 1:1");
  expect(markup).toContain("synthetic comment");
});

test("Lein's Rashi (n) disclosure: closed, counted, hidden when Rashi is silent or still loading, and a failure offers Try again", () => {
  const one = verse("Genesis 1:1");
  const closed = renderToStaticMarkup(createElement(VerseRashi, { verse: one, state: ready([comment("דה", "a"), comment("וזח", "b")]) }));
  expect(closed).toContain('aria-expanded="false"');
  expect(closed).toContain(">Rashi (2)</button>");
  expect(closed).not.toContain("synthetic");
  for (const state of [ready([]), { status: "loading" }, { status: "none" }] as CommentaryVerseState[]) expect(renderToStaticMarkup(createElement(VerseRashi, { verse: one, state }))).toBe("");
  expect(renderToStaticMarkup(createElement(VerseRashi, { verse: null, state: ready([comment("דה", "a")]) }))).toBe("");
  expect(renderToStaticMarkup(createElement(VerseRashi, { verse: one, state: { status: "failed" } }))).toContain(">Rashi</button>");
});

test("quiet states: loading, a failure with Try again, and the Women's Commentary on a haftarah", () => {
  const markup = renderToStaticMarkup(createElement(CommentaryStatus, { works: [
    { work: "rashi", status: "failed", retry: () => {}, covers: true }, { work: "womens", status: "none", retry: () => {}, covers: false }] }));
  expect(markup).toContain("Rashi isn’t available right now.");
  expect(markup).toContain(">Try again</button>");
  expect(markup).toContain("The Women’s Commentary covers the Torah only.");
  expect(markup).toContain('role="status"');
  expect(renderToStaticMarkup(createElement(CommentaryStatus, { works: [{ work: "rashi", status: "loading" as const, retry: () => {}, covers: true }] }))).toContain("Loading Rashi…");
  expect(renderToStaticMarkup(createElement(CommentaryStatus, { works: [{ work: "rashi", status: "ready" as const, retry: () => {}, covers: true }] }))).toBe("");
  expect(markup).not.toMatch(/sorry|oops|!/i);
});

test("the work's foot credits each edition once, with its licence, via Sefaria, linked", () => {
  const state = ready([comment("דה", "a")]);
  const markup = renderToStaticMarkup(createElement(CommentaryCredits, { works: [{ work: "rashi", lookup: { forVerse: () => state } }], refs: ["Genesis 1:1", "Genesis 1:2"] }));
  expect(markup).toContain("Hebrew and English: <a");
  expect(markup.match(/via Sefaria \(public domain\)/g)).toHaveLength(1);
  expect(markup).toContain(`href="${edition("he").url.replaceAll("&", "&amp;")}"`);
  expect(markup).toContain('href="https://www.sefaria.org/Rashi_on_Genesis.1"');
  expect(renderToStaticMarkup(createElement(CommentaryCredits, { works: [{ work: "rashi", lookup: { forVerse: (): CommentaryVerseState => ({ status: "loading" }) } }], refs: ["Genesis 1:1"] }))).toBe("");
});

test("Lein underlines quoted words only in the verse whose comment is pointed at", () => {
  const verses = [verse("Genesis 1:1"), verse("Genesis 1:2")];
  const link = { marked: { first: 1, last: 2 }, markedKey: "Genesis 1:2|rashi:0", pinned: null, point: () => () => {}, clear: () => {} };
  expect(linkedVerse(link, verses)).toEqual({ first: 1, last: 2, verse: 1 });
  expect(linkedVerse({ ...link, markedKey: "Genesis 9:9|rashi:0" }, verses)).toBeNull();
  expect(linkedVerse({ ...link, marked: null, markedKey: null }, verses)).toBeNull();
});

test("the toolbar: Lein keeps Tikkun; Study drops it and adds Works, five items at most", () => {
  const items = (markup: string) => markup.match(/class="toolbar-item"/g)?.length ?? 0;
  const lein = inLens(createElement(ReadingToolbar, { listeningEnabled: true, tikkunAvailable: true, onHear: () => {} }), "lein");
  expect(lein).toContain("Tikkun");
  expect(lein).not.toContain(">Works<");
  const study = inLens(createElement(ReadingToolbar, { listeningEnabled: true, tikkunAvailable: true, onHear: () => {} }), "study");
  expect(study).not.toContain("Tikkun");
  expect(study).toContain(">Works</span>");
  expect(study).toContain('aria-label="Works: Rashi"');
  expect(items(study)).toBeLessThanOrEqual(5);
  expect(items(lein)).toBeLessThanOrEqual(5);
  // Study's English starts on, whatever Lein's English is.
  expect(study).toMatch(/aria-pressed="true"><svg[^]*?<span>English<\/span>/);
  // On a haftarah the Women's Commentary is marked as Torah only.
  expect(inLens(createElement(ReadingToolbar, { worksCorpus: "neviim" }), "study")).toContain("Torah only");
  // Without a lens scope there is no Study at all.
  expect(renderToStaticMarkup(createElement(ReadingToolbar, { tikkunAvailable: true }))).toContain("Tikkun");
});

test("the switch is Lein | Study with the current lens pressed, and absent outside a lens scope", () => {
  const markup = inLens(createElement(LensSwitch), "study");
  expect(markup).toContain('aria-label="Reading lens"');
  expect(markup).toMatch(/aria-pressed="false" data-lens="lein">Lein<\/button>/);
  expect(markup).toMatch(/aria-pressed="true" data-lens="study">Study<\/button>/);
  expect(inLens(createElement(LensSwitch), null)).toMatch(/aria-pressed="true" data-lens="lein">Lein/);
  expect(renderToStaticMarkup(createElement(LensSwitch))).toBe("");
});
