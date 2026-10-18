import { expect, it, vi } from "vitest";
import { createQuietRefresh, quietReadingAuthority } from "../../src/components/portal/workspace/quiet-refresh";
import type { Assigned } from "../../src/components/portal/workspace/api";
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
function fixture() {
  let snapshot: string | null = "session/path/practice/blocking/registry", signal!: AbortSignal;
  const gate = deferred<boolean>(), changed = vi.fn(), verify = vi.fn(async (input: AbortSignal) => { signal = input; return gate.promise; });
  const quiet = createQuietRefresh({ capture: () => snapshot, verify, changed, denied: error => Boolean(error && typeof error === "object" && "status" in error && [401, 403, 404].includes(Number(error.status))) });
  return { quiet, gate, changed, verify, get signal() { return signal; }, scope(value: string | null) { snapshot = value; } };
}

it("coalesces focus/pageshow/visible bursts and all events during the same in-flight check", async () => {
  const f = fixture(); for (let i = 0; i < 8; i++) f.quiet.request(); await flush();
  expect(f.verify).toHaveBeenCalledTimes(1); for (let i = 0; i < 8; i++) f.quiet.request();
  f.gate.resolve(true); await flush(); expect(f.verify).toHaveBeenCalledTimes(1); expect(f.changed).not.toHaveBeenCalled();
  f.quiet.request(); await flush(); expect(f.verify).toHaveBeenCalledTimes(2);
});

it("does not verify without an established visible authority scope", async () => {
  const f = fixture(); f.scope(null); f.quiet.request(); await flush(); expect(f.verify).not.toHaveBeenCalled(); expect(f.changed).not.toHaveBeenCalled();
});

it("same authority and transient503 retain notice, scroll and draft without invalidation", async () => {
  const f = fixture(), visible = { draft: "synthetic unsent draft", notice: "existing notice", scroll: 420 };
  const before = structuredClone(visible); f.quiet.request(); await flush(); f.gate.reject({ status: 503 }); await flush();
  expect(visible).toEqual(before); expect(f.changed).not.toHaveBeenCalled(); expect(f.signal.aborted).toBe(false);
});

it.each([401, 403, 404])("a current actual%s denial requires blocking reconciliation", async status => {
  const f = fixture(); f.quiet.request(); await flush(); f.gate.reject({ status }); await flush(); expect(f.changed).toHaveBeenCalledExactlyOnceWith("authority");
});

it("changed metadata requires reconciliation, but an old route/context/registry denial cannot clear its replacement", async () => {
  const f = fixture(); f.quiet.request(); await flush(); f.gate.resolve(false); await flush(); expect(f.changed).toHaveBeenCalledExactlyOnceWith("metadata");
  const stale = fixture(); stale.quiet.request(); await flush(); stale.scope("new route/child/registry"); stale.gate.reject({ status: 401 }); await flush(); expect(stale.changed).not.toHaveBeenCalled();
});

it("assignment-only differences keep the complete authority snapshot but no student/context/mode field is exempt", () => {
  const value: Assigned = { mode: "child-practice", student: { id: "synthetic-student", firstName: "Synthetic", lastName: "Student", ceremonyDate: "2027-01-02", revision: 4 }, context: { id: "synthetic-context", authorityRevision: 2, studentId: "synthetic-student", studentRevision: 4, expiresAt: "2026-10-18T00:00:00.000Z" }, readings: [] };
  const snapshot = quietReadingAuthority(value);
  const revised: Assigned = { ...value, readings: [{ id: "synthetic-assignment", kind: "torah", revision: 2, ranges: ["Genesis 1:1"], verses: ["Genesis 1:1"], needsReview: false, aliyahStarts: null, source: { status: "unavailable", fetchedAt: null, date: null, calendar: null, attribution: null }, confirmationDate: null, basis: "custom" }] };
  expect(quietReadingAuthority(revised)).toBe(snapshot);
  expect(quietReadingAuthority({ ...value, mode: "parent" })).not.toBe(snapshot);
  expect(quietReadingAuthority({ ...value, context: null })).not.toBe(snapshot);
  for (const key of Object.keys(value.student) as (keyof typeof value.student)[]) {
    const student = { ...value.student, [key]: typeof value.student[key] === "number" ? 5 : "changed" };
    expect(quietReadingAuthority({ ...value, student })).not.toBe(snapshot);
  }
  for (const key of Object.keys(value.context!) as (keyof NonNullable<typeof value.context>)[]) {
    const context = { ...value.context!, [key]: typeof value.context![key] === "number" ? 5 : "changed" };
    expect(quietReadingAuthority({ ...value, context })).not.toBe(snapshot);
  }
});

it("cancel fences queued and pending work; late failure cannot invalidate a newly established scope", async () => {
  const queued = fixture(); queued.quiet.request(); queued.quiet.cancel(); await flush(); expect(queued.verify).not.toHaveBeenCalled();
  const f = fixture(); f.quiet.request(); await flush(); f.quiet.cancel(); expect(f.signal.aborted).toBe(true);
  f.scope("new scope"); f.gate.reject({ status: 403 }); await flush(); expect(f.changed).not.toHaveBeenCalled();
});

it("starting focus checks cannot invalidate a concurrent write's captured generation or committed acknowledgement", async () => {
  let generation = 7, dirty = true, acknowledgement = "pending";
  const f = fixture(), commit = deferred<string>(), startedGeneration = generation;
  const write = commit.promise.then(value => { if (startedGeneration !== generation) throw new Error("Synthetic write incorrectly invalidated"); dirty = false; acknowledgement = value; });
  f.quiet.request(); await flush(); expect(generation).toBe(7); expect(f.signal.aborted).toBe(false);
  commit.resolve("committed"); await write; f.gate.resolve(true); await flush();
  expect({ generation, dirty, acknowledgement }).toEqual({ generation: 7, dirty: false, acknowledgement: "committed" }); expect(f.changed).not.toHaveBeenCalled();
});
