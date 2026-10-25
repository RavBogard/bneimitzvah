import { describe, expect, it } from "vitest";
import { browserProgressStore, emptyProgress, mergeProgress, parseProgress, PROGRESS_KEY, type Progress } from "../../src/lib/learn/progress";
import { createProgressSync, SYNC_KEY, type Account } from "../../src/components/learn/progress-sync";

// The browser half of signed-in progress, against a fake server and in-memory storage.
class MemoryStorage { values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; } setItem(key: string, value: string) { this.values.set(key, value); } removeItem(key: string) { this.values.delete(key); } }
const A = "a".repeat(32), B = "b".repeat(32);
const doc = (lessons: Record<string, string>, cards: Record<string, [number, string]> = {}) => parseProgress({ schema: "learn-progress/v1",
  lessons: Object.fromEntries(Object.entries(lessons).map(([id, done]) => [id, { done }])), cards: Object.fromEntries(Object.entries(cards).map(([id, [box, due]]) => [id, { box, due }])) })!;
const T1 = "2026-10-20T10:00:00.000Z", T2 = "2026-10-21T10:00:00.000Z";

function rig(server: { owner?: string; progress?: Progress | null; version?: number; status?: number; until?: string | null } = {}, marker?: unknown, local?: Progress) {
  const storage = new MemoryStorage(), store = browserProgressStore(() => storage as unknown as Storage);
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
    if (path === "/api/learn/progress") return reply(200, view());
    if (path === "/api/learn/progress/merge") { state.progress = state.progress ? mergeProgress(state.progress, parseProgress(body.progress)!) : parseProgress(body.progress); state.version++; return reply(200, view()); }
    if (path === "/api/learn/progress/put") {
      if (state.conflictOnce || body.expectedVersion !== state.version) { state.conflictOnce = false; return reply(409, { ok: false, code: "conflict", current: view() }); }
      state.progress = parseProgress(body.progress); state.version++; return reply(200, view());
    }
    return reply(404, {});
  }) as unknown as typeof fetch;
  const timers: (() => void)[] = [], seen: { progress: Progress[]; accounts: Account[] } = { progress: [], accounts: [] };
  const sync = createProgressSync({ fetch: fetcher, storage: () => storage as unknown as Storage, store, onProgress: p => seen.progress.push(p), onAccount: a => seen.accounts.push(a),
    timer: callback => { timers.push(callback); return timers.length; }, clearTimer: () => {} });
  const marker_ = () => JSON.parse(storage.getItem(SYNC_KEY) ?? "null");
  return { storage, store, state, calls, sync, seen, timers, marker: marker_, local: () => JSON.parse(storage.getItem(PROGRESS_KEY) ?? "null") };
}
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

describe("signed-in progress in the browser", () => {
  it("signed out or without a grant, nothing leaves the browser and nothing changes in it", async () => {
    for (const [status, state] of [[401, "signed-out"], [403, "not-eligible"]] as const) {
      const local = doc({ "intro-phrases": T1 }), r = rig({ status }, undefined, local);
      await r.sync.start();
      expect(r.sync.account.state).toBe(state);
      expect(r.calls.map(c => c.path)).toEqual(["/api/learn/progress"]);
      expect(r.store.load()).toEqual(local);
      expect(r.marker()).toBeNull();
    }
  });
  it("on first sign-in merges the browser's progress into the account's, and replaces the local copy only with the server's answer", async () => {
    const local = doc({ "intro-phrases": T2 }, { "sof-pasuk:torah:name": [3, "2026-10-30"] }), account = doc({ "intro-phrases": T1, "torah-etnachta": T2 });
    const r = rig({ progress: account, version: 4, until: "2027-01-02" }, undefined, local);
    await r.sync.start();
    expect(r.calls.map(c => c.path)).toEqual(["/api/learn/progress", "/api/learn/progress/merge"]);
    expect(r.calls[1].body).toEqual({ progress: local, owner: A });
    expect(r.store.load()).toEqual(mergeProgress(account, local));
    expect(r.marker()).toEqual({ owner: A, version: 5, dirty: false });
    expect(r.sync.account).toEqual({ state: "synced", until: "2027-01-02" });
  });
  it("keeps the browser's copy untouched when the first merge does not answer", async () => {
    const local = doc({ "intro-phrases": T1 }), r = rig({ progress: null }, undefined, local);
    const start = r.sync.start(); r.state.status = 503; await start;
    expect(r.store.load()).toEqual(local);
    expect(r.marker()).toBeNull();
  });
  it("writes a change back under the version last seen, and merges when another device got there first", async () => {
    const r = rig({ progress: doc({ "intro-phrases": T1 }), version: 1 }, { owner: A, version: 1, dirty: false }, doc({ "intro-phrases": T1 }));
    await r.sync.start();
    expect(r.calls.map(c => c.path)).toEqual(["/api/learn/progress"]);
    r.store.save(doc({ "intro-phrases": T1, "torah-sof-pasuk": T2 })); r.sync.changed();
    expect(r.marker().dirty).toBe(true);
    r.timers.shift()!(); await settle(); await settle();
    expect(r.calls.at(-1)).toMatchObject({ path: "/api/learn/progress/put", body: { expectedVersion: 1 } });
    expect(r.marker()).toEqual({ owner: A, version: 2, dirty: false });
    r.state.conflictOnce = true; r.state.progress = doc({ "torah-etnachta": T2 }); r.state.version = 7;
    r.store.save(doc({ "intro-phrases": T1, "torah-sof-pasuk": T2, "torah-zakef": T2 })); r.sync.changed();
    r.timers.shift()!(); await settle(); await settle(); await settle();
    expect(r.calls.slice(-2).map(c => c.path)).toEqual(["/api/learn/progress/put", "/api/learn/progress/merge"]);
    expect(Object.keys(r.store.load().lessons).sort()).toEqual(["intro-phrases", "torah-etnachta", "torah-sof-pasuk", "torah-zakef"]);
    expect(r.marker()).toEqual({ owner: A, version: 8, dirty: false });
  });
  it("takes the account's newer copy when the browser has nothing unsent, and merges when it has", async () => {
    const newer = doc({ "torah-etnachta": T2 });
    const clean = rig({ progress: newer, version: 3 }, { owner: A, version: 1, dirty: false }, doc({ "intro-phrases": T1 }));
    await clean.sync.start();
    expect(clean.store.load()).toEqual(newer);
    expect(clean.calls.map(c => c.path)).toEqual(["/api/learn/progress"]);
    const dirty = rig({ progress: newer, version: 3 }, { owner: A, version: 1, dirty: true }, doc({ "intro-phrases": T1 }));
    await dirty.sync.start();
    expect(dirty.calls.map(c => c.path)).toEqual(["/api/learn/progress", "/api/learn/progress/merge"]);
    expect(Object.keys(dirty.store.load().lessons).sort()).toEqual(["intro-phrases", "torah-etnachta"]);
  });
  it("on a shared device never folds another account's progress into this one: it takes this account's copy", async () => {
    const theirs = doc({ "intro-phrases": T1, "torah-sof-pasuk": T1 }), mine = doc({ "torah-etnachta": T2 });
    const r = rig({ owner: B, progress: mine, version: 2 }, { owner: A, version: 5, dirty: true }, theirs);
    await r.sync.start();
    expect(r.calls.map(c => c.path)).toEqual(["/api/learn/progress"]);
    expect(r.store.load()).toEqual(mine);
    expect(r.marker()).toEqual({ owner: B, version: 2, dirty: false });
    const fresh = rig({ owner: B, progress: null, version: 0 }, { owner: A, version: 5, dirty: false }, theirs);
    await fresh.sync.start();
    expect(fresh.store.load()).toEqual(emptyProgress());
  });
  it("treats a corrupt or foreign marker as no marker", async () => {
    for (const marker of ["{", JSON.stringify({ owner: "x", version: 1, dirty: false }), JSON.stringify({ owner: A, version: -1, dirty: false }), JSON.stringify({ owner: A, version: 1, dirty: false, extra: 1 })]) {
      const r = rig({ progress: null }, marker, doc({ "intro-phrases": T1 }));
      await r.sync.start();
      expect(r.calls.map(c => c.path), marker).toEqual(["/api/learn/progress", "/api/learn/progress/merge"]);
    }
  });
  it("refuses a malformed server answer and changes nothing", async () => {
    const local = doc({ "intro-phrases": T1 }), r = rig({}, undefined, local);
    r.state.owner = "not-an-owner";
    await r.sync.start();
    expect(r.calls.map(c => c.path)).toEqual(["/api/learn/progress"]);
    expect(r.store.load()).toEqual(local);
    expect(r.sync.account.state).toBe("unknown");
  });
  it("never drops a change made while the first-sign-in merge is out: it is folded in and sent next", async () => {
    const r = rig({ progress: null }, undefined, doc({ "intro-phrases": T1 }));
    r.state.before = path => { if (path === "/api/learn/progress/merge") { r.store.save(doc({ "intro-phrases": T1, "torah-etnachta": T2 })); r.sync.changed(); r.state.before = null; } };
    await r.sync.start(); await settle(); await settle(); await settle();
    expect(r.calls.map(c => c.path)).toEqual(["/api/learn/progress", "/api/learn/progress/merge", "/api/learn/progress/put"]);
    expect(Object.keys(r.store.load().lessons).sort()).toEqual(["intro-phrases", "torah-etnachta"]);
    expect(Object.keys(r.state.progress!.lessons).sort()).toEqual(["intro-phrases", "torah-etnachta"]);
    expect(r.marker()).toEqual({ owner: A, version: 2, dirty: false });
  });
  it("never drops a change made while a put meets a conflict", async () => {
    const r = rig({ progress: doc({ "intro-phrases": T1 }), version: 1 }, { owner: A, version: 1, dirty: false }, doc({ "intro-phrases": T1 }));
    await r.sync.start();
    r.state.conflictOnce = true; r.state.progress = doc({ "torah-sof-pasuk": T2 }); r.state.version = 4;
    r.state.before = path => { if (path === "/api/learn/progress/put") { r.store.save(doc({ "intro-phrases": T1, "torah-zakef": T2, "torah-etnachta": T2 })); r.state.before = null; } };
    r.store.save(doc({ "intro-phrases": T1, "torah-zakef": T2 })); r.sync.changed();
    r.timers.shift()!(); for (let i = 0; i < 8; i++) await settle();
    expect(Object.keys(r.store.load().lessons).sort()).toEqual(["intro-phrases", "torah-etnachta", "torah-sof-pasuk", "torah-zakef"]);
    expect(Object.keys(r.state.progress!.lessons).sort()).toEqual(["intro-phrases", "torah-etnachta", "torah-sof-pasuk", "torah-zakef"]);
    expect(r.marker().dirty).toBe(false);
  });
  it("clears the device when signed out after a clean sync, and keeps unsent changes for their account", async () => {
    const clean = rig({ status: 401 }, { owner: A, version: 3, dirty: false }, doc({ "intro-phrases": T1 }));
    await clean.sync.start();
    expect(clean.store.load()).toEqual(emptyProgress());
    expect(clean.marker()).toBeNull();
    const dirty = rig({ status: 401 }, { owner: A, version: 3, dirty: true }, doc({ "intro-phrases": T1 }));
    await dirty.sync.start();
    expect(dirty.store.load()).toEqual(doc({ "intro-phrases": T1 }));
    expect(dirty.marker()).toEqual({ owner: A, version: 3, dirty: true });
  });
  it("never clears the device when its own account is refused, or on any other failure, even after a clean sync", async () => {
    for (const status of [403, 404, 409, 429, 500, 503]) {
      const local = doc({ "intro-phrases": T1 }), r = rig({ status }, { owner: A, version: 3, dirty: false }, local);
      r.state.refusal = status === 403 ? { error: "forbidden", owner: A } : { error: "x" };
      await r.sync.start();
      expect(r.store.load(), String(status)).toEqual(local);
      expect(r.marker(), String(status)).toEqual({ owner: A, version: 3, dirty: false });
      expect(r.seen.progress, String(status)).toEqual([]);
    }
    // A membership ended mid-session: the write is refused, the change stays here and stays unsent.
    const r = rig({ progress: doc({ "intro-phrases": T1 }), version: 3 }, { owner: A, version: 3, dirty: false }, doc({ "intro-phrases": T1 }));
    await r.sync.start();
    expect(r.sync.account.state).toBe("synced");
    const changed = doc({ "intro-phrases": T1, "torah-zakef": T2 });
    r.store.save(changed); r.sync.changed(); r.state.status = 403; r.state.refusal = { error: "forbidden", owner: A };
    r.timers.shift()!(); for (let i = 0; i < 8; i++) await settle();
    expect(r.calls.at(-1)?.path).toBe("/api/learn/progress/put");
    expect(r.sync.account.state).toBe("not-eligible");
    expect(r.store.load()).toEqual(changed);
    expect(r.marker()).toEqual({ owner: A, version: 3, dirty: true });
  });
  it("treats a refusal naming another account, or none, as the next person at a shared device: a clean copy is cleared", async () => {
    for (const refusal of [{ error: "forbidden", owner: B }, { error: "forbidden" }, { error: "forbidden", owner: A, extra: 1 }, { error: "forbidden", owner: "A".repeat(32) }]) {
      const r = rig({ status: 403 }, { owner: A, version: 3, dirty: false }, doc({ "intro-phrases": T1 }));
      r.state.refusal = refusal;
      await r.sync.start();
      expect(r.sync.account.state).toBe("not-eligible");
      expect(r.store.load(), JSON.stringify(refusal)).toEqual(emptyProgress());
      expect(r.marker()).toBeNull();
    }
    // Unsent changes stay for their account whoever is refused.
    const dirty = rig({ status: 403 }, { owner: A, version: 3, dirty: true }, doc({ "intro-phrases": T1 }));
    dirty.state.refusal = { error: "forbidden", owner: B };
    await dirty.sync.start();
    expect(dirty.store.load()).toEqual(doc({ "intro-phrases": T1 }));
    expect(dirty.marker()).toEqual({ owner: A, version: 3, dirty: true });
  });
  it("takes the account's copy when nothing is unsent, even at the same version", async () => {
    const account = doc({ "torah-etnachta": T2 });
    const r = rig({ progress: account, version: 2 }, { owner: A, version: 2, dirty: false }, doc({ "intro-phrases": T1 }));
    await r.sync.start();
    expect(r.store.load()).toEqual(account);
    expect(r.calls.map(c => c.path)).toEqual(["/api/learn/progress"]);
  });
});

describe("another account signed in in another tab", () => {
  // Tab 1 synced as A; A signed out and B signed in in tab 2 without opening Learn, so this tab's marker still names A.
  async function switched() {
    const r = rig({ owner: A, progress: doc({ "intro-phrases": T1 }), version: 3 }, { owner: A, version: 3, dirty: false }, doc({ "intro-phrases": T1 }));
    await r.sync.start();
    expect(r.sync.account).toMatchObject({ state: "synced" });
    const from = r.calls.length;
    r.state.owner = B; r.state.progress = doc({ "torah-etnachta": T2 }); r.state.version = 9;
    const mine = doc({ "intro-phrases": T1, "torah-sof-pasuk": T2 });
    r.store.save(mine); r.sync.changed();
    return { r, mine, later: () => r.calls.slice(from) };
  }
  it("names A in every write, so the server refuses it; A's unsent change stays here and nothing is merged into B", async () => {
    const { r, mine, later } = await switched();
    r.state.before = path => { if (path.endsWith("/put")) { r.state.status = 403; r.state.refusal = { error: "forbidden", owner: B }; } };
    r.timers.shift()!(); for (let i = 0; i < 8; i++) await settle();
    const puts = later().filter(c => c.path === "/api/learn/progress/put");
    expect(puts).toHaveLength(1);
    expect(puts[0].body).toEqual({ progress: mine, expectedVersion: 3, owner: A });
    expect(later().some(c => c.path === "/api/learn/progress/merge")).toBe(false);
    expect(r.store.load()).toEqual(mine);
    expect(r.marker()).toEqual({ owner: A, version: 3, dirty: true });
    expect(r.sync.account.state).toBe("not-eligible");
    expect(r.state.progress).toEqual(doc({ "torah-etnachta": T2 }));
    // Nothing more leaves this tab for B: a later change is kept here, not sent.
    r.store.save(doc({ "intro-phrases": T1, "torah-sof-pasuk": T2, "torah-zakef": T2 })); r.sync.changed();
    expect(r.timers).toHaveLength(0);
    expect(later()).toHaveLength(1);
  });
  it("never merges A's progress into B on a 409 that names B, even from a server that does not check the owner", async () => {
    const { r, mine, later } = await switched();
    r.timers.shift()!(); for (let i = 0; i < 8; i++) await settle();
    expect(later().filter(c => c.path === "/api/learn/progress/put")).toHaveLength(1);
    expect(later().some(c => c.path === "/api/learn/progress/merge")).toBe(false);
    expect(r.store.load()).toEqual(mine);
    expect(r.marker()).toEqual({ owner: A, version: 3, dirty: true });
    expect(r.sync.account.state).toBe("not-eligible");
    expect(r.state.progress).toEqual(doc({ "torah-etnachta": T2 }));
    expect(r.state.version).toBe(9);
  });
  it("never settles a 200 that names B either: B's copy does not replace A's here, and the browser stops writing", async () => {
    const { r, mine } = await switched();
    r.state.version = 3; // The versions happen to match, so the put is accepted by a server that does not check the owner.
    r.timers.shift()!(); for (let i = 0; i < 8; i++) await settle();
    expect(r.store.load()).toEqual(mine);
    expect(r.marker()).toEqual({ owner: A, version: 3, dirty: true });
    expect(r.sync.account.state).toBe("not-eligible");
    expect(r.seen.progress.at(-1)).not.toEqual(doc({ "torah-etnachta": T2 }));
  });
  it("keeps the first sign-in copy working: a fresh browser's progress still goes into the account that signed in", async () => {
    const local = doc({ "intro-phrases": T1 }), r = rig({ owner: B, progress: doc({ "torah-etnachta": T2 }), version: 2 }, undefined, local);
    await r.sync.start();
    expect(r.calls.map(c => c.path)).toEqual(["/api/learn/progress", "/api/learn/progress/merge"]);
    expect(r.calls[1].body).toEqual({ progress: local, owner: B });
    expect(r.store.load()).toEqual(mergeProgress(doc({ "torah-etnachta": T2 }), local));
    expect(r.marker()).toEqual({ owner: B, version: 3, dirty: false });
  });
  it("on a closed 400 (a write the server cannot read) keeps the change here, unsent, and does not retry on its own", async () => {
    const r = rig({ progress: doc({ "intro-phrases": T1 }), version: 3 }, { owner: A, version: 3, dirty: false }, doc({ "intro-phrases": T1 }));
    await r.sync.start();
    const changed = doc({ "intro-phrases": T1, "torah-zakef": T2 });
    r.store.save(changed); r.sync.changed(); r.state.status = 400;
    r.timers.shift()!(); for (let i = 0; i < 8; i++) await settle();
    expect(r.calls.map(c => c.path)).toEqual(["/api/learn/progress", "/api/learn/progress/put"]);
    expect(r.store.load()).toEqual(changed);
    expect(r.marker()).toEqual({ owner: A, version: 3, dirty: true });
    expect(r.timers).toHaveLength(0);
  });
});
