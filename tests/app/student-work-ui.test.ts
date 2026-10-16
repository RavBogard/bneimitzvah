import { afterEach, expect, it, vi } from "vitest";
import type { Assigned } from "../../src/components/portal/workspace/api";
import { fetchWork, normalizeWork, parseWorkHistory, parseWorkPage, parseWorkReceipt, WorkError, workTextError, type WorkOperation, type WorkPage, type WorkVersion } from "../../src/components/portal/workspace/work/api";
import { WorkCoordinator, type WorkTransport } from "../../src/components/portal/workspace/work/coordinator";

const id = "10000000-0000-4000-8000-000000000001", assignmentId = "10000000-0000-4000-8000-000000000002", ref = "Genesis 1:1";
const baseline: Assigned = { mode: "student", student: { id, firstName: "Synthetic", lastName: "Work", ceremonyDate: "2027-01-02", revision: 1 }, context: null,
  readings: [{ id: assignmentId, kind: "torah", revision: 1, ranges: ["Genesis 1:1-12"], verses: Array.from({ length: 12 }, (_, i) => `Genesis 1:${i + 1}`), needsReview: false, basis: "custom", confirmationDate: null, source: { status: "unknown", fetchedAt: null, date: null, calendar: null, attribution: null } }] };
function version(n = 1, text = "Synthetic work", verseRef = ref): WorkVersion { return { id, verseRef, version: n, text, assignmentId, assignmentRevision: 1, author: { membershipId: id, displayName: "Portal member", mode: "student", assisted: false }, createdAt: "2026-10-16T10:00:00.000Z" }; }
function page(head: WorkVersion | null = null, offset = 0, count = 2): WorkPage { return { offset, totalVerses: 12, nextOffset: offset + count < 12 ? offset + count : null, verses: baseline.readings[0].verses.slice(offset, offset + count).map(ref => ({ ref, draft: head?.verseRef === ref ? head : null, notes: [] })) }; }
function response(value: unknown, status = 200) { return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } }); }
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it("parses exact adaptive work pages, empty clears, Unicode, safe attribution and maximum versions without study-text normalization", () => {
  const value = { ok: true, studentId: id, assignmentId, assignmentRevision: 1, ...page(version(2147483647, " <b>שָׁלוֹם</b> 😀 e\u0301 \n\t")) };
  expect(parseWorkPage(value, baseline, "torah", 0).nextOffset).toBe(2);
  expect(parseWorkPage({ ...value, verses: [{ ref, draft: version(1, ""), notes: [] }] , nextOffset: 1 }, baseline, "torah", 0).verses[0].draft?.text).toBe("");
  for (const bad of [{ ...value, extra: true }, { ...value, nextOffset: 10 }, { ...value, assignmentRevision: 2 }, { ...value, verses: [{ ref: "Genesis 1:2", draft: null, notes: [] }] },
    { ...value, verses: [{ ref, draft: { ...version(), author: { ...version().author, displayName: "unsafe@example.test" } }, notes: [] }] }]) expect(() => parseWorkPage(bad, baseline, "torah", 0)).toThrow();
  expect(normalizeWork(" \r\nא\r\t")).toBe(" \nא\n\t"); expect(workTextError("😀".repeat(1024), "draft")).toBeNull(); expect(workTextError("😀".repeat(1025), "draft")).not.toBeNull();
  expect(workTextError(" \n\t", "draft")).toBeNull(); expect(workTextError(" \n\t", "note")).not.toBeNull(); expect(workTextError("\ud800", "draft")).not.toBeNull();
});

it("bounds exclusive history cursors and distinguishes committed version from latest head", () => {
  const versions = Array.from({ length: 20 }, (_, i) => version(30 - i));
  expect(parseWorkHistory({ ok: true, versions, nextBeforeVersion: 11 }, ref, "draft").nextBeforeVersion).toBe(11);
  expect(() => parseWorkHistory({ ok: true, versions, nextBeforeVersion: 10 }, ref, "draft")).toThrow();
  expect(() => parseWorkHistory({ ok: true, versions, nextBeforeVersion: 11 }, ref, "draft", 30)).toThrow();
  const operation: WorkOperation = { type: "draft", verseRef: ref, text: "Synthetic work", expectedVersion: 0, mutationId: id };
  expect(parseWorkReceipt({ ok: true, replayed: true, committedVersion: 1, currentLatestVersion: 2, committed: version() }, operation, { id: assignmentId, revision: 1 }).currentLatestVersion).toBe(2);
  expect(() => parseWorkReceipt({ ok: true, replayed: false, committedVersion: 1, currentLatestVersion: 1, committed: version(1, "different") }, operation, { id: assignmentId, revision: 1 })).toThrow();
});

it("uses bounded no-store same-origin transport and keeps conflict distinct from stale revision and malformed success", async () => {
  let request: RequestInit | undefined;
  vi.stubGlobal("fetch", vi.fn(async (_url: string, input: RequestInit) => { request = input; return response({ ok: false, code: "stale-revision" }, 409); }));
  await expect(fetchWork(baseline, "torah", { type: "page", offset: 0 }, new AbortController().signal)).rejects.toMatchObject({ status: 409, code: "stale-revision" });
  expect(request?.credentials === "same-origin" && request.cache === "no-store" && request.referrerPolicy === "no-referrer" && request.redirect === "error").toBe(true);
  vi.stubGlobal("fetch", vi.fn(async () => response({ error: "invalid-request" }, 400)));
  await expect(fetchWork(baseline, "torah", { type: "page", offset: 0 }, new AbortController().signal)).rejects.toMatchObject({ status: 400, code: "invalid-request" });
  vi.stubGlobal("fetch", vi.fn(async () => new Response('"' + "x".repeat(256 * 1024) + '"', { headers: { "content-type": "application/json" } })));
  await expect(fetchWork(baseline, "torah", { type: "page", offset: 0 }, new AbortController().signal)).rejects.toMatchObject({ status: 503 });
});

async function setup(transport: WorkTransport, verify: (signal: AbortSignal) => Promise<Assigned> = async () => baseline) {
  const denied = vi.fn(), coordinator = new WorkCoordinator(transport, verify, denied); coordinator.configure(baseline); await coordinator.reload(new AbortController().signal, "torah"); coordinator.accept(coordinator.lifecycle); coordinator.reveal(); return { coordinator, denied };
}
it("debounces outside composition, freezes each operation and writes only the latest queued edit after one acknowledgement", async () => {
  vi.useFakeTimers(); let release!: (value: unknown) => void; const writes: WorkOperation[] = [];
  const { coordinator: c } = await setup(async (_b, _k, op) => { if (op.type === "page") return page(); writes.push(op); return new Promise(resolve => { release = resolve as typeof release; }); });
  c.composition("torah", ref, "draft", true); c.edit("torah", ref, "draft", "א"); await vi.advanceTimersByTimeAsync(1600); expect(writes.length).toBe(0);
  c.composition("torah", ref, "draft", false); await vi.advanceTimersByTimeAsync(800); expect(writes.length).toBe(1);
  const original = c.cell("torah", ref, "draft")!.pending!; expect(Object.isFrozen(original)).toBe(true);
  c.edit("torah", ref, "draft", "Synthetic queued one"); c.edit("torah", ref, "draft", "Synthetic queued latest"); await c.save("torah", ref, "draft"); expect(writes.length).toBe(1); expect(original.text).toBe("א");
  release({ committedVersion: 1, currentLatestVersion: 1, committed: version(1, "א") }); await c.settle(); await vi.advanceTimersByTimeAsync(800);
  expect(writes.length).toBe(2); const next = c.cell("torah", ref, "draft")!.pending!; expect(next.expectedVersion === 1 && next.text === "Synthetic queued latest" && next.mutationId !== original.mutationId).toBe(true);
  release({ committedVersion: 2, currentLatestVersion: 2, committed: version(2, next.text) }); await c.settle(); expect(c.hasUnsaved()).toBe(false); c.clear();
});

it("reconciles a committed lost acknowledgement with a newer head without overwriting queued text or sending another write", async () => {
  vi.useFakeTimers(); let head: WorkVersion | null = null, writes = 0;
  const { coordinator: c } = await setup(async (_b, _k, op) => {
    if (op.type === "page") return page(head);
    if (op.type === "receipt") return { committedVersion: 1, currentLatestVersion: head!.version, committed: version(1, "Synthetic first") };
    writes++; head = version(1, "Synthetic first"); throw new WorkError(503);
  });
  c.edit("torah", ref, "draft", "Synthetic first"); await c.save("torah", ref, "draft"); const pending = c.cell("torah", ref, "draft")!.pending;
  c.edit("torah", ref, "draft", "Synthetic queued"); head = version(2, "Synthetic other tab"); await c.recover("torah", ref, "draft");
  const cell = c.cell("torah", ref, "draft")!; expect(cell.phase === "conflict" && cell.text === "Synthetic queued" && cell.head?.version === 2 && cell.committedEarlier === 1 && !cell.pending && Boolean(pending)).toBe(true);
  await vi.advanceTimersByTimeAsync(1600); expect(writes).toBe(1); c.clear();
});

it("a receipt 404 permits only identical-body retry after metadata and head revalidation; drift clears instead", async () => {
  vi.useFakeTimers(); const writes: WorkOperation[] = []; let metadata = baseline;
  const { coordinator: c, denied } = await setup(async (_b, _k, op) => { if (op.type === "page") return page(); if (op.type === "receipt") throw new WorkError(404); writes.push(op); throw new WorkError(503); }, async () => metadata);
  c.edit("torah", ref, "draft", "Synthetic original"); await c.save("torah", ref, "draft"); c.edit("torah", ref, "draft", "Synthetic newer typing");
  await c.recover("torah", ref, "draft", true); expect(writes.length === 2 && writes[0] === writes[1]).toBe(true);
  metadata = { ...baseline, readings: [{ ...baseline.readings[0], revision: 2 }] }; await c.recover("torah", ref, "draft", true); expect(writes.length).toBe(2); expect(c.hasUnsaved()).toBe(false); expect(denied).toHaveBeenCalledWith(409); c.clear();
});

it("pause settles bounded writes, fences late callbacks after clear, and preserves staged text through a same-binding work outage", async () => {
  vi.useFakeTimers(); let release!: (value: unknown) => void, unavailable = false;
  const { coordinator: c } = await setup(async (_b, _k, op) => { if (op.type === "page") { if (unavailable) throw new WorkError(503); return page(); } return new Promise(resolve => { release = resolve as typeof release; }); });
  c.edit("torah", ref, "draft", "Synthetic staged"); c.pause(); await vi.advanceTimersByTimeAsync(1600); unavailable = true; await c.reload(new AbortController().signal, "torah");
  expect(c.cell("torah", ref, "draft")?.text === "Synthetic staged" && !c.cell("torah", ref, "draft")?.verified).toBe(true);
  unavailable = false; await c.reload(new AbortController().signal, "torah"); c.accept(c.lifecycle); c.reveal(); const saving = c.save("torah", ref, "draft"); c.pause(); let settled = false; void c.settle().then(() => { settled = true; }); await Promise.resolve(); expect(settled).toBe(false);
  c.clear(); release({ committedVersion: 1, currentLatestVersion: 1, committed: version(1, "Synthetic staged") }); await saving; expect(c.scope("torah")).toBeUndefined(); expect(c.hasUnsaved()).toBe(false);
});

it("requires deliberate note submission and departure review; cancel retains the verse, discard never posts, successful save allows departure", async () => {
  vi.useFakeTimers(); let head: WorkVersion | null = null, writes = 0;
  const { coordinator: c } = await setup(async (_b, _k, op) => { if (op.type === "page") return page(head); if (op.type !== "draft" && op.type !== "note") throw new Error("Unexpected test operation"); writes++; head = version(op.expectedVersion + 1, op.text); return { committedVersion: head.version, currentLatestVersion: head.version, committed: head }; });
  c.edit("torah", ref, "note", "Synthetic explicit note"); await vi.advanceTimersByTimeAsync(1600); expect(writes).toBe(0);
  const cancel = c.guard(); await c.depart("cancel"); expect(await cancel).toBe(false); expect(c.cell("torah", ref, "note")?.text).toBe("Synthetic explicit note");
  const discard = c.guard(); await c.depart("discard"); expect(await discard).toBe(true); expect(writes).toBe(0);
  await c.reload(new AbortController().signal, "torah"); c.edit("torah", ref, "draft", "Synthetic next"); const leave = c.guard(); await c.depart("save"); expect(await leave).toBe(true); expect(writes).toBe(1); c.clear();
});

it("ignores a held old head after a newer acknowledged save and orders competing page reads", async () => {
  vi.useFakeTimers(); let hold = false, release!: (value: WorkPage) => void, head: WorkVersion | null = null;
  const { coordinator: c } = await setup(async (_b, _k, op) => {
    if (op.type === "page") { if (hold) return new Promise(resolve => { release = resolve; }); return page(head, op.offset); }
    if (op.type !== "draft") throw new Error("Unexpected operation"); head = version(1, op.text); return { committedVersion: 1, currentLatestVersion: 1, committed: head };
  });
  hold = true; const old = c.loadPage("torah", 0); c.edit("torah", ref, "draft", "Synthetic newer saved"); await c.save("torah", ref, "draft"); release(page()); await old;
  expect(c.cell("torah", ref, "draft")?.text === "Synthetic newer saved" && c.cell("torah", ref, "draft")?.head?.version === 1).toBe(true);
  const oldPage = c.loadPage("torah", 2), releaseOld = release; const newPage = c.loadPage("torah", 4); release(page(null, 4)); await newPage; releaseOld(page(null, 2)); await oldPage;
  expect(c.scope("torah")?.offset).toBe(4); c.clear();
});

it("rejects plausible receipts that do not match the frozen logical operation", async () => {
  vi.useFakeTimers(); const { coordinator: c } = await setup(async (_b, _k, op) => {
    if (op.type === "page") return page(); if (op.type === "receipt") return { committedVersion: 1, currentLatestVersion: 1, committed: version(1, "Synthetic unrelated") }; throw new WorkError(503);
  });
  c.edit("torah", ref, "draft", "Synthetic intended"); await c.save("torah", ref, "draft"); const pending = c.cell("torah", ref, "draft")?.pending;
  await c.recover("torah", ref, "draft"); expect(c.cell("torah", ref, "draft")?.phase === "unknown" && c.cell("torah", ref, "draft")?.pending === pending).toBe(true); c.clear();
});

it("keeps a newer head already observed while an earlier append acknowledgement was held", async () => {
  vi.useFakeTimers(); let head: WorkVersion | null = null, release!: (value: unknown) => void;
  const { coordinator: c } = await setup(async (_b, _k, op) => { if (op.type === "page") return page(head); return new Promise(resolve => { release = resolve as typeof release; }); });
  c.edit("torah", ref, "draft", "Synthetic held earlier"); const saving = c.save("torah", ref, "draft"); c.edit("torah", ref, "draft", "Synthetic retained queued");
  head = version(2, "Synthetic known newer"); await c.loadPage("torah", 0); release({ committedVersion: 1, currentLatestVersion: 1, committed: version(1, "Synthetic held earlier") }); await saving;
  const cell = c.cell("torah", ref, "draft")!; expect(cell.phase === "conflict" && cell.head?.version === 2 && cell.head.text === "Synthetic known newer" && cell.text === "Synthetic retained queued" && cell.committedEarlier === 1 && !cell.pending).toBe(true); c.clear();
});

it("a pause fences a held reload from resuming autosave, and an open departure blocks blur saves", async () => {
  vi.useFakeTimers(); let hold = false, release!: (value: WorkPage) => void, writes = 0;
  const { coordinator: c } = await setup(async (_b, _k, op) => {
    if (op.type === "page") { if (hold) return new Promise(resolve => { release = resolve; }); return page(); } writes++; throw new WorkError(503);
  });
  c.edit("torah", ref, "draft", "Synthetic queued"); hold = true; const loading = c.reload(new AbortController().signal, "torah"); c.pause(); release(page());
  // reload may have further staged/current reads; all share its obsolete lifecycle.
  hold = false; await loading; await vi.advanceTimersByTimeAsync(1600); expect(writes).toBe(0);
  await c.reload(new AbortController().signal, "torah"); c.accept(c.lifecycle); c.reveal(); const leave = c.guard(); await c.save("torah", ref, "draft"); expect(writes).toBe(0); await c.depart("cancel"); expect(await leave).toBe(false); c.clear();
});

it("does not dispatch after work alone completes; reading acceptance and provider reveal are both required", async () => {
  vi.useFakeTimers(); let writes = 0;
  const { coordinator: c } = await setup(async (_b, _k, op) => { if (op.type === "page") return page(); writes++; throw new WorkError(503); });
  c.edit("torah", ref, "draft", "Synthetic barrier queued"); c.pause(); const epoch = c.lifecycle; await c.reload(new AbortController().signal, "torah");
  await vi.advanceTimersByTimeAsync(1600); expect(writes).toBe(0); c.reveal(); await vi.advanceTimersByTimeAsync(1600); expect(writes).toBe(0);
  c.accept(epoch); await vi.advanceTimersByTimeAsync(1600); expect(writes).toBe(0); c.reveal(); await vi.advanceTimersByTimeAsync(800); expect(writes).toBe(1); c.clear();
});

it("never marks an earlier committed head current if fetching the known newer head fails", async () => {
  vi.useFakeTimers(); let unavailable = false;
  const { coordinator: c } = await setup(async (_b, _k, op) => { if (op.type === "page") { if (unavailable) throw new WorkError(503); return page(); }
    unavailable = true; return { committedVersion: 1, currentLatestVersion: 2, committed: version(1, "Synthetic earlier") };
  });
  c.edit("torah", ref, "draft", "Synthetic earlier"); await c.save("torah", ref, "draft"); const cell = c.cell("torah", ref, "draft")!;
  expect(cell.phase === "conflict" && !cell.verified && cell.committedEarlier === 1).toBe(true); c.clear();
});

it("waits for aborted recovery to settle before completing a lifecycle barrier", async () => {
  vi.useFakeTimers(); let release!: (value: Assigned) => void;
  const { coordinator: c } = await setup(async (_b, _k, op) => { if (op.type === "page") return page(); throw new WorkError(503); }, async () => new Promise(resolve => { release = resolve; }));
  c.edit("torah", ref, "draft", "Synthetic unknown recovery"); await c.save("torah", ref, "draft"); const recovery = c.recover("torah", ref, "draft"); c.pause(); let settled = false; const barrier = c.settle().then(() => { settled = true; });
  await Promise.resolve(); expect(settled).toBe(false); release(baseline); await recovery; await barrier; expect(c.cell("torah", ref, "draft")?.phase === "unknown" && Boolean(c.cell("torah", ref, "draft")?.pending)).toBe(true); c.clear();
});

it("requires review before overflowing staged page budget and cancellation preserves the active verse", async () => {
  vi.useFakeTimers(); const { coordinator: c } = await setup(async (_b, _k, op) => { if (op.type === "page") return page(null, op.offset); throw new WorkError(503); });
  for (const ref of ["Genesis 1:1", "Genesis 1:3", "Genesis 1:5"]) { await c.open("torah", ref); c.edit("torah", ref, "draft", "Synthetic retained page edit"); }
  const opening = c.open("torah", "Genesis 1:7"); expect(c.departure).not.toBeNull(); await c.depart("cancel"); await opening;
  expect(c.active?.ref).toBe("Genesis 1:5"); expect(c.scope("torah")?.pages.size).toBe(3); c.clear();
});
