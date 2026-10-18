import { createHash } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { PortalRequestError } from "../../src/components/portal/api";
import { createHonorsClient, parseHonorsRead, type HonorsClient } from "../../src/components/portal/workspace/honors/api";
import { emptyHonors } from "../../src/components/portal/workspace/honors/draft";
import { createHonorsOwner } from "../../src/components/portal/workspace/honors/owner";
import type { HonorsContext, HonorsContextView, HonorsRead } from "../../src/lib/honors/types";

const studentId = "20000000-0000-4000-8000-000000000001";
const mutationId = "20000000-0000-4000-8000-000000000002";
const personId = "20000000-0000-4000-8000-000000000003";
function context(date = "2027-01-02"): HonorsContextView {
  const snapshot: HonorsContext = { schemaVersion: 1, tenantId: "crc", studentId, ceremonyDate: date, serviceSlot: "unknown", torah: null };
  return { hash: createHash("sha256").update(JSON.stringify(snapshot)).digest("hex"), snapshot, spans: [], status: "unassigned", unknownSlot: true, readingNeedsReview: false };
}
const read = (): HonorsRead => ({ ok: true, studentId, currentVersion: 0, currentContext: context(), saved: null, needsReview: false });
const response = () => new Response(JSON.stringify(read()), { headers: { "Content-Type": "application/json" } });
const held = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("caps a never-settling session proof and never sends the private request afterward", async () => {
  vi.useFakeTimers(); const proof = held<void>(), fetcher = vi.fn(async () => response()), denied = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  const client = createHonorsClient({ studentId, mode: "parent", verify: () => proof.promise, denied });
  const result = client.read(new AbortController().signal).catch(error => error);
  await vi.advanceTimersByTimeAsync(15000); expect(await result).toMatchObject({ status: 503 });
  proof.resolve(); await Promise.resolve(); expect(fetcher).not.toHaveBeenCalled(); expect(denied).not.toHaveBeenCalled();
});

it("caps a silent response body even when the initial response headers succeeded", async () => {
  vi.useFakeTimers(); const cancelled = vi.fn(), denied = vi.fn();
  vi.stubGlobal("fetch", vi.fn(async () => new Response(new ReadableStream({ cancel: cancelled }), { headers: { "Content-Type": "application/json" } })));
  const client = createHonorsClient({ studentId, mode: "admin", verify: async () => {}, denied });
  const result = client.read(new AbortController().signal).catch(error => error);
  await vi.advanceTimersByTimeAsync(5000); expect(await result).toMatchObject({ status: 503 }); expect(cancelled).toHaveBeenCalledTimes(1); expect(denied).not.toHaveBeenCalled();
});

it("cannot publish private data when the final session proof is canceled", async () => {
  const proof = held<void>(), verify = vi.fn().mockResolvedValueOnce(undefined).mockReturnValueOnce(proof.promise), denied = vi.fn();
  vi.stubGlobal("fetch", vi.fn(async () => response()));
  const client = createHonorsClient({ studentId, mode: "parent", verify, denied }), controller = new AbortController();
  const result = client.read(controller.signal).catch(error => error);
  await vi.waitFor(() => expect(verify).toHaveBeenCalledTimes(2)); controller.abort(); proof.resolve();
  expect(await result).toMatchObject({ status: 503 }); expect(denied).not.toHaveBeenCalled();
});

it("rejects cross-tenant saved context even when both independent hashes are valid", async () => {
  const previous = context(), snapshot = { ...previous.snapshot, tenantId: "synthetic-other" }, foreign = { ...previous, snapshot, hash: createHash("sha256").update(JSON.stringify(snapshot)).digest("hex") };
  await expect(parseHonorsRead({ ...read(), currentVersion: 1, saved: { version: 1, form: emptyHonors(), reviewedContext: foreign, createdAt: "2026-10-18T00:00:00.000Z" }, needsReview: true }, studentId)).rejects.toBeDefined();
});

it("clears an uncertain original intent on live receipt denial, including every private draft value", async () => {
  const api: HonorsClient = { read: async () => read(), write: async () => { throw Error("Synthetic response loss"); }, receipt: async () => { throw new PortalRequestError(403); } };
  const owner = createHonorsOwner(api, () => {}, () => mutationId); await owner.load();
  owner.edit({ ...emptyHonors(), openingArk: [{ id: personId, englishName: "Synthetic Private Name" }] });
  await owner.save(); expect(owner.state.pending?.mutationId).toBe(mutationId); await owner.check();
  expect(owner.state.phase).toBe("disposed"); expect(owner.state.pending).toBeNull(); expect(owner.state.current).toBeNull(); expect(owner.state.draft).toEqual(emptyHonors()); expect(owner.hasUnsaved()).toBe(false);
});

it("blocks another save, receipt, discard and edits while an explicit retry is pending", async () => {
  const gate = held<never>(), write = vi.fn().mockRejectedValueOnce(Error("Synthetic response loss")).mockReturnValueOnce(gate.promise), receipt = vi.fn();
  const api: HonorsClient = { read: async () => read(), write, receipt }, owner = createHonorsOwner(api, () => {}, () => mutationId); await owner.load();
  owner.edit({ ...emptyHonors(), openingArk: [{ id: personId, englishName: "Synthetic Pending Retry" }] });
  await owner.save(); const original = owner.state.pending, retry = owner.retry();
  expect(owner.busy()).toBe(true); expect(await owner.save()).toBe(false); expect(await owner.check()).toBe(false); expect(await owner.discard()).toBe(false); expect(owner.edit(emptyHonors())).toBe(false); expect(owner.state.pending).toBe(original); expect(receipt).not.toHaveBeenCalled();
  owner.clear(); gate.resolve(undefined as never); await retry; expect(owner.state.phase).toBe("disposed"); expect(write).toHaveBeenCalledTimes(2);
});
