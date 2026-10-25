import { expect, test, vi } from "vitest";
import { unavailableExtras } from "../helpers/translations";
vi.mock("server-only", () => ({}));
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { COMMENTARY_LIMITS, COMMENTARY_WORKS, commentaryCandidates, commentaryChaptersOf, commentaryChapterOfVerse, commentaryEditionUrl, commentarySefariaUrl, NEVIIM_BOOKS,
  parseCommentaryChapter, TORAH_BOOKS, type CommentaryChapter } from "../../src/lib/readings/commentary";
import { sefariaRuns } from "../../src/server/study/sefaria-runs";
import { commentaryRequestUrl, CommentaryUnavailable, createSefariaCommentaryReader, validateCommentaryPayload } from "../../src/server/study/commentary";
import { handlePublicReadingRequest, type PublicRuntime } from "../../src/server/http/public-reading";
import { CommentaryCredits } from "../../src/components/portal/workspace/study/commentary-view";
import { createCommentaryChapterStore, parseCommentaryResponse } from "../../src/components/portal/workspace/study/commentary-api";
import { useCommentaryChapters } from "../../src/components/portal/workspace/study/use-commentary";
import { TANAKH_VERSE_COUNTS } from "../../src/lib/readings/catalog";
import { deferred } from "../helpers/study";
import { SYNTHETIC_ENGLISH, syntheticCommentaryFetch, syntheticCommentaryPayload, syntheticJsonResponse, versionParameter } from "../helpers/commentary";

// Invented syllables, numbered English labels and imitation markup only: no commentary text, no licensed translation.
const chapter = (work: string, value: string) => parseCommentaryChapter(work, value)!;
const genesis = () => chapter("rashi", "Genesis 1"), samuel = () => chapter("rashi", "I Samuel 20");
const invalid = (action: () => unknown) => { try { action(); } catch (error) { expect(error).toBeInstanceOf(CommentaryUnavailable); expect((error as CommentaryUnavailable).code).toBe("invalid-response"); return; } throw new Error("Expected refusal"); };

test("the registry holds Rashi and the Women's Commentary, with their verified pinned editions in preference order and a credit for each", () => {
  expect(Object.keys(COMMENTARY_WORKS)).toEqual(["rashi", "womens", "ramban", "ibn-ezra", "sforno", "rashbam", "or-hachaim", "kli-yakar", "chizkuni", "radak", "metzudat-david"]);
  expect(Object.isFrozen(COMMENTARY_WORKS) && Object.isFrozen(COMMENTARY_WORKS.rashi.editions.torah!.he)).toBe(true);
  const rashi = COMMENTARY_WORKS.rashi;
  expect(rashi).toMatchObject({ key: "rashi", title: "Rashi", hebrewTitle: "רש״י", index: "Rashi on {book}" });
  const titles = (corpus: "torah" | "neviim", language: "he" | "en") => rashi.editions[corpus]![language]!.map(item => `${item.title} | ${item.license}`);
  expect(titles("torah", "he")).toEqual(["Rashi Chumash, Metsudah Publications, 2009 | CC-BY", "Pentateuch with Rashi's commentary by M. Rosenbaum and A.M. Silbermann, 1929-1934 | Public Domain",
    "Pentateuch with Rashi's commentary by M. Rosenbaum and A.M. Silbermann -- corrected vocalization | Public Domain", "On Your Way | Public Domain"]);
  // 1.9 N1 (decision 9): Metsudah 2009 first, credited as Sefaria serves it, with the 1929 edition as the alternative.
  expect(titles("torah", "en")).toEqual(["Rashi Chumash, Metsudah Publications, 2009 | CC-BY", "Pentateuch with Rashi's commentary by M. Rosenbaum and A.M. Silbermann, 1929-1934 | Public Domain"]);
  expect(rashi.editions.torah!.en![0].credit).toBe("Rashi Chumash, Metsudah Publications, 2009, via Sefaria (CC BY). Markup and footnotes removed; spacing normalized.");
  expect(rashi.editions.torah!.he![0].credit).toBe(rashi.editions.torah!.en![0].credit);
  expect(titles("neviim", "he")).toEqual(["Vocalized Edition | CC0", "On Your Way | Public Domain", "On Your Way -- new | Public Domain"]);
  expect(titles("neviim", "en")).toEqual(["The Judaica Press complete Tanach with Rashi, translated by A. J. Rosenberg | CC-BY",
    "The Metsudah Tanach series, Lakewood, N.J | CC-BY", "The Book of Joshua, Metsudah Publications, 1997 | CC-BY"]);
  expect(rashi.editions.neviim!.en![0].credit).toBe("The Judaica Press complete Tanach with Rashi, translated by A. J. Rosenberg, via Sefaria (CC BY). Markup and footnotes removed; spacing normalized.");
  expect(rashi.editions.torah!.he![2].credit).toContain("(public domain)");
  const womens = COMMENTARY_WORKS.womens;
  expect(womens).toMatchObject({ key: "womens", index: "The Torah; A Women's Commentary, {book}", indexTitle: "The Torah; A Women's Commentary", complex: true,
    sectionNames: ["Chapter", "Verse", "Paragraph"] });
  expect(Object.keys(womens.editions)).toEqual(["torah"]); expect(womens.editions.torah!.he).toBeNull();
  expect(womens.editions.torah!.en!.map(item => `${item.title} | ${item.license}`)).toEqual(["CCAR Press and Women of Reform Judaism, 2008 | CC-BY-NC"]);
  expect(womens.editions.torah!.en![0].credit).toBe("The Torah: A Women's Commentary (CCAR Press and Women of Reform Judaism, 2008), via Sefaria (CC BY-NC). Markup and footnotes removed; spacing normalized.");
});

test("chapters: a registered work and a real Torah or Nevi'im chapter only", () => {
  expect(genesis()).toMatchObject({ chapter: "Genesis 1", book: "Genesis", number: 1, verseCount: 31, corpus: "torah", index: "Rashi on Genesis", ref: "Rashi on Genesis 1" });
  expect(samuel()).toMatchObject({ corpus: "neviim", verseCount: 42, ref: "Rashi on I Samuel 20" });
  for (const book of [...TORAH_BOOKS, ...NEVIIM_BOOKS]) {
    const last = TANAKH_VERSE_COUNTS[book].length;
    expect(parseCommentaryChapter("rashi", `${book} ${last}`), book).not.toBeNull();
    expect(parseCommentaryChapter("rashi", `${book} ${last + 1}`), book).toBeNull();
  }
  for (const value of ["Psalms 1", "Ruth 1", "Esther 1", "I Chronicles 1", "Song of Songs 1", "Genesis 0", "Genesis 01", "Genesis 1:1", "genesis 1", "Genesis", " Genesis 1", "Genesis  1", "", "Genesis 1000"])
    expect(parseCommentaryChapter("rashi", value), value).toBeNull();
  for (const work of ["malbim", "Rashi", "", "__proto__", "constructor", "toString", null, 1]) expect(parseCommentaryChapter(work, "Genesis 1"), String(work)).toBeNull();
  expect(commentaryChapterOfVerse("rashi", "Genesis 1:31")?.chapter).toBe("Genesis 1");
  expect(commentaryChapterOfVerse("rashi", "Genesis 1:32")).toBeNull();
  expect(commentaryChapterOfVerse("rashi", "Psalms 1:1")).toBeNull();
  expect(commentaryChaptersOf("rashi", ["Genesis 1:30", "Genesis 1:31", "Genesis 2:1", "Ruth 1:1", "Isaiah 40:1"])).toEqual(["Genesis 1", "Genesis 2", "Isaiah 40"]);
  expect(commentaryChaptersOf("malbim", ["Genesis 1:1"])).toEqual([]);
  expect(commentarySefariaUrl(samuel(), 5)).toBe("https://www.sefaria.org/Rashi_on_I_Samuel.20.5");
  expect(commentaryEditionUrl(samuel(), commentaryCandidates(samuel()).en[1])).toBe("https://www.sefaria.org/Rashi_on_I_Samuel.20?ven=The_Metsudah_Tanach_series%2C_Lakewood%2C_N.J&lang=bi");
});

test("the sanitiser keeps text and bold runs, drops footnotes and every other tag, decodes entities and normalizes", () => {
  expect(sefariaRuns("<b>אָב גַּד.</b> הוּ זַח")).toEqual([{ text: "אָב גַּד.", bold: true }, { text: " הוּ זַח" }]);
  expect(sefariaRuns("<strong>LEMMA</strong>  text <b>two</b>")).toEqual([{ text: "LEMMA", bold: true }, { text: " text " }, { text: "two", bold: true }]);
  expect(sefariaRuns(SYNTHETIC_ENGLISH)).toEqual([{ text: "SYNTHETIC LEMMA", bold: true }, { text: " — synthetic comment." }]);
  expect(sefariaRuns("a<sup>2</sup>b<sup class=\"footnote-marker\">*</sup>c<i class=\"footnote\">note <i>nested</i> more</i>d")).toEqual([{ text: "abcd" }]);
  expect(sefariaRuns("<span class=\"x\">one</span> <a href=\"https://example.test\">two</a> <small>three</small> <u>four</u>")).toEqual([{ text: "one two three four" }]);
  expect(sefariaRuns("<i>A synthetic title</i> plain <em>em</em> <b><i>1-3.</i></b> body")).toEqual([{ text: "A synthetic title", italic: true }, { text: " plain " },
    { text: "em", italic: true }, { text: " " }, { text: "1-3.", bold: true, italic: true }, { text: " body" }]);
  expect(sefariaRuns("&amp; &lt;b&gt; &quot;q&quot; &#39;s&#39; a&nbsp;b &#x5D0;&#1489;")).toEqual([{ text: "& <b> \"q\" 's' a b אב" }]);
  expect(sefariaRuns("<script>alert(1)</script><style>b{}</style>safe<img src=x onerror=alert(1)><!-- hidden -->")).toEqual([{ text: "safe" }]);
  expect(sefariaRuns("  line\none\t\ttwo<br>three  ")).toEqual([{ text: "line one two three" }]);
  expect(sefariaRuns("a\u202Eb\u2066c\uFEFFd\u0007e")).toEqual([{ text: "abcde" }]);
  expect(sefariaRuns("a\uFFF9b\uFFFBc\u{E0041}d")).toEqual([{ text: "abcd" }]);
  expect(sefariaRuns("a\u200Eb")[0].text).toBe("a\u200Eb"); // direction marks are real in Hebrew text and stay
  // NFC: a decomposed sequence is composed; Hebrew points stay.
  expect(sefariaRuns("é")[0].text).toBe("é");
  expect(sefariaRuns("<b> </b>")).toEqual([]);
  expect(sefariaRuns("")).toEqual([]);
  expect(sefariaRuns("<b>bold <i>nested</i></b> plain")).toEqual([{ text: "bold ", bold: true }, { text: "nested", bold: true, italic: true }, { text: " plain" }]);
  expect(() => sefariaRuns("x".repeat(COMMENTARY_LIMITS.runChars + 1))).toThrow();
  expect(() => sefariaRuns(5)).toThrow();
});

test("a valid chapter pairs Hebrew and English comments by segment, omits uncommented verses and names the editions used", () => {
  const result = validateCommentaryPayload(syntheticCommentaryPayload("rashi", "Genesis 1"), genesis());
  expect(Object.keys(result.verses)).toEqual(["1", "3"]);
  expect(result.verses["3"].comments).toHaveLength(2);
  expect(result.verses["3"].comments[1]).toEqual({ hebrew: [{ text: "אָב גַּד.", bold: true }, { text: " הוּ זַח טִי" }],
    english: [{ text: "SYNTHETIC LEMMA", bold: true }, { text: " — synthetic comment. 3.2" }] });
  expect(result.work).toBe("rashi"); expect(result.chapter).toBe("Genesis 1");
  expect(result.editions).toEqual([
    { language: "he", title: commentaryCandidates(genesis()).he[0].title, license: "CC-BY", credit: commentaryCandidates(genesis()).he[0].credit, url: commentaryEditionUrl(genesis(), commentaryCandidates(genesis()).he[0]) },
    { language: "en", title: commentaryCandidates(genesis()).en[0].title, license: "CC-BY", credit: commentaryCandidates(genesis()).en[0].credit, url: commentaryEditionUrl(genesis(), commentaryCandidates(genesis()).en[0]) }]);
  // Sefaria pads some chapters with empty slots past the last verse.
  expect(validateCommentaryPayload(syntheticCommentaryPayload("rashi", "Genesis 1", { padding: 400 }), genesis())).toEqual(result);
  // Text in a slot past the last verse (a work's own versification) is shape-checked and left out, never fatal.
  const padded = syntheticCommentaryPayload("rashi", "Genesis 1", { padding: 2 }); padded.versions[0].text[31] = ["<b>x</b>"];
  expect(validateCommentaryPayload(padded, genesis())).toEqual(result);
  const notText = syntheticCommentaryPayload("rashi", "Genesis 1", { padding: 2 }); (notText.versions[0].text[32] as unknown[]) = [7];
  invalid(() => validateCommentaryPayload(notText, genesis()));
  // Short arrays are fine: verses past the end of the edition simply have no comment.
  const short = syntheticCommentaryPayload("rashi", "Genesis 1"); for (const version of short.versions) version.text = version.text.slice(0, 3);
  expect(Object.keys(validateCommentaryPayload(short, genesis()).verses)).toEqual(["1", "3"]);
});

test("Study's Rashi on Genesis 18:1 shows Metsudah 2009 first with its credit, and the 1929 edition is one link away", () => {
  const gen18 = chapter("rashi", "Genesis 18"), torah = commentaryCandidates(gen18);
  // Synthetic payload: both editions present with text in Genesis 18:1, Metsudah pinned first in both languages.
  const served = validateCommentaryPayload(syntheticCommentaryPayload("rashi", "Genesis 18", { present: [...torah.he.slice(0, 2), ...torah.en], commented: { 1: 1 } }), gen18);
  expect(served.editions.map(item => `${item.language}:${item.title}:${item.license}`)).toEqual(
    ["he:Rashi Chumash, Metsudah Publications, 2009:CC-BY", "en:Rashi Chumash, Metsudah Publications, 2009:CC-BY"]);
  const state = { status: "ready" as const, comments: served.verses["1"].comments, editions: served.editions, sefariaUrl: commentarySefariaUrl(gen18, 1) };
  const markup = renderToStaticMarkup(createElement(CommentaryCredits, { works: [{ work: "rashi", lookup: { forVerse: () => state } }], refs: ["Genesis 18:1"] }));
  expect(markup).toContain("Hebrew and English: <a");
  expect(markup).toContain("Rashi Chumash, Metsudah Publications, 2009, via Sefaria (CC BY).");
  expect(markup).not.toContain("Silbermann");
  expect(markup).toContain('href="https://www.sefaria.org/Rashi_on_Genesis.18?vhe=Rashi_Chumash%2C_Metsudah_Publications%2C_2009&amp;lang=bi"');
  // The alternative is the next pinned English edition, with its own Sefaria link.
  expect(torah.en[1].title).toContain("Silbermann, 1929-1934");
  expect(commentaryEditionUrl(gen18, torah.en[1])).toContain("https://www.sefaria.org/Rashi_on_Genesis.18?ven=Pentateuch_with_Rashi");
});

test("missing editions fall back in preference order, per language, and a chapter with none is empty rather than an error", () => {
  const torah = commentaryCandidates(genesis()), neviim = commentaryCandidates(samuel());
  const fallback = validateCommentaryPayload(syntheticCommentaryPayload("rashi", "Genesis 1", { present: [torah.he[3], torah.en[1]] }), genesis());
  expect(fallback.editions.map(item => item.title)).toEqual(["On Your Way", torah.en[1].title]);
  // Metsudah missing from a chapter: the 1929 edition answers in both languages, which is the alternative.
  const alternative = validateCommentaryPayload(syntheticCommentaryPayload("rashi", "Genesis 1", { present: [torah.he[1], torah.en[1]] }), genesis());
  expect(alternative.editions.map(item => `${item.language}:${item.title}:${item.license}`)).toEqual([`he:${torah.he[1].title}:Public Domain`, `en:${torah.en[1].title}:Public Domain`]);
  // Both present: Metsudah wins in both languages.
  const both = validateCommentaryPayload(syntheticCommentaryPayload("rashi", "Genesis 1", { present: [...torah.he.slice(0, 2), ...torah.en] }), genesis());
  expect(both.editions.map(item => `${item.language}:${item.title}`)).toEqual([`he:${torah.he[0].title}`, `en:${torah.en[0].title}`]);
  const metsudah = validateCommentaryPayload(syntheticCommentaryPayload("rashi", "I Samuel 20", { present: [neviim.he[0], neviim.en[1]] }), samuel());
  expect(metsudah.editions.map(item => `${item.language}:${item.title}:${item.license}`)).toEqual(["he:Vocalized Edition:CC0", "en:The Metsudah Tanach series, Lakewood, N.J:CC-BY"]);
  // A preferred edition that is present but has nothing in this chapter yields to the next.
  const emptyFirst = syntheticCommentaryPayload("rashi", "Genesis 1", { present: [torah.he[1], torah.he[3], torah.en[1]],
    text: (candidate, verse, c) => candidate === torah.he[1] ? "" : candidate.language === "he" ? "<b>אָב.</b> גַּד" : `Synthetic ${verse}.${c}` });
  expect(validateCommentaryPayload(emptyFirst, genesis()).editions[0].title).toBe("On Your Way");
  // Hebrew only: English is null on every comment and only the Hebrew edition is named.
  const hebrewOnly = validateCommentaryPayload(syntheticCommentaryPayload("rashi", "I Samuel 20", { present: [neviim.he[0]] }), samuel());
  expect(hebrewOnly.verses["1"].comments[0].english).toBeNull(); expect(hebrewOnly.editions.map(item => item.language)).toEqual(["he"]);
  const none = validateCommentaryPayload(syntheticCommentaryPayload("rashi", "Genesis 1", { present: [] }), genesis());
  expect(none).toEqual({ work: "rashi", chapter: "Genesis 1", verses: {}, editions: [] });
});

test("payload validation is strict about shape, editions and warnings", () => {
  const base = () => syntheticCommentaryPayload("rashi", "Genesis 1") as Record<string, unknown> & ReturnType<typeof syntheticCommentaryPayload>;
  const torah = commentaryCandidates(genesis());
  const cases: [string, (p: ReturnType<typeof base>) => void][] = [
    ["wrong ref", p => { p.ref = "Rashi on Genesis 2"; }], ["wrong book", p => { p.book = "Ramban on Genesis"; }], ["depth 2", p => { (p as Record<string, unknown>).textDepth = 2; }],
    ["complex", p => { (p as Record<string, unknown>).isComplex = true; }], ["spanning", p => { (p as Record<string, unknown>).isSpanning = true; }],
    ["section names", p => { p.sectionNames = ["Chapter", "Verse"]; }], ["sections", p => { p.sections = ["2"]; }], ["to sections", p => { p.toSections = ["1", "2"]; }],
    ["versions not array", p => { (p as Record<string, unknown>).versions = {}; }], ["warnings missing", p => { delete (p as Record<string, unknown>).warnings; }],
    ["verse is a string", p => { (p.versions[0].text as unknown[])[0] = "<b>x</b>"; }], ["comment not a string", p => { (p.versions[0].text[0] as unknown[])[0] = 7; }],
    ["too many comments", p => { p.versions[0].text[0] = Array.from({ length: COMMENTARY_LIMITS.commentsPerVerse + 1 }, () => "x"); }],
    ["too many verse slots", p => { p.versions[0].text = Array.from({ length: 1001 }, () => []); }],
    ["unrequested edition", p => { p.versions[0].versionTitle = "Unpinned synthetic edition"; }],
    ["licence changed", p => { (p.versions[1] as Record<string, unknown>).license = "CC-BY-NC"; }], ["language mismatch", p => { p.versions[0].actualLanguage = "en"; }],
    ["duplicate edition", p => { p.versions.push(structuredClone(p.versions[0])); }],
    ["warning for a returned edition", p => { p.warnings.push({ [versionParameter(torah.he[0])]: { warning_code: 101, message: "x" } }); }],
    ["warning for an unrequested edition", p => { p.warnings.push({ "english|Unpinned": { warning_code: 101, message: "x" } }); }],
    ["unknown warning code", p => { p.warnings[0] = { [Object.keys(p.warnings[0])[0]]: { warning_code: 500, message: "x" } }; }],
    ["an edition neither returned nor warned", p => { p.warnings.pop(); }],
    ["a warning with two keys", p => { p.warnings[0] = { ...p.warnings[0], other: { warning_code: 101, message: "x" } }; }],
  ];
  expect(validateCommentaryPayload(base(), genesis()).editions).toHaveLength(2);
  for (const [name, mutate] of cases) { const payload = base(); mutate(payload); try { validateCommentaryPayload(payload, genesis()); throw new Error(`accepted: ${name}`); } catch (error) { expect(error, name).toBeInstanceOf(CommentaryUnavailable); } }
  invalid(() => validateCommentaryPayload(null, genesis()));
  invalid(() => validateCommentaryPayload(syntheticCommentaryPayload("rashi", "Genesis 1", { text: () => "x".repeat(COMMENTARY_LIMITS.runChars + 1) }), genesis()));
});

test("the reader asks Sefaria for every pinned edition in one bounded request and maps failures to upstream or invalid", async () => {
  const url = commentaryRequestUrl(samuel());
  expect(url.origin + url.pathname).toBe("https://www.sefaria.org/api/v3/texts/Rashi%20on%20I%20Samuel%2020");
  expect(url.searchParams.getAll("version")).toEqual(commentaryCandidates(samuel()).he.concat(commentaryCandidates(samuel()).en).map(versionParameter));
  expect(url.searchParams.get("fill_in_missing_segments")).toBe("0"); expect(url.searchParams.get("return_format")).toBe("default");
  const fetch = vi.fn(syntheticCommentaryFetch()), read = createSefariaCommentaryReader({ fetch: fetch as typeof globalThis.fetch });
  expect(Object.keys((await read("rashi", "I Samuel 20")).verses)).toEqual(["1", "3"]);
  const init = (fetch.mock.calls[0] as unknown[])[1] as RequestInit;
  expect(init).toMatchObject({ method: "GET", credentials: "omit", redirect: "error", cache: "no-store" });
  const code = async (reader: ReturnType<typeof createSefariaCommentaryReader>, work = "rashi", value = "Genesis 1", signal?: AbortSignal) => {
    try { await reader(work, value, signal); return "ok"; } catch (error) { return error instanceof CommentaryUnavailable ? error.code : "other"; }
  };
  const answering = (response: () => Response | Promise<Response>) => createSefariaCommentaryReader({ fetch: (async () => response()) as typeof globalThis.fetch, requestMs: 200 });
  expect(await code(read, "malbim")).toBe("invalid-request"); expect(await code(read, "rashi", "Psalms 1")).toBe("invalid-request");
  expect(await code(answering(() => { throw new TypeError("synthetic network"); }))).toBe("upstream");
  expect(await code(answering(() => new Response("{}", { status: 500, headers: { "content-type": "application/json" } })))).toBe("upstream");
  expect(await code(answering(() => new Response("<html>", { headers: { "content-type": "text/html" } })))).toBe("upstream");
  expect(await code(answering(() => new Response("not json", { headers: { "content-type": "application/json" } })))).toBe("invalid-response");
  expect(await code(answering(() => new Response("{}", { headers: { "content-type": "application/json", "content-length": String(2 * 1024 * 1024) } })))).toBe("invalid-response");
  expect(await code(answering(() => syntheticJsonResponse({ ...syntheticCommentaryPayload("rashi", "Genesis 1"), filler: "x".repeat(1024 * 1024) })))).toBe("invalid-response");
  expect(await code(answering(() => new Promise<Response>(() => {})))).toBe("upstream"); // the deadline
  const controller = new AbortController(), gate = deferred<Response>();
  const pending = code(answering(() => gate.promise), "rashi", "Genesis 1", controller.signal); controller.abort();
  expect(await pending).toBe("upstream");
  expect(() => createSefariaCommentaryReader({ fetch: fetch as typeof globalThis.fetch, requestMs: 5001 })).toThrow();
});

test("the public commentary route serves a canonical, CDN-cacheable chapter and is quiet about failure", async () => {
  const origin = "https://beitmitzvah.centralreform.org", path = "/api/public/commentary?work=rashi&chapter=I+Samuel+20";
  let opened = 0;
  const commentary = vi.fn(createSefariaCommentaryReader({ fetch: syntheticCommentaryFetch() as typeof globalThis.fetch }));
  const runtime = { resolveTenant: vi.fn(async () => undefined), reading: {} as PublicRuntime["reading"], commentary, ...unavailableExtras } satisfies PublicRuntime;
  const scope = async (action: (r: PublicRuntime) => Promise<Response>) => { opened++; return action(runtime); };
  const response = await handlePublicReadingRequest(new Request(origin + path), scope);
  expect(response.status).toBe(200);
  expect(response.headers.get("vercel-cdn-cache-control")).toBe("public, s-maxage=2592000, stale-while-revalidate=86400");
  expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
  expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow"); expect(response.headers.get("set-cookie")).toBeNull();
  const body = await response.json();
  expect(Object.keys(body)).toEqual(["work", "chapter", "verses", "editions"]);
  expect(parseCommentaryResponse(body, "rashi", "I Samuel 20")).toEqual(body);
  expect(commentary).toHaveBeenCalledWith("rashi", "I Samuel 20", expect.any(AbortSignal));
  expect(runtime.resolveTenant).toHaveBeenCalledTimes(1);
  // An answer with no edition at all may be a momentary gap upstream: an hour, not a month.
  commentary.mockResolvedValueOnce({ work: "rashi", chapter: "I Samuel 20", verses: {}, editions: [] });
  const empty = await handlePublicReadingRequest(new Request(origin + path), scope);
  expect(empty.status).toBe(200); expect(empty.headers.get("vercel-cdn-cache-control")).toBe("public, s-maxage=3600");
  commentary.mockRejectedValueOnce(new CommentaryUnavailable("upstream"));
  const down = await handlePublicReadingRequest(new Request(origin + path), scope);
  expect(down.status).toBe(503); expect(down.headers.get("cache-control")).toBe("no-store"); expect(down.headers.get("vercel-cdn-cache-control")).toBe("no-store");
  commentary.mockRejectedValueOnce(new Error("synthetic bug"));
  expect((await handlePublicReadingRequest(new Request(origin + path), scope)).status).toBe(503);
  runtime.resolveTenant.mockRejectedValueOnce(Object.assign(new (await import("../../src/server/access/errors")).AccessDenied(404)));
  expect((await handlePublicReadingRequest(new Request(origin + path), scope)).status).toBe(404);
  const before = opened;
  for (const bad of ["/api/public/commentary?work=malbim&chapter=Genesis+1", "/api/public/commentary?work=rashi&chapter=Psalms+23", "/api/public/commentary?work=rashi&chapter=Genesis+51"]) {
    const refused = await handlePublicReadingRequest(new Request(origin + bad), scope);
    expect(refused.status, bad).toBe(400); expect(refused.headers.get("cache-control")).toBe("no-store");
  }
  expect((await handlePublicReadingRequest(new Request(origin + path, { headers: { authorization: "Bearer synthetic" } }), scope)).status).toBe(400);
  expect((await handlePublicReadingRequest(new Request(origin + path, { method: "POST", body: "{}" }), scope)).status).toBe(405);
  expect(opened).toBe(before);
});

test("the browser parser accepts exactly the server's shape and refuses anything else", () => {
  const good = JSON.parse(JSON.stringify(validateCommentaryPayload(syntheticCommentaryPayload("rashi", "Genesis 1"), genesis()))) as CommentaryChapter;
  expect(parseCommentaryResponse(good, "rashi", "Genesis 1")).toEqual(good);
  expect(parseCommentaryResponse({ work: "rashi", chapter: "Genesis 1", verses: {}, editions: [] }, "rashi", "Genesis 1").verses).toEqual({});
  expect(good.editions.every(item => typeof item.credit === "string" && item.credit.includes("via Sefaria"))).toBe(true);
  const mutations: [string, (v: Record<string, any>) => void][] = [
    ["extra key", v => { v.extra = 1; }], ["other work", v => { v.work = "ramban"; }], ["other chapter", v => { v.chapter = "Genesis 2"; }],
    ["verse out of range", v => { v.verses["32"] = v.verses["1"]; }], ["verse zero", v => { v.verses["0"] = v.verses["1"]; }], ["non-numeric verse", v => { v.verses.x = v.verses["1"]; }],
    ["empty comments", v => { v.verses["1"] = { comments: [] }; }], ["comment extra key", v => { v.verses["1"].comments[0].note = "x"; }],
    ["bold not true", v => { v.verses["1"].comments[0].hebrew[0].bold = false; }], ["run html is still text but empty refused", v => { v.verses["1"].comments[0].hebrew[0].text = ""; }],
    ["run not string", v => { v.verses["1"].comments[0].hebrew[0].text = 1; }], ["empty english array", v => { v.verses["1"].comments[0].english = []; }],
    ["unknown edition", v => { v.editions[0].title = "Unpinned"; }], ["edition url changed", v => { v.editions[0].url = "https://example.test/"; }],
    ["two Hebrew editions", v => { v.editions[1] = v.editions[0]; }], ["comments without editions", v => { v.editions = []; }],
    ["verses array", v => { v.verses = []; }], ["too many comments", v => { v.verses["1"].comments = Array.from({ length: COMMENTARY_LIMITS.commentsPerVerse + 1 }, () => v.verses["3"].comments[0]); }],
  ];
  for (const [name, mutate] of mutations) {
    const value = structuredClone(good) as Record<string, any>; mutate(value);
    expect(() => parseCommentaryResponse(value, "rashi", "Genesis 1"), name).toThrow();
  }
  expect(() => parseCommentaryResponse(good, "rashi", "Psalms 1")).toThrow();
});

test("the chapter store loads each chapter once, two at a time, keeps failures quiet and forgets aborted loads", async () => {
  const gates = new Map<string, ReturnType<typeof deferred<CommentaryChapter>>>(), calls: string[] = [];
  const fetchChapter = vi.fn((_work: string, value: string, signal: AbortSignal) => {
    calls.push(value); const gate = deferred<CommentaryChapter>(); gates.set(value, gate);
    return new Promise<CommentaryChapter>((resolve, reject) => { gate.promise.then(resolve, reject); signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }); });
  });
  const store = createCommentaryChapterStore("rashi", fetchChapter), changed = vi.fn();
  expect(store.forVerse("Psalms 1:1")).toEqual({ status: "none" });
  const stop = store.load(["Genesis 1", "Genesis 2", "Isaiah 40", "Genesis 1", "Psalms 1"], changed);
  expect(calls).toEqual(["Genesis 1", "Genesis 2"]); // two at a time, Ketuvim never requested
  expect(store.forVerse("Genesis 1:3")).toEqual({ status: "loading" });
  const ready = validateCommentaryPayload(syntheticCommentaryPayload("rashi", "Genesis 1"), genesis());
  gates.get("Genesis 1")!.resolve(ready); await vi.waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
  expect(calls).toEqual(["Genesis 1", "Genesis 2", "Isaiah 40"]);
  expect(store.forVerse("Genesis 1:3")).toMatchObject({ status: "ready", sefariaUrl: "https://www.sefaria.org/Rashi_on_Genesis.1.3" });
  expect((store.forVerse("Genesis 1:3") as { comments?: readonly unknown[] }).comments).toHaveLength(2);
  expect(store.forVerse("Genesis 1:2")).toMatchObject({ status: "ready", comments: [] });
  // Leaving the page aborts what is in flight; those chapters are retried by the next page that needs them.
  stop();
  expect(store.state("Genesis 2")).toBeUndefined(); expect(store.state("Isaiah 40")).toBeUndefined();
  const again = store.load(["Genesis 1", "Genesis 2"], changed);
  expect(calls).toEqual(["Genesis 1", "Genesis 2", "Isaiah 40", "Genesis 2"]); // Genesis 1 is never fetched twice
  gates.get("Genesis 2")!.resolve(Promise.reject(new Error("synthetic failure")) as never); // a rejected load
  await vi.waitFor(() => expect(store.forVerse("Genesis 2:1")).toEqual({ status: "failed" }));
  const quiet = store.load(["Genesis 2"], changed); expect(calls.filter(value => value === "Genesis 2")).toHaveLength(2); // failed stays failed, quietly
  quiet(); again(); quiet(); // cleanups are idempotent
});

test("a shared store notifies every consumer, aborts only what nobody wants, and retries a failure after a pause", async () => {
  let time = 0; const gates = new Map<string, ReturnType<typeof deferred<CommentaryChapter>>>(), calls: string[] = [], aborted: string[] = [];
  const fetchChapter = vi.fn((_work: string, value: string, signal: AbortSignal) => {
    calls.push(value); const gate = deferred<CommentaryChapter>(); gates.set(value, gate);
    return new Promise<CommentaryChapter>((resolve, reject) => { gate.promise.then(resolve, reject); signal.addEventListener("abort", () => { aborted.push(value); reject(new Error("aborted")); }, { once: true }); });
  });
  const store = createCommentaryChapterStore("rashi", fetchChapter, 2, () => time), first = vi.fn(), second = vi.fn();
  const a = store.load(["Genesis 1"], first), b = store.load(["Genesis 1"], second);
  expect(calls).toEqual(["Genesis 1"]); // one fetch for two consumers
  a(); expect(aborted).toEqual([]); // the second consumer still wants it
  gates.get("Genesis 1")!.resolve(validateCommentaryPayload(syntheticCommentaryPayload("rashi", "Genesis 1"), genesis()));
  await vi.waitFor(() => expect(second).toHaveBeenCalled());
  expect(first).not.toHaveBeenCalled(); // unsubscribed
  expect(store.forVerse("Genesis 1:1").status).toBe("ready");
  b();
  // A consumer that leaves while it is the only one interested aborts the fetch, and every consumer hears of it.
  const c = store.load(["Genesis 2"], first), d = store.load(["Exodus 1"], second);
  c(); expect(aborted).toEqual(["Genesis 2"]); expect(second).toHaveBeenCalledTimes(2); expect(store.state("Genesis 2")).toBeUndefined();
  gates.get("Exodus 1")!.resolve(Promise.reject(new Error("synthetic timeout")) as never);
  await vi.waitFor(() => expect(store.forVerse("Exodus 1:1")).toEqual({ status: "failed" }));
  d();
  store.load(["Exodus 1"], second)(); expect(calls.filter(value => value === "Exodus 1")).toHaveLength(1);
  time = 60_000; const e = store.load(["Exodus 1"], second); expect(calls.filter(value => value === "Exodus 1")).toHaveLength(2); // retried after the pause
  e();
  // A consumer that joined a failed fetch, then leaves, never cancels a later retry another consumer started.
  const early = store.load(["Numbers 1"], first);
  gates.get("Numbers 1")!.resolve(Promise.reject(new Error("synthetic failure")) as never);
  await vi.waitFor(() => expect(store.forVerse("Numbers 1:1")).toEqual({ status: "failed" }));
  time += 61_000; const late = store.load(["Numbers 1"], second);
  expect(calls.filter(value => value === "Numbers 1")).toHaveLength(2);
  early(); expect(aborted).not.toContain("Numbers 1"); expect(store.forVerse("Numbers 1:1")).toEqual({ status: "loading" });
  gates.get("Numbers 1")!.resolve(validateCommentaryPayload(syntheticCommentaryPayload("rashi", "Numbers 1"), chapter("rashi", "Numbers 1")));
  await vi.waitFor(() => expect(store.forVerse("Numbers 1:1").status).toBe("ready"));
  late();
  // A listener that throws never stops the others.
  const f = store.load(["Leviticus 1"], () => { throw new Error("synthetic consumer bug"); }), g = store.load(["Leviticus 1"], first);
  gates.get("Leviticus 1")!.resolve(validateCommentaryPayload(syntheticCommentaryPayload("rashi", "Leviticus 1"), chapter("rashi", "Leviticus 1")));
  await vi.waitFor(() => expect(store.forVerse("Leviticus 1:1").status).toBe("ready"));
  expect(first).toHaveBeenCalled(); f(); g();
});

test("the hook renders nothing in the way: no fetch while rendering, loading for covered verses, none when off or uncovered", () => {
  const fetchChapter = vi.fn(async () => { throw new Error("must not fetch during render"); });
  const seen: string[] = [];
  const Probe = ({ enabled, work }: { enabled: boolean; work: string }) => {
    const lookup = useCommentaryChapters(work, ["Genesis 1:1", "Ruth 1:1"], enabled, createCommentaryChapterStore(work, fetchChapter));
    seen.push(["Genesis 1:1", "Ruth 1:1"].map(ref => lookup.forVerse(ref).status).join(","));
    return null;
  };
  renderToStaticMarkup(createElement(Probe, { enabled: true, work: "rashi" }));
  renderToStaticMarkup(createElement(Probe, { enabled: false, work: "rashi" }));
  renderToStaticMarkup(createElement(Probe, { enabled: true, work: "malbim" }));
  expect(seen).toEqual(["loading,none", "none,none", "none,none"]);
  expect(fetchChapter).not.toHaveBeenCalled();
  // A store for another work is ignored rather than looping.
  const Mismatch = () => {
    const lookup = useCommentaryChapters("womens", ["Genesis 1:1"], true, createCommentaryChapterStore("rashi", fetchChapter));
    seen.push(lookup.forVerse("Genesis 1:1").status); return null;
  };
  expect(() => renderToStaticMarkup(createElement(Mismatch))).not.toThrow();
  expect(seen.at(-1)).toBe("loading");
});

test("the Women's Commentary: a complex, English-only, Torah-only index whose paragraphs keep their order, italics and headings", async () => {
  const womens = chapter("womens", "Genesis 12");
  expect(womens).toMatchObject({ index: "The Torah; A Women's Commentary, Genesis", indexTitle: "The Torah; A Women's Commentary", ref: "The Torah; A Women's Commentary, Genesis 12" });
  for (const value of ["Isaiah 40", "I Samuel 20", "Psalms 1"]) expect(parseCommentaryChapter("womens", value), value).toBeNull();
  expect(commentarySefariaUrl(womens, 1)).toBe("https://www.sefaria.org/The_Torah;_A_Women's_Commentary,_Genesis.12.1");
  expect(commentaryRequestUrl(womens).searchParams.getAll("version")).toEqual(["english|CCAR Press and Women of Reform Judaism, 2008"]);
  expect(commentaryRequestUrl(womens).pathname).toBe("/api/v3/texts/" + encodeURIComponent("The Torah; A Women's Commentary, Genesis 12"));
  // Invented paragraphs in the work's shape: an italic title, a capitalized heading, prose with an italic lead, a bold-italic verse lemma.
  const paragraphs = ["<i>The Synthetic Title</i>", "SYNTHETIC SECTION HEADING (12:1–9)", "<i>Synthetic lead</i> synthetic prose (12:1).", "<b><i>1–3.</i></b> More synthetic prose."];
  const payload = syntheticCommentaryPayload("womens", "Genesis 12", { commented: { 1: 4, 5: 1 }, text: (_candidate, verse, c) => verse === 1 ? paragraphs[c] : "Synthetic 5." });
  expect(payload).toMatchObject({ isComplex: true, book: "The Torah; A Women's Commentary, Genesis", indexTitle: "The Torah; A Women's Commentary", sectionNames: ["Chapter", "Verse", "Paragraph"], warnings: [] });
  const result = validateCommentaryPayload(payload, womens);
  expect(result.verses["1"].comments).toEqual([
    { hebrew: null, english: [{ text: "The Synthetic Title", italic: true }] },
    { hebrew: null, english: [{ text: "SYNTHETIC SECTION HEADING (12:1–9)" }] },
    { hebrew: null, english: [{ text: "Synthetic lead", italic: true }, { text: " synthetic prose (12:1)." }] },
    { hebrew: null, english: [{ text: "1–3.", bold: true, italic: true }, { text: " More synthetic prose." }] }]);
  expect(Object.keys(result.verses)).toEqual(["1", "5"]);
  expect(result.editions).toEqual([{ language: "en", title: "CCAR Press and Women of Reform Judaism, 2008", license: "CC-BY-NC",
    credit: "The Torah: A Women's Commentary (CCAR Press and Women of Reform Judaism, 2008), via Sefaria (CC BY-NC). Markup and footnotes removed; spacing normalized.",
    url: "https://www.sefaria.org/The_Torah;_A_Women's_Commentary,_Genesis.12?ven=CCAR_Press_and_Women_of_Reform_Judaism%2C_2008&lang=bi" }]);
  // The same strictness as Rashi: a simple-index shape, Rashi's section names or a wrong work title are refused.
  for (const mutate of [(p: Record<string, unknown>) => { p.isComplex = false; }, (p: Record<string, unknown>) => { p.sectionNames = ["Chapter", "Verse", "Comment"]; },
    (p: Record<string, unknown>) => { p.indexTitle = "The Torah; A Women's Commentary, Genesis"; }, (p: Record<string, unknown>) => { p.book = "The Torah; A Women's Commentary"; },
    (p: Record<string, unknown>) => { (p.versions as Record<string, unknown>[])[0].license = "CC-BY"; }]) {
    const copy = structuredClone(payload) as Record<string, unknown>; mutate(copy); invalid(() => validateCommentaryPayload(copy, womens));
  }
  // Neither work's payload satisfies the other.
  invalid(() => validateCommentaryPayload(syntheticCommentaryPayload("rashi", "Genesis 12"), womens));
  invalid(() => validateCommentaryPayload(payload, chapter("rashi", "Genesis 12")));
  // A missing edition is an empty chapter, not an error.
  expect(validateCommentaryPayload(syntheticCommentaryPayload("womens", "Genesis 12", { present: [] }), womens)).toEqual({ work: "womens", chapter: "Genesis 12", verses: {}, editions: [] });
  // Through the public route and back through the browser parser.
  const commentary = createSefariaCommentaryReader({ fetch: syntheticCommentaryFetch({ commented: { 1: 4 }, text: (_c, _v, c) => paragraphs[c] }) as typeof globalThis.fetch });
  const runtime = { resolveTenant: async () => undefined, reading: {} as PublicRuntime["reading"], commentary, ...unavailableExtras } satisfies PublicRuntime;
  const response = await handlePublicReadingRequest(new Request("https://beitmitzvah.centralreform.org/api/public/commentary?work=womens&chapter=Genesis+12"), async action => action(runtime));
  expect(response.status).toBe(200); expect(response.headers.get("vercel-cdn-cache-control")).toBe("public, s-maxage=2592000, stale-while-revalidate=86400");
  const body = await response.json();
  expect(parseCommentaryResponse(body, "womens", "Genesis 12").verses["1"].comments.map(item => item.english![0].text)).toEqual(["The Synthetic Title", "SYNTHETIC SECTION HEADING (12:1–9)", "Synthetic lead", "1–3."]);
  const refused = await handlePublicReadingRequest(new Request("https://beitmitzvah.centralreform.org/api/public/commentary?work=womens&chapter=Isaiah+40"), async action => action(runtime));
  expect(refused.status).toBe(400);
  // The browser parser: Hebrew may be null, never both languages; italic must be literally true; the licence must match the registry.
  const one = structuredClone(body);
  one.verses["1"].comments[0] = { hebrew: null, english: null }; expect(() => parseCommentaryResponse(one, "womens", "Genesis 12")).toThrow();
  const two = structuredClone(body);
  two.verses["1"].comments[0].english[0].italic = "yes"; expect(() => parseCommentaryResponse(two, "womens", "Genesis 12")).toThrow();
  const three = structuredClone(body);
  three.editions[0].license = "CC-BY"; expect(() => parseCommentaryResponse(three, "womens", "Genesis 12")).toThrow();
  const four = structuredClone(body);
  four.editions[0].credit = "Some other credit"; expect(() => parseCommentaryResponse(four, "womens", "Genesis 12")).toThrow();
  // Numbers 25: Sefaria's Women's Commentary has a nineteenth slot with text for an eighteen-verse chapter. The chapter still serves.
  const numbers = syntheticCommentaryPayload("womens", "Numbers 25", { padding: 1, commented: { 1: 1 } });
  (numbers.versions[0].text[18] as unknown[]) = ["Synthetic overflow paragraph", "<i>Another</i>"];
  expect(Object.keys(validateCommentaryPayload(numbers, chapter("womens", "Numbers 25")).verses)).toEqual(["1"]);
});

// ---- 1.3: more Works (plan 2026-10-22-shelf-1-3 §2).
const NEW_WORKS = { ramban: "torah", "ibn-ezra": "torah", sforno: "torah", rashbam: "torah", "or-hachaim": "torah", "kli-yakar": "torah", chizkuni: "torah", radak: "neviim", "metzudat-david": "neviim" } as const;

test("the nine new works: their corpus only, pinned editions in preference order, each credited with its licence and Sefaria", () => {
  for (const [key, corpus] of Object.entries(NEW_WORKS)) {
    const other = corpus === "torah" ? "Isaiah 40" : "Genesis 1", own = corpus === "torah" ? "Exodus 20" : "Isaiah 40";
    expect(parseCommentaryChapter(key, own), key).not.toBeNull();
    expect(parseCommentaryChapter(key, other), key).toBeNull();
    const candidates = commentaryCandidates(chapter(key, own));
    expect(candidates.he.length, key).toBeGreaterThan(0); expect(candidates.en.length, key).toBeGreaterThan(0);
    for (const candidate of [...candidates.he, ...candidates.en]) {
      expect(candidate.credit, key).toMatch(/, via Sefaria \((?:public domain|CC0|CC BY|CC BY-NC|CC BY-SA|licence not stated)\)\. Markup and footnotes removed; spacing normalized\.$/);
      // A generic edition title is credited with the work's name.
      if (["Vocalized Edition", "On Your Way", "Sefaria Community Translation", "daat"].includes(candidate.title)) expect(candidate.credit.startsWith(`${COMMENTARY_WORKS[key].title} (`), key).toBe(true);
    }
  }
  expect(chapter("chizkuni", "Genesis 12")).toMatchObject({ index: "Chizkuni, Genesis", indexTitle: "Chizkuni", ref: "Chizkuni, Genesis 12" });
  expect(chapter("radak", "I Kings 18")).toMatchObject({ index: "Radak on I Kings", ref: "Radak on I Kings 18" });
  expect(COMMENTARY_WORKS.radak.sectionNames).toEqual(["Chapter", "Verse", "Paragraph"]);
  // Licences Sefaria states as unknown read plainly, never guessed.
  expect(commentaryCandidates(chapter("ramban", "Exodus 1")).he.map(row => [row.title, row.license])).toEqual([["Sefaria Vocalized Edition", "unknown"]]);
  expect(commentaryCandidates(chapter("ramban", "Genesis 1")).he.map(row => [row.title, row.license])).toEqual([["Vocalized Edition", "CC0"]]);
  expect(commentaryCandidates(chapter("radak", "Isaiah 1")).he[0].credit).toContain("(licence not stated)");
  // An edition scoped to some books is asked for, and credited, only in those books: each Rashbam book has its own
  // Hebrew title, and Sefaria states one Metzudat David translation's licence in some books and not in others.
  expect(commentaryRequestUrl(chapter("rashbam", "Leviticus 1")).searchParams.getAll("version")).toEqual(["hebrew|Rashbam on Leviticus - Daat", "english|Eliyahu Munk, HaChut Hameshulash"]);
  expect(commentaryRequestUrl(chapter("rashbam", "Genesis 1")).searchParams.getAll("version")).toEqual(["hebrew|daat", "english|Eliyahu Munk, HaChut Hameshulash"]);
  expect(commentaryCandidates(chapter("metzudat-david", "Joshua 2")).en.map(row => row.license)).toEqual(["CC-BY", "CC0"]);
  expect(commentaryCandidates(chapter("metzudat-david", "Isaiah 2")).en.map(row => row.license)).toEqual(["unknown", "CC0"]);
  expect(commentaryCandidates(chapter("metzudat-david", "Hosea 2")).en.map(row => row.title)).toEqual(["Sefaria Community Translation"]);
  expect(commentaryCandidates(chapter("ramban", "Exodus 1")).he.map(row => row.title)).toEqual(["Sefaria Vocalized Edition"]);
  expect(commentaryCandidates(chapter("ibn-ezra", "Leviticus 1")).he.map(row => row.title)).toEqual(["On Your Way"]);
  // The scoped candidates validate per book: a Joshua payload with the unknown-licence version is refused.
  const joshua = syntheticCommentaryPayload("metzudat-david", "Joshua 2");
  invalid(() => validateCommentaryPayload({ ...joshua, versions: joshua.versions.map(v => v.language === "en" ? { ...v, license: "unknown" } : v) }, chapter("metzudat-david", "Joshua 2")));
});

test("isComplex is checked per book: true for Ibn Ezra on Genesis, false for Ibn Ezra on Leviticus, and either way round is refused", () => {
  expect(validateCommentaryPayload(syntheticCommentaryPayload("ibn-ezra", "Genesis 1"), chapter("ibn-ezra", "Genesis 1")).work).toBe("ibn-ezra");
  expect(validateCommentaryPayload(syntheticCommentaryPayload("ibn-ezra", "Leviticus 19"), chapter("ibn-ezra", "Leviticus 19")).work).toBe("ibn-ezra");
  expect(syntheticCommentaryPayload("ibn-ezra", "Genesis 1").isComplex).toBe(true);
  expect(syntheticCommentaryPayload("ibn-ezra", "Leviticus 19").isComplex).toBe(false);
  invalid(() => validateCommentaryPayload({ ...syntheticCommentaryPayload("ibn-ezra", "Genesis 1"), isComplex: false }, chapter("ibn-ezra", "Genesis 1")));
  invalid(() => validateCommentaryPayload({ ...syntheticCommentaryPayload("ibn-ezra", "Leviticus 19"), isComplex: true }, chapter("ibn-ezra", "Leviticus 19")));
  expect(syntheticCommentaryPayload("ramban", "Leviticus 1").isComplex).toBe(true);
  expect(syntheticCommentaryPayload("radak", "Isaiah 1").isComplex).toBe(false);
});

test("a chapter Sefaria has no text for is an empty answer the CDN keeps a day; any other 404 is still a failure", async () => {
  const noText = (body: unknown) => async () => syntheticJsonResponse(body, { status: 404 });
  const read = (body: unknown) => createSefariaCommentaryReader({ fetch: noText(body) as typeof globalThis.fetch })("ramban", "Genesis 50");
  expect(await read({ error: "We have no text for Ramban on Genesis 50<d>." })).toEqual({ work: "ramban", chapter: "Genesis 50", verses: {}, editions: [], absent: true });
  expect(await read({ error: "We have no text for Sforno on Leviticus 3." })).toMatchObject({ absent: true });
  for (const body of [{ error: "Something else went wrong." }, { error: "We have no text for <script>." }, { error: "We have no text for Ramban on Genesis 50.", extra: 1 }, { error: 1 }, []]) {
    await expect(read(body), JSON.stringify(body)).rejects.toMatchObject({ code: "upstream" });
  }
  const commentary = createSefariaCommentaryReader({ fetch: noText({ error: "We have no text for Sforno on Leviticus 3." }) as typeof globalThis.fetch });
  const runtime = { resolveTenant: async () => undefined, reading: {} as PublicRuntime["reading"], commentary, ...unavailableExtras } satisfies PublicRuntime;
  const response = await handlePublicReadingRequest(new Request("https://beitmitzvah.centralreform.org/api/public/commentary?work=sforno&chapter=Leviticus+3"), async action => action(runtime));
  expect(response.status).toBe(200); expect(response.headers.get("vercel-cdn-cache-control")).toBe("public, s-maxage=86400");
  const body = await response.json();
  expect(body).toEqual({ work: "sforno", chapter: "Leviticus 3", verses: {}, editions: [] });
  expect(parseCommentaryResponse(body, "sforno", "Leviticus 3")).toEqual(body); // the browser reads it as a chapter with nothing to say
});
