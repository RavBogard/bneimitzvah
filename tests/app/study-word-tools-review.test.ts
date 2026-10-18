// Invented Hebrew and closed endpoint responses; no corpus or live network.
import { createHash } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { fetchWordToolsAids, fetchWordToolsDetails } from "../../src/components/portal/workspace/study/word-tools-api";
import type { Assigned, Selection } from "../../src/components/portal/workspace/api";
import type { StudyVerse } from "../../src/components/portal/workspace/study/api";
import { normalizeHebrew } from "../../src/server/study/normalize";
import { WORD_DETAILS_ATTRIBUTION } from "../../src/lib/hebrew/word-details";

const id = "10000000-0000-4000-8000-000000000001", aid = "10000000-0000-4000-8000-000000000002", cid = "10000000-0000-4000-8000-000000000003";
const sha = (text: string) => createHash("sha256").update(text.normalize("NFC")).digest("hex");
function fixture(child = false) {
  const normalized = normalizeHebrew('דָּג־<span class="mam-kq"><span class="mam-kq-k">זָח</span><span class="mam-kq-q">[בָּג]</span></span>'.normalize("NFD"));
  const verse: StudyVerse = { ref: "Genesis 1:1", english: null, hebrew: { ...normalized, segments: normalized.segments.map(s => ({ ...s })) } };
  const base: Assigned = { student: { id, revision: 2, firstName: "Synthetic", lastName: "Tools", ceremonyDate: "2027-01-02" }, mode: child ? "child-practice" : "admin",
    context: child ? { id: cid, authorityRevision: 3, studentId: id, studentRevision: 2, expiresAt: new Date(Date.now() + 60_000).toISOString() } : null,
    readings: [{ id: aid, revision: 4, kind: "torah", ranges: ["Genesis 1:1-2"], verses: ["Genesis 1:1", "Genesis 1:2"], needsReview: false, basis: "custom", confirmationDate: "2027-01-02", aliyahStarts: null,
      source: { status: "unknown", fetchedAt: null, date: null, calendar: null, attribution: null } }] };
  const selection: Selection | undefined = base.context ? { handle: "h".repeat(43), context: { ...base.context } } : undefined;
  const identity = { schema: "study-word-details/v1", ref: verse.ref, readingTextSha256: sha(verse.hebrew.readingText), wordCount: 2, wordIndex: 1, attribution: { ...WORD_DETAILS_ATTRIBUTION } };
  const aids = { schema: "study-word-aids/v1", ref: verse.ref, status: "ready", readingTextSha256: sha(verse.hebrew.readingText), wordCount: 2,
    words: ["דָּג", "בָּג"].map((word, index) => ({ index, status: "ready", syllables: [{ start: 0, end: word.normalize("NFC").length, stress: "tonic" }] })) };
  const details = { ...identity, status: "ready", occurrence: { gloss: "Invented occurrence", grammar: { status: "ready", language: "hebrew", morphemes: [{ partOfSpeech: "noun", number: "singular" }] } },
    dictionary: [{ lemma: "H0002", status: "ready", headword: "בָּג".normalize("NFC"), dictionaryGloss: "Invented dictionary sense" }] };
  const envelope = (kind: "aids" | "details") => ({ studentId: id, studentRevision: 2, mode: base.mode, context: base.context ? { ...base.context } : null,
    assignment: { id: aid, revision: 4, kind: "torah", needsReview: false }, ...(kind === "aids" ? { wordAids: structuredClone(aids) } : { wordDetails: structuredClone(details) }) });
  const run = (kind: "aids" | "details", signal = new AbortController().signal) => kind === "aids" ? fetchWordToolsAids(base, "torah", 0, verse, signal, selection) : fetchWordToolsDetails(base, "torah", 0, verse, 1, signal, selection);
  return { base, verse, selection, aids, details, envelope, run };
}
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

it.each(["aids", "details"] as const)("review %s independently binds actual NFC qere/maqaf text and only sends closed same-origin selection", async kind => {
  const f = fixture(true), fetcher = vi.fn(async () => response(f.envelope(kind))); vi.stubGlobal("fetch", fetcher);
  const value = await f.run(kind), [path, options] = fetcher.mock.calls[0] as unknown as [string, RequestInit], url = new URL(path, "https://example.test");
  expect(url.pathname).toBe(`/api/students/${id}/study-word-${kind}`);
  expect([...url.searchParams.keys()].sort()).toEqual(["assignmentId", "assignmentRevision", "kind", "mode", "offset", "translation", ...(kind === "details" ? ["wordIndex"] : [])].sort());
  expect(options).toMatchObject({ credentials: "same-origin", redirect: "error", cache: "no-store", referrerPolicy: "no-referrer" });
  expect(new Headers(options.headers).get("X-Practice-Context")).toBe(f.selection!.handle); expect(path).not.toContain(f.selection!.handle);
  expect(value).toMatchObject({ status: "ready", ref: "Genesis 1:1", wordCount: 2, readingTextSha256: sha(f.verse.hebrew.readingText) }); expect(Object.isFrozen(value)).toBe(true);
});

it.each(["aids", "details"] as const)("review %s refuses authority/assignment/context and echoed-hash mismatch without a retry", async kind => {
  const f = fixture(true), fetcher = vi.fn<typeof fetch>(); vi.stubGlobal("fetch", fetcher);
  const good = f.envelope(kind);
  const changes = [{ studentId: aid }, { studentRevision: 3 }, { mode: "admin" }, { context: { ...f.base.context!, authorityRevision: 4 } }, { context: { ...f.base.context!, studentId: aid } },
    { assignment: { ...good.assignment, revision: 5 } }, { assignment: { ...good.assignment, needsReview: true } }, { extra: true }];
  for (const change of changes) { fetcher.mockResolvedValueOnce(response({ ...good, ...change })); await expect(f.run(kind)).rejects.toHaveProperty("status"); }
  const bad = structuredClone(good) as Record<string, unknown>, key = kind === "aids" ? "wordAids" : "wordDetails";
  bad[key] = { ...(bad[key] as object), readingTextSha256: sha("זָח") }; fetcher.mockResolvedValueOnce(response(bad)); await expect(f.run(kind)).rejects.toHaveProperty("status");
  expect(fetcher).toHaveBeenCalledTimes(changes.length + 1);
});

it.each(["aids", "details"] as const)("review %s snapshots original verse, baseline and selected child before waiting", async kind => {
  const f = fixture(true), captured = f.envelope(kind), gate = deferred<Response>(), entered = deferred<void>();
  const fetcher = vi.fn(() => { entered.resolve(); return gate.promise; }); vi.stubGlobal("fetch", fetcher); const pending = f.run(kind); await entered.promise;
  f.base.student.revision = 9; f.base.readings[0].revision = 9; f.base.context!.authorityRevision = 9; f.selection!.context.authorityRevision = 9; f.selection!.handle = "j".repeat(43); f.verse.ref = "Genesis 1:2"; f.verse.hebrew.readingText = "זָח";
  gate.resolve(response(captured)); expect(await pending).toMatchObject({ status: "ready", ref: "Genesis 1:1", wordCount: 2 });
});

it.each(["aids", "details"] as const)("review %s measures stream bytes despite misleading headers and bounds endless empty reads", async kind => {
  const f = fixture(), emptyCancel = vi.fn(), capCancel = vi.fn(), fetcher = vi.fn<typeof fetch>(); vi.stubGlobal("fetch", fetcher);
  fetcher.mockResolvedValueOnce(new Response(new ReadableStream({ pull(c) { c.enqueue(new Uint8Array()); }, cancel: emptyCancel }), { headers: { "content-type": "application/json" } }));
  await expect(f.run(kind)).rejects.toHaveProperty("status", 503); expect(emptyCancel).toHaveBeenCalledTimes(1);
  fetcher.mockResolvedValueOnce(new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array(161 * 1024)); }, cancel: capCancel }), { headers: { "content-type": "application/json", "content-length": "1" } }));
  await expect(f.run(kind)).rejects.toHaveProperty("status", 503); expect(capCancel).toHaveBeenCalledTimes(1);
});

it.each(["aids", "details"] as const)("review %s caller cancellation refuses a late response and cancels its body", async kind => {
  const f = fixture(), controller = new AbortController(), gate = deferred<Response>(), entered = deferred<void>(); vi.stubGlobal("fetch", vi.fn(() => { entered.resolve(); return gate.promise; }));
  const pending = f.run(kind, controller.signal), refusal = expect(pending).rejects.toHaveProperty("status"); await entered.promise; controller.abort(); await refusal;
  const late = response(f.envelope(kind)), cancel = vi.spyOn(late.body!, "cancel"); gate.resolve(late); await new Promise(resolve => setTimeout(resolve, 0)); expect(cancel).toHaveBeenCalledTimes(1);
});

it("review reconstruction holds expose no fabricated hash/count, while source holds keep the proved selected identity", async () => {
  const f = fixture(), fetcher = vi.fn<typeof fetch>(); vi.stubGlobal("fetch", fetcher);
  fetcher.mockResolvedValueOnce(response({ ...f.envelope("details"), wordDetails: { schema: "study-word-details/v1", ref: f.verse.ref, wordIndex: 1, status: "unavailable", reason: "reconstruction" } }));
  expect(await f.run("details")).toEqual({ schema: "study-word-details/v1", ref: f.verse.ref, wordIndex: 1, status: "unavailable", reason: "reconstruction" });
  const { occurrence: _occurrence, dictionary: _dictionary, ...identity } = f.details;
  fetcher.mockResolvedValueOnce(response({ ...f.envelope("details"), wordDetails: { ...identity, status: "unavailable", reason: "source-unavailable" } }));
  expect(await f.run("details")).toMatchObject({ wordIndex: 1, wordCount: 2, readingTextSha256: sha(f.verse.hebrew.readingText), status: "unavailable", reason: "source-unavailable" });
});

it.each(["aids", "details"] as const)("review %s enforces elapsed deadline after a settled fetch and cleans up the rejected response", async kind => {
  const f = fixture(), late = response(f.envelope(kind)), cancel = vi.spyOn(late.body!, "cancel"); let now = 0;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.stubGlobal("fetch", vi.fn(async () => { now = 15_001; return late; }));
  await expect(f.run(kind)).rejects.toHaveProperty("status", 503); expect(cancel).toHaveBeenCalledTimes(1);
});

it("review hostile leaf fields and byte-invalid JSON never become renderable lexical content", async () => {
  const f = fixture(), fetcher = vi.fn<typeof fetch>(); vi.stubGlobal("fetch", fetcher);
  for (const patch of [{ occurrence: { ...f.details.occurrence, gloss: "<b>invented</b>" } }, { dictionary: [{ ...f.details.dictionary[0], pronunciation: "invented withheld field" }] }, { wordIndex: 0 }, { wordCount: 1 }]) {
    fetcher.mockResolvedValueOnce(response({ ...f.envelope("details"), wordDetails: { ...f.details, ...patch } })); await expect(f.run("details")).rejects.toHaveProperty("status", 503);
  }
  fetcher.mockResolvedValueOnce(new Response(new Uint8Array([0xff]), { headers: { "content-type": "application/json" } })); await expect(f.run("details")).rejects.toHaveProperty("status", 503);
});
