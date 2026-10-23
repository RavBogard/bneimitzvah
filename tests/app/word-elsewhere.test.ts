// Invented words/source rows only. No corpus, real media or external requests.
import { afterEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createHash } from "node:crypto";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as s from "../../src/server/db/index";
import { portalRoutesFixture } from "./portal-routes-fixture";
import { createSelectedWordDetails } from "../../src/server/study/lexical/word-details";
import { findWordElsewhere, WORD_ELSEWHERE_LOADS, type WordReading } from "../../src/server/study/lexical/word-elsewhere";
import { createStudyWordDetailsService } from "../../src/server/study/word-details-service";
import { createHttpDispatcher } from "../../src/server/http/dispatch";
import { parseTahot, parseTbesh } from "../../src/server/study/lexical/step";
import type { StepSourceLoader } from "../../src/server/study/lexical/source-loader";
import { normalizeHebrew } from "../../src/server/study/normalize";
import { projectStudyVerse } from "../../src/lib/hebrew/study-tokens";
import { parseStudyWordDetails, WORD_DETAILS_LIMITS, type StudyWordDetails, type WordElsewhere } from "../../src/lib/hebrew/word-details";
import { WordElsewhereList } from "../../src/components/portal/workspace/study/word-tools";
import type { StudyPage, StudyRequest, StudyVerse } from "../../src/server/study/types";

// Rendered words carry trope; STEP rows carry the same consonants without it.
const rendered: Record<string, [string, string]> = { B: ["בָּ֑ג", "בָּ֖ג"], D: ["דָּ֑ג", "דָּ֖ג"], Z: ["זָ֑ח", "זָ֖ח"] };
const plain: Record<string, string> = { B: "בָּג", D: "דָּג", Z: "זָח" };
const lemmaOf: Record<string, string> = { B: "H0001", D: "H0002", Z: "H0003" };
/** "BD" is a two-word verse: B then D. */
const text = (words: string) => normalizeHebrew(`${[...words].map((w, i) => rendered[w][i === 0 ? 0 : 1]).join(" ")}׃`);
const verse = (ref: string, words: string): StudyVerse => ({ ref, hebrew: text(words), english: null });
const tahot = (rows: Record<string, string>) => parseTahot(Object.entries(rows).flatMap(([ref, words]) => { const [, c, v] = /^Genesis ([0-9]+):([0-9]+)$/.exec(ref)!;
  return [...words].map((w, i) => `Gen.${c}.${v}#${i + 1}=L\t${plain[w]}\tDISCARDED\tSynthetic ${w} gloss\t{${lemmaOf[w]}}\tHNcmsa\t`); }).join("\n"), "Gen");
const lexicon = parseTbesh(["B", "D", "Z"].map(w => `${lemmaOf[w]}#1\t${lemmaOf[w]}\t${lemmaOf[w]}\t${plain[w]}\tDISCARDED\tHNcmsa\tSynthetic ${w} sense\tDISCARDED`).join("\n"));
const source = (rows: Record<string, string>): StepSourceLoader => ({ book: vi.fn(async () => tahot(rows)), lexicon: vi.fn(async () => lexicon) });
function binding(value: StudyVerse, wordIndex: number) { const p = projectStudyVerse(value.ref, value.hebrew); if (p.status !== "ready") throw new Error("Synthetic projection failed");
  return { ref: value.ref, wordIndex, readingTextSha256: createHash("sha256").update(p.projection.readingText.normalize("NFC")).digest("hex"), words: p.projection.words.map(w => w.text) }; }
/** A reading whose app text loader returns `size` verses per page from any offset. */
function reading(rows: Record<string, string>, size = 1, override: Record<string, string> = {}): WordReading & { load: ReturnType<typeof vi.fn> } {
  const refs = Object.keys(rows), all = refs.map(ref => verse(ref, override[ref] ?? rows[ref]));
  return { verses: refs, loaded: all.slice(0, size), load: vi.fn(async (offset: number) => all.slice(offset, offset + size)) };
}
async function elsewhere(rows: Record<string, string>, selected = "Genesis 1:1", index = 0, read = reading(rows), sources = source(rows)) {
  const value = await createSelectedWordDetails(verse(selected, rows[selected]), index, sources, undefined, read);
  if (!value || value.status !== "ready") throw new Error("Synthetic details unavailable"); return { value, read };
}
const fixtures: Awaited<ReturnType<typeof portalRoutesFixture>>[] = [];
afterEach(async () => { for (const f of fixtures.splice(0)) await f.client.close(); });

it("places only fully aligned same-lexeme words of the student's own verses, in reading order, never the selected word itself", async () => {
  const rows = { "Genesis 1:1": "BD", "Genesis 1:2": "DB", "Genesis 1:3": "BB", "Genesis 1:4": "ZD" };
  const read = reading({ "Genesis 1:1": "BD", "Genesis 1:2": "DB", "Genesis 1:3": "BB" });
  const { value } = await elsewhere(rows, "Genesis 1:1", 0, read, source({ ...rows, "Genesis 1:5": "BB" }));
  expect(value.elsewhere).toEqual({ status: "ready", lemma: "H0001", total: 3, places: [
    { ref: "Genesis 1:2", wordIndex: 1, words: ["דָּ֑ג", "בָּ֖ג"], mark: 1 },
    { ref: "Genesis 1:3", wordIndex: 0, words: ["בָּ֑ג", "בָּ֖ג"], mark: 0 },
    { ref: "Genesis 1:3", wordIndex: 1, words: ["בָּ֑ג", "בָּ֖ג"], mark: 1 }] });
  // Only the student's verses with a candidate are read: one more page each.
  expect(read.load.mock.calls.map(call => call[0])).toEqual([1, 2]);
  expect(JSON.stringify(value)).not.toMatch(/DISCARDED|transliteration|Synthetic D|english/);
  // The client parser accepts it and binds the lemma to this word's own dictionary identity.
  expect(parseStudyWordDetails(structuredClone(value), binding(verse("Genesis 1:1", "BD"), 0))).toEqual(value);
  const repeat = await elsewhere(rows, "Genesis 1:3", 1, read);
  expect(repeat.value.elsewhere).toMatchObject({ total: 3, places: [{ ref: "Genesis 1:1", wordIndex: 0 }, { ref: "Genesis 1:2", wordIndex: 1 }, { ref: "Genesis 1:3", wordIndex: 0 }] });
  const other = await elsewhere(rows, "Genesis 1:1", 1, read);
  expect(other.value.elsewhere).toMatchObject({ lemma: "H0002", total: 1, places: [{ ref: "Genesis 1:2", wordIndex: 0 }] });
});

it("leaves out a verse whose rendered words do not fully align instead of guessing a position", async () => {
  const rows = { "Genesis 1:1": "BD", "Genesis 1:2": "DB", "Genesis 1:3": "BZ" };
  const { value } = await elsewhere(rows, "Genesis 1:1", 0, reading(rows, 1, { "Genesis 1:2": "DZ" }));
  expect(value.elsewhere).toEqual({ status: "ready", lemma: "H0001", total: 1, places: [{ ref: "Genesis 1:3", wordIndex: 0, words: ["בָּ֑ג", "זָ֖ח"], mark: 0 }] });
  const only = await elsewhere({ "Genesis 1:1": "BD", "Genesis 1:2": "ZD" });
  expect(only.value.elsewhere).toEqual({ status: "ready", lemma: "H0001", total: 0, places: [] });
});

it("a text failure drops only the places, keeping the selected word's facts; too many pages is a partial answer, not a failure", async () => {
  const rows = { "Genesis 1:1": "BD", "Genesis 1:2": "DB" }, failing = reading(rows); failing.load.mockRejectedValue(new Error("SYNTHETIC_PRIVATE_TEXT"));
  const { value } = await elsewhere(rows, "Genesis 1:1", 0, failing);
  expect(value).toMatchObject({ status: "ready", occurrence: { gloss: "Synthetic B gloss" }, elsewhere: { status: "unavailable", reason: "text-unavailable" } }); expect(JSON.stringify(value)).not.toContain("SYNTHETIC_PRIVATE");
  const wrong = reading(rows); wrong.load.mockResolvedValue([verse("Genesis 1:1", "BD")]);
  expect((await elsewhere(rows, "Genesis 1:1", 0, wrong)).value.elsewhere).toEqual({ status: "unavailable", reason: "text-unavailable" });
  const many = Object.fromEntries(Array.from({ length: WORD_ELSEWHERE_LOADS + 2 }, (_, i) => [`Genesis 1:${i + 1}`, "BD"]));
  const bounded = reading(many), searched = Array.from({ length: WORD_ELSEWHERE_LOADS }, (_, i) => `Genesis 1:${i + 2}`);
  const partial = (await elsewhere(many, "Genesis 1:1", 0, bounded)).value;
  // The places in the pages the budget allows, marked partial; the last verse is never read or counted.
  expect(partial.elsewhere).toEqual({ status: "ready", lemma: "H0001", total: WORD_ELSEWHERE_LOADS, partial: true,
    places: searched.map(ref => ({ ref, wordIndex: 0, words: ["בָּ֑ג", "דָּ֖ג"], mark: 0 })) });
  expect(bounded.load).toHaveBeenCalledTimes(WORD_ELSEWHERE_LOADS);
  expect(parseStudyWordDetails(structuredClone(partial), binding(verse("Genesis 1:1", "BD"), 0))).toEqual(partial);
  // The same reading gives the same partial answer every time.
  expect((await elsewhere(many, "Genesis 1:1", 0, reading(many))).value).toEqual(partial);
  // A failed load inside the budget is still a failure, never a partial answer.
  const broken = reading(many); broken.load.mockImplementation(async (offset: number) => { if (offset === 3) throw new Error("synthetic"); return [verse(`Genesis 1:${offset + 1}`, "BD")]; });
  expect((await elsewhere(many, "Genesis 1:1", 0, broken)).value.elsewhere).toEqual({ status: "unavailable", reason: "text-unavailable" });
  // A word with no lexical identity says so; nothing is loaded.
  const bare = reading(rows), sources: StepSourceLoader = { book: async () => parseTahot("Gen.1.1#1=L\tבָּג\tDISCARDED\tSynthetic bare\tH0001\tHNcmsa\t\nGen.1.1#2=L\tדָּג\tDISCARDED\tSynthetic D\t{H0002}\tHNcmsa\t", "Gen"), lexicon: async () => lexicon };
  expect((await elsewhere(rows, "Genesis 1:1", 0, bare, sources)).value.elsewhere).toEqual({ status: "unavailable", reason: "no-lexeme" }); expect(bare.load).not.toHaveBeenCalled();
  // Called without a reading (other callers), no elsewhere field exists at all.
  const plainDetails = await createSelectedWordDetails(verse("Genesis 1:1", "BD"), 0, source(rows)); expect(plainDetails && "elsewhere" in plainDetails).toBe(false);
});

it("slow further text ends at the places budget and keeps no load running past it", async () => {
  const rows = { "Genesis 1:1": "BD", "Genesis 1:2": "DB" }, read = reading(rows); let seen: AbortSignal | undefined;
  read.load.mockImplementation((_offset: number, signal: AbortSignal) => { seen = signal; return new Promise(() => {}); });
  const started = Date.now();
  expect(await findWordElsewhere({ book: tahot(rows), lemma: "H0001", ref: "Genesis 1:1", wordIndex: 0, reading: read, connected() {}, budgetMs: 30 })).toEqual({ status: "unavailable", reason: "text-unavailable" });
  expect(Date.now() - started).toBeLessThan(2000); expect(seen?.aborted).toBe(true);
  // The request's own abort still reaches the load through the child signal.
  const parent = new AbortController(), second = reading(rows); let child: AbortSignal | undefined;
  second.load.mockImplementation(async (_offset: number, signal: AbortSignal) => { child = signal; parent.abort(); return [verse("Genesis 1:2", "DB")]; });
  await expect(findWordElsewhere({ book: tahot(rows), lemma: "H0001", ref: "Genesis 1:1", wordIndex: 0, reading: second, signal: parent.signal,
    connected() { if (parent.signal.aborted) throw Object.assign(new Error("upstream"), { code: "upstream" }); } })).rejects.toMatchObject({ code: "upstream" });
  expect(child?.aborted).toBe(true);
});

it("an aborted request during a page load is never turned into places", async () => {
  const rows = { "Genesis 1:1": "BD", "Genesis 1:2": "DB" }, controller = new AbortController(), read = reading(rows);
  read.load.mockImplementation(async () => { controller.abort(); return [verse("Genesis 1:2", "DB")]; });
  await expect(createSelectedWordDetails(verse("Genesis 1:1", "BD"), 0, source(rows), controller.signal, read)).rejects.toMatchObject({ code: "upstream" });
});

it("keeps the full count but lists at most the first twelve places, each snippet within its byte bound", async () => {
  const rows = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`Genesis 1:${i + 1}`, i % 2 ? "DB" : "BD"]));
  const { value, read } = await elsewhere(rows, "Genesis 1:1", 0, reading(rows, 100));
  const found = value.elsewhere!; expect(found.status).toBe("ready"); if (found.status !== "ready") throw 0;
  expect(found.total).toBe(19); expect(found.places).toHaveLength(WORD_DETAILS_LIMITS.places); expect(found.places[0]).toMatchObject({ ref: "Genesis 1:2", wordIndex: 1 }); expect(read.load).not.toHaveBeenCalled();
  expect(new TextEncoder().encode(JSON.stringify(value)).length).toBeLessThanOrEqual(WORD_DETAILS_LIMITS.bytes);
});

it("the client parser refuses places that are not closed, bounded and distinct from the selected word", () => {
  const v = verse("Genesis 1:1", "BD"), bind = binding(v, 0);
  const identity = { schema: "study-word-details/v1", ref: v.ref, wordIndex: 0, readingTextSha256: bind.readingTextSha256, wordCount: 2,
    attribution: { name: "STEPBible / Tyndale House Cambridge", source: "STEPBible-Data", commit: "bd09545c7a44b39ace20f16c0359915f2aa23a62", license: "CC-BY-4.0", licenseUrl: "https://creativecommons.org/licenses/by/4.0/", changes: "Normalized into selected-word facts; source-format and correspondence holds retained." } };
  const good = () => ({ ...identity, status: "ready", occurrence: { gloss: null, grammar: { status: "unavailable", reason: "unrecognized-code" } }, dictionary: [{ lemma: "H0001", status: "unavailable", reason: "missing" }],
    elsewhere: { status: "ready", lemma: "H0001", total: 1, places: [{ ref: "Genesis 1:2", wordIndex: 1, words: ["דָּ֑ג", "בָּ֖ג"], mark: 1 }] } as Record<string, unknown> });
  expect(parseStudyWordDetails(good(), bind)).toMatchObject({ elsewhere: { total: 1 } });
  const place = (patch: Record<string, unknown>) => { const value = good(); (value.elsewhere as { places: unknown[] }).places = [{ ...(value.elsewhere.places as object[])[0], ...patch }]; return value; };
  for (const bad of [
    place({ ref: "Genesis 1:1", wordIndex: 0, mark: 0 }), place({ mark: 2 }), place({ mark: -1 }), place({ wordIndex: 512 }), place({ ref: "Genesis 99:1" }), place({ words: [] }),
    place({ words: ["א", "ב", "ג", "ד", "ה", "ו"] }), place({ words: ["<b>"], mark: 0 }), place({ words: ["דָּ֑ג־"], mark: 0 }), place({ words: ["abc"], mark: 0 }), place({ transliteration: "bag" }), place({ words: ["ב".repeat(600)], mark: 0 }), place({ wordIndex: 0 }),
  ]) expect(parseStudyWordDetails(bad, bind)).toBeNull();
  { const value = good(); value.elsewhere = { ...value.elsewhere, partial: true }; expect(parseStudyWordDetails(value, bind)).toMatchObject({ elsewhere: { total: 1, partial: true } }); }
  expect((parseStudyWordDetails(good(), bind) as { elsewhere?: object }).elsewhere).not.toHaveProperty("partial");
  expect(parseStudyWordDetails({ ...good(), elsewhere: { status: "unavailable", reason: "text-unavailable", partial: true } }, bind)).toBeNull();
  for (const patch of [{ lemma: "H0009" }, { total: 2 }, { total: 0 }, { total: -1 }, { total: 1.5 }, { extra: true }, { status: "unavailable" }, { partial: false }, { partial: "true" }, { partial: 1 }, { partial: null }]) { const value = good(); value.elsewhere = { ...value.elsewhere, ...patch }; expect(parseStudyWordDetails(value, bind)).toBeNull(); }
  const duplicate = good(); (duplicate.elsewhere as { total: number; places: unknown[] }).total = 2; (duplicate.elsewhere as { places: unknown[] }).places.push({ ...(duplicate.elsewhere.places as object[])[0] }); expect(parseStudyWordDetails(duplicate, bind)).toBeNull();
  for (const reason of ["no-lexeme", "text-unavailable"]) expect(parseStudyWordDetails({ ...good(), elsewhere: { status: "unavailable", reason } }, bind)).toMatchObject({ elsewhere: { status: "unavailable", reason } });
  expect(parseStudyWordDetails({ ...good(), elsewhere: { status: "unavailable", reason: "other" } }, bind)).toBeNull();
  expect(parseStudyWordDetails({ ...good(), elsewhere: undefined }, bind)).toBeNull();
  const { elsewhere: _, ...without } = good(); expect(parseStudyWordDetails(without, bind)).not.toHaveProperty("elsewhere");
});

it("real SDK authority returns in-reading places through the private word-details route and reads text only after authorization", async () => {
  const f = await portalRoutesFixture(); fixtures.push(f);
  const assignment = await f.owner(async () => {
    const [a] = await f.db.insert(s.assignment).values({ tenantId: "crc", studentId: f.students[0].id, kind: "torah", basis: "custom", ref: "Genesis 1:1-3", status: "confirmed", setByMembershipId: f.adminMember.id,
      proposalSnapshot: { confirmationDate: f.students[0].ceremonyDate, needsReview: false } }).returning();
    await f.db.insert(s.assignmentVerse).values([1, 2, 3].map(n => ({ tenantId: "crc", studentId: f.students[0].id, assignmentId: a.id, ordinal: n, verseRef: `Genesis 1:${n}` }))); return a;
  });
  const rows: Record<string, string> = { "Genesis 1:1": "BD", "Genesis 1:2": "DB", "Genesis 1:3": "BZ" };
  // One verse per page, so every other verse costs a further authorized-reading page.
  const loadText = vi.fn(async (request: StudyRequest): Promise<StudyPage> => ({ offset: request.offset, nextOffset: null, totalVerses: request.verses.length,
    verses: [verse(request.verses[request.offset], rows[request.verses[request.offset]])], translation: { key: "jps2023", status: "unavailable" }, chapters: [] }));
  const service = createStudyWordDetailsService({ access: f.service, practice: f.runtime.practice, loadText, source: source(rows) });
  const dispatch = createHttpDispatcher(async action => action({ ...f.runtime, studyWordDetails: service }));
  const path = (mode: string) => `/api/students/${f.students[0].id}/study-word-details?mode=${mode}&kind=torah&assignmentId=${assignment.id}&assignmentRevision=1&translation=jps2023&offset=0&wordIndex=0`;
  for (const [mode, who] of [["admin", "admin"], ["student", "learner"]] as const) {
    loadText.mockClear();
    const response = await dispatch(f.request(path(mode), { who })); expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = await response.json();
    expect(body.wordDetails.elsewhere).toEqual({ status: "ready", lemma: "H0001", total: 2, places: [{ ref: "Genesis 1:2", wordIndex: 1, words: ["דָּ֑ג", "בָּ֖ג"], mark: 1 }, { ref: "Genesis 1:3", wordIndex: 0, words: ["בָּ֑ג", "זָ֖ח"], mark: 0 }] });
    expect(loadText.mock.calls.map(call => call[0].offset)).toEqual([0, 1, 2]);
    const parsed: StudyWordDetails | null = parseStudyWordDetails(body.wordDetails, binding(verse("Genesis 1:1", "BD"), 0)); expect(parsed).toMatchObject({ elsewhere: { total: 2 } });
    expect(JSON.stringify(body)).not.toMatch(/DISCARDED|transliteration|english|authSession|tenantId/);
  }
  loadText.mockClear();
  expect((await dispatch(f.request(path("admin"), { who: "multi" }))).status).toBe(403); expect(loadText).not.toHaveBeenCalled();
});

it("the word sheet lists a few places calmly, folds the rest under More places, and never shows Latin letters for Hebrew", () => {
  const places = Array.from({ length: 5 }, (_, i) => ({ ref: `Genesis 1:${i + 2}`, wordIndex: 1, words: ["דָּ֑ג", "בָּ֖ג"], mark: 1 }));
  const html = (value: WordElsewhere, onPlace?: (ref: string, index: number) => void) => renderToStaticMarkup(createElement(WordElsewhereList, { value, onPlace }));
  const many = html({ status: "ready", lemma: "H0001", total: 5, places }, () => {});
  expect(many).toContain("It appears 5 more times in your reading.");
  expect(many.match(/<button/g)).toHaveLength(5); expect(many).toContain('aria-label="Go to Genesis 1:2, word 2"');
  expect(many.indexOf("<summary>More places</summary>")).toBeGreaterThan(many.indexOf("Genesis 1:4")); expect(many.indexOf("<summary>More places</summary>")).toBeLessThan(many.indexOf("Genesis 1:5"));
  expect(many).toContain('<mark>בָּ֖ג</mark>'); expect(many).toContain('lang="he" dir="rtl"'); expect(many).not.toContain("Showing the first");
  const snippets = [...many.matchAll(/lang="he" dir="rtl"[^>]*>(.*?)<\/span><\/(?:button|span)>/g)].map(m => m[1].replace(/<[^>]+>/g, ""));
  expect(snippets).toHaveLength(5); for (const snippet of snippets) expect(snippet).not.toMatch(/[A-Za-z]/);
  expect(html({ status: "ready", lemma: "H0001", total: 1, places: places.slice(0, 1) })).toContain("It appears 1 more time in your reading.");
  expect(html({ status: "ready", lemma: "H0001", total: 1, places: places.slice(0, 1) })).not.toContain("<button");
  expect(html({ status: "ready", lemma: "H0001", total: 40, places: [...places, ...places.map(p => ({ ...p, wordIndex: 0, mark: 0 }))].slice(0, 10) })).toContain("Showing the first 10.");
  expect(html({ status: "ready", lemma: "H0001", total: 0, places: [] })).toContain("No other places found in your reading.");
  expect(html({ status: "unavailable", reason: "text-unavailable" })).toContain("Other places for this word aren’t available.");
  // A long reading searched part way says so in plain words, and never claims the whole reading.
  const part = html({ status: "ready", lemma: "H0001", total: 5, places, partial: true });
  expect(part).toContain("It appears 5 more times in the part of this reading searched."); expect(part).not.toContain("in your reading");
  expect(html({ status: "ready", lemma: "H0001", total: 1, places: places.slice(0, 1), partial: true })).toContain("It appears 1 more time in the part of this reading searched.");
  expect(html({ status: "ready", lemma: "H0001", total: 0, places: [], partial: true })).toContain("No other places found in the part of this reading searched.");
  expect(html({ status: "ready", lemma: "H0001", total: 5, places })).not.toMatch(/H0001|Strong/);
});
