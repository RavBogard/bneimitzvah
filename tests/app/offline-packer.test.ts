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
import { askOwner, coursePackCurrent, openOffline, ownerPackKey, PackStopped, parseOwnerAnswer, renewPack, type PackerIo } from "../../src/lib/offline/packer";
import { purgeOffline, readIndex, sweep, writeIndex } from "../../src/lib/offline/pack-index";
import { BEIT_MITZVAH_ORIGIN, EMPTY_INDEX, INDEX_KEY, OFFLINE_CACHE, OFFLINE_HEADER, packAssetAllowed, parsePackIndex, SERVICE_PACK_KEY, WINDOW_MS, type Pack } from "../../src/lib/offline/policy";
import { publicReadingPath, publicShortPath, publicTextPath } from "../../src/components/portal/public-reading/urls";
import { publicAliyotPath } from "../../src/components/portal/print/api";
import { portionSummaryPath } from "../../src/lib/portion-summary/reading";
import { coursePassages } from "../../src/components/learn/verses-api";
import { lookAlikeRefs, MELODIES } from "../../src/lib/learn/course";

// The packer reads its own clock (io.now), so the week under test is derived from the same fixed instant, never the wall clock.
// The packer against the real public routes, with a synthetic calendar, synthetic text and one synthetic clip.
const origin = "https://torah.centralreform.org", NOW = Date.parse("2026-10-21T15:00:00Z"), date = thisShabbat(NOW);
class FakeCache {
  entries = new Map<string, Response>();
  async match(input: RequestInfo) { const hit = this.entries.get(new URL(typeof input === "string" ? input : input.url, origin).href); return hit?.clone(); }
  async put(input: RequestInfo, response: Response) { this.entries.set(new URL(typeof input === "string" ? input : input.url, origin).href, response.clone()); }
  async delete(input: RequestInfo) { return this.entries.delete(new URL(typeof input === "string" ? input : input.url, origin).href); }
  async keys() { return [...this.entries.keys()].map(url => new Request(url)); }
}
class FakeCaches { stores = new Map<string, FakeCache>(); async open(name: string) { if (!this.stores.has(name)) this.stores.set(name, new FakeCache()); return this.stores.get(name)!; } async has(name: string) { return this.stores.has(name); } async delete(name: string) { return this.stores.delete(name); } async keys() { return [...this.stores.keys()]; } }

async function harness(options: { pocketTorah?: boolean; origin?: string; parashah?: string; portionSummary?: PublicRuntime["portionSummary"] } = {}) {
  const base = options.origin ?? origin;
  const calendar = async (value: string, cal: "diaspora" | "israel") => ({ fetchedAt: Date.now(), snapshot: { date: parseCeremonyDate(value), calendar: cal, classification: "regular" as const,
    reading: { parashah: options.parashah ?? "Synthetic portion", type: "shabbat", summary: "", source: "Hebcal", aliyot: [{ n: 1 as const, ref: "Genesis 1:1-2:3" }], triennial: null }, haftarah: "Isaiah 1:1-3" } });
  const upstream = vi.fn<typeof globalThis.fetch>(async url => syntheticResponse(decodeURIComponent(new URL(url instanceof Request ? url.url : url).pathname.split("/").at(-1)!)));
  const source = publicShortFixture(), catalog = parseReferenceCatalog(JSON.parse(new TextDecoder().decode(source.parent)))!;
  const short = await createShortSourceManifestLoader({ sha256: source.manifestSHA256, parentCatalogSHA256: source.parentCatalogSHA256, parentCatalogBytes: source.parent, get: async () => byteStream(source.manifest) })();
  const service = createPublicReadingService({ loadReading: calendar, loadText: createSefariaStudyReader({ fetch: upstream, verseCounts: TANAKH_VERSE_COUNTS }),
    stepSource: { book: async () => Object.freeze([]), lexicon: async () => Object.freeze([]) }, pocketTorah: options.pocketTorah === false ? null : { loadCatalog: async () => catalog, loadManifest: async () => short } });
  // 2.0 SC6: the service course's public text answers too (synthetic letters), so every public pack of an open is made.
  const runtime: PublicRuntime = { resolveTenant: async () => undefined, reading: service, commentary: createSefariaCommentaryReader({ fetch: syntheticCommentaryFetch() as typeof globalThis.fetch }), ...unavailableExtras,
    serviceText: async unit => ({ unit, volume: "shabbat-shacharit", credit: { title: "Synthetic volume", licence: "CC BY-NC-SA 4.0" }, lines: [{ he: String.fromCharCode(0x05d0, 0x05d1, 0x05d2) }] }),
    ...(options.portionSummary ? { portionSummary: options.portionSummary } : {}) };
  const dispatch = createHttpDispatcher(async () => { throw new Error("The session runtime must not be reached"); }, async action => action(runtime));
  const requests: { url: string; init: RequestInit }[] = [];
  let clipBody: Uint8Array = source.body, status: ((url: string) => number | null) = () => null, marked = false;
  const fetch = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input); requests.push({ url, init });
    const forced = status(url);
    if (forced) return new Response(null, { status: forced });
    let response: Response;
    if (new URL(url).pathname === source.source.path) response = new Response(clipBody.slice(), { headers: { "content-type": "audio/mpeg", "x-reference-license": "CC-BY-SA-3.0" } });
    else response = await dispatch(new Request(url.replace(base, source.origin)));
    if (marked) { const headers = new Headers(response.headers); headers.set(OFFLINE_HEADER, "1"); response = new Response(response.body, { status: response.status, headers }); }
    Object.defineProperty(response, "url", { value: url });
    return response;
  }) as unknown as typeof globalThis.fetch;
  const caches = new FakeCaches();
  let now = NOW, quota = 10 ** 9;
  const io: PackerIo = { origin: base, fetch, caches: caches as unknown as CacheStorage, now: () => now, estimate: async () => ({ usage: 0, quota }) };
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
    expect(pack).toMatchObject({ key: `week:${date}`, owner: "public", label: "Synthetic portion", descriptor: { type: "week", date }, format: 1, renewedAt: NOW });
    expect(pack.expiresAt - pack.renewedAt).toBe(WINDOW_MS);
    expect([...pack.assets].sort()).toEqual([publicReadingPath(week), publicTextPath(week, "torah", 0), publicShortPath(week, "torah", 0), publicTextPath(torah, "torah", 0), publicShortPath(torah, "torah", 0),
      publicTextPath(week, "haftarah", 0), publicShortPath(week, "haftarah", 0), publicTextPath(haftarah, "haftarah", 0), publicShortPath(haftarah, "haftarah", 0), h.source.source.path, publicAliyotPath(date)]
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
    const h = await harness(), first = NOW;
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
    const h = await harness(), first = NOW;
    await openOffline({ ...h.io, origin });
    const count = h.requests.length;
    expect((await packs(h)).map(row => row.key).sort()).toEqual(["course", SERVICE_PACK_KEY, `week:${thisShabbat(first)}`].sort());
    h.setNow(first + 11 * 3_600_000);
    await openOffline(h.io);
    expect(h.requests.length).toBe(count);
    h.setNow(first + 13 * 3_600_000);
    await openOffline(h.io);
    expect(h.requests.length).toBeGreaterThan(count);
    expect((await packs(h)).every(row => row.renewedAt === first + 13 * 3_600_000)).toBe(true);
  });
  test("the sweep drops expired packs, last week's pack and every asset no live pack lists", async () => {
    const h = await harness(), now = NOW;
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

test("a course pack from an older set of fixed passages is not current, so the next open renews it at once (1.6 moved them)", async () => {
  const h = await harness();
  expect(await renewPack(h.io, { type: "course" }, signal())).toBe("saved");
  const pack = (await packs(h)).find(row => row.key === "course") as Pack;
  expect(coursePackCurrent(pack, origin)).toBe(true);
  // The pack a 1.5 build saved: its passages had no look-alike verses, so one passage key is missing.
  const first = new URL(publicTextPath({ by: "ref", ref: coursePassages("haftarah")[0], kind: "haftarah" }, "haftarah", 0), origin);
  expect(coursePackCurrent({ assets: pack.assets.filter(asset => asset !== first.pathname + first.search) }, origin)).toBe(false);
});

test("only PocketTorah short-v1 clips and the named public data routes can ever be pack assets (G3)", () => {
  for (const asset of ["/reference-audio/short-v1/" + "a".repeat(64) + ".mp3", "/api/public/reading?date=2026-10-24", "/api/public/text?ref=Genesis+1%3A1&kind=torah&offset=0", "/api/public/reference/short?date=2026-10-24&kind=torah&offset=0",
    "/api/public/aliyot?date=2026-10-24", "/api/public/portion-summary?reading=vayera", "/api/public/portion-summary?reading=lech-lecha"])
    expect(packAssetAllowed(asset), asset).toBe(true);
  for (const asset of ["/reference-audio/generated/" + "a".repeat(64) + ".mp3", "/reference-audio/short-v1/" + "A".repeat(64) + ".mp3", "/reference-audio/short-v1/" + "a".repeat(64) + ".mp3?x=1",
    "/reference-audio/voice/alto.mp3", "/api/public/reference/finkel/media/" + "a".repeat(64) + ".mp3", "/api/public/word-aids?date=2026-10-24&kind=torah&verse=0", "/api/public/commentary?work=rashi&chapter=Genesis+1",
    "/api/students/s1/recordings", "/api/session", "/api/learn/progress", "/api/public/reading", "/api/public/aliyot", "/api/public/portion-summary",
    "/api/admin/portion-summary?reading=vayera", "/api/portion-summary?reading=vayera", "/api/public/portion-summary/draft?reading=vayera", "/api/public/discussions?reading=vayera",
    // Exactly one known parameter: no extra one (a draft or revision selector), no repeat, no other spelling.
    "/api/public/portion-summary?reading=vayera&status=draft", "/api/public/portion-summary?reading=vayera&revision=1", "/api/public/portion-summary?reading=vayera&reading=noach",
    "/api/public/portion-summary?status=draft&reading=vayera", "/api/public/portion-summary?reading=Vayera", "/api/public/portion-summary?reading=vayera%26status%3Ddraft", "/api/public/portion-summary?reading=",
    "/api/public/portion-summary?reading=-vayera", "/api/public/portion-summary?ref=Genesis+18%3A1", "/api/public/aliyot?date=2026-10-24&date=2026-10-31", "/api/public/aliyot?date=2026-10-24&x=1",
    "/api/public/aliyot?date=2026-10-24T00", "/api/public/aliyot?ref=Genesis+1%3A1", "//evil.test/api/public/reading?date=1", "https://evil.test/x", "/api/public/text?x=1#y"])
    expect(packAssetAllowed(asset), asset).toBe(false);
});

describe("owner packs (A2): the person's own readings, and the purge on an account switch or a sign-out", () => {
  const A = "A".repeat(43), B = "B".repeat(43);
  const own = (owner: string, list: { kind: "torah" | "haftarah"; ref: string; name: string | null }[]) => async () => ({ state: "owner" as const, owner, packs: list });
  const reading = { kind: "haftarah" as const, ref: "Isaiah 1:1-3", name: null };
  const keys = async (h: Awaited<ReturnType<typeof harness>>) => (await packs(h)).map(row => row.key).sort();
  const index = async (h: Awaited<ReturnType<typeof harness>>) => readIndex((await offline(h)) as unknown as Cache);

  test("packs a ref the way /read?ref= asks for it, from the public routes with no cookie, under its owner", async () => {
    const h = await harness();
    // The index has no owner, so the pack is not kept: an owner pack joins only its own owner's index.
    await expect(renewPack(h.io, { type: "ref", kind: "torah", ref: "Genesis 1:1-2:3" }, signal(), { owner: A, label: "" })).rejects.toEqual(new PackStopped("purged"));
    expect(await packs(h)).toEqual([]);
    await writeIndex((await offline(h)) as unknown as Cache, { format: 1, owner: A, packs: [] });
    expect(await renewPack(h.io, { type: "ref", kind: "torah", ref: "Genesis 1:1-2:3" }, signal(), { owner: A, label: "" })).toBe("saved");
    const [pack] = await packs(h), selector = { by: "ref" as const, ref: "Genesis 1:1-2:3", kind: "torah" as const };
    expect(pack).toMatchObject({ key: ownerPackKey("torah", "Genesis 1:1-2:3"), owner: A, label: "", descriptor: { type: "ref", kind: "torah", ref: "Genesis 1:1-2:3" } });
    expect([...pack.assets].sort()).toEqual([publicReadingPath(selector), publicTextPath(selector, "torah", 0), publicShortPath(selector, "torah", 0), h.source.source.path]
      .map(path => new URL(path, origin)).map(url => url.pathname + url.search).sort());
    expect(h.requests.every(row => row.init.credentials === "omit" && /\/api\/public\/|\/reference-audio\/short-v1\//.test(row.url))).toBe(true);
    // An owner pack needs its owner, and a public pack must not name one.
    await expect(renewPack(h.io, { type: "ref", kind: "torah", ref: "Genesis 1:1-2:3" }, signal())).rejects.toEqual(new PackStopped("failed"));
    await expect(renewPack(h.io, { type: "week", date }, signal(), { owner: A, label: "" })).rejects.toEqual(new PackStopped("failed"));
    await expect(renewPack(h.io, { type: "ref", kind: "torah", ref: "Genesis 1:1-2:3" }, signal(), { owner: "not-a-key", label: "" })).rejects.toEqual(new PackStopped("failed"));
    await expect(renewPack(h.io, { type: "ref", kind: "torah", ref: "Genesis 2:3-1:1" }, signal(), { owner: A, label: "" })).rejects.toEqual(new PackStopped("failed"));
  });

  test("an open asks whose readings these are, then packs This week, the person's own readings and the course", async () => {
    const h = await harness();
    await openOffline({ ...h.io, owner: own(A, [reading, { kind: "torah", ref: "Genesis 1:1-5", name: "Mine" }]) });
    expect(await keys(h)).toEqual(["course", SERVICE_PACK_KEY, ownerPackKey("haftarah", "Isaiah 1:1-3"), ownerPackKey("torah", "Genesis 1:1-5"), `week:${date}`].sort());
    const stored = await index(h);
    expect(stored.owner).toBe(A);
    expect(stored.packs.find(row => row.key === ownerPackKey("torah", "Genesis 1:1-5"))).toMatchObject({ owner: A, label: "Mine" });
    expect(stored.packs.filter(row => row.descriptor.type !== "ref").every(row => row.owner === "public")).toBe(true);
  });

  test("another account on this device: every pack goes, the public ones too, before the new owner's are packed", async () => {
    const h = await harness();
    await openOffline({ ...h.io, owner: own(A, [reading]) });
    const clips = () => h.requests.filter(row => row.url.endsWith(".mp3")).length, first = clips();
    await openOffline({ ...h.io, owner: own(B, [{ kind: "torah", ref: "Genesis 1:1-5", name: null }]) });
    const stored = await index(h);
    expect(stored.owner).toBe(B);
    expect(stored.packs.some(row => row.owner === A)).toBe(false);
    expect(await keys(h)).toEqual(["course", SERVICE_PACK_KEY, ownerPackKey("torah", "Genesis 1:1-5"), `week:${date}`].sort());
    // The public packs were deleted and fetched again: the clip came over the network a second time.
    expect(clips()).toBeGreaterThan(first);
  });

  test("signed out (401 or 403): the owner packs go and the public ones stay; an unknown answer changes nothing", async () => {
    const h = await harness();
    await openOffline({ ...h.io, owner: own(A, [reading]) });
    const count = h.requests.length;
    await openOffline({ ...h.io, owner: async () => ({ state: "unknown" as const }) });
    expect(await keys(h)).toContain(ownerPackKey("haftarah", "Isaiah 1:1-3"));
    expect((await index(h)).owner).toBe(A);
    await openOffline({ ...h.io, owner: async () => { throw new Error("Synthetic network failure"); } });
    expect(await keys(h)).toContain(ownerPackKey("haftarah", "Isaiah 1:1-3"));
    await openOffline({ ...h.io, owner: async () => ({ state: "signed-out" as const }) });
    expect(await keys(h)).toEqual(["course", SERVICE_PACK_KEY, `week:${date}`].sort());
    expect((await index(h)).owner).toBeNull();
    // The public packs were kept, not fetched again (they are inside their 12 hours).
    expect(h.requests.length).toBe(count);
    // A later sign-in as anyone packs their readings without a purge: nothing private was left.
    await openOffline({ ...h.io, owner: own(B, [reading]) });
    expect(await keys(h)).toContain(ownerPackKey("haftarah", "Isaiah 1:1-3"));
    expect((await packs(h)).find(row => row.descriptor.type === "ref")?.owner).toBe(B);
  });

  test("a reading the endpoint no longer names is dropped at the next open; a renamed one is renewed", async () => {
    const h = await harness();
    await openOffline({ ...h.io, owner: own(A, [reading, { kind: "torah", ref: "Genesis 1:1-5", name: "Old" }]) });
    await openOffline({ ...h.io, owner: own(A, [{ kind: "torah", ref: "Genesis 1:1-5", name: "New" }]) });
    expect(await keys(h)).toEqual(["course", SERVICE_PACK_KEY, ownerPackKey("torah", "Genesis 1:1-5"), `week:${date}`].sort());
    expect((await packs(h)).find(row => row.descriptor.type === "ref")?.label).toBe("New");
  });

  test("the endpoint's answer is read strictly, and asked with the cookie, never stored", async () => {
    const ok = { owner: A, packs: [{ kind: "torah", ref: "Genesis 1:1-5", name: null }] };
    expect(parseOwnerAnswer(200, ok)).toEqual({ state: "owner", ...ok });
    expect(parseOwnerAnswer(403, null)).toEqual({ state: "signed-out" });
    for (const status of [404, 409, 429, 500, 503]) expect(parseOwnerAnswer(status, ok)).toEqual({ state: "unknown" });
    const bell = String.fromCharCode(7);
    for (const body of [null, [], { ...ok, extra: 1 }, { owner: "short", packs: [] }, { owner: A, packs: Array.from({ length: 9 }, () => ok.packs[0]) },
      { owner: A, packs: [{ kind: "torah", ref: "Genesis 1:5-1", name: null }] }, { owner: A, packs: [{ kind: "torah", ref: "genesis 1:1-5", name: null }] },
      { owner: A, packs: [{ kind: "haftarah", ref: "Genesis 1:1-5", name: null }] }, { owner: A, packs: [{ kind: "torah", ref: "Genesis 1:1-5", name: "" }] },
      { owner: A, packs: [{ kind: "torah", ref: "Genesis 1:1-5", name: "x" + bell }] }, { owner: A, packs: [{ kind: "torah", ref: "Genesis 1:1-5" }] }])
      expect(parseOwnerAnswer(200, body), JSON.stringify(body)).toEqual({ state: "unknown" });
    const seen: RequestInit[] = [];
    const answering = (headers: Record<string, string>) => (async (url: string, init: RequestInit) => {
      seen.push(init); const response = new Response(JSON.stringify(ok), { headers: { "content-type": "application/json", ...headers } });
      Object.defineProperty(response, "url", { value: url }); return response;
    }) as unknown as typeof fetch;
    expect(await askOwner({ origin, fetch: answering({}) }, signal())).toEqual({ state: "owner", ...ok });
    expect(seen[0]).toMatchObject({ credentials: "same-origin", cache: "no-store", redirect: "error", mode: "same-origin" });
    // A saved copy from a worker is no answer.
    expect(await askOwner({ origin, fetch: answering({ [OFFLINE_HEADER]: "1" }) }, signal())).toEqual({ state: "unknown" });
    expect(await askOwner({ origin, fetch: (async () => { throw new TypeError("offline"); }) as unknown as typeof fetch }, signal())).toEqual({ state: "unknown" });
  });

  test("the stored index holds owner packs only of its own owner", () => {
    const pack = { key: "ref:torah:0", owner: A, label: "", descriptor: { type: "ref", kind: "torah", ref: "Genesis 1:1-5" }, assets: [], bytes: 0, renewedAt: 1, expiresAt: 2, format: 1 };
    expect(parsePackIndex({ format: 1, owner: A, packs: [pack] }).packs).toHaveLength(1);
    for (const value of [{ format: 1, owner: B, packs: [pack] }, { format: 1, owner: null, packs: [pack] }, { format: 1, packs: [pack] }, { format: 1, owner: "x", packs: [] },
      { format: 1, owner: A, packs: [{ ...pack, owner: "public" }] }, { format: 1, owner: A, packs: [{ ...pack, descriptor: { type: "week", date: "2026-10-24" } }] }])
      expect(parsePackIndex(value), JSON.stringify(value)).toEqual(EMPTY_INDEX);
    // An A1 index (no owner) still reads.
    expect(parsePackIndex({ format: 1, packs: [] })).toEqual({ format: 1, owner: null, packs: [] });
    // A canonical ref may be up to 1000 characters: a long one must not make the stored index unreadable (review finding).
    const long = Array.from({ length: 30 }, (_, index) => `Deuteronomy ${index + 1}:1-2`).join("; ");
    expect(long.length).toBeGreaterThan(400);
    expect(parsePackIndex({ format: 1, owner: A, packs: [{ ...pack, descriptor: { type: "ref", kind: "torah", ref: long } }] }).packs).toHaveLength(1);
    expect(parsePackIndex({ format: 1, owner: A, packs: [{ ...pack, descriptor: { type: "ref", kind: "torah", ref: "x".repeat(1001) } }] })).toEqual(EMPTY_INDEX);
    expect(parseOwnerAnswer(200, { owner: A, packs: [{ kind: "torah", ref: long, name: null }] }).state).toBe("owner");
  });
  test("a member's name is counted in code points, as the saved layer counts it (review finding)", () => {
    const emoji = String.fromCodePoint(0x1f4dc).repeat(80);
    expect(emoji.length).toBe(160);
    expect(parseOwnerAnswer(200, { owner: A, packs: [{ kind: "torah", ref: "Genesis 1:1-5", name: emoji }] }).state).toBe("owner");
    expect(parseOwnerAnswer(200, { owner: A, packs: [{ kind: "torah", ref: "Genesis 1:1-5", name: emoji + "x" }] }).state).toBe("unknown");
    // The label it becomes still fits the stored index.
    const pack = { key: "ref:torah:0", owner: A, label: emoji, descriptor: { type: "ref", kind: "torah", ref: "Genesis 1:1-5" }, assets: [], bytes: 0, renewedAt: 1, expiresAt: 2, format: 1 };
    expect(parsePackIndex({ format: 1, owner: A, packs: [pack] }).packs).toHaveLength(1);
  });
});

describe("N24: on the beitmitzvah origin (decision 14) the learner's assigned reading is packed, and leaves with the account", () => {
  const A = "A".repeat(43), B = "B".repeat(43), assigned = { kind: "torah" as const, ref: "Genesis 1:1-3", name: null };
  const own = (owner: string) => async () => ({ state: "owner" as const, owner, packs: [assigned] });
  const refPack = async (h: Awaited<ReturnType<typeof harness>>) => (await packs(h)).find(row => row.descriptor.type === "ref");

  test("packed under its owner from the public routes only, with no cookie, on the beitmitzvah origin itself", async () => {
    const h = await harness({ origin: BEIT_MITZVAH_ORIGIN });
    await openOffline({ ...h.io, owner: own(A) });
    const pack = await refPack(h), selector = { by: "ref" as const, ref: "Genesis 1:1-3", kind: "torah" as const };
    expect(pack).toMatchObject({ key: ownerPackKey("torah", "Genesis 1:1-3"), owner: A, descriptor: { type: "ref", kind: "torah", ref: "Genesis 1:1-3" } });
    expect(pack!.assets).toEqual(expect.arrayContaining([publicReadingPath(selector), publicTextPath(selector, "torah", 0)].map(path => { const url = new URL(path, BEIT_MITZVAH_ORIGIN); return url.pathname + url.search; })));
    // Only the public reading routes and PocketTorah short clips: no private route, nothing generated (G3).
    expect(pack!.assets.every(packAssetAllowed)).toBe(true);
    expect(pack!.assets.every(asset => /^\/api\/public\/(?:reading|text|reference\/short)\?|^\/reference-audio\/short-v1\/[a-f0-9]{64}\.mp3$/.test(asset))).toBe(true);
    // Every pack request went to this origin with no cookie; the private endpoint is asked only through io.owner.
    expect(h.requests.length).toBeGreaterThan(0);
    expect(h.requests.every(row => row.url.startsWith(BEIT_MITZVAH_ORIGIN + "/") && row.init.credentials === "omit")).toBe(true);
  });

  test("sign-out deletes it (and every pack) at once; a later open signed out keeps none of it", async () => {
    const h = await harness({ origin: BEIT_MITZVAH_ORIGIN });
    await openOffline({ ...h.io, owner: own(A) });
    expect(await refPack(h)).toBeDefined();
    vi.stubGlobal("caches", h.caches);
    try { await purgeOffline(); } finally { vi.unstubAllGlobals(); }
    expect(await h.caches.has(OFFLINE_CACHE)).toBe(false);
    await openOffline({ ...h.io, owner: async () => ({ state: "signed-out" as const }) });
    expect(await refPack(h)).toBeUndefined();
    expect((await readIndex((await offline(h)) as unknown as Cache)).owner).toBeNull();
  });

  test("another account on the same device never sees it: the whole cache goes before the new owner's packs", async () => {
    const h = await harness({ origin: BEIT_MITZVAH_ORIGIN });
    await openOffline({ ...h.io, owner: own(A) });
    await openOffline({ ...h.io, owner: async () => ({ state: "owner" as const, owner: B, packs: [] }) });
    const stored = await readIndex((await offline(h)) as unknown as Cache);
    expect(stored.owner).toBe(B);
    expect(stored.packs.some(row => row.owner === A || row.descriptor.type === "ref")).toBe(false);
    // None of the learner's own pages is left in the cache (This week and the course were fetched again for the new owner).
    const keys = new Set((await offline(h)).entries.keys()), selector = { by: "ref" as const, ref: "Genesis 1:1-3", kind: "torah" as const };
    for (const path of [publicReadingPath(selector), publicTextPath(selector, "torah", 0)]) expect(keys.has(new URL(path, BEIT_MITZVAH_ORIGIN).href), path).toBe(false);
  });
});

describe("N24: the week's aliyot and its approved portion summary go in This week, as the reader asks for them", () => {
  const SLUG = "vayera";
  const approved = Object.freeze({ reading: SLUG, revision: 2, summary: "Synthetic summary paragraph.", outline: [1, 2, 3, 4, 5, 6, 7].map(aliyah => ({ aliyah, line: `Synthetic line ${aliyah}` })),
    credit: "Synthetic credit", approvedAt: "2026-10-20T12:00:00.000Z" });
  const keyOf = (path: string) => { const url = new URL(path, origin); return url.pathname + url.search; };

  test("the approved summary is packed byte for byte as the public route served it, beside the aliyot, with no cookie", async () => {
    const asked: string[] = [];
    const h = await harness({ parashah: "Vayera", portionSummary: async reading => { asked.push(reading); return approved as never; } });
    expect(await renewPack(h.io, { type: "week", date }, signal())).toBe("saved");
    const [pack] = await packs(h);
    expect(pack.assets).toEqual(expect.arrayContaining([keyOf(publicAliyotPath(date)), keyOf(portionSummaryPath(SLUG))]));
    expect(pack.assets.every(packAssetAllowed)).toBe(true);
    expect(asked).toEqual([SLUG]);
    const stored = await (await offline(h)).match(origin + portionSummaryPath(SLUG));
    expect(await stored!.json()).toEqual({ reading: SLUG, summary: approved });
    const aliyot = await (await (await offline(h)).match(origin + publicAliyotPath(date)))!.json();
    expect(aliyot.date).toBe(date); expect(aliyot.full[0].ref).toBe("Genesis 1:1-2:3");
    expect(h.requests.filter(row => /aliyot|portion-summary/.test(row.url)).every(row => row.init.credentials === "omit")).toBe(true);
  });

  test("a parashah with no approved summary keeps the route's null answer; a reading that is no parashah asks for none", async () => {
    const h = await harness({ parashah: "Vayera" });
    await renewPack(h.io, { type: "week", date }, signal());
    expect(await (await (await offline(h)).match(origin + portionSummaryPath(SLUG)))!.json()).toEqual({ reading: SLUG, summary: null });
    const other = await harness();
    await renewPack(other.io, { type: "week", date }, signal());
    expect(other.requests.some(row => row.url.includes("portion-summary"))).toBe(false);
  });

  test("anything beyond the approved shape (a draft's fields) is never packed, and This week is still saved", async () => {
    const nested = [{ outline: approved.outline.map((row, at) => at === 0 ? { ...row, draft: "Synthetic unreviewed line" } : row) }, { credit: 7 }, { credit: null }];
    for (const extra of [{ status: "draft" }, { draft: "Synthetic unreviewed text" }, { reviewed: false }, ...nested]) {
      const h = await harness({ parashah: "Vayera", portionSummary: async () => ({ ...approved, ...extra }) as never });
      expect(await renewPack(h.io, { type: "week", date }, signal())).toBe("saved");
      const [pack] = await packs(h);
      expect(pack.assets.some(asset => asset.includes("portion-summary")), JSON.stringify(extra)).toBe(false);
      expect([...(await offline(h)).entries.keys()].some(key => key.includes("portion-summary")), JSON.stringify(extra)).toBe(false);
    }
  });

  test("a failed aliyot or summary answer is left out without losing the week; a 429 still stops the pack", async () => {
    const h = await harness({ parashah: "Vayera", portionSummary: async () => approved as never });
    h.setStatus(url => /aliyot|portion-summary/.test(url) ? 503 : null);
    expect(await renewPack(h.io, { type: "week", date }, signal())).toBe("saved");
    expect((await packs(h))[0].assets.some(asset => /aliyot|portion-summary/.test(asset))).toBe(false);
    const limited = await harness({ parashah: "Vayera", portionSummary: async () => approved as never });
    limited.setStatus(url => url.includes("aliyot") ? 429 : null);
    await expect(renewPack(limited.io, { type: "week", date }, signal())).rejects.toEqual(new PackStopped("rate-limited"));
  });

  test("on beitmitzvah, sign-out deletes them with every other pack", async () => {
    const h = await harness({ origin: BEIT_MITZVAH_ORIGIN, parashah: "Vayera", portionSummary: async () => approved as never });
    await openOffline({ ...h.io, owner: async () => ({ state: "owner" as const, owner: "A".repeat(43), packs: [] }) });
    const cache = await offline(h);
    expect(cache.entries.has(BEIT_MITZVAH_ORIGIN + portionSummaryPath(SLUG))).toBe(true);
    expect(cache.entries.has(BEIT_MITZVAH_ORIGIN + publicAliyotPath(date))).toBe(true);
    vi.stubGlobal("caches", h.caches);
    try { await purgeOffline(); } finally { vi.unstubAllGlobals(); }
    expect(await h.caches.has(OFFLINE_CACHE)).toBe(false);
  });
});
