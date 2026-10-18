// Independent invented citations only. All fetches are blocked local mocks.
import { afterEach, expect, test, vi } from "vitest";
import type { Assigned, ReadingMode, Selection } from "../../src/components/portal/workspace/api";
import { createSourceAssignmentClient, captureSourceIntent, SourceClientError, type CurrentSources, type SourcePage, type SourceCommit, type SourceIntent } from "../../src/components/portal/workspace/study/sources/api";
import { createSourceSelection } from "../../src/components/portal/workspace/study/sources/selection";

const studentId = "20000000-0000-4000-8000-000000000001", assignmentId = "20000000-0000-4000-8000-000000000002", contextId = "20000000-0000-4000-8000-000000000003", mutationId = "20000000-0000-4000-8000-000000000004";
const ref = "Genesis 1:1", hash = "a".repeat(64);
function base(mode: ReadingMode = "tutor"): Assigned { return { mode, student: { id: studentId, revision: 3, firstName: "Synthetic", lastName: "Sources", ceremonyDate: "2027-01-02" }, context: mode === "child-practice" ? { id: contextId, authorityRevision: 2, studentId, studentRevision: 3, expiresAt: new Date(Date.now() + 60000).toISOString() } : null, readings: [{ id: assignmentId, kind: "torah", revision: 7, ranges: ["Genesis 1:1-2"], verses: [ref, "Genesis 1:2"], needsReview: false, aliyahStarts: null, basis: "custom", confirmationDate: "2027-01-02", source: { status: "unknown", fetchedAt: null, date: null, calendar: null, attribution: null } }] }; }
function citation(n: number) { return { id: `source-${String(n).padStart(3, "0")}`, ref: `Invented Commentary, Section ${n + 1}`, indexTitle: "Invented Complete Commentary", category: "Commentary", labels: { en: "Invented label", he: null } }; }
function authority(b = base()) { return { studentId, studentRevision: 3, mode: b.mode, context: b.context, assignment: { id: assignmentId, revision: 7, kind: "torah", needsReview: false }, verseRef: ref }; }
function current(b = base(), version = 0, citations = [] as ReturnType<typeof citation>[]) { return { ok: true, ...authority(b), currentVersion: version, citations }; }
function page(b = base(), offset = 0, total = 12, catalogHash = hash) { const { verseRef: _ref, ...scope } = authority(b); return { ...scope, sources: { schema: "study-related-page/v1", ref, catalogHash, sourceOffset: offset, pageSize: 10, totalEntries: total, receivedRows: total, heldCount: 0, duplicateCount: 0, nextSourceOffset: offset + 10 < total ? offset + 10 : null, entries: Array.from({ length: Math.max(0, Math.min(10, total - offset)) }, (_, n) => citation(n + offset)) } }; }
function intent(ids = [citation(0).id]) { return { verseRef: ref, expectedVersion: 0, mutationId, sourceIds: [...ids], catalogHash: hash }; }
function committed(b = base(), ids = [citation(0)], version = 1, latest = version) { return { ok: true, ...authority(b), replayed: false, committedVersion: version, currentLatestVersion: latest, committed: { version, citations: ids, createdAt: "2026-10-17T12:00:00.000Z" } }; }
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

test("review source client captures actual authority/verse at construction and dispatches only fixed closed routes", async () => {
  const b = base(), client = createSourceAssignmentClient({ baseline: b, kind: "torah", offset: 0 }), fetcher = vi.fn(async () => response(current())); vi.stubGlobal("fetch", fetcher);
  expect(fetcher).not.toHaveBeenCalled(); b.student.id = "20000000-0000-4000-8000-000000000009"; b.student.revision = 9; b.mode = "admin"; b.readings[0].revision = 99; b.readings[0].verses[0] = "Genesis 1:2";
  await expect(client.read(new AbortController().signal)).resolves.toMatchObject({ citations: [] });
  const [url, options] = fetcher.mock.calls[0] as unknown as [string, RequestInit], parsed = new URL(url, "http://localhost:3000");
  expect(parsed.pathname).toBe(`/api/students/${studentId}/source-assignments`); expect(Object.fromEntries(parsed.searchParams)).toEqual({ mode: "tutor", kind: "torah", assignmentId, assignmentRevision: "7", verseRef: ref }); expect(options).toMatchObject({ credentials: "same-origin", redirect: "error", cache: "no-store" }); expect(client.ref).toBe(ref);
});

test("review discovery binds the full catalog hash, exact ten-entry offsets/counts and no caller source refs", async () => {
  const b = base(), client = createSourceAssignmentClient({ baseline: b, kind: "torah", offset: 0 }), fetcher = vi.fn(async () => response(page())); vi.stubGlobal("fetch", fetcher);
  await expect(client.discover({ sourceOffset: 0 }, new AbortController().signal)).resolves.toMatchObject({ catalogHash: hash, sourceOffset: 0, totalEntries: 12 });
  fetcher.mockResolvedValue(response(page(b, 10))); await expect(client.discover({ sourceOffset: 10, catalogHash: hash }, new AbortController().signal)).resolves.toMatchObject({ entries: [citation(10), citation(11)], nextSourceOffset: null });
  const parsed = new URL(String((fetcher.mock.calls[1] as unknown as [string])[0]), "http://localhost:3000"); expect(parsed.searchParams.get("sourceOffset")).toBe("10"); expect(parsed.searchParams.get("catalogHash")).toBe(hash); expect(parsed.searchParams.has("sourceRef")).toBe(false);
  for (const mutate of [(v: ReturnType<typeof page>) => { v.sources.catalogHash = "b".repeat(64); }, (v: ReturnType<typeof page>) => { v.sources.sourceOffset = 0; }, (v: ReturnType<typeof page>) => { v.sources.nextSourceOffset = 20; }, (v: ReturnType<typeof page>) => { v.sources.entries.push(citation(10)); }]) { const value = page(b, 10); mutate(value); fetcher.mockResolvedValue(response(value)); await expect(client.discover({ sourceOffset: 10, catalogHash: hash }, new AbortController().signal)).rejects.toBeDefined(); }
});

test("review closed source responses reject wrong authority, private extras, markup, duplicates and oversized sets", async () => {
  const client = createSourceAssignmentClient({ baseline: base(), kind: "torah", offset: 0 }), fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  const wrong = [current(base(), 1, [citation(0)]), current(base(), 1, [citation(0)]), current(base(), 1, [citation(0)]), current(base(), 1, [citation(0), citation(0)]), current(base(), 1, Array.from({ length: 33 }, (_, i) => citation(i)))];
  wrong[0].studentRevision = 4; wrong[1].assignment.revision = 8; wrong[2].citations[0].labels.en = "<img src=x>";
  for (const value of [...wrong, { ...current(), actorUserId: "private" }, { ...current(), context: { id: contextId } }, { ...current(), verseRef: "Genesis 1:2" }]) { fetcher.mockResolvedValue(response(value)); await expect(client.read(new AbortController().signal)).rejects.toBeDefined(); }
});

test("review child handle is snapshotted into a header only and child cannot dispatch a staff write", async () => {
  const b = base("child-practice"), selected: Selection = { handle: "h".repeat(43), context: { ...b.context! } }, client = createSourceAssignmentClient({ baseline: b, kind: "torah", offset: 0, selection: selected }), fetcher = vi.fn(async () => response(current(b))); vi.stubGlobal("fetch", fetcher);
  selected.handle = "x".repeat(43); await client.read(new AbortController().signal);
  const [url, options] = fetcher.mock.calls[0] as unknown as [string, RequestInit]; expect(url).not.toContain("h".repeat(43)); expect(new Headers(options.headers).get("X-Practice-Context")).toBe("h".repeat(43)); expect(client.canEdit).toBe(false);
  const count = fetcher.mock.calls.length; await expect(client.write(intent(), new AbortController().signal)).rejects.toBeDefined(); expect(fetcher).toHaveBeenCalledTimes(count);
});

test("review write freezes a single intent before awaiting and validates original commit separately from latest", async () => {
  const client = createSourceAssignmentClient({ baseline: base(), kind: "torah", offset: 0 }), gate = deferred<Response>(), entered = deferred<void>(), fetcher = vi.fn(() => { entered.resolve(); return gate.promise; }); vi.stubGlobal("fetch", fetcher);
  const value = intent(), pending = client.write(value, new AbortController().signal); await entered.promise;
  value.sourceIds[0] = citation(1).id; value.expectedVersion = 99; value.mutationId = "20000000-0000-4000-8000-000000000099"; value.verseRef = "Genesis 1:2";
  gate.resolve(response(committed(base(), [citation(0)], 1, 2))); await expect(pending).resolves.toMatchObject({ committedVersion: 1, currentLatestVersion: 2, committed: { citations: [citation(0)] } });
  const [url, options] = fetcher.mock.calls[0] as unknown as [string, RequestInit]; expect(new URL(url, "http://localhost:3000").search).toBe(""); expect(JSON.parse(String(options.body))).toEqual({ mode: "tutor", kind: "torah", assignmentId, assignmentRevision: 7, verseRef: ref, expectedVersion: 0, mutationId, sourceIds: [citation(0).id], catalogHash: hash });
});

test("review missing receipt is only unconfirmed and extra/changed committed intent cannot be adopted", async () => {
  const client = createSourceAssignmentClient({ baseline: base(), kind: "torah", offset: 0 }), fetcher = vi.fn(async () => response({ ok: true, ...authority(), outcome: "unconfirmed" })); vi.stubGlobal("fetch", fetcher);
  await expect(client.receipt(intent(), new AbortController().signal)).resolves.toMatchObject({ outcome: "unconfirmed" });
  for (const value of [{ ok: true, ...authority(), outcome: "absent" }, { ...committed(base(), [citation(1)]), outcome: "committed", replayed: undefined }, { ...committed(), outcome: "committed", currentLatestVersion: 0, replayed: undefined }]) { fetcher.mockResolvedValue(response(value)); await expect(client.receipt(intent(), new AbortController().signal)).rejects.toBeDefined(); }
});

test("review measured stream cap refuses a never-ending oversized response rather than trusting its small declared length", async () => {
  const client = createSourceAssignmentClient({ baseline: base(), kind: "torah", offset: 0 }), canceled = vi.fn();
  vi.stubGlobal("fetch", vi.fn(async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(128 * 1024 + 1)); }, cancel: canceled }), { headers: { "content-type": "application/json", "content-length": "1" } })));
  await expect(client.read(new AbortController().signal)).rejects.toBeDefined(); expect(canceled).toHaveBeenCalledTimes(1);
});

test("review abort fences a late response and observes body cancellation without retaining provider errors", async () => {
  const client = createSourceAssignmentClient({ baseline: base(), kind: "torah", offset: 0 }), entered = deferred<void>(), gate = deferred<Response>(), canceled = vi.fn(), abort = new AbortController();
  vi.stubGlobal("fetch", vi.fn(() => { entered.resolve(); return gate.promise; })); const pending = client.read(abort.signal), refusal = expect(pending).rejects.toBeDefined(); await entered.promise; abort.abort(); await refusal;
  gate.resolve(new Response(new ReadableStream({ cancel: canceled }), { headers: { "content-type": "application/json" } })); await flush(); expect(canceled).toHaveBeenCalledTimes(1);
});

function ownerFixture(editable = true, initial: CurrentSources = { currentVersion: 0, citations: [] }) {
  const api = { ref, canEdit: editable,
    read: vi.fn(async (_signal: AbortSignal): Promise<CurrentSources> => initial),
    discover: vi.fn(async (_paging: { sourceOffset: number; catalogHash?: string }, _signal: AbortSignal): Promise<SourcePage> => ({ ...page().sources, schema: "study-related-page/v1", pageSize: 10 })),
    write: vi.fn(async (value: SourceIntent, _signal: AbortSignal): Promise<SourceCommit> => ({ outcome: "committed", committedVersion: value.expectedVersion + 1, currentLatestVersion: value.expectedVersion + 1, committed: { version: value.expectedVersion + 1, citations: value.sourceIds.map(id => citation(Number(id.slice(-3)))), createdAt: "2026-10-17T12:00:00.000Z" } })),
    receipt: vi.fn(async (_value: SourceIntent, _signal: AbortSignal): Promise<SourceCommit | { outcome: "unconfirmed" }> => ({ outcome: "unconfirmed" })) };
  const uuid = vi.fn(() => mutationId), owner = createSourceSelection({ scopeKey: "captured-authority-reading-verse", canEdit: editable, api, newMutationId: uuid });
  return { api, uuid, owner };
}

test("review every authorized reader can browse but readonly owners cannot select or mutate", async () => {
  const { api, owner, uuid } = ownerFixture(false); expect(api.read).not.toHaveBeenCalled();
  await owner.open(); await owner.browse(); expect(owner.state.page?.entries).toHaveLength(10);
  expect(owner.select(citation(0).id, true)).toBe(false); expect(await owner.save()).toBe(false); expect(await owner.reconcile()).toBe(false); expect(await owner.retryExact()).toBe(false);
  expect(api.write).not.toHaveBeenCalled(); expect(api.receipt).not.toHaveBeenCalled(); expect(uuid).not.toHaveBeenCalled();
  api.discover.mockResolvedValueOnce({ ...page(base(), 10).sources, schema: "study-related-page/v1", pageSize: 10 }); expect(await owner.nextPage()).toBe(true); expect(owner.state.page?.sourceOffset).toBe(10);
  owner.dispose();
});

test("review explicit removal has no discovery/autosave and dirty departure offers keep or discard", async () => {
  const { api, owner } = ownerFixture(true, { currentVersion: 4, citations: [citation(0), citation(1)] });
  await owner.open(); owner.select(citation(0).id, false); expect(api.write).not.toHaveBeenCalled();
  expect(owner.departure()).toEqual({ kind: "dirty", actions: ["keep-editing", "discard"] }); expect(owner.close()).toBe(false);
  expect(await owner.save()).toBe(true); expect(api.discover).not.toHaveBeenCalled();
  expect(api.write.mock.calls[0][0]).toEqual({ verseRef: ref, expectedVersion: 4, mutationId, sourceIds: [citation(1).id] });
  expect(owner.state.current?.currentVersion).toBe(5); expect(owner.state.dirty).toBe(false); owner.dispose();
});

test("review unknown write freezes exactly one UUID and missing receipt permits only explicit same-intent retry", async () => {
  const { api, owner, uuid } = ownerFixture(); await owner.open(); await owner.browse(); owner.select(citation(0).id, true);
  const gate = deferred<SourceCommit>(); api.write.mockImplementationOnce(() => gate.promise);
  const first = owner.save(), pending = owner.state.pending!; expect(Object.isFrozen(pending)).toBe(true); expect(Object.isFrozen(pending.sourceIds)).toBe(true);
  expect(await owner.save()).toBe(false); expect(owner.select(citation(1).id, true)).toBe(false); expect(owner.close()).toBe(false);
  expect(owner.departure()).toEqual({ kind: "uncertain", actions: ["stay", "abandon"], saveMayComplete: true });
  gate.reject(new Error("discarded-invented-error")); expect(await first).toBe(false); expect(owner.state.phase).toBe("unknown");
  expect(await owner.reconcile()).toBe(false); expect(owner.state.pending).toBe(pending); expect(owner.state.phase).toBe("unknown"); expect(api.write).toHaveBeenCalledTimes(1);
  expect(await owner.retryExact()).toBe(true); expect(api.write.mock.calls[1][0]).toBe(pending); expect(api.receipt.mock.calls[0][0]).toBe(pending); expect(uuid).toHaveBeenCalledTimes(1); owner.dispose();
});

test("review abandoning an in-flight save permits departure without claiming rollback or adopting its late commit", async () => {
  const { api, owner } = ownerFixture(true, { currentVersion: 1, citations: [citation(0)] }); await owner.open(); owner.select(citation(0).id, false);
  const gate = deferred<SourceCommit>(); api.write.mockImplementationOnce(() => gate.promise); const saving = owner.save();
  expect(owner.abandon()).toEqual({ abandoned: true, saveMayComplete: true }); expect(api.write.mock.calls[0][1].aborted).toBe(true); expect(owner.departure().kind).toBe("none");
  gate.resolve({ outcome: "committed", committedVersion: 2, currentLatestVersion: 2, committed: { version: 2, citations: [], createdAt: "2026-10-17T12:00:00.000Z" } });
  expect(await saving).toBe(false); expect(owner.state).toMatchObject({ phase: "disposed", current: null, pending: null, lastCommit: null, open: false });
});

test("review raced original receipt keeps its committed snapshot distinct from a newer current version", async () => {
  const { api, owner } = ownerFixture(); await owner.open(); await owner.browse(); owner.select(citation(0).id, true); api.write.mockRejectedValueOnce(new Error("discarded")); await owner.save();
  api.receipt.mockResolvedValueOnce({ outcome: "committed", committedVersion: 1, currentLatestVersion: 3, committed: { version: 1, citations: [citation(0)], createdAt: "2026-10-17T12:00:00.000Z" } });
  expect(await owner.reconcile()).toBe(true); expect(owner.state).toMatchObject({ phase: "refresh-required", current: null, pending: null, lastCommit: { committedVersion: 1, currentLatestVersion: 3 } });
  expect(owner.select(citation(1).id, true)).toBe(false); expect(await owner.save()).toBe(false); expect(api.read).toHaveBeenCalledTimes(1);
  api.read.mockResolvedValueOnce({ currentVersion: 3, citations: [citation(1)] }); await owner.load(); expect(owner.state.current).toMatchObject({ currentVersion: 3, citations: [citation(1)] }); owner.dispose();
});

test("review conflict cannot silently rebase and catalog review preserves a draft while clearing addition proof", async () => {
  const { api, owner, uuid } = ownerFixture(); await owner.open(); await owner.browse(); owner.select(citation(0).id, true);
  api.write.mockRejectedValueOnce(new SourceClientError(409, "conflict", true)); await owner.save();
  expect(owner.state).toMatchObject({ phase: "conflict", draftIds: [citation(0).id], pending: null }); expect(await owner.save()).toBe(false); expect(uuid).toHaveBeenCalledTimes(1);
  await owner.discardAndReload(); await owner.browse(); owner.select(citation(1).id, true); expect(owner.reviewCatalog()).toBe(true); expect(owner.state.draftIds).toEqual([citation(1).id]);
  expect(await owner.save()).toBe(false); expect(api.write).toHaveBeenCalledTimes(1); owner.dispose();
});

test("review actual authority denial disposes while a replaced or abandoned late read cannot restore state", async () => {
  const { api, owner } = ownerFixture(); const staleRead = deferred<CurrentSources>(); api.read.mockImplementationOnce(() => staleRead.promise);
  const opening = owner.open(); owner.authorityLost(); staleRead.resolve({ currentVersion: 99, citations: [citation(0)] }); expect(await opening).toBe(false); expect(owner.state.current).toBeNull();
  const second = ownerFixture(); second.api.read.mockRejectedValueOnce(new SourceClientError(404)); await second.owner.open(); expect(second.owner.state.phase).toBe("disposed"); expect(await second.owner.open()).toBe(false);
});

test("review malformed 503 conflict remains unknown rather than retiring an ambiguous write intent", async () => {
  const b = base(), client = createSourceAssignmentClient({ baseline: b, kind: "torah", offset: 0 });
  vi.stubGlobal("fetch", vi.fn(async (url: string, options?: RequestInit) => options?.method === "POST" ? response({ ok: false, code: "conflict" }, 503) : response(url.includes("study-sources") ? page() : current())));
  const owner = createSourceSelection({ scopeKey: "strict-error-protocol", canEdit: true, api: client, newMutationId: () => mutationId });
  await owner.open(); await owner.browse(); owner.select(citation(0).id, true); await owner.save(); expect(owner.state.phase).toBe("unknown"); expect(owner.state.pending?.mutationId).toBe(mutationId); owner.dispose();
});

test("review wrong-binding successful write response stays unconfirmed rather than becoming a definite stale rejection", async () => {
  const client = createSourceAssignmentClient({ baseline: base(), kind: "torah", offset: 0 });
  vi.stubGlobal("fetch", vi.fn(async (url: string, options?: RequestInit) => options?.method === "POST" ? response({ ...committed(), studentRevision: 4 }) : response(url.includes("study-sources") ? page() : current())));
  const owner = createSourceSelection({ scopeKey: "wrong-write-envelope", canEdit: true, api: client, newMutationId: () => mutationId });
  await owner.open(); await owner.browse(); owner.select(citation(0).id, true); await owner.save(); expect(owner.state.phase).toBe("unknown"); expect(owner.state.pending?.mutationId).toBe(mutationId); owner.dispose();
});

test("review an uncertain original is not disproved by a later definite retry refusal", async () => {
  const { api, owner, uuid } = ownerFixture(); await owner.open(); await owner.browse(); owner.select(citation(0).id, true);
  api.write.mockRejectedValueOnce(new Error("discarded")); await owner.save(); const pending = owner.state.pending;
  api.write.mockRejectedValueOnce(new SourceClientError(409, "conflict", true)); expect(await owner.retryExact()).toBe(false);
  expect(owner.state.phase).toBe("unknown"); expect(owner.state.pending).toBe(pending); expect(await owner.save()).toBe(false); expect(uuid).toHaveBeenCalledTimes(1); owner.dispose();
});

test("review known child-context expiry clears previously loaded private state before another fetch", async () => {
  vi.useFakeTimers(); const b = base("child-practice"), client = createSourceAssignmentClient({ baseline: b, kind: "torah", offset: 0, selection: { handle: "h".repeat(43), context: { ...b.context! } } });
  const fetcher = vi.fn(async () => response(current(b, 1, [citation(0)]))); vi.stubGlobal("fetch", fetcher);
  const owner = createSourceSelection({ scopeKey: "child-expiry", canEdit: false, api: client }); await owner.open(); expect(owner.state.current?.citations).toHaveLength(1);
  vi.setSystemTime(new Date(Date.parse(b.context!.expiresAt) + 1)); await owner.load(); expect(fetcher).toHaveBeenCalledTimes(1); expect(owner.state).toMatchObject({ phase: "disposed", current: null, page: null, draftIds: [], open: false });
});

test("review intent parsing refuses accessors and private metadata without invoking or retaining them", () => {
  const getter = vi.fn(() => [citation(0).id]), value = { ...intent() }; Object.defineProperty(value, "sourceIds", { enumerable: true, get: getter });
  expect(() => captureSourceIntent(value, ref)).toThrow(); expect(getter).not.toHaveBeenCalled();
  expect(() => captureSourceIntent({ ...intent(), actorUserId: "discarded" }, ref)).toThrow();
  const parsed = captureSourceIntent({ ...intent([citation(1).id, citation(0).id]) }, ref); expect(parsed.sourceIds).toEqual([citation(0).id, citation(1).id]); expect(Object.isFrozen(parsed.sourceIds)).toBe(true);
});

test("review empty-read ceiling and initial idle deadline refuse promptly and cancel late resources", async () => {
  const client = createSourceAssignmentClient({ baseline: base(), kind: "torah", offset: 0 }), canceled = vi.fn();
  vi.stubGlobal("fetch", vi.fn(async () => new Response(new ReadableStream({ start(controller) { for (let n = 0; n < 65; n++) controller.enqueue(new Uint8Array()); }, cancel: canceled }), { headers: { "content-type": "application/json" } })));
  await expect(client.read(new AbortController().signal)).rejects.toBeDefined(); expect(canceled).toHaveBeenCalledTimes(1);
  vi.useFakeTimers(); const gate = deferred<Response>(), lateCanceled = vi.fn(); vi.stubGlobal("fetch", vi.fn(() => gate.promise));
  const pending = client.read(new AbortController().signal), rejected = expect(pending).rejects.toBeDefined(); await vi.advanceTimersByTimeAsync(5001); await rejected;
  gate.resolve(new Response(new ReadableStream({ cancel: lateCanceled }), { headers: { "content-type": "application/json" } })); await flush(); expect(lateCanceled).toHaveBeenCalledTimes(1);
});
