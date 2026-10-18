import { afterEach, expect, it, vi } from "vitest";
import { PortalRequestError } from "../../src/components/portal/api";
import type { Assigned, ReadingMode, Selection } from "../../src/components/portal/workspace/api";
import { captureSourceIntent, createSourceAssignmentClient, parseSourceCitations, SourceClientError, SOURCE_CLIENT_LIMITS, type CurrentSources, type SourceAssignmentClient, type SourceCommit, type SourceIntent, type SourcePage } from "../../src/components/portal/workspace/study/sources/api";
import { createSourceSelection } from "../../src/components/portal/workspace/study/sources/selection";

const id = "10000000-0000-4000-8000-000000000001", assignmentId = "10000000-0000-4000-8000-000000000002", contextId = "10000000-0000-4000-8000-000000000003", mutationId = "10000000-0000-4000-8000-000000000004", H = "a".repeat(64), ref = "Genesis 1:2";
function baseline(mode: ReadingMode = "admin"): Assigned { return { mode, student: { id, revision: 2, firstName: "Synthetic", lastName: "Sources", ceremonyDate: "2027-01-02" }, context: mode === "child-practice" ? { id: contextId, studentId: id, studentRevision: 2, authorityRevision: 3, expiresAt: new Date(Date.now() + 60_000).toISOString() } : null,
  readings: [{ id: assignmentId, kind: "torah", revision: 4, ranges: ["Genesis 1:1-2"], verses: ["Genesis 1:1", ref], needsReview: false, aliyahStarts: null, basis: "custom", confirmationDate: "2027-01-02", source: { status: "unknown", fetchedAt: null, date: null, calendar: null, attribution: null } }] }; }
const citation = (n: number) => Object.freeze({ id: `source_${String(n).padStart(4, "0")}`, ref: `Invented Work ${n}`, indexTitle: "Invented Work", category: "Commentary", labels: Object.freeze({ en: "Invented title", he: null }) });
function env(base: Assigned = baseline()) { return { studentId: id, studentRevision: 2, mode: base.mode, context: base.context, assignment: { id: assignmentId, revision: 4, kind: "torah", needsReview: false } }; }
const current = (base = baseline(), version = 0, entries = [] as ReturnType<typeof citation>[]) => ({ ok: true, ...env(base), verseRef: ref, currentVersion: version, citations: entries });
function page(offset = 0, count = 21, catalogHash = H): SourcePage { const end = Math.min(offset + 10, count); return Object.freeze({ schema: "study-related-page/v1", ref, catalogHash, sourceOffset: offset, pageSize: 10, totalEntries: count, receivedRows: count, heldCount: 0, duplicateCount: 0,
  nextSourceOffset: end < count ? end : null, entries: Object.freeze(Array.from({ length: end - offset }, (_, i) => citation(offset + i))) }); }
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
const held = <T,>() => { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const intent = (ids = [citation(0).id], expectedVersion = 0): SourceIntent => ({ verseRef: ref, expectedVersion, mutationId, sourceIds: ids, catalogHash: H });
const committed = (write: SourceIntent, latest = write.expectedVersion + 1): SourceCommit => Object.freeze({ outcome: "committed", committedVersion: write.expectedVersion + 1, currentLatestVersion: latest,
  committed: Object.freeze({ version: write.expectedVersion + 1, citations: Object.freeze(write.sourceIds.map(value => citation(Number(value.slice(7))))), createdAt: "2026-10-17T00:00:00.000Z" }) });
const commitEnvelope = (write: SourceIntent, receipt = false, latest?: number) => { const value = committed(write, latest); return { ok: true, ...env(), verseRef: ref, ...(receipt ? { outcome: "committed" } : { replayed: false }), committedVersion: value.committedVersion, currentLatestVersion: value.currentLatestVersion, committed: value.committed }; };
function transport(overrides: Partial<SourceAssignmentClient> = {}): SourceAssignmentClient { return { ref, canEdit: true, read: vi.fn(async (): Promise<CurrentSources> => Object.freeze({ currentVersion: 0, citations: Object.freeze([]) })),
  discover: vi.fn(async paging => page(paging.sourceOffset)), write: vi.fn(async write => committed(write)), receipt: vi.fn(async () => ({ outcome: "unconfirmed" as const })), ...overrides }; }
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("captures the actual assigned offset and all reader modes, exposing no context handle in URLs", async () => {
  for (const mode of ["admin", "tutor", "student", "parent", "child-practice"] as const) {
    const base = baseline(mode), selection: Selection | undefined = base.context ? { handle: "h".repeat(43), context: { ...base.context } } : undefined;
    const fetcher = vi.fn(async () => response(current(base))); vi.stubGlobal("fetch", fetcher);
    const client = createSourceAssignmentClient({ baseline: base, kind: "torah", offset: 1, selection }); expect(fetcher).not.toHaveBeenCalled();
    expect(await client.read(new AbortController().signal)).toEqual({ currentVersion: 0, citations: [] });
    const [url, options] = fetcher.mock.calls[0] as unknown as [string, RequestInit]; expect(url).toContain("verseRef=Genesis+1%3A2"); expect(url).not.toContain("hhhh");
    expect(options).toMatchObject({ credentials: "same-origin", redirect: "error", referrerPolicy: "no-referrer", cache: "no-store" });
    expect(new Headers(options.headers).get("X-Practice-Context")).toBe(selection?.handle ?? null);
    if (!client.canEdit) await expect(client.write(intent(), new AbortController().signal)).rejects.toMatchObject({ status: 403 }); expect(fetcher).toHaveBeenCalledTimes(1);
  }
});
it("snapshots original bindings before await and rejects stale, foreign or extra envelopes without re-targeting", async () => {
  const base = baseline(), gate = held<Response>(), entered = held<void>(); vi.stubGlobal("fetch", vi.fn(() => { entered.resolve(); return gate.promise; }));
  const client = createSourceAssignmentClient({ baseline: base, kind: "torah", offset: 1 }); const task = client.read(new AbortController().signal); await entered.promise;
  base.student.revision++; base.readings[0].verses[1] = "Genesis 1:1"; gate.resolve(response(current())); expect(await task).toMatchObject({ currentVersion: 0 });
  for (const altered of [{ ...current(), verseRef: "Genesis 1:1" }, { ...current(), studentRevision: 3 }, { ...current(), assignment: { ...env().assignment, revision: 5 } }, { ...current(), text: "not metadata" }]) {
    vi.stubGlobal("fetch", vi.fn(async () => response(altered))); await expect(client.read(new AbortController().signal)).rejects.toBeInstanceOf(PortalRequestError);
  }
  const invalid = baseline(); invalid.readings[0].verses.reverse(); expect(() => createSourceAssignmentClient({ baseline: invalid, kind: "torah", offset: 0 })).toThrow();
});
it("enforces closed copied plain citation leaves, sorted identities, exact count/page shape and catalog hash", async () => {
  const item = { ...citation(0), labels: { en: "Invented", he: null } }, parsed = parseSourceCitations([item]); item.labels.en = "Changed"; expect(parsed[0].labels.en).toBe("Invented"); expect(Object.isFrozen(parsed[0].labels)).toBe(true);
  const getter = vi.fn(); expect(() => parseSourceCitations([{ ...citation(0), get ref() { getter(); return "x"; } }])).toThrow(); expect(getter).not.toHaveBeenCalled();
  for (const entries of [[citation(0), citation(0)], [{ ...citation(0), ref: "<b>unsafe</b>" }], [{ ...citation(0), labels: { en: "\u202eunsafe", he: null } }], [{ ...citation(0), ref: "é".repeat(257) }]]) expect(() => parseSourceCitations(entries)).toThrow();
  const client = createSourceAssignmentClient({ baseline: baseline(), kind: "torah", offset: 1 });
  vi.stubGlobal("fetch", vi.fn(async () => response({ ...env(), sources: page() }))); expect(await client.discover({ sourceOffset: 0 }, new AbortController().signal)).toEqual(page());
  for (const bad of [{ ...page(), receivedRows: 22 }, { ...page(), nextSourceOffset: null }, { ...page(), entries: [citation(0)] }]) {
    vi.stubGlobal("fetch", vi.fn(async () => response({ ...env(), sources: bad }))); await expect(client.discover({ sourceOffset: 0 }, new AbortController().signal)).rejects.toMatchObject({ status: 503 });
  }
  vi.stubGlobal("fetch", vi.fn(async () => response({ ...env(), sources: page(10, 21, "b".repeat(64)) })));
  await expect(client.discover({ sourceOffset: 10, catalogHash: H }, new AbortController().signal)).rejects.toMatchObject({ code: "source-catalog-changed" });
});
it("freezes sorted complete write intent and validates original committed ids/version and closed receipts", async () => {
  const client = createSourceAssignmentClient({ baseline: baseline(), kind: "torah", offset: 1 }), write = { ...intent([citation(2).id, citation(0).id]), sourceIds: [citation(2).id, citation(0).id] };
  const gate = held<Response>(), entered = held<void>(), fetcher = vi.fn((_url: string, _options?: RequestInit) => { entered.resolve(); return gate.promise; }); vi.stubGlobal("fetch", fetcher);
  const work = client.write(write, new AbortController().signal); await entered.promise; write.sourceIds.length = 0; write.expectedVersion = 99;
  const sent = JSON.parse(String(fetcher.mock.calls[0][1]?.body)); expect(sent.sourceIds).toEqual([citation(0).id, citation(2).id]); expect(sent.expectedVersion).toBe(0); expect(sent.mutationId).toBe(mutationId);
  gate.resolve(response(commitEnvelope(intent([citation(0).id, citation(2).id])))); expect((await work).committedVersion).toBe(1);
  vi.stubGlobal("fetch", vi.fn(async () => response({ ok: true, ...env(), verseRef: ref, outcome: "unconfirmed" }))); expect(await client.receipt(intent(), new AbortController().signal)).toEqual({ outcome: "unconfirmed" });
  vi.stubGlobal("fetch", vi.fn(async () => response(commitEnvelope(intent([citation(1).id]), true)))); await expect(client.receipt(intent(), new AbortController().signal)).rejects.toMatchObject({ status: 503 });
  expect(() => captureSourceIntent({ ...intent(), sourceIds: Array.from({ length: 33 }, (_, n) => citation(n).id) }, ref)).toThrow();
});
it("bounds actual bytes/UTF8/empty progress and cancels refused or unauthorized response bodies", async () => {
  const client = createSourceAssignmentClient({ baseline: baseline(), kind: "torah", offset: 1 });
  const oversizeCancel = vi.fn(); vi.stubGlobal("fetch", vi.fn(async () => new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array(SOURCE_CLIENT_LIMITS.assignmentBytes + 1)); }, cancel: oversizeCancel }), { headers: { "content-type": "application/json", "content-length": "1" } })));
  await expect(client.read(new AbortController().signal)).rejects.toMatchObject({ status: 503 }); expect(oversizeCancel).toHaveBeenCalledOnce();
  vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array([0xff]), { headers: { "content-type": "application/json" } })));
  await expect(client.read(new AbortController().signal)).rejects.toMatchObject({ status: 503 });
  const cancel = vi.fn(); vi.stubGlobal("fetch", vi.fn(async () => new Response(new ReadableStream({ pull(c) { c.enqueue(new Uint8Array()); }, cancel }), { headers: { "content-type": "application/json" } })));
  await expect(client.read(new AbortController().signal)).rejects.toMatchObject({ status: 503 }); expect(cancel).toHaveBeenCalledOnce();
  const denied = vi.fn(); vi.stubGlobal("fetch", vi.fn(async () => new Response(new ReadableStream({ cancel: denied }), { status: 401 })));
  await expect(client.read(new AbortController().signal)).rejects.toMatchObject({ status: 401 }); expect(denied).toHaveBeenCalledOnce();
});
it("enforces initial/settlement deadlines and aborts pending/late bodies without awaiting cleanup", async () => {
  const client = createSourceAssignmentClient({ baseline: baseline(), kind: "torah", offset: 1 });
  let now = 0; vi.spyOn(performance, "now").mockImplementation(() => now); const lateCancel = vi.fn(() => new Promise<void>(() => {}));
  vi.stubGlobal("fetch", vi.fn(async () => { now = 15001; return new Response(new ReadableStream({ cancel: lateCancel }), { headers: { "content-type": "application/json" } }); }));
  await expect(client.read(new AbortController().signal)).rejects.toMatchObject({ status: 503 }); expect(lateCancel).toHaveBeenCalledOnce();
  now = 0; const gate = held<Response>(), entered = held<void>(), cancelled = held<void>(); vi.stubGlobal("fetch", vi.fn(() => { entered.resolve(); return gate.promise; }));
  const abort = new AbortController(), task = client.read(abort.signal); const rejected = expect(task).rejects.toMatchObject({ status: 409 }); await entered.promise; abort.abort(); await rejected;
  gate.resolve(new Response(new ReadableStream({ cancel() { cancelled.resolve(); } }), { headers: { "content-type": "application/json" } })); await cancelled.promise;
});
it("allows every authorized reader to browse while edit methods dispatch no mutations", async () => {
  const api = transport({ canEdit: false }), owner = createSourceSelection({ scopeKey: "reader", canEdit: false, api }); expect(api.read).not.toHaveBeenCalled();
  expect(await owner.open()).toBe(true); expect(await owner.browse()).toBe(true); expect(await owner.nextPage()).toBe(true); expect(owner.state.page?.sourceOffset).toBe(10);
  expect(owner.select(citation(0).id, true)).toBe(false); expect(await owner.save()).toBe(false); expect(await owner.reconcile()).toBe(false); expect(await owner.retryExact()).toBe(false); expect(api.write).not.toHaveBeenCalled(); expect(api.receipt).not.toHaveBeenCalled();
});
it("keeps draft local with explicit departure review and supports removal-only without discovery", async () => {
  const api = transport({ read: vi.fn(async () => ({ currentVersion: 1, citations: Object.freeze([citation(0), citation(1)]) })) }), uuid = vi.fn(() => mutationId);
  const owner = createSourceSelection({ scopeKey: "staff", canEdit: true, api, newMutationId: uuid }); await owner.open(); owner.select(citation(0).id, false);
  expect(api.write).not.toHaveBeenCalled(); expect(owner.departure()).toEqual({ kind: "dirty", actions: ["keep-editing", "discard"] }); expect(owner.close()).toBe(false); expect(await owner.load()).toBe(false);
  expect(await owner.save()).toBe(true); expect(api.discover).not.toHaveBeenCalled(); expect(api.write).toHaveBeenCalledWith({ verseRef: ref, expectedVersion: 1, mutationId, sourceIds: [citation(1).id] }, expect.any(AbortSignal)); expect(uuid).toHaveBeenCalledOnce(); expect(owner.state.dirty).toBe(false);
});
it("retains one exact unknown intent through unconfirmed reconciliation and explicit same-id retry", async () => {
  const api = transport({ write: vi.fn().mockRejectedValueOnce(new SourceClientError()).mockImplementation(async write => committed(write)) }), uuid = vi.fn(() => mutationId);
  const owner = createSourceSelection({ scopeKey: "staff", canEdit: true, api, newMutationId: uuid }); await owner.open(); await owner.browse(); owner.select(citation(0).id, true); await owner.save();
  const original = owner.state.pending; expect(original).not.toBeNull(); expect(Object.isFrozen(original?.sourceIds)).toBe(true); expect(owner.state.phase).toBe("unknown"); expect(owner.departure()).toMatchObject({ kind: "uncertain", saveMayComplete: true });
  expect(owner.close()).toBe(false); expect(await owner.discardAndReload()).toBe(false); expect(await owner.save()).toBe(false); expect(await owner.reconcile()).toBe(false); expect(owner.state.pending).toBe(original);
  expect(await owner.retryExact()).toBe(true); expect(uuid).toHaveBeenCalledOnce(); expect(api.write).toHaveBeenCalledTimes(2); expect(vi.mocked(api.write).mock.calls[1][0]).toBe(original); expect(vi.mocked(api.receipt).mock.calls[0][0]).toBe(original); expect(owner.state.phase).toBe("ready");
});
it("separates an original committed result from a newer current head and requires a fresh read before editing", async () => {
  const api = transport({ write: vi.fn(async write => committed(write, 3)), read: vi.fn().mockResolvedValueOnce({ currentVersion: 0, citations: [] }).mockResolvedValueOnce({ currentVersion: 3, citations: [citation(2)] }) });
  const owner = createSourceSelection({ scopeKey: "staff", canEdit: true, api, newMutationId: () => mutationId }); await owner.open(); await owner.browse(); owner.select(citation(0).id, true); await owner.save();
  expect(owner.state.phase).toBe("refresh-required"); expect(owner.state.current).toBeNull(); expect(owner.state.lastCommit?.committedVersion).toBe(1); expect(owner.state.lastCommit?.currentLatestVersion).toBe(3); expect(owner.select(citation(1).id, true)).toBe(false); expect(api.read).toHaveBeenCalledTimes(1);
  await owner.load(); expect(owner.state.current?.currentVersion).toBe(3); expect(owner.state.draftIds).toEqual([citation(2).id]);
});
it("cannot retire prior uncertainty on a mismatched status/code or a later definite retry conflict", async () => {
  const client = createSourceAssignmentClient({ baseline: baseline(), kind: "torah", offset: 1 });
  vi.stubGlobal("fetch", vi.fn(async () => response({ ok: false, code: "conflict" }, 503)));
  await expect(client.write(intent(), new AbortController().signal)).rejects.toMatchObject({ status: 503, code: "unavailable" });
  const api = transport({ write: vi.fn().mockRejectedValueOnce(new SourceClientError()).mockRejectedValueOnce(new SourceClientError(409, "conflict", true)), receipt: vi.fn(async () => { throw new SourceClientError(409, "conflict", true); }) });
  const owner = createSourceSelection({ scopeKey: "staff", canEdit: true, api, newMutationId: () => mutationId }); await owner.open(); await owner.browse(); owner.select(citation(0).id, true); await owner.save(); const original = owner.state.pending;
  await owner.reconcile(); expect(owner.state.pending).toBe(original); expect(owner.state.phase).toBe("unknown"); await owner.retryExact(); expect(owner.state.pending).toBe(original); expect(owner.departure()).toMatchObject({ kind: "uncertain", saveMayComplete: true }); expect(await owner.discardAndReload()).toBe(false);
  vi.stubGlobal("fetch", vi.fn(async (path: string, options?: RequestInit) => options?.method === "POST" ? response({ ...commitEnvelope(intent()), studentRevision: 3 }) : path.includes("study-sources") ? response({ ...env(), sources: page() }) : response(current())));
  const integrated = createSourceSelection({ scopeKey: "actual-client", canEdit: true, api: client, newMutationId: () => mutationId });
  await integrated.open(); await integrated.browse(); integrated.select(citation(0).id, true); await integrated.save();
  expect(integrated.state.phase).toBe("unknown"); expect(integrated.state.pending?.mutationId).toBe(mutationId); expect(integrated.state.pending?.sourceIds).toEqual([citation(0).id]); expect(integrated.departure()).toMatchObject({ kind: "uncertain", saveMayComplete: true });
});
it("holds conflicts and catalog drift without replacing draft, allowing only explicit review/discard", async () => {
  const api = transport({ discover: vi.fn().mockResolvedValueOnce(page()).mockRejectedValueOnce(new SourceClientError(409, "source-catalog-changed")).mockResolvedValueOnce(page(0, 21, "b".repeat(64))), write: vi.fn(async () => { throw new SourceClientError(409, "conflict", true); }) });
  const owner = createSourceSelection({ scopeKey: "staff", canEdit: true, api, newMutationId: () => mutationId }); await owner.open(); await owner.browse(); owner.select(citation(0).id, true); await owner.nextPage();
  expect(owner.state.catalogChanged).toBe(true); expect(owner.state.draftIds).toEqual([citation(0).id]); expect(await owner.save()).toBe(false); expect(owner.reviewCatalog()).toBe(true); expect(owner.state.draftIds).toEqual([citation(0).id]); expect(await owner.save()).toBe(false);
  await owner.browse(); await owner.save(); expect(owner.state.phase).toBe("conflict"); expect(owner.state.draftIds).toEqual([citation(0).id]); expect(await owner.save()).toBe(false); await owner.discardAndReload(); expect(owner.state.draftIds).toEqual([]); expect(owner.state.phase).toBe("ready");
});
it("enforces the full32 selected-set cap across same-catalog pages, never just the visible page", async () => {
  const api = transport({ discover: vi.fn(async p => page(p.sourceOffset, 40)) }), owner = createSourceSelection({ scopeKey: "staff", canEdit: true, api, newMutationId: () => mutationId }); await owner.open(); await owner.browse();
  for (let n = 0; n < 40; n++) { if (n > 0 && n % 10 === 0) await owner.nextPage(); expect(owner.select(citation(n).id, true)).toBe(n < 32); }
  expect(owner.state.draftIds).toHaveLength(32); await owner.save(); expect(vi.mocked(api.write).mock.calls[0][0].sourceIds).toHaveLength(32); expect(vi.mocked(api.discover).mock.calls.slice(1).every(call => call[0].catalogHash === H)).toBe(true);
});
it("fences abandoned in-flight saves and late denial, clears private state, and never claims a rollback", async () => {
  const gate = held<SourceCommit>(), entered = held<void>(), api = transport({ write: vi.fn(write => { entered.resolve(); return gate.promise; }) }), owner = createSourceSelection({ scopeKey: "old", canEdit: true, api, newMutationId: () => mutationId });
  await owner.open(); await owner.browse(); owner.select(citation(0).id, true); const save = owner.save(); await entered.promise; const original = owner.state.pending!;
  expect(owner.abandon()).toEqual({ abandoned: true, saveMayComplete: true }); expect(owner.state.phase).toBe("disposed"); expect(owner.state.current).toBeNull();
  const replacement = createSourceSelection({ scopeKey: "new", canEdit: true, api: transport() }); await replacement.open(); gate.resolve(committed(original)); expect(await save).toBe(false); expect(owner.state.lastCommit).toBeNull(); expect(replacement.state.phase).toBe("ready");
  const readGate = held<CurrentSources>(), staleOwner = createSourceSelection({ scopeKey: "stale", canEdit: true, api: transport({ read: vi.fn(() => readGate.promise) }) }); const read = staleOwner.open(); staleOwner.authorityLost(); readGate.reject(new PortalRequestError(403)); expect(await read).toBe(false); expect(replacement.state.phase).toBe("ready");
});
