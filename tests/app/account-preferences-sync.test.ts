import { describe, expect, it } from "vitest";
import { BROWSER_PREFERENCE_KEYS, browserPreferences, createPreferencesSync, parseRemotePreferences, PREFERENCES_PATHS, PREFERENCES_SYNC_KEY, writeBrowserPreferences }
  from "../../src/components/portal/workspace/account-preferences";
import { LENS_STORAGE } from "../../src/components/portal/workspace/study-lens";
import { readRememberedLens, normalizeWorks, DEFAULT_WORKS } from "../../src/components/portal/workspace/study-lens";
import { parseReadingPrefs, scopeKey } from "../../src/components/portal/workspace/reading-prefs";
import { parsePreferences, type Preferences } from "../../src/lib/account-preferences/document";

// Release 1.7 M3b, the browser side: the account wins after sign-in, a first sign-in copies this browser's choices up,
// a remembered "off" stays off, and a shared device never copies one account's choices into another's.
const A = "a".repeat(32), B = "b".repeat(32);
function memoryStorage(initial: Record<string, unknown> = {}) {
  const map = new Map(Object.entries(initial).map(([key, value]) => [key, typeof value === "string" ? value : JSON.stringify(value)]));
  return { map, getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => { map.set(key, value); }, removeItem: (key: string) => { map.delete(key); },
    json: (key: string) => { const raw = map.get(key); return raw === undefined ? undefined : JSON.parse(raw); } };
}
type Server = { owner: string; preferences: Preferences | null; revision: number; status?: number };
function harness(server: Server, initial: Record<string, unknown> = {}) {
  const storage = memoryStorage(initial), calls: { method: string; path: string; body?: Record<string, unknown> }[] = [];
  let timer: (() => void) | null = null, applied = 0;
  const view = () => ({ ok: true, owner: server.owner, preferences: server.preferences, revision: server.revision });
  const respond = (status: number, value: unknown) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
  const fetch = (async (path: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
    calls.push({ method: init?.method ?? "GET", path, ...body ? { body } : {} });
    if (server.status) return respond(server.status, { error: "x" });
    if (path === PREFERENCES_PATHS.get) return respond(200, view());
    if (body!.owner !== server.owner || body!.expectedRevision !== server.revision) return respond(409, { ok: false, code: "conflict", current: view() });
    server.preferences = parsePreferences(body!.preferences); server.revision += 1;
    return respond(200, view());
  }) as typeof globalThis.fetch;
  const sync = createPreferencesSync({ fetch, storage: () => storage, onApplied: () => { applied += 1; }, timer: callback => { timer = callback; return 1; }, clearTimer: () => { timer = null; } });
  return { storage, calls, sync, get applied() { return applied; }, async tick() { const run = timer; timer = null; run?.(); await new Promise(resolve => setTimeout(resolve, 0)); await new Promise(resolve => setTimeout(resolve, 0)); } };
}
const marker = (owner: string, revision: number, changed: string[] = [], active = true) => ({ owner, revision, changed, active });

describe("the browser's personal-reader keys", () => {
  it("are the Study lens's weekly key and the reading settings' unscoped key", () => {
    expect(BROWSER_PREFERENCE_KEYS.lens).toBe(LENS_STORAGE.weekly);
    expect(BROWSER_PREFERENCE_KEYS.reading).toBe(scopeKey(null));
  });
  it("read only what this browser remembers, and write a document back so the lens and the settings read it as chosen", () => {
    const storage = memoryStorage({ [LENS_STORAGE.weekly]: { lens: "study", works: ["womens", "rashi", "x"], english: false }, [scopeKey(null)]: { colors: false, tikkun: true, junk: 1 } });
    expect(browserPreferences(storage)).toEqual({ version: 1, works: ["rashi", "womens"], studyEnglish: false, colors: false, tikkunView: "beside" });
    expect(browserPreferences(memoryStorage())).toEqual({ version: 1 });
    expect(browserPreferences(memoryStorage({ [LENS_STORAGE.weekly]: "{not json", [scopeKey(null)]: "[]" }))).toEqual({ version: 1 });
    writeBrowserPreferences(storage, { version: 1, works: [], size: "huge" });
    // The lens this browser last used stays its own; English and colours are no longer remembered, so their defaults return.
    expect(storage.json(LENS_STORAGE.weekly)).toEqual({ lens: "study", works: [] });
    expect(readRememberedLens(storage, LENS_STORAGE.weekly)).toEqual({ lens: "study", works: [] });
    expect(parseReadingPrefs(storage.getItem(scopeKey(null)))).toMatchObject({ colors: true, size: "huge", tikkunView: "off" });
    writeBrowserPreferences(storage, { version: 1 });
    expect(storage.json(scopeKey(null))).toBeUndefined();
    expect(readRememberedLens(storage, LENS_STORAGE.weekly)).toEqual({ lens: "study" });
    expect(normalizeWorks(undefined)).toEqual(DEFAULT_WORKS);
  });
  it("parse the account's answer strictly", () => {
    expect(parseRemotePreferences({ ok: true, owner: A, preferences: null, revision: 0 })).toEqual({ owner: A, preferences: null, revision: 0 });
    for (const bad of [null, [], { ok: true, owner: A, preferences: null, revision: 1 }, { ok: true, owner: A, preferences: { version: 1 }, revision: 0 }, { ok: true, owner: "x", preferences: null, revision: 0 },
      { ok: true, owner: A, preferences: { version: 1, note: "x" }, revision: 1 }, { ok: true, owner: A, preferences: null, revision: 0, extra: 1 }, { ok: false, owner: A, preferences: null, revision: 0 }])
      expect(parseRemotePreferences(bad), JSON.stringify(bad)).toBeNull();
  });
});

describe("signing in", () => {
  it("never asks from /read in a browser that has not signed in here", async () => {
    const h = harness({ owner: A, preferences: { version: 1, works: [] }, revision: 3 });
    await h.sync.start(false);
    expect(h.calls).toEqual([]);
    expect(h.storage.json(PREFERENCES_SYNC_KEY)).toBeUndefined();
  });

  it("first sign-in with no account copy: this browser's remembered choices, a remembered off included, are copied up", async () => {
    const h = harness({ owner: A, preferences: null, revision: 0 }, { [LENS_STORAGE.weekly]: { lens: "lein", works: [], english: true }, [scopeKey(null)]: { size: "large" } });
    await h.sync.start(true);
    expect(h.calls.map(call => `${call.method} ${call.path}`)).toEqual(["GET /api/saved/preferences", "POST /api/saved/preferences/put"]);
    expect(h.calls[1].body).toEqual({ preferences: { version: 1, works: [], studyEnglish: true, size: "large" }, expectedRevision: 0, owner: A });
    expect(h.storage.json(PREFERENCES_SYNC_KEY)).toEqual(marker(A, 1));
    expect(h.sync.account).toBe("synced");
    // /read in the same browser now asks, and the account's copy (the same) stays.
    const again = harness({ owner: A, preferences: { version: 1, works: [], studyEnglish: true, size: "large" }, revision: 1 }, Object.fromEntries(h.storage.map));
    await again.sync.start(false);
    expect(again.calls.map(call => call.method)).toEqual(["GET"]);
    expect(readRememberedLens(again.storage, LENS_STORAGE.weekly).works).toEqual([]);
  });

  it("first sign-in with nothing remembered uploads nothing, so the account never pins the defaults", async () => {
    const h = harness({ owner: A, preferences: null, revision: 0 });
    await h.sync.start(true);
    expect(h.calls.map(call => call.method)).toEqual(["GET"]);
    expect(h.storage.json(PREFERENCES_SYNC_KEY)).toEqual(marker(A, 0));
  });

  it("the account's copy wins after sign-in and is written back into this browser exactly", async () => {
    const h = harness({ owner: A, preferences: { version: 1, works: [], colors: true }, revision: 4 },
      { [LENS_STORAGE.weekly]: { lens: "study", works: ["rashi", "womens"], english: false }, [scopeKey(null)]: { colors: false, size: "huge" } });
    await h.sync.start(true);
    expect(h.calls.map(call => call.method)).toEqual(["GET"]);
    // Every commentary off, as the account remembers it: the default (Rashi and the Women's Commentary on) does not come back.
    expect(readRememberedLens(h.storage, LENS_STORAGE.weekly)).toEqual({ lens: "study", works: [] });
    expect(h.storage.json(scopeKey(null))).toEqual({ colors: true });
    expect(browserPreferences(h.storage)).toEqual({ version: 1, works: [], colors: true });
    expect(h.applied).toBe(1);
    expect(h.storage.json(PREFERENCES_SYNC_KEY)).toEqual(marker(A, 4));
  });

  it("a remembered off in the account is never turned back on by this browser's default-looking value", async () => {
    // A browser that once switched lens remembers the default works explicitly; the account's off still wins.
    const h = harness({ owner: A, preferences: { version: 1, works: [] }, revision: 2 }, { [LENS_STORAGE.weekly]: { lens: "lein", works: ["rashi", "womens"], english: true },
      [PREFERENCES_SYNC_KEY]: marker(A, 1) });
    await h.sync.start(false);
    expect(readRememberedLens(h.storage, LENS_STORAGE.weekly).works).toEqual([]);
    expect(h.calls.map(call => call.method)).toEqual(["GET"]);
  });

  it("a shared device: another account's choices are never copied up, and this account's replace them", async () => {
    const browser = { [LENS_STORAGE.weekly]: { lens: "lein", works: [] }, [scopeKey(null)]: { size: "huge" }, [PREFERENCES_SYNC_KEY]: marker(A, 5, [], false) };
    const empty = harness({ owner: B, preferences: null, revision: 0 }, browser);
    await empty.sync.start(true);
    expect(empty.calls.map(call => call.method)).toEqual(["GET"]);
    expect(browserPreferences(empty.storage)).toEqual({ version: 1 });
    expect(empty.storage.json(PREFERENCES_SYNC_KEY)).toEqual(marker(B, 0));
    const kept = harness({ owner: B, preferences: { version: 1, colors: false }, revision: 2 }, browser);
    await kept.sync.start(true);
    expect(browserPreferences(kept.storage)).toEqual({ version: 1, colors: false });
    expect(kept.calls.map(call => call.method)).toEqual(["GET"]);
  });

  it("signed out or refused: this browser stops asking from /read and keeps what it has", async () => {
    const h = harness({ owner: A, preferences: null, revision: 0, status: 401 }, { [scopeKey(null)]: { size: "large" }, [PREFERENCES_SYNC_KEY]: marker(A, 3) });
    await h.sync.start(false);
    expect(h.sync.account).toBe("signed-out");
    expect(h.storage.json(PREFERENCES_SYNC_KEY)).toEqual(marker(A, 3, [], false));
    expect(h.storage.json(scopeKey(null))).toEqual({ size: "large" });
    const next = harness({ owner: A, preferences: null, revision: 0 }, Object.fromEntries(h.storage.map));
    await next.sync.start(false);
    expect(next.calls).toEqual([]);
    // Offline: nothing changes and the browser keeps its copy.
    const offline = harness({ owner: A, preferences: null, revision: 0, status: 503 }, { [scopeKey(null)]: { size: "small" }, [PREFERENCES_SYNC_KEY]: marker(A, 3) });
    await offline.sync.start(false);
    expect(offline.storage.json(PREFERENCES_SYNC_KEY)).toEqual(marker(A, 3));
    expect(offline.storage.json(scopeKey(null))).toEqual({ size: "small" });
  });
});

describe("changes while signed in", () => {
  it("save to this browser at once and to the account shortly after, under the revision last seen", async () => {
    const h = harness({ owner: A, preferences: { version: 1, works: ["rashi"] }, revision: 1 }, { [PREFERENCES_SYNC_KEY]: marker(A, 1) });
    await h.sync.start(false);
    h.storage.setItem(scopeKey(null), JSON.stringify({ size: "huge" }));
    h.sync.changed();
    expect(h.storage.json(PREFERENCES_SYNC_KEY)).toEqual(marker(A, 1, ["size"]));
    expect(h.calls.map(call => call.method)).toEqual(["GET"]);
    await h.tick();
    expect(h.calls[1].body).toEqual({ preferences: { version: 1, works: ["rashi"], size: "huge" }, expectedRevision: 1, owner: A });
    expect(h.storage.json(PREFERENCES_SYNC_KEY)).toEqual(marker(A, 2));
    // Turning every commentary off is sent as a choice.
    h.storage.setItem(LENS_STORAGE.weekly, JSON.stringify({ lens: "study", works: [], english: true }));
    h.sync.changed(); await h.tick();
    expect(h.calls[2].body?.preferences).toEqual({ version: 1, works: [], studyEnglish: true, size: "huge" });
  });

  it("another device wrote first: the changed fields are laid over the account's current copy and sent again", async () => {
    const server: Server = { owner: A, preferences: { version: 1, works: ["rashi"] }, revision: 1 };
    const h = harness(server, { [PREFERENCES_SYNC_KEY]: marker(A, 1) });
    await h.sync.start(false);
    server.preferences = { version: 1, works: [], colors: false }; server.revision = 2;
    h.storage.setItem(scopeKey(null), JSON.stringify({ size: "small" }));
    h.sync.changed(); await h.tick();
    expect(h.calls.map(call => `${call.method} ${call.body?.expectedRevision ?? ""}`)).toEqual(["GET ", "POST 1", "POST 2"]);
    expect(server.preferences).toEqual({ version: 1, works: [], colors: false, size: "small" });
    expect(browserPreferences(h.storage)).toEqual({ version: 1, works: [], colors: false, size: "small" });
    expect(h.storage.json(PREFERENCES_SYNC_KEY)).toEqual(marker(A, 3));
  });

  it("unsent changes from an earlier page are laid over the account's copy at the next start", async () => {
    const server: Server = { owner: A, preferences: { version: 1, works: [] }, revision: 2 };
    const h = harness(server, { [scopeKey(null)]: { colors: false }, [LENS_STORAGE.weekly]: { lens: "lein", works: ["rashi"] }, [PREFERENCES_SYNC_KEY]: marker(A, 1, ["colors"]) });
    await h.sync.start(false);
    // Only the changed field is this browser's; the account keeps its own works.
    expect(server.preferences).toEqual({ version: 1, works: [], colors: false });
    expect(readRememberedLens(h.storage, LENS_STORAGE.weekly).works).toEqual([]);
  });

  it("are not tracked while signed out, and not for another account", async () => {
    const h = harness({ owner: A, preferences: null, revision: 0, status: 401 }, { [PREFERENCES_SYNC_KEY]: marker(A, 1) });
    await h.sync.start(false);
    h.storage.setItem(scopeKey(null), JSON.stringify({ size: "huge" }));
    h.sync.changed(); await h.tick();
    expect(h.calls.map(call => call.method)).toEqual(["GET"]);
    expect(h.storage.json(PREFERENCES_SYNC_KEY)).toEqual(marker(A, 1, [], false));
  });

  it("a session that became another account meanwhile writes nothing", async () => {
    const server: Server = { owner: A, preferences: { version: 1 }, revision: 1 };
    const h = harness(server, { [PREFERENCES_SYNC_KEY]: marker(A, 1) });
    await h.sync.start(false);
    server.owner = B;
    h.storage.setItem(scopeKey(null), JSON.stringify({ colors: false }));
    h.sync.changed(); await h.tick();
    expect(server.preferences).toEqual({ version: 1 });
    expect(h.sync.account).toBe("unknown");
  });
});
