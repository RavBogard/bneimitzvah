import { afterAll, beforeAll, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migratedPglite } from "../helpers/migrated-pglite";
import { eq } from "drizzle-orm";
import * as schema from "../../src/server/db/index";
import { createPersistentStudyCache } from "../../src/server/data/study-cache";
import { createStudyCacheEntry, studyCacheBinding, studyChapterHash, STUDY_CACHE_TTL_MS,
  StudyCacheUnavailable, validateStudyCacheEntry } from "../../src/server/study/cache";
import { normalizeHebrew } from "../../src/server/study/normalize";
import { MAM, JPS2023 } from "../../src/server/study/versions";

const binding = studyCacheBinding("Genesis 1"), time = 1_700_000_000_000;
function synthetic(english = true) {
  // Invented syllables and English labels only; no licensed passage fixture.
  const hebrew = normalizeHebrew('א֑ב <span class="mam-kq"><span class="mam-kq-k">גד</span><span class="mam-kq-q">[הו]</span></span><span class="mam-spi-pe">{פ}</span><span class="mam-spi-invnun">׆</span>');
  const payload = { verses: Array.from({ length: 31 }, (_, i) => ({ ref: `Genesis 1:${i + 1}`, hebrew,
    english: english ? `Synthetic example ${i + 1}` : null })), editions: english ? [MAM, JPS2023] : [MAM] };
  return createStudyCacheEntry(binding, { ...payload, fetchedAt: time, hash: studyChapterHash(payload) });
}
const clone = () => structuredClone(synthetic());
async function denied(operation: () => unknown | Promise<unknown>) {
  try { await operation(); return false; }
  catch (error) { return error instanceof StudyCacheUnavailable && error.message === "Study text unavailable" && !("cause" in error); }
}

test("complete normalized chapters preserve exact edition provenance and adapter hash semantics", () => {
  const entry = synthetic();
  expect(entry.payload.verses.length).toBe(31);
  expect(entry.expiresAt - entry.fetchedAt).toBe(STUDY_CACHE_TTL_MS);
  expect(entry.payload.editions).toEqual([MAM, JPS2023]);
  expect(entry.hash).toBe(studyChapterHash(entry.payload));
  expect(entry.payload.verses[0].hebrew).toMatchObject({ text: "א֑ב גד", readingText: "א֑ב הו", paragraphAfter: "petuchah" });
  expect(Object.isFrozen(entry.payload.verses[0].hebrew.segments)).toBe(true);
  expect(validateStudyCacheEntry(binding, synthetic(false), time).payload.editions).toEqual([MAM]);
});

test.each(["Genesis 0", "Genesis 01", "Genesis 51", "Genesis 1:1", "genesis 1", "Unknown 1", "Genesis 1 ", "Genesis 99999999999999999999999999"])("rejects noncanonical chapter binding %s", async ref => {
  expect(await denied(() => studyCacheBinding(ref))).toBe(true);
});

test.each([
  ["unknown envelope property", (entry: any) => { entry.sessionId = "synthetic forbidden"; }],
  ["unknown payload property", (entry: any) => { entry.payload.raw = {}; }],
  ["unknown verse property", (entry: any) => { entry.payload.verses[0].tenantId = "synthetic forbidden"; }],
  ["unknown segment property", (entry: any) => { entry.payload.verses[0].hebrew.segments[0].html = "forbidden"; }],
  ["unknown provenance property", (entry: any) => { entry.payload.editions[0].diagnostic = "forbidden"; }],
  ["wrong parser namespace", (entry: any) => { entry.binding.parserVersion = "other"; }],
  ["wrong policy namespace", (entry: any) => { entry.binding.policyVersion = "other"; }],
  ["wrong version title", (entry: any) => { entry.binding.translationEdition = "other"; }],
  ["changed book binding", (entry: any) => { entry.binding.chapter = 2; }],
  ["wrong canonical ref", (entry: any) => { entry.payload.verses[0].ref = "Genesis 2:1"; }],
  ["missing verse", (entry: any) => { entry.payload.verses.pop(); }],
  ["reordered verses", (entry: any) => { entry.payload.verses.reverse(); }],
  ["inconsistent written projection", (entry: any) => { entry.payload.verses[0].hebrew.text = "אב"; }],
  ["inconsistent reading projection", (entry: any) => { entry.payload.verses[0].hebrew.readingText = "אב"; }],
  ["inconsistent paragraph projection", (entry: any) => { entry.payload.verses[0].hebrew.paragraphAfter = null; }],
  ["unknown segment kind", (entry: any) => { entry.payload.verses[0].hebrew.segments[0].kind = "html"; }],
  ["empty read alternative", (entry: any) => { entry.payload.verses[0].hebrew.segments[1].read = ""; }],
  ["unreviewed license", (entry: any) => { entry.payload.editions[0].license = "MIT"; }],
  ["executable provenance link", (entry: any) => { entry.payload.editions[0].sourceUrl = "javascript:void(0)"; }],
  ["reordered editions", (entry: any) => { entry.payload.editions.reverse(); }],
  ["English without edition", (entry: any) => { entry.payload.editions.pop(); }],
  ["empty English rather than null", (entry: any) => { entry.payload.verses[0].english = ""; }],
  ["direction override", (entry: any) => { entry.payload.verses[0].english += "\u202E"; }],
  ["non-normalized English", (entry: any) => { entry.payload.verses[0].english = "Synthetic  example"; }],
  ["malformed Unicode", (entry: any) => { entry.payload.verses[0].english = "\uD800"; }],
  ["oversized string", (entry: any) => { entry.payload.verses[0].english = "x".repeat(65537); }],
  ["oversized chapter", (entry: any) => { entry.payload.verses.forEach((verse: any) => { verse.english = "x".repeat(18000); }); }],
  ["invalid hash shape", (entry: any) => { entry.hash = "invalid"; }],
  ["wrong hash", (entry: any) => { entry.hash = "0".repeat(64); }],
  ["fractional timestamp", (entry: any) => { entry.fetchedAt += 0.5; entry.expiresAt += 0.5; }],
  ["negative timestamp", (entry: any) => { entry.fetchedAt = -1; entry.expiresAt = STUDY_CACHE_TTL_MS - 1; }],
  ["future timestamp", (entry: any) => { entry.fetchedAt += 1; entry.expiresAt += 1; }],
  ["wrong TTL", (entry: any) => { entry.expiresAt += 1; }],
  ["infinite expiry", (entry: any) => { entry.expiresAt = Infinity; }],
] as const)("denies %s even when a poisoned payload is rehashed", async (_name, mutate) => {
  const entry: any = clone(); mutate(entry);
  if (!_name.includes("hash")) entry.hash = studyChapterHash(entry.payload);
  expect(await denied(() => validateStudyCacheEntry(binding, entry, time))).toBe(true);
});

let client: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
beforeAll(async () => {
  client = await migratedPglite(); db = drizzle(client, { schema });
});
afterAll(async () => { await client?.close(); });

test("persistent roundtrip survives jsonb key ordering, expires exactly, and refreshes the same row", async () => {
  let now = time;
  const cache = createPersistentStudyCache(db, { now: () => now });
  expect(await cache.get(binding)).toBeNull();
  await cache.set(binding, synthetic());
  expect(await cache.get(binding)).toEqual(synthetic());
  now += STUDY_CACHE_TTL_MS - 1;
  expect((await cache.get(binding))?.hash).toBe(synthetic().hash);
  now += 1;
  expect(await cache.get(binding)).toBeNull();
  expect(await denied(() => cache.set(binding, synthetic()))).toBe(true);
  const refreshed = { ...synthetic(), fetchedAt: now, expiresAt: now + STUDY_CACHE_TTL_MS };
  await cache.set(binding, refreshed);
  expect((await cache.get(binding))?.fetchedAt).toBe(now);
  expect((await db.select().from(schema.sefariaTextCache)).length).toBe(1);
  expect(await denied(() => cache.set(binding, { ...refreshed, binding: studyCacheBinding("Genesis 2") }))).toBe(true);
});

test("corrupt persisted envelopes fail closed, including expired rows and matching corrupt hashes", async () => {
  const cache = createPersistentStudyCache(db, { now: () => time });
  await cache.set(binding, synthetic());
  const corrupt: any = clone().payload;
  corrupt.verses[0].hebrew.readingText = "אב";
  await db.update(schema.sefariaTextCache).set({ payload: corrupt, contentHash: studyChapterHash(corrupt) });
  expect(await denied(() => cache.get(binding))).toBe(true);
  expect(await denied(() => createPersistentStudyCache(db, { now: () => time + STUDY_CACHE_TTL_MS }).get(binding))).toBe(true);
  await cache.set(binding, synthetic());
  await db.update(schema.sefariaTextCache).set({ contentHash: "0".repeat(64) });
  expect(await denied(() => cache.get(binding))).toBe(true);
  await cache.set(binding, synthetic(false));
  expect((await cache.get(binding))?.payload.verses.every(verse => verse.english === null)).toBe(true);
  await db.delete(schema.sefariaTextCache).where(eq(schema.sefariaTextCache.book, binding.book));
});

test("database failures and malformed keys are reduced to fixed cache errors", async () => {
  const broken = createPersistentStudyCache({ select() { throw new Error("synthetic private diagnostic"); },
    insert() { throw new Error("synthetic private diagnostic"); } } as any, { now: () => time });
  expect(await denied(() => broken.get(binding))).toBe(true);
  expect(await denied(() => broken.set(binding, synthetic()))).toBe(true);
  expect(await denied(() => broken.get({ ...binding, provider: "other" } as any))).toBe(true);
});

test("reads use completion time for expiry and concurrent fresh writes and reject invalid clocks on misses", async () => {
  let now = time + STUDY_CACHE_TTL_MS - 1;
  let fetchedAt = time;
  const delayedDb = { select: () => ({ from: () => ({ where: async () => {
    now += 1;
    const value = synthetic();
    return [{ ...binding, payload: value.payload, contentHash: value.hash,
      fetchedAt: new Date(fetchedAt), expiresAt: new Date(fetchedAt + STUDY_CACHE_TTL_MS) }];
  } }) }) } as any;
  const cache = createPersistentStudyCache(delayedDb, { now: () => now });
  expect(await cache.get(binding)).toBeNull();
  now = time - 1; fetchedAt = time;
  expect((await cache.get(binding))?.fetchedAt).toBe(time);
  const emptyDb = { select: () => ({ from: () => ({ where: async () => [] }) }) } as any;
  const invalid = createPersistentStudyCache(emptyDb, { now: () => undefined as any });
  expect(await denied(() => invalid.get(binding))).toBe(true);
  expect(await denied(() => invalid.set(binding, synthetic()))).toBe(true);
});
