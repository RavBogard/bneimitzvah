import { afterEach, expect, test, vi } from "vitest";
import type { Assigned } from "../../src/components/portal/workspace/api";
import { createShortReferencePageOwner, type ShortReferenceOwnerBinding } from "../../src/components/portal/workspace/study/short-reference-owner";
import { parseShortReferencePageData, type ShortReferencePage } from "../../src/components/portal/workspace/study/short-reference-api";
const id = "10000000-0000-4000-8000-000000000001", assignmentId = "10000000-0000-4000-8000-000000000002";
function binding(): ShortReferenceOwnerBinding {
  const baseline: Assigned = { student: { id, revision: 2, firstName: "Synthetic", lastName: "Reference", ceremonyDate: "2027-01-02" }, mode: "parent", context: null,
    readings: [{ id: assignmentId, kind: "torah", revision: 4, ranges: ["Genesis 1:1-3"], verses: ["Genesis 1:1", "Genesis 1:2", "Genesis 1:3"], needsReview: false, aliyahStarts: null, basis: "custom", confirmationDate: null,
      source: { status: "unknown", fetchedAt: null, date: null, calendar: null, attribution: null } }] };
  return { baseline, kind: "torah", offset: 0, sessionBinding: "s".repeat(43), epoch: 1 };
}
function page(b = binding()) { return parseShortReferencePageData({ offset: b.offset, nextOffset: null, totalVerses: 3,
  references: b.baseline.readings[0].verses.slice(b.offset).map(ref => ({ schema: "reference-resolution/short-v1", source: null, verse: { schema: "reference-verse/v1", ref,
    playback: { status: "unavailable", reason: "asset-not-approved" }, words: { status: "unavailable", reason: "no-playback" } } })) }, b.baseline, b.kind, b.offset); }
function deferred<T>() { let resolve!: (v: T) => void, reject!: (e: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const signal = () => new AbortController().signal;
afterEach(() => vi.useRealTimers());

test("construction does not fetch; explicit prepare shares one pending and completed page with selections", async () => {
  const b = binding(), gate = deferred<ShortReferencePage>(), load = vi.fn(() => gate.promise), owner = createShortReferencePageOwner({ load, live: () => true });
  owner.configure(b); expect(load).not.toHaveBeenCalled(); const first = owner.prepare(), second = owner.load(2, signal()); await Promise.resolve(); expect(load).toHaveBeenCalledOnce();
  gate.resolve(page(b)); expect((await first).references).toHaveLength(3); expect((await second).verse.ref).toBe("Genesis 1:3");
  expect((await owner.load(0, signal())).verse.ref).toBe("Genesis 1:1"); expect(load).toHaveBeenCalledOnce(); owner.dispose();
});

test("one subscriber cancellation neither aborts owned fetch nor poisons other subscribers or the cache", async () => {
  const gate = deferred<ShortReferencePage>(); let owned!: AbortSignal; const load = vi.fn((_b, _k, _o, s: AbortSignal) => { owned = s; return gate.promise; });
  const owner = createShortReferencePageOwner({ load, live: () => true }); owner.configure(binding()); const a = new AbortController(), first = owner.load(0, a.signal), second = owner.load(1, signal());
  const refused = expect(first).rejects.toMatchObject({ status: 409 }); await Promise.resolve(); a.abort(); await refused; expect(owned.aborted).toBe(false);
  gate.resolve(page()); expect((await second).verse.ref).toBe("Genesis 1:2"); await owner.prepare(); expect(load).toHaveBeenCalledOnce(); owner.dispose();
});

test("clear/suspend/dispose immediately reject waiters and late nonabortable successes cannot revive data", async () => {
  for (const action of ["clear", "suspend", "dispose"] as const) {
    const gate = deferred<ShortReferencePage>(), load = vi.fn(() => gate.promise), owner = createShortReferencePageOwner({ load, live: () => true }); owner.configure(binding());
    const waiting = owner.prepare(), refused = expect(waiting).rejects.toMatchObject({ status: 409 }); await Promise.resolve(); owner[action](); await refused; gate.resolve(page()); await Promise.resolve();
    await expect(owner.load(0, signal())).rejects.toMatchObject({ status: 409 }); if (action === "dispose") expect(() => owner.configure(binding())).toThrow(); else { owner.configure(binding()); await owner.prepare(); expect(load).toHaveBeenCalledTimes(2); }
    owner.dispose();
  }
});

test("failed fetch retries, and stale old failure cannot evict the newly configured success", async () => {
  const old = deferred<ShortReferencePage>(), load = vi.fn(async () => page()); load.mockRejectedValueOnce(new Error("Synthetic failure"));
  const owner = createShortReferencePageOwner({ load, live: () => true }); owner.configure(binding()); await expect(owner.prepare()).rejects.toThrow(); await owner.prepare(); expect(load).toHaveBeenCalledTimes(2);
  owner.clear(); owner.configure(binding()); load.mockImplementationOnce(() => old.promise); const previous = owner.prepare(), refused = expect(previous).rejects.toMatchObject({ status: 409 }); await Promise.resolve();
  owner.configure({ ...binding(), epoch: 2 }); await refused; await owner.prepare(); old.reject(new Error("Synthetic late failure")); await Promise.resolve(); const count = load.mock.calls.length; await owner.prepare(); expect(load).toHaveBeenCalledTimes(count); owner.dispose();
});

test("every session/epoch/page/assignment/child binding change invalidates and captured inputs cannot be mutated", async () => {
  const load = vi.fn(async (b: Assigned, kind: "torah" | "haftarah", offset: number) => page({ ...binding(), baseline: b, kind, offset }));
  const owner = createShortReferencePageOwner({ load, live: () => true }), b = binding(); owner.configure(b); b.baseline.student.revision = 99; await owner.prepare(); expect(load.mock.calls[0][0].student.revision).toBe(2); expect(Object.isFrozen(load.mock.calls[0][0])).toBe(true);
  let previous = binding();
  for (const changed of [{ ...binding(), sessionBinding: "t".repeat(43) }, { ...binding(), epoch: 2 }, { ...binding(), offset: 1 }, (() => { const v = binding(); v.baseline.readings[0].revision++; return v; })()]) {
    owner.configure(changed); const before = load.mock.calls.length; await owner.prepare(); expect(load).toHaveBeenCalledTimes(before + 1); previous = changed;
  }
  expect(owner.configure(previous)).toBe(false); const before = load.mock.calls.length; await owner.prepare(); expect(load).toHaveBeenCalledTimes(before); owner.dispose();
});

test("live lifecycle denial and exact child expiry refuse cached and late results without fabricated session TTL", async () => {
  let active = true; const load = vi.fn(async () => page()), owner = createShortReferencePageOwner({ load, live: () => active }); owner.configure(binding()); await owner.prepare(); active = false;
  await expect(owner.load(0, signal())).rejects.toMatchObject({ status: 409 }); active = true; await expect(owner.prepare()).rejects.toMatchObject({ status: 409 });
  vi.useFakeTimers(); const b = binding(); b.baseline.mode = "child-practice"; b.baseline.context = { id: assignmentId, studentId: id, studentRevision: 2, authorityRevision: 3, expiresAt: new Date(Date.now() + 1000).toISOString() };
  owner.configure({ ...b, selection: { handle: "h".repeat(43), context: { ...b.baseline.context } } }); await owner.prepare(); await vi.advanceTimersByTimeAsync(1001); await expect(owner.prepare()).rejects.toMatchObject({ status: 409 }); owner.dispose();
});

test("changing private child handle or authority revision cannot reuse a prior selected page", async () => {
  const b = binding(); b.baseline.mode = "child-practice"; b.baseline.context = { id: assignmentId, studentId: id, studentRevision: 2, authorityRevision: 3, expiresAt: new Date(Date.now() + 60000).toISOString() };
  const first = { ...b, selection: { handle: "h".repeat(43), context: { ...b.baseline.context } } }, load = vi.fn(async () => page()), owner = createShortReferencePageOwner({ load, live: () => true });
  owner.configure(first); await owner.prepare(); owner.configure({ ...first, selection: { ...first.selection, handle: "j".repeat(43) } }); await owner.prepare(); expect(load).toHaveBeenCalledTimes(2);
  const changed = structuredClone(first); changed.baseline.context!.authorityRevision++; changed.selection.context.authorityRevision++;
  owner.configure(changed); await owner.prepare(); expect(load).toHaveBeenCalledTimes(3); owner.dispose();
});

test("invalid page/ref/index and already aborted subscribers never enter the completed cache", async () => {
  const load = vi.fn(async (): Promise<ShortReferencePage> => ({ ...page(), references: page().references.toReversed() })); const owner = createShortReferencePageOwner({ load, live: () => true }); owner.configure(binding());
  for (const index of [-1, 3, 1.2]) await expect(owner.load(index, signal())).rejects.toThrow(); const abort = new AbortController(); abort.abort(); await expect(owner.prepare(abort.signal)).rejects.toThrow(); expect(load).not.toHaveBeenCalled();
  await expect(owner.prepare()).rejects.toThrow(); load.mockResolvedValueOnce(page()); await owner.prepare(); expect(load).toHaveBeenCalledTimes(2); owner.dispose();
});
