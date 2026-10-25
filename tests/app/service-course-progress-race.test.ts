import { describe, expect, it } from "vitest";
import { browserProgressStore, emptyProgress, mergeProgress, parseProgress, PROGRESS_KEY, type Progress } from "../../src/lib/service-course/progress";
import { createProgressSync, SYNC_KEY, type SyncIo } from "../../src/components/learn/service/progress-sync";
import { writeLocal } from "../../src/components/learn/service/progress";

// 2.0 SC4 review (as #102 for Learn to lein): two tabs share one browser's storage. Tab 1's request for A is still out when A signs
// out and B signs in and opens the course in tab 2. Whatever tab 1's answer says, B's copy on the device must never be folded into
// A's account, and A's progress must never be saved over B's. A fake server with a shared cookie; synthetic lesson ids only.
class Memory { values = new Map<string, string>(); getItem(k: string) { return this.values.get(k) ?? null; } setItem(k: string, v: string) { this.values.set(k, v); } removeItem(k: string) { this.values.delete(k); } }
const A = "a".repeat(32), B = "b".repeat(32), T1 = "2026-10-20T10:00:00.000Z", T2 = "2026-10-21T10:00:00.000Z";
const doc = (lessons: Record<string, string>) => parseProgress({ schema: "service-course-progress/v1", lessons: Object.fromEntries(Object.entries(lessons).map(([k, d]) => [k, { done: d }])), cards: {} })!;
const reply = (status: number, value: unknown) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
const tick = async () => { for (let i = 0; i < 12; i++) await new Promise(r => setTimeout(r, 0)); };

function browser(options: { conflict?: boolean; lock?: SyncIo["lock"] } = {}) {
  const accounts: Record<string, { progress: Progress | null; version: number }> = { [A]: { progress: doc({ shma: T1 }), version: 3 }, [B]: { progress: doc({ barchu: T2 }), version: 7 } };
  const state = { cookie: A, hold: null as null | (() => Promise<void>), conflict: options.conflict ?? false };
  const view = (who: string) => ({ ok: true, owner: who, progress: accounts[who].progress, version: accounts[who].version, until: null });
  const fetcher = (async (path: string, init?: RequestInit) => {
    const who = state.cookie, body = init?.body ? JSON.parse(String(init.body)) : undefined;
    if (path === "/api/learn/service/progress") return reply(200, view(who));
    if (body.owner !== who) return reply(403, { error: "forbidden", owner: who });
    let answer: Response;
    if (path.endsWith("/put")) {
      if (state.conflict || body.expectedVersion !== accounts[who].version) { state.conflict = false; answer = reply(409, { ok: false, code: "conflict", current: view(who) }); }
      else { accounts[who].progress = parseProgress(body.progress); accounts[who].version++; answer = reply(200, view(who)); }
    } else {
      const current = accounts[who]; current.progress = current.progress ? mergeProgress(current.progress, parseProgress(body.progress)!) : parseProgress(body.progress); current.version++;
      answer = reply(200, view(who));
    }
    // The answer is slow: the other tab acts before it arrives.
    if (state.hold) { const hold = state.hold; state.hold = null; await hold(); }
    return answer;
  }) as unknown as typeof fetch;
  const storage = new Memory(), store = browserProgressStore(() => storage as unknown as Storage);
  const tab = () => {
    const timers: (() => void)[] = [];
    const sync = createProgressSync({ fetch: fetcher, storage: () => storage as unknown as Storage, store, onProgress: () => {}, onAccount: () => {},
      timer: callback => { timers.push(callback); return timers.length; }, clearTimer: () => {}, ...(options.lock ? { lock: options.lock } : {}) });
    return { sync, timers };
  };
  /** A signs out and B signs in and opens the course in another tab, while tab 1's request is out. */
  const switchToB = () => { state.hold = async () => { state.cookie = B; await tab().sync.start(); }; };
  return { accounts, state, storage, store, tab, switchToB, marker: () => JSON.parse(storage.getItem(SYNC_KEY) ?? "null") };
}
const lessons = (progress: Progress | null) => Object.keys(progress?.lessons ?? {}).sort();

describe("two tabs, one browser, an account switch while a request is out", () => {
  for (const lock of [undefined, (async (_name: string, action: () => Promise<unknown>) => action()) as SyncIo["lock"]]) {
    const label = lock ? "with no lock manager" : "with the Web Lock";
    it(`a slow put for A, answered after B took the device, never folds B into A (${label})`, async () => {
      const b = browser({ lock });
      b.store.save(doc({ shma: T1 })); b.storage.setItem(SYNC_KEY, JSON.stringify({ owner: A, version: 3, dirty: false }));
      const t1 = b.tab(); await t1.sync.start(); expect(t1.sync.account.state).toBe("synced");
      b.store.save(doc({ shma: T1, vahavta: T1 })); t1.sync.changed();
      b.switchToB(); t1.timers.shift()!(); await tick();
      // B's tab owns the device: its copy and marker stand, and tab 1 stopped writing.
      expect(b.marker()).toEqual({ owner: B, version: 7, dirty: false });
      expect(lessons(b.store.load())).toEqual(["barchu"]);
      expect(t1.sync.account.state).toBe("not-eligible");
      // A signs in again on this browser later: nothing of B's reaches A's account.
      b.state.cookie = A; await b.tab().sync.start(); await tick();
      expect(lessons(b.accounts[A].progress)).not.toContain("barchu");
      expect(lessons(b.accounts[B].progress)).toEqual(["barchu"]);
    });
  }

  it("a 409 for A after B took the device does not merge B's copy into A", async () => {
    const b = browser({ conflict: true });
    b.store.save(doc({ shma: T1 })); b.storage.setItem(SYNC_KEY, JSON.stringify({ owner: A, version: 3, dirty: false }));
    const t1 = b.tab(); await t1.sync.start();
    b.store.save(doc({ shma: T1, vahavta: T1 })); t1.sync.changed();
    b.switchToB(); t1.timers.shift()!(); await tick();
    expect(lessons(b.accounts[A].progress)).toEqual(["shma"]);
    expect(b.marker()).toMatchObject({ owner: B });
    expect(lessons(b.store.load())).toEqual(["barchu"]);
    expect(t1.sync.account.state).toBe("not-eligible");
  });

  it("a first sign-in's merge for A, answered after B took the device, saves nothing of A's over B's copy", async () => {
    const b = browser();
    b.store.save(doc({ vahavta: T1 }));
    const t1 = b.tab();
    b.switchToB();
    await t1.sync.start(); await tick();
    // Tab 2's own first sign-in folds the signed-out copy into B, as it should; A's answer then changes nothing on the device.
    expect(b.marker()).toMatchObject({ owner: B });
    expect(lessons(b.store.load())).toEqual(lessons(b.accounts[B].progress));
    expect(lessons(b.store.load())).not.toContain("shma");
    expect(lessons(b.accounts[B].progress)).not.toContain("shma");
    expect(t1.sync.account.state).toBe("not-eligible");
  });

  it("drops the marker at a sign-out only once the device's copy is emptied", async () => {
    const b = browser();
    b.store.save(doc({ shma: T1 })); b.storage.setItem(SYNC_KEY, JSON.stringify({ owner: A, version: 3, dirty: false }));
    const failing = { load: () => b.store.load(), save: (progress: Progress) => lessons(progress).length ? b.store.save(progress) : false };
    const sync = createProgressSync({ fetch: (async () => reply(401, { error: "unauthorized" })) as unknown as typeof fetch, storage: () => b.storage as unknown as Storage, store: failing,
      onProgress: () => {}, onAccount: () => {} });
    await sync.start();
    expect(b.marker()).toEqual({ owner: A, version: 3, dirty: false });
    expect(lessons(b.store.load())).toEqual(["shma"]);
    expect(sync.account.state).toBe("signed-out");
    expect(b.storage.getItem(PROGRESS_KEY)).not.toBeNull();
    expect(emptyProgress().schema).toBe("service-course-progress/v1");
  });

  it("freezes a tab another account took the device from: it saves nothing more and marks nothing until its next start", async () => {
    const b = browser();
    b.store.save(doc({ shma: T1 })); b.storage.setItem(SYNC_KEY, JSON.stringify({ owner: A, version: 3, dirty: false }));
    const t1 = b.tab(); await t1.sync.start(); expect(t1.sync.writable).toBe(true);
    b.store.save(doc({ shma: T1, vahavta: T1 })); t1.sync.changed();
    b.switchToB(); t1.timers.shift()!(); await tick();
    expect(t1.sync.writable).toBe(false);
    // Someone now using tab 1 (B, at the same browser) finishes a lesson there: B's copy on the device is untouched.
    const before = b.storage.getItem(PROGRESS_KEY), marker = b.marker();
    expect(writeLocal(b.store, t1.sync, value => ({ ...value, lessons: { ...value.lessons, aleinu: { done: T2 } } }))).toBeNull();
    t1.sync.changed();
    expect(b.storage.getItem(PROGRESS_KEY)).toBe(before);
    expect(b.marker()).toEqual(marker);
    expect(t1.timers).toHaveLength(0);
    // Its next start learns the session is B's, and the tab works again, for B.
    await t1.sync.start(); await tick();
    expect(t1.sync.writable).toBe(true);
    expect(writeLocal(b.store, t1.sync, value => ({ ...value, lessons: { ...value.lessons, aleinu: { done: T2 } } }))).not.toBeNull();
    expect(lessons(b.store.load())).toEqual(["aleinu", "barchu"]);
    expect(b.marker()).toMatchObject({ owner: B, dirty: true });
  });
});
