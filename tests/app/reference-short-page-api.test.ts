import { afterEach, expect, test, vi } from "vitest";
import type { Assigned, ReadingMode, Selection } from "../../src/components/portal/workspace/api";
import { fetchShortReferencePage, parseShortReferencePage } from "../../src/components/portal/workspace/study/short-reference-api";
import { REFERENCE_ATTRIBUTION } from "../../src/lib/reference-audio/contract";
import { SHORT_SOURCE_ATTRIBUTION } from "../../src/lib/reference-audio/short-source";
const id = "10000000-0000-4000-8000-000000000001", assignmentId = "10000000-0000-4000-8000-000000000002", contextId = "10000000-0000-4000-8000-000000000003", origin = "https://example.test";
function base(mode: ReadingMode = "admin"): Assigned {
  return { student: { id, revision: 2, firstName: "Synthetic", lastName: "Reference", ceremonyDate: "2027-01-02" }, mode,
    context: mode === "child-practice" ? { id: contextId, studentId: id, studentRevision: 2, authorityRevision: 3, expiresAt: new Date(Date.now() + 60000).toISOString() } : null,
    readings: [{ id: assignmentId, kind: "torah", revision: 4, ranges: ["Genesis 1:1-3"], verses: ["Genesis 1:1", "Genesis 1:2", "Genesis 1:3"], needsReview: false, aliyahStarts: null, basis: "custom", confirmationDate: null,
      source: { status: "unknown", fetchedAt: null, date: null, calendar: null, attribution: null } }] };
}
const selected = (b: Assigned): Selection | undefined => b.context ? { handle: "h".repeat(43), context: { ...b.context } } : undefined;
function envelope(b = base(), offset = 0) {
  return { studentId: id, studentRevision: 2, mode: b.mode, context: b.context, assignment: { id: assignmentId, revision: 4, kind: "torah", needsReview: false },
    page: { offset, nextOffset: null, totalVerses: 3, references: b.readings[0].verses.slice(offset).map(ref => ({ schema: "reference-resolution/short-v1", source: null,
      verse: { schema: "reference-verse/v1", ref, playback: { status: "unavailable", reason: "asset-not-approved" }, words: { status: "unavailable", reason: "no-playback" } } })) } };
}
function response(value: unknown, path: string, status = 200) { const r = new Response(value instanceof Uint8Array ? new Uint8Array(value).buffer : typeof value === "string" ? value : JSON.stringify(value), { status, headers: { "content-type": "application/json" } }); Object.defineProperty(r, "url", { value: origin + path }); return r; }
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

test("exact authority and every ordered page ref are required in all assigned modes", () => {
  for (const mode of ["admin", "tutor", "parent", "student", "child-practice"] as const) {
    const b = base(mode), e = envelope(b); expect(parseShortReferencePage(e, b, "torah", 0, selected(b)).references).toHaveLength(3);
    for (const change of [{ studentRevision: 3 }, { studentId: assignmentId }, { mode: "other" }, { assignment: { ...e.assignment, revision: 5 } }]) expect(() => parseShortReferencePage({ ...e, ...change }, b, "torah", 0, selected(b))).toThrow();
    for (const page of [{ ...e.page, references: e.page.references.toReversed() }, { ...e.page, references: e.page.references.slice(1) }, { ...e.page, offset: 1 }, { ...e.page, totalVerses: 4 }, { ...e.page, nextOffset: 3 }]) expect(() => parseShortReferencePage({ ...e, page }, b, "torah", 0, selected(b))).toThrow();
  }
});

test("ready short descriptors parse without accepting v1 URLs or invented geometry", () => {
  const b = base(), e = envelope(b), sha = "a".repeat(64), asset = "ra_" + "b".repeat(32);
  const reference = { schema: "reference-resolution/short-v1", verse: { schema: "reference-verse/v1", ref: "Genesis 1:1", table: "torah", playback: { status: "ready", asset, clip: { start: 10, end: 12 } }, words: { status: "unavailable", reason: "portal-text-unavailable" }, attribution: REFERENCE_ATTRIBUTION },
    source: { schema: "reference-short-source/v1", id: "rs_" + sha, parent: { asset, sha256: "c".repeat(64), bytes: 1000 }, sha256: sha, bytes: 100, path: `/reference-audio/short-v1/${sha}.mp3`, codec: "mp3", bitrate: 64000, sampleRate: 24000, channels: 1, presentationFrames: 48000, origin: { firstFrame: 240000, parentRate: 24000 }, attributionVersion: SHORT_SOURCE_ATTRIBUTION.version } };
  const wire = { ...e, page: { ...e.page, references: [reference, ...e.page.references.slice(1)] } };
  expect(parseShortReferencePage(wire, b, "torah", 0).references[0].source).not.toBeNull();
  for (const source of [{ ...reference.source, url: "https://example.test/other.mp3" }, { ...reference.source, presentationFrames: 48001 }]) expect(() => parseShortReferencePage({ ...wire, page: { ...wire.page, references: [{ ...reference, source }, ...e.page.references.slice(1)] } }, b, "torah", 0)).toThrow();
});

test("context is exact, unexpired, private and accessor-free; hidden page/array fields reject", () => {
  const b = base("child-practice"), e = envelope(b), selection = selected(b)!;
  for (const change of [{ id }, { authorityRevision: 4 }, { studentRevision: 1 }, { expiresAt: new Date(Date.now() - 1).toISOString() }]) expect(() => parseShortReferencePage({ ...e, context: { ...b.context, ...change } }, b, "torah", 0, selection)).toThrow();
  expect(() => parseShortReferencePage(e, b, "torah", 0)).toThrow();
  const getter = vi.fn(); const context = Object.defineProperty({ ...b.context }, "id", { get: getter }); expect(() => parseShortReferencePage({ ...e, context }, b, "torah", 0, selection)).toThrow(); expect(getter).not.toHaveBeenCalled();
  const refs = [...e.page.references]; Object.defineProperty(refs, "0", { get: getter }); expect(() => parseShortReferencePage({ ...e, page: { ...e.page, references: refs } }, b, "torah", 0, selection)).toThrow(); expect(getter).not.toHaveBeenCalled();
  expect(() => parseShortReferencePage({ ...e, hidden: true }, b, "torah", 0, selection)).toThrow();
});

test("fetch uses only fixed same-origin private page query and captures inputs before awaits", async () => {
  vi.stubGlobal("location", { origin }); const b = base("child-practice"), selection = selected(b)!, expected = structuredClone(envelope(b));
  const fetcher = vi.fn(async (path: string, options: RequestInit) => { b.student.revision = 9; selection.context.authorityRevision = 9; return response(expected, path); }); vi.stubGlobal("fetch", fetcher);
  expect((await fetchShortReferencePage(b, "torah", 0, new AbortController().signal, selection)).references).toHaveLength(3);
  const [path, options] = fetcher.mock.calls[0], url = new URL(path, origin);
  expect(url.pathname).toBe(`/api/students/${id}/reference-audio/short/page`); expect([...url.searchParams.keys()].sort()).toEqual(["assignmentId", "assignmentRevision", "kind", "mode", "offset", "translation"]);
  expect(path).not.toContain(selection.handle); expect((options.headers as Headers).get("X-Practice-Context")).toBe(selection.handle);
  expect(options).toMatchObject({ credentials: "same-origin", mode: "same-origin", redirect: "error", cache: "no-store", referrerPolicy: "no-referrer" });
});

test("fixed one-MiB observed-byte reader allows exact boundary, refuses bad UTF8/overflow/status/URL and never retries", async () => {
  vi.stubGlobal("location", { origin }); const b = base(), json = JSON.stringify(envelope(b)), exact = json + " ".repeat(1024 * 1024 - new TextEncoder().encode(json).length);
  const fetcher = vi.fn(async (path: string) => response(exact, path)); vi.stubGlobal("fetch", fetcher);
  expect((await fetchShortReferencePage(b, "torah", 0, new AbortController().signal)).references).toHaveLength(3);
  for (const body of [exact + " ", new Uint8Array([255]), "{}"] as const) { fetcher.mockImplementationOnce(async path => response(body, path)); await expect(fetchShortReferencePage(b, "torah", 0, new AbortController().signal)).rejects.toMatchObject({ status: 503 }); }
  for (const status of [401, 403, 404, 409, 429, 500]) { fetcher.mockImplementationOnce(async path => response({}, path, status)); await expect(fetchShortReferencePage(b, "torah", 0, new AbortController().signal)).rejects.toMatchObject({ status: status === 500 ? 503 : status }); }
  fetcher.mockImplementationOnce(async () => response(envelope(b), "/wrong")); await expect(fetchShortReferencePage(b, "torah", 0, new AbortController().signal)).rejects.toMatchObject({ status: 503 }); expect(fetcher).toHaveBeenCalledTimes(11);
});

test("fragmented bytes use intrinsic byte shape, while tiny empties and stalled reads refuse", async () => {
  vi.stubGlobal("location", { origin }); const b = base(), bytes = new TextEncoder().encode(JSON.stringify(envelope(b))), getter = vi.fn(); Object.defineProperty(bytes, "byteLength", { get: getter });
  const fetcher = vi.fn(async (path: string) => { const r = new Response(new ReadableStream({ start(c) { c.enqueue(bytes); c.close(); } }), { headers: { "content-type": "application/json" } }); Object.defineProperty(r, "url", { value: origin + path }); return r; }); vi.stubGlobal("fetch", fetcher);
  expect((await fetchShortReferencePage(b, "torah", 0, new AbortController().signal)).references).toHaveLength(3); expect(getter).not.toHaveBeenCalled();
  const make = (path: string, stream: ReadableStream<Uint8Array>) => { const r = new Response(stream, { headers: { "content-type": "application/json" } }); Object.defineProperty(r, "url", { value: origin + path }); return r; };
  fetcher.mockImplementationOnce(async path => make(path, new ReadableStream({ start(c) { for (let i = 0; i < 65; i++) c.enqueue(new Uint8Array()); } })));
  await expect(fetchShortReferencePage(b, "torah", 0, new AbortController().signal)).rejects.toMatchObject({ status: 503 });
  vi.useFakeTimers(); fetcher.mockImplementationOnce(async path => make(path, new ReadableStream())); const stalled = fetchShortReferencePage(b, "torah", 0, new AbortController().signal), refused = expect(stalled).rejects.toMatchObject({ status: 503 }); await vi.advanceTimersByTimeAsync(5001); await refused;
});

test("abort before fetch does no I/O; open timeout cancels eventual response and child expiry rejects late delivery", async () => {
  vi.stubGlobal("location", { origin }); const fetcher = vi.fn<typeof fetch>(); vi.stubGlobal("fetch", fetcher); const abort = new AbortController(); abort.abort();
  await expect(fetchShortReferencePage(base(), "torah", 0, abort.signal)).rejects.toMatchObject({ status: 409 }); expect(fetcher).not.toHaveBeenCalled();
  vi.useFakeTimers(); let resolve!: (r: Response) => void, cancelled = false; fetcher.mockImplementationOnce(() => new Promise(yes => { resolve = yes; })); const pending = fetchShortReferencePage(base(), "torah", 0, new AbortController().signal), refused = expect(pending).rejects.toMatchObject({ status: 503 }); await vi.advanceTimersByTimeAsync(15001); await refused;
  resolve(new Response(new ReadableStream({ cancel() { cancelled = true; return new Promise(() => {}); } }))); await vi.advanceTimersByTimeAsync(0); expect(cancelled).toBe(true);
  const b = base("child-practice"), selection = selected(b)!; fetcher.mockImplementationOnce(async path => { await vi.advanceTimersByTimeAsync(60001); return response(envelope(b), String(path)); });
  await expect(fetchShortReferencePage(b, "torah", 0, new AbortController().signal, selection)).rejects.toThrow();
});
