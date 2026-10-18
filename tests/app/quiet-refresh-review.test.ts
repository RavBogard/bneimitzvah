import { afterEach, expect, it, vi } from "vitest";
import type { Assigned } from "../../src/components/portal/workspace/api";
import { PortalRequestError } from "../../src/components/portal/api";
import { createQuietRefresh, quietReadingAuthority } from "../../src/components/portal/workspace/quiet-refresh";
import { WorkCoordinator, type WorkTransport } from "../../src/components/portal/workspace/work/coordinator";
import type { WorkPage, WorkReceipt, WorkVersion } from "../../src/components/portal/workspace/work/api";

const id = "10000000-0000-4000-8000-000000000001", assignmentId = "10000000-0000-4000-8000-000000000002", ref = "Genesis 1:1";
const baseline: Assigned = { mode: "student", student: { id, firstName: "Synthetic", lastName: "Review", ceremonyDate: "2027-01-02", revision: 1 }, context: null,
  readings: [{ id: assignmentId, kind: "torah", revision: 1, ranges: [ref], verses: [ref], needsReview: false, aliyahStarts: null, basis: "custom", confirmationDate: null,
    source: { status: "unknown", fetchedAt: null, date: null, calendar: null, attribution: null } }] };
const revised = (): Assigned => ({ ...baseline, readings: [{ ...baseline.readings[0], revision: 2 }] });
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
async function flush() { for (let i = 0; i < 24; i++) await Promise.resolve(); }
function page(head: WorkVersion | null = null): WorkPage { return { authorityBinding: "a".repeat(43), offset: 0, totalVerses: 1, nextOffset: null, verses: [{ ref, draft: head, notes: [] }] }; }
const denied = (error: unknown) => error instanceof PortalRequestError && [401, 403, 404].includes(error.status);
const owned: WorkCoordinator[] = [];
async function coordinator(transport: WorkTransport) {
  const work = new WorkCoordinator(transport, async () => baseline, vi.fn()); owned.push(work);
  work.configure(baseline); await work.reload(new AbortController().signal, "torah"); work.accept(work.lifecycle); work.reveal(); return work;
}
afterEach(() => { for (const work of owned.splice(0)) work.dispose(); vi.useRealTimers(); });

it("metadata reconciliation reaches actual revision recovery without erasing an unsent draft or issuing a write", async () => {
  vi.useFakeTimers(); const transport = vi.fn<WorkTransport>(async () => page()), work = await coordinator(transport);
  work.edit("torah", ref, "draft", "Synthetic unsent revision text"); const completed = deferred<void>();
  const quiet = createQuietRefresh({ capture: () => "same principal/student/context", denied,
    verify: async () => false,
    changed: reason => {
      expect(reason).toBe("metadata"); work.pause();
      // Exercise the production coordinator's existing blocking reload contract.
      void (async () => { await work.settle(); work.configure(revised(), true); await work.reload(new AbortController().signal, "torah"); work.accept(work.lifecycle); work.reveal(); completed.resolve(); })().catch(completed.reject);
    } });
  quiet.request(); await completed.promise;
  expect(work.cell("torah", ref, "draft")).toMatchObject({ text: "Synthetic unsent revision text", phase: "revision", revisionRecovery: { originalRevision: 1, outcome: "unsaved" } });
  expect(work.hasUnsaved()).toBe(true);
  await work.save("torah", ref, "draft"); await vi.advanceTimersByTimeAsync(3000);
  expect(transport.mock.calls.every(([, , operation]) => operation.type === "page")).toBe(true);
  quiet.cancel();
});

it("a save already dispatched retains its acknowledgement while metadata reconciliation waits and preserves newer typing", async () => {
  vi.useFakeTimers(); const receipt = deferred<WorkReceipt>(), entered = deferred<void>(), completed = deferred<void>(); let head: WorkVersion | null = null;
  const transport = vi.fn<WorkTransport>(async (_baseline, _kind, operation) => operation.type === "page" ? page(head) : receipt.promise);
  const work = await coordinator(transport);
  work.edit("torah", ref, "draft", "Synthetic dispatched body"); const save = work.save("torah", ref, "draft");
  const pending = work.cell("torah", ref, "draft")!.pending!;
  work.edit("torah", ref, "draft", "Synthetic newer unsent body");
  const quiet = createQuietRefresh({ capture: () => "same scope", verify: async () => false, denied, changed: reason => {
    expect(reason).toBe("metadata"); work.pause(); entered.resolve();
    void (async () => { await work.settle(); work.configure(revised(), true); await work.reload(new AbortController().signal, "torah"); work.accept(work.lifecycle); work.reveal(); completed.resolve(); })().catch(completed.reject);
  } });
  quiet.request(); await entered.promise;
  expect(work.cell("torah", ref, "draft")!.pending).toBe(pending);
  head = { id, verseRef: ref, version: 1, text: pending.text, assignmentId, assignmentRevision: 1,
    author: { membershipId: id, displayName: "Portal member", mode: "student", assisted: false }, createdAt: "2026-10-16T10:00:00.000Z" };
  receipt.resolve({ committedVersion: 1, currentLatestVersion: 1, committed: head });
  await save; await completed.promise;
  const cell = work.cell("torah", ref, "draft")!;
  expect(cell).toMatchObject({ text: "Synthetic newer unsent body", head: { text: pending.text }, phase: "revision", revisionRecovery: { outcome: "unsaved" } });
  expect(cell.pending).toBeUndefined(); await vi.advanceTimersByTimeAsync(3000);
  expect(transport.mock.calls.filter(([, , operation]) => operation.type !== "page")).toHaveLength(1);
  quiet.cancel();
});

it.each([401, 403, 404])("actual authority denial %s clears real private coordinator cells instead of revision recovery", async status => {
  vi.useFakeTimers(); const work = await coordinator(async () => page()); work.edit("torah", ref, "draft", "Synthetic private draft");
  const reasons: string[] = [], quiet = createQuietRefresh({ capture: () => "current scope", verify: async () => { throw new PortalRequestError(status); }, denied,
    changed: reason => { reasons.push(reason); work.clear(); } });
  quiet.request(); await flush();
  expect(reasons).toEqual(["authority"]); expect(work.scope("torah")).toBeUndefined(); expect(work.hasUnsaved()).toBe(false); quiet.cancel();
});

it.each([409, 503])("a replaced request or unavailable check %s cannot clear or reconfigure private work", async status => {
  vi.useFakeTimers(); const work = await coordinator(async () => page()); work.edit("torah", ref, "draft", "Synthetic retained draft");
  const cell = work.cell("torah", ref, "draft"), lifecycle = work.lifecycle, changed = vi.fn();
  const quiet = createQuietRefresh({ capture: () => "current scope", verify: async () => { throw new PortalRequestError(status); }, denied, changed });
  quiet.request(); await flush();
  expect(changed).not.toHaveBeenCalled(); expect(work.cell("torah", ref, "draft")).toBe(cell); expect(work.lifecycle).toBe(lifecycle); quiet.cancel();
});

it("old completion cannot release a replacement's in-flight coalescing fence or reconcile the old metadata", async () => {
  const first = deferred<boolean>(), second = deferred<boolean>(), third = deferred<boolean>(); let snapshot = "first";
  const verify = vi.fn().mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise).mockImplementationOnce(() => third.promise), changed = vi.fn();
  const quiet = createQuietRefresh({ capture: () => snapshot, verify, denied, changed });
  quiet.request(); await flush(); quiet.cancel(); snapshot = "replacement"; quiet.request(); await flush();
  first.resolve(false); await flush(); quiet.request(); await flush();
  expect(verify).toHaveBeenCalledTimes(2); expect(changed).not.toHaveBeenCalled();
  second.reject(new PortalRequestError(404)); await flush(); expect(changed).toHaveBeenCalledExactlyOnceWith("authority");
  quiet.request(); await flush(); expect(verify).toHaveBeenCalledTimes(3); third.resolve(true); await flush(); quiet.cancel();
});

it.each(["false", "denial"])("a non-aborted old %s after route/context replacement cannot affect its successor", async result => {
  let snapshot = "old principal/context"; const gate = deferred<boolean>(), changed = vi.fn();
  const quiet = createQuietRefresh({ capture: () => snapshot, verify: () => gate.promise, denied, changed });
  quiet.request(); await flush(); snapshot = "new principal/context";
  if (result === "false") gate.resolve(false); else gate.reject(new PortalRequestError(401));
  await flush(); expect(changed).not.toHaveBeenCalled(); quiet.cancel();
});

it("complete child authority includes expiry and revisions while assignment/source-only changes remain metadata", () => {
  const child: Assigned = { ...baseline, mode: "child-practice", context: { id: assignmentId, authorityRevision: 7, studentId: id, studentRevision: 1, expiresAt: "2026-10-18T00:00:00.000Z" } };
  const before = JSON.stringify(child), authority = quietReadingAuthority(child);
  const metadataOnly: Assigned = { ...child, readings: [{ ...child.readings[0], revision: 2, needsReview: true }] };
  expect(quietReadingAuthority(metadataOnly)).toBe(authority);
  for (const next of [
    { ...child, mode: "parent" as const }, { ...child, student: { ...child.student, id: assignmentId } },
    { ...child, student: { ...child.student, revision: 2 } }, { ...child, context: null },
    ...Object.keys(child.context!).map(key => ({ ...child, context: { ...child.context!, [key]: typeof child.context![key as keyof NonNullable<Assigned["context"]>] === "number" ? 9 : "changed" } })),
  ]) expect(quietReadingAuthority(next)).not.toBe(authority);
  expect(JSON.stringify(child)).toBe(before);
});
