import { describe, expect, it } from "vitest";
import { browserProgressStore, completeLesson, emptyProgress, mergeProgress, parseProgress, PROGRESS_KEY, type Progress } from "../../src/lib/service-course/progress";
import { lessonById } from "../../src/lib/service-course/course";
import { createProgressSync, GUEST_KEY, STAMPS_KEY, SYNC_KEY, type Account } from "../../src/components/learn/service/progress-sync";
import { writeLocal } from "../../src/components/learn/service/progress";

// Release 2.0 SC4: the browser half of the service course's signed-in progress, against a fake server and in-memory storage,
// on Learn to lein's sync test (learn-progress-sync.test.ts): every shared-device and sign-out rule, at the course's own routes.
class MemoryStorage { values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; } setItem(key: string, value: string) { this.values.set(key, value); } removeItem(key: string) { this.values.delete(key); } }
const A = "a".repeat(32), B = "b".repeat(32);
const doc = (lessons: Record<string, string>, cards: Record<string, [number, string]> = {}) => parseProgress({ schema: "service-course-progress/v1",
  lessons: Object.fromEntries(Object.entries(lessons).map(([id, done]) => [id, { done }])), cards: Object.fromEntries(Object.entries(cards).map(([id, [box, due]]) => [id, { box, due }])) })!;
const T1 = "2026-10-20T10:00:00.000Z", T2 = "2026-10-21T10:00:00.000Z";

function rig(server: { owner?: string; progress?: Progress | null; version?: number; status?: number; until?: string | null } = {}, marker?: unknown, local?: Progress, storage = new MemoryStorage(), now?: () => number) {
  const store = browserProgressStore(() => storage as unknown as Storage);
  if (local) store.save(local);
  if (marker !== undefined) storage.setItem(SYNC_KEY, typeof marker === "string" ? marker : JSON.stringify(marker));
  const state = { owner: server.owner ?? A, progress: server.progress ?? null, version: server.version ?? 0, status: server.status ?? 200, until: server.until ?? null, conflictOnce: false, before: null as null | ((path: string) => void), refusal: { error: "x" } as unknown };
  const calls: { path: string; body: any }[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any
  const reply = (status: number, value: unknown) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
  const view = () => ({ ok: true, owner: state.owner, progress: state.progress, version: state.version, until: state.until });
  const fetcher = (async (path: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined; calls.push({ path, body });
    state.before?.(path);
    if (state.status !== 200) return reply(state.status, state.refusal);
    if (path === "/api/learn/service/progress") return reply(200, view());
    if (path === "/api/learn/service/progress/merge") { state.progress = state.progress ? mergeProgress(state.progress, parseProgress(body.progress)!) : parseProgress(body.progress); state.version++; return reply(200, view()); }
    if (path === "/api/learn/service/progress/put") {
      if (state.conflictOnce || body.expectedVersion !== state.version) { state.conflictOnce = false; return reply(409, { ok: false, code: "conflict", current: view() }); }
      state.progress = parseProgress(body.progress); state.version++; return reply(200, view());
    }
    return reply(404, {});
  }) as unknown as typeof fetch;
  const timers: (() => void)[] = [], seen: { progress: Progress[]; accounts: Account[] } = { progress: [], accounts: [] };
  const sync = createProgressSync({ fetch: fetcher, storage: () => storage as unknown as Storage, store, onProgress: p => seen.progress.push(p), onAccount: a => seen.accounts.push(a),
    timer: callback => { timers.push(callback); return timers.length; }, clearTimer: () => {}, ...(now ? { now } : {}) });
  const marker_ = () => JSON.parse(storage.getItem(SYNC_KEY) ?? "null");
  return { storage, store, state, calls, sync, seen, timers, marker: marker_, local: () => JSON.parse(storage.getItem(PROGRESS_KEY) ?? "null"),
    guest: () => JSON.parse(storage.getItem(GUEST_KEY) ?? "null") };
}
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

describe("signed-in progress in the browser", () => {
  it("signed out or without a grant, nothing leaves the browser and nothing changes in it", async () => {
    for (const [status, state] of [[401, "signed-out"], [403, "not-eligible"]] as const) {
      const local = doc({ "aleinu": T1 }), r = rig({ status }, undefined, local);
      await r.sync.start();
      expect(r.sync.account.state).toBe(state);
      expect(r.calls.map(c => c.path)).toEqual(["/api/learn/service/progress"]);
      expect(r.store.load()).toEqual(local);
      expect(r.marker()).toBeNull();
    }
  });
  it("on first sign-in sends none of the browser's signed-out progress: it is set aside on the device and the account's copy is taken", async () => {
    const local = doc({ "aleinu": T2 }, { "word:shma:read": [3, "2026-10-30"] }), account = doc({ "aleinu": T1, "barchu": T2 });
    const r = rig({ progress: account, version: 4, until: "2027-01-02" }, undefined, local);
    await r.sync.start(); await settle();
    expect(r.calls.map(c => c.path)).toEqual(["/api/learn/service/progress"]);
    expect(r.store.load()).toEqual(account);
    expect(r.state.progress).toEqual(account);
    expect(r.marker()).toEqual({ owner: A, version: 4, dirty: false });
    expect(r.sync.account).toEqual({ state: "synced", until: "2027-01-02" });
    expect(parseProgress(r.guest())).toEqual(local);
  });
  it("leaves the device as it was when the signed-out copy cannot be set aside", async () => {
    class NoGuest extends MemoryStorage { setItem(key: string, value: string) { if (key === GUEST_KEY) throw new Error("full"); super.setItem(key, value); } }
    const local = doc({ "aleinu": T1 }), r = rig({ progress: doc({ "barchu": T2 }), version: 2 }, undefined, local, new NoGuest());
    await r.sync.start();
    expect(r.calls.map(c => c.path)).toEqual(["/api/learn/service/progress"]);
    expect(r.store.load()).toEqual(local);
    expect(r.marker()).toBeNull();
    expect(r.sync.account.state).toBe("unknown");
  });
  it("writes a change back under the version last seen, and merges when another device got there first", async () => {
    const r = rig({ progress: doc({ "aleinu": T1 }), version: 1 }, { owner: A, version: 1, dirty: false }, doc({ "aleinu": T1 }));
    await r.sync.start();
    expect(r.calls.map(c => c.path)).toEqual(["/api/learn/service/progress"]);
    r.store.save(doc({ "aleinu": T1, "shma": T2 })); r.sync.changed();
    expect(r.marker().dirty).toBe(true);
    r.timers.shift()!(); await settle(); await settle();
    expect(r.calls.at(-1)).toMatchObject({ path: "/api/learn/service/progress/put", body: { expectedVersion: 1 } });
    expect(r.marker()).toEqual({ owner: A, version: 2, dirty: false });
    r.state.conflictOnce = true; r.state.progress = doc({ "barchu": T2 }); r.state.version = 7;
    r.store.save(doc({ "aleinu": T1, "shma": T2, "vahavta": T2 })); r.sync.changed();
    r.timers.shift()!(); await settle(); await settle(); await settle();
    expect(r.calls.slice(-2).map(c => c.path)).toEqual(["/api/learn/service/progress/put", "/api/learn/service/progress/merge"]);
    expect(Object.keys(r.store.load().lessons).sort()).toEqual(["aleinu", "barchu", "shma", "vahavta"]);
    expect(r.marker()).toEqual({ owner: A, version: 8, dirty: false });
  });
  it("takes the account's newer copy when the browser has nothing unsent, and merges when it has", async () => {
    const newer = doc({ "barchu": T2 });
    const clean = rig({ progress: newer, version: 3 }, { owner: A, version: 1, dirty: false }, doc({ "aleinu": T1 }));
    await clean.sync.start();
    expect(clean.store.load()).toEqual(newer);
    expect(clean.calls.map(c => c.path)).toEqual(["/api/learn/service/progress"]);
    const dirty = rig({ progress: newer, version: 3 }, { owner: A, version: 1, dirty: true }, doc({ "aleinu": T1 }));
    await dirty.sync.start();
    expect(dirty.calls.map(c => c.path)).toEqual(["/api/learn/service/progress", "/api/learn/service/progress/merge"]);
    expect(Object.keys(dirty.store.load().lessons).sort()).toEqual(["aleinu", "barchu"]);
  });
  it("on a shared device never folds another account's progress into this one: it takes this account's copy", async () => {
    const theirs = doc({ "aleinu": T1, "shma": T1 }), mine = doc({ "barchu": T2 });
    const r = rig({ owner: B, progress: mine, version: 2 }, { owner: A, version: 5, dirty: true }, theirs);
    await r.sync.start();
    expect(r.calls.map(c => c.path)).toEqual(["/api/learn/service/progress"]);
    expect(r.store.load()).toEqual(mine);
    expect(r.marker()).toEqual({ owner: B, version: 2, dirty: false });
    const fresh = rig({ owner: B, progress: null, version: 0 }, { owner: A, version: 5, dirty: false }, theirs);
    await fresh.sync.start();
    expect(fresh.store.load()).toEqual(emptyProgress());
  });
  it("treats a corrupt or foreign marker as no marker", async () => {
    for (const marker of ["{", JSON.stringify({ owner: "x", version: 1, dirty: false }), JSON.stringify({ owner: A, version: -1, dirty: false }), JSON.stringify({ owner: A, version: 1, dirty: false, extra: 1 })]) {
      const r = rig({ progress: null }, marker, doc({ "aleinu": T1 }));
      await r.sync.start();
      expect(r.calls.map(c => c.path), marker).toEqual(["/api/learn/service/progress"]);
      expect(parseProgress(r.guest()), marker).toEqual(doc({ "aleinu": T1 }));
    }
  });
  it("refuses a malformed server answer and changes nothing", async () => {
    const local = doc({ "aleinu": T1 }), r = rig({}, undefined, local);
    r.state.owner = "not-an-owner";
    await r.sync.start();
    expect(r.calls.map(c => c.path)).toEqual(["/api/learn/service/progress"]);
    expect(r.store.load()).toEqual(local);
    expect(r.sync.account.state).toBe("unknown");
  });
  it("counts a lesson done while the first sign-in is still being answered as signed-out work: it is set aside, never sent", async () => {
    const r = rig({ progress: null }, undefined, doc({ "aleinu": T1 }));
    r.state.before = path => { if (path === "/api/learn/service/progress") { r.store.save(doc({ "aleinu": T1, "barchu": T2 })); r.sync.changed(); r.state.before = null; } };
    await r.sync.start(); for (let i = 0; i < 4; i++) await settle();
    expect(r.calls.map(c => c.path)).toEqual(["/api/learn/service/progress"]);
    expect(Object.keys(r.guest().lessons).sort()).toEqual(["aleinu", "barchu"]);
    expect(r.store.load()).toEqual(emptyProgress());
    expect(r.state.progress).toBeNull();
  });
  it("never drops a change made while a put meets a conflict", async () => {
    const r = rig({ progress: doc({ "aleinu": T1 }), version: 1 }, { owner: A, version: 1, dirty: false }, doc({ "aleinu": T1 }));
    await r.sync.start();
    r.state.conflictOnce = true; r.state.progress = doc({ "shma": T2 }); r.state.version = 4;
    r.state.before = path => { if (path === "/api/learn/service/progress/put") { r.store.save(doc({ "aleinu": T1, "vahavta": T2, "barchu": T2 })); r.state.before = null; } };
    r.store.save(doc({ "aleinu": T1, "vahavta": T2 })); r.sync.changed();
    r.timers.shift()!(); for (let i = 0; i < 8; i++) await settle();
    expect(Object.keys(r.store.load().lessons).sort()).toEqual(["aleinu", "barchu", "shma", "vahavta"]);
    expect(Object.keys(r.state.progress!.lessons).sort()).toEqual(["aleinu", "barchu", "shma", "vahavta"]);
    expect(r.marker().dirty).toBe(false);
  });
  it("clears the device when signed out after a clean sync, and keeps unsent changes for their account", async () => {
    const clean = rig({ status: 401 }, { owner: A, version: 3, dirty: false }, doc({ "aleinu": T1 }));
    await clean.sync.start();
    expect(clean.store.load()).toEqual(emptyProgress());
    expect(clean.marker()).toBeNull();
    // What was set aside at the first sign-in comes back for signed-out use, and is no longer kept apart.
    const back = rig({ status: 401 }, { owner: A, version: 3, dirty: false }, doc({ "aleinu": T1 }));
    back.storage.setItem(GUEST_KEY, JSON.stringify(doc({ "shma": T2 })));
    await back.sync.start();
    expect(back.store.load()).toEqual(doc({ "shma": T2 }));
    expect(back.marker()).toBeNull();
    expect(back.guest()).toBeNull();
    expect(back.seen.progress.at(-1)).toEqual(doc({ "shma": T2 }));
    const dirty = rig({ status: 401 }, { owner: A, version: 3, dirty: true }, doc({ "aleinu": T1 }));
    await dirty.sync.start();
    expect(dirty.store.load()).toEqual(doc({ "aleinu": T1 }));
    expect(dirty.marker()).toEqual({ owner: A, version: 3, dirty: true });
  });
  it("never clears the device when its own account is refused, or on any other failure, even after a clean sync", async () => {
    for (const status of [403, 404, 409, 429, 500, 503]) {
      const local = doc({ "aleinu": T1 }), r = rig({ status }, { owner: A, version: 3, dirty: false }, local);
      r.state.refusal = status === 403 ? { error: "forbidden", owner: A } : { error: "x" };
      await r.sync.start();
      expect(r.store.load(), String(status)).toEqual(local);
      expect(r.marker(), String(status)).toEqual({ owner: A, version: 3, dirty: false });
      // Refused as its own account, the page shows the set-aside copy (2.0 SC5a review); the account's stays on the device.
      expect(r.seen.progress, String(status)).toEqual(status === 403 ? [emptyProgress()] : []);
    }
    // A membership ended mid-session: the write is refused, the change stays here and stays unsent.
    const r = rig({ progress: doc({ "aleinu": T1 }), version: 3 }, { owner: A, version: 3, dirty: false }, doc({ "aleinu": T1 }));
    await r.sync.start();
    expect(r.sync.account.state).toBe("synced");
    const changed = doc({ "aleinu": T1, "vahavta": T2 });
    r.store.save(changed); r.sync.changed(); r.state.status = 403; r.state.refusal = { error: "forbidden", owner: A };
    r.timers.shift()!(); for (let i = 0; i < 8; i++) await settle();
    expect(r.calls.at(-1)?.path).toBe("/api/learn/service/progress/put");
    expect(r.sync.account.state).toBe("not-eligible");
    expect(r.store.load()).toEqual(changed);
    expect(r.marker()).toEqual({ owner: A, version: 3, dirty: true });
  });
  it("treats a refusal naming another account, or none, as the next person at a shared device: a clean copy is cleared", async () => {
    for (const refusal of [{ error: "forbidden", owner: B }, { error: "forbidden" }, { error: "forbidden", owner: A, extra: 1 }, { error: "forbidden", owner: "A".repeat(32) }]) {
      const r = rig({ status: 403 }, { owner: A, version: 3, dirty: false }, doc({ "aleinu": T1 }));
      r.state.refusal = refusal;
      await r.sync.start();
      expect(r.sync.account.state).toBe("not-eligible");
      expect(r.store.load(), JSON.stringify(refusal)).toEqual(emptyProgress());
      expect(r.marker()).toBeNull();
    }
    // Unsent changes stay for their account whoever is refused.
    const dirty = rig({ status: 403 }, { owner: A, version: 3, dirty: true }, doc({ "aleinu": T1 }));
    dirty.state.refusal = { error: "forbidden", owner: B };
    await dirty.sync.start();
    expect(dirty.store.load()).toEqual(doc({ "aleinu": T1 }));
    expect(dirty.marker()).toEqual({ owner: A, version: 3, dirty: true });
  });
  it("takes the account's copy when nothing is unsent, even at the same version", async () => {
    const account = doc({ "barchu": T2 });
    const r = rig({ progress: account, version: 2 }, { owner: A, version: 2, dirty: false }, doc({ "aleinu": T1 }));
    await r.sync.start();
    expect(r.store.load()).toEqual(account);
    expect(r.calls.map(c => c.path)).toEqual(["/api/learn/service/progress"]);
  });
});

describe("count only signed-in (Daniel, 2026-10-26, 2.0 SC5a)", () => {
  const shma = lessonById("shma")!, vahavta = lessonById("vahavta")!;
  const finish = (r: ReturnType<typeof rig>, lesson = shma) => writeLocal(r.store, r.sync, value => completeLesson(value, lesson, Date.parse(T2)), lesson.id);
  const stamps = (r: ReturnType<typeof rig>) => JSON.parse(r.storage.getItem(STAMPS_KEY) ?? "null");
  const writes = (r: ReturnType<typeof rig>) => r.calls.filter(c => c.path !== "/api/learn/service/progress");
  const run = async () => { for (let i = 0; i < 8; i++) await settle(); };
  /** What a browser built before SC5a reads (origin/main's parser): the document's shape exactly, and a lesson is `{ done }` only. */
  const oldReader = (value: unknown) => {
    const row = value as { schema?: unknown; lessons?: Record<string, unknown>; cards?: unknown };
    return !!row && Object.keys(row).sort().join() === "cards,lessons,schema" && row.schema === "service-course-progress/v1" && !!row.lessons
      && Object.values(row.lessons).every(entry => !!entry && typeof entry === "object" && Object.keys(entry).join() === "done");
  };
  it("guest lessons and a first sign-in upload no guest lesson; a lesson finished once synced goes up with its stamp beside the document", async () => {
    const r = rig({ progress: null }, undefined, completeLesson(emptyProgress(), vahavta, Date.parse(T1)));
    expect(r.sync.stamp).toBeNull();
    await r.sync.start();
    expect(r.sync.stamp).toBe(A);
    finish(r);
    r.timers.shift()!(); await run();
    expect(writes(r).map(c => c.path)).toEqual(["/api/learn/service/progress/put"]);
    expect(writes(r)[0].body.stamps).toEqual(["shma"]);
    expect(Object.keys(writes(r)[0].body.progress.lessons)).toEqual(["shma"]);
    expect(JSON.stringify(r.calls)).not.toContain("vahavta");
    expect(r.guest().lessons).toEqual({ vahavta: { done: T1 } });
  });
  it("writes only documents an older browser reads: the device's copies and every put and merge keep lessons as { done }", async () => {
    const r = rig({ progress: doc({ "aleinu": T1 }), version: 1 }, { owner: A, version: 1, dirty: false }, doc({ "aleinu": T1 }));
    await r.sync.start();
    finish(r);
    r.state.conflictOnce = true;
    r.timers.shift()!(); await run();
    expect(writes(r).map(c => c.path)).toEqual(["/api/learn/service/progress/put", "/api/learn/service/progress/merge"]);
    for (const call of writes(r)) { expect(oldReader(call.body.progress), call.path).toBe(true); expect(call.body.stamps).toEqual(["shma"]); }
    expect(oldReader(r.local())).toBe(true);
    expect(oldReader(r.state.progress)).toBe(true);
    expect(stamps(r).lessons).toHaveProperty("shma");
  });
  it("after the account's session ends, a signed-out lesson goes to the set-aside copy and never rides up with the account's unsent changes", async () => {
    const r = rig({ status: 401, progress: doc({ "aleinu": T1 }), version: 3 }, { owner: A, version: 3, dirty: true }, doc({ "aleinu": T1, "barchu": T2 }));
    await r.sync.start();
    expect(r.sync.account.state).toBe("signed-out");
    expect(r.sync.apart).toBe(true);
    expect(r.seen.progress.at(-1)).toEqual(emptyProgress());
    expect(finish(r, vahavta)!.lessons).toEqual({ vahavta: { done: T2 } });
    expect(r.guest().lessons).toEqual({ vahavta: { done: T2 } });
    expect(r.store.load()).toEqual(doc({ "aleinu": T1, "barchu": T2 }));
    expect(stamps(r)).toBeNull();
    // A signs in again: A's own unsent change goes up, and nothing of the signed-out lesson.
    r.state.status = 200;
    await r.sync.start(); await run();
    expect(writes(r).map(c => c.path)).toEqual(["/api/learn/service/progress/put"]);
    expect(Object.keys(writes(r)[0].body.progress.lessons).sort()).toEqual(["aleinu", "barchu"]);
    expect(writes(r)[0].body.stamps).toEqual([]);
    expect(JSON.stringify(r.calls)).not.toContain("vahavta");
    expect(r.sync.apart).toBe(false);
  });
  it("marks nothing for an account when refused, with no marker, or in a frozen tab", async () => {
    for (const status of [401, 403]) {
      const r = rig({ status }, { owner: A, version: 3, dirty: true }, doc({ "aleinu": T1 }));
      r.state.refusal = { error: "forbidden", owner: A };
      await r.sync.start();
      expect(r.sync.stamp, String(status)).toBeNull();
      finish(r);
      expect(stamps(r), String(status)).toBeNull();
      expect(r.store.load(), String(status)).toEqual(doc({ "aleinu": T1 }));
    }
    const guest = rig({ status: 503 }, undefined, doc({ "aleinu": T1 }));
    await guest.sync.start();
    expect(guest.sync.stamp).toBeNull();
    expect(finish(guest)!.lessons.shma).toEqual({ done: T2 });
    expect(stamps(guest)).toBeNull();
    const frozen = rig({ progress: doc({ "aleinu": T1 }), version: 3 }, { owner: A, version: 3, dirty: false }, doc({ "aleinu": T1 }));
    await frozen.sync.start();
    expect(frozen.sync.stamp).toBe(A);
    frozen.storage.setItem(SYNC_KEY, JSON.stringify({ owner: B, version: 1, dirty: false }));
    expect(frozen.sync.stamp).toBeNull();
    expect(finish(frozen)).toBeNull();
  });
  it("a signed-in learner offline finishes a lesson under the account, and it goes up stamped when the device is back online", async () => {
    const r = rig({ progress: doc({ "aleinu": T1 }), version: 3 }, { owner: A, version: 3, dirty: false }, doc({ "aleinu": T1 }));
    expect(r.sync.stamp).toBe(A);
    r.state.status = 503;
    await r.sync.start();
    expect(r.sync.account.state).toBe("unknown");
    expect(finish(r)!.lessons.shma).toEqual({ done: T2 });
    expect(Object.keys(stamps(r).lessons)).toEqual(["shma"]);
    expect(r.marker()).toEqual({ owner: A, version: 3, dirty: true });
    expect(writes(r)).toEqual([]);
    r.state.status = 200;
    await r.sync.start(); await run();
    const put = writes(r).find(c => c.path === "/api/learn/service/progress/put")!;
    expect(put.body).toMatchObject({ expectedVersion: 3, owner: A, stamps: ["shma"] });
    expect(r.marker()).toEqual({ owner: A, version: 4, dirty: false });
  });
  it("never stamps B's work with A's name when the device changes account while offline, in a tab that never had an answer or one that had", async () => {
    const fresh = rig({ status: 503 }, { owner: A, version: 3, dirty: false }, doc({ "aleinu": T1 }));
    await fresh.sync.start();
    expect(fresh.sync.stamp).toBe(A);
    fresh.storage.setItem(SYNC_KEY, JSON.stringify({ owner: B, version: 7, dirty: false }));
    expect(fresh.sync.stamp).toBeNull();
    finish(fresh);
    expect(stamps(fresh)).toBeNull();
    expect(fresh.guest().lessons).toHaveProperty("shma");
    expect(fresh.store.load()).toEqual(doc({ "aleinu": T1 }));
    fresh.storage.removeItem(SYNC_KEY);
    expect(fresh.sync.stamp).toBeNull();
    const synced = rig({ progress: doc({ "aleinu": T1 }), version: 3 }, { owner: A, version: 3, dirty: false }, doc({ "aleinu": T1 }));
    await synced.sync.start();
    synced.state.status = 503; await synced.sync.start();
    synced.storage.setItem(SYNC_KEY, JSON.stringify({ owner: B, version: 7, dirty: false }));
    expect(synced.sync.stamp).toBeNull();
    expect(finish(synced)).toBeNull();
  });
  it("account A's stamps never count for B on the same device, whether A's copy was clean or unsent", async () => {
    for (const dirty of [false, true]) {
      const r = rig({ owner: B, progress: doc({ "barchu": T2 }), version: 5 }, { owner: A, version: 3, dirty }, doc({ "aleinu": T1, "shma": T2 }));
      r.storage.setItem(STAMPS_KEY, JSON.stringify({ owner: A, synced: 1, lessons: { shma: 2 } }));
      await r.sync.start(); r.store.save(doc({ "barchu": T2, "shma": T2 })); r.sync.changed();
      r.timers.shift()!(); await run();
      expect(r.sync.stamp).toBe(B);
      expect(writes(r).map(c => c.body.stamps)).toEqual([[]]);
      expect(stamps(r)).toEqual(expect.objectContaining({ owner: B, lessons: {} }));
    }
  });
  it("a tab left synced after its account signed out elsewhere drops the stamp it made since the last clean sync, when its put is refused", async () => {
    let clock = 1000;
    const r = rig({ progress: doc({ "aleinu": T1 }), version: 3 }, { owner: A, version: 3, dirty: false }, doc({ "aleinu": T1 }), undefined, () => clock);
    await r.sync.start();
    expect(stamps(r)).toEqual({ owner: A, synced: 1000, lessons: {} });
    clock = 2000; finish(r);
    expect(stamps(r).lessons).toEqual({ shma: 2000 });
    // A signed out in another tab: this tab's put is refused, and the dirty copy stays for A, with no stamp.
    r.state.status = 401;
    r.timers.shift()!(); await run();
    expect(r.marker()).toMatchObject({ owner: A, dirty: true });
    expect(stamps(r).lessons).toEqual({});
    r.state.status = 200;
    await r.sync.start(); await run();
    const put = writes(r).at(-1)!;
    expect(put.path).toBe("/api/learn/service/progress/put");
    expect(Object.keys(put.body.progress.lessons).sort()).toEqual(["aleinu", "shma"]);
    expect(put.body.stamps).toEqual([]);
  });
  it("a clean sign-out drops the account's stamps with its copy", async () => {
    const r = rig({ status: 401 }, { owner: A, version: 3, dirty: false }, doc({ "shma": T1 }));
    r.storage.setItem(STAMPS_KEY, JSON.stringify({ owner: A, synced: 1, lessons: { shma: 1 } }));
    await r.sync.start();
    expect(r.marker()).toBeNull();
    expect(stamps(r)).toBeNull();
  });
});

describe("the course's own keys", () => {
  it("keeps its marker and its document apart from Learn to lein's, so neither course's sync reads the other's", () => {
    expect(SYNC_KEY).toBe("crc-torah:service-sync/v1");
    expect(PROGRESS_KEY).toBe("crc-torah:service-progress/v1");
    expect(GUEST_KEY).toBe("crc-torah:service-guest-progress/v1");
    expect(STAMPS_KEY).toBe("crc-torah:service-stamps/v1");
  });
});

describe("another account signed in in another tab (2.0 SC4 review)", () => {
  // Tab 1 synced as A; A signed out and B signed in in tab 2 without opening the course, so this tab's marker still names A.
  async function switched() {
    const r = rig({ owner: A, progress: doc({ "aleinu": T1 }), version: 3 });
    await r.sync.start();
    expect(r.sync.account).toMatchObject({ state: "synced" });
    const from = r.calls.length;
    r.state.owner = B; r.state.progress = doc({ "barchu": T2 }); r.state.version = 9;
    const mine = doc({ "aleinu": T1, "shma": T2 });
    r.store.save(mine); r.sync.changed();
    return { r, mine, later: () => r.calls.slice(from) };
  }
  it("names A in every write, so a server that checks refuses it; A's unsent change stays here and nothing is merged into B", async () => {
    const { r, mine, later } = await switched();
    r.state.before = path => { if (path.endsWith("/put")) { r.state.status = 403; r.state.refusal = { error: "forbidden", owner: B }; } };
    r.timers.shift()!(); for (let i = 0; i < 8; i++) await settle();
    const put = later().find(c => c.path === "/api/learn/service/progress/put")!;
    expect(put.body.owner).toBe(A);
    expect(later().some(c => c.path === "/api/learn/service/progress/merge")).toBe(false);
    expect(r.store.load()).toEqual(mine);
    expect(r.marker()).toMatchObject({ owner: A, dirty: true });
    expect(r.sync.account.state).toBe("not-eligible");
    expect(r.state.progress).toEqual(doc({ "barchu": T2 }));
  });
  it("freezes a tab refused naming another account until its next start, so B's work there never lands in A's unsent copy", async () => {
    const { r, mine } = await switched();
    r.state.status = 403; r.state.refusal = { error: "forbidden", owner: B };
    r.timers.shift()!(); for (let i = 0; i < 8; i++) await settle();
    expect(r.sync.account.state).toBe("not-eligible");
    expect(r.sync.writable).toBe(false);
    // B, at this tab, changes something: the page may not save it, and changed() marks and schedules nothing.
    const sent = r.calls.length;
    r.sync.changed(); r.sync.flush(); for (let i = 0; i < 8; i++) await settle();
    expect(r.timers).toHaveLength(0);
    expect(r.calls.length).toBe(sent);
    expect(r.store.load()).toEqual(mine);
    expect(r.marker()).toMatchObject({ owner: A, dirty: true });
    // The next start learns B is signed in, and the tab writes for B again.
    r.state.status = 200;
    await r.sync.start(); for (let i = 0; i < 8; i++) await settle();
    expect(r.sync.writable).toBe(true);
  });
  it("does not freeze a tab refused as its own account: a member without a grant keeps saving on this device", async () => {
    const r = rig({ progress: doc({ "aleinu": T1 }), version: 3 }, { owner: A, version: 3, dirty: false }, doc({ "aleinu": T1 }));
    await r.sync.start();
    r.state.status = 403; r.state.refusal = { error: "forbidden", owner: A };
    r.store.save(doc({ "aleinu": T1, "vahavta": T2 })); r.sync.changed();
    r.timers.shift()!(); for (let i = 0; i < 8; i++) await settle();
    expect(r.sync.account.state).toBe("not-eligible");
    expect(r.sync.writable).toBe(true);
  });
  it("never merges A's progress into B on a 409 that names B, even from a server that does not check the owner", async () => {
    const { r, mine, later } = await switched();
    r.timers.shift()!(); for (let i = 0; i < 8; i++) await settle();
    expect(later().filter(c => c.path === "/api/learn/service/progress/put")).toHaveLength(1);
    expect(later().some(c => c.path === "/api/learn/service/progress/merge")).toBe(false);
    expect(r.store.load()).toEqual(mine);
    expect(r.marker()).toMatchObject({ owner: A, dirty: true });
    expect(r.state.progress).toEqual(doc({ "barchu": T2 }));
    expect(r.state.version).toBe(9);
  });
  it("never settles a 200 that names B either: B's copy does not replace A's here, and the browser stops writing", async () => {
    const { r, mine, later } = await switched();
    r.state.version = 3; // The versions happen to match, so the put is accepted by a server that does not check the owner.
    r.timers.shift()!(); for (let i = 0; i < 8; i++) await settle();
    expect(r.store.load()).toEqual(mine);
    expect(r.marker()).toMatchObject({ owner: A, dirty: true });
    expect(r.sync.account.state).toBe("not-eligible");
  });
});
