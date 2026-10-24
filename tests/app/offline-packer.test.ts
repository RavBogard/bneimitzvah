import { describe, expect, test, vi } from "vitest";
import { unavailableExtras } from "../helpers/translations";
vi.mock("server-only", () => ({}));
import { createPublicReadingService } from "../../src/server/public-reading/service";
import type { PublicRuntime } from "../../src/server/http/public-reading";
import { createHttpDispatcher } from "../../src/server/http/dispatch";
import { createShortSourceManifestLoader } from "../../src/server/reference-audio/short-source-manifest";
import { parseReferenceCatalog } from "../../src/server/reference-audio/catalog";
import { createSefariaStudyReader } from "../../src/server/study/sefaria";
import { createSefariaCommentaryReader } from "../../src/server/study/commentary";
import { TANAKH_VERSE_COUNTS } from "../../src/lib/readings/catalog";
import { parseCeremonyDate } from "../../src/lib/readings/ranges";
import { thisShabbat } from "../../src/lib/readings/public-shabbat";
import { syntheticResponse } from "../helpers/study";
import { syntheticCommentaryFetch } from "../helpers/commentary";
import { publicShortFixture, byteStream } from "./reference-public-short-fixture";
import { openOffline, PackStopped, renewPack, type PackerIo } from "../../src/lib/offline/packer";
import { readIndex, sweep } from "../../src/lib/offline/pack-index";
import { INDEX_KEY, OFFLINE_CACHE, OFFLINE_HEADER, packAssetAllowed, WINDOW_MS, type Pack } from "../../src/lib/offline/policy";
import { publicReadingPath, publicShortPath, publicTextPath } from "../../src/components/portal/public-reading/urls";
import { coursePassages } from "../../src/components/learn/verses-api";
import { lookAlikeRefs, MELODIES } from "../../src/lib/learn/course";

// The packer against the real public routes, with a synthetic calendar, synthetic text and one synthetic clip.
const origin = "https://torah.centralreform.org", date = thisShabbat();
class FakeCache {
  entries = new Map<string, Response>();
  async match(input: RequestInfo) { const hit = this.entries.get(new URL(typeof input === "string" ? input : input.url, origin).href); return hit?.clone(); }
  async put(input: RequestInfo, response: Response) { this.entries.set(new URL(typeof input === "string" ? input : input.url, origin).href, response.clone()); }
  async delete(input: RequestInfo) { return this.entries.delete(new URL(typeof input === "string" ? input : input.url, origin).href); }
  async keys() { return [...this.entries.keys()].map(url => new Request(url)); }
}
class FakeCaches { stores = new Map<string, FakeCache>(); async open(name: string) { if (!this.stores.has(name)) this.stores.set(name, new FakeCache()); return this.stores.get(name)!; } async has(name: string) { return this.stores.has(name); } async delete(name: string) { return this.stores.delete(name); } async keys() { return [...this.stores.keys()]; } }

async function harness(options: { pocketTorah?: boolean } = {}) {
  const calendar = async (value: string, cal: "diaspora" | "israel") => ({ fetchedAt: Date.now(), snapshot: { date: parseCeremonyDate(value), calendar: cal, classification: "regular" as const,
    reading: { parashah: "Synthetic portion", type: "shabbat", summary: "", source: "Hebcal", aliyot: [{ n: 1 as const, ref: "Genesis 1:1-2:3" }], triennial: null }, haftarah: "Isaiah 1:1-3" } });
  const upstream = vi.fn<typeof globalThis.fetch>(async url => syntheticResponse(decodeURIComponent(new URL(url instanceof Request ? url.url : url).pathname.split("/").at(-1)!)));
  const source = publicShortFixture(), catalog = parseReferenceCatalog(JSON.parse(new TextDecoder().decode(source.parent)))!;
  const short = await createShortSourceManifestLoader({ sha256: source.manifestSHA256, parentCatalogSHA256: source.parentCatalogSHA256, parentCatalogBytes: source.parent, get: async () => byteStream(source.manifest) })();
  const service = createPublicReadingService({ loadReading: calendar, loadText: createSefariaStudyReader({ fetch: upstream, verseCounts: TANAKH_VERSE_COUNTS }),
    stepSource: { book: async () => Object.freeze([]), lexicon: async () => Object.freeze([]) }, pocketTorah: options.pocketTorah === false ? null : { loadCatalog: async () => catalog, loadManifest: async () => short } });
  const runtime: PublicRuntime = { resolveTenant: async () => undefined, reading: service, commentary: createSefariaCommentaryReader({ fetch: syntheticCommentaryFetch() as typeof globalThis.fetch }), ...unavailableExtras };
  const dispatch = createHttpDispatcher(async () => { throw new Error("The session runtime must not be reached"); }, async action => action(runtime));
  const requests: { url: string; init: RequestInit }[] = [];
  let clipBody: Uint8Array = source.body, status: ((url: string) => number | null) = () => null, marked = false;
  const fetch = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input); requests.push({ url, init });
    const forced = status(url);
    if (forced) return new Response(null, { status: forced });
    let response: Response;
    if (new URL(url).pathname === source.source.path) response = new Response(clipBody.slice(), { headers: { "content-type": "audio/mpeg", "x-reference-license": "CC-BY-SA-3.0" } });
    else response = await dispatch(new Request(url.replace(origin, source.origin)));
    if (marked) { const headers = new Headers(response.headers); headers.set(OFFLINE_HEADER, "1"); response = new Response(response.body, { status: response.status, headers }); }
    Object.defineProperty(response, "url", { value: url });
    return response;
  }) as unknown as typeof globalThis.fetch;
  const caches = new FakeCaches();
  let now = Date.parse("2026-10-21T15:00:00Z"), quota = 10 ** 9;
  const io: PackerIo = { origin, fetch, caches: caches as unknown as CacheStorage, now: () => now, estimate: async () => ({ usage: 0, quota }) };
  return { io, caches, requests, fetch, source, setNow: (value: number) => { now = value; }, setQuota: (value: number) => { quota = value; },
    setClip: (value: Uint8Array) => { clipBody = value; }, setStatus: (value: (url: string) => number | null) => { status = value; }, setMarked: (value: boolean) => { marked = value; } };
}
const offline = async (h: Awaited<ReturnType<typeof harness>>) => (await h.caches.open(OFFLINE_CACHE)) as unknown as FakeCache;
const packs = async (h: Awaited<ReturnType<typeof harness>>) => (await readIndex((await h.caches.open(OFFLINE_CACHE)) as unknown as Cache)).packs;
const signal = () => new AbortController().signal;

describe("This week", () => {
  test("packs exactly the reader's requests and Learn's by-ref requests, byte for byte the URLs api.ts and verses-api.ts make, plus the clip", async () => {
    const h = await harness();
    expect(await renewPack(h.io, { type: "week", date }, signal())).toBe("saved");
    const [pack] = await packs(h), week = { by: "date" as const, date };
    const torah = { by: "ref" as const, ref: "Genesis 1:1-2:3", kind: "torah" as const }, haftarah = { by: "ref" as const, ref: "Isaiah 1:1-3", kind: "haftarah" as const };
    expect(pack).toMatchObject({ key: `week:${date}`, owner: "public", label: "Synthetic portion", descriptor: { type: "week", date }, format: 1, renewedAt: Date.parse("2026-10-21T15:00:00Z") });
    expect(pack.expiresAt - pack.renewedAt).toBe(WINDOW_MS);
    expect([...pack.assets].sort()).toEqual([publicReadingPath(week), publicTextPath(week, "torah", 0), publicShortPath(week, "torah", 0), publicTextPath(torah, "torah", 0), publicShortPath(torah, "torah", 0),
      publicTextPath(week, "haftarah", 0), publicShortPath(week, "haftarah", 0), publicTextPath(haftarah, "haftarah", 0), publicShortPath(haftarah, "haftarah", 0), h.source.source.path]
      .map(path => new URL(path, origin)).map(url => url.pathname + url.search).sort());
    expect(pack.assets.every(packAssetAllowed)).toBe(true);
    const cache = await offline(h);
    for (const asset of pack.assets) expect(cache.entries.has(origin + asset), asset).toBe(true);
    // The original network response, attribution headers and all.
    expect((await cache.match(origin + h.source.source.path))!.headers.get("x-reference-license")).toBe("CC-BY-SA-3.0");
    // No cookie, no referrer, three at a time at most; nothing private was asked for.
    expect(h.requests.every(row => row.init.credentials === "omit" && row.init.referrerPolicy === "no-referrer")).toBe(true);
    expect(h.requests.some(row => !/\/api\/public\/|\/reference-audio\/short-v1\//.test(row.url))).toBe(false);
  });
  test("without recordings, no short pages and no clips", async () => {
    const h = await harness({ pocketTorah: false });
    await renewPack(h.io, { type: "week", date }, signal());
    expect((await packs(h))[0].assets.some(asset => asset.includes("reference"))).toBe(false);
  });
  test("a clip whose SHA-256 does not match is not stored, and the pack is not renewed", async () => {
    const h = await harness(), wrong = h.source.body.slice(); wrong[wrong.length - 1] ^= 1; h.setClip(wrong);
    await expect(renewPack(h.io, { type: "week", date }, signal())).rejects.toEqual(new PackStopped("failed"));
    expect((await offline(h)).entries.has(origin + h.source.source.path)).toBe(false);
    expect(await packs(h)).toEqual([]);
  });
  test("over budget: nothing is stored and the state is no-space", async () => {
    const h = await harness(); h.setQuota(1000);
    await expect(renewPack(h.io, { type: "week", date }, signal())).rejects.toEqual(new PackStopped("no-space"));
    expect([...(await offline(h)).entries.keys()]).toEqual([]);
  });
  test("renewal is idempotent: present clips are not fetched again, a missing one is filled back in", async () => {
    const h = await harness();
    await renewPack(h.io, { type: "week", date }, signal());
    const clipFetches = () => h.requests.filter(row => row.url.endsWith(".mp3")).length;
    expect(clipFetches()).toBe(1);
    await renewPack(h.io, { type: "week", date }, signal());
    expect(clipFetches()).toBe(1);
    await (await offline(h)).delete(origin + h.source.source.path);
    await renewPack(h.io, { type: "week", date }, signal());
    expect(clipFetches()).toBe(2); expect((await offline(h)).entries.has(origin + h.source.source.path)).toBe(true);
  });
  test("renewedAt moves only when every step worked; a 429 stops; the worker's own saved answer is no renewal", async () => {
    const h = await harness(), first = Date.parse("2026-10-21T15:00:00Z");
    await renewPack(h.io, { type: "week", date }, signal());
    h.setNow(first + 3 * 86_400_000);
    h.setStatus(url => url.includes("kind=haftarah") && url.includes("/text") ? 503 : null);
    await expect(renewPack(h.io, { type: "week", date }, signal())).rejects.toEqual(new PackStopped("failed"));
    expect((await packs(h))[0].renewedAt).toBe(first);
    h.setStatus(url => url.includes("/reference/short") ? 429 : null);
    await expect(renewPack(h.io, { type: "week", date }, signal())).rejects.toEqual(new PackStopped("rate-limited"));
    h.setStatus(() => null); h.setMarked(true);
    await expect(renewPack(h.io, { type: "week", date }, signal())).rejects.toEqual(new PackStopped("failed"));
    expect((await packs(h))[0].renewedAt).toBe(first);
    h.setMarked(false);
    await renewPack(h.io, { type: "week", date }, signal());
    expect((await packs(h))[0].renewedAt).toBe(first + 3 * 86_400_000);
  });
  test("an open within 12 hours of a complete renewal asks the public routes nothing (their firewall limit); after that it renews", async () => {
    const h = await harness(), first = Date.parse("2026-10-21T15:00:00Z");
    await openOffline({ ...h.io, origin });
    const count = h.requests.length;
    expect((await packs(h)).map(row => row.key).sort()).toEqual(["course", `week:${thisShabbat(first)}`].sort());
    h.setNow(first + 11 * 3_600_000);
    await openOffline(h.io);
    expect(h.requests.length).toBe(count);
    h.setNow(first + 13 * 3_600_000);
    await openOffline(h.io);
    expect(h.requests.length).toBeGreaterThan(count);
    expect((await packs(h)).every(row => row.renewedAt === first + 13 * 3_600_000)).toBe(true);
  });
  test("the sweep drops expired packs, last week's pack and every asset no live pack lists", async () => {
    const h = await harness(), now = Date.parse("2026-10-21T15:00:00Z");
    await renewPack(h.io, { type: "week", date }, signal());
    const cache = (await h.caches.open(OFFLINE_CACHE)) as unknown as Cache;
    await cache.put(origin + "/api/public/text?date=2026-01-03&kind=torah&offset=0", new Response("{}"));
    let index = await sweep(cache, now);
    expect(index.packs).toHaveLength(1);
    expect((cache as unknown as FakeCache).entries.has(origin + "/api/public/text?date=2026-01-03&kind=torah&offset=0")).toBe(false);
    index = await sweep(cache, now, pack => pack.key === "week:2000-01-01");
    expect(index.packs).toEqual([]);
    expect([...(cache as unknown as FakeCache).entries.keys()]).toEqual([origin + INDEX_KEY]);
    await renewPack(h.io, { type: "week", date }, signal());
    expect((await sweep(cache, now + WINDOW_MS)).packs).toEqual([]);
  });
});

describe("the Learn to lein course pack (F3)", () => {
  test("holds every fixed course passage's text and short pages by ref, the same requests every lesson page makes", async () => {
    const h = await harness();
    expect(await renewPack(h.io, { type: "course" }, signal())).toBe("saved");
    const pack = (await packs(h)).find(row => row.key === "course") as Pack;
    expect(pack).toMatchObject({ owner: "public", descriptor: { type: "course" } });
    for (const kind of MELODIES) for (const ref of coursePassages(kind)) {
      const url = new URL(publicTextPath({ by: "ref", ref, kind }, kind, 0), origin);
      expect(pack.assets, ref).toContain(url.pathname + url.search);
    }
    // 1.6: the look-alike verses travel in those same fixed passages, so the pack holds their text and clips too.
    for (const kind of MELODIES) { const members = coursePassages(kind).flatMap(ref => ref.split("; ")); for (const ref of lookAlikeRefs(kind)) expect(members, ref).toContain(ref); }
    // The ref route is asked for the paging only; the course never requests it, so it is not stored.
    expect(pack.assets.some(asset => asset.startsWith("/api/public/reading"))).toBe(false);
    expect(pack.assets.every(packAssetAllowed)).toBe(true);
  });
});

test("only PocketTorah short-v1 clips and the three public data routes can ever be pack assets (G3)", () => {
  for (const asset of ["/reference-audio/short-v1/" + "a".repeat(64) + ".mp3", "/api/public/reading?date=2026-10-24", "/api/public/text?ref=Genesis+1%3A1&kind=torah&offset=0", "/api/public/reference/short?date=2026-10-24&kind=torah&offset=0"])
    expect(packAssetAllowed(asset), asset).toBe(true);
  for (const asset of ["/reference-audio/generated/" + "a".repeat(64) + ".mp3", "/reference-audio/short-v1/" + "A".repeat(64) + ".mp3", "/reference-audio/short-v1/" + "a".repeat(64) + ".mp3?x=1",
    "/reference-audio/voice/alto.mp3", "/api/public/reference/finkel/media/" + "a".repeat(64) + ".mp3", "/api/public/word-aids?date=2026-10-24&kind=torah&verse=0", "/api/public/commentary?work=rashi&chapter=Genesis+1",
    "/api/students/s1/recordings", "/api/session", "/api/learn/progress", "/api/public/reading", "//evil.test/api/public/reading?date=1", "https://evil.test/x", "/api/public/text?x=1#y"])
    expect(packAssetAllowed(asset), asset).toBe(false);
});
