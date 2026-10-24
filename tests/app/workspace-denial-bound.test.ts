import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { ReactElement, ReactNode } from "react";

// AD-01: an optional reference-audio refusal (the short exploration page answering 403) used to
// clear the workspace and re-check the session; the re-mounted view asked again and the page
// looped. DOM-free host of the actual provider callbacks, as in practice-calendar-session.test.ts.
const host = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0, effects: [] as (() => void)[], cleanups: [] as (() => void)[], path: "/workspace/tutor/10000000-0000-4000-8000-000000000001",
  portal: vi.fn(), reading: vi.fn(), shortPage: vi.fn(), explorePage: vi.fn(), router: { push: vi.fn(), replace: vi.fn() } }));
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
  return { ...actual, workspaceApi: { ...actual.workspaceApi, reading: host.reading } };
});
vi.mock("../../src/components/portal/workspace/study/exploration-api", async load => {
  const actual = await load<typeof import("../../src/components/portal/workspace/study/exploration-api")>();
  return { ...actual, explorationApi: { ...actual.explorationApi, page: host.explorePage } };
});
vi.mock("../../src/components/portal/workspace/study/short-exploration-api", async load => ({
  ...await load<typeof import("../../src/components/portal/workspace/study/short-exploration-api")>(), checkShortExplorationExpectation: () => undefined, fetchShortExplorationPage: host.shortPage }));
// The owner's own caching/expiry is tested elsewhere; here its provider-supplied read is exercised directly.
vi.mock("../../src/components/portal/workspace/study/short-exploration-owner", () => ({ createShortExplorationOwner: (input: unknown) => input }));
import { DENIAL_REFRESH_LIMIT, WorkspaceProvider } from "../../src/components/portal/workspace/provider";
import { PortalRequestError } from "../../src/components/portal/api";
import type { Assigned } from "../../src/components/portal/workspace/api";
import type { PreparedExploration } from "../../src/components/portal/workspace/study/exploration-api";
import type { StudyPage } from "../../src/components/portal/workspace/study/api";

const session = { membershipAvailable: true, roles: ["tutor"], saved: true, approver: false, sessionBinding: "a".repeat(43) }, studentId = "10000000-0000-4000-8000-000000000001";
const baseline = { student: { id: studentId, firstName: "Synthetic", lastName: "Learner", ceremonyDate: "2027-03-13", revision: 1 }, mode: "tutor", context: null, readings: [], referenceListeningEnabled: true } as Assigned;
type Workspace = ReturnType<typeof import("../../src/components/portal/workspace/provider").useWorkspace>;
type Owner = { read(value: Assigned, prepared: PreparedExploration, page: StudyPage, signal: AbortSignal): Promise<unknown> };
function find(node: ReactNode): Workspace | undefined {
  if (Array.isArray(node)) { for (const child of node) { const result = find(child); if (result) return result; } return; }
  if (!node || typeof node !== "object" || !("props" in node)) return;
  const props = (node as ReactElement<{ value?: Workspace; children?: ReactNode }>).props;
  return props.value?.createShortExplorationOwner ? props.value : find(props.children);
}
function render(effects = true) { host.cursor = 0; const tree = WorkspaceProvider({ children: "Synthetic private subtree" }); if (effects) host.effects.splice(0).forEach(effect => effect()); return find(tree); }
const flush = async () => { for (let i = 0; i < 60; i++) await Promise.resolve(); };
beforeEach(() => {
  host.slots = []; host.cursor = 0; host.effects = []; host.cleanups = []; host.path = `/workspace/tutor/${studentId}`;
  host.portal.mockReset().mockResolvedValue(session); host.reading.mockReset().mockResolvedValue(baseline);
  host.shortPage.mockReset(); host.explorePage.mockReset(); host.router.push.mockClear(); host.router.replace.mockClear();
  vi.stubGlobal("window", { addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal("document", { visibilityState: "visible", addEventListener: vi.fn(), removeEventListener: vi.fn() });
});
afterEach(() => { host.cleanups.splice(0).forEach(cleanup => cleanup()); vi.unstubAllGlobals(); });
async function setup() {
  render(); await flush(); const workspace = render()!; expect(workspace.concealed).toBe(false);
  const life = { pause: vi.fn(), clear: vi.fn(), settle: vi.fn(async () => undefined), hasUnsaved: () => false, reveal: vi.fn() };
  workspace.registerWork(life); host.portal.mockClear(); host.reading.mockClear(); host.router.replace.mockClear();
  return { workspace, life };
}
function shortRead(workspace: Workspace) {
  const prepared = { binding: "synthetic", expiresAt: Date.now() + 60_000 } as unknown as PreparedExploration, page = { offset: 0 } as unknown as StudyPage;
  const owner = workspace.createShortExplorationOwner(baseline, prepared, page, () => true) as unknown as Owner;
  return owner.read(baseline, prepared, page, new AbortController().signal);
}

test.each([403, 404])("an optional short-reference %s stays local once the reading is confirmed: no clear, no refresh, bounded requests", async status => {
  const { workspace, life } = await setup(); host.shortPage.mockRejectedValue(new PortalRequestError(status));
  await expect(shortRead(workspace)).rejects.toMatchObject({ status });
  await flush();
  // One session check before the refused request, then one confirmation: session, reading, session.
  expect(host.shortPage).toHaveBeenCalledTimes(1); expect(host.reading).toHaveBeenCalledTimes(1); expect(host.portal).toHaveBeenCalledTimes(3);
  expect(life.clear).not.toHaveBeenCalled(); expect(life.pause).not.toHaveBeenCalled(); expect(render()!.concealed).toBe(false);
  await flush(); expect(host.portal).toHaveBeenCalledTimes(3); expect(host.reading).toHaveBeenCalledTimes(1); expect(host.router.replace).not.toHaveBeenCalled();
});

test.each([401, 403, 404])("an optional short-reference refusal still clears and conceals when the confirming reading answers %s", async status => {
  const { workspace, life } = await setup(); host.shortPage.mockRejectedValue(new PortalRequestError(403)); host.reading.mockRejectedValueOnce(new PortalRequestError(status));
  const held = new Promise(() => undefined);
  host.portal.mockResolvedValueOnce(session).mockResolvedValueOnce(session).mockImplementationOnce(() => held);
  await expect(shortRead(workspace)).rejects.toMatchObject({ status: 403 });
  await flush();
  expect(life.clear).toHaveBeenCalled(); expect(life.pause).toHaveBeenCalledTimes(1); expect(render()!.concealed).toBe(true);
});

test("a confirming session that has ended (401 from the session check) clears and conceals", async () => {
  const { workspace, life } = await setup(); host.shortPage.mockRejectedValue(new PortalRequestError(403));
  const held = new Promise(() => undefined);
  host.portal.mockResolvedValueOnce(session).mockRejectedValueOnce(new PortalRequestError(401)).mockImplementationOnce(() => held);
  await expect(shortRead(workspace)).rejects.toMatchObject({ status: 403 });
  await flush();
  expect(host.reading).not.toHaveBeenCalled(); expect(life.clear).toHaveBeenCalled(); expect(render()!.concealed).toBe(true);
});

test("a short-reference 401 clears and conceals at once, without a confirming read", async () => {
  const { workspace, life } = await setup(); host.shortPage.mockRejectedValue(new PortalRequestError(401));
  const held = new Promise(() => undefined);
  host.portal.mockResolvedValueOnce(session).mockImplementationOnce(() => held);
  await expect(shortRead(workspace)).rejects.toMatchObject({ status: 401 });
  expect(life.clear).toHaveBeenCalledTimes(1); expect(life.pause).toHaveBeenCalledTimes(1); expect(host.reading).not.toHaveBeenCalled(); expect(render()!.concealed).toBe(true);
});

test.each([403, 404])("an authority-bearing exploration page %s still clears and re-checks access", async status => {
  const { workspace, life } = await setup(); host.explorePage.mockRejectedValue(new PortalRequestError(status));
  const held = new Promise(() => undefined);
  host.portal.mockResolvedValueOnce(session).mockImplementationOnce(() => held);
  await expect(workspace.readExplorationPage(baseline, { binding: "synthetic" } as unknown as PreparedExploration, 0, new AbortController().signal)).rejects.toMatchObject({ status });
  expect(life.clear).toHaveBeenCalledTimes(1); expect(life.pause).toHaveBeenCalledTimes(1); expect(host.reading).not.toHaveBeenCalled(); expect(render()!.concealed).toBe(true);
});

test("repeated refusals of a re-checked view stop re-checking automatically and leave the workspace concealed", async () => {
  let { workspace } = await setup();
  for (let i = 0; i < DENIAL_REFRESH_LIMIT; i++) {
    host.portal.mockClear();
    workspace.serviceAuthorityFailed(403); expect(render()!.concealed).toBe(true);
    await flush(); workspace = render()!;
    // The session check passed, so the view was revealed again and may ask again.
    expect(workspace.concealed).toBe(false); expect(host.portal).toHaveBeenCalled();
  }
  host.portal.mockClear();
  workspace.serviceAuthorityFailed(403); await flush();
  expect(host.portal).not.toHaveBeenCalled(); expect(render()).toBeUndefined();
  await flush(); expect(host.portal).not.toHaveBeenCalled(); expect(render()).toBeUndefined();
});
