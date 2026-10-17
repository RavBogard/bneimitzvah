import { expect, test, vi } from "vitest";
vi.mock("../../src/components/portal/workspace/provider", () => ({ statusOf: (error: { status?: number } | null) => error?.status ?? 503 }));
import type { Assigned } from "../../src/components/portal/workspace/api";
import { ProgressError, type ProgressOperation, type ProgressRows, type ProgressSaved } from "../../src/components/portal/workspace/progress/api";
import { ProgressStore } from "../../src/components/portal/workspace/progress/store";

const ref = "Genesis 1:1", otherRef = "Genesis 1:2";
const baseline = (): Assigned => ({ mode: "student", context: null, student: { id: "10000000-0000-4000-8000-000000000001", firstName: "Synthetic", lastName: "Learner", ceremonyDate: "2027-01-02", revision: 1 }, readings: [{ id: "10000000-0000-4000-8000-000000000002", kind: "torah", revision: 1, ranges: ["Genesis 1:1-2"], verses: [ref, otherRef], needsReview: false, aliyahStarts: [], source: { status: "unknown", fetchedAt: null, date: null, calendar: null, attribution: null }, confirmationDate: null, basis: "custom" }] });
const page = (saved = false): ProgressRows => ({ offset: 0, nextOffset: null, verses: [{ verseRef: ref, selfCheck: { state: saved ? "got-it" : "unmarked", version: saved ? 1 : 0 }, assessment: { state: "not-started", version: 0 } }, { verseRef: otherRef, selfCheck: { state: "unmarked", version: 0 }, assessment: { state: "not-started", version: 0 } }], counts: { selfCheck: { unmarked: saved ? 1 : 2, working: 0, "got-it": saved ? 1 : 0 }, assessment: { "not-started": 2, working: 0, solid: 0 } } });
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

test.each(["unknown", "conflict"] as const)("%s write recovery stays non-writable through a held or failed read, then explicitly verifies without POST replay", async failure => {
  const recovery = deferred<ProgressRows>(), operations: ProgressOperation[] = []; let reads = 0, retry = false;
  const store = new ProgressStore(async (_base, _kind, operation) => {
    operations.push(operation);
    if (operation.type !== "page") throw new ProgressError(failure === "conflict" ? 409 : 503, failure === "conflict" ? "conflict" : undefined);
    reads++; return reads === 1 ? page() : retry ? page(true) : recovery.promise;
  }, vi.fn(), vi.fn());
  store.configure(baseline()); await store.load("torah", 0);
  await store.set("torah", ref, "working"); await flush();
  expect(reads).toBe(2); expect(store.pending("torah", ref)).toBe(true);
  expect(store.notice("torah", ref)).not.toContain("latest mark is shown");
  await store.set("torah", ref, "got-it");
  expect(operations.filter(value => value.type !== "page")).toHaveLength(1);
  recovery.reject(new ProgressError(503)); await flush();
  expect(store.failed("torah")).toBe(true); expect(store.pending("torah", ref)).toBe(true);
  await store.set("torah", ref, "got-it"); expect(operations.filter(value => value.type !== "page")).toHaveLength(1);
  retry = true; await store.load("torah", 0);
  expect(store.pending("torah", ref)).toBe(false); expect(store.verse("torah", ref)?.selfCheck).toEqual({ state: "got-it", version: 1 });
  expect(store.counts("torah")).toEqual(page(true).counts); expect(operations.filter(value => value.type !== "page")).toHaveLength(1);
});

test("a committed write held across same-scope refresh rereads authoritative counts when it settles", async () => {
  const receipt = deferred<ProgressSaved>(), operations: ProgressOperation[] = []; let reads = 0;
  const store = new ProgressStore(async (_base, _kind, operation) => {
    operations.push(operation); if (operation.type !== "page") return receipt.promise;
    return page(++reads > 1);
  }, vi.fn(), vi.fn());
  store.configure(baseline()); await store.load("torah", 0);
  const saving = store.set("torah", ref, "got-it");
  store.configure(baseline()); await store.load("torah", 0);
  receipt.resolve({ verseRef: ref, stream: "self-check", state: "got-it", version: 1 }); await saving; await flush();
  expect(store.verse("torah", ref)?.selfCheck).toEqual({ state: "got-it", version: 1 });
  expect(store.counts("torah")).toEqual(page(true).counts); expect(reads).toBe(3);
  expect(operations.filter(value => value.type !== "page")).toHaveLength(1);
});

test("settlement from a replaced assignment cannot publish marks or start a read in the new assignment", async () => {
  const receipt = deferred<ProgressSaved>(), requests: { revision: number; operation: ProgressOperation }[] = [];
  const store = new ProgressStore(async (base, _kind, operation) => {
    requests.push({ revision: base.readings[0].revision, operation }); return operation.type === "page" ? page() : receipt.promise;
  }, vi.fn(), vi.fn());
  store.configure(baseline()); await store.load("torah", 0); const saving = store.set("torah", ref, "got-it");
  const changed = baseline(); changed.readings[0].revision = 2; store.configure(changed); await store.load("torah", 0);
  receipt.resolve({ verseRef: ref, stream: "self-check", state: "got-it", version: 1 }); await saving; await flush();
  expect(store.verse("torah", ref)?.selfCheck).toEqual({ state: "unmarked", version: 0 }); expect(store.counts("torah")).toEqual(page().counts);
  expect(requests.filter(value => value.revision === 2)).toHaveLength(1);
});
