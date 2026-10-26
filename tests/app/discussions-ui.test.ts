import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { publicDiscussionsAnswer, type PublicDiscussionsRead } from "../../src/server/discussions/public";
import type { PublicSourceRow } from "../../src/server/discussions/data";
import { SourceTextUnavailable } from "../../src/server/study/source-text";
import { discussionsPath, fetchDiscussions, parseDiscussionsAnswer } from "../../src/components/portal/workspace/study/discussions-api";
import { DiscussionPanelBody, DiscussionsProvider } from "../../src/components/portal/workspace/study/discussions";
import { DiscussionList, VerseActions, VersePanelScope } from "../../src/components/portal/workspace/study/verse-panel";
import { requestPanel } from "../../src/components/portal/workspace/study/verse-panel-state";
import { StudyLensScope } from "../../src/components/portal/workspace/study-lens";
import { discussionsView, type DiscussionsAnswer } from "../../src/lib/discussions/answer";
import { DISCUSSION_LABELS } from "../../src/lib/discussions/labels";
import { buildAppendix, discussionWorks, printableSource, translationParagraphs } from "../../src/lib/print/appendix";
import { DEFAULT_FORMAT, describeFormat, formatEntries, formatFromRecord, parseFormat, type SheetFormat } from "../../src/lib/print/sheet-format";
import { PrintDocument } from "../../src/components/portal/print/document";
import { studyEditions } from "../../src/components/portal/workspace/study/credits";
import type { StudyVerse } from "../../src/components/portal/workspace/study/api";
import { EN, HE, REFS, syntheticPinned } from "../helpers/discussions";

// The reader's side of curated discussions (1.7 M6b): the marker, the list, the verse panel's sources, credits and the print filter.
// Synthetic text only: invented editions and commentators, numbered English, no real source text anywhere.
const PASSAGE = { ref: "Genesis 12:1-3", kind: "torah" as const };
const row = (slug: string, position: number, anchorRef: string, extra: Partial<PublicSourceRow> = {}): PublicSourceRow => ({ slug, title: `Synthetic ${slug}`, kind: "torah", revision: 1,
  updatedAt: new Date("2026-10-24T00:00:00Z"), position, ref: REFS[position - 1] ?? REFS[0], anchorRef, edition: EN, translationId: null, selectedByName: "Rabbi Synthetic", translationEdition: null, translationBody: null, ...extra });
const read = (rows: PublicSourceRow[], productName = "Synthetic Torah", truncated = false): PublicDiscussionsRead => ({ productName, truncated, rows });
const VERSES = ["Genesis 12:1", "Genesis 12:2", "Genesis 12:3"];

/** The route's own answer, built by the server code over a synthetic Sefaria, as JSON the way the browser receives it. */
async function served(rows: PublicSourceRow[], pinned = syntheticPinned(), productName = "Synthetic Torah", cut = false) {
  const { discussions, complete, truncated } = await publicDiscussionsAnswer(read(rows, productName, cut), VERSES, pinned);
  return JSON.parse(JSON.stringify({ ...PASSAGE, productName, discussions, complete, truncated }));
}
const ROWS = [row("first", 1, "Genesis 12:1"), row("first", 2, "Genesis 12:2", { ref: REFS[2], edition: null, translationId: "t", translationEdition: HE, translationBody: "Synthetic **translation** text.\n\n- one\n- two" }),
  row("second", 1, "Genesis 12:2")];
const viewOf = async (rows = ROWS, pinned = syntheticPinned(), productName = "Synthetic Torah") => discussionsView(parseDiscussionsAnswer(await served(rows, pinned, productName), PASSAGE))!;

const study = (child: ReactNode, view: ReturnType<typeof discussionsView> | null, lens: "study" | "lein" = "study") => renderToStaticMarkup(
  createElement(StudyLensScope, { storageKey: null, query: lens, children: createElement(DiscussionsProvider, { value: view, children: createElement(VersePanelScope, { children: child }) }) }));

test("the browser parser accepts exactly the route's answer, and refuses a link, a name or a shape the route would not send", async () => {
  const body = await served(ROWS);
  const parsed = parseDiscussionsAnswer(structuredClone(body), PASSAGE);
  expect(parsed.complete).toBe(true);
  expect(parsed.productName).toBe("Synthetic Torah");
  expect(parsed.discussions.map(d => [d.slug, d.anchors])).toEqual([["first", ["Genesis 12:1", "Genesis 12:2"]], ["second", ["Genesis 12:2"]]]);
  const [first] = parsed.discussions;
  expect(first.sources[0]).toMatchObject({ kind: "edition", credit: `${EN}, via Sefaria (CC BY)`, selectedBy: "Selected by Rabbi Synthetic" });
  expect(first.sources[1]).toMatchObject({ kind: "translation", translation: { originalEdition: HE } });
  expect(first.sources[1].text?.editions.map(e => e.language)).toEqual(["he"]);
  const mutations: [string, (v: Record<string, any>) => void][] = [
    ["another passage", v => { v.ref = "Genesis 12:1-2"; }], ["another kind", v => { v.kind = "haftarah"; }], ["a link elsewhere", v => { v.discussions[0].sources[0].sefariaUrl = "https://example.com/x"; }],
    ["a name with markup", v => { v.discussions[0].title = "<b>x</b>"; }], ["no product name to credit by", v => { v.productName = null; }],
    ["an anchor with no source", v => { v.discussions[0].anchors.push("Genesis 12:3"); }], ["a repeated discussion", v => { v.discussions.push(structuredClone(v.discussions[0])); }],
    ["an unknown kind of source", v => { v.discussions[0].sources[0].kind = "essay"; }], ["a detail that is not text", v => { v.discussions[0].sources[0].details = {}; }],
  ];
  for (const [name, mutate] of mutations) { const value = structuredClone(body); mutate(value); expect(() => parseDiscussionsAnswer(value, PASSAGE), name).toThrow(); }
});

test("a source whose text did not come stays, with its text null and the answer incomplete", async () => {
  const body = await served(ROWS, Object.assign(async () => { throw new SourceTextUnavailable("upstream"); }, { calls: [] as string[] }));
  expect(body.complete).toBe(false);
  const parsed = parseDiscussionsAnswer(body, PASSAGE);
  expect(parsed.complete).toBe(false);
  for (const source of parsed.discussions.flatMap(d => d.sources)) { expect(source.text).toBeNull(); expect(source.sefariaUrl).toContain("sefaria.org"); }
  // A text that does not parse is the same: kept, shown without its text.
  const broken = await served(ROWS); broken.discussions[0].sources[0].text = { segments: "nonsense", editions: [] };
  expect(parseDiscussionsAnswer(broken, PASSAGE).discussions[0].sources[0].text).toBeNull();
});

test("the call is a plain same-origin GET, the same signed in or out: no credentials, no Authorization", async () => {
  expect(discussionsPath(PASSAGE)).toBe("/api/public/discussions?ref=Genesis+12%3A1-3&kind=torah");
  const body = await served(ROWS), calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal("location", { origin: "http://localhost:3000" });
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const response = new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json; charset=utf-8" } });
    Object.defineProperty(response, "url", { value: `http://localhost:3000${url}` });
    return response;
  });
  const answer = await fetchDiscussions(PASSAGE, new AbortController().signal);
  expect(answer.discussions).toHaveLength(2);
  expect(calls).toHaveLength(1);
  expect(calls[0].url).toBe("/api/public/discussions?ref=Genesis+12%3A1-3&kind=torah");
  expect(calls[0].init).toMatchObject({ credentials: "omit", mode: "same-origin", referrerPolicy: "no-referrer" });
  expect(JSON.stringify(calls[0].init.headers)).not.toMatch(/authorization|cookie/i);
  // A passage that is not a canonical reading is never asked for.
  await expect(fetchDiscussions({ ref: "Genesis 12:1-99", kind: "torah" }, new AbortController().signal)).rejects.toThrow();
  expect(calls).toHaveLength(1);
});
afterEach(() => { vi.unstubAllGlobals(); });

test("the marker is on anchor verses only, and says exactly what Daniel worded", async () => {
  const view = await viewOf();
  expect(DISCUSSION_LABELS).toEqual({ marker: "Sources on this verse", list: "Sources for this reading", column: "Sources", back: "Back to this verse" });
  for (const verse of ["Genesis 12:1", "Genesis 12:2"]) {
    const markup = study(createElement(VerseActions, { verse }), view);
    expect(markup).toContain(">Sources on this verse</button>");
    expect(markup).toContain(">Compare</button>"); // the verse's other actions stay as they were
  }
  const bare = study(createElement(VerseActions, { verse: "Genesis 12:3" }), view);
  expect(bare).not.toContain("Sources on this verse");
  expect(bare).toContain(">Compare</button>");
  // No answer, no discussion anywhere, or an answer with nothing anchored: no marker at all.
  expect(study(createElement(VerseActions, { verse: "Genesis 12:1" }), null)).not.toContain("Sources on this verse");
  expect(discussionsView({ discussions: [], productName: "Synthetic Torah", complete: true, truncated: false })).toBeNull();
  expect(renderToStaticMarkup(createElement(VerseActions, { verse: "Genesis 12:1" }))).toBe("");
});

test("the column is headed 'Sources' (print keeps its own words) with each title and its sources, and is absent when there is nothing", async () => {
  const view = await viewOf(), markup = study(createElement(DiscussionList), view);
  expect(markup).toContain(">Sources</h3>"); expect(markup).not.toContain("Sources for this reading"); expect(markup).toContain("data-sources-column");
  expect(markup).toContain("Synthetic first"); expect(markup).toContain("Synthetic second");
  for (const ref of [REFS[0], REFS[2], REFS[0]]) expect(markup).toContain(ref);
  expect(markup.match(/data-discussion-open="/g)).toHaveLength(3);
  expect(markup).not.toContain("Back to this verse");
  // Nothing to show: not an empty heading, not a box.
  expect(study(createElement(DiscussionList), null)).toBe("");
  expect(study(createElement(DiscussionList), view, "lein")).toBe("");
  expect(renderToStaticMarkup(createElement(DiscussionList))).toBe("");
  expect(discussionsView({ discussions: [{ slug: "x", title: "x", kind: "torah", anchors: [], sources: [] }], productName: "Synthetic Torah", complete: true, truncated: false })).toBeNull();
});

test("the panel opens a discussion kind at the source's verse; the same request closes it; the list's request remembers where it came from", () => {
  const shown = requestPanel(null, { verse: "Genesis 12:2", kind: "discussion", from: "list" }, "panel-1");
  expect(shown).toEqual({ open: { verse: "Genesis 12:2", kind: "discussion", id: "panel-1", from: "list" }, restoreFocus: false });
  expect(requestPanel(shown.open, { verse: "Genesis 12:2", kind: "discussion" }, "panel-1")).toEqual({ open: null, restoreFocus: true });
  // Another verse or another kind replaces it: one panel at a time.
  expect(requestPanel(shown.open, { verse: "Genesis 12:1", kind: "discussion" }, "panel-1").open).toEqual({ verse: "Genesis 12:1", kind: "discussion", id: "panel-1" });
  expect(requestPanel(shown.open, { verse: "Genesis 12:2", kind: "shelf" }, "panel-1").open).toMatchObject({ kind: "shelf" });
});

test("credits: an edition shows the route's line, a Claude translation names the product from the response, and 'Selected by' stays a separate detail", async () => {
  for (const productName of ["Synthetic Torah", "Another Congregation Torah"]) {
    const view = await viewOf(ROWS, syntheticPinned(), productName);
    const markup = study(createElement(DiscussionPanelBody, { verse: "Genesis 12:2" }), view);
    expect(markup).toContain(`Claude translation for ${productName}`);
    expect(markup).not.toContain(`Claude translation for ${productName === "Synthetic Torah" ? "Another" : "Synthetic"}`);
    // The translation's text is ours, set with its emphasis and list; its Hebrew original is credited beside it.
    expect(markup).toContain("<strong>translation</strong>"); expect(markup).toContain("<li>one</li>");
    expect(markup).toContain(`Hebrew: <a href="https://www.sefaria.org/`); expect(markup).toContain(`${HE}, via Sefaria (public domain)`);
    // The curator is a detail of each source, and never inside a credit line.
    const details = markup.match(/<p class="[^"]*" data-source-detail="">([^<]*)<\/p>/g) ?? [];
    expect(details).toHaveLength(2);
    for (const detail of details) expect(detail).toContain("Selected by Rabbi Synthetic");
    for (const credit of markup.match(/<span class="[^"]*" data-discussion-credit="[a-z]+">[^]*?<\/span>/g) ?? []) expect(credit).not.toContain("Rabbi Synthetic");
    expect(markup.match(/Rabbi Synthetic/g)).toHaveLength(2);
  }
  const view = await viewOf(), edition = study(createElement(DiscussionPanelBody, { verse: "Genesis 12:1" }), view);
  expect(edition).toContain(`data-discussion-credit="edition"><a href="https://www.sefaria.org/`);
  expect(edition).toContain(`${EN}, via Sefaria (CC BY)</a>`);
  expect(edition).toContain(`Synthetic English for ${REFS[0]}`);
  expect(edition).toContain(`${REFS[0]}</bdi> on Sefaria</a>`);
  expect(edition).not.toContain("Claude translation");
  expect(edition).toContain("Synthetic first"); // the title heads its sources
});

test("a source's link is the one the route returned, and a verse with no discussion shows no panel body", async () => {
  const view = await viewOf(), parsed = parseDiscussionsAnswer(await served(ROWS), PASSAGE);
  const markup = study(createElement(DiscussionPanelBody, { verse: "Genesis 12:1" }), view);
  expect(markup).toContain(`href="${parsed.discussions[0].sources[0].sefariaUrl.replace(/&/g, "&amp;")}"`);
  expect(study(createElement(DiscussionPanelBody, { verse: "Genesis 12:3" }), view)).toBe("");
  expect(study(createElement(DiscussionPanelBody, { verse: "Genesis 12:1" }), null)).toBe("");
});

test("a source with no text shows its credit and its Sefaria link and no text, and never an error page", async () => {
  const nothing = Object.assign(async () => { throw new SourceTextUnavailable("upstream"); }, { calls: [] as string[] });
  const view = await viewOf(ROWS, nothing), translation = study(createElement(DiscussionPanelBody, { verse: "Genesis 12:2" }), view);
  expect(translation).toContain("Claude translation for Synthetic Torah");
  expect(translation).toContain("on Sefaria</a>");
  expect(translation).not.toContain("Synthetic translation"); expect(translation).not.toContain("translation</strong>"); // a translation is never shown without its original
  expect(translation).not.toMatch(/isn’t available|error|try again/i);
  const edition = study(createElement(DiscussionPanelBody, { verse: "Genesis 12:1" }), view);
  expect(edition).toContain(`<bdi>${EN}</bdi>`); // the edition's name stands in where the route has no credit line yet
  expect(edition).toContain(`href="https://www.sefaria.org/`);
  expect(edition).not.toContain("Synthetic English for");
  expect(edition).not.toMatch(/isn’t available|error|try again/i);
  // The list and the marker still come from the answer's structure alone.
  expect(study(createElement(DiscussionList), view)).toContain(">Sources</h3>");
});

// ---- print -----------------------------------------------------------------------------------------------------------------
const he = (license: string, title = "Synthetic Hebrew") => ({ language: "he" as const, title, license, licenseLabel: license, credit: `${title}, via Sefaria (${license})`, url: "https://www.sefaria.org/x" });
const en = (license: string, title = "Synthetic English") => ({ language: "en" as const, title, license, licenseLabel: license, credit: `${title}, via Sefaria (${license})`, url: "https://www.sefaria.org/y" });
const text = (editions: ReturnType<typeof he | typeof en>[], hebrew = true, english = true) => ({ segments: [{ hebrew: hebrew ? [{ text: "synthetic-he" }] : null, english: english ? [{ text: "Synthetic English line." }] : null }], editions });
const base = { position: 1, ref: "Synthetic Mishnah 1:14", anchorRef: "Genesis 12:1", sefariaUrl: "https://www.sefaria.org/z", selectedBy: "Selected by Rabbi Synthetic" };
const answer = (...sources: DiscussionsAnswer["discussions"][number]["sources"][number][]): DiscussionsAnswer => ({ productName: "Synthetic Torah", complete: true, truncated: false,
  discussions: [{ slug: "q", title: "A synthetic question", kind: "torah", anchors: [...new Set(sources.map(s => s.anchorRef))], sources }] });
const edition = (editions: ReturnType<typeof he | typeof en>[], extra = {}) => ({ ...base, kind: "edition" as const, edition: "Synthetic English", credit: "route credit", text: text(editions), ...extra });
const translation = (editions: ReturnType<typeof he | typeof en>[] | null, body = "Synthetic translation.") => ({ ...base, kind: "translation" as const, translation: { body, originalEdition: "Synthetic Hebrew" },
  text: editions ? text(editions, true, false) : null });

test("print: a Sefaria edition prints only where its stated licence passes the appendix's filter, language by language, with its credit", () => {
  for (const printable of ["Public Domain", "CC0", "CC-BY", "CC BY 4.0", "CC-BY-NC"]) {
    const printed = printableSource(edition([he(printable), en(printable)]), "Synthetic Torah", "both")!;
    expect(printed.comments).toEqual([{ hebrew: [{ text: "synthetic-he" }], english: [{ text: "Synthetic English line." }] }]);
    expect(printed.credits).toEqual([`Synthetic Hebrew, via Sefaria (${printable})`, `Synthetic English, via Sefaria (${printable})`]);
  }
  for (const blocked of ["CC-BY-SA", "CC-BY-ND", "CC-BY-NC-SA", "unknown", "Copyright: Synthetic Press", ""]) {
    expect(printableSource(edition([he(blocked), en(blocked)]), "Synthetic Torah", "both"), blocked).toBeNull();
    // One language blocked: only the other prints, and only its credit.
    expect(printableSource(edition([he("CC0"), en(blocked)]), "Synthetic Torah", "both")).toMatchObject({ comments: [{ english: null }], credits: ["Synthetic Hebrew, via Sefaria (CC0)"] });
    expect(printableSource(edition([he(blocked), en("CC-BY")]), "Synthetic Torah", "both")).toMatchObject({ comments: [{ hebrew: null }], credits: ["Synthetic English, via Sefaria (CC-BY)"] });
  }
  // No text from Sefaria: nothing to print for an edition.
  expect(printableSource(edition([], { text: null }), "Synthetic Torah", "both")).toBeNull();
  // The sheet's Languages choice applies as it does to commentary.
  expect(printableSource(edition([he("CC0"), en("CC0")]), "Synthetic Torah", "english")).toMatchObject({ comments: [{ hebrew: null, english: [{ text: "Synthetic English line." }] }], credits: ["Synthetic English, via Sefaria (CC0)"] });
});

test("print: a Claude translation always prints with 'Claude translation for {productName}', and its original beside it only under the filter", () => {
  const withOriginal = printableSource(translation([he("CC0")], "A **bold** line.\n\n1. first\n2. second\n\n- bullet"), "Synthetic Torah", "both")!;
  expect(withOriginal.comments[0]).toEqual({ hebrew: [{ text: "synthetic-he" }], english: null });
  expect(withOriginal.comments.slice(1).map(c => c.english)).toEqual([[{ text: "A " }, { text: "bold", bold: true }, { text: " line." }], [{ text: "1. first" }], [{ text: "2. second" }], [{ text: "• bullet" }]]);
  expect(withOriginal.credits).toEqual(["Claude translation for Synthetic Torah", "Synthetic Hebrew, via Sefaria (CC0)"]);
  // The original is blocked, or never came: the translation still prints, credited, and the original does not.
  for (const original of [[he("CC-BY-SA")], null]) {
    const printed = printableSource(translation(original), "Another Product", "both")!;
    expect(printed.comments).toEqual([{ hebrew: null, english: [{ text: "Synthetic translation." }] }]);
    expect(printed.credits).toEqual(["Claude translation for Another Product"]);
  }
  // A Hebrew-only sheet prints the original where it can, and gives way to the translation where it cannot.
  expect(printableSource(translation([he("CC0")]), "Synthetic Torah", "hebrew")).toMatchObject({ comments: [{ hebrew: [{ text: "synthetic-he" }] }], credits: ["Synthetic Hebrew, via Sefaria (CC0)"] });
  expect(printableSource(translation([he("CC-BY-SA")]), "Synthetic Torah", "hebrew")!.credits).toEqual(["Claude translation for Synthetic Torah"]);
  expect(translationParagraphs("")).toEqual([]);
});

test("print: discussions join the appendix under its verse grouping, after the commentary, each source headed by its discussion's title, never naming the curator", () => {
  const two = answer(edition([he("CC0"), en("CC-BY")]), { ...translation([he("CC0")]), position: 2, anchorRef: "Genesis 12:2" }, { ...edition([he("CC-BY-SA"), en("CC-BY-SA")]), position: 3, anchorRef: "Genesis 12:2" });
  const rashi = { work: "rashi", label: "Rashi", forVerse: (ref: string) => ref === "Genesis 12:1" ? { status: "ready" as const, comments: [{ hebrew: null, english: [{ text: "Synthetic commentary." }] }], editions: [{ language: "en" as const, title: "R", license: "CC0" as const, credit: "R, via Sefaria (CC0)", url: "https://www.sefaria.org/r" }] } : { status: "none" as const } };
  const groups = buildAppendix(VERSES, [rashi], "both", two);
  expect(groups.map(group => group.ref)).toEqual(["Genesis 12:1", "Genesis 12:2"]);
  expect(groups[0].works.map(work => work.label)).toEqual(["Rashi", "A synthetic question: Synthetic Mishnah 1:14"]);
  expect(groups[1].works.map(work => work.label)).toEqual(["A synthetic question: Synthetic Mishnah 1:14"]); // the blocked edition at 12:2 is not listed
  expect(groups[1].works[0].credits).toContain("Claude translation for Synthetic Torah");
  expect(JSON.stringify(groups)).not.toMatch(/Rabbi Synthetic|Selected by/);
  // Off, or nothing answered: the appendix is the commentary alone, as before.
  expect(buildAppendix(VERSES, [rashi], "both").map(group => group.ref)).toEqual(["Genesis 12:1"]);
  expect(buildAppendix(VERSES, [], "both", null)).toEqual([]);
  expect(discussionWorks("Genesis 12:3", two, "both")).toEqual([]);
  expect(discussionWorks("Genesis 12:1", { ...two, productName: null }, "both")).toEqual([]);
});

const verse = (n: number): StudyVerse => ({ ref: `Genesis 12:${n}`, hebrew: { segments: [{ kind: "text", text: "אבג" }], paragraphAfter: null }, english: `Synthetic JPS ${n}`, apparatus: [] } as unknown as StudyVerse);
const sheet = (format: SheetFormat, groups = buildAppendix(VERSES, [], "both", answer(edition([he("CC0"), en("CC-BY")]), { ...translation([he("CC0")]), position: 2, anchorRef: "Genesis 12:2" }))) =>
  renderToStaticMarkup(createElement(PrintDocument, { heading: { title: "Synthetic portion", passage: "Torah Genesis 12:1-3", date: null }, text: { verses: [verse(1), verse(2), verse(3)], chapters: [{ ref: "Genesis 12", sefariaUrl: "https://www.sefaria.org/Genesis.12", fetchedAt: 0, hash: "a".repeat(64), editions: [studyEditions.mam, studyEditions.jps2023] }] },
    markers: new Map(), format, productName: "Synthetic Torah", appendix: groups }));

test("print: the appendix's page carries the discussions under verse headings with the same credits, and is titled for what it holds", () => {
  const only = sheet({ ...DEFAULT_FORMAT, discussions: true });
  expect(only).toContain("data-print-appendix"); expect(only).toContain('aria-label="Sources for this reading"'); expect(only).toContain(">Sources for this reading</p>");
  expect(only).toContain('data-appendix-ref="Genesis 12:1"'); expect(only).toContain('data-appendix-ref="Genesis 12:2"');
  expect(only).toContain("A synthetic question: Synthetic Mishnah 1:14");
  expect(only).toContain("Synthetic English line."); expect(only).toContain("Synthetic English, via Sefaria (CC-BY)");
  expect(only).toContain("Claude translation for Synthetic Torah"); expect(only).toContain("Synthetic translation.");
  expect(only).not.toMatch(/Rabbi Synthetic|Selected by/);
  // With commentary also chosen the page keeps its own name; with discussions off, or nothing to print, there is no appendix at all.
  expect(sheet({ ...DEFAULT_FORMAT, discussions: true, commentary: ["rashi"] })).toContain(">Commentary</p>");
  expect(sheet(DEFAULT_FORMAT, [])).not.toContain("data-print-appendix");
});

test("print: the choice lives in the address and the loose record, off by default, and is said plainly", () => {
  expect(DEFAULT_FORMAT.discussions).toBe(false);
  expect(formatEntries(DEFAULT_FORMAT)).toEqual([]);
  const on = { ...DEFAULT_FORMAT, discussions: true };
  expect(formatEntries(on)).toEqual([["disc", "on"]]);
  expect(parseFormat(new URLSearchParams("disc=on"))).toEqual(on);
  expect(parseFormat(new URLSearchParams("disc=maybe")).discussions).toBe(false);
  expect(formatFromRecord({ discussions: true })).toEqual({ format: on, problems: [] });
  expect(formatFromRecord({ discussions: "yes" }).problems).toEqual(["format.discussions must be true or false"]);
  expect(describeFormat(on)).toContain("curated discussions' sources");
  expect(describeFormat(DEFAULT_FORMAT)).not.toContain("discussions");
});

test("a truncated answer is read as it is, and each source carries its own selector's name", async () => {
  const rows = [row("first", 1, "Genesis 12:1", { selectedByName: "Rabbi One" }), row("second", 1, "Genesis 12:2", { selectedByName: "Rabbi Two" })];
  const cut = parseDiscussionsAnswer(await served(rows, syntheticPinned(), "Synthetic Torah", true), PASSAGE);
  expect(cut.truncated).toBe(true);
  expect(cut.discussions.flatMap(d => d.sources.map(s => s.selectedBy))).toEqual(["Selected by Rabbi One", "Selected by Rabbi Two"]);
  expect(parseDiscussionsAnswer(await served(rows), PASSAGE).truncated).toBe(false);
  const bad = await served(rows); bad.truncated = "yes";
  expect(() => parseDiscussionsAnswer(bad, PASSAGE)).toThrow();
});
