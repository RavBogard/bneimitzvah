import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { fetchShortExplorationPage, parseShortExplorationPage, checkShortExplorationExpectation } from "../../src/components/portal/workspace/study/short-exploration-api";
import { explorationBaseline, explorationPrepared, explorationPage } from "./exploration-client-helper";
import type { Assigned, Selection } from "../../src/components/portal/workspace/api";
const origin = "https://example.test";
function fixture(offset = 0) { const baseline = explorationBaseline(), prepared = explorationPrepared(), page = explorationPage(offset);
  const response = { studentId: baseline.student.id, studentRevision: baseline.student.revision, mode: baseline.mode, kind: "torah", expiresAt: prepared.expiresAt,
    page: { offset, nextOffset: page.nextOffset, totalVerses: page.totalVerses, references: page.verses.map(v => ({ schema: "reference-resolution/short-v1", source: null, verse: { schema: "reference-verse/v1", ref: v.ref, playback: { status: "unavailable", reason: "asset-not-approved" }, words: { status: "unavailable", reason: "no-playback" } } })) } };
  return { baseline, prepared, page, response }; }
function response(value: unknown, path: string, status = 200) { const r = new Response(value instanceof Uint8Array ? new Uint8Array(value).buffer : typeof value === "string" ? value : JSON.stringify(value), { status, headers: { "content-type": "application/json" } }); Object.defineProperty(r, "url", { value: origin + path }); return r; }
function observedReader(response: Response) {
  const body = response.body!, reader = body.getReader(), read = reader.read.bind(reader), facts = { eof: false };
  vi.spyOn(body, "getReader").mockReturnValue(reader);
  vi.spyOn(reader, "read").mockImplementation(async () => { const part = await read(); if (part.done) facts.eof = true; return part; });
  return { body, facts, cancel: vi.spyOn(reader, "cancel"), release: vi.spyOn(reader, "releaseLock") };
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

test("actual unassigned full portion pages100+46 bind all ordered references without an assignment", () => {
  for (const offset of [0, 100]) { const f = fixture(offset); expect(f.baseline.readings).toEqual([]); expect(parseShortExplorationPage(f.response, f.baseline, f.prepared, f.page).references).toHaveLength(offset === 0 ? 100 : 46); }
});
test("wrong revision, kind, mode, expiry and page geometry or ref order refuse", () => {
  const f = fixture(); for (const patch of [{ studentRevision: 2 }, { studentId: "10000000-0000-4000-8000-000000000002" }, { kind: "haftarah" }, { mode: "parent" }, { expiresAt: f.prepared.expiresAt + 1 }, { binding: f.prepared.binding }]) expect(() => parseShortExplorationPage({ ...f.response, ...patch }, f.baseline, f.prepared, f.page)).toThrow();
  for (const patch of [{ offset: 1 }, { totalVerses: 100 }, { nextOffset: null }, { references: f.response.page.references.toReversed() }, { references: f.response.page.references.slice(1) }]) expect(() => parseShortExplorationPage({ ...f.response, page: { ...f.response.page, ...patch } }, f.baseline, f.prepared, f.page)).toThrow();
});
test("claim expiry, changed dates, assigned Torah, parent and altered actual text-page identity refuse", () => {
  const f = fixture(); for (const prepared of [{ ...f.prepared, expiresAt: Date.now() }, { ...f.prepared, binding: "unbound" }, { ...f.prepared, ceremonyDate: "2027-01-09" }]) expect(() => checkShortExplorationExpectation(f.baseline, prepared, f.page)).toThrow();
  expect(() => checkShortExplorationExpectation({ ...f.baseline, mode: "parent" }, f.prepared, f.page)).toThrow();
  expect(() => checkShortExplorationExpectation(f.baseline, f.prepared, { ...f.page, verses: f.page.verses.toReversed() })).toThrow();
  const getter = vi.fn(); const refs = [...f.response.page.references]; Object.defineProperty(refs, "0", { get: getter }); expect(() => parseShortExplorationPage({ ...f.response, page: { ...f.response.page, references: refs } }, f.baseline, f.prepared, f.page)).toThrow(); expect(getter).not.toHaveBeenCalled();
});
test("real child tuple must match and remain unexpired; parent overview cannot acquire exploration", () => {
  const f = fixture(), baseline: Assigned = { ...f.baseline, mode: "child-practice", context: { id: "10000000-0000-4000-8000-000000000002", studentId: f.baseline.student.id, studentRevision: 1, authorityRevision: 3, expiresAt: new Date(Date.now() + 60000).toISOString() } };
  const selection: Selection = { handle: "h".repeat(43), context: { ...baseline.context! } }, prepared = { ...f.prepared, mode: "child-practice" as const };
  expect(() => checkShortExplorationExpectation(baseline, prepared, f.page, selection)).not.toThrow();
  for (const selected of [undefined, { ...selection, context: { ...selection.context, authorityRevision: 4 } }, { ...selection, context: { ...selection.context, expiresAt: new Date(Date.now() - 1).toISOString() } }]) expect(() => checkShortExplorationExpectation(baseline, prepared, f.page, selected)).toThrow();
});
test("POST keeps its Origin policy on the fixed same-origin path, private signed body/no query and detached inputs", async () => {
  vi.stubGlobal("location", { origin }); const f = fixture(), expected = structuredClone(f.response), binding = f.prepared.binding;
  const fetcher = vi.fn(async (path: string, options: RequestInit) => { f.baseline.student.revision = 9; f.prepared.binding = "changed"; f.page.verses.reverse(); return response(expected, path); }); vi.stubGlobal("fetch", fetcher);
  expect((await fetchShortExplorationPage(f.baseline, f.prepared, f.page, new AbortController().signal)).references).toHaveLength(100);
  const [path, options] = fetcher.mock.calls[0]; expect(path).toBe(`/api/students/${expected.studentId}/reading/explore/reference/short/page`); expect(new URL(path, origin)).toMatchObject({ origin, search: "" }); expect(path).not.toContain(binding); expect(JSON.parse(String(options.body))).toEqual({ mode: "student", binding, offset: 0 }); expect(options).toMatchObject({ method: "POST", credentials: "same-origin", redirect: "error", cache: "no-store", mode: "same-origin", referrerPolicy: "same-origin" });
});

test("validated EOF releases the real reader without aborting or cancelling the completed transport", async () => {
  vi.stubGlobal("location", { origin }); const f = fixture(), caller = new AbortController(), r = response(f.response, `/api/students/${f.baseline.student.id}/reading/explore/reference/short/page`), observed = observedReader(r);
  let transport: AbortSignal | null | undefined;
  const fetcher = vi.fn(async (_path: string, options: RequestInit) => { transport = options.signal; return r; }); vi.stubGlobal("fetch", fetcher);
  expect((await fetchShortExplorationPage(f.baseline, f.prepared, f.page, caller.signal)).references).toHaveLength(100);
  expect(observed.facts.eof).toBe(true); expect(observed.release).toHaveBeenCalledOnce(); expect(observed.body.locked).toBe(false);
  expect(transport).toBeInstanceOf(AbortSignal); expect(transport!.aborted).toBe(false); expect(observed.cancel).not.toHaveBeenCalled();
  // The caller must no longer own a completed request's transport.
  caller.abort(); expect(transport!.aborted).toBe(false); expect(observed.cancel).not.toHaveBeenCalled(); expect(fetcher).toHaveBeenCalledOnce();
});

test("invalid JSON or identity after actual EOF still aborts, cancels and releases the reader", async () => {
  vi.stubGlobal("location", { origin }); const f = fixture();
  for (const [value, status] of [["{", 503], [{ ...f.response, studentRevision: f.response.studentRevision + 1 }, 409]] as const) {
    const r = response(value, `/api/students/${f.baseline.student.id}/reading/explore/reference/short/page`), observed = observedReader(r); let transport: AbortSignal | null | undefined;
    const fetcher = vi.fn(async (_path: string, options: RequestInit) => { transport = options.signal; return r; }); vi.stubGlobal("fetch", fetcher);
    await expect(fetchShortExplorationPage(f.baseline, f.prepared, f.page, new AbortController().signal)).rejects.toMatchObject({ status });
    expect(observed.facts.eof).toBe(true); expect(transport!.aborted).toBe(true); expect(observed.cancel).toHaveBeenCalledOnce();
    expect(observed.release).toHaveBeenCalledOnce(); expect(observed.body.locked).toBe(false); expect(fetcher).toHaveBeenCalledOnce();
  }
});
test("one-MiB exact observed boundary works; overflow/UTF8/wrongURL/session denial refuse without retry", async () => {
  vi.stubGlobal("location", { origin }); const f = fixture(), json = JSON.stringify(f.response), exact = json + " ".repeat(1048576 - new TextEncoder().encode(json).length), fetcher = vi.fn(async (path: string) => response(exact, path)); vi.stubGlobal("fetch", fetcher);
  expect((await fetchShortExplorationPage(f.baseline, f.prepared, f.page, new AbortController().signal)).references).toHaveLength(100);
  for (const value of [exact + " ", new Uint8Array([255]), "{}"] as const) { fetcher.mockImplementationOnce(async path => response(value, path)); await expect(fetchShortExplorationPage(f.baseline, f.prepared, f.page, new AbortController().signal)).rejects.toMatchObject({ status: 503 }); }
  fetcher.mockImplementationOnce(async path => response(f.response, path, 401)); await expect(fetchShortExplorationPage(f.baseline, f.prepared, f.page, new AbortController().signal)).rejects.toMatchObject({ status: 401 });
  fetcher.mockImplementationOnce(async () => response(f.response, "/wrong")); await expect(fetchShortExplorationPage(f.baseline, f.prepared, f.page, new AbortController().signal)).rejects.toMatchObject({ status: 503 }); expect(fetcher).toHaveBeenCalledTimes(6);
});
test("claim expiring during a held response denies late completion and cancels response", async () => {
  vi.useFakeTimers(); vi.stubGlobal("location", { origin }); const f = fixture(); f.prepared.expiresAt = Date.now() + 100; f.response.expiresAt = f.prepared.expiresAt; let complete!: (r: Response) => void; vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(yes => { complete = yes; })));
  const work = fetchShortExplorationPage(f.baseline, f.prepared, f.page, new AbortController().signal), refused = expect(work).rejects.toMatchObject({ status: 409 }); await vi.advanceTimersByTimeAsync(101); complete(response(f.response, `/api/students/${f.baseline.student.id}/reading/explore/reference/short/page`)); await refused;
});

test("assigned Haftarah may coexist with genuine proposed Torah; a confirmed Torah row denies exploration", () => {
  const f = fixture(); f.baseline.readings.push({ id: "10000000-0000-4000-8000-000000000003", kind: "haftarah", revision: 1, ranges: ["Isaiah 1:1"], verses: ["Isaiah 1:1"], needsReview: false, aliyahStarts: null, basis: "custom", confirmationDate: null, source: { status: "unknown", fetchedAt: null, date: null, calendar: null, attribution: null } });
  expect(parseShortExplorationPage(f.response, f.baseline, f.prepared, f.page).references).toHaveLength(100);
  f.baseline.readings[0] = { ...f.baseline.readings[0], kind: "torah", ranges: ["Genesis 1:1"], verses: ["Genesis 1:1"] }; expect(() => checkShortExplorationExpectation(f.baseline, f.prepared, f.page)).toThrow();
});
test("stalled bodies obey progress deadline and immediate caller abort never waits for a transport", async () => {
  vi.useFakeTimers(); vi.stubGlobal("location", { origin }); const f = fixture(), cancel = vi.fn(), body = new ReadableStream<Uint8Array>({ pull: () => new Promise(() => {}), cancel });
  const fetcher = vi.fn(async (path: string) => { const r = new Response(body, { headers: { "content-type": "application/json" } }); Object.defineProperty(r, "url", { value: origin + path }); return r; }); vi.stubGlobal("fetch", fetcher);
  const work = fetchShortExplorationPage(f.baseline, f.prepared, f.page, new AbortController().signal), denied = expect(work).rejects.toMatchObject({ status: 503 }); await vi.advanceTimersByTimeAsync(5001); await denied; expect(cancel).toHaveBeenCalledOnce();
  const aborted = new AbortController(); aborted.abort(); await expect(fetchShortExplorationPage(f.baseline, f.prepared, f.page, aborted.signal)).rejects.toMatchObject({ status: 409 }); expect(fetcher).toHaveBeenCalledOnce();
});
