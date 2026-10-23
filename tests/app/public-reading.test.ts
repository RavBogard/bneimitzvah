import { afterEach, expect, test, vi } from "vitest";
import { unavailableExtras } from "../helpers/translations";
vi.mock("server-only", () => ({}));
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { budgetedStepSource, createPublicReadingService, PublicReadingUnavailable, PUBLIC_CALENDAR } from "../../src/server/public-reading/service";
import { StepSourceUnavailable } from "../../src/server/study/lexical/step";
import type { StepSourceLoader } from "../../src/server/study/lexical/source-loader";
import { handlePublicReadingRequest, isPublicReadingPath, publicReadingRouteMethods, type PublicRuntime } from "../../src/server/http/public-reading";
import { createHttpDispatcher } from "../../src/server/http/dispatch";
import { createShortSourceManifestLoader } from "../../src/server/reference-audio/short-source-manifest";
import { parseReferenceCatalog } from "../../src/server/reference-audio/catalog";
import { createSefariaStudyReader } from "../../src/server/study/sefaria";
import { AccessDenied } from "../../src/server/access/errors";
import { TANAKH_VERSE_COUNTS } from "../../src/lib/readings/catalog";
import { expandReadingRanges, parseCeremonyDate } from "../../src/lib/readings/ranges";
import { addDays, publicShabbat, shabbatOnOrAfter, thisShabbat } from "../../src/lib/readings/public-shabbat";
import type { Snapshot } from "../../src/lib/readings/proposals";
import { syntheticResponse } from "../helpers/study";
import { syntheticCommentaryFetch } from "../helpers/commentary";
import { createSefariaCommentaryReader } from "../../src/server/study/commentary";
import { publicShortFixture, byteStream } from "./reference-public-short-fixture";

// Synthetic calendar, text, recordings and clips only; invented syllables and bytes.
const origin = "https://beitmitzvah.centralreform.org";
const date = thisShabbat();
afterEach(() => vi.restoreAllMocks());

async function harness(options: { pocketTorah?: boolean; stepSource?: StepSourceLoader; snapshot?: (date: string) => Partial<Snapshot> } = {}) {
  const fetchedAt = Date.now();
  const calendar = vi.fn(async (value: string, cal: "diaspora" | "israel") => ({ fetchedAt, snapshot: { date: parseCeremonyDate(value), calendar: cal, classification: "regular" as const,
    reading: { parashah: "Synthetic portion", type: "shabbat", summary: "", source: "Hebcal", aliyot: [{ n: 1 as const, ref: "Genesis 1:1-4:26" }], triennial: null },
    haftarah: "Isaiah 1:1-3", ...options.snapshot?.(value) } }));
  const fetch = vi.fn<typeof globalThis.fetch>(async url => syntheticResponse(decodeURIComponent(new URL(url instanceof Request ? url.url : url).pathname.split("/").at(-1)!)));
  const loadText = vi.fn(createSefariaStudyReader({ fetch, verseCounts: TANAKH_VERSE_COUNTS }));
  const source = publicShortFixture(), catalog = parseReferenceCatalog(JSON.parse(new TextDecoder().decode(source.parent)))!;
  const short = await createShortSourceManifestLoader({ sha256: source.manifestSHA256, parentCatalogSHA256: source.parentCatalogSHA256, parentCatalogBytes: source.parent, get: async () => byteStream(source.manifest) })();
  const service = createPublicReadingService({ loadReading: calendar, loadText, stepSource: options.stepSource ?? { book: async () => Object.freeze([]), lexicon: async () => Object.freeze([]) },
    pocketTorah: options.pocketTorah === false ? null : { loadCatalog: async () => catalog, loadManifest: async () => short } });
  const tenant = vi.fn(async (_request: Request) => undefined);
  const commentary = vi.fn(createSefariaCommentaryReader({ fetch: syntheticCommentaryFetch() as typeof globalThis.fetch }));
  const runtime: PublicRuntime = { resolveTenant: tenant, reading: service, commentary, ...unavailableExtras };
  let sessionRuntimeUsed = 0, publicRuntimeOpened = 0;
  const dispatch = createHttpDispatcher(async () => { sessionRuntimeUsed++; throw new Error("The session runtime must not be reached"); }, async action => { publicRuntimeOpened++; return action(runtime); });
  const call = (path: string, init: RequestInit = {}) => dispatch(new Request(origin + path, init));
  return { service, calendar, loadText, commentary, fetch, tenant, runtime, dispatch, call, sessionRuntime: () => sessionRuntimeUsed, publicRuntime: () => publicRuntimeOpened, source };
}
const q = (entries: [string, string][]) => new URLSearchParams(entries).toString();
const routes = (d = date) => [
  `/api/public/reading?${q([["date", d]])}`,
  `/api/public/text?${q([["date", d], ["kind", "torah"], ["offset", "0"]])}`,
  `/api/public/text?${q([["date", d], ["kind", "haftarah"], ["offset", "0"]])}`,
  `/api/public/word-aids?${q([["date", d], ["kind", "torah"], ["verse", "1"]])}`,
  `/api/public/word-details?${q([["date", d], ["kind", "torah"], ["verse", "0"], ["word", "0"]])}`,
  `/api/public/reference/short?${q([["date", d], ["kind", "torah"], ["offset", "0"]])}`,
  `/api/public/commentary?${q([["work", "rashi"], ["chapter", "Genesis 1"]])}`,
  `/api/public/commentary?${q([["work", "rashi"], ["chapter", "I Samuel 20"]])}`,
];
// Anything that could identify or describe a person, an assignment or a session.
const PEOPLE = /^(?:student|students|studentId|studentRevision|firstName|lastName|hebrewName|displayName|email|parentEmail|ownEmail|ceremonyDate|serviceSlot|rehearsal1|rehearsal2|assignment|assignmentId|readings|tutor|tutors|guardian|guardians|note|notes|context|membership|membershipId|userId|session|sessionBinding|roles|binding|expiresAt|honors|progress|recording|recordings)$/i;
function keys(value: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach(item => keys(item, found));
  else if (value && typeof value === "object") for (const [key, item] of Object.entries(value)) { found.add(key); keys(item, found); }
  return found;
}

test("this week, browsing and the date window are bounded calendar arithmetic", () => {
  expect(new Date(`${date}T00:00:00Z`).getUTCDay()).toBe(6);
  expect(shabbatOnOrAfter("2026-10-22")).toBe("2026-10-24");
  expect(shabbatOnOrAfter("2026-10-24")).toBe("2026-10-24");
  expect(addDays("2026-10-24", -7)).toBe("2026-10-17");
  // Thursday evening in St. Louis is already Friday in UTC: this week's Shabbat is still the coming one.
  expect(thisShabbat(Date.parse("2026-10-23T03:30:00Z"))).toBe("2026-10-24");
  expect(thisShabbat(Date.parse("2026-10-25T04:30:00Z"))).toBe("2026-10-24"); // Saturday 11:30 pm Central
  expect(publicShabbat(date)).toBe(date);
  for (const bad of [addDays(date, 1), "2026-02-30", "2026-10-24T00:00", "", 20261024, addDays(date, -7 * 120), addDays(date, 7 * 170)]) expect(publicShabbat(bad)).toBeNull();
});

test("the week shows this Shabbat's full parashah and haftarah from the shared calendar, paged as the student reading", async () => {
  const h = await harness(), week = await h.service.week(date), genesis = expandReadingRanges(["Genesis 1:1-4:26"], "torah", TANAKH_VERSE_COUNTS);
  expect(h.calendar).toHaveBeenCalledWith(date, PUBLIC_CALENDAR);
  expect(PUBLIC_CALENDAR).toBe("diaspora");
  expect(week).toMatchObject({ date, parashah: "Synthetic portion", listening: { pocketTorah: true } });
  expect(week.torah).toEqual({ kind: "torah", ranges: ["Genesis 1:1-4:26"], verseCount: 31 + 25 + 24 + 26,
    pages: [{ offset: 0, first: "Genesis 1:1", last: genesis[99] }, { offset: 100, first: genesis[100], last: "Genesis 4:26" }] });
  expect(week.haftarah).toMatchObject({ kind: "haftarah", ranges: ["Isaiah 1:1-3"], verseCount: 3 });
  const page = await h.service.text("torah", date, 0);
  expect(page.verses[0].ref).toBe("Genesis 1:1"); expect(page.verses).toHaveLength(100); expect(page.nextOffset).toBe(100);
  expect((await h.service.text("torah", date, 100)).verses.map(verse => verse.ref)).toEqual(genesis.slice(100));
  expect(page.verses.every(verse => typeof verse.english === "string")).toBe(true); // JPS 2023, as for students
  expect(h.loadText.mock.calls[0][0]).toMatchObject({ kind: "torah", ranges: ["Genesis 1:1-4:26"], offset: 0, translation: "jps2023" });
  // A holiday or ambiguous week shows no invented Torah reading.
  const holiday = await harness({ snapshot: () => ({ classification: "holiday" }) });
  expect((await holiday.service.week(date)).torah).toBeNull();
  await expect(holiday.service.text("torah", date, 0)).rejects.toMatchObject({ code: "not-found" });
  expect((await holiday.service.text("haftarah", date, 0)).verses).toHaveLength(3);
});

test("inputs are bounded: dates, kinds, page offsets, verse and word indexes", async () => {
  const h = await harness();
  for (const action of [() => h.service.week(addDays(date, 1)), () => h.service.text("torah", date, 1), () => h.service.text("torah", date, 106),
    () => h.service.text("other" as never, date, 0), () => h.service.wordAids("torah", date, 106), () => h.service.wordAids("torah", date, -1),
    () => h.service.wordDetails("torah", date, 0, 512), () => h.service.wordDetails("torah", date, 0, 2) /* the verse has two words */]) {
    await expect(action()).rejects.toBeInstanceOf(PublicReadingUnavailable);
  }
  // A date always takes its passage from the calendar, never from the caller (ref routes are tested below).
  expect(h.loadText.mock.calls.every(([request]) => request.ranges.join() === "Genesis 1:1-4:26" || request.ranges.join() === "Isaiah 1:1-3")).toBe(true);
});

test("word aids and word details (with this word elsewhere) work for any verse of the reading", async () => {
  const h = await harness();
  const aids = await h.service.wordAids("torah", date, 1);
  expect(aids.ref).toBe("Genesis 1:2"); expect(["ready", "unavailable"]).toContain(aids.status);
  const details = await h.service.wordDetails("torah", date, 0, 0);
  expect(details.ref).toBe("Genesis 1:1"); expect(details.wordIndex).toBe(0);
});

test("PocketTorah verse resolutions are public only once released to students; bytes stay on the existing short route", async () => {
  const h = await harness(), page = await h.service.shortReferences("torah", date, 0);
  expect(page.references).toHaveLength(100);
  expect(page.references[0]).toMatchObject({ verse: { ref: "Genesis 1:1", playback: { status: "ready" } } });
  expect(page.references[0].source?.path).toMatch(/^\/reference-audio\/short-v1\/[a-f0-9]{64}\.mp3$/);
  expect(page.references.slice(1).every(reference => reference.source === null)).toBe(true);
  const held = await harness({ pocketTorah: false });
  expect((await held.service.week(date)).listening.pocketTorah).toBe(false);
  await expect(held.service.shortReferences("torah", date, 0)).rejects.toMatchObject({ code: "not-found" });
});

test("every public route works signed-out, never reaches the session runtime, and answers identically with a session cookie", async () => {
  const h = await harness();
  for (const path of routes()) {
    const anonymous = await h.call(path);
    expect(anonymous.status, path).toBe(200);
    expect(anonymous.headers.get("x-robots-tag"), path).toBe("noindex, nofollow");
    expect(anonymous.headers.get("set-cookie"), path).toBeNull();
    expect(anonymous.headers.get("cache-control"), path).toMatch(/^public, max-age=/);
    expect(anonymous.headers.get("vercel-cdn-cache-control"), path).toMatch(/^public, s-maxage=\d+/);
    const withCookie = await h.call(path, { headers: { cookie: "better-auth.session_token=synthetic-session; other=1", "x-practice-context": "a".repeat(43) } });
    expect(withCookie.status, path).toBe(200);
    // Same bytes for everyone (only the uncached synthetic chapter fetch time may differ).
    const same = (bytes: ArrayBuffer) => Buffer.from(bytes).toString("latin1").replace(/"fetchedAt":\d+/g, "");
    expect(same(await withCookie.arrayBuffer())).toBe(same(await anonymous.arrayBuffer()));
    expect(withCookie.headers.get("set-cookie"), path).toBeNull();
  }
  expect(h.sessionRuntime()).toBe(0);
  expect(h.tenant).toHaveBeenCalledTimes(routes().length * 2);
});

test("no public response carries people data, an assignment or a session field", async () => {
  const h = await harness();
  for (const path of routes()) {
    const body = await (await h.call(path)).json(), found = [...keys(body)].filter(key => PEOPLE.test(key));
    expect(found, path).toEqual([]);
    expect(JSON.stringify(body), path).not.toMatch(/@|example\.test|ceremony|tutor/i);
  }
});

test("the allowlist is exact: GET only, canonical closed queries, no body, no ranges, and nothing else under /api/public", async () => {
  const h = await harness();
  expect(publicReadingRouteMethods("/api/public/reading")).toEqual(["GET"]);
  for (const path of ["/api/public", "/api/public/", "/api/public/students", "/api/public/session", "/api/public/reference/generated", "/api/public/reference/synthetic/1.mp3",
    "/api/public/chant", "/api/public/render", "/api/public/reference/finkel/clips", "/api/public/reference/finkel/media/" + "a".repeat(64) + ".mp3",
    "/api/public/text/extra", "/api/public/reading/"]) {
    expect(isPublicReadingPath(path)).toBe(true);
    const response = await h.call(path);
    expect(response.status, path).toBe(404); expect(response.headers.get("cache-control")).toBe("no-store"); expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
  }
  const reading = `/api/public/reading?${q([["date", date]])}`;
  for (const method of ["POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]) {
    const response = await h.call(reading, { method, ...(method === "POST" ? { body: "{}" } : {}) });
    expect(response.status, method).toBe(405); expect(response.headers.get("allow")).toBe("GET");
  }
  for (const path of [`/api/public/reading`, `/api/public/reading?${q([["date", date], ["date", date]])}`, `/api/public/reading?${q([["date", date], ["x", "1"]])}`,
    `/api/public/text?${q([["kind", "torah"], ["date", date], ["offset", "0"]])}`, `/api/public/text?date=${date}&kind=torah&offset=00`, `/api/public/text?${q([["date", date], ["kind", "torah"], ["offset", "1"]])}`,
    `/api/public/text?${q([["date", date], ["kind", "megillah"], ["offset", "0"]])}`, `/api/public/text?${q([["date", addDays(date, 2)], ["kind", "torah"], ["offset", "0"]])}`,
    `/api/public/reading?${q([["date", addDays(date, 7 * 200)]])}`,
    // Commentary: no date key, but the same closed canonical query.
    `/api/public/commentary?${q([["chapter", "Genesis 1"], ["work", "rashi"]])}`, `/api/public/commentary?work=rashi&chapter=Genesis%201`,
    `/api/public/commentary?${q([["work", "rashi"]])}`, `/api/public/commentary?${q([["work", "rashi"], ["chapter", "Genesis 1"], ["date", date]])}`,
    `/api/public/commentary?${q([["date", date], ["work", "rashi"], ["chapter", "Genesis 1"]])}`]) {
    const response = await h.call(path);
    expect(response.status, path).toBe(400); expect(response.headers.get("cache-control")).toBe("no-store");
  }
  for (const method of ["POST", "HEAD"]) expect((await h.call(`/api/public/commentary?${q([["work", "rashi"], ["chapter", "Genesis 1"]])}`, { method })).status).toBe(405);
  expect(h.sessionRuntime()).toBe(0);
});

test("generated chant is never served publicly: PocketTorah's catalog is the only audio source, and no public route serves audio bytes", async () => {
  const h = await harness();
  for (const path of routes()) expect((await h.call(path)).headers.get("content-type"), path).toBe("application/json; charset=utf-8");
  const short = await (await h.call(`/api/public/reference/short?${q([["date", date], ["kind", "torah"], ["offset", "0"]])}`)).json();
  const paths = short.page.references.flatMap((reference: { source: { path: string } | null }) => reference.source ? [reference.source.path] : []);
  expect(paths.length).toBeGreaterThan(0);
  expect(paths.every((path: string) => /^\/reference-audio\/short-v1\/[a-f0-9]{64}\.mp3$/.test(path) && h.source.manifest.length > 0)).toBe(true);
  // The public modules never import the trope engine or any render/synthesis code.
  const files = ["src/server/public-reading/service.ts", "src/server/http/public-reading.ts", "src/server/runtime/public-composition.ts",
    ...readdirSync("src/components/portal/public-reading").map(name => join("src/components/portal/public-reading", name))];
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    const imports = [...source.matchAll(/(?:import|from)\s*\(?\s*["']([^"']+)["']/g)].map(match => match[1]);
    expect(imports.filter(name => /trope\/|render|synth|speech2sing|soulx|generat|finkel|recording/i.test(name)), file).toEqual([]);
  }
});

test("only CRC is served: a request whose host maps to another tenant gets 404 on every route", async () => {
  const h = await harness(); h.tenant.mockImplementation(async () => { throw new AccessDenied(404); });
  for (const path of routes()) { const response = await h.call(path); expect(response.status, path).toBe(404); expect(response.headers.get("cache-control")).toBe("no-store"); }
});

test("upstream failure and runtime outage are 503 and never cached", async () => {
  const h = await harness(); h.calendar.mockRejectedValue(new Error("synthetic calendar outage"));
  const response = await h.call(`/api/public/reading?${q([["date", date]])}`);
  expect(response.status).toBe(503); expect(response.headers.get("vercel-cdn-cache-control")).toBe("no-store");
  const down = await handlePublicReadingRequest(new Request(origin + `/api/public/reading?${q([["date", date]])}`), async () => { throw new Error("pool unavailable"); });
  expect(down.status).toBe(503); expect(down.headers.get("cache-control")).toBe("no-store");
});

test("uncacheable headers and invalid dates or numbers are refused before any runtime or database opens", async () => {
  const h = await harness(), reading = `/api/public/reading?${q([["date", date]])}`;
  for (const headers of [{ authorization: "Bearer synthetic" }, { range: "bytes=0-1" }, { "if-range": "x" }] as Record<string, string>[]) {
    const response = await h.call(reading, { headers });
    expect(response.status).toBe(400); expect(response.headers.get("cache-control")).toBe("no-store");
  }
  for (const path of [`/api/public/reading?${q([["date", addDays(date, 1)]])}`, `/api/public/reading?${q([["date", addDays(date, 7 * 200)]])}`,
    `/api/public/text?${q([["date", date], ["kind", "megillah"], ["offset", "0"]])}`, `/api/public/word-details?${q([["date", date], ["kind", "torah"], ["verse", "0"], ["word", "12345"]])}`,
    // An unregistered work, a Ketuvim book, a chapter or verse out of range, a non-chapter: refused before the runtime opens.
    ...[["malbim", "Genesis 1"], ["Rashi", "Genesis 1"], ["__proto__", "Genesis 1"], ["rashi", "Psalms 1"], ["rashi", "Ruth 1"], ["rashi", "Genesis 51"], ["rashi", "Genesis 0"],
      ["rashi", "Genesis 01"], ["rashi", "Genesis 1:1"], ["rashi", "genesis 1"], ["rashi", "Genesis"], ["rashi", "Obadiah 2"], ["rashi", ""]]
      .map(([work, chapter]) => `/api/public/commentary?${q([["work", work], ["chapter", chapter]])}`)]) {
    expect((await h.call(path)).status, path).toBe(400);
  }
  expect(h.publicRuntime()).toBe(0); expect(h.tenant).not.toHaveBeenCalled();
  expect((await h.call(reading)).status).toBe(200); expect(h.publicRuntime()).toBe(1);
});

test("a momentary lexical miss is a 503 that no cache keeps, and book changes are budgeted per instance", async () => {
  const busy = await harness({ stepSource: { book: async () => { throw new StepSourceUnavailable(); }, lexicon: async () => Object.freeze([]) } });
  const response = await busy.call(`/api/public/word-details?${q([["date", date], ["kind", "torah"], ["verse", "0"], ["word", "0"]])}`);
  expect(response.status).toBe(503); expect(response.headers.get("vercel-cdn-cache-control")).toBe("no-store");
  let time = 0; const book = vi.fn(async () => Object.freeze([])), lexicon = vi.fn(async () => Object.freeze([]));
  const budgeted = budgetedStepSource({ book, lexicon }, { changes: 2, windowMs: 1000, now: () => time });
  await budgeted.book("Gen"); await budgeted.book("Gen"); await budgeted.book("Gen"); // a cached book is never limited
  await budgeted.book("Isa");
  await expect(budgeted.book("Gen")).rejects.toBeInstanceOf(StepSourceUnavailable); // a third change inside the window
  expect(book).toHaveBeenCalledTimes(4);
  await budgeted.book("Isa"); time = 1000; await budgeted.book("Gen"); expect(book).toHaveBeenCalledTimes(6);
  await budgeted.lexicon(); expect(lexicon).toHaveBeenCalledTimes(1);
  // Visitors waiting on the same load spend one change, not one each.
  let release!: () => void; const gate = new Promise<readonly never[]>(done => { release = () => done(Object.freeze([])); }), slow = vi.fn(() => gate);
  const shared = budgetedStepSource({ book: slow, lexicon }, { changes: 1, windowMs: 1000, now: () => 0 });
  const waiting = [shared.book("Exo"), shared.book("Exo"), shared.book("Exo"), shared.book("Exo")];
  release(); await Promise.all(waiting); await shared.book("Exo");
  await expect(shared.book("Lev")).rejects.toBeInstanceOf(StepSourceUnavailable);
});

// ---- "Any reading": the ref-keyed forms of the same routes (1.3; the 1.5 offline packer's contract).
const refRoutes = (ref = "Genesis 12:1-20", kind = "torah") => [
  `/api/public/reading?${q([["ref", ref], ["kind", kind]])}`,
  `/api/public/text?${q([["ref", ref], ["kind", kind], ["offset", "0"]])}`,
  `/api/public/word-aids?${q([["ref", ref], ["kind", kind], ["verse", "1"]])}`,
  `/api/public/word-details?${q([["ref", ref], ["kind", kind], ["verse", "0"], ["word", "0"]])}`,
  `/api/public/reference/short?${q([["ref", ref], ["kind", kind], ["offset", "0"]])}`,
];

test("every route also answers a canonical ref, signed-out, cacheable per route, with no people data and no calendar call", async () => {
  const h = await harness();
  for (const [ref, kind] of [["Genesis 12:1-20", "torah"], ["Exodus 32:11-14; Exodus 34:1-10", "torah"], ["Isaiah 27:6-28:13; Isaiah 29:22-23", "haftarah"]]) {
    for (const path of refRoutes(ref, kind)) {
      const response = await h.call(path);
      expect(response.status, path).toBe(200);
      expect(response.headers.get("x-robots-tag"), path).toBe("noindex, nofollow");
      expect(response.headers.get("set-cookie"), path).toBeNull();
      expect(response.headers.get("cache-control"), path).toBe("public, max-age=300");
      expect(response.headers.get("vercel-cdn-cache-control"), path).toBe(`public, s-maxage=${path.startsWith("/api/public/reading?") ? 3600 : 86400}`);
      const body = await response.json();
      expect(body.ref, path).toBe(ref); expect(body.kind, path).toBe(kind); expect(body.date, path).toBeUndefined();
      expect([...keys(body)].filter(key => PEOPLE.test(key)), path).toEqual([]);
    }
  }
  const reading = await (await h.call(refRoutes()[0])).json();
  expect(reading).toEqual({ ref: "Genesis 12:1-20", kind: "torah", listening: { pocketTorah: true },
    passage: { kind: "torah", ranges: ["Genesis 12:1-20"], verseCount: 20, pages: [{ offset: 0, first: "Genesis 12:1", last: "Genesis 12:20" }] } });
  expect(h.calendar).not.toHaveBeenCalled(); // a ref passage is computed locally
  expect(h.loadText.mock.calls.some(([request]) => request.ranges.join("; ") === "Exodus 32:11-14; Exodus 34:1-10")).toBe(true);
  expect(h.sessionRuntime()).toBe(0);
});

test("the ref keysets are closed and canonical: no mixing with date, fixed order, + for spaces, encoded colons", async () => {
  const h = await harness(), ref = "Genesis 12:1-20";
  expect((await h.call(`/api/public/reading?ref=Genesis+12%3A1-20&kind=torah`)).status).toBe(200);
  for (const path of [
    `/api/public/reading?ref=Genesis%2012%3A1-20&kind=torah`, `/api/public/reading?ref=Genesis+12:1-20&kind=torah`, `/api/public/reading?ref=Genesis+12%3a1-20&kind=torah`,
    `/api/public/reading?${q([["kind", "torah"], ["ref", ref]])}`, `/api/public/reading?${q([["ref", ref]])}`, `/api/public/reading?${q([["kind", "torah"]])}`,
    `/api/public/reading?${q([["ref", ref], ["kind", "torah"], ["date", date]])}`, `/api/public/reading?${q([["date", date], ["ref", ref], ["kind", "torah"]])}`,
    `/api/public/reading?${q([["date", date], ["kind", "torah"]])}`, `/api/public/reading?${q([["ref", ref], ["ref", ref], ["kind", "torah"]])}`,
    `/api/public/text?${q([["ref", ref], ["date", date], ["kind", "torah"], ["offset", "0"]])}`, `/api/public/text?${q([["date", date], ["ref", ref], ["kind", "torah"], ["offset", "0"]])}`,
    `/api/public/text?${q([["ref", ref], ["kind", "torah"]])}`, `/api/public/text?${q([["kind", "torah"], ["ref", ref], ["offset", "0"]])}`,
    `/api/public/text?${q([["ref", ref], ["kind", "torah"], ["offset", "0"], ["x", "1"]])}`, `/api/public/text?${q([["ref", ref], ["kind", "torah"], ["offset", "00"]])}`,
    `/api/public/word-details?${q([["ref", ref], ["kind", "torah"], ["verse", "0"]])}`, `/api/public/commentary?${q([["ref", ref], ["kind", "torah"]])}`,
    `/api/public/reference/short?${q([["ref", ref], ["kind", "torah"], ["verse", "0"]])}`,
  ]) {
    const response = await h.call(path);
    expect(response.status, path).toBe(400); expect(response.headers.get("cache-control"), path).toBe("no-store");
    expect(response.headers.get("vercel-cdn-cache-control"), path).toBe("no-store");
  }
  expect(h.publicRuntime()).toBe(1);
});

test("a bad, long or mismatched ref is refused before any runtime or database opens", async () => {
  const h = await harness();
  const long = Array.from({ length: 33 }, (_, i) => `Genesis ${i + 1}:1`).join("; ");
  for (const [ref, kind] of [["Genesis 12:1-12:20", "torah"], ["Genesis  12:1-20", "torah"], ["Genesis 12:1-20;", "torah"], ["Genesis 12:1-20; ", "torah"], ["Psalms 1:1-6", "haftarah"],
    ["Ruth 1:1-22", "haftarah"], ["Isaiah 1:1-3", "torah"], ["Genesis 1:1-3", "haftarah"], ["Genesis 50:26; Exodus 1:1", "torah"], ["Genesis 1:1-50:26", "torah"], [long, "torah"],
    ["Genesis １２:1", "torah"], ["Genesis 1:1", "megillah"], ["", "torah"], ["a".repeat(1001), "torah"], ["Genesis 51:1", "torah"]]) {
    for (const path of refRoutes(ref, kind)) {
      const response = await h.call(path);
      expect(response.status, `${ref} ${path.slice(0, 40)}`).toBe(400); expect(response.headers.get("cache-control")).toBe("no-store");
    }
  }
  // Longer than 1000 characters, and a URL longer than 2048: refused whatever the rest says.
  expect((await h.call(`/api/public/reading?${q([["ref", "Genesis 1:1" + "; Genesis 1:1".repeat(80)], ["kind", "torah"]])}`)).status).toBe(400);
  expect((await h.call(`/api/public/reading?${q([["ref", "Genesis 12:1-20"], ["kind", "torah"]])}&${"x".repeat(2100)}`)).status).toBe(400);
  expect(h.publicRuntime()).toBe(0); expect(h.tenant).not.toHaveBeenCalled();
});

test("ref routes keep the page and index rules: page starts only, real verses and words, PocketTorah 404 while held, upstream 503 never cached", async () => {
  const h = await harness(), ref = "Genesis 1:1-4:26", verses = 31 + 25 + 24 + 26;
  for (const path of [`/api/public/text?${q([["ref", ref], ["kind", "torah"], ["offset", "1"]])}`, `/api/public/text?${q([["ref", ref], ["kind", "torah"], ["offset", String(verses)]])}`,
    `/api/public/reference/short?${q([["ref", ref], ["kind", "torah"], ["offset", "99"]])}`, `/api/public/word-aids?${q([["ref", ref], ["kind", "torah"], ["verse", String(verses)]])}`,
    `/api/public/word-details?${q([["ref", ref], ["kind", "torah"], ["verse", "0"], ["word", "2"]])}`, `/api/public/word-details?${q([["ref", ref], ["kind", "torah"], ["verse", "0"], ["word", "512"]])}`]) {
    const response = await h.call(path);
    expect(response.status, path).toBe(400); expect(response.headers.get("cache-control"), path).toBe("no-store");
  }
  const second = await (await h.call(`/api/public/text?${q([["ref", ref], ["kind", "torah"], ["offset", "100"]])}`)).json();
  expect(second.verses[0].ref).toBe(expandReadingRanges([ref], "torah", TANAKH_VERSE_COUNTS)[100]); expect(second.nextOffset).toBeNull();
  const held = await harness({ pocketTorah: false });
  const short = await held.call(refRoutes()[4]);
  expect(short.status).toBe(404); expect(short.headers.get("cache-control")).toBe("no-store");
  expect((await (await held.call(refRoutes()[0])).json()).listening).toEqual({ pocketTorah: false });
  h.loadText.mockRejectedValue(new Error("synthetic text outage"));
  for (const path of refRoutes().slice(1)) {
    const response = await h.call(path);
    expect(response.status, path).toBe(503); expect(response.headers.get("vercel-cdn-cache-control"), path).toBe("no-store");
  }
  expect((await h.call(refRoutes()[0])).status).toBe(200); // the passage itself needs no upstream
  h.tenant.mockImplementation(async () => { throw new AccessDenied(404); });
  for (const path of refRoutes()) expect((await h.call(path)).status, path).toBe(404);
});

test("the service refuses non-canonical refs itself, not only at the route", async () => {
  const h = await harness();
  for (const action of [() => h.service.readingByRef("torah", "Genesis 12:1-12:20"), () => h.service.readingByRef("haftarah", "Psalms 1:1"),
    () => h.service.readingByRef("torah", "Isaiah 1:1"), () => h.service.readingByRef("other" as never, "Genesis 1:1")]) {
    expect(action).toThrow(PublicReadingUnavailable);
  }
  for (const action of [() => h.service.textByRef("torah", "Genesis 1:1-1:3", 0), () => h.service.wordAidsByRef("torah", "Genesis 1:1-3", 3),
    () => h.service.wordDetailsByRef("torah", "Genesis 1:1-3", 0, 512), () => h.service.shortReferencesByRef("torah", "Genesis 1:1-3", 1)]) {
    await expect(action()).rejects.toMatchObject({ code: "invalid-request" });
  }
  expect(h.loadText).not.toHaveBeenCalled();
});
