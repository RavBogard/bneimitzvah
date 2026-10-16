import { describe, expect, it } from "vitest";
import { PracticeCoordinator } from "../../src/components/portal/workspace/practice";
import { PortalRequestError } from "../../src/components/portal/api";
import type { Selection } from "../../src/components/portal/workspace/api";

const a = "10000000-0000-4000-8000-000000000001", b = "10000000-0000-4000-8000-000000000002";
const selection = (studentId = a, handle = "a".repeat(43)): Selection => ({ handle, context: { id: studentId, studentId, studentRevision: 1, authorityRevision: 1, expiresAt: new Date(Date.now() + 60_000).toISOString() } });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }

describe("tab-local practice mutation coordination", () => {
  it("serializes overlapping selection and exit attempts without issuing another mutation", async () => {
    const pending = deferred<Selection>(); let enters = 0, exits = 0;
    const coordinator = new PracticeCoordinator({ enter: () => { enters++; return pending.promise; }, switch: async () => selection(b), exit: async () => { exits++; return { contextId: a }; } });
    const first = coordinator.select(a);
    await expect(coordinator.select(b)).rejects.toMatchObject({ status: 409 }); await expect(coordinator.exit()).rejects.toMatchObject({ status: 409 });
    expect(enters === 1 && exits === 0 && coordinator.pending && coordinator.selection === null).toBe(true);
    pending.resolve(selection()); await first; expect(coordinator.selection?.context.studentId).toBe(a);
  });

  it("switches only its prior tab handle and clears the prior view before receiving the next handle", async () => {
    const pending = deferred<Selection>(), calls: string[] = [];
    const coordinator = new PracticeCoordinator({ enter: async () => selection(), switch: async (_id, handle) => { calls.push(handle); return pending.promise; }, exit: async handle => { calls.push(handle); return { contextId: b }; } });
    await coordinator.select(a); const before = coordinator.generation;
    const switching = coordinator.select(b);
    expect(coordinator.selection === null && coordinator.generation > before).toBe(true);
    pending.resolve(selection(b, "b".repeat(43))); await switching; await coordinator.exit();
    expect(calls).toEqual(["a".repeat(43), "b".repeat(43)]); expect(coordinator.selection).toBe(null);
  });

  it("keeps independent tabs independent, including contexts for the same child", async () => {
    const closed: string[] = [];
    function tab(handle: string) { return new PracticeCoordinator({ enter: async () => selection(a, handle), switch: async id => selection(id, "c".repeat(43)), exit: async value => { closed.push(value); return { contextId: a }; } }); }
    const first = tab("a".repeat(43)), second = tab("b".repeat(43));
    await first.select(a); await second.select(a); await first.exit();
    expect(closed).toEqual(["a".repeat(43)]); expect(second.selection?.handle === "b".repeat(43)).toBe(true);
  });

  it("never restores or automatically retries a selection after a lost switch response", async () => {
    const calls: string[] = []; let entered = 0;
    const coordinator = new PracticeCoordinator({ enter: async id => { entered++; calls.push("enter"); return selection(id); }, switch: async () => { calls.push("switch"); throw new PortalRequestError(503); }, exit: async () => { calls.push("exit"); return { contextId: a }; } });
    await coordinator.select(a); await expect(coordinator.select(b)).rejects.toMatchObject({ status: 503 });
    expect(coordinator.selection).toBe(null); expect(calls).toEqual(["enter", "switch"]);
    await coordinator.select(b); expect(entered).toBe(2); expect(calls).toEqual(["enter", "switch", "exit", "enter"]);
  });

  it("cleans up an acknowledged late handle after navigation invalidated the pending selection", async () => {
    const pending = deferred<Selection>(), closed: string[] = [];
    const coordinator = new PracticeCoordinator({ enter: () => pending.promise, switch: async () => selection(b), exit: async handle => { closed.push(handle); return { contextId: a }; } });
    const command = coordinator.select(a); coordinator.invalidate(); pending.resolve(selection());
    expect(await command).toBe(null); expect(coordinator.selection).toBe(null); expect(closed).toEqual(["a".repeat(43)]);
  });

  it("invalidates generations during lifecycle revalidation without restoring invalidated authority", async () => {
    const coordinator = new PracticeCoordinator({ enter: async () => selection(), switch: async () => selection(b), exit: async () => ({ contextId: a }) });
    await coordinator.select(a); const before = coordinator.generation; coordinator.pause();
    expect(coordinator.generation > before && coordinator.selection?.context.studentId === a).toBe(true);
    coordinator.invalidate(); expect(coordinator.selection).toBe(null); await coordinator.exit(); expect(coordinator.selection).toBe(null);
  });

  it("allows exact cleanup after expiry/revocation and fails closed for a mismatching closure result", async () => {
    for (const status of [401, 404]) {
      const coordinator = new PracticeCoordinator({ enter: async () => selection(), switch: async () => selection(b), exit: async () => { throw new PortalRequestError(status); } });
      await coordinator.select(a); await expect(coordinator.exit()).resolves.toBeUndefined(); expect(coordinator.selection).toBe(null);
    }
    const coordinator = new PracticeCoordinator({ enter: async () => selection(), switch: async () => selection(b), exit: async () => ({ contextId: b }) });
    await coordinator.select(a); await expect(coordinator.exit()).rejects.toMatchObject({ status: 503 }); expect(coordinator.selection).toBe(null);
  });
});
