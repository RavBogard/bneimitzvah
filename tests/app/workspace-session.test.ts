import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { ReactElement, ReactNode } from "react";

// The signed-in shell's session contract (C2/F1, 2026-11-17): one session read when the shell mounts, none on a client route
// change or around a read; every read is one request; a 401/403 from any read lands in one place, which drops private state,
// unmounts the private subtree and reads the session again. DOM-free host of the actual provider, as the earlier
// practice-calendar-session test did: React's hooks are replaced by slots so the provider's callbacks can be driven directly.
const host = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0, effects: [] as (() => void)[], cleanups: [] as (() => void)[], path: "/mine/reading",
  portal: vi.fn(), reading: vi.fn(), enter: vi.fn(), exit: vi.fn(), calendar: vi.fn(), shortPage: vi.fn(), explorePage: vi.fn(),
  listeners: new Map<string, Set<(event: unknown) => void>>(), visibility: "visible", router: { push: vi.fn(), replace: vi.fn() } }));
vi.mock("react", async load => {
  const actual = await load<typeof import("react")>();
  return { ...actual,
    useRef: (value: unknown) => { const i = host.cursor++; return host.slots[i] ??= { current: value }; },
    useState: (value: unknown) => { const i = host.cursor++; if (!(i in host.slots)) host.slots[i] = value; return [host.slots[i], (next: unknown) => { host.slots[i] = typeof next === "function" ? next(host.slots[i]) : next; }]; },
    useCallback: (callback: unknown, deps: unknown[]) => { const i = host.cursor++, previous = host.slots[i] as { deps: unknown[]; callback: unknown } | undefined; if (!previous || deps.some((value, index) => value !== previous.deps[index])) host.slots[i] = { deps, callback }; return (host.slots[i] as { callback: unknown }).callback; },
    useEffect: (effect: () => void | (() => void), deps: unknown[]) => {
      const i = host.cursor++, previous = host.slots[i] as unknown[] | undefined;
      if (!previous || deps.some((value, index) => value !== previous[index])) host.effects.push(() => { const cleanup = effect(); if (cleanup) host.cleanups.push(cleanup); });
      host.slots[i] = deps;
    },
  };
});
vi.mock("next/navigation", () => ({ usePathname: () => host.path, useRouter: () => host.router }));
vi.mock("next/link", () => ({ default: () => null }));
vi.mock("../../src/components/portal/api", async load => ({ ...await load<typeof import("../../src/components/portal/api")>(), requestPortal: host.portal }));
vi.mock("../../src/components/portal/workspace/api", async load => {
  const actual = await load<typeof import("../../src/components/portal/workspace/api")>();
  return { ...actual, workspaceApi: { ...actual.workspaceApi, reading: host.reading, enter: host.enter, exit: host.exit } };
});
vi.mock("../../src/components/portal/workspace/practice-calendar/api", async load => ({ ...await load<typeof import("../../src/components/portal/workspace/practice-calendar/api")>(), fetchPracticeCalendar: host.calendar }));
vi.mock("../../src/components/portal/workspace/study/exploration-api", async load => {
  const actual = await load<typeof import("../../src/components/portal/workspace/study/exploration-api")>();
  return { ...actual, explorationApi: { ...actual.explorationApi, page: host.explorePage } };
});
vi.mock("../../src/components/portal/workspace/study/short-exploration-api", async load => ({
  ...await load<typeof import("../../src/components/portal/workspace/study/short-exploration-api")>(), checkShortExplorationExpectation: () => undefined, fetchShortExplorationPage: host.shortPage }));
// The owner's own caching and expiry are tested elsewhere; here its provider-supplied read is exercised directly.
vi.mock("../../src/components/portal/workspace/study/short-exploration-owner", () => ({ createShortExplorationOwner: (input: unknown) => input }));
import { WorkspaceProvider } from "../../src/components/portal/workspace/provider";
import { RETURN_RECHECK_MS } from "../../src/components/portal/workspace/session";
import { PRACTICE_ACCESS_CHANGED } from "../../src/components/portal/workspace/practice-mode";
import { PortalRequestError } from "../../src/components/portal/api";
import type { Assigned } from "../../src/components/portal/workspace/api";
import type { PreparedExploration } from "../../src/components/portal/workspace/study/exploration-api";
import type { StudyPage } from "../../src/components/portal/workspace/study/api";
import type { PracticeOperation } from "../../src/components/portal/workspace/practice-calendar/api";

const binding = "a".repeat(43), other = "b".repeat(43);
const session = (sessionBinding = binding, roles = ["student", "parent"]) => ({ membershipAvailable: true, roles, saved: true, approver: false, sessionBinding });
const studentId = "10000000-0000-4000-8000-000000000001", childId = "10000000-0000-4000-8000-000000000009";
const contextId = "10000000-0000-4000-8000-000000000002";
const sitting = (id = childId, expiresAt = "2099-01-01T00:00:00.000Z") => ({ handle: "h".repeat(43), context: { id: contextId, studentId: id, authorityRevision: 1, studentRevision: 1, expiresAt } });
const baseline = { student: { id: studentId, firstName: "Synthetic", lastName: "Learner", ceremonyDate: "2027-03-13", revision: 1 }, mode: "student", context: null, readings: [], referenceListeningEnabled: true } as unknown as Assigned;
const operation: PracticeOperation = { type: "visit", eventId: "10000000-0000-4000-8000-000000000003", expectedDay: "2026-10-17", target: { type: "verse", kind: "torah", assignmentId: "10000000-0000-4000-8000-000000000004", assignmentRevision: 1, verseRef: "Genesis 1:1" } };
type Workspace = ReturnType<typeof import("../../src/components/portal/workspace/provider").useWorkspace>;
type Props = { value?: Workspace; children?: ReactNode; "data-testid"?: string; "data-workspace-state"?: string };
function walk(node: ReactNode, visit: (props: Props, element: ReactElement<Props>) => void) {
  if (Array.isArray(node)) { node.forEach(child => walk(child, visit)); return; }
  if (!node || typeof node !== "object" || !("props" in node)) return;
  const element = node as ReactElement<Props>; visit(element.props, element); walk(element.props.children, visit);
}
let tree: ReactNode = null;
function render(effects = true) { host.cursor = 0; tree = WorkspaceProvider({ children: "Synthetic private subtree" }); if (effects) host.effects.splice(0).forEach(effect => effect()); return workspace(); }
function workspace() { let found: Workspace | undefined; walk(tree, props => { if (props.value?.readPracticeCalendar) found ??= props.value; }); return found; }
function providerKey() { let key: string | null | undefined; walk(tree, (props, element) => { if (props.value?.readPracticeCalendar) key = element.key; }); return key; }
function shellState() { let state: string | undefined; walk(tree, props => { if (props["data-testid"] === "workspace-state") state = props["data-workspace-state"]; }); return state; }
const sessionReads = () => host.portal.mock.calls.filter(call => call[0] === "/api/session").length;
const flush = async () => { for (let i = 0; i < 60; i++) await Promise.resolve(); };
const dispatch = (type: string, event: unknown = {}) => host.listeners.get(type)?.forEach(listener => listener(event));
const target = () => ({ addEventListener: (type: string, listener: (event: unknown) => void) => { if (!host.listeners.has(type)) host.listeners.set(type, new Set()); host.listeners.get(type)!.add(listener); },
  removeEventListener: (type: string, listener: (event: unknown) => void) => { host.listeners.get(type)?.delete(listener); } });
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
beforeEach(() => {
  host.slots = []; host.cursor = 0; host.effects = []; host.cleanups = []; host.path = "/mine/reading"; host.listeners = new Map(); host.visibility = "visible"; tree = null;
  host.portal.mockReset().mockResolvedValue(session()); host.reading.mockReset().mockResolvedValue(baseline); host.calendar.mockReset().mockResolvedValue({ practiceDay: "2026-10-17" });
  host.enter.mockReset().mockImplementation(async (id: string) => sitting(id)); host.exit.mockReset().mockResolvedValue({ contextId });
  host.shortPage.mockReset(); host.explorePage.mockReset(); host.router.push.mockClear(); host.router.replace.mockClear();
  vi.stubGlobal("window", target());
  vi.stubGlobal("document", { get visibilityState() { return host.visibility; }, ...target() });
});
afterEach(() => { host.cleanups.splice(0).forEach(cleanup => cleanup()); vi.unstubAllGlobals(); vi.useRealTimers(); });
async function ready() {
  render(); await flush(); const value = render()!; expect(value).toBeDefined(); expect(shellState()).toBeUndefined();
  const life = { pause: vi.fn(), clear: vi.fn(), settle: vi.fn(async () => undefined), hasUnsaved: () => false, reveal: vi.fn() };
  value.registerWork(life);
  return { workspace: value, life };
}

test("the shell reads the session once on mount and shows nothing private until it is held", async () => {
  render(); expect(shellState()).toBe("checking"); expect(workspace()).toBeUndefined();
  await flush(); expect(render()).toBeDefined(); expect(sessionReads()).toBe(1);
});

test("client navigation between signed-in pages reads no session and keeps the pages mounted", async () => {
  await ready();
  for (const path of ["/mine", "/mine/reading", `/workspace/tutor/${studentId}`, "/mine"]) { host.path = path; render(); await flush(); expect(render()).toBeDefined(); expect(shellState()).toBeUndefined(); }
  expect(sessionReads()).toBe(1);
});

test("a read is one request: no session check before or after it", async () => {
  const { workspace } = await ready(); host.portal.mockClear();
  await workspace.read("student", studentId, new AbortController().signal);
  await workspace.readLessons("student", studentId, { type: "page" }, new AbortController().signal).catch(() => undefined);
  await workspace.readPracticeCalendar("student", studentId, operation, new AbortController().signal);
  expect(host.portal).not.toHaveBeenCalled(); expect(host.reading).toHaveBeenCalledTimes(1); expect(host.calendar).toHaveBeenCalledTimes(1);
});

test("a 401 on a read clears private state at once and shows the signed-out entry", async () => {
  const { workspace, life } = await ready(), check = deferred<unknown>(); host.reading.mockRejectedValueOnce(new PortalRequestError(401)); host.portal.mockImplementationOnce(() => check.promise);
  await expect(workspace.read("student", studentId, new AbortController().signal)).rejects.toMatchObject({ status: 401 });
  expect(life.clear).toHaveBeenCalled(); expect(render(false)).toBeUndefined(); expect(shellState()).toBe("checking");
  check.reject(new PortalRequestError(401)); await flush(); expect(render()).toBeUndefined(); expect(shellState()).toBe("signed-out"); expect(sessionReads()).toBe(2);
});

test("a 403 the server stands by shows Access has changed and never mounts the view again by itself", async () => {
  const { workspace, life } = await ready(); host.explorePage.mockRejectedValue(new PortalRequestError(403));
  await expect(workspace.readExplorationPage(baseline, { binding: "synthetic" } as unknown as PreparedExploration, 0, new AbortController().signal)).rejects.toMatchObject({ status: 403 });
  expect(life.clear).toHaveBeenCalled(); await flush(); expect(render()).toBeUndefined(); expect(shellState()).toBe("access-changed");
  await flush(); await flush(); expect(sessionReads()).toBe(2); expect(host.explorePage).toHaveBeenCalledTimes(1);
  // Opening another page, or Check access again, reads the session and mounts the pages afresh.
  host.path = "/mine"; render(); await flush(); expect(render()).toBeDefined(); expect(sessionReads()).toBe(3);
});

test("a page that reports its own refusal goes through the same central handling", async () => {
  const { workspace, life } = await ready(); host.portal.mockResolvedValueOnce(session());
  workspace.serviceAuthorityFailed(404); expect(life.clear).toHaveBeenCalledTimes(1); expect(render(false)).toBeUndefined();
  workspace.serviceAuthorityFailed(403); expect(sessionReads()).toBe(2); // one check at a time
  await flush(); render(); expect(shellState()).toBe("access-changed");
});

for (const status of [403, 404]) test(`a practice-calendar ${status} stays on the calendar; its 401 still signs the page out`, async () => {
  const { workspace, life } = await ready(); host.calendar.mockRejectedValueOnce(new PortalRequestError(status));
  await expect(workspace.readPracticeCalendar("student", studentId, operation, new AbortController().signal)).rejects.toMatchObject({ status });
  expect(life.clear).not.toHaveBeenCalled(); expect(render()).toBeDefined(); expect(sessionReads()).toBe(1);
  host.calendar.mockRejectedValueOnce(new PortalRequestError(401)); host.portal.mockRejectedValueOnce(new PortalRequestError(401));
  await expect(workspace.readPracticeCalendar("student", studentId, operation, new AbortController().signal)).rejects.toMatchObject({ status: 401 });
  await flush(); render(); expect(life.clear).toHaveBeenCalled(); expect(shellState()).toBe("signed-out");
});

for (const status of [403, 404]) test(`optional reference audio refused with ${status} stays with the player: no clear, no session read, one request`, async () => {
  const { workspace, life } = await ready(); host.shortPage.mockRejectedValue(new PortalRequestError(status)); host.portal.mockClear();
  const prepared = { binding: "synthetic", expiresAt: Date.now() + 60_000 } as unknown as PreparedExploration, page = { offset: 0 } as unknown as StudyPage;
  const owner = workspace.createShortExplorationOwner({ ...baseline, mode: "tutor" } as Assigned, prepared, page, () => true) as unknown as { read(value: Assigned, prepared: PreparedExploration, page: StudyPage, signal: AbortSignal): Promise<unknown> };
  await expect(owner.read({ ...baseline, mode: "tutor" } as Assigned, prepared, page, new AbortController().signal)).rejects.toMatchObject({ status });
  await flush(); expect(host.shortPage).toHaveBeenCalledTimes(1); expect(host.portal).not.toHaveBeenCalled(); expect(life.clear).not.toHaveBeenCalled(); expect(render()).toBeDefined();
});

test("a late refusal for a view that has since been replaced cannot clear the view that replaced it", async () => {
  const { workspace, life } = await ready(); const held = deferred<Assigned>(); host.reading.mockImplementationOnce(() => held.promise);
  const pending = workspace.read("student", studentId, new AbortController().signal).catch(error => error);
  await workspace.selectChild(childId); life.clear.mockClear(); host.portal.mockClear(); // a practice sitting replaced the view (its version moved on)
  held.reject(new PortalRequestError(401)); expect(await pending).toMatchObject({ status: 401 });
  expect(host.portal).not.toHaveBeenCalled(); expect(life.clear).not.toHaveBeenCalled();
  const aborted = new AbortController(), late = deferred<Assigned>(); host.reading.mockImplementationOnce(() => late.promise);
  const second = render()!.read("student", studentId, aborted.signal).catch(error => error); aborted.abort(); late.reject(new PortalRequestError(401));
  expect(await second).toMatchObject({ status: 401 }); expect(host.portal).not.toHaveBeenCalled();
});

test("coming back to the tab re-reads the session only after being away a while", async () => {
  vi.useFakeTimers({ toFake: ["Date"] }); await ready();
  dispatch("blur"); dispatch("focus"); await flush(); expect(sessionReads()).toBe(1);
  host.visibility = "hidden"; dispatch("visibilitychange"); vi.setSystemTime(Date.now() + RETURN_RECHECK_MS); host.visibility = "visible"; dispatch("visibilitychange"); dispatch("focus");
  await flush(); expect(sessionReads()).toBe(2); expect(render()).toBeDefined();
});

test("coming back to a signed-out session (another tab signed out) unmounts the private subtree", async () => {
  vi.useFakeTimers({ toFake: ["Date"] }); const { life } = await ready(); host.portal.mockRejectedValueOnce(new PortalRequestError(401));
  dispatch("blur"); vi.setSystemTime(Date.now() + RETURN_RECHECK_MS + 1); dispatch("focus"); await flush();
  expect(life.clear).toHaveBeenCalled(); expect(render()).toBeUndefined(); expect(shellState()).toBe("signed-out");
});

test("a page restored from the back-forward cache always re-reads the session; signed out, it hides at once", async () => {
  const { life } = await ready();
  dispatch("pageshow", { persisted: false }); await flush(); expect(sessionReads()).toBe(1);
  host.portal.mockRejectedValueOnce(new PortalRequestError(401)); dispatch("pageshow", { persisted: true }); await flush();
  expect(sessionReads()).toBe(2); expect(life.clear).toHaveBeenCalled(); expect(render()).toBeUndefined(); expect(shellState()).toBe("signed-out");
});

test("another person's session in this browser drops the first person's view and starts afresh", async () => {
  const { life } = await ready(); expect(providerKey()).toBe(binding); host.portal.mockResolvedValueOnce(session(other));
  dispatch("pageshow", { persisted: true }); await flush();
  expect(life.clear).toHaveBeenCalled(); expect(render()).toBeDefined(); expect(providerKey()).toBe(other);
});

test("a role revoked mid-session (seen on coming back) updates the held roles without a reload", async () => {
  await ready(); host.portal.mockResolvedValueOnce(session(binding, ["student"]));
  dispatch("pageshow", { persisted: true }); await flush();
  expect(render()!.summary.roles).toEqual(["student"]);
});

test("practice with a child: entering sends the handle only with that child's child-practice reads, and leaving its page closes it", async () => {
  host.path = `/mine/child/${childId}`; const { workspace } = await ready();
  await workspace.selectChild(childId);
  expect(host.enter).toHaveBeenCalledWith(childId); expect(host.router.push).toHaveBeenCalledWith(`/workspace/practice/${childId}`);
  host.path = `/workspace/practice/${childId}`; const sitting = render()!; await flush(); expect(sitting.context?.studentId).toBe(childId);
  await sitting.read("child-practice", childId, new AbortController().signal);
  expect(host.reading).toHaveBeenLastCalledWith("child-practice", childId, expect.objectContaining({ handle: "h".repeat(43) }), expect.anything());
  await sitting.read("parent", childId, new AbortController().signal);
  expect(host.reading).toHaveBeenLastCalledWith("parent", childId, undefined, expect.anything());
  host.reading.mockClear();
  await expect(sitting.read("child-practice", studentId, new AbortController().signal)).rejects.toMatchObject({ status: 404 });
  expect(host.reading).not.toHaveBeenCalled();
  expect(sessionReads()).toBe(1);
  host.path = "/mine"; render(); await flush();
  expect(host.exit).toHaveBeenCalledWith("h".repeat(43)); expect(render()!.context).toBeNull();
});

test("practice with a child: Done closes the sitting on the server and returns to the child's page", async () => {
  host.path = `/mine/child/${childId}`; const { workspace } = await ready(); await workspace.selectChild(childId);
  host.path = `/workspace/practice/${childId}`; render(); await flush();
  await render()!.exitPractice({ id: childId, firstName: "Synthetic" });
  expect(host.exit).toHaveBeenCalledTimes(1); expect(host.router.replace).toHaveBeenCalledWith(`/mine/child/${childId}`);
  render(); expect(render()!.context).toBeNull();
});

test("practice with a child: a refusal on the sitting's page ends it with the practice notice, not a sign-out", async () => {
  host.path = `/mine/child/${childId}`; const { workspace } = await ready(); await workspace.selectChild(childId);
  host.path = `/workspace/practice/${childId}`; render(); await flush();
  host.reading.mockRejectedValueOnce(new PortalRequestError(403));
  await expect(render()!.read("child-practice", childId, new AbortController().signal)).rejects.toMatchObject({ status: 403 });
  expect(host.router.replace).toHaveBeenCalledWith("/mine"); expect(render()!.notice).toBe(PRACTICE_ACCESS_CHANGED); expect(render()!.context).toBeNull(); expect(sessionReads()).toBe(1);
});

test("practice with a child: the sitting ends when it expires", async () => {
  vi.useFakeTimers(); host.enter.mockImplementation(async (id: string) => sitting(id, new Date(Date.now() + 60 * 60_000).toISOString()));
  host.path = `/mine/child/${childId}`; const { workspace } = await ready(); await workspace.selectChild(childId);
  host.path = `/workspace/practice/${childId}`; render(); await flush(); expect(render()!.context).not.toBeNull();
  vi.advanceTimersByTime(60 * 60_000 + 1);
  expect(host.router.replace).toHaveBeenCalledWith("/mine"); render(); expect(render()!.context).toBeNull(); expect(render()!.notice).toMatch(/practice session ended/);
  await expect(render()!.read("child-practice", childId, new AbortController().signal)).rejects.toMatchObject({ status: 404 });
});

test("signing out (the shell unmounting) closes an open sitting", async () => {
  host.path = `/mine/child/${childId}`; const { workspace } = await ready(); await workspace.selectChild(childId);
  host.path = `/workspace/practice/${childId}`; render(); await flush();
  host.cleanups.splice(0).forEach(cleanup => cleanup()); await flush();
  expect(host.exit).toHaveBeenCalledWith("h".repeat(43));
});
