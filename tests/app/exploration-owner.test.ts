import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { PortalRequestError } from "../../src/components/portal/api";
import { createExplorationOwner } from "../../src/components/portal/workspace/study/exploration-owner";
import type { PreparedExploration } from "../../src/components/portal/workspace/study/exploration-api";
import type { StudyPage } from "../../src/components/portal/workspace/study/api";
import { explorationBaseline, explorationPrepared, explorationPage } from "./exploration-client-helper";
import { deferred } from "../helpers/study";
afterEach(() => vi.useRealTimers());
function fixture() {
  type Options = Parameters<typeof createExplorationOwner>[0];
  const prepare = vi.fn<Options["prepare"]>(async () => explorationPrepared()), page = vi.fn<Options["page"]>(async (_baseline, _prepared, offset) => explorationPage(offset)), denied = vi.fn();
  const owner = createExplorationOwner({ prepare, page, denied }); owner.configure(explorationBaseline(), "session-a"); return { owner, prepare, page, denied };
}

test("full page navigation reuses its read-only scope and unchanged authority does not reload/reset current text", async () => {
  const f = fixture(); await f.owner.load(); await f.owner.load(100);
  const state = f.owner.snapshot(); expect(state.page?.verses).toHaveLength(46); expect(state.page?.offset).toBe(100); expect(f.prepare).toHaveBeenCalledTimes(1);
  expect(f.owner.configure(structuredClone(explorationBaseline()), "session-a")).toBe(false); expect(f.owner.snapshot()).toBe(state);
  expect(f.prepare).toHaveBeenCalledTimes(1); expect(f.page).toHaveBeenCalledTimes(2);
});

test("latest page intent wins and old completion cannot replace a new page", async () => {
  const f = fixture(); await f.owner.load(); const held = deferred<StudyPage>();
  f.page.mockImplementationOnce(async () => held.promise);
  const old = f.owner.load(100); await Promise.resolve(); await f.owner.load(0);
  held.resolve(explorationPage(100)); await old;
  expect(f.owner.snapshot().page?.offset).toBe(0); expect(f.denied).not.toHaveBeenCalled();
});

test("student/session/scope changes abort pending work and late old text cannot cross mounts", async () => {
  for (const change of ["student", "session", "date", "context"] as const) {
    const f = fixture(), held = deferred<PreparedExploration>(); let signal: AbortSignal | undefined;
    f.prepare.mockImplementationOnce(async (_baseline, current) => { signal = current; return held.promise; });
    const pending = f.owner.load(), next = explorationBaseline();
    if (change === "student") next.student.id = "10000000-0000-4000-8000-000000000003";
    if (change === "date") next.student.ceremonyDate = "2027-01-09";
    if (change === "context") next.context = { id: "10000000-0000-4000-8000-000000000004", studentId: next.student.id, studentRevision: 1, authorityRevision: 2, expiresAt: new Date(Date.now() + 60000).toISOString() };
    f.owner.configure(next, change === "session" ? "session-b" : "session-a");
    expect(signal?.aborted).toBe(true); held.resolve(explorationPrepared()); await pending;
    expect(f.owner.snapshot()).toEqual({ pending: false }); expect(f.page).not.toHaveBeenCalled();
  }
});

test("conceal/clear and confirmed Torah invalidate both text and binding; parent dashboard cannot load", async () => {
  const f = fixture(); await f.owner.load(); f.owner.clear(); expect(f.owner.snapshot()).toEqual({ pending: false });
  await f.owner.load(); expect(f.page).toHaveBeenCalledTimes(1);
  const confirmed = { ...explorationBaseline(), readings: [{ kind: "torah" }] } as ReturnType<typeof explorationBaseline>;
  f.owner.configure(confirmed, "session-a"); await f.owner.load(); expect(f.page).toHaveBeenCalledTimes(1);
  f.owner.configure({ ...explorationBaseline(), mode: "parent" }, "session-a"); await f.owner.load(); expect(f.page).toHaveBeenCalledTimes(1);
});

test("authority/stale refusals clear the previous page and binding; no automatic retry or generic error leakage", async () => {
  for (const status of [401, 403, 404, 409, 503]) {
    const f = fixture(); await f.owner.load();
    f.page.mockRejectedValueOnce(new PortalRequestError(status)); await f.owner.load(100);
    expect(f.owner.snapshot()).toEqual({ pending: false, error: status }); expect(f.page).toHaveBeenCalledTimes(2);
    expect(f.denied).toHaveBeenCalledTimes(status === 503 ? 0 : 1);
  }
});

test("expired request scope renews before another page and deadline crossed during response refuses delivery", async () => {
  vi.useFakeTimers({ toFake: ["Date"] }); const f = fixture(); await f.owner.load(); vi.setSystemTime(Date.now() + 300001);
  await f.owner.load(100); expect(f.prepare).toHaveBeenCalledTimes(2); expect(f.owner.snapshot().page?.offset).toBe(100);
  f.page.mockImplementationOnce(async () => { vi.setSystemTime(Date.now() + 300001); return explorationPage(); });
  await f.owner.load(0); expect(f.owner.snapshot()).toEqual({ pending: false, error: 409 });
});

test("background pause cancels only pending intent, retains already authorized reading and never resumes old asynchronous work", async () => {
  const f = fixture(); await f.owner.load(); const oldPage = f.owner.snapshot().page, held = deferred<StudyPage>();
  f.page.mockImplementationOnce(async () => held.promise); const work = f.owner.load(100); await Promise.resolve(); f.owner.pause();
  held.resolve(explorationPage(100)); await work;
  expect(f.owner.snapshot().page).toBe(oldPage); expect(f.owner.snapshot().pending).toBe(false);
});
