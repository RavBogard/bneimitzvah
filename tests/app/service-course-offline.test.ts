import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import vm from "node:vm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { unavailableExtras } from "../helpers/translations";
import { syntheticEveningCatalog } from "../helpers/evening-text";
import { syntheticResponse } from "../helpers/study";
import { createPublicReadingService } from "../../src/server/public-reading/service";
import { createSefariaStudyReader } from "../../src/server/study/sefaria";
import { createSefariaCommentaryReader } from "../../src/server/study/commentary";
import { syntheticCommentaryFetch } from "../helpers/commentary";
import { TANAKH_VERSE_COUNTS } from "../../src/lib/readings/catalog";
import { handlePublicReadingRequest, type PublicRuntime } from "../../src/server/http/public-reading";
import { eveningTextOf, parseEveningBook } from "../../src/server/service-course/evening";
import { CRC_TENANT, EVENING_TEXT_UNITS, SERVICE_COURSE, SERVICE_TEXT_UNITS, lessonOpen } from "../../src/lib/service-course/course";
import type { ServiceText } from "../../src/lib/service-course/text";
import type { Path } from "../../src/lib/service-course/path";
import { eveningTextPath, serviceTextPath, versePath } from "../../src/components/learn/service/text-api";
import { EVENING_PACK_KEY, openOffline, renewPack, servicePackCurrent, servicePackPaths, PackStopped, type OwnerAnswer, type PackerIo } from "../../src/lib/offline/packer";
import { purgeOffline, readIndex, setOfflineState, sweep } from "../../src/lib/offline/pack-index";
import { pathRequest, readPathCopy, savePathCopy } from "../../src/lib/offline/path-copy";
import { INDEX_KEY, OFFLINE_CACHE, PATH_COPY_KEY, SERVICE_PACK_KEY, TORAH_ORIGIN, WINDOW_MS, ownerOnlyAsset, packAssetAllowed, parsePackIndex, servicePackAssetAllowed } from "../../src/lib/offline/policy";
import { SHELL_PAGES } from "../../src/lib/offline/shell";
import { workerSource } from "../../src/lib/offline/worker-source";
import { OfflineShelfView, shelfRows } from "../../src/components/portal/offline/shelf";
import type { Pack } from "../../src/lib/offline/policy";

// Release 2.0 SC6: the service course offline. The service-course pack is public-lane text only; the evening text (the CRC siddur's) stays
// an owner pack of a signed-in CRC person; the device's last copy of a student's parts is the owner's and goes with the owner's packs.
// Synthetic Hebrew only: invented letter strings, never prayer text.
const origin = TORAH_ORIGIN, NOW = Date.parse("2026-10-26T15:00:00Z"), OWNER = "o".repeat(43), OTHER = "p".repeat(43);
const letters = (seed: number) => Array.from({ length: 3 }, (_, i) => String.fromCharCode(0x05d0 + ((seed * 7 + i * 5 + 3) % 22))).join("");
const synthetic = (unit: string): ServiceText => ({ unit, volume: "shabbat-shacharit", credit: { title: "Synthetic volume", licence: "CC BY-NC-SA 4.0" },
  lines: Array.from({ length: 4 }, (_, line) => ({ he: Array.from({ length: 12 }, (_, w) => letters(line * 20 + w)).join(" "), tr: "synthetic", en: "Synthetic line." })) });

class FakeCache {
  entries = new Map<string, Response>();
  async match(input: RequestInfo) { const hit = this.entries.get(new URL(typeof input === "string" ? input : input.url, origin).href); return hit?.clone(); }
  async put(input: RequestInfo, response: Response) { this.entries.set(new URL(typeof input === "string" ? input : input.url, origin).href, response.clone()); }
  async delete(input: RequestInfo) { return this.entries.delete(new URL(typeof input === "string" ? input : input.url, origin).href); }
  async keys() { return [...this.entries.keys()].map(url => new Request(url)); }
}
class FakeCaches { stores = new Map<string, FakeCache>(); async open(name: string) { if (!this.stores.has(name)) this.stores.set(name, new FakeCache()); return this.stores.get(name)!; } async has(name: string) { return this.stores.has(name); } async delete(name: string) { return this.stores.delete(name); } async keys() { return [...this.stores.keys()]; } }

/** The packer against the real public routes: synthetic service text, synthetic verses, a synthetic siddur book. This week and the course fail. */
function harness(owner: () => OwnerAnswer = () => ({ state: "signed-out" })) {
  const c = syntheticEveningCatalog(), book = parseEveningBook(c.feedBytes, c.provenanceBytes, c.pins, c.pin);
  const reading = createPublicReadingService({ loadReading: async () => { throw new Error("unused"); },
    loadText: createSefariaStudyReader({ fetch: vi.fn<typeof globalThis.fetch>(async url => syntheticResponse(decodeURIComponent(new URL(url instanceof Request ? url.url : url).pathname.split("/").at(-1)!))), verseCounts: TANAKH_VERSE_COUNTS }),
    stepSource: { book: async () => Object.freeze([]), lexicon: async () => Object.freeze([]) }, pocketTorah: null });
  const runtime: PublicRuntime = { resolveTenant: async () => undefined, reading, commentary: createSefariaCommentaryReader({ fetch: syntheticCommentaryFetch() as typeof globalThis.fetch }), ...unavailableExtras,
    serviceText: async unit => synthetic(unit), eveningText: async unit => eveningTextOf(book, unit, CRC_TENANT.siddurBook) };
  const requests: { url: string; init: RequestInit }[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input); requests.push({ url, init });
    const path = new URL(url).pathname;
    const response = /^\/api\/public\/(?:service-text|evening-text|text)$/.test(path) ? await handlePublicReadingRequest(new Request(url.replace(origin, "http://localhost:3000")), async action => action(runtime))
      : new Response(null, { status: 503 });
    Object.defineProperty(response, "url", { value: url });
    return response;
  }) as unknown as typeof globalThis.fetch;
  const caches = new FakeCaches();
  const io: PackerIo = { origin, fetch, caches: caches as unknown as CacheStorage, now: () => NOW, estimate: async () => ({ usage: 0, quota: 10 ** 9 }), owner: async () => owner() };
  const index = async () => readIndex((await caches.open(OFFLINE_CACHE)) as unknown as Cache);
  const stored = async () => [...(await caches.open(OFFLINE_CACHE)).entries.keys()].map(url => url.slice(origin.length));
  return { io, caches, requests, index, stored };
}
const signal = () => new AbortController().signal;
const UNIT_PATHS = [...SERVICE_TEXT_UNITS].sort().map(serviceTextPath);
const VERSE_PATHS = [...new Set(SERVICE_COURSE.lessons.flatMap(lesson => lesson.read?.torahRef ? [versePath(lesson.read.torahRef)] : []))].sort();

describe("the service-course pack (public lane only)", () => {
  it("is every course unit's public text and the word card's verses: no evening unit, nothing of the licensed book, nothing private", () => {
    expect([...servicePackPaths()].sort()).toEqual([...UNIT_PATHS, ...VERSE_PATHS].sort());
    expect(UNIT_PATHS.length).toBe(30); expect(VERSE_PATHS.length).toBeGreaterThan(0);
    for (const path of servicePackPaths()) {
      expect(servicePackAssetAllowed(path), path).toBe(true);
      expect(path, path).not.toMatch(/evening-text|%40bm-|bm-maariv|mi-shebeirach/);
    }
  });
  it("packs them with no cookie into a public pack, each answer checked; the evening route and the siddur are never asked", async () => {
    const h = harness();
    expect(await renewPack(h.io, { type: "service" }, signal())).toBe("saved");
    const pack = (await h.index()).packs.find(row => row.key === SERVICE_PACK_KEY)!;
    expect(pack).toMatchObject({ owner: "public", descriptor: { type: "service" }, renewedAt: NOW, expiresAt: NOW + WINDOW_MS });
    expect([...pack.assets].sort()).toEqual([...servicePackPaths()].sort());
    expect(servicePackCurrent(pack)).toBe(true);
    for (const asset of pack.assets) expect(await (await h.caches.open(OFFLINE_CACHE)).match(origin + asset), asset).toBeTruthy();
    expect(h.requests.every(row => row.init.credentials === "omit" && row.init.referrerPolicy === "no-referrer")).toBe(true);
    expect(h.requests.some(row => /evening-text|siddur\.|\/api\/(?!public\/)/.test(row.url))).toBe(false);
  });
  it("is never an owner's pack, and a unit that does not parse leaves the old pack as it was", async () => {
    const h = harness();
    await expect(renewPack(h.io, { type: "service" }, signal(), { owner: OWNER, label: "" })).rejects.toBeInstanceOf(PackStopped);
    const bad = harness();
    (bad.io as { fetch: typeof fetch }).fetch = (async () => Object.defineProperty(new Response(JSON.stringify({ unit: "x" }), { headers: { "content-type": "application/json" } }), "url", { value: origin + UNIT_PATHS[0] })) as unknown as typeof fetch;
    await expect(renewPack(bad.io, { type: "service" }, signal())).rejects.toBeInstanceOf(PackStopped);
    expect((await bad.index()).packs).toEqual([]);
  });
  it("keeps a verse page out when it does not load, and still saves the units (the line keeps its glossary cards)", async () => {
    const h = harness(), real = h.io.fetch;
    (h.io as { fetch: typeof fetch }).fetch = (async (input: RequestInfo | URL, init?: RequestInit) => String(input).includes("/api/public/text?")
      ? Object.defineProperty(new Response(null, { status: 503 }), "url", { value: String(input) }) : real(input, init)) as typeof fetch;
    await renewPack(h.io, { type: "service" }, signal());
    const pack = (await h.index()).packs.find(row => row.key === SERVICE_PACK_KEY)!;
    expect([...pack.assets].sort()).toEqual(UNIT_PATHS);
    expect(servicePackCurrent(pack)).toBe(true);
    expect(servicePackCurrent({ assets: UNIT_PATHS.slice(1) })).toBe(false);
    expect(servicePackCurrent({ assets: [...UNIT_PATHS, "/api/public/text?ref=Genesis+1%3A1&kind=torah&offset=0"] })).toBe(false);
  });
  it("is renewed at every open for everyone, signed out too, while the evening text is kept only for a signed-in CRC person", async () => {
    const out = harness(() => ({ state: "signed-out" }));
    await openOffline(out.io);
    expect((await out.index()).packs.map(row => row.key)).toEqual([SERVICE_PACK_KEY]);
    expect((await out.stored()).some(ownerOnlyAsset)).toBe(false);
    expect(out.requests.some(row => row.url.includes("evening-text"))).toBe(false);
    // A signed-in person of another congregation (or any answer without `evening: true`) keeps the public pack alone.
    const other = harness(() => ({ state: "owner", owner: OWNER, packs: [], evening: false }));
    await openOffline(other.io);
    expect((await other.index()).packs.map(row => row.key)).toEqual([SERVICE_PACK_KEY]);
    expect(other.requests.some(row => row.url.includes("evening-text"))).toBe(false);
    const crc = harness(() => ({ state: "owner", owner: OWNER, packs: [], evening: true }));
    await openOffline(crc.io);
    const packs = (await crc.index()).packs;
    expect(packs.map(row => [row.key, row.owner]).sort()).toEqual([[EVENING_PACK_KEY, OWNER], [SERVICE_PACK_KEY, "public"]]);
    expect(packs.find(row => row.key === SERVICE_PACK_KEY)!.assets.some(ownerOnlyAsset)).toBe(false);
    expect([...packs.find(row => row.key === EVENING_PACK_KEY)!.assets].sort()).toEqual([...EVENING_TEXT_UNITS].map(eveningTextPath).sort());
  });
  it("loses the evening pack at sign-out and when another account takes the device; the public service pack is all that stays", async () => {
    let answer: OwnerAnswer = { state: "owner", owner: OWNER, packs: [], evening: true };
    const h = harness(() => answer);
    await openOffline(h.io);
    expect((await h.stored()).filter(ownerOnlyAsset)).toHaveLength(11);
    answer = { state: "signed-out" };
    await openOffline(h.io);
    expect((await h.index()).packs.map(row => row.key)).toEqual([SERVICE_PACK_KEY]);
    expect((await h.stored()).filter(ownerOnlyAsset)).toEqual([]);
    answer = { state: "owner", owner: OWNER, packs: [], evening: true };
    await openOffline(h.io);
    answer = { state: "owner", owner: OTHER, packs: [] };
    await openOffline(h.io);
    expect((await h.index()).owner).toBe(OTHER);
    expect((await h.index()).packs.map(row => row.key)).toEqual([SERVICE_PACK_KEY]);
    expect((await h.stored()).filter(ownerOnlyAsset)).toEqual([]);
  });
});

describe("refusals: what a service-course pack may never hold", () => {
  const unit = [...SERVICE_TEXT_UNITS][0], evening = eveningTextPath([...EVENING_TEXT_UNITS][0]);
  const pack = (owner: string, assets: string[], descriptor: unknown = { type: "service" }) => ({ key: SERVICE_PACK_KEY, owner, label: "", descriptor, assets, bytes: 1, renewedAt: NOW, expiresAt: NOW + WINDOW_MS, format: 1 });
  const PRIVATE = ["/api/learn/service/path", "/api/learn/service/progress", "/api/offline/packs", "/api/session", "/api/students/x/service-finished?mode=tutor", "/learn/service/shma", "/sw.js"];
  it("refuses the evening text, a licensed-book unit, the Mi Shebeirach, another query shape and every private route", () => {
    for (const bad of [evening, serviceTextPath(unit).replace("%40shabbat-shacharit", "%40bm-maariv"), serviceTextPath("torah.mi-shebeirach@shabbat-shacharit"),
      `${serviceTextPath(unit)}&x=1`, "/api/public/service-text", "/api/public/text?ref=Deuteronomy+6%3A4&kind=torah&offset=1", "/api/public/text?date=2026-10-31&kind=torah&offset=0",
      "/api/public/reading?ref=Genesis+1%3A1&kind=torah", ...PRIVATE]) expect(servicePackAssetAllowed(bad), bad).toBe(false);
    for (const bad of PRIVATE) expect(packAssetAllowed(bad), bad).toBe(false);
    // The evening route takes only an evening unit of the pinned build's shape.
    expect(packAssetAllowed(evening)).toBe(true);
    expect(packAssetAllowed(evening.replace("%40bm-maariv", "%40shabbat-shacharit"))).toBe(false);
  });
  it("makes a stored service pack holding any of them, or one claimed by an owner, no index at all", () => {
    expect(parsePackIndex({ format: 1, owner: OWNER, packs: [pack("public", [serviceTextPath(unit)])] }).packs).toHaveLength(1);
    for (const bad of [pack("public", [serviceTextPath(unit), evening]), pack("public", [evening]), pack(OWNER, [serviceTextPath(unit)]),
      pack("public", [serviceTextPath(unit), "/api/public/reading?ref=Genesis+1%3A1&kind=torah"]), ...PRIVATE.map(path => pack("public", [path]))])
      expect(parsePackIndex({ format: 1, owner: OWNER, packs: [bad] }), JSON.stringify(bad)).toEqual({ format: 1, owner: null, packs: [] });
  });
  it("is served by the worker offline from a live public pack, and the evening text is not, from the same pack", async () => {
    async function worker(index: unknown, asset: string) {
      const caches = new FakeCaches(), listeners = new Map<string, ((event: unknown) => void)[]>();
      const self = { location: new URL(`${origin}/sw.js`), addEventListener: (type: string, handler: (event: unknown) => void) => listeners.set(type, [...(listeners.get(type) ?? []), handler]),
        registration: { unregister: vi.fn(async () => true) }, clients: { claim: vi.fn(async () => undefined) }, skipWaiting: vi.fn(async () => undefined), navigator: {} };
      const context = vm.createContext({ self, caches, fetch: async () => { throw new TypeError("offline"); }, Response, Headers, Request, URL, TextDecoder, TextEncoder, console });
      vm.runInContext(await workerSource({ build: "abc1234", enabled: true }), context);
      const cache = await caches.open(OFFLINE_CACHE);
      await cache.put(INDEX_KEY, new Response(JSON.stringify(index), { headers: { "content-type": "application/json" } }));
      await cache.put(asset, new Response('{"synthetic":true}', { headers: { "content-type": "application/json" } }));
      let answer: Promise<Response> | null = null;
      for (const handler of listeners.get("fetch") ?? []) handler({ request: new Request(new URL(asset, origin)), respondWith: (work: Promise<Response>) => { answer = work; } });
      try { return answer ? (await answer as Response).status : null; } catch { return "network-error"; }
    }
    const live = (assets: string[]) => ({ ...pack("public", assets), renewedAt: Date.now(), expiresAt: Date.now() + WINDOW_MS });
    expect(await worker({ format: 1, owner: null, packs: [live([serviceTextPath(unit)])] }, serviceTextPath(unit))).toBe(200);
    expect(await worker({ format: 1, owner: OWNER, packs: [live([evening])] }, evening)).toBe("network-error");
  });
});

describe("the shell and /offline", () => {
  it("keeps the course's home, About, Review, Quick ten and every open lesson page as the app shell", () => {
    for (const page of ["/learn/service", "/learn/service/about", "/learn/service/review", "/learn/service/practice/quick-ten",
      ...SERVICE_COURSE.lessons.filter(lesson => lessonOpen(lesson)).map(lesson => `/learn/service/${lesson.id}`)]) expect(SHELL_PAGES, page).toContain(page);
    expect(SHELL_PAGES.every(page => !page.startsWith("/api/"))).toBe(true);
  });
  it("lists the service course as one row that opens it, also when the evening text is saved beside it", () => {
    const row = (descriptor: Pack["descriptor"], key: string, owner = "public"): Pack => ({ key, owner, label: "", descriptor, assets: [], bytes: 1, renewedAt: NOW, expiresAt: NOW + WINDOW_MS, format: 1 });
    const service = row({ type: "service" }, SERVICE_PACK_KEY), evening = row({ type: "evening" }, EVENING_PACK_KEY, OWNER);
    expect(shelfRows([service, evening])).toEqual([service]);
    expect(shelfRows([evening])).toEqual([evening]);
    const html = renderToStaticMarkup(createElement(OfflineShelfView, { live: true, packs: [service, evening], removed: false, productName: null, onRemove: () => {} }));
    expect(html.match(/data-pack="/g)).toHaveLength(1);
    expect(html).toMatch(/<li data-pack="service">.*href="\/learn\/service"/);
  });
});

describe("the last copy of a student's parts (Your parts offline)", () => {
  const path: Path = { ok: true, state: "assigned", slot: "havdalah", review: false, items: [{ lesson: "shma", page: 10 }, { lesson: "vahavta" }], serviceStart: 7,
    plan: { id: "00000000-0000-4000-8000-000000000001", revision: 2, catalogId: "00000000-0000-4000-8000-000000000002", catalogIdentity: "a".repeat(64) } };
  async function device(owner: string | null) {
    const caches = new FakeCaches(), storage = caches as unknown as CacheStorage;
    const cache = await caches.open(OFFLINE_CACHE);
    await cache.put(INDEX_KEY, new Response(JSON.stringify({ format: 1, owner, packs: [] }), { headers: { "content-type": "application/json" } }));
    return { caches, storage, cache };
  }
  /** This page's owner check, as openOffline records it, then the request taken before the parts are fetched. */
  const checked = (owner: string | null) => { setOfflineState({ ownerChecked: true, ownerKey: owner }); return pathRequest(); };
  it("is kept only after this page's owner check named an owner, as that owner's, and holds no pages, plan or catalog ids", async () => {
    const d = await device(OWNER);
    setOfflineState({ ownerChecked: false, ownerKey: null });
    expect(pathRequest()).toBeNull();
    expect(await savePathCopy(path, pathRequest(), NOW, d.storage)).toBe(false);
    expect(await savePathCopy(path, checked(OWNER), NOW, d.storage)).toBe(true);
    const stored = await (await d.cache.match(PATH_COPY_KEY))!.json();
    expect(stored).toEqual({ format: 1, owner: OWNER, savedAt: NOW, path: { ok: true, state: "assigned", slot: "havdalah", review: false, items: [{ lesson: "shma" }, { lesson: "vahavta" }] } });
    expect(await readPathCopy(NOW + 1000, d.storage)).toEqual({ savedAt: NOW, path: { ok: true, state: "assigned", slot: "havdalah", review: false, items: [{ lesson: "shma" }, { lesson: "vahavta" }] } });
    // Not past 14 days, and never another owner's.
    expect(await readPathCopy(NOW + WINDOW_MS, d.storage)).toBeNull();
    await d.cache.put(INDEX_KEY, new Response(JSON.stringify({ format: 1, owner: OTHER, packs: [] })));
    expect(await readPathCopy(NOW + 1000, d.storage)).toBeNull();
  });
  it("parts fetched for A, index now B: nothing saved (two windows, A signs out and B signs in while A's request is out)", async () => {
    const d = await device(OWNER);
    const forA = checked(OWNER);
    // Window 2: B's open made B the device's owner; this window's check still names A.
    await d.cache.put(INDEX_KEY, new Response(JSON.stringify({ format: 1, owner: OTHER, packs: [] })));
    expect(await savePathCopy(path, forA, NOW, d.storage)).toBe(false);
    expect(d.cache.entries.has(origin + PATH_COPY_KEY)).toBe(false);
    // This window's own check then names B: a request taken before it (for A) still saves nothing.
    setOfflineState({ ownerKey: OTHER });
    expect(await savePathCopy(path, forA, NOW, d.storage)).toBe(false);
    expect(d.cache.entries.has(origin + PATH_COPY_KEY)).toBe(false);
    // A sign-out purge since the request began (another tab's arrives by its channel) saves nothing either, even under the same owner.
    const e = await device(OWNER), before = checked(OWNER)!;
    expect(await savePathCopy(path, { ...before, generation: before.generation - 1 }, NOW, e.storage)).toBe(false);
    expect(e.cache.entries.has(origin + PATH_COPY_KEY)).toBe(false);
    // A check that named no one (signed out) gives no request at all.
    expect(checked(null)).toBeNull();
  });
  it("is never kept for a device with no owner, and never recreates a pack cache a purge deleted", async () => {
    const d = await device(null);
    expect(await savePathCopy(path, checked(OWNER), NOW, d.storage)).toBe(false);
    const e = await device(OWNER);
    await e.caches.delete(OFFLINE_CACHE);
    expect(await savePathCopy(path, checked(OWNER), NOW, e.storage)).toBe(false);
    expect(await e.caches.has(OFFLINE_CACHE)).toBe(false);
  });
  it("goes at sign-out (the open's sweep and the purge) and when another account takes the device; it stays for its own owner", async () => {
    const d = await device(OWNER);
    await savePathCopy(path, checked(OWNER), NOW, d.storage);
    await sweep(d.cache as unknown as Cache, NOW + 1000);
    expect(d.cache.entries.has(origin + PATH_COPY_KEY)).toBe(true);
    await sweep(d.cache as unknown as Cache, NOW + 1000, () => true, OTHER);
    expect(d.cache.entries.has(origin + PATH_COPY_KEY)).toBe(false);
    await d.cache.put(INDEX_KEY, new Response(JSON.stringify({ format: 1, owner: OWNER, packs: [] })));
    await savePathCopy(path, checked(OWNER), NOW, d.storage);
    await sweep(d.cache as unknown as Cache, NOW + 1000, () => true, null);
    expect(d.cache.entries.has(origin + PATH_COPY_KEY)).toBe(false);
    // An account switch at an open deletes the whole pack cache, the copy with it; the open records the owner its check named.
    let answer: OwnerAnswer = { state: "owner", owner: OWNER, packs: [] };
    const h = harness(() => answer);
    await openOffline(h.io);
    expect(await savePathCopy(path, pathRequest(), NOW, h.caches as unknown as CacheStorage)).toBe(true);
    await openOffline(h.io);
    expect(await readPathCopy(NOW, h.caches as unknown as CacheStorage)).not.toBeNull();
    answer = { state: "owner", owner: OTHER, packs: [] };
    await openOffline(h.io);
    expect(await readPathCopy(NOW, h.caches as unknown as CacheStorage)).toBeNull();
    expect((await h.stored()).includes(PATH_COPY_KEY)).toBe(false);
  });
  it("goes with Remove saved readings and the sign-out purge, which also forgets the checked owner", async () => {
    const caches = new FakeCaches();
    vi.stubGlobal("caches", caches);
    try {
      const cache = await caches.open(OFFLINE_CACHE);
      await cache.put(INDEX_KEY, new Response(JSON.stringify({ format: 1, owner: OWNER, packs: [] })));
      const request = checked(OWNER);
      await savePathCopy(path, request, NOW);
      expect(await readPathCopy(NOW)).not.toBeNull();
      await purgeOffline();
      expect(await readPathCopy(NOW)).toBeNull();
      expect(await caches.has(OFFLINE_CACHE)).toBe(false);
      expect(pathRequest()).toBeNull();
      await caches.open(OFFLINE_CACHE).then(c => c.put(INDEX_KEY, new Response(JSON.stringify({ format: 1, owner: OWNER, packs: [] }))));
      expect(await savePathCopy(path, request, NOW)).toBe(false);
    } finally { vi.unstubAllGlobals(); }
  });
});
