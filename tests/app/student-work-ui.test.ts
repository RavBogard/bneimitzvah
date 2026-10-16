import { afterEach, expect, it, vi } from "vitest";
import type { Assigned } from "../../src/components/portal/workspace/api";
import { fetchWork, normalizeWork, parseWorkHistory, parseWorkPage, parseWorkReceipt, parseWorkRecovery, WorkError, workTextError, type WorkOperation, type WorkPage, type WorkVersion } from "../../src/components/portal/workspace/work/api";
import { WorkCoordinator, type WorkTransport } from "../../src/components/portal/workspace/work/coordinator";

const id = "10000000-0000-4000-8000-000000000001", assignmentId = "10000000-0000-4000-8000-000000000002", ref = "Genesis 1:1";
const baseline: Assigned = { mode: "student", student: { id, firstName: "Synthetic", lastName: "Work", ceremonyDate: "2027-01-02", revision: 1 }, context: null,
  readings: [{ id: assignmentId, kind: "torah", revision: 1, ranges: ["Genesis 1:1-12"], verses: Array.from({ length: 12 }, (_, i) => `Genesis 1:${i + 1}`), needsReview: false, basis: "custom", confirmationDate: null, source: { status: "unknown", fetchedAt: null, date: null, calendar: null, attribution: null } }] };
function version(n = 1, text = "Synthetic work", verseRef = ref): WorkVersion { return { id, verseRef, version: n, text, assignmentId, assignmentRevision: 1, author: { membershipId: id, displayName: "Portal member", mode: "student", assisted: false }, createdAt: "2026-10-16T10:00:00.000Z" }; }
function page(head: WorkVersion | null = null, offset = 0, count = 2): WorkPage { return { authorityBinding: "a".repeat(43), offset, totalVerses: 12, nextOffset: offset + count < 12 ? offset + count : null, verses: baseline.readings[0].verses.slice(offset, offset + count).map(ref => ({ ref, draft: head?.verseRef === ref ? head : null, notes: [] })) }; }
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

it("same-revision receipt absence permits only identical-body retry; a newer revision enters blocked recovery", async () => {
  vi.useFakeTimers(); const writes: WorkOperation[] = []; let metadata = baseline;
  const { coordinator: c, denied } = await setup(async (_b, _k, op) => { if (op.type === "page") return page(); if (op.type === "receipt") throw new WorkError(404); writes.push(op); throw new WorkError(503); }, async () => metadata);
  c.edit("torah", ref, "draft", "Synthetic original"); await c.save("torah", ref, "draft"); c.edit("torah", ref, "draft", "Synthetic newer typing");
  await c.recover("torah", ref, "draft", true); expect(writes.length === 2 && writes[0] === writes[1]).toBe(true);
  metadata = { ...baseline, readings: [{ ...baseline.readings[0], revision: 2 }] }; await c.recover("torah", ref, "draft", true); expect(writes.length).toBe(2); expect(c.hasUnsaved()).toBe(true); expect(c.cell("torah", ref, "draft")?.revisionRecovery?.outcome).toBe("unknown"); expect(denied).toHaveBeenCalledWith(409); c.clear();
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

const revised = (revision = 2): Assigned => ({ ...baseline, readings: [{ ...baseline.readings[0], revision }] });
async function refresh(c: WorkCoordinator, value = revised()) { c.pause(); await c.settle(); c.configure(value, true); await c.reload(new AbortController().signal, "torah"); c.accept(c.lifecycle); c.reveal(); }
function recoveryProof(op: Extract<WorkOperation, { type: "recovery" }>, outcome: "absent" | "committed", head?: WorkVersion) {
  return { assignmentId, assignmentRevision: 2, originalRevision: op.originalRevision, mutationId: op.write.mutationId, verseRef: op.write.verseRef, stream: op.stream, authorityBinding: op.authorityBinding, outcome,
    receipt: outcome === "committed" ? { committedVersion: 1, currentLatestVersion: head!.version, committed: version(1, op.write.text) } : null };
}
it("retains unsent text through an unchanged-verse revision only for explicit review, never debounce or blur saving", async () => {
  vi.useFakeTimers(); const writes: WorkOperation[] = [];
  const { coordinator: c } = await setup(async (_b, _k, op) => { if (op.type === "page") return page(); writes.push(op); throw new WorkError(503); });
  c.edit("torah", ref, "draft", "Synthetic retained translation"); await refresh(c);
  const cell = c.cell("torah", ref, "draft")!; expect(cell.text).toBe("Synthetic retained translation"); expect(cell.revisionRecovery?.outcome).toBe("unsaved");
  await vi.advanceTimersByTimeAsync(2000); await c.save("torah", ref, "draft"); c.edit("torah", ref, "draft", "No silent replacement"); expect(writes).toHaveLength(0); expect(cell.text).toBe("Synthetic retained translation");
  c.resolveRevision("torah", ref, "draft", false); await vi.advanceTimersByTimeAsync(2000); expect(writes).toHaveLength(0);
  await c.save("torah", ref, "draft"); expect(writes).toHaveLength(1); c.clear();
});
it("requires explicit authorized absence and current heads before a new mutation can reapply an old uncertain save", async () => {
  vi.useFakeTimers(); const writes: { baseline: Assigned; op: WorkOperation }[] = []; let head: WorkVersion | null = null;
  const { coordinator: c } = await setup(async (b, _k, op) => {
    if (op.type === "page") return page(head);
    if (op.type === "recovery") return recoveryProof(op, "absent");
    writes.push({ baseline: b, op }); throw new WorkError(503);
  });
  c.edit("torah", ref, "draft", "Synthetic pending old save"); await c.save("torah", ref, "draft"); const pending = c.cell("torah", ref, "draft")!.pending!;
  head = version(3, "Synthetic other saved text"); await refresh(c);
  expect(c.cell("torah", ref, "draft")!.revisionRecovery?.outcome).toBe("unsaved"); expect(c.cell("torah", ref, "draft")!.pending).toBeUndefined();
  await vi.advanceTimersByTimeAsync(2000); expect(writes).toHaveLength(1); c.resolveRevision("torah", ref, "draft", false); await c.save("torah", ref, "draft");
  expect(writes[1].baseline.readings[0].revision).toBe(2); expect(writes[1].op).toMatchObject({ expectedVersion: 3, text: pending.text }); expect((writes[1].op as typeof pending).mutationId).not.toBe(pending.mutationId); c.clear();
});
it("reconciles an old commit without duplicating it and preserves later typed text separately", async () => {
  vi.useFakeTimers(); let head: WorkVersion | null = null, writes = 0;
  const { coordinator: c } = await setup(async (_b, _k, op) => {
    if (op.type === "page") return page(head);
    if (op.type === "recovery") return recoveryProof(op, "committed", head!);
    writes++; head = version(1, "Synthetic earlier committed"); throw new WorkError(503);
  });
  c.edit("torah", ref, "draft", "Synthetic earlier committed"); await c.save("torah", ref, "draft"); c.edit("torah", ref, "draft", "Synthetic later unsent"); await refresh(c);
  const cell = c.cell("torah", ref, "draft")!; expect(cell.text).toBe("Synthetic later unsent"); expect(cell.head?.text).toBe("Synthetic earlier committed"); expect(cell.revisionRecovery?.outcome).toBe("committed");
  await vi.advanceTimersByTimeAsync(2000); expect(writes).toBe(1); c.resolveRevision("torah", ref, "draft", true); expect(cell.text).toBe("Synthetic earlier committed"); expect(c.hasUnsaved()).toBe(false); c.clear();
});
it.each(["404", "outage", "mismatch", "stale-head"])("keeps uncertain identity and text blocked after %s, without an automatic retry", async failure => {
  vi.useFakeTimers(); let checking = false, writes = 0;
  const { coordinator: c } = await setup(async (_b, _k, op) => {
    if (op.type === "page") { if (checking && failure === "stale-head") throw new WorkError(503); return page(); }
    if (op.type === "recovery") { checking = true; if (failure === "404" || failure === "outage") throw new WorkError(failure === "404" ? 404 : 503); return { ...recoveryProof(op, "absent"), mutationId: failure === "mismatch" ? assignmentId : op.write.mutationId }; }
    writes++; throw new WorkError(503);
  });
  c.edit("torah", ref, "draft", "Synthetic uncertain"); await c.save("torah", ref, "draft"); const pending = c.cell("torah", ref, "draft")!.pending;
  await refresh(c); c.resolveRevision("torah", ref, "draft", false); await c.save("torah", ref, "draft"); await vi.advanceTimersByTimeAsync(2000);
  expect(c.cell("torah", ref, "draft")!.pending).toBe(pending); expect(c.cell("torah", ref, "draft")!.revisionRecovery?.outcome).toBe("unknown"); expect(writes).toBe(1); c.clear();
});
it("never reveals retained cells when current work authority changes", async () => {
  vi.useFakeTimers(); let binding = "a".repeat(43);
  const { coordinator: c, denied } = await setup(async () => ({ ...page(), authorityBinding: binding }));
  c.edit("torah", ref, "draft", "Synthetic private retained"); binding = "b".repeat(43);
  await refresh(c); expect(c.scope("torah")).toBeUndefined(); expect(denied).toHaveBeenCalledWith(403);
});
it("clears only the changed reading when canonical verses differ, preserving the other kind's uncertain save", async () => {
  vi.useFakeTimers(); const both: Assigned = { ...baseline, readings: [...baseline.readings, { ...baseline.readings[0], id, kind: "haftarah", verses: ["Isaiah 1:1"], ranges: ["Isaiah 1:1"] }] };
  let release!: (value: unknown) => void;
  const c = new WorkCoordinator(async (_b, kind, op) => { if (op.type === "page") return kind === "torah" ? page() : { ...page(), totalVerses: 1, nextOffset: null, verses: [{ ref: "Isaiah 1:1", draft: null, notes: [] }] }; return new Promise(resolve => { release = resolve as typeof release; }); }, async () => both, vi.fn());
  c.configure(both); await c.loadPage("torah", 0); await c.loadPage("haftarah", 0); c.accept(c.lifecycle); c.reveal();
  c.edit("torah", ref, "draft", "Synthetic removed selection"); c.edit("haftarah", "Isaiah 1:1", "draft", "Synthetic unaffected pending"); const save = c.save("haftarah", "Isaiah 1:1", "draft");
  const original = c.cell("haftarah", "Isaiah 1:1", "draft")!.pending;
  c.configure({ ...both, readings: [{ ...both.readings[0], revision: 2, verses: ["Genesis 1:2"] }, both.readings[1]] }, true);
  release({ committedVersion: 1, currentLatestVersion: 1, committed: { ...version(1, "Synthetic unaffected pending", "Isaiah 1:1"), assignmentId: id } }); await save;
  expect(c.cell("torah", ref, "draft")).toBeUndefined(); expect(c.cell("haftarah", "Isaiah 1:1", "draft")!.head?.text).toBe(original!.text); expect(c.cell("haftarah", "Isaiah 1:1", "draft")!.pending).toBeUndefined(); c.clear();
});
it("strictly validates original receipt identity and keeps recovery text and authority out of URLs", async () => {
  const operation: Extract<WorkOperation, { type: "recovery" }> = { type: "recovery", stream: "draft", originalRevision: 1, authorityBinding: "a".repeat(43), write: { verseRef: ref, text: "Synthetic body only", expectedVersion: 0, mutationId: id } };
  const proof = { ok: true, ...recoveryProof(operation, "committed", version()), receipt: { ok: true, committedVersion: 1, currentLatestVersion: 1, committed: version(1, operation.write.text) } };
  expect(parseWorkRecovery(proof, revised(), "torah", operation).outcome).toBe("committed");
  for (const mutant of [{ ...proof, extra: true }, { ...proof, assignmentRevision: 3 }, { ...proof, authorityBinding: "b".repeat(43) }, { ...proof, mutationId: assignmentId }, { ...proof, verseRef: "Genesis 1:2" }, { ...proof, stream: "note" }, { ...proof, receipt: { ...proof.receipt, committed: { ...proof.receipt.committed, assignmentRevision: 2 } } }, { ...proof, outcome: "absent" }]) expect(() => parseWorkRecovery(mutant, revised(), "torah", operation)).toThrow();
  let capturedUrl = "", capturedBody = "";
  vi.stubGlobal("fetch", vi.fn(async (url: string, input: RequestInit) => { capturedUrl = url; capturedBody = String(input.body); return response(proof); }));
  await fetchWork(revised(), "torah", operation, new AbortController().signal);
  expect(capturedUrl).toBe(`/api/students/${id}/work/recovery`); expect(capturedBody).toContain(operation.write.text); expect(JSON.parse(capturedBody)).not.toHaveProperty("type");
});

it("a held old acknowledgement cannot mutate its recovered replacement scope or erase later unsent text", async () => {
  vi.useFakeTimers(); let head: WorkVersion | null = null, release!: (value: unknown) => void;
  const { coordinator: c } = await setup(async (_b, _k, op) => {
    if (op.type === "page") return page(head);
    if (op.type === "recovery") return recoveryProof(op, "committed", head!);
    head = version(1, "Synthetic held old acknowledgement"); return new Promise(resolve => { release = resolve as typeof release; });
  });
  c.edit("torah", ref, "draft", "Synthetic held old acknowledgement"); const save = c.save("torah", ref, "draft"); c.edit("torah", ref, "draft", "Synthetic newer retained text");
  c.configure(revised(), true); await c.reload(new AbortController().signal, "torah"); c.accept(c.lifecycle); c.reveal();
  const recovered = c.cell("torah", ref, "draft")!; expect(recovered.revisionRecovery?.outcome).toBe("committed");
  release({ committedVersion: 1, currentLatestVersion: 1, committed: version(1, "Synthetic stale callback must not replace") }); await save;
  expect(c.cell("torah", ref, "draft")).toBe(recovered); expect(recovered.text).toBe("Synthetic newer retained text"); expect(recovered.head?.text).toBe("Synthetic held old acknowledgement"); expect(recovered.pending).toBeUndefined(); c.clear();
});

it("clearing authority while a revision proof is held cannot resurrect text or unlock a save", async () => {
  vi.useFakeTimers(); let release!: () => void;
  const { coordinator: c } = await setup(async (_b, _k, op) => {
    if (op.type === "page") return page(); if (op.type === "recovery") return new Promise(resolve => { release = () => resolve(recoveryProof(op, "absent")); }); throw new WorkError(503);
  });
  c.edit("torah", ref, "draft", "Synthetic private uncertainty"); await c.save("torah", ref, "draft"); c.configure(revised(), true);
  const loading = c.reload(new AbortController().signal, "torah"); await vi.waitFor(() => expect(release).toBeTypeOf("function")); c.clear(); release(); await loading;
  expect(c.scope("torah")).toBeUndefined(); expect(c.hasUnsaved()).toBe(false);
});

it.each(["student", "revision", "mode", "context", "assignment", "verse-order"])("does not transfer private unsent text across a changed %s", async change => {
  vi.useFakeTimers(); const { coordinator: c } = await setup(async () => page()); c.edit("torah", ref, "draft", "Synthetic must clear");
  const next = structuredClone(revised());
  if (change === "student") next.student.id = assignmentId;
  if (change === "revision") next.student.revision++;
  if (change === "mode") next.mode = "parent";
  if (change === "context") next.context = { id, authorityRevision: 1, studentId: id, studentRevision: 1, expiresAt: "2027-01-01T00:00:00.000Z" };
  if (change === "assignment") next.readings[0].id = id;
  if (change === "verse-order") next.readings[0].verses.reverse();
  c.configure(next, true); expect(c.cell("torah", ref, "draft")).toBeUndefined(); expect(c.hasUnsaved()).toBe(false); c.clear();
});

it("an old successful save with no later text cannot be re-posted as recovered unsent text", async () => {
  vi.useFakeTimers(); let head: WorkVersion | null = null, writes = 0;
  const { coordinator: c } = await setup(async (_b, _k, op) => { if (op.type === "page") return page(head); if (op.type === "recovery") return recoveryProof(op, "committed", head!); writes++; head = version(1, "Synthetic already saved"); throw new WorkError(503); });
  c.edit("torah", ref, "draft", "Synthetic already saved"); await c.save("torah", ref, "draft"); await refresh(c);
  c.resolveRevision("torah", ref, "draft", false); await c.save("torah", ref, "draft"); await vi.advanceTimersByTimeAsync(2000);
  expect(c.cell("torah", ref, "draft")!.revisionRecovery?.outcome).toBe("committed"); expect(writes).toBe(1); c.resolveRevision("torah", ref, "draft", true); expect(c.hasUnsaved()).toBe(false); c.clear();
});

it("another kind's revision does not turn same-revision receipt absence into permission for a new mutation", async () => {
  vi.useFakeTimers(); const both: Assigned = { ...baseline, readings: [...baseline.readings, { ...baseline.readings[0], id, kind: "haftarah", verses: ["Isaiah 1:1"], ranges: ["Isaiah 1:1"] }] };
  const writes: WorkOperation[] = []; let metadata = both;
  const c = new WorkCoordinator(async (_b, kind, op) => {
    if (op.type === "page") return kind === "torah" ? page() : { ...page(), totalVerses: 1, nextOffset: null, verses: [{ ref: "Isaiah 1:1", draft: null, notes: [] }] };
    if (op.type === "receipt") throw new WorkError(404);
    writes.push(op); throw new WorkError(503);
  }, async () => metadata, vi.fn());
  c.configure(both); await c.loadPage("torah", 0); await c.loadPage("haftarah", 0); c.accept(c.lifecycle); c.reveal();
  c.edit("haftarah", "Isaiah 1:1", "draft", "Synthetic unaffected uncertain save"); await c.save("haftarah", "Isaiah 1:1", "draft"); const original = c.cell("haftarah", "Isaiah 1:1", "draft")!.pending;
  metadata = { ...both, readings: [{ ...both.readings[0], revision: 2 }, both.readings[1]] }; await refresh(c, metadata);
  expect(c.cell("haftarah", "Isaiah 1:1", "draft")!.pending).toBe(original); expect(c.cell("haftarah", "Isaiah 1:1", "draft")!.revisionRecovery).toBeUndefined();
  await vi.advanceTimersByTimeAsync(2000); expect(writes).toHaveLength(1);
  await c.recover("haftarah", "Isaiah 1:1", "draft", true); expect(writes).toHaveLength(2); expect(writes[1]).toBe(writes[0]); c.clear();
});

it.each(["changed-binding", "denied", "outage", "older-head", "same-authority"])("manual recovery404 requires fresh authority before revealing uncertainty: %s", async result => {
  vi.useFakeTimers(); let manual = false, writes = 0;
  const { coordinator: c, denied } = await setup(async (_b, _k, op) => {
    if (op.type === "page") {
      if (manual && result === "denied") throw new WorkError(404);
      if (manual && result === "outage") throw new WorkError(503);
      return { ...page(version(manual && result === "older-head" ? 1 : 2, "Synthetic current saved")), authorityBinding: manual && result === "changed-binding" ? "b".repeat(43) : "a".repeat(43) };
    }
    if (op.type === "recovery") throw new WorkError(manual ? 404 : 503);
    writes++; throw new WorkError(503);
  }, async () => revised());
  c.edit("torah", ref, "draft", "Synthetic protected revision copy"); await c.save("torah", ref, "draft"); await refresh(c);
  const cell = c.cell("torah", ref, "draft")!, pending = cell.pending; expect(cell.verified).toBe(true); expect(cell.revisionRecovery?.outcome).toBe("unknown");
  manual = true; await c.recover("torah", ref, "draft");
  if (result === "changed-binding" || result === "denied") { expect(c.scope("torah")).toBeUndefined(); expect(denied).toHaveBeenCalled(); }
  else {
    expect(c.cell("torah", ref, "draft")).toBe(cell); expect(cell.pending).toBe(pending); expect(cell.revisionRecovery?.outcome).toBe("unknown"); expect(cell.verified).toBe(result === "same-authority");
    c.resolveRevision("torah", ref, "draft", false); await c.save("torah", ref, "draft"); expect(cell.pending).toBe(pending);
    // An ordinary successful Retry work restores visibility, never an absence
    // proof or permission to post another logical save.
    manual = false; await c.loadPage("torah", 0); expect(cell.verified).toBe(true); expect(cell.pending).toBe(pending); expect(cell.revisionRecovery?.outcome).toBe("unknown");
  }
  await vi.advanceTimersByTimeAsync(2000); expect(writes).toBe(1); c.clear();
});

it("manual recovery hides retained text while the fresh404 authority check is still waiting", async () => {
  vi.useFakeTimers(); let manual = false, release!: (value: WorkPage) => void;
  const { coordinator: c } = await setup(async (_b, _k, op) => {
    if (op.type === "page") return manual ? new Promise(resolve => { release = resolve; }) : page();
    if (op.type === "recovery") throw new WorkError(manual ? 404 : 503); throw new WorkError(503);
  }, async () => revised());
  c.edit("torah", ref, "draft", "Synthetic copy hidden during revalidation"); await c.save("torah", ref, "draft"); await refresh(c); manual = true;
  const checking = c.recover("torah", ref, "draft"); await vi.waitFor(() => expect(release).toBeTypeOf("function")); expect(c.cell("torah", ref, "draft")!.verified).toBe(false);
  c.clear(); release(page()); await checking; expect(c.scope("torah")).toBeUndefined();
});
