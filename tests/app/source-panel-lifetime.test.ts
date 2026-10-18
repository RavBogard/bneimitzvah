import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import type { Assigned } from "../../src/components/portal/workspace/api";
import { SourceClientError, type CurrentSources, type SourceAssignmentClient, type SourceCommit, type SourceIntent, type SourcePage } from "../../src/components/portal/workspace/study/sources/api";
import { createSourcePanelLifetime, refreshSourceReading, SourcesPanel } from "../../src/components/portal/workspace/study/sources/panel";
import { SourceDepartureReview } from "../../src/components/portal/workspace/study/sources/departure-review";
import type { SourceDeparture } from "../../src/components/portal/workspace/study/sources/selection";

const workspace = vi.hoisted(() => ({ createSources: vi.fn(), registerWork: vi.fn(), registerDeparture: vi.fn(), guardDeparture: vi.fn() }));
vi.mock("../../src/components/portal/workspace/provider", () => ({ useWorkspace: () => workspace, useWorkspaceModal: () => false }));
const ref = "Genesis 1:1", H = "a".repeat(64), citation = Object.freeze({ id: "invented_1", ref: "Invented Work 1", indexTitle: "Invented Work", category: "Commentary", labels: Object.freeze({ en: "Invented title", he: null }) });
const held = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
const commit = (intent: SourceIntent): SourceCommit => Object.freeze({ outcome: "committed", committedVersion: intent.expectedVersion + 1, currentLatestVersion: intent.expectedVersion + 1, committed: Object.freeze({ version: intent.expectedVersion + 1, citations: Object.freeze(intent.sourceIds.length ? [citation] : []), createdAt: "2026-10-17T00:00:00.000Z" }) });
function api(overrides: Partial<SourceAssignmentClient> = {}): SourceAssignmentClient {
  return { ref, canEdit: true, read: vi.fn(async (): Promise<CurrentSources> => Object.freeze({ currentVersion: 0, citations: Object.freeze([]) })),
    discover: vi.fn(async (): Promise<SourcePage> => Object.freeze({ schema: "study-related-page/v1", ref, catalogHash: H, sourceOffset: 0, pageSize: 10, totalEntries: 1, receivedRows: 1, heldCount: 0, duplicateCount: 0, nextSourceOffset: null, entries: Object.freeze([citation]) })),
    write: vi.fn(async intent => commit(intent)), receipt: vi.fn(async () => Object.freeze({ outcome: "unconfirmed" as const })), ...overrides };
}
function fixture(client = api()) { const onState = vi.fn(), onReview = vi.fn(), session = createSourcePanelLifetime({ scopeKey: "actual-scope", api: client, onState, onReview }); return { client, onState, onReview, session }; }
async function dirty(f = fixture()) { await f.session.owner.open(); await f.session.owner.browse(); f.session.owner.select(citation.id, true); return f; }
afterEach(() => { vi.clearAllMocks(); });

it("constructs closed without fetching; the same-scope owner retains local choices without autosave", async () => {
  const f = fixture(); expect(f.client.read).not.toHaveBeenCalled(); expect(f.client.discover).not.toHaveBeenCalled(); expect(f.session.owner.state.open).toBe(false);
  await dirty(f); const owner = f.session.owner, draft = owner.state.draftIds; await f.session.settle();
  expect(f.session.owner).toBe(owner); expect(f.session.owner.state.draftIds).toEqual(draft); expect(f.session.hasUnsaved()).toBe(true); expect(f.client.write).not.toHaveBeenCalled(); f.session.dispose();
});
it("coalesces dirty departure prompts, keeps draft on Keep working and requires explicit discard", async () => {
  const f = await dirty(), first = f.session.guard(), second = f.session.guard(); expect(first).toBe(second); expect(f.onReview).toHaveBeenLastCalledWith({ kind: "dirty", actions: ["keep-editing", "discard"] });
  expect(f.session.reset()).toBe(false); f.session.keep(); expect(await first).toBe(false); expect(f.session.owner.state.draftIds).toEqual([citation.id]);
  const next = f.session.guard(); f.session.leave(); expect(await next).toBe(true); expect(f.session.owner.state.phase).toBe("disposed"); expect(f.client.write).not.toHaveBeenCalled();
  expect(f.session.reset()).toBe(true); expect(f.session.owner.state.open).toBe(false); expect(f.session.owner.state.current).toBeNull(); await f.session.owner.open(); expect(f.client.read).toHaveBeenCalledTimes(2); f.session.dispose();
});
it("does not wait indefinitely on an in-flight save and explicitly abandons without confirming its outcome", async () => {
  const gate = held<SourceCommit>(), entered = held<SourceIntent>(), f = fixture(api({ write: vi.fn(write => { entered.resolve(write); return gate.promise; }) })); await dirty(f);
  const pending = f.session.owner.save(), intent = await entered.promise; await f.session.settle(); expect(f.session.owner.state.phase).toBe("saving");
  const review = f.session.guard(); expect(f.onReview).toHaveBeenLastCalledWith({ kind: "uncertain", actions: ["stay", "abandon"], saveMayComplete: true }); f.session.keep(); expect(await review).toBe(false); expect(f.session.owner.state.pending).toBe(intent);
  const departure = f.session.guard(); f.session.leave(); expect(await departure).toBe(true); expect(f.session.owner.state.current).toBeNull(); expect(f.session.reset()).toBe(true);
  await f.session.owner.open(); gate.resolve(commit(intent)); expect(await pending).toBe(false); expect(f.session.owner.state.current?.currentVersion).toBe(0); expect(f.session.owner.state.lastCommit).toBeNull(); f.session.dispose();
});
it("missing receipts never create a permanent navigation lock or a new automatic save", async () => {
  const f = fixture(api({ write: vi.fn(async () => { throw new SourceClientError(); }) })); await dirty(f); await f.session.owner.save();
  const original = f.session.owner.state.pending; await f.session.owner.reconcile(); expect(f.session.owner.state.pending).toBe(original); expect(f.session.owner.state.phase).toBe("unknown"); expect(f.client.write).toHaveBeenCalledTimes(1);
  const leave = f.session.guard(); f.session.leave(); expect(await leave).toBe(true); expect(f.session.reset()).toBe(true); await f.session.owner.open(); expect(f.client.write).toHaveBeenCalledTimes(1); f.session.dispose();
});
it("actual scope clear cancels an open prompt and drops private state without asking permission", async () => {
  const f = await dirty(), leave = f.session.guard(); f.session.clear(); expect(await leave).toBe(false); expect(f.session.owner.state.phase).toBe("disposed"); expect(f.session.owner.state.current).toBeNull(); expect(f.session.owner.state.draftIds).toEqual([]); expect(f.onReview).toHaveBeenLastCalledWith(null); f.session.dispose();
});
it("blocking lifecycle pause fences late reads; disposal prevents a late modal response from changing a replacement", async () => {
  const gate = held<CurrentSources>(), f = fixture(api({ read: vi.fn(() => gate.promise) })), read = f.session.owner.open(); f.session.pause(); gate.resolve({ currentVersion: 1, citations: [citation] }); expect(await read).toBe(false); expect(f.session.owner.state.current).toBeNull();
  const original = await dirty(), leaving = original.session.guard(); original.session.dispose(); expect(await leaving).toBe(false);
  const replacement = fixture(); await replacement.session.owner.open(); original.session.leave(); expect(replacement.session.owner.state.phase).toBe("ready"); replacement.session.dispose(); f.session.dispose();
});
it("a delayed approved refresh cannot act on replacement metadata, while current approval still refreshes", async () => {
  const original = fixture(), replacement = fixture(), current = { current: original.session }, gate = held<boolean>(), refresh = vi.fn(async () => undefined);
  const pending = refreshSourceReading(current, () => gate.promise, refresh); original.session.dispose(); current.current = replacement.session; gate.resolve(true);
  expect(await pending).toBe(false); expect(refresh).not.toHaveBeenCalled();
  expect(await refreshSourceReading(current, async () => false, refresh)).toBe(false); expect(refresh).not.toHaveBeenCalled();
  expect(await refreshSourceReading(current, async () => true, refresh)).toBe(true); expect(refresh).toHaveBeenCalledOnce(); replacement.session.dispose();
});
it("renders one initially closed disclosure with no read, browse, save or content action", () => {
  const base: Assigned = { mode: "student", student: { id: "10000000-0000-4000-8000-000000000001", revision: 1, firstName: "Synthetic", lastName: "Sources", ceremonyDate: "2027-01-02" }, context: null, readings: [] };
  const html = renderToStaticMarkup(createElement(SourcesPanel, { scopeKey: "closed", baseline: base, kind: "torah", offset: 0, onRefreshReading: async () => undefined }));
  expect(html).toContain('aria-expanded="false"'); expect(html).toContain(">Sources</button>"); expect(html).not.toContain("Browse related sources"); expect(html).not.toContain("Save sources"); expect(html).not.toContain("Read source"); expect(workspace.createSources).not.toHaveBeenCalled();
});
it("renders distinct dirty/uncertain departure semantics without promising rollback or displaying request internals", () => {
  const render = (review: SourceDeparture) => renderToStaticMarkup(createElement(SourceDepartureReview, { review, onKeep() {}, onLeave() {} }));
  const dirtyHtml = render({ kind: "dirty", actions: ["keep-editing", "discard"] }), uncertain = render({ kind: "uncertain", actions: ["stay", "abandon"], saveMayComplete: true });
  expect(dirtyHtml).toContain("Keep working"); expect(dirtyHtml).toContain("Discard changes"); expect(uncertain).toContain("Leave without confirming"); expect(uncertain).toContain("may still complete"); expect(uncertain).not.toMatch(/UUID|COMMIT|rollback|cancelled/i);
});
