import { afterEach, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseFragment, type DefaultTreeAdapterMap } from "parse5";
import { parseReferenceAudio, fetchReferenceAudio } from "../../src/components/portal/workspace/study/reference-api";
import type { Assigned, ReadingMode, Selection } from "../../src/components/portal/workspace/api";
import { REFERENCE_ATTRIBUTION } from "../../src/lib/reference-audio/contract";
import { StudyHebrew } from "../../src/components/portal/workspace/study/annotations";
import { normalizeHebrew } from "../../src/server/study/normalize";
vi.mock("server-only", () => ({}));
const id = "10000000-0000-4000-8000-000000000001", assignmentId = "10000000-0000-4000-8000-000000000002", contextId = "10000000-0000-4000-8000-000000000003";
function baseline(mode: ReadingMode = "admin"): Assigned {
  return { student: { id, revision: 2, firstName: "Synthetic", lastName: "Reference", ceremonyDate: "2027-01-02" }, mode,
    context: mode === "child-practice" ? { id: contextId, authorityRevision: 3, studentId: id, studentRevision: 2, expiresAt: new Date(Date.now() + 60_000).toISOString() } : null,
    readings: [{ id: assignmentId, kind: "torah", revision: 4, ranges: ["Genesis 1:1-3"], verses: ["Genesis 1:1", "Genesis 1:2", "Genesis 1:3"], needsReview: false, aliyahStarts: null, basis: "custom", confirmationDate: "2027-01-02", source: { status: "unknown", fetchedAt: null, date: null, calendar: null, attribution: null } }] };
}
const selected = (base: Assigned): Selection | undefined => base.context ? { handle: "h".repeat(43), context: { ...base.context } } : undefined;
const asset = "ra_" + "a".repeat(32);
function envelope(base = baseline(), offset = 0) {
  return { studentId: id, studentRevision: 2, mode: base.mode, context: base.context, assignment: { id: assignmentId, revision: 4, kind: "torah", needsReview: false },
    reference: { verse: { schema: "reference-verse/v1", ref: `Genesis 1:${offset + 1}`, table: "torah", playback: { status: "ready", asset, clip: { start: 10, end: 15 } }, words: { status: "unavailable", reason: "portal-text-unavailable" }, attribution: REFERENCE_ATTRIBUTION },
      source: { schema: "reference-source/v1", asset, url: "https://archive.org/download/PockettorahAudioFiles/Synthetic.mp3", sha256: "b".repeat(64), bytes: 4 } } };
}
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

it("binds the exact current authority/assignment/ref envelope for all selected modes", () => {
  for (const mode of ["admin", "tutor", "parent", "student", "child-practice"] as const) {
    const base = baseline(mode), row = envelope(base, 1);
    expect(parseReferenceAudio(row, base, "torah", 1, selected(base))).toEqual(row.reference);
    for (const change of [{ studentId: assignmentId }, { studentRevision: 1 }, { mode: "other" }, { assignment: { ...row.assignment, revision: 3 } }, { assignment: { ...row.assignment, needsReview: true } }, { assignment: { ...row.assignment, kind: "haftarah" } }, { assignment: { ...row.assignment, id } }]) expect(() => parseReferenceAudio({ ...row, ...change }, base, "torah", 1, selected(base))).toThrow();
    expect(() => parseReferenceAudio(row, base, "torah", 0, selected(base))).toThrow();
  }
});

it("keeps child context identity/revisions/expiry exact without returning a handle", () => {
  const base = baseline("child-practice"), row = envelope(base), selection = selected(base)!;
  for (const change of [{ id }, { authorityRevision: 4 }, { studentId: contextId }, { studentRevision: 1 }, { expiresAt: new Date(Date.now() - 1).toISOString() }]) expect(() => parseReferenceAudio({ ...row, context: { ...row.context, ...change } }, base, "torah", 0, selection)).toThrow();
  expect(() => parseReferenceAudio(row, base, "torah", 0)).toThrow();
  expect(() => parseReferenceAudio({ ...row, context: { ...row.context, handle: selection.handle } }, base, "torah", 0, selection)).toThrow();
  const historical = { ...selection, context: { ...selection.context, studentRevision: 1 } };
  // Same convention as study-text: live baseline/student revision wins over entry metadata.
  expect(parseReferenceAudio(row, base, "torah", 0, historical)).toEqual(row.reference);
});

it("keeps closed data and rejects mismatched selected assets, arbitrary media URLs and unknown fields", () => {
  const base = baseline(), row = envelope(base);
  for (const value of [{ ...row, diagnostic: true }, { ...row, context: {} }, { ...row, reference: { ...row.reference, diagnostic: true } }, { ...row, reference: { ...row.reference, source: { ...row.reference.source, url: "https://example.test/audio.mp3" } } }]) expect(() => parseReferenceAudio(value, base, "torah", 0)).toThrow();
  expect(() => parseReferenceAudio(row, base, "torah", 0, undefined, "ra_" + "c".repeat(32))).toThrow();
  expect(parseReferenceAudio(row, base, "torah", 0, undefined, asset)).toEqual(row.reference);
  const getter = vi.fn(); expect(() => parseReferenceAudio(Object.defineProperty(row, "reference", { get: getter }), base, "torah", 0)).toThrow(); expect(getter).not.toHaveBeenCalled();
});

it("sends only the closed same-origin study selection and practice header with no retry", async () => {
  const base = baseline("child-practice"), selection = selected(base)!, fetcher = vi.fn(async () => response(envelope(base)));
  vi.stubGlobal("fetch", fetcher); await fetchReferenceAudio(base, "torah", 0, new AbortController().signal, selection, asset);
  const [path, options] = fetcher.mock.calls[0] as unknown as [string, RequestInit], url = new URL(path, "http://localhost");
  expect(url.pathname).toBe(`/api/students/${id}/reference-audio`); expect([...url.searchParams.keys()].sort()).toEqual(["asset", "assignmentId", "assignmentRevision", "kind", "mode", "offset", "translation"]);
  expect((options.headers as Headers).get("X-Practice-Context")).toBe(selection.handle); expect(path).not.toContain(selection.handle);
  expect(options).toMatchObject({ credentials: "same-origin", redirect: "error", cache: "no-store", referrerPolicy: "no-referrer" });
  for (const status of [401, 403, 404, 409, 503]) {
    fetcher.mockResolvedValueOnce(response({ detail: "synthetic-withheld" }, status));
    await expect(fetchReferenceAudio(base, "torah", 0, new AbortController().signal, selection)).rejects.toMatchObject({ status });
  }
  expect(fetcher).toHaveBeenCalledTimes(6);
});

it("captures baseline and context before waiting for response, rather than consulting mutable caller objects", async () => {
  const base = baseline("child-practice"), selection = selected(base)!, row = envelope(base);
  const fetcher = vi.fn(async () => { base.student.revision = 9; base.readings[0].revision = 9; base.context!.authorityRevision = 9; selection.context.authorityRevision = 9; return response(row); });
  // Copy actual response data before the caller mutates the shared fixture object.
  const frozen = structuredClone(row); fetcher.mockImplementation(async () => { base.student.revision = 9; base.context!.authorityRevision = 9; selection.context.authorityRevision = 9; return response(frozen); });
  vi.stubGlobal("fetch", fetcher);
  expect(await fetchReferenceAudio(base, "torah", 0, new AbortController().signal, selection)).toEqual(frozen.reference);
});

it("requires bounded UTF8 JSON observed bytes, allowing exactly 32KiB including whitespace", async () => {
  const base = baseline(), json = JSON.stringify(envelope(base)), exact = json + " ".repeat(32768 - new TextEncoder().encode(json).length);
  const fetcher = vi.fn<typeof fetch>(); vi.stubGlobal("fetch", fetcher);
  fetcher.mockResolvedValueOnce(new Response(exact, { headers: { "content-type": "application/json" } }));
  expect(await fetchReferenceAudio(base, "torah", 0, new AbortController().signal)).toEqual(envelope(base).reference);
  for (const body of [exact + " ", new Uint8Array([255]), "{}"] as const) {
    fetcher.mockResolvedValueOnce(new Response(body, { headers: { "content-type": "application/json" } }));
    await expect(fetchReferenceAudio(base, "torah", 0, new AbortController().signal)).rejects.toMatchObject({ status: 503 });
  }
});

it("bounds empty streams and cancels a late response after abort without awaiting cancel", async () => {
  let reads = 0;
  vi.stubGlobal("fetch", vi.fn(async () => new Response(new ReadableStream({ pull(c) { reads++; c.enqueue(new Uint8Array()); }, cancel() { return new Promise<void>(() => {}); } }), { headers: { "content-type": "application/json" } })));
  await expect(fetchReferenceAudio(baseline(), "torah", 0, new AbortController().signal)).rejects.toMatchObject({ status: 503 }); expect(reads).toBeLessThanOrEqual(66);
  let resolve!: (value: Response) => void;
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(yes => { resolve = yes; })));
  const abort = new AbortController(), work = fetchReferenceAudio(baseline(), "torah", 0, abort.signal); abort.abort(); await expect(work).rejects.toMatchObject({ status: 409 });
  const late = response(envelope()), cancel = vi.spyOn(late.body!, "cancel"); resolve(late); await Promise.resolve(); await Promise.resolve(); expect(cancel).toHaveBeenCalledTimes(1);
});

it("highlights all source spans of one canonical read word without indexing written ketiv", () => {
  const hebrew = normalizeHebrew('אָ<b>ב</b> <span class="mam-kq"><span class="mam-kq-k">כָתָב</span><span class="mam-kq-q">[קָרִי]</span></span>');
  const root = parseFragment(renderToStaticMarkup(createElement(StudyHebrew, { verse: { ref: "Genesis 1:1", english: null, hebrew: { ...hebrew, segments: [...hebrew.segments] } }, colors: null, id: "synthetic", activeWord: 0 })));
  type Node = DefaultTreeAdapterMap["node"];
  const all = (node: Node): Node[] => [node, ...("childNodes" in node ? node.childNodes.flatMap(all) : [])];
  const attr = (node: Node, key: string) => "attrs" in node ? node.attrs.find(a => a.name === key)?.value : undefined;
  const marked = all(root).filter(node => attr(node, "data-reference-active") === "true");
  expect(marked).toHaveLength(2); expect(marked.every(node => attr(node, "data-word-index") === "0")).toBe(true);
  expect(all(root).filter(node => attr(node, "data-family") !== undefined || attr(node, "data-phrase") !== undefined)).toHaveLength(0);
});
