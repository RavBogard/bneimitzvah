// Invented words/source rows only. No corpus, real media or external requests.
import { afterEach, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { fetchWordToolsAids, fetchWordToolsDetails } from "../../src/components/portal/workspace/study/word-tools-api";
import { createWordToolsSelection } from "../../src/components/portal/workspace/study/word-tools-selection";
import { WordTools } from "../../src/components/portal/workspace/study/word-tools";
import { normalizeHebrew } from "../../src/server/study/normalize";
import { createStudyWordAids } from "../../src/server/study/word-aids";
import { createSelectedWordDetails } from "../../src/server/study/lexical/word-details";
import { parseTahot, parseTbesh } from "../../src/server/study/lexical/step";
import type { Assigned, ReadingMode, Selection } from "../../src/components/portal/workspace/api";
import type { StudyVerse } from "../../src/components/portal/workspace/study/api";
import type { StudyWordAids } from "../../src/lib/hebrew/word-aids";
import type { StudyWordDetails } from "../../src/lib/hebrew/word-details";
import { PortalRequestError } from "../../src/components/portal/api";
vi.mock("server-only", () => ({}));
const id = "10000000-0000-4000-8000-000000000001", aid = "10000000-0000-4000-8000-000000000002", cid = "10000000-0000-4000-8000-000000000003";
const verse = (ref = "Genesis 1:1", text = 'בָּ֑ג־<span class="mam-kq"><span class="mam-kq-k">זָח</span><span class="mam-kq-q">[דָּ֖ג]</span></span>׃'): StudyVerse => { const h = normalizeHebrew(text.normalize("NFD")); return { ref, english: null, hebrew: { ...h, segments: h.segments.map(part => ({ ...part })) } }; };
function baseline(mode: ReadingMode = "admin"): Assigned { return { mode, student: { id, revision: 2, firstName: "Synthetic", lastName: "Tools", ceremonyDate: "2027-01-02" }, context: mode === "child-practice" ? { id: cid, studentId: id, studentRevision: 2, authorityRevision: 3, expiresAt: new Date(Date.now() + 60_000).toISOString() } : null,
  readings: [{ id: aid, kind: "torah", revision: 4, ranges: ["Genesis 1:1-2"], verses: ["Genesis 1:1", "Genesis 1:2"], needsReview: false, aliyahStarts: null, basis: "custom", confirmationDate: "2027-01-02", source: { status: "unknown", fetchedAt: null, date: null, calendar: null, attribution: null } }] }; }
const source = { book: async () => parseTahot(["Gen.1.1#1=L\tבָּג\tDISCARDED\tSynthetic occurrence\t{H0001}\tHNcmsa\t", "Gen.1.1#2=L\tדָּג\tDISCARDED\tSynthetic second\t{H0001}\tHNcmsa\t"].join("\n"), "Gen"), lexicon: async () => parseTbesh("H0001#1\tH0001\tH0001\tבָּג\tDISCARDED\tHVqp3ms\tSynthetic dictionary\tDISCARDED") };
async function envelope(base: Assigned, field: "wordAids" | "wordDetails", v = verse(), index = 1) { return { studentId: id, studentRevision: 2, mode: base.mode, context: base.context, assignment: { id: aid, revision: 4, kind: "torah", needsReview: false }, [field]: field === "wordAids" ? createStudyWordAids(v) : await createSelectedWordDetails(v, index, source) }; }
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
const held = <T,>() => { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("preserves the actual maqaf fixture’s non-tonic first word and proved tonic second word without inventing stress", () => {
  const value = createStudyWordAids(verse("Genesis 1:1", 'בָּ֑ג־<span class="mam-kq"><span class="mam-kq-k">זָח</span><span class="mam-kq-q">[דָּ֖ג]</span></span><span class="mam-spi-samekh">{ס}</span>'));
  expect(value?.status).toBe("ready"); if (value?.status !== "ready") throw new Error("Synthetic word guide unavailable");
  expect(value.words.map(word => ({ status: word.status, tonic: word.status === "ready" ? word.syllables.filter(part => part.stress === "tonic").length : null }))).toEqual([{ status: "ready", tonic: 0 }, { status: "ready", tonic: 1 }]);
});

it.each(["admin", "tutor", "parent", "student", "child-practice"] as const)("reads independent proved aids/details for %s through closed actual authority", async mode => {
  const base = baseline(mode), selected: Selection | undefined = base.context ? { context: { ...base.context }, handle: "h".repeat(43) } : undefined;
  const a = await envelope(base, "wordAids"), d = await envelope(base, "wordDetails");
  const fetcher = vi.fn(async (path: string) => response(path.includes("study-word-details") ? d : a)); vi.stubGlobal("fetch", fetcher);
  expect(await fetchWordToolsAids(base, "torah", 0, verse(), new AbortController().signal, selected)).toMatchObject({ status: "ready", wordCount: 2 });
  expect(await fetchWordToolsDetails(base, "torah", 0, verse(), 1, new AbortController().signal, selected)).toMatchObject({ status: "ready", wordIndex: 1, occurrence: { gloss: "Synthetic second" } });
  const [url, options] = fetcher.mock.calls[1] as unknown as [string, RequestInit]; expect(url).not.toContain(selected?.handle ?? "withheld"); expect(url).toContain("wordIndex=1");
  expect(options).toMatchObject({ credentials: "same-origin", redirect: "error", cache: "no-store" }); expect(new Headers(options.headers).get("X-Practice-Context")).toBe(selected?.handle ?? null);
});
it("rejects wrong full rendered-text binding and stale assignment instead of adopting selected-word-only agreement", async () => {
  const base = baseline(), value = await envelope(base, "wordDetails"); vi.stubGlobal("fetch", vi.fn(async () => response(value)));
  await expect(fetchWordToolsDetails(base, "torah", 0, verse("Genesis 1:1", "בָּ֑ג זָ֖ח׃"), 1, new AbortController().signal)).rejects.toMatchObject({ status: 503 });
  vi.stubGlobal("fetch", vi.fn(async () => response({ ...value, assignment: { ...value.assignment, revision: 5 } })));
  await expect(fetchWordToolsDetails(base, "torah", 0, verse(), 1, new AbortController().signal)).rejects.toMatchObject({ status: 409 });
});
it("snapshots the original verse and baseline before digest/fetch awaits", async () => {
  const base = baseline(), v = verse(), value = await envelope(base, "wordDetails"), entered = held<void>(), gate = held<Response>();
  vi.stubGlobal("fetch", vi.fn(() => { entered.resolve(); return gate.promise; })); const work = fetchWordToolsDetails(base, "torah", 0, v, 1, new AbortController().signal);
  await entered.promise; base.student.revision++; v.hebrew.readingText = "changed"; gate.resolve(response(value)); expect(await work).toMatchObject({ status: "ready", wordIndex: 1 });
});
it("refuses aborted/pre-request invalid selections without dispatching and accepts only closed reconstruction holds", async () => {
  const fetcher = vi.fn(), abort = new AbortController(); abort.abort(); vi.stubGlobal("fetch", fetcher);
  await expect(fetchWordToolsAids(baseline(), "torah", 0, verse(), abort.signal)).rejects.toMatchObject({ status: 409 });
  await expect(fetchWordToolsDetails(baseline(), "torah", 0, verse(), 2, new AbortController().signal)).rejects.toMatchObject({ status: 503 }); expect(fetcher).not.toHaveBeenCalled();
  const base = baseline(), v = verse(); v.hebrew.readingText = "mismatch"; const hold = await envelope(base, "wordDetails", v);
  fetcher.mockResolvedValue(response(hold)); expect(await fetchWordToolsDetails(base, "torah", 0, v, 1, new AbortController().signal)).toEqual({ schema: "study-word-details/v1", ref: v.ref, wordIndex: 1, status: "unavailable", reason: "reconstruction" });
});
it("does not fetch on construction/closed word selection, keeps independent holds and navigates without an audio capability", async () => {
  const readAids = vi.fn(async (): Promise<StudyWordAids> => ({ schema: "study-word-aids/v1", ref: "Genesis 1:1", status: "unavailable", reason: "analysis-unavailable" }));
  const readDetails = vi.fn(async (): Promise<StudyWordDetails> => { throw new PortalRequestError(503); });
  const tools = createWordToolsSelection({ verses: [verse(), verse("Genesis 1:2")], readAids, readDetails, onState() {} }); tools.select(0, 1); expect(readAids).not.toHaveBeenCalled(); tools.open(); await flush();
  expect(tools.state).toMatchObject({ open: true, selection: { verse: 0, index: 1 }, aids: { status: "ready" }, details: { status: "error" } });
  tools.navigate(1); expect(tools.state.selection).toEqual({ verse: 1, index: 0 }); tools.navigate(-1); expect(tools.state.selection).toEqual({ verse: 0, index: 1 }); tools.dispose();
});
it("drops both old results on close/scope disposal and never publishes an out-of-order completion", async () => {
  const a = held<StudyWordAids>(), d = held<StudyWordDetails>(), onState = vi.fn(), signals: AbortSignal[] = [];
  const tools = createWordToolsSelection({ verses: [verse()], readAids: (_v, signal) => { signals.push(signal); return a.promise; }, readDetails: () => d.promise, onState });
  tools.open(); await flush(); tools.close(); expect(signals[0].aborted).toBe(true); tools.dispose(); const calls = onState.mock.calls.length;
  a.resolve({ schema: "study-word-aids/v1", ref: "Genesis 1:1", status: "unavailable", reason: "analysis-unavailable" }); d.resolve({ schema: "study-word-details/v1", ref: "Genesis 1:1", wordIndex: 0, status: "unavailable", reason: "reconstruction" }); await flush();
  tools.open(); expect(onState).toHaveBeenCalledTimes(calls); expect(tools.state.open).toBe(false);
});
it("server rendering stays closed, accessible and without requests or an audio action", () => {
  const readAids = vi.fn(), readDetails = vi.fn(), onHear = vi.fn(); const markup = renderToStaticMarkup(createElement(WordTools, { scopeKey: "synthetic", verses: [verse()], register() {}, readAids, readDetails, onHear }));
  expect(markup).toContain('aria-expanded="false"'); expect(markup).toContain("Word tools"); expect(markup).not.toContain("Occurrence meaning"); expect(markup).not.toContain("<dialog"); expect(readAids).not.toHaveBeenCalled(); expect(readDetails).not.toHaveBeenCalled(); expect(onHear).not.toHaveBeenCalled();
});
