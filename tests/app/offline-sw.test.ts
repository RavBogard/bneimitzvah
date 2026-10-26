import { describe, expect, test, vi } from "vitest";
import vm from "node:vm";
import { workerSource } from "../../src/lib/offline/worker-source";
import { CLIP_PATH, DAY_MS, INDEX_KEY, OFFLINE_CACHE, OFFLINE_HEADER, PACK_DATA_PATH, SHELL_LIMITS, SKEW_MS, STATIC_PATH, TORAH_ORIGIN, BEIT_MITZVAH_ORIGIN, WINDOW_MS, workerPolicy } from "../../src/lib/offline/policy";
import { SHELL_PAGES } from "../../src/lib/offline/shell";

// The service worker in node:vm with a fake self, caches and fetch (1.5 plan §6.1). Synthetic bodies only.
const ORIGIN = TORAH_ORIGIN;
const basic = (response: Response) => { Object.defineProperty(response, "type", { value: "basic" }); return response; };
const keyOf = (input: RequestInfo | URL, origin: string) => new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, origin).href;

class FakeCache {
  entries = new Map<string, Response>();
  constructor(readonly origin: string) {}
  async match(input: RequestInfo, _options?: CacheQueryOptions) { const hit = this.entries.get(keyOf(input, this.origin)); return hit ? hit.clone() : undefined; }
  async put(input: RequestInfo, response: Response) { this.entries.set(keyOf(input, this.origin), response.clone()); }
  async delete(input: RequestInfo) { return this.entries.delete(keyOf(input, this.origin)); }
  async keys() { return [...this.entries.keys()].map(url => new Request(url)); }
}
class FakeCaches {
  stores = new Map<string, FakeCache>();
  constructor(readonly origin: string) {}
  async open(name: string) { let cache = this.stores.get(name); if (!cache) { cache = new FakeCache(this.origin); this.stores.set(name, cache); } return cache; }
  async has(name: string) { return this.stores.has(name); }
  async delete(name: string) { return this.stores.delete(name); }
  async keys() { return [...this.stores.keys()]; }
}
type Handler = (event: unknown) => void;
async function load(options: { enabled?: boolean; origin?: string; origins?: readonly string[]; fetch?: (request: Request) => Promise<Response>; caches?: FakeCaches } = {}) {
  const origin = options.origin ?? ORIGIN, listeners = new Map<string, Handler[]>(), caches = options.caches ?? new FakeCaches(origin);
  const network = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(new URL(String(input), origin), init);
    if (!options.fetch) throw new TypeError("offline");
    return options.fetch(request);
  });
  const self = { location: new URL(`${origin}/sw.js`), addEventListener: (type: string, handler: Handler) => listeners.set(type, [...(listeners.get(type) ?? []), handler]),
    registration: { unregister: vi.fn(async () => true) }, clients: { claim: vi.fn(async () => undefined) }, skipWaiting: vi.fn(async () => undefined), navigator: {} };
  const context = vm.createContext({ self, caches, fetch: network, Response, Headers, Request, URL, TextDecoder, TextEncoder, console });
  vm.runInContext(await workerSource({ build: "abc1234", enabled: options.enabled ?? true, ...(options.origins ? { origins: options.origins } : {}) }), context);
  async function lifecycle(type: "install" | "activate") {
    const waits: Promise<unknown>[] = [];
    for (const handler of listeners.get(type) ?? []) handler({ waitUntil: (work: Promise<unknown>) => waits.push(work) });
    await Promise.all(waits);
  }
  /** Dispatches a fetch event: the response the worker gave, or null when it let the browser handle the request. */
  async function request(path: string, init: RequestInit & { mode?: RequestMode } = {}, base = origin): Promise<Response | null> {
    const { mode, ...rest } = init;
    const req = new Request(new URL(path, base), rest);
    if (mode === "navigate") Object.defineProperty(req, "mode", { value: "navigate" });
    let answer: Promise<Response> | null = null;
    for (const handler of listeners.get("fetch") ?? []) handler({ request: req, respondWith: (work: Promise<Response>) => { answer = work; } });
    return answer ? await answer : null;
  }
  return { self, listeners, caches, network, lifecycle, request, context };
}
const json = (value: unknown) => basic(new Response(JSON.stringify(value), { headers: { "content-type": "application/json; charset=utf-8" } }));
const DATA = "/api/public/text?date=2026-10-24&kind=torah&offset=0";
const CLIP = `/reference-audio/short-v1/${"a".repeat(64)}.mp3`;
function pack(renewedAt: number, assets: string[], expiresAt = renewedAt + WINDOW_MS) {
  return { key: "week:2026-10-24", owner: "public", label: "Synthetic", descriptor: { type: "week", date: "2026-10-24" }, assets, bytes: 1, renewedAt, expiresAt, format: 1 };
}
async function seed(caches: FakeCaches, packs: unknown[], extra: Record<string, Response> = {}) {
  const cache = await caches.open(OFFLINE_CACHE);
  await cache.put(INDEX_KEY, new Response(JSON.stringify({ format: 1, packs }), { headers: { "content-type": "application/json" } }));
  await cache.put(DATA, new Response('{"synthetic":true}', { headers: { "content-type": "application/json; charset=utf-8", "x-reference-license": "CC-BY-SA-3.0" } }));
  await cache.put(CLIP, new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "audio/mpeg", link: "<https://creativecommons.org/licenses/by-sa/3.0/>; rel=license" } }));
  for (const [path, response] of Object.entries(extra)) await cache.put(path, response);
}

describe("the worker's constants", () => {
  test("come from policy.ts through the /sw.js header, so the page and the worker cannot drift", async () => {
    const w = await load();
    const policy = vm.runInContext("POLICY", w.context);
    expect(JSON.parse(JSON.stringify(policy))).toEqual(JSON.parse(JSON.stringify(workerPolicy({ build: "abc1234", enabled: true, shellPages: SHELL_PAGES }))));
    expect(Object.isFrozen(policy)).toBe(true);
    expect(policy).toMatchObject({ origins: [ORIGIN, BEIT_MITZVAH_ORIGIN], offlineCache: OFFLINE_CACHE, indexKey: INDEX_KEY, header: OFFLINE_HEADER, windowMs: 14 * DAY_MS, skewMs: SKEW_MS, shellLimits: SHELL_LIMITS,
      staticPath: STATIC_PATH.source, clipPath: CLIP_PATH.source, packDataPath: PACK_DATA_PATH.source, shellCache: "crc-shell-abc1234" });
    expect(policy.shellPages).toEqual(expect.arrayContaining(["/read", "/offline", "/learn", "/learn/review", "/learn/about", "/learn/torah-sof-pasuk",
      // 1.6: Quick ten, one page per melody.
      "/learn/practice/quick-ten-torah", "/learn/practice/quick-ten-haftarah"]));
    expect((await workerSource({ build: "x;alert(1)", enabled: true })).includes("alert")).toBe(false);
  });
  test("register no push, notification, sync or message listeners", async () => {
    const w = await load();
    expect([...w.listeners.keys()].sort()).toEqual(["activate", "fetch", "install"]);
    const source = await workerSource({ build: "dev", enabled: true });
    for (const name of ["push", "notificationclick", "sync", "periodicsync", "message"]) expect(source.includes(`"${name}"`), name).toBe(false);
  });
});

describe("routing is the complete allowlist", () => {
  test("private API routes, sign-in, non-GET, Range, cross-origin and unknown paths pass through untouched", async () => {
    const w = await load({ fetch: async () => json({}) });
    await seed(w.caches, [pack(Date.now(), [DATA, CLIP])]);
    for (const path of ["/api/session", "/api/auth/sign-out", "/api/auth/sign-in/magic-link", "/api/students/s1/recordings", "/api/learn/progress", "/api/offline/packs", "/api/mcp",
      "/api/public/word-aids?date=2026-10-24&kind=torah&verse=0", "/api/public/commentary?work=rashi&chapter=Genesis+1", "/api/public/text", "/api/public/reference/finkel/clips",
      "/api/workspace/reference-review", "/reference-audio/generated/" + "a".repeat(64) + ".mp3", "/reference-audio/short-v1/" + "a".repeat(64) + ".mp3?x=1",
      "/reference-audio/voice/alto.mp3", "/workspace/student/recordings.json", "/sw.js", INDEX_KEY]) {
      expect(await w.request(path), path).toBeNull();
    }
    for (const path of ["/_next/static/..%2Fapi%2Fsession", "/_next/static/%2e%2e/api/session", "/_next/static/../api/session", "/fonts//x.woff2", "/_next/static/a%5Cb.js"]) expect(await w.request(path), path).toBeNull();
    expect(await w.request(DATA, { method: "POST", body: "{}" })).toBeNull();
    expect(await w.request(CLIP, { headers: { range: "bytes=0-1" } })).toBeNull();
    expect(await w.request(DATA, {}, "https://beitmitzvah.centralreform.org")).toBeNull();
    expect(w.network).not.toHaveBeenCalled();
  });
  test("navigations go to the network and are never stored; offline they fall back to the reader, a lesson or /offline", async () => {
    let online = true;
    const w = await load({ fetch: async request => { if (!online) throw new TypeError("offline"); return basic(new Response(`<p>${new URL(request.url).pathname}</p>`, { headers: { "content-type": "text/html" } })); } });
    await w.lifecycle("install");
    const shell = await w.caches.open("crc-shell-abc1234"), before = shell.entries.size;
    expect(await (await w.request("/workspace/student", { mode: "navigate" }))!.text()).toBe("<p>/workspace/student</p>");
    expect(shell.entries.size).toBe(before);
    online = false;
    expect(await (await w.request("/read?date=2026-10-31", { mode: "navigate" }))!.text()).toBe("<p>/read</p>");
    expect(await (await w.request("/learn/torah-sof-pasuk", { mode: "navigate" }))!.text()).toBe("<p>/learn/torah-sof-pasuk</p>");
    expect(await (await w.request("/learn/practice/quick-ten-torah", { mode: "navigate" }))!.text()).toBe("<p>/learn/practice/quick-ten-torah</p>");
    for (const path of ["/", "/workspace/student", "/account", "/learn/not-a-lesson", "/learn/practice/not-a-run"]) expect(await (await w.request(path, { mode: "navigate" }))!.text(), path).toBe("<p>/offline</p>");
  });
});

describe("packed assets are served only from a live pack", () => {
  test("public data is network-first, and from the pack with x-crc-offline only when the network fails", async () => {
    const w = await load({ fetch: async () => json({ fresh: true }) });
    await seed(w.caches, [pack(Date.now(), [DATA, CLIP])]);
    const online = await w.request(DATA);
    expect(await online!.json()).toEqual({ fresh: true }); expect(online!.headers.get(OFFLINE_HEADER)).toBeNull();
    const offline = await load({ caches: w.caches });
    const saved = await offline.request(DATA);
    expect(await saved!.json()).toEqual({ synthetic: true });
    expect(saved!.headers.get(OFFLINE_HEADER)).toBe("1"); expect(saved!.headers.get("content-type")).toBe("application/json; charset=utf-8");
  });
  test("a clip comes from the pack with its original type and attribution headers, or from the network when unpacked", async () => {
    const w = await load({ fetch: async () => basic(new Response(new Uint8Array([9]), { headers: { "content-type": "audio/mpeg" } })) });
    await seed(w.caches, [pack(Date.now(), [DATA, CLIP])]);
    const hit = await w.request(CLIP);
    expect(new Uint8Array(await hit!.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    expect(hit!.headers.get("content-type")).toBe("audio/mpeg"); expect(hit!.headers.get("link")).toContain("by-sa"); expect(hit!.headers.get(OFFLINE_HEADER)).toBe("1");
    expect(w.network).not.toHaveBeenCalled();
    const other = `/reference-audio/short-v1/${"b".repeat(64)}.mp3`;
    expect(new Uint8Array(await (await w.request(other))!.arrayBuffer())).toEqual(new Uint8Array([9]));
    expect((await w.caches.open(OFFLINE_CACHE)).entries.has(ORIGIN + other)).toBe(false);
  });
  test("an expired pack, a clock set back, an unlisted asset or a damaged index serve nothing", async () => {
    const now = Date.now();
    for (const [name, packs] of [["expired", [pack(now - 15 * DAY_MS, [DATA, CLIP])]], ["stored expiry past", [pack(now - DAY_MS, [DATA, CLIP], now - 1)]],
      ["clock rolled back", [pack(now + SKEW_MS + 60_000, [DATA, CLIP])]], ["unlisted", [pack(now, [])]], ["damaged", [{ ...pack(now, [DATA, CLIP]), owner: "someone" }]]] as const) {
      const w = await load(); await seed(w.caches, [...packs]);
      await expect(w.request(DATA), name).rejects.toThrow();
      await expect(w.request(CLIP), name).rejects.toThrow();
    }
    const skew = await load(); await seed(skew.caches, [pack(now + SKEW_MS - 60_000, [DATA])]);
    expect((await skew.request(DATA))!.headers.get(OFFLINE_HEADER)).toBe("1");
  });
  test("after a purge the worker serves nothing and never recreates the pack cache", async () => {
    const w = await load();
    await seed(w.caches, [pack(Date.now(), [DATA, CLIP])]);
    await w.caches.delete(OFFLINE_CACHE);
    await expect(w.request(CLIP)).rejects.toThrow();
    await expect(w.request(DATA)).rejects.toThrow();
    await w.lifecycle("activate");
    expect(await w.caches.has(OFFLINE_CACHE)).toBe(false);
  });
  test("G3: a generated, voice, Finkel or recording path is never served, even if it is in the cache and listed", async () => {
    const generated = ["/reference-audio/generated/" + "c".repeat(64) + ".mp3", "/api/public/reference/finkel/media/" + "c".repeat(64) + ".mp3", "/api/students/s1/recordings/r1", "/reference-audio/voice/v.mp3", "/api/public/chant?ref=Genesis+1%3A1"];
    const w = await load();
    await seed(w.caches, [pack(Date.now(), [DATA, CLIP, ...generated])], Object.fromEntries(generated.map(path => [path, new Response("generated", { headers: { "content-type": "audio/mpeg" } })])));
    for (const path of generated) expect(await w.request(path), path).toBeNull();
  });
});

describe("owner packs (A2) are served exactly like public ones, only under their own index owner", () => {
  const A = "A".repeat(43), B = "B".repeat(43), REF = "/api/public/text?ref=Genesis+1%3A1-5&kind=torah&offset=0";
  const ownPack = (owner: string) => ({ key: "ref:torah:0123456789abcdef", owner, label: "", descriptor: { type: "ref", kind: "torah", ref: "Genesis 1:1-5" }, assets: [REF, CLIP],
    bytes: 1, renewedAt: Date.now(), expiresAt: Date.now() + WINDOW_MS, format: 1 });
  async function index(caches: FakeCaches, value: unknown) {
    await seed(caches, [], { [REF]: json({ own: true }) });
    await (await caches.open(OFFLINE_CACHE)).put(INDEX_KEY, new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } }));
  }
  test("a person's own reading is served offline when its owner is the index's owner", async () => {
    const w = await load(); await index(w.caches, { format: 1, owner: A, packs: [ownPack(A), pack(Date.now(), [DATA])] });
    expect(await (await w.request(REF))!.json()).toEqual({ own: true });
    expect((await w.request(CLIP))!.headers.get(OFFLINE_HEADER)).toBe("1");
    expect((await w.request(DATA))!.headers.get(OFFLINE_HEADER)).toBe("1");
  });
  test("another owner's pack, or an owner pack with no index owner, makes the whole index unreadable: nothing is served", async () => {
    for (const value of [{ format: 1, owner: B, packs: [ownPack(A), pack(Date.now(), [DATA])] }, { format: 1, packs: [ownPack(A), pack(Date.now(), [DATA])] }, { format: 1, owner: "x", packs: [pack(Date.now(), [DATA])] }]) {
      const w = await load(); await index(w.caches, value);
      await expect(w.request(REF), JSON.stringify(value.owner)).rejects.toThrow();
      await expect(w.request(DATA), JSON.stringify(value.owner)).rejects.toThrow();
    }
  });
  test("the activate sweep keeps the index owner, so the page still reads the index", async () => {
    const caches = new FakeCaches(ORIGIN);
    await index(caches, { format: 1, owner: A, packs: [ownPack(A), pack(Date.now() - 20 * DAY_MS, [DATA])] });
    const w = await load({ caches });
    await w.lifecycle("activate");
    const stored = await (await (await caches.open(OFFLINE_CACHE)).match(INDEX_KEY))!.json();
    expect(stored.owner).toBe(A);
    expect(stored.packs.map((row: { key: string }) => row.key)).toEqual(["ref:torah:0123456789abcdef"]);
  });
});

describe("install, activate and the tombstone", () => {
  test("install keeps the static pages (no cookie), the manifest, and the build files and fonts they name", async () => {
    const requests: Request[] = [];
    const w = await load({ fetch: async request => {
      requests.push(request);
      const path = new URL(request.url).pathname;
      if (path === "/read") return basic(new Response('<script src="/_next/static/chunks/a.js?dpl=1&amp;x=2"></script><link rel="stylesheet" href="/_next/static/css/b.css"><script>self.list=["static/chunks/c.js"]</script>', { headers: { "content-type": "text/html" } }));
      if (path.endsWith(".css")) return basic(new Response("@font-face{src:url(/fonts/noto/x.woff2)}", { headers: { "content-type": "text/css" } }));
      return basic(new Response(path.startsWith("/api/") ? "{}" : "<p></p>", { headers: { "content-type": "text/html" } }));
    } });
    await w.lifecycle("install");
    const shell = await w.caches.open("crc-shell-abc1234");
    for (const path of ["/read", "/offline", "/learn", "/learn/torah-sof-pasuk", "/api/public/manifest", "/_next/static/chunks/a.js?dpl=1&x=2", "/_next/static/css/b.css", "/_next/static/chunks/c.js", "/fonts/noto/x.woff2"]) expect(shell.entries.has(ORIGIN + path), path).toBe(true);
    expect(requests.every(request => request.credentials === "omit")).toBe(true);
    expect([...shell.entries.keys()].some(key => key.includes("/api/") && !key.endsWith("/api/public/manifest"))).toBe(false);
  });
  test("install fails when the reader shell cannot be fetched, so no half-installed worker activates", async () => {
    const w = await load({ fetch: async request => new URL(request.url).pathname === "/read" ? basic(new Response("", { status: 503 })) : basic(new Response("<p></p>")) });
    await expect(w.lifecycle("install")).rejects.toThrow();
  });
  test("activate drops old shells and expired packs, keeps live ones and other caches, and claims", async () => {
    const caches = new FakeCaches(ORIGIN), now = Date.now();
    await caches.open("crc-shell-old"); await caches.open("someone-elses-cache");
    const livePack = { ...pack(now, [DATA]), key: "course", descriptor: { type: "course" } };
    await seed(caches, [pack(now - 20 * DAY_MS, [DATA, CLIP]), livePack]);
    const w = await load({ caches });
    await w.lifecycle("activate");
    expect(await caches.keys()).toEqual(expect.arrayContaining(["someone-elses-cache", OFFLINE_CACHE]));
    expect(await caches.has("crc-shell-old")).toBe(false);
    const cache = await caches.open(OFFLINE_CACHE);
    expect(cache.entries.has(ORIGIN + CLIP)).toBe(false); expect(cache.entries.has(ORIGIN + DATA)).toBe(true);
    expect((await (await cache.match(INDEX_KEY))!.json()).packs.map((row: { key: string }) => row.key)).toEqual(["course"]);
    expect(w.self.clients.claim).toHaveBeenCalled(); expect(w.self.skipWaiting).not.toHaveBeenCalled();
  });
  test("PORTAL_OFFLINE_ENABLED=false serves the tombstone: it deletes every crc- cache, unregisters, and handles no fetch", async () => {
    const caches = new FakeCaches(ORIGIN);
    for (const name of ["crc-shell-abc", OFFLINE_CACHE, "someone-elses-cache"]) await caches.open(name);
    const w = await load({ enabled: false, caches });
    expect(w.listeners.has("fetch")).toBe(false);
    await w.lifecycle("install"); expect(w.self.skipWaiting).toHaveBeenCalled();
    await w.lifecycle("activate");
    expect(await caches.keys()).toEqual(["someone-elses-cache"]);
    expect(w.self.registration.unregister).toHaveBeenCalled();
  });
  test("on any origin but torah, beitmitzvah or loopback the worker is the tombstone", async () => {
    for (const origin of ["https://bneimitzvah.vercel.app", "https://bneimitzvah.centralreform.org", "https://torah.centralreform.org.evil.test", "https://beitmitzvah.centralreform.org.evil.test", "http://beitmitzvah.centralreform.org"]) {
      const w = await load({ origin });
      expect(w.listeners.has("fetch"), origin).toBe(false);
      await w.lifecycle("activate"); expect(w.self.registration.unregister).toHaveBeenCalled();
    }
    expect((await load({ origin: "http://127.0.0.1:3187" })).listeners.has("fetch")).toBe(true);
    for (const origin of [ORIGIN, BEIT_MITZVAH_ORIGIN]) expect((await load({ origin })).listeners.has("fetch"), origin).toBe(true);
  });
  test("N24 review F1: after a cutover the alias's /sw.js is the tombstone, which deletes its packs and unregisters; the canonical one stays live", async () => {
    for (const [canonical, alias] of [[ORIGIN, BEIT_MITZVAH_ORIGIN], [BEIT_MITZVAH_ORIGIN, ORIGIN]]) {
      const caches = new FakeCaches(alias);
      for (const name of ["crc-shell-abc", OFFLINE_CACHE, "someone-elses-cache"]) await caches.open(name);
      const w = await load({ origin: alias, origins: [canonical], caches });
      expect(w.listeners.has("fetch"), alias).toBe(false);
      await w.lifecycle("install"); await w.lifecycle("activate");
      expect(await caches.keys()).toEqual(["someone-elses-cache"]);
      expect(w.self.registration.unregister).toHaveBeenCalled();
      expect((await load({ origin: canonical, origins: [canonical] })).listeners.has("fetch"), canonical).toBe(true);
    }
  });
});

describe("N24: the beitmitzvah origin (decision 14) works exactly like torah", () => {
  const A = "A".repeat(43), B = "B".repeat(43), REF = "/api/public/text?ref=Genesis+1%3A1-3&kind=torah&offset=0", READING = "/api/public/reading?ref=Genesis+1%3A1-3&kind=torah";
  const ownPack = (owner: string) => ({ key: "ref:torah:0123456789abcdef", owner, label: "", descriptor: { type: "ref", kind: "torah", ref: "Genesis 1:1-3" }, assets: [READING, REF, CLIP],
    bytes: 1, renewedAt: Date.now(), expiresAt: Date.now() + WINDOW_MS, format: 1 });
  async function installedOnBeit(owner: string) {
    const caches = new FakeCaches(BEIT_MITZVAH_ORIGIN);
    await seed(caches, [], { [REF]: json({ own: true }), [READING]: json({ reading: true }) });
    await (await caches.open(OFFLINE_CACHE)).put(INDEX_KEY, new Response(JSON.stringify({ format: 1, owner, packs: [ownPack(owner)] }), { headers: { "content-type": "application/json" } }));
    return load({ origin: BEIT_MITZVAH_ORIGIN, caches });
  }
  test("with the network cut, the learner's assigned reading opens from the owner pack; private routes are never answered", async () => {
    const w = await installedOnBeit(A);
    expect(w.listeners.has("fetch")).toBe(true);
    for (const path of [READING, REF]) {
      const hit = await w.request(path);
      expect(hit?.status, path).toBe(200); expect(hit!.headers.get(OFFLINE_HEADER), path).toBe("1");
    }
    expect((await w.request(CLIP))!.headers.get(OFFLINE_HEADER)).toBe("1");
    // The private endpoint that names the learner's readings, and every other signed-in route, are the browser's own business.
    for (const path of ["/api/offline/packs", "/api/session", "/api/students", "/api/learn/progress", "/api/portion-summary?reading=vayera"]) expect(await w.request(path), path).toBeNull();
  });
  test("with the network cut, This week's aliyot and approved portion summary open from the public pack", async () => {
    const ALIYOT = "/api/public/aliyot?date=2026-10-24", SUMMARY = "/api/public/portion-summary?reading=vayera";
    const caches = new FakeCaches(BEIT_MITZVAH_ORIGIN);
    await seed(caches, [pack(Date.now(), [DATA, ALIYOT, SUMMARY])], { [ALIYOT]: json({ aliyot: true }), [SUMMARY]: json({ reading: "vayera", summary: null }) });
    const w = await load({ origin: BEIT_MITZVAH_ORIGIN, caches });
    for (const path of [ALIYOT, SUMMARY]) { const hit = await w.request(path); expect(hit?.status, path).toBe(200); expect(hit!.headers.get(OFFLINE_HEADER), path).toBe("1"); }
  });
  test("after the sign-out purge, or with another account's index, nothing of the learner's is served", async () => {
    const w = await installedOnBeit(A);
    await w.caches.delete(OFFLINE_CACHE);
    await expect(w.request(REF)).rejects.toThrow();
    expect(await w.caches.has(OFFLINE_CACHE)).toBe(false);
    const other = await installedOnBeit(A);
    await (await other.caches.open(OFFLINE_CACHE)).put(INDEX_KEY, new Response(JSON.stringify({ format: 1, owner: B, packs: [ownPack(A)] }), { headers: { "content-type": "application/json" } }));
    await expect(other.request(REF)).rejects.toThrow();
  });
});
