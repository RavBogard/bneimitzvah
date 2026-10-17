import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { ReactElement, ReactNode } from "react";

// DOM-free host of the actual provider callbacks. Native concealment, SDK and
// context-switch behavior are independently exercised by the browser reviewer.
const host = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0, effects: [] as (() => void)[], cleanups: [] as (() => void)[], path: "/workspace/student",
  portal: vi.fn(), calendar: vi.fn(), router: { push: vi.fn(), replace: vi.fn() } }));
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
vi.mock("../../src/components/portal/workspace/practice-calendar/api", async load => ({ ...await load<typeof import("../../src/components/portal/workspace/practice-calendar/api")>(), fetchPracticeCalendar: host.calendar }));
vi.mock("../../src/components/portal/workspace/api", async load => {
  const actual = await load<typeof import("../../src/components/portal/workspace/api")>();
  return { ...actual, workspaceApi: { ...actual.workspaceApi, reading: vi.fn(async () => ({})), enter: vi.fn(async (id: string) => ({ handle: "synthetic-handle", context: { id: "10000000-0000-4000-8000-000000000002", studentId: id, authorityRevision: 1, studentRevision: 1, expiresAt: "2099-01-01T00:00:00.000Z" } })) } };
});
import { WorkspaceProvider } from "../../src/components/portal/workspace/provider";
import { PortalRequestError } from "../../src/components/portal/api";
import { PracticeCalendarError, type PracticeOperation } from "../../src/components/portal/workspace/practice-calendar/api";
import type { PracticeCoordinator } from "../../src/components/portal/workspace/practice";

const session = { membershipAvailable: true, roles: ["student", "parent"], sessionBinding: "a".repeat(43) }, studentId = "10000000-0000-4000-8000-000000000001";
const operation: PracticeOperation = { type: "visit", eventId: "10000000-0000-4000-8000-000000000003", expectedDay: "2026-10-17", target: { type: "verse", kind: "torah", assignmentId: "10000000-0000-4000-8000-000000000004", assignmentRevision: 1, verseRef: "Genesis 1:1" } };
type Workspace = ReturnType<typeof import("../../src/components/portal/workspace/provider").useWorkspace>;
function find(node: ReactNode): Workspace | undefined {
  if (Array.isArray(node)) { for (const child of node) { const result = find(child); if (result) return result; } return; }
  if (!node || typeof node !== "object" || !("props" in node)) return;
  const props = (node as ReactElement<{ value?: Workspace; children?: ReactNode }>).props;
  return props.value?.readPracticeCalendar ? props.value : find(props.children);
}
function render(effects = true) { host.cursor = 0; const tree = WorkspaceProvider({ children: "Synthetic private subtree" }); if (effects) host.effects.splice(0).forEach(effect => effect()); return find(tree); }
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
beforeEach(() => {
  host.slots = []; host.cursor = 0; host.effects = []; host.cleanups = []; host.path = "/workspace/student"; host.portal.mockReset().mockResolvedValue(session); host.calendar.mockReset().mockResolvedValue({ practiceDay: "2026-10-17" }); host.router.push.mockClear(); host.router.replace.mockClear();
  vi.stubGlobal("window", { addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal("document", { visibilityState: "visible", addEventListener: vi.fn(), removeEventListener: vi.fn() });
});
afterEach(() => { host.cleanups.splice(0).forEach(cleanup => cleanup()); vi.unstubAllGlobals(); });
async function setup(mode: "student" | "child-practice") {
  render(); await flush(); let workspace = render()!; expect(workspace.concealed).toBe(false);
  if (mode === "child-practice") { await workspace.selectChild(studentId); host.path = `/workspace/practice/${studentId}`; render(); await flush(); workspace = render()!; expect(workspace.context?.studentId).toBe(studentId); }
  const life = { pause: vi.fn(), clear: vi.fn(), settle: vi.fn(async () => undefined), hasUnsaved: () => false, reveal: vi.fn() };
  workspace.registerWork(life); host.portal.mockClear(); host.calendar.mockClear(); host.router.replace.mockClear();
  return { workspace, life };
}

for (const mode of ["student", "child-practice"] as const) test.each(["precheck", "request", "postcheck"])(`current ${mode} calendar session401 at %s clears/conceals globally despite local-refusal optout`, async stage => {
  const { workspace, life } = await setup(mode), heldRefresh = deferred<unknown>();
  if (stage === "precheck") host.portal.mockRejectedValueOnce(new PortalRequestError(401)).mockImplementationOnce(() => heldRefresh.promise);
  else if (stage === "request") { host.portal.mockResolvedValueOnce(session).mockImplementationOnce(() => heldRefresh.promise); host.calendar.mockRejectedValueOnce(new PracticeCalendarError(401)); }
  else host.portal.mockResolvedValueOnce(session).mockRejectedValueOnce(new PortalRequestError(401)).mockImplementationOnce(() => heldRefresh.promise);
  await expect(workspace.readPracticeCalendar(mode, studentId, operation, new AbortController().signal)).rejects.toMatchObject({ status: 401 });
  expect(life.clear).toHaveBeenCalledTimes(1); expect(life.pause).toHaveBeenCalledTimes(1); expect(render()!.concealed).toBe(true);
  expect(host.calendar).toHaveBeenCalledTimes(stage === "precheck" ? 0 : 1); expect(host.router.replace).not.toHaveBeenCalled();
  heldRefresh.reject(new PortalRequestError(401)); await flush(); expect(render()).toBeUndefined();
});

for (const mode of ["student", "child-practice"] as const) test.each([403, 404])(`${mode} calendar-specific %s stays local without global clear, redirect or refresh`, async status => {
  const { workspace, life } = await setup(mode); host.calendar.mockRejectedValueOnce(new PracticeCalendarError(status));
  await expect(workspace.readPracticeCalendar(mode, studentId, operation, new AbortController().signal)).rejects.toMatchObject({ status });
  expect(life.clear).not.toHaveBeenCalled(); expect(life.pause).not.toHaveBeenCalled(); expect(host.portal).toHaveBeenCalledTimes(1); expect(host.calendar).toHaveBeenCalledTimes(1);
  expect(render()!.concealed).toBe(false); expect(host.router.replace).not.toHaveBeenCalled();
});

test.each(["abort", "generation", "route"])("late old401 after %s cannot clear/conceal the current workspace", async changed => {
  const { workspace, life } = await setup("student"), held = deferred<unknown>(), controller = new AbortController(); host.portal.mockImplementationOnce(() => held.promise);
  const pending = workspace.readPracticeCalendar("student", studentId, operation, controller.signal).catch(error => error);
  if (changed === "abort") controller.abort();
  else if (changed === "generation") (host.slots[0] as { current: PracticeCoordinator }).current.pause();
  else { host.path = "/workspace/parent"; render(false); host.effects = []; }
  held.reject(new PortalRequestError(401)); expect(await pending).toMatchObject({ status: 401 });
  expect(life.clear).not.toHaveBeenCalled(); expect(life.pause).not.toHaveBeenCalled(); expect(host.portal).toHaveBeenCalledTimes(1); expect(host.calendar).not.toHaveBeenCalled(); expect(render(false)!.concealed).toBe(false);
});
