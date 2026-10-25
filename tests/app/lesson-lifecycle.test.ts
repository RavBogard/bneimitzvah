import { beforeEach, expect, test, vi } from "vitest";
import type { ReactElement, ReactNode } from "react";
import type { Assigned } from "../../src/components/portal/workspace/api";
import type { LessonReload, LessonSummarySnapshot } from "../../src/components/portal/workspace/lessons/panel";

// A DOM-free hook host: exercise the real component's registered lifecycle and
// departure callbacks, without pretending to test native dialog/focus behavior.
const host = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0, effects: [] as (() => void)[], cleanups: [] as (() => void)[], reader: vi.fn(), reload: null as LessonReload | null, epoch: 0, session: "synthetic-binding", work: null as null | { clear(): void; pause(): void; reveal(): void }, guard: null as null | (() => Promise<boolean>) }));
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
const registerWork = (work: NonNullable<typeof host.work>) => { host.work = work; return clear; };
const registerDeparture = (guard: () => Promise<boolean>) => { host.guard = guard; return unregister; };
vi.mock("../../src/components/portal/workspace/provider", () => ({
  statusOf: () => 503, useWorkspaceModal: () => false,
  useWorkspace: () => ({ summary: { sessionBinding: host.session }, epoch: host.epoch, readLessons: host.reader,
    registerWork, registerDeparture,
  }),
}));
vi.mock("../../src/components/portal/workspace/study/lift", () => ({ icons: { close: null } }));
import { LessonLog } from "../../src/components/portal/workspace/lessons/panel";
import { renderToStaticMarkup } from "react-dom/server";
const register = (value: LessonReload) => { host.reload = value; return unregister; };
function render(mode: "parent" | "tutor" | "student" = "tutor", studentId = "synthetic-student") { host.cursor = 0; const tree = LessonLog({ mode, studentId, register, tabbed: true }); host.effects.splice(0).forEach(effect => effect()); return tree; }
function find(node: ReactNode, predicate: (props: Record<string, unknown>) => boolean): ReactElement<Record<string, any>> | undefined {
  if (Array.isArray(node)) { for (const child of node) { const found = find(child, predicate); if (found) return found; } return; }
  if (!node || typeof node !== "object" || !("props" in node)) return;
  const element = node as ReactElement<Record<string, any>>;
  return predicate(element.props) ? element : find(element.props.children, predicate);
}
beforeEach(() => { host.slots = []; host.cursor = 0; host.effects = []; host.cleanups = []; host.work = null; host.guard = null; host.reload = null; host.epoch = 0; host.session = "synthetic-binding"; host.reader.mockReset().mockResolvedValue({ entries: [], nextCursor: null }); });
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

const parentBaseline = (id = "synthetic-student"): Assigned => ({ mode: "parent", context: null, student: { id, firstName: "Synthetic", lastName: "Child", ceremonyDate: "2027-01-02", revision: 1 }, readings: [] });
const saved = (date: string, summary: string) => ({ entryId: date, lessonDate: date, summary, displayName: "Synthetic original author", version: 1, canEdit: false, canDelete: false });
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
test("optional lesson projection retains the newest saved page across quiet reveal and earlier-page pagination without another first-page read", async () => {
  const latest = saved("2026-10-19", "Synthetic newest saved note"), older = saved("2026-10-18", "Synthetic older saved note"), earlier = saved("2026-10-17", "Synthetic earliest saved note");
  host.reader.mockResolvedValueOnce({ entries: [latest, older], nextCursor: { lessonDate: older.lessonDate, entryId: older.entryId } }).mockResolvedValueOnce({ entries: [earlier], nextCursor: null });
  render("parent"); const first = vi.fn<(value: LessonSummarySnapshot) => void>(); host.reload!.snapshot!(first);
  const baseline = parentBaseline(); await host.reload!.reload(baseline, new AbortController().signal); let tree = render("parent");
  expect(first.mock.lastCall![0]).toMatchObject({ baseline, scope: JSON.stringify(["synthetic-binding", 0, "parent", baseline.student.id]), lesson: { status: "ready", latest: { summary: latest.summary, displayName: latest.displayName } } });
  expect(Object.keys(first.mock.lastCall![0].lesson)).toEqual(["status", "latest"]);
  const turn = first.mock.lastCall![0].generation;
  host.work!.pause(); render("parent"); expect(first.mock.lastCall![0].lesson).toEqual({ status: "loading" });
  const current = vi.fn<(value: LessonSummarySnapshot) => void>(); host.reload!.snapshot!(current); host.work!.reveal(); tree = render("parent");
  expect(current.mock.lastCall![0]).toMatchObject({ generation: turn, lesson: { status: "ready", latest: { summary: latest.summary } } }); expect(host.reader).toHaveBeenCalledTimes(1);
  find(tree, props => props.children === "Show earlier lessons")!.props.onClick(); await flush(); render("parent");
  expect(host.reader).toHaveBeenCalledTimes(2); expect(host.reader.mock.calls[1][2]).toEqual({ type: "page", before: { lessonDate: older.lessonDate, entryId: older.entryId } });
  expect(current.mock.lastCall![0].lesson).toMatchObject({ status: "ready", latest: { summary: latest.summary } });
  host.work!.clear(); expect(current.mock.lastCall![0].lesson).toEqual({ status: "loading" });
});
test("replaced lesson reads cannot publish a held old child's saved note", async () => {
  let resolve!: (value: unknown) => void; const gate = new Promise<unknown>(yes => { resolve = yes; });
  host.reader.mockImplementationOnce(() => gate).mockResolvedValueOnce({ entries: [saved("2026-10-19", "Synthetic new child note")], nextCursor: null });
  render("parent"); const seen = vi.fn<(value: LessonSummarySnapshot) => void>(); host.reload!.snapshot!(seen);
  const old = host.reload!.reload(parentBaseline(), new AbortController().signal);
  render("parent", "synthetic-sibling"); await host.reload!.reload(parentBaseline("synthetic-sibling"), new AbortController().signal); render("parent", "synthetic-sibling");
  resolve({ entries: [saved("2026-10-20", "Synthetic old child note")], nextCursor: null }); await old; render("parent", "synthetic-sibling");
  expect(seen.mock.calls.some(([value]) => value.lesson.status === "ready" && value.lesson.latest?.summary === "Synthetic old child note")).toBe(false);
  expect(seen.mock.lastCall![0]).toMatchObject({ lesson: { status: "ready", latest: { summary: "Synthetic new child note" } } });
});

// Release 1.9 N12: "Before next time" on the tutor's note, and where the student and parent see it.
/** Every visible error line in the open note: the X11 rule is one, under the field that is too long. */
function errors(node: ReactNode, found: string[] = []): string[] {
  if (Array.isArray(node)) { for (const child of node) errors(child, found); return found; }
  if (!node || typeof node !== "object" || !("props" in node)) return found;
  const props = (node as ReactElement<Record<string, any>>).props;
  if (typeof props.className === "string" && props.className.split(" ").includes("request-error")) { const text = [props.children].flat().join(""); if (text.trim()) found.push(text); }
  errors(props.children, found); return found;
}
async function openNote(summary = "Synthetic lesson: verse one.") {
  await host.reload!.reload({ ...parentBaseline(), mode: "tutor" }, new AbortController().signal); render();
  find(render(), props => props.className === "button-primary lesson-add")!.props.onClick({ currentTarget: {} });
  find(render(), props => props.rows === 8)!.props.onChange({ target: { value: summary } });
}
const nextField = (tree: ReactNode) => find(tree, props => props.id === "synthetic-lesson-next")!;
const submit = async () => { find(render(), props => props.className === "lesson-form")!.props.onSubmit({ preventDefault() {} }); await flush(); };

test("the tutor's note offers Before next time with the if-then prompt, and sends the line, or null when it is left blank", async () => {
  render(); await openNote();
  const tree = render(), field = nextField(tree);
  expect(find(tree, props => props.htmlFor === "synthetic-lesson-next")!.props.children).toBe("Before next time");
  expect(field.props["aria-describedby"]).toBe("synthetic-lesson-next-help");
  expect(find(tree, props => props.id === "synthetic-lesson-next-help")!.props.children).toBe("When ___, I will ___");
  field.props.onChange({ target: { value: "When I finish dinner on Tuesday, I will chant verse two.\r\n" } });
  await submit();
  const create = host.reader.mock.calls.find(call => call[2].type === "create")![2];
  expect(create).toMatchObject({ type: "create", summary: "Synthetic lesson: verse one.", beforeNext: "When I finish dinner on Tuesday, I will chant verse two.\n" });
  host.reader.mockClear(); render(); await openNote("Synthetic second lesson.");
  nextField(render()).props.onChange({ target: { value: "  \n " } }); await submit();
  expect(host.reader.mock.calls.find(call => call[2].type === "create")![2]).toMatchObject({ summary: "Synthetic second lesson.", beforeNext: null });
});

test("a Before next time line over the limit shows one error, under its field, and Save sends nothing (as X11)", async () => {
  render(); await openNote();
  nextField(render()).props.onChange({ target: { value: "x".repeat(1025) } });
  expect(errors(render())).toEqual(["Too long to save. Shorten this note a little."]);
  host.reader.mockClear(); await submit();
  expect(host.reader.mock.calls.filter(call => call[2].type !== "page")).toHaveLength(0);
  expect(errors(render())).toEqual(["Too long to save. Shorten this note a little."]);
  // Both fields too long: still one line each, and nothing from Save on top of them.
  find(render(), props => props.rows === 8)!.props.onChange({ target: { value: "x".repeat(4100) } }); await submit();
  expect(errors(render())).toEqual(["Too long to save. Shorten this note a little.", "Too long to save. Shorten this note a little."]);
  expect(host.reader.mock.calls.filter(call => call[2].type !== "page")).toHaveLength(0);
  // Back within the limit: the error goes and the line saves.
  find(render(), props => props.rows === 8)!.props.onChange({ target: { value: "Synthetic lesson." } });
  nextField(render()).props.onChange({ target: { value: "x".repeat(1024) } });
  expect(errors(render())).toEqual([]);
  await submit(); expect(host.reader.mock.calls.find(call => call[2].type === "create")![2]).toMatchObject({ beforeNext: "x".repeat(1024) });
});

test("the student reads the newest note's line as Before your next lesson, older lines and the parent's by the field's own name, escaped", async () => {
  const newest = { ...saved("2026-10-22", "Synthetic newest note"), beforeNext: "When I wake up on Sunday, I will sing <i>the blessing</i>." };
  const older = { ...saved("2026-10-15", "Synthetic older note"), beforeNext: "When school ends, I will review verse one." };
  const none = saved("2026-10-08", "Synthetic note without a line");
  for (const mode of ["student", "parent", "tutor"] as const) {
    host.reader.mockReset().mockResolvedValue({ entries: [newest, older, { ...none, beforeNext: null }], nextCursor: null });
    render(mode); await host.reload!.reload({ ...parentBaseline(), mode }, new AbortController().signal);
    const markup = renderToStaticMarkup(render(mode) as ReactElement);
    expect(markup).toContain("When I wake up on Sunday, I will sing &lt;i&gt;the blessing&lt;/i&gt;."); expect(markup).not.toContain("<i>");
    expect(markup).toContain("When school ends, I will review verse one.");
    expect(markup.match(/Before your next lesson:/g)?.length ?? 0, mode).toBe(mode === "student" ? 1 : 0);
    expect(markup.match(/Before next time:/g)?.length ?? 0, mode).toBe(mode === "student" ? 1 : 2);
    if (mode === "student") expect(markup.indexOf("Before your next lesson:")).toBeLessThan(markup.indexOf("Synthetic older note"));
  }
});
