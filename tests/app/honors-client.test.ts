import { createHash } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { PortalRequestError } from "../../src/components/portal/api";
import type { HonorsCommit, HonorsContext, HonorsContextView, HonorsForm, HonorsIntent, HonorsRead } from "../../src/lib/honors/types";
import { createHonorsClient, HonorsClientError, parseHonorsRead, type HonorsClient } from "../../src/components/portal/workspace/honors/api";
import { captureHonorsForm, emptyHonors, HONORS_LIMITS } from "../../src/components/portal/workspace/honors/draft";
import { createHonorsOwner } from "../../src/components/portal/workspace/honors/owner";
import { savedHonorsPrint } from "../../src/components/portal/workspace/honors/print";
const studentId = "10000000-0000-4000-8000-000000000001", personId = "10000000-0000-4000-8000-000000000002", mutationId = "10000000-0000-4000-8000-000000000003";
const person = () => ({ id: personId, englishName: "Synthetic Honoree", relationship: null, hebrewName: "שֵׁם", parent1HebrewName: null, parent2HebrewName: null });
function context(date = "2027-01-02", cuts: string[] | null = ["Genesis 1:2"]): HonorsContextView {
  const snapshot: HonorsContext = { schemaVersion: 1, tenantId: "crc", studentId, ceremonyDate: date, serviceSlot: "morning", torah: { id: "10000000-0000-4000-8000-000000000004", revision: 1, ref: "Genesis 1:1-3", basis: "custom", confirmation: { confirmationDate: "2027-01-02", serviceSlot: "morning", slotProvenance: 1, needsReview: false }, verses: ["Genesis 1:1", "Genesis 1:2", "Genesis 1:3"], cuts } };
  const starts = cuts === null ? [] : ["Genesis 1:1", ...cuts]; return { hash: createHash("sha256").update(JSON.stringify(snapshot)).digest("hex"), snapshot, spans: starts.map((startVerse, i) => ({ startVerse, endVerse: i === starts.length - 1 ? "Genesis 1:3" : snapshot.torah!.verses[snapshot.torah!.verses.indexOf(starts[i + 1]) - 1] })), status: cuts === null ? "unresolved-cuts" : "assigned", unknownSlot: false, readingNeedsReview: false };
}
const form = (): HonorsForm => ({ ...emptyHonors(), aliyot: [{ startVerse: "Genesis 1:2", participants: [person()] }] });
function read(currentContext = context(), savedContext = currentContext, savedForm: HonorsForm | null = null, version = savedForm ? 1 : 0): HonorsRead { return { ok: true, studentId, currentVersion: version, currentContext, saved: savedForm ? { version, form: savedForm, reviewedContext: savedContext, createdAt: "2026-10-18T00:00:00.000Z" } : null, needsReview: !!savedForm && currentContext.hash !== savedContext.hash }; }
function committed(intent: HonorsIntent, currentContext = context(), latest = intent.expectedVersion + 1): HonorsCommit { return { ok: true, outcome: "committed", replayed: false, committedVersion: intent.expectedVersion + 1, currentLatestVersion: latest, committed: { version: intent.expectedVersion + 1, form: intent.form, reviewedContext: context(), createdAt: "2026-10-18T00:00:00.000Z" }, currentContext, needsReview: currentContext.hash !== context().hash }; }
type MutableClient = { -readonly [K in keyof HonorsClient]: HonorsClient[K] };
function transport(overrides: Partial<HonorsClient> = {}): MutableClient { return { read: vi.fn(async () => read()), write: vi.fn(async intent => committed(intent)), receipt: vi.fn(async () => ({ ok: true as const, outcome: "unconfirmed" as const })), ...overrides }; }
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store" } });
const held = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; };
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("uses base guardian/admin/own-adult student selectors and fresh session proof around the closed response", async () => {
  const verify = vi.fn(async () => {}), denied = vi.fn(), fetcher = vi.fn(async () => response(read())); vi.stubGlobal("fetch", fetcher);
  const client = createHonorsClient({ studentId, mode: "parent", verify, denied }); expect(fetcher).not.toHaveBeenCalled();
  expect(await client.read(new AbortController().signal)).toEqual(read()); expect(verify).toHaveBeenCalledTimes(2);
  const [url, options] = fetcher.mock.calls[0] as unknown as [string, RequestInit]; expect(url).toBe(`/api/students/${studentId}/honors?mode=parent`); expect(options).toMatchObject({ method: "GET", credentials: "same-origin", redirect: "error", cache: "no-store", referrerPolicy: "no-referrer" }); expect(new Headers(options.headers).has("X-Practice-Context")).toBe(false);
  await createHonorsClient({ studentId, mode: "student", verify, denied }).read(new AbortController().signal);
  expect((fetcher.mock.calls[1] as unknown as [string, RequestInit])[0]).toBe(`/api/students/${studentId}/honors?mode=student`);
  expect(verify).toHaveBeenCalledTimes(4);
  for (const mode of ["tutor", "child-practice"]) expect(() => createHonorsClient({ studentId, mode: mode as "parent", verify, denied })).toThrow();
});
it("rejects forged context hashes/spans/tenant mixing and malformed or oversized private bodies", async () => {
  const baseline = read(context(), context(), form()); expect(await parseHonorsRead(baseline, studentId)).toEqual(baseline);
  for (const value of [{ ...baseline, studentId: "other" }, { ...baseline, extra: true }, { ...baseline, currentContext: { ...context(), hash: "a".repeat(64) } }, { ...baseline, currentContext: { ...context(), spans: [] } }, { ...baseline, needsReview: true }, { ...baseline, saved: { ...baseline.saved!, form: { ...form(), aliyot: [{ startVerse: "Genesis 1:3", participants: [person()] }] } } }]) await expect(parseHonorsRead(value, studentId)).rejects.toBeDefined();
  const client = createHonorsClient({ studentId, mode: "admin", verify: async () => {}, denied() {} });
  for (const result of [new Response("{"), new Response(new Uint8Array(HONORS_LIMITS.responseBytes + 1), { headers: { "Content-Type": "application/json" } }), response({ ...read(), note: "private extra" })]) { vi.stubGlobal("fetch", vi.fn(async () => result)); await expect(client.read(new AbortController().signal)).rejects.toBeDefined(); }
});
it("keeps transport uncertainty distinct from validated refusal and clears real denial after final session proof", async () => {
  const denied = vi.fn(), verify = vi.fn(async () => {}); let intent!: HonorsIntent;
  const client = createHonorsClient({ studentId, mode: "parent", verify, denied }); intent = { expectedVersion: 0, mutationId, contextHash: context().hash, form: form() };
  vi.stubGlobal("fetch", vi.fn(async () => response({ ok: false, code: "stale-context" }, 409))); await expect(client.write(intent, new AbortController().signal)).rejects.toMatchObject({ definite: true, code: "stale-context" });
  vi.stubGlobal("fetch", vi.fn(async () => response({ ok: false, code: "invented" }, 409))); await expect(client.write(intent, new AbortController().signal)).rejects.toMatchObject({ definite: false });
  verify.mockReset().mockResolvedValueOnce().mockRejectedValueOnce(new PortalRequestError(401)); vi.stubGlobal("fetch", vi.fn(async () => response(committed(intent)))); await expect(client.write(intent, new AbortController().signal)).rejects.toMatchObject({ status: 401 }); expect(denied).toHaveBeenCalledWith(401);
});
it("canonicalizes optional names without silently dropping partially entered aliyah people", () => {
  const blank = { ...person(), englishName: "", hebrewName: null }, input = { ...form(), openingArk: [{ id: mutationId, englishName: "  Synthetic \u00e9  " }], aliyot: [{ startVerse: "Genesis 1:2", participants: [blank] }] };
  expect(captureHonorsForm(input)).toMatchObject({ openingArk: [{ englishName: "Synthetic é" }], aliyot: [{ participants: [] }] });
  expect(() => captureHonorsForm({ ...input, aliyot: [{ startVerse: "Genesis 1:2", participants: [{ ...blank, hebrewName: "שֵׁם" }] }] })).toThrow();
  for (const englishName of ["<b>Name</b>", "Name\u202e", "Name\u0000"]) expect(() => captureHonorsForm({ ...emptyHonors(), openingArk: [{ id: personId, englishName }] })).toThrow();
  expect(() => captureHonorsForm({ ...emptyHonors(), openingArk: [{ id: personId, englishName: "One" }, { id: personId, englishName: "Two" }] })).toThrow();
});
it("quiet same-owner return retains the identical draft object and edits until context truly changes", async () => {
  const api = transport(), publish = vi.fn(), owner = createHonorsOwner(api, publish, () => mutationId); await owner.load(); owner.edit(form()); const draft = owner.state.draft, calls = publish.mock.calls.length;
  expect(await owner.quiet(new AbortController().signal)).toBe(true); expect(publish).toHaveBeenCalledTimes(calls); expect(owner.state.draft).toBe(draft);
  api.read = vi.fn(async () => read(context("2027-02-06"))); expect(await owner.quiet(new AbortController().signal)).toBe(false); await owner.load(); expect(owner.state.draft).toBe(draft); expect(owner.state.reviewed).toBe(false);
  expect(owner.review({})).toBe(true); expect(owner.state.draft.aliyot).toEqual(form().aliyot); expect(owner.state.dirty).toBe(true);
});
it("requires explicit changed-span mapping/removal and never infers an ordinal replacement", async () => {
  const old = context(), now = context("2027-02-06", ["Genesis 1:3"]), api = transport({ read: vi.fn(async () => read(now, old, form())) }), owner = createHonorsOwner(api, () => {}); await owner.load();
  expect(owner.review({})).toBe(false); expect(owner.state.draft.aliyot).toEqual(form().aliyot); expect(await owner.save()).toBe(false);
  expect(owner.review({ "Genesis 1:2": "Genesis 1:3" })).toBe(true); expect(owner.state.draft.aliyot).toEqual([{ startVerse: "Genesis 1:3", participants: [person()] }]);
  const unresolved = createHonorsOwner(transport({ read: vi.fn(async () => read(context("2027-02-06", null), old, form())) }), () => {}); await unresolved.load(); expect(unresolved.review({})).toBe(false); expect(unresolved.review({ "Genesis 1:2": null })).toBe(true); expect(unresolved.state.draft.aliyot).toEqual([]);
});
it("freezes the original UUID/body through lost response, unconfirmed receipt and exact explicit retry", async () => {
  const api = transport({ write: vi.fn(async () => { throw Error("Synthetic response lost"); }) }), ids = vi.fn(() => mutationId), owner = createHonorsOwner(api, () => {}, ids); await owner.load(); owner.edit(form()); expect(await owner.save()).toBe(false);
  const intent = owner.state.pending!; expect(owner.state.phase).toBe("unknown"); expect(Object.isFrozen(intent)).toBe(true); expect(Object.isFrozen(intent.form.aliyot[0].participants[0])).toBe(true); expect(owner.edit(emptyHonors())).toBe(false); expect(await owner.discard()).toBe(false);
  await owner.check(); expect(owner.state.pending).toBe(intent); expect(api.receipt).toHaveBeenCalledWith(intent, expect.any(AbortSignal));
  api.write = vi.fn(async write => committed(write)); expect(await owner.retry()).toBe(true); expect(api.write).toHaveBeenCalledWith(intent, expect.any(AbortSignal)); expect(ids).toHaveBeenCalledTimes(1); expect(owner.state.pending).toBeNull(); expect(owner.state.dirty).toBe(false);
});
it("confirms an old save against its original context after a date change and requires a new review", async () => {
  const api = transport({ write: vi.fn(async () => { throw Error("lost"); }), receipt: vi.fn(async intent => committed(intent, context("2027-02-06"))) }), owner = createHonorsOwner(api, () => {}, () => mutationId); await owner.load(); owner.edit(form()); await owner.save(); const intent = owner.state.pending;
  expect(await owner.check()).toBe(true); expect(api.receipt).toHaveBeenCalledWith(intent, expect.any(AbortSignal)); expect(owner.state.current?.saved?.reviewedContext.hash).toBe(context().hash); expect(owner.state.reviewed).toBe(false); expect(owner.state.current?.needsReview).toBe(true);
});
it("does not overwrite a newer saved head or retire an already uncertain UUID on receipt conflict", async () => {
  const api = transport({ write: vi.fn(async () => { throw Error("lost"); }), receipt: vi.fn(async () => { throw new HonorsClientError(409, "conflict", true); }) }), owner = createHonorsOwner(api, () => {}, () => mutationId); await owner.load(); owner.edit(form()); await owner.save(); const pending = owner.state.pending; await owner.check(); expect(owner.state.phase).toBe("unknown"); expect(owner.state.pending).toBe(pending);
  api.receipt = vi.fn(async intent => committed(intent, context(), 2)); expect(await owner.check()).toBe(true); expect(owner.state.phase).toBe("conflict"); expect(owner.state.pending).toBeNull(); expect(await owner.save()).toBe(false); expect(owner.edit(emptyHonors())).toBe(false);
});
it("real denial clears private fields and late completions cannot republish them", async () => {
  const gate = held<HonorsRead>(), api = transport(), changed = vi.fn(), owner = createHonorsOwner(api, changed); await owner.load(); owner.edit(form()); api.read = vi.fn(async () => gate.promise); const task = owner.load(); owner.clear(); const count = changed.mock.calls.length; gate.resolve(read(context(), context(), form())); await task;
  expect(owner.state.phase).toBe("disposed"); expect(owner.state.draft).toEqual(emptyHonors()); expect(owner.state.current).toBeNull(); expect(changed).toHaveBeenCalledTimes(count);
  const denied = createHonorsOwner(transport({ write: vi.fn(async () => { throw new PortalRequestError(404); }) }), () => {}); await denied.load(); denied.edit(form()); await denied.save(); expect(denied.state.phase).toBe("disposed"); expect(denied.hasUnsaved()).toBe(false);
});
it("retains dirty drafts through a concurrent head change until an explicit discard", async () => {
  const api = transport(), owner = createHonorsOwner(api, () => {}); await owner.load(); owner.edit(form()); api.read = vi.fn(async () => read(context(), context(), { ...emptyHonors(), openingArk: [{ id: mutationId, englishName: "Other synthetic" }] }, 1));
  await owner.load(); await owner.load(); expect(owner.state.phase).toBe("conflict"); expect(owner.state.draft).toEqual(form()); expect(await owner.save()).toBe(false); await owner.discard(); expect(owner.state.phase).toBe("ready"); expect(owner.state.draft.openingArk[0].englishName).toBe("Other synthetic");
});
it("prints only verified saved names and their stored date/spans, with a needs-review marker", () => {
  const saved = read(context("2027-02-06", ["Genesis 1:3"]), context(), form()), lines = savedHonorsPrint(saved, "Synthetic Family"), text = JSON.stringify(lines);
  expect(text).toContain("2027-01-02"); expect(text).not.toContain("2027-02-06"); expect(text).toContain("Genesis 1:2 – Genesis 1:3"); expect(text).toContain("NEEDS REVIEW"); expect(text).toContain("שֵׁם"); expect(text).toContain("Not entered"); expect(() => savedHonorsPrint(read(), "Synthetic")).toThrow();
});
it("captures external mutable intent before the first proof and rejects a mismatched committed payload", async () => {
  const proof = held<void>(), intent = { expectedVersion: 0, mutationId, contextHash: context().hash, form: structuredClone(form()) }, original = structuredClone(intent), fetcher = vi.fn(async () => response(committed(original)));
  vi.stubGlobal("fetch", fetcher); const client = createHonorsClient({ studentId, mode: "parent", verify: vi.fn().mockReturnValueOnce(proof.promise).mockResolvedValue(undefined), denied() {} });
  const task = client.write(intent, new AbortController().signal); (intent.form.aliyot[0].participants[0] as { englishName: string }).englishName = "Changed after proof started"; intent.mutationId = personId; proof.resolve(); await task;
  expect(JSON.parse((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toEqual({ mode: "parent", ...original });
  vi.stubGlobal("fetch", vi.fn(async () => response(committed({ ...original, form: emptyHonors() })))); await expect(client.write(original, new AbortController().signal)).rejects.toBeDefined();
});
it("waits for a live mutation during concealment, then leaves its uncertain controls intact", async () => {
  const gate = held<HonorsCommit>(), api = transport({ write: vi.fn(async () => gate.promise) }), owner = createHonorsOwner(api, () => {}, () => mutationId); await owner.load(); owner.edit(form()); const saving = owner.save(); const intent = owner.state.pending!; owner.pause(); let settled = false; const waiting = owner.settle().then(() => { settled = true; }); await Promise.resolve(); expect(settled).toBe(false); expect(owner.edit(emptyHonors())).toBe(false);
  gate.resolve(committed(intent)); await saving; await waiting; expect(settled).toBe(true); expect(owner.state.savedNotice).toBe(true);
});
