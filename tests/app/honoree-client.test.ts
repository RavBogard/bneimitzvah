import { afterEach, expect, it, vi } from "vitest";
import { createHonoreeClient, HonoreeClientError, type HonoreeClient, type LinkIntent, type LinkResult } from "../../src/components/portal/workspace/honors/honoree-api";
import { createHonoreeOwner } from "../../src/components/portal/workspace/honors/honoree-owner";
import type { HonorsState } from "../../src/components/portal/workspace/honors/owner";
import { emptyHonors } from "../../src/components/portal/workspace/honors/draft";

const studentId = "10000000-0000-4000-8000-000000000001", mutationId = "10000000-0000-4000-8000-000000000002", startVerse = "Genesis 1:1", id = "A".repeat(22), origin = "https://example.test";
const token = `hl1.k1.${id}.${"A".repeat(43)}.${"A".repeat(43)}`, url = `${origin}/honoree#token=${token}`, instant = "2027-01-02T06:00:00.000Z";
const intent = (): LinkIntent => ({ operation: "issue", mutationId, expectedVersion: 1, contextHash: "a".repeat(64), startVerse, linkId: null });
const committed = (write = intent(), replayed = false): LinkResult => ({ ok: true, outcome: "committed", replayed, operation: write.operation, linkId: id, startVerse, ...(!replayed && write.operation !== "revoke" ? { url, expiresAt: instant } : {}) });
const record = () => ({ id, startVerse, issuedAt: instant, expiresAt: instant });
const signal = () => new AbortController().signal;
const deferred = <T,>() => { let resolve!: (v: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
afterEach(() => vi.unstubAllGlobals());
function saved(): HonorsState {
  const snapshot = { schemaVersion: 1 as const, tenantId: "crc", studentId, ceremonyDate: "2027-01-02", serviceSlot: "morning" as const, torah: { id: studentId, revision: 1, ref: "Genesis 1:1", basis: "custom" as const, confirmation: { confirmationDate: "2027-01-02", serviceSlot: "morning" as const, slotProvenance: 1, needsReview: false }, verses: [startVerse], cuts: [] } };
  const context = { hash: "a".repeat(64), snapshot, spans: [{ startVerse, endVerse: startVerse }], status: "assigned" as const, unknownSlot: false, readingNeedsReview: false };
  const form = { ...emptyHonors(), aliyot: [{ startVerse, participants: [{ id: studentId, englishName: "Invented person", relationship: null, hebrewName: null, parent1HebrewName: null, parent2HebrewName: null }] }] };
  return { phase: "ready", current: { ok: true, studentId, currentVersion: 1, currentContext: context, saved: { version: 1, form, reviewedContext: context, createdAt: instant }, needsReview: false }, draft: form, draftContext: context, baseVersion: 1, dirty: false, reviewed: true, pending: null, error: null, savedNotice: false };
}
function fixture() {
  let honors = saved(), blocked = false;
  const api: HonoreeClient = { status: vi.fn(async () => null), mutate: vi.fn(async write => committed(write)), receipt: vi.fn(async write => committed(write, true)) };
  const ids = vi.fn(() => mutationId), changed = vi.fn(), owner = createHonoreeOwner(api, { honors: () => honors, blocked: () => blocked, changed }, ids);
  return { api, ids, owner, changed, setHonors(value: HonorsState) { honors = value; }, get honors() { return honors; }, block(value: boolean) { blocked = value; } };
}

it("private API uses three exact body POSTs with session rechecks; status never claims usability", async () => {
  const verify = vi.fn(async () => {}), denied = vi.fn(), fetcher = vi.fn(async (_path: string, request: RequestInit) => Response.json(String(_path).endsWith("/status") ? { ok: true, currentLink: record() } : committed(JSON.parse(String(request.body)), _path.endsWith("/receipt"))));
  vi.stubGlobal("fetch", fetcher); const client = createHonoreeClient({ studentId, mode: "parent", origin, verify, denied });
  expect(await client.status(startVerse, signal())).toEqual(record()); expect(await client.mutate(intent(), signal())).toMatchObject({ url });
  expect(await client.receipt(intent(), signal())).not.toHaveProperty("url");
  expect(fetcher.mock.calls.map(c => c[0])).toEqual([`/api/students/${studentId}/honoree-links/status`, `/api/students/${studentId}/honoree-links`, `/api/students/${studentId}/honoree-links/receipt`]);
  expect(verify).toHaveBeenCalledTimes(6); expect(denied).not.toHaveBeenCalled();
  for (const [, request] of fetcher.mock.calls) expect(request).toMatchObject({ method: "POST", credentials: "same-origin", redirect: "error", cache: "no-store", referrerPolicy: "no-referrer" });
});

it("API refuses extra fields, wrong-group and foreign/replayed/receipt secrets and overlong bodies", async () => {
  const client = createHonoreeClient({ studentId, mode: "admin", origin, verify: async () => {}, denied: vi.fn() });
  const original = committed() as Extract<LinkResult, { outcome: "committed" }>;
  for (const value of [{ ...original, contact: "extra" }, { ...original, startVerse: "Genesis 1:2" }, { ...original, url: url.replace(origin, "https://foreign.test") }, { ...original, replayed: true }]) {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(value))); await expect(client.mutate(intent(), signal())).rejects.toBeInstanceOf(HonoreeClientError);
  }
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(original))); await expect(client.receipt(intent(), signal())).rejects.toBeInstanceOf(HonoreeClientError);
  vi.stubGlobal("fetch", vi.fn(async () => new Response("x".repeat(8193), { headers: { "content-type": "application/json" } }))); await expect(client.status(startVerse, signal())).rejects.toBeInstanceOf(HonoreeClientError);
});

it("404 is local management unavailability; only actual401/403 propagate authority failure", async () => {
  const denied = vi.fn(), client = createHonoreeClient({ studentId, mode: "parent", origin, verify: async () => {}, denied });
  for (const status of [404, 401, 403]) { vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status }))); await expect(client.status(startVerse, signal())).rejects.toMatchObject({ status }); }
  expect(denied.mock.calls).toEqual([[401], [403]]);
});

it("post-response session loss and cancellation withhold a one-shot URL without retrying the write", async () => {
  let calls = 0; const denied = vi.fn(), fetcher = vi.fn(async () => Response.json(committed()));
  vi.stubGlobal("fetch", fetcher);
  const client = createHonoreeClient({ studentId, mode: "parent", origin, denied, verify: async () => { if (++calls === 2) throw new HonoreeClientError(401); } });
  await expect(client.mutate(intent(), signal())).rejects.toMatchObject({ status: 401 }); expect(fetcher).toHaveBeenCalledTimes(1); expect(denied).toHaveBeenCalledWith(401);
  const pending = deferred<Response>(), controller = new AbortController(); vi.stubGlobal("fetch", vi.fn(() => pending.promise));
  const cancelled = createHonoreeClient({ studentId, mode: "parent", origin, denied, verify: async () => {} });
  const write = cancelled.mutate(intent(), controller.signal); controller.abort(); pending.resolve(Response.json(committed())); await expect(write).rejects.toBeInstanceOf(HonoreeClientError);
});

it("issue requires a checked absent record and exact clean saved reviewed nonempty confirmed group", async () => {
  const f = fixture(); expect(await f.owner.issue(startVerse)).toBe(false); expect(f.ids).not.toHaveBeenCalled();
  await f.owner.status(startVerse);
  for (const change of [(h: HonorsState) => ({ ...h, dirty: true }), (h: HonorsState) => ({ ...h, reviewed: false }), (h: HonorsState) => ({ ...h, pending: { mutationId } as HonorsState["pending"] }),
    (h: HonorsState) => ({ ...h, current: { ...h.current!, saved: null } }), (h: HonorsState) => ({ ...h, current: { ...h.current!, needsReview: true } }),
    (h: HonorsState) => ({ ...h, current: { ...h.current!, currentContext: { ...h.current!.currentContext, unknownSlot: true } } }),
    (h: HonorsState) => ({ ...h, current: { ...h.current!, saved: { ...h.current!.saved!, form: { ...h.draft, aliyot: [] } } } })]) {
    f.setHonors(change(saved())); expect(await f.owner.issue(startVerse)).toBe(false);
  }
  f.setHonors(saved()); f.block(true); expect(await f.owner.issue(startVerse)).toBe(false); f.block(false);
  expect(await f.owner.issue(startVerse)).toBe(true); expect(f.ids).toHaveBeenCalledTimes(1); expect(f.owner.state.secret?.url).toBe(url); expect(f.honors.pending).toBe(null);
});

it("replacement/revocation require explicit confirmation; revoke still works for a stale saved group", async () => {
  const f = fixture(); vi.mocked(f.api.status).mockResolvedValue(record()); await f.owner.status(startVerse);
  expect(await f.owner.acceptConfirmation()).toBe(false); expect(f.ids).not.toHaveBeenCalled();
  expect(f.owner.confirm("reissue", startVerse)).toBe(true); f.owner.cancelConfirmation(); expect(await f.owner.acceptConfirmation()).toBe(false);
  expect(f.owner.confirm("reissue", startVerse)).toBe(true); expect(await f.owner.acceptConfirmation()).toBe(true);
  expect(vi.mocked(f.api.mutate).mock.calls[0][0]).toMatchObject({ operation: "reissue", linkId: id });
  f.setHonors({ ...saved(), dirty: true, reviewed: false, current: { ...saved().current!, needsReview: true } });
  expect(f.owner.confirm("reissue", startVerse)).toBe(false); expect(f.owner.confirm("revoke", startVerse)).toBe(true); await f.owner.acceptConfirmation();
  expect(vi.mocked(f.api.mutate).mock.calls[1][0]).toMatchObject({ operation: "revoke", linkId: id }); expect(f.owner.state.records[startVerse]).toBe(null); expect(f.owner.state.secret).toBe(null);
});

it("uncertain action locks the group and retains one immutable UUID for unconfirmed receipt and deliberate retry", async () => {
  const f = fixture(); await f.owner.status(startVerse); vi.mocked(f.api.mutate).mockRejectedValueOnce(new HonoreeClientError(404));
  await f.owner.issue(startVerse); const original = f.owner.state.pending;
  expect(f.owner.uncertain()).toBe(true); expect(f.owner.state.phase).toBe("unknown"); expect(f.owner.state.message).toContain("unavailable here");
  expect(await f.owner.status(startVerse)).toBe(false); expect(await f.owner.issue(startVerse)).toBe(false);
  vi.mocked(f.api.receipt).mockResolvedValueOnce({ ok: true, outcome: "unconfirmed" }); await f.owner.check(); expect(f.owner.state.pending).toBe(original);
  await f.owner.retry(); expect(f.ids).toHaveBeenCalledTimes(1); expect(vi.mocked(f.api.mutate).mock.calls.map(c => c[0])).toEqual([original, original]);
  expect(f.owner.state.secret).toBe(null); expect(f.owner.state.pending).toBe(null);
});

it("pause clears secrets and invalidates late mutation/copy completions; uncertainty may resume without remint", async () => {
  const f = fixture(); await f.owner.status(startVerse); const response = deferred<LinkResult>(); vi.mocked(f.api.mutate).mockReturnValueOnce(response.promise);
  const pending = f.owner.issue(startVerse); f.owner.pause(); expect(f.owner.state.secret).toBe(null); expect(f.owner.state.phase).toBe("unknown");
  response.resolve(committed()); await pending; expect(f.owner.state.secret).toBe(null); expect(f.owner.state.pending?.mutationId).toBe(mutationId);
  f.owner.resume(); await f.owner.check(); expect(f.owner.state.secret).toBe(null); expect(f.ids).toHaveBeenCalledTimes(1);
  const second = fixture(); await second.owner.status(startVerse); await second.owner.issue(startVerse); const copy = deferred<void>();
  const copied = second.owner.copy(() => copy.promise); second.owner.pause(); copy.resolve(); expect(await copied).toBe(false); expect(second.owner.state.copied).toBe(false); expect(second.owner.state.secret).toBe(null);
  second.owner.clear(); second.owner.resume(); expect(await second.owner.status(startVerse)).toBe(false);
});

it("synchronous owner locks serialize status/mutation/reconciliation and late denial never restores a disposed owner", async () => {
  const f = fixture(), result = deferred<null>(); vi.mocked(f.api.status).mockReturnValueOnce(result.promise);
  const pending = f.owner.status(startVerse); expect(f.owner.busy()).toBe(true); expect(await f.owner.issue(startVerse)).toBe(false); expect(await f.owner.status(startVerse)).toBe(false);
  f.owner.clear(); result.resolve(null); await pending; expect(f.owner.state.phase).toBe("disposed"); expect(f.owner.state.records).toEqual({});
  const denied = fixture(); vi.mocked(denied.api.status).mockRejectedValue(new HonoreeClientError(401)); await denied.owner.status(startVerse); expect(denied.owner.state.phase).toBe("disposed");
});
