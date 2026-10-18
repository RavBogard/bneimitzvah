import { expect, test, vi } from "vitest";
import type { Assigned } from "../../src/components/portal/workspace/api";
import { PortalRequestError } from "../../src/components/portal/api";
import { createShortReferenceBridge } from "../../src/components/portal/workspace/study/short-reference-bridge";
import { parseShortReferencePageData, type ShortReferencePage } from "../../src/components/portal/workspace/study/short-reference-api";
const id = "10000000-0000-4000-8000-000000000001", assignmentId = "10000000-0000-4000-8000-000000000002";
function fixture() {
  const baseline: Assigned = { student: { id, revision: 2, firstName: "Synthetic", lastName: "Bridge", ceremonyDate: "2027-01-02" }, mode: "child-practice",
    context: { id: assignmentId, studentId: id, studentRevision: 2, authorityRevision: 3, expiresAt: new Date(Date.now() + 60000).toISOString() },
    readings: [{ id: assignmentId, kind: "torah", revision: 4, ranges: ["Genesis 1:1-3"], verses: ["Genesis 1:1", "Genesis 1:2", "Genesis 1:3"], needsReview: false, aliyahStarts: null, basis: "custom", confirmationDate: null,
      source: { status: "unknown", fetchedAt: null, date: null, calendar: null, attribution: null } }] };
  const binding = { baseline, kind: "torah" as const, offset: 0, sessionBinding: "s".repeat(43), epoch: 2, selection: { handle: "h".repeat(43), context: { ...baseline.context! } } };
  const page = parseShortReferencePageData({ offset: 0, nextOffset: null, totalVerses: 3, references: baseline.readings[0].verses.map(ref => ({ schema: "reference-resolution/short-v1", source: null,
    verse: { schema: "reference-verse/v1", ref, playback: { status: "unavailable", reason: "asset-not-approved" }, words: { status: "unavailable", reason: "no-playback" } } })) }, baseline, "torah", 0);
  return { binding, page };
}
function gate<T>() { let resolve!: (value: T) => void, reject!: (e: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const signal = () => new AbortController().signal;

test("view receives only four methods and one prepared page serves adjacent selections without repeated reads", async () => {
  const f = fixture(), read = vi.fn(async () => f.page), bridge = createShortReferenceBridge({ binding: f.binding, live: () => true, viewLive: () => true, read });
  expect(Object.keys(bridge).sort()).toEqual(["dispose", "load", "prepare", "suspend"]); expect(JSON.stringify(bridge)).not.toContain(f.binding.selection.handle); expect(read).not.toHaveBeenCalled();
  expect(await bridge.prepare()).toBeUndefined(); expect((await bridge.load(0, signal())).verse.ref).toBe("Genesis 1:1"); await bridge.load(2, signal()); expect(read).toHaveBeenCalledOnce();
  expect(read.mock.calls[0]).toHaveLength(5); bridge.dispose();
});

test("viewLive cannot grant absent provider authority, including completed cache delivery", async () => {
  const f = fixture(), read = vi.fn(async () => f.page); let provider = false, visible = true;
  const bridge = createShortReferenceBridge({ binding: f.binding, live: () => provider, viewLive: () => visible, read });
  await expect(bridge.prepare()).rejects.toMatchObject({ status: 409 }); expect(read).not.toHaveBeenCalled(); provider = true; await bridge.prepare();
  visible = false; await expect(bridge.load(0, signal())).rejects.toMatchObject({ status: 409 }); visible = true; await bridge.load(0, signal()); expect(read).toHaveBeenCalledTimes(2);
  provider = false; await expect(bridge.load(0, signal())).rejects.toMatchObject({ status: 409 }); expect(read).toHaveBeenCalledTimes(2); bridge.dispose();
});

test("suspend then unchanged foreground re-arms fresh metadata without replacing the captured text scope", async () => {
  const f = fixture(), baseline = f.binding.baseline, read = vi.fn(async () => f.page); let visible = true;
  const bridge = createShortReferenceBridge({ binding: f.binding, live: () => true, viewLive: () => visible, read }); await bridge.prepare(); visible = false; bridge.suspend();
  await expect(bridge.prepare()).rejects.toMatchObject({ status: 409 }); visible = true; await bridge.load(1, signal()); expect(read).toHaveBeenCalledTimes(2);
  expect(f.binding.baseline).toBe(baseline); expect(baseline.readings[0].verses).toHaveLength(3); bridge.dispose();
});

test("selection cancellation cannot abort shared metadata needed by a newer selection", async () => {
  const f = fixture(), pending = gate<ShortReferencePage>(); let owned!: AbortSignal;
  const read = vi.fn((_b, _k, _o, s: AbortSignal) => { owned = s; return pending.promise; }), bridge = createShortReferenceBridge({ binding: f.binding, live: () => true, viewLive: () => true, read });
  const a = new AbortController(), first = bridge.load(0, a.signal), refused = expect(first).rejects.toMatchObject({ status: 409 }), second = bridge.load(2, signal());
  await Promise.resolve(); a.abort(); await refused; expect(owned.aborted).toBe(false); pending.resolve(f.page); expect((await second).verse.ref).toBe("Genesis 1:3"); expect(read).toHaveBeenCalledOnce(); bridge.dispose();
});

test("quiet registration is a per-fetch fence, not permanent identity: changed in-flight work refuses, next explicit request can succeed", async () => {
  const f = fixture(), pending = gate<void>(); let quietRevision = 0;
  // This is the trusted read-callback fence, not mocked session verification.
  // Production provider supplies actual serviceRead and its real session calls.
  const read = vi.fn(async () => { const captured = quietRevision; if (read.mock.calls.length === 1) await pending.promise; if (captured !== quietRevision) throw new PortalRequestError(409); return f.page; });
  const bridge = createShortReferenceBridge({ binding: f.binding, live: () => true, viewLive: () => true, read });
  const first = bridge.prepare(), refused = expect(first).rejects.toMatchObject({ status: 409 }); await Promise.resolve(); quietRevision++; pending.resolve(); await refused;
  await bridge.prepare(); expect(read).toHaveBeenCalledTimes(2); quietRevision++; await bridge.load(1, signal()); expect(read).toHaveBeenCalledTimes(2); bridge.dispose();
});

test("late old scope work cannot deliver or clear a later re-armed page; dispose cannot re-arm", async () => {
  const f = fixture(), pending = gate<ShortReferencePage>(), read = vi.fn(async () => f.page); read.mockImplementationOnce(() => pending.promise);
  const bridge = createShortReferenceBridge({ binding: f.binding, live: () => true, viewLive: () => true, read }); const old = bridge.prepare(), refused = expect(old).rejects.toMatchObject({ status: 409 });
  await Promise.resolve(); bridge.suspend(); await refused; await bridge.prepare(); pending.reject(new Error("Synthetic old rejection")); await Promise.resolve(); await bridge.load(0, signal()); expect(read).toHaveBeenCalledTimes(2);
  bridge.dispose(); await expect(bridge.prepare()).rejects.toMatchObject({ status: 409 }); await expect(bridge.load(0, signal())).rejects.toMatchObject({ status: 409 });
});
