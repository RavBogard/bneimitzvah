import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { PortalRequestError } from "../../src/components/portal/api";
import { createShortExplorationOwner, type ShortExplorationBinding } from "../../src/components/portal/workspace/study/short-exploration-owner";
import { parseShortExplorationPage } from "../../src/components/portal/workspace/study/short-exploration-api";
import type { ShortReferencePage } from "../../src/components/portal/workspace/study/short-reference-api";
import { explorationBaseline, explorationPrepared, explorationPage } from "./exploration-client-helper";
function gate<T>() { let resolve!: (v: T) => void, reject!: (e: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function fixture() { const baseline = explorationBaseline(), prepared = explorationPrepared(), page = explorationPage(); const binding: ShortExplorationBinding = { baseline, prepared, page, sessionBinding: "s".repeat(43), epoch: 1 };
  const value = parseShortExplorationPage({ studentId: baseline.student.id, studentRevision: 1, mode: baseline.mode, kind: "torah", expiresAt: prepared.expiresAt, page: { offset: 0, nextOffset: 100, totalVerses: 146, references: page.verses.map(v => ({ schema: "reference-resolution/short-v1", source: null, verse: { schema: "reference-verse/v1", ref: v.ref, playback: { status: "unavailable", reason: "asset-not-approved" }, words: { status: "unavailable", reason: "no-playback" } } })) } }, baseline, prepared, page);
  return { binding, value }; }
const signal = () => new AbortController().signal;
afterEach(() => vi.useRealTimers());

test("four-method facade shares one pending and completed100-ref batch across prepare/verse requests", async () => {
  const f = fixture(), pending = gate<ShortReferencePage>(), read = vi.fn(async () => pending.promise), owner = createShortExplorationOwner({ binding: f.binding, live: () => true, read });
  expect(Object.keys(owner).sort()).toEqual(["dispose", "load", "prepare", "suspend"]); const prepared = owner.prepare(), first = owner.load(0, signal()), last = owner.load(99, signal()); pending.resolve(f.value); await prepared; expect((await first).verse.ref).toBe("Genesis 1:1"); expect((await last).verse.ref).toBe("Genesis 4:20"); await owner.load(1, signal()); expect(read).toHaveBeenCalledOnce(); owner.dispose();
});
test("subscriber cancellation never revokes shared owner while newer verse waits", async () => {
  const f = fixture(), pending = gate<ShortReferencePage>(); let owned!: AbortSignal; const read = vi.fn<Parameters<typeof createShortExplorationOwner>[0]["read"]>((_b, _p, _page, s) => { owned = s; return pending.promise; });
  const owner = createShortExplorationOwner({ binding: f.binding, live: () => true, read }), abort = new AbortController(), first = owner.load(0, abort.signal), denied = expect(first).rejects.toMatchObject({ status: 409 }), next = owner.load(1, signal()); await Promise.resolve(); abort.abort(); await denied; expect(owned.aborted).toBe(false); pending.resolve(f.value); await next; expect(read).toHaveBeenCalledOnce(); owner.dispose();
});
test("suspend immediately refuses late ignoring-abort work and explicit rearm uses fresh batch", async () => {
  const f = fixture(), pending = gate<ShortReferencePage>(), read = vi.fn(async () => pending.promise), owner = createShortExplorationOwner({ binding: f.binding, live: () => true, read });
  const old = owner.load(0, signal()), denied = expect(old).rejects.toMatchObject({ status: 409 }); await Promise.resolve(); owner.suspend(); await denied; read.mockImplementationOnce(async () => f.value); await owner.load(1, signal()); pending.resolve(f.value); await Promise.resolve(); await owner.load(2, signal()); expect(read).toHaveBeenCalledTimes(2); owner.dispose();
});
test("current failures evict; an old failure cannot discard successful newer owner", async () => {
  const f = fixture(), old = gate<ShortReferencePage>(), read = vi.fn(async () => old.promise), owner = createShortExplorationOwner({ binding: f.binding, live: () => true, read });
  const first = owner.prepare(), denied = expect(first).rejects.toMatchObject({ status: 409 }); await Promise.resolve(); owner.suspend(); await denied; read.mockResolvedValue(f.value); await owner.prepare(); old.reject(new PortalRequestError(503)); await Promise.resolve(); await owner.load(0, signal()); expect(read).toHaveBeenCalledTimes(2); owner.suspend(); read.mockRejectedValueOnce(new PortalRequestError(401)); await expect(owner.prepare()).rejects.toMatchObject({ status: 401 }); await owner.prepare(); expect(read).toHaveBeenCalledTimes(4); owner.dispose();
});
test("provider/view/session live check denies cached delivery and permits explicit unchanged quiet return", async () => {
  const f = fixture(), read = vi.fn(async () => f.value); let live = true; const owner = createShortExplorationOwner({ binding: f.binding, live: () => live, read }); await owner.prepare(); live = false; await expect(owner.load(0, signal())).rejects.toMatchObject({ status: 409 }); live = true; await owner.prepare(); expect(read).toHaveBeenCalledTimes(2); owner.dispose();
});
test("real claim deadline aborts pending subscribers immediately without replacement or renewal", async () => {
  vi.useFakeTimers(); const f = fixture(); f.binding.prepared.expiresAt = Date.now() + 100; const pending = gate<ShortReferencePage>(), read = vi.fn(async () => pending.promise), owner = createShortExplorationOwner({ binding: f.binding, live: () => true, read }); const first = owner.load(0, signal()), denied = expect(first).rejects.toMatchObject({ status: 409 }); await vi.advanceTimersByTimeAsync(101); await denied; await expect(owner.prepare()).rejects.toMatchObject({ status: 409 }); expect(read).toHaveBeenCalledOnce(); pending.resolve(f.value); owner.dispose();
});
test("caller mutation cannot alter detached expected scope; bad page never becomes cached", async () => {
  const f = fixture(), read = vi.fn<Parameters<typeof createShortExplorationOwner>[0]["read"]>(async () => ({ ...f.value, references: f.value.references.toReversed() })), owner = createShortExplorationOwner({ binding: f.binding, live: () => true, read }); f.binding.prepared.binding = "mutated"; f.binding.baseline.student.revision = 9; f.binding.page.verses.reverse(); await expect(owner.prepare()).rejects.toMatchObject({ status: 409 }); read.mockImplementationOnce(async () => f.value); await owner.prepare(); expect(read.mock.calls[0][0].student.revision).toBe(1); expect(read.mock.calls[0][1].binding).not.toBe("mutated"); expect(read.mock.calls[0][2].verses[0].ref).toBe("Genesis 1:1"); expect(read).toHaveBeenCalledTimes(2); owner.dispose();
});
test("per-fetch quiet revision refusal is retriable; later registration alone does not revoke a completed batch", async () => {
  const f = fixture(), pending = gate<void>(); let quiet = 0, calls = 0; const read = vi.fn(async () => { const captured = quiet; if (++calls === 1) await pending.promise; if (captured !== quiet) throw new PortalRequestError(409); return f.value; }); const owner = createShortExplorationOwner({ binding: f.binding, live: () => true, read }); const first = owner.prepare(), denied = expect(first).rejects.toMatchObject({ status: 409 }); await Promise.resolve(); quiet++; pending.resolve(); await denied; await owner.prepare(); quiet++; await owner.load(1, signal()); expect(read).toHaveBeenCalledTimes(2); owner.dispose();
});

function childFixture() {
  const f = fixture(), context = { id: "10000000-0000-4000-8000-000000000002", studentId: f.binding.baseline.student.id, studentRevision: 1, authorityRevision: 3, expiresAt: new Date(Date.now() + 100).toISOString() };
  f.binding.baseline.mode = "child-practice"; f.binding.baseline.context = context; f.binding.prepared.mode = "child-practice";
  return { ...f, binding: { ...f.binding, selection: { handle: "h".repeat(43), context: { ...context } } } };
}
test("cached child's earlier deadline aborts the owned read and denies all cache reuse on first expired attempt", async () => {
  vi.useFakeTimers(); const f = childFixture(); let owned!: AbortSignal;
  const read = vi.fn<Parameters<typeof createShortExplorationOwner>[0]["read"]>(async (_b, _p, _page, signal) => { owned = signal; return f.value; });
  const owner = createShortExplorationOwner({ binding: f.binding, live: () => true, read });
  try { await owner.prepare(); expect(owned.aborted).toBe(false); await vi.advanceTimersByTimeAsync(101); expect(f.binding.prepared.expiresAt).toBeGreaterThan(Date.now());
    await expect(owner.load(0, signal())).rejects.toMatchObject({ status: 409 }); expect(owned.aborted).toBe(true);
    await expect(owner.prepare()).rejects.toMatchObject({ status: 409 }); await expect(owner.load(1, signal())).rejects.toMatchObject({ status: 409 }); expect(read).toHaveBeenCalledOnce();
  } finally { owner.dispose(); }
});
test("pending child's earlier expiry aborts old owner immediately and late ignoring-abort metadata cannot deliver", async () => {
  vi.useFakeTimers(); const f = childFixture(), pending = gate<ShortReferencePage>(); let owned!: AbortSignal;
  const read = vi.fn<Parameters<typeof createShortExplorationOwner>[0]["read"]>((_b, _p, _page, signal) => { owned = signal; return pending.promise; });
  const owner = createShortExplorationOwner({ binding: f.binding, live: () => true, read });
  try { const old = owner.load(0, signal()), denied = expect(old).rejects.toMatchObject({ status: 409 }); await Promise.resolve(); await vi.advanceTimersByTimeAsync(101);
    expect(f.binding.prepared.expiresAt).toBeGreaterThan(Date.now()); await expect(owner.prepare()).rejects.toMatchObject({ status: 409 }); expect(owned.aborted).toBe(true); await denied;
    pending.resolve(f.value); await Promise.resolve(); await expect(owner.load(0, signal())).rejects.toMatchObject({ status: 409 }); expect(read).toHaveBeenCalledOnce();
  } finally { owner.dispose(); }
});
