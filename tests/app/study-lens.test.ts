import { expect, test } from "vitest";
import { createElement, type FunctionComponent, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DEFAULT_WORKS, initialLens, LENS_STORAGE, lensFromSearch, normalizeWorks, readRememberedLens, rememberLens, StudyLensScope } from "../../src/components/portal/workspace/study-lens";
import { commentaryCount, commentaryParts, commentarySummary, englishLemma } from "../../src/components/portal/workspace/study/commentary-text";
import { CommentaryCredits, CommentaryStatus, linkedVerse, VerseRashi, workStatuses } from "../../src/components/portal/workspace/study/commentary-view";
import { StudyRows } from "../../src/components/portal/workspace/study/study-rows";
import { VersePanelScope } from "../../src/components/portal/workspace/study/verse-panel";
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
/** What a scope's Works start as: its remembered choice when it has one, else the default (the same read StudyLensScope makes). */
const initialWorks = (storage: ReturnType<typeof memory> | null, key: string | null) => readRememberedLens(storage, key).works ?? DEFAULT_WORKS;
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
  // Not a list at all: the default.
  expect(normalizeWorks("rashi")).toEqual(["rashi"]);
});

test("Rashi and the Women's Commentary are on by default for everyone; a remembered choice replaces the default as it always did", () => {
  // Signed out, signed in, student, tutor: any scope that opens fresh (no storage key, or a key with nothing stored) starts with both.
  expect(initialWorks(null, null)).toEqual(["rashi"]);
  expect(initialWorks(memory(), LENS_STORAGE.weekly)).toEqual(["rashi"]);
  expect(initialWorks(memory(), LENS_STORAGE.staff)).toEqual(["rashi"]);
  // Nothing readable in storage falls back to the default too.
  const broken = memory(); broken.setItem(LENS_STORAGE.weekly, "not json");
  expect(initialWorks(broken, LENS_STORAGE.weekly)).toEqual(["rashi"]);
  // A remembered choice is respected: another work, one turned off, or none at all.
  for (const [stored, expected] of [[["ramban"], ["ramban"]], [["rashi"], ["rashi"]], [["womens", "ramban"], ["womens", "ramban"]], [[], []]] as const) {
    const storage = memory(); storage.setItem(LENS_STORAGE.weekly, JSON.stringify({ lens: "study", works: stored, english: true }));
    expect(initialWorks(storage, LENS_STORAGE.weekly)).toEqual(expected);
  }
  // A scope with no key remembers nothing, so turning a work off there never carries to the next load.
  const storage = memory();
  rememberLens(storage, null, { lens: "study", works: [], english: true });
  expect(initialWorks(storage, null)).toEqual(["rashi"]);
});

test("Study opens with Rashi on, for the signed-out public page and for the workspace alike; Lein is still the default lens", () => {
  const study = (storageKey: string | null) => renderToStaticMarkup(createElement(StudyLensScope, { storageKey, query: "study", children: createElement(ReadingToolbar, {}) }));
  for (const key of [null, LENS_STORAGE.weekly, LENS_STORAGE.staff]) expect(study(key)).toContain('aria-label="Commentaries: Rashi"');
  const lein = renderToStaticMarkup(createElement(StudyLensScope, { storageKey: null, children: createElement(LensSwitch) }));
  expect(lein).toMatch(/aria-pressed="true" data-lens="lein">(<svg.*?<\/svg>)?<span>Lein<\/span>/);
});

test("the Women's Commentary covers the Torah only: chosen on a haftarah it says what it covers; Rashi, the default, covers both and says nothing", () => {
  const rows = [{ work: "rashi", status: "ready" as const, retry: () => {} }, { work: "womens", status: "none" as const, retry: () => {} }];
  expect(workStatuses(rows, "neviim").map(row => [row.work, row.covers])).toEqual([["rashi", true], ["womens", false]]);
  expect(renderToStaticMarkup(createElement(CommentaryStatus, { works: workStatuses(rows.slice(0, 1), "neviim") }))).toBe("");
  expect(workStatuses(rows, "torah").map(row => [row.work, row.covers])).toEqual([["rashi", true], ["womens", true]]);
  // A work the viewer chose that is not a default still says what it covers.
  expect(workStatuses([{ work: "ramban", status: "none" as const, retry: () => {} }], "neviim").map(row => [row.work, row.covers])).toEqual([["ramban", false]]);
  // The toolbar's label names the default on a haftarah too.
  expect(inLens(createElement(ReadingToolbar, { worksCorpus: "neviim" }), "study")).toContain('aria-label="Commentaries: Rashi"');
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
  const markup = inLens(createElement(StudyRows, { verses, assignment: { kind: "torah", confirmed: true, verses: ["Genesis 1:1"] }, group: "g", works: () => [{ work: "rashi", state: many }] }));
  expect(markup).toContain("synthetic comment 3");
  expect(markup).not.toContain("synthetic comment 4");
  expect(markup).toMatch(/<button type="button" class="[^"]*moreWork[^"]*">Rashi: 2 more<\/button>/);
  const three = inLens(createElement(StudyRows, { verses, assignment: { kind: "torah", confirmed: true, verses: ["Genesis 1:1"] }, group: "g", works: () => [{ work: "rashi", state: ready([1, 2, 3].map(n => comment("קרש", `synthetic ${n}`))) }] }));
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

test("Study rows: Hebrew, then English, in the row; the commentary sits in the notes column with its lemma, its Hebrew and its English; no tikkun", () => {
  const verses = [verse("Genesis 1:1"), verse("Genesis 1:2")];
  const states: Record<string, CommentaryVerseState> = { "Genesis 1:1": ready([comment("דֵּה וְזַח.", "SYNTHETIC LEMMA — synthetic comment one")]), "Genesis 1:2": ready([]) };
  const markup = inLens(createElement(StudyRows, { verses, assignment: { kind: "torah", confirmed: true, verses: verses.map(row => row.ref) }, group: "g", works: ref => [{ work: "rashi", state: states[ref] }] }));
  expect(markup).toContain("data-study-rows");
  expect(markup).toContain('aria-label="Choose Genesis 1:1"');
  const row = markup.slice(markup.indexOf('data-verse-ref="Genesis 1:1"'), markup.indexOf('data-verse-ref="Genesis 1:2"'));
  expect(row.indexOf('lang="he"')).toBeLessThan(row.indexOf("Synthetic verse Genesis 1:1"));
  // The column opens on the first verse with entries and holds its commentary: the quoted words, the Hebrew after them and the English.
  const rail = markup.slice(markup.indexOf("data-study-rail"));
  expect(rail).toContain('data-rail-verse="Genesis 1:1"');
  expect(rail).toMatch(/<bdi class="[^"]*lem[^"]*" lang="he" dir="rtl">דֵּה וְזַח<\/bdi>/);
  expect(rail).toContain("synthetic comment one");
  // The quoted words occur once in the verse, so a letter is set on the word and on the note.
  expect(row).toContain('class="study-lemma-letter"');
  expect(rail).toContain('data-lemma-letter="a"');
  // A verse Rashi is silent on has no line in the column and no dots.
  expect(rail).not.toContain('data-rail-item="Genesis 1:2"');
  expect(markup).not.toContain("data-tikkun");
  expect(markup).not.toMatch(/no comment/i);
});

test("quoted words that are not found once in the verse have no letter: nothing is guessed", () => {
  const verses = [verse("Genesis 1:1")];
  const markup = inLens(createElement(StudyRows, { verses, assignment: { kind: "torah", confirmed: true, verses: ["Genesis 1:1"] }, group: "g", works: () => [{ work: "rashi", state: ready([comment("קרש", "synthetic"), comment("אב״ג", "synthetic")]) }] }));
  expect(markup).not.toContain("study-lemma-letter");
  expect(markup).not.toContain("data-lemma-letter");
  expect(markup).toContain(">קרש</bdi>");
});

test("English off in Study hides the translation and keeps the commentary", () => {
  const verses = [verse("Genesis 1:1")];
  const markup = inLens(createElement(StudyRows, { verses, assignment: { kind: "torah", confirmed: true, verses: ["Genesis 1:1"] }, group: "g", showEnglish: false, works: () => [{ work: "rashi", state: ready([comment("דה", "synthetic comment")]) }] }));
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
  // A failure shows nothing in Lein: never a row of empty "Rashi" buttons (Study has its one quiet line).
  expect(renderToStaticMarkup(createElement(VerseRashi, { verse: one, state: { status: "failed" } }))).toBe("");
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
  expect(markup.match(/via Sefaria \(CC BY\)/g)).toHaveLength(1);
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

test("the toolbar: Lein keeps Tikkun; Study drops it and adds Commentaries, five items at most", () => {
  const items = (markup: string) => markup.match(/class="(toolbar-item|study-tool)"/g)?.length ?? 0;
  const lein = inLens(createElement(ReadingToolbar, { listeningEnabled: true, tikkunAvailable: true, onHear: () => {} }), "lein");
  expect(lein).toContain("Tikkun");
  expect(lein).not.toContain(">Works<");
  const study = inLens(createElement(ReadingToolbar, { listeningEnabled: true, tikkunAvailable: true, onHear: () => {} }), "study");
  expect(study).not.toContain("Tikkun");
  expect(study).toContain(">Commentaries</span>");
  expect(study).toContain('aria-label="Commentaries: Rashi"');
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
  expect(markup).toMatch(/aria-pressed="false" data-lens="lein"><svg.*?<\/svg><span>Lein<\/span><\/button>/);
  expect(markup).toMatch(/aria-pressed="true" data-lens="study"><svg.*?<\/svg><span>Study<\/span><\/button>/);
  expect(inLens(createElement(LensSwitch), null)).toMatch(/aria-pressed="true" data-lens="lein">(<svg.*?<\/svg>)?<span>Lein<\/span>/);
  expect(renderToStaticMarkup(createElement(LensSwitch))).toBe("");
});

test("Study is a study desk: no colours and nothing to hear, one open verse in a column of only the verses that have entries; Lein keeps Colors and Hear", () => {
  const verses = [verse("Genesis 1:1"), verse("Genesis 1:2"), verse("Genesis 1:3")];
  const rows = (silent: string[]) => inLens(createElement(StudyRows, { verses, assignment: { kind: "torah", confirmed: true, verses: verses.map(row => row.ref) }, group: "g",
    works: ref => [{ work: "rashi", state: silent.includes(ref) ? ready([]) : ready([comment("דה", "synthetic comment")]) }] }));
  const markup = rows(["Genesis 1:2"]);
  // Plain Hebrew in ink: no phrase family, no verse to hear.
  expect(markup).not.toContain("data-family");
  expect(markup).not.toMatch(/aria-label="Hear /);
  expect(markup).toContain("data-study-sheet");
  // The column lists only the verses with entries, exactly one of them open; the silent verse has a row but no line.
  expect(markup.match(/data-rail-item="/g)).toHaveLength(2);
  expect(markup).toContain('data-rail-item="Genesis 1:1"'); expect(markup).toContain('data-rail-item="Genesis 1:3"'); expect(markup).not.toContain('data-rail-item="Genesis 1:2"');
  expect(markup.match(/data-open="true"/g)).toHaveLength(1);
  expect(markup).toMatch(/data-verse-ref="Genesis 1:1"[^>]*data-current="true"[^>]*data-has-notes="true"/);
  expect(markup).not.toMatch(/data-verse-ref="Genesis 1:2"[^>]*data-has-notes/);
  // Dots under the number of a verse that has notes, none under one that does not.
  const second = markup.slice(markup.indexOf('data-verse-ref="Genesis 1:2"'), markup.indexOf('data-verse-ref="Genesis 1:3"'));
  expect(second).not.toContain("data-note-dots");
  expect(markup.slice(markup.indexOf('data-verse-ref="Genesis 1:1"'), markup.indexOf('data-verse-ref="Genesis 1:2"'))).toContain('data-note-dots="classic"');
  // Nothing has entries: no column at all, and no Sheet and no Notes button anywhere.
  const none = rows(["Genesis 1:1", "Genesis 1:2", "Genesis 1:3"]);
  expect(none).not.toContain("data-study-rail");
  expect(none).not.toContain("study-notes-open");
  // Study's tools: English, Commentaries and size; no Colors, no Hear verse, no dock, and no Sources button.
  const study = inLens(createElement(ReadingToolbar, { listeningEnabled: true, tikkunAvailable: true, onHear: () => {} }), "study");
  expect(study).toContain('data-testid="study-toolbar"');
  expect(study).toContain("<span>Commentaries</span>");
  expect(study).not.toContain("Works");
  expect(study).not.toContain("Sources");
  expect(study).not.toContain("Colors");
  expect(study).not.toContain("Hear verse");
  expect(study).not.toContain("reading-toolbar");
  const lein = inLens(createElement(ReadingToolbar, { listeningEnabled: true, tikkunAvailable: true, onHear: () => {} }), "lein");
  expect(lein).toContain("<span>Colors</span>");
  expect(lein).toContain("<span>Hear verse</span>");
});

test("the Study desk's wording", () => {
  const markup = inLens(createElement(VersePanelScope, { children: createElement(StudyRows, { verses: [verse("Genesis 1:1")], group: "g", works: () => [{ work: "rashi", state: ready([comment("דה", "synthetic comment")]) }] }) }));
  expect(markup).toContain(">Everything on this verse</button>");
  expect(markup).toContain(">Copy</button>");
  expect(markup).toContain(">Open on Sefaria<");
  expect(markup).toContain(">Rashi</span>");
  expect(markup).not.toContain("On this verse");
  expect(markup).not.toContain(">Notes</button>");
});
