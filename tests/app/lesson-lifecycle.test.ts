import { beforeEach, expect, test, vi } from "vitest";
import type { ReactElement, ReactNode } from "react";

// A DOM-free hook host: exercise the real component's registered lifecycle and
// departure callbacks, without pretending to test native dialog/focus behavior.
const host = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0, effects: [] as (() => void)[], cleanups: [] as (() => void)[], work: null as null | { clear(): void }, guard: null as null | (() => Promise<boolean>) }));
vi.mock("react", async load => {
  const actual = await load<typeof import("react")>();
  return { ...actual,
    useId: () => "synthetic-lesson",
    useRef: (value: unknown) => { const i = host.cursor++; return host.slots[i] ??= { current: value }; },
    useState: (value: unknown) => { const i = host.cursor++; if (!(i in host.slots)) host.slots[i] = value; return [host.slots[i], (next: unknown) => { host.slots[i] = typeof next === "function" ? next(host.slots[i]) : next; }]; },
    useCallback: (callback: unknown, deps: unknown[]) => { const i = host.cursor++, previous = host.slots[i] as { deps: unknown[]; callback: unknown } | undefined; if (!previous || deps.some((value, index) => value !== previous.deps[index])) host.slots[i] = { deps, callback }; return (host.slots[i] as { callback: unknown }).callback; },
    useEffect: () => undefined,
    useLayoutEffect: (effect: () => void | (() => void), deps: unknown[]) => {
      const i = host.cursor++, previous = host.slots[i] as unknown[] | undefined;
      if (!previous || deps.some((value, index) => value !== previous[index])) host.effects.push(() => { const cleanup = effect(); if (cleanup) host.cleanups.push(cleanup); });
      host.slots[i] = deps;
    },
  };
});
const clear = () => { host.work = null; }, unregister = () => undefined;
const registerWork = (work: { clear(): void }) => { host.work = work; return clear; };
const registerDeparture = (guard: () => Promise<boolean>) => { host.guard = guard; return unregister; };
vi.mock("../../src/components/portal/workspace/provider", () => ({
  statusOf: () => 503, useWorkspaceModal: () => false,
  useWorkspace: () => ({ summary: { sessionBinding: "synthetic-binding" }, epoch: 0, readLessons: undefined,
    registerWork, registerDeparture,
  }),
}));
vi.mock("../../src/components/portal/workspace/study/lift", () => ({ icons: { close: null } }));
import { LessonLog } from "../../src/components/portal/workspace/lessons/panel";
const register = () => unregister;
function render() { host.cursor = 0; const tree = LessonLog({ mode: "tutor", studentId: "synthetic-student", register, tabbed: true }); host.effects.splice(0).forEach(effect => effect()); return tree; }
function find(node: ReactNode, predicate: (props: Record<string, unknown>) => boolean): ReactElement<Record<string, any>> | undefined {
  if (Array.isArray(node)) { for (const child of node) { const found = find(child, predicate); if (found) return found; } return; }
  if (!node || typeof node !== "object" || !("props" in node)) return;
  const element = node as ReactElement<Record<string, any>>;
  return predicate(element.props) ? element : find(element.props.children, predicate);
}
beforeEach(() => { host.slots = []; host.cursor = 0; host.effects = []; host.cleanups = []; host.work = null; host.guard = null; });
test.each(["authority clear", "unmount"])("%s cancels a pending lesson departure instead of authorizing its continuation", async cause => {
  let tree = render();
  find(tree, props => props.className === "button-primary lesson-add")!.props.onClick({ currentTarget: {} });
  tree = render();
  find(tree, props => props.rows === 8)!.props.onChange({ target: { value: "Synthetic unsent lesson" } });
  render();
  const continuation = host.guard!();
  let resolved = false; void continuation.then(() => { resolved = true; }); await Promise.resolve();
  expect(resolved).toBe(false);
  if (cause === "authority clear") host.work!.clear();
  else host.cleanups.splice(0).forEach(cleanup => cleanup());
  await expect(continuation).resolves.toBe(false);
});
