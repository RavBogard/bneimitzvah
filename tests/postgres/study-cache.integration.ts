import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import * as schema from "../../src/server/db/index";
import { createPersistentStudyCache } from "../../src/server/data/study-cache";
import { createStudyCacheEntry, studyCacheBinding, studyChapterHash, STUDY_CACHE_TTL_MS,
  StudyCacheUnavailable } from "../../src/server/study/cache";
import { normalizeHebrew } from "../../src/server/study/normalize";
import { MAM, JPS2023 } from "../../src/server/study/versions";
import { disposableConfig, query } from "./disposable.mjs";

const { Client } = createRequire(import.meta.url)("pg");
const binding = studyCacheBinding("Genesis 1"), time = 1_700_000_000_000;
function entry() {
  const payload = { verses: Array.from({ length: 31 }, (_, i) => ({ ref: `Genesis 1:${i + 1}`,
    hebrew: normalizeHebrew("אב גד"), english: i === 0 ? null : `Synthetic example ${i + 1}` })), editions: [MAM, JPS2023] };
  return createStudyCacheEntry(binding, { ...payload, fetchedAt: time, hash: studyChapterHash(payload) });
}
let anchor: InstanceType<typeof Client>, owner: InstanceType<typeof Client>, runtime: InstanceType<typeof Client>;
let ownerDb: ReturnType<typeof drizzle<typeof schema>>, runtimeDb: ReturnType<typeof drizzle<typeof schema>>;
const suffix = randomBytes(8).toString("hex"), database = `study_cache_${suffix}`, login = `study_cache_login_${suffix}`;
let createdDatabase = false, createdRole = false;
beforeAll(async () => {
  try {
    const config = disposableConfig(), password = randomBytes(32).toString("hex");
    anchor = new Client(config); await anchor.connect();
    await query(anchor, `CREATE DATABASE "${database}"`); createdDatabase = true;
    owner = new Client({ ...config, database }); await owner.connect();
    ownerDb = drizzle(owner, { schema, logger: false });
    await migrate(ownerDb, { migrationsFolder: "src/server/db/migrations" });
    await migrate(ownerDb, { migrationsFolder: "src/server/db/migrations" });
    await query(owner, `CREATE ROLE "${login}" LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${password}'`);
    createdRole = true;
    await query(owner, `GRANT portal_runtime TO "${login}"`);
    runtime = new Client({ ...config, database, user: login, password }); await runtime.connect();
    runtimeDb = drizzle(runtime, { schema, logger: false });
  } catch { throw new Error("Disposable study cache fixture setup failed; details withheld"); }
});
afterAll(async () => {
  await runtime?.end().catch(() => {}); await owner?.end().catch(() => {});
  try {
    if (createdDatabase) await query(anchor, `DROP DATABASE "${database}"`);
    if (createdRole) await query(anchor, `DROP ROLE "${login}"`);
  } finally { await anchor?.end(); }
});
async function denied(operation: () => unknown | PromiseLike<unknown>, code: string) {
  try { await operation(); return false; }
  catch (error) {
    const value = error as { code?: string; cause?: { code?: string } };
    return (value.cause?.code ?? value.code) === code;
  }
}
async function cacheDenied(operation: () => Promise<unknown>) {
  try { await operation(); return false; }
  catch (error) { return error instanceof StudyCacheUnavailable && !("cause" in error); }
}

test("restricted real PostgreSQL login can read/upsert public chapters with no delete or key-update authority", async () => {
  const privileges = (await query(runtime, `SELECT
    has_table_privilege(current_user,'sefaria_text_cache','SELECT') AS read,
    has_table_privilege(current_user,'sefaria_text_cache','INSERT') AS insert,
    has_column_privilege(current_user,'sefaria_text_cache','payload','UPDATE') AS update_content,
    has_column_privilege(current_user,'sefaria_text_cache','book','UPDATE') AS update_key,
    has_table_privilege(current_user,'sefaria_text_cache','DELETE') AS delete,
    has_table_privilege(current_user,'sefaria_text_cache','TRUNCATE') AS truncate,
    (SELECT coalesce(bool_or(privilege_type = 'SELECT'),false) FROM aclexplode(
      (SELECT relacl FROM pg_class WHERE oid='sefaria_text_cache'::regclass)) WHERE grantee=0) AS public_read,
    (SELECT rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole OR rolreplication FROM pg_roles WHERE rolname=current_user) AS elevated`)).rows[0];
  expect(privileges).toEqual({ read: true, insert: true, update_content: true, update_key: false,
    delete: false, truncate: false, public_read: false, elevated: false });
  const cache = createPersistentStudyCache(runtimeDb, { now: () => time });
  await cache.set(binding, entry()); await cache.set(binding, entry());
  expect((await cache.get(binding))?.hash === entry().hash).toBe(true);
  expect((await runtimeDb.select().from(schema.sefariaTextCache)).length).toBe(1);
  expect(await denied(() => query(runtime, "DELETE FROM sefaria_text_cache"), "42501")).toBe(true);
  expect(await denied(() => query(runtime, "TRUNCATE sefaria_text_cache"), "42501")).toBe(true);
  expect(await denied(() => query(runtime, "UPDATE sefaria_text_cache SET chapter=2"), "42501")).toBe(true);
  // Public cache access needs no tenant scope and does not bypass tenant RLS.
  const tenantPolicy = (await query(runtime, "SELECT relrowsecurity AND relforcerowsecurity AS forced FROM pg_class WHERE relname='student'")).rows[0];
  expect(tenantPolicy.forced).toBe(true);
  expect((await query(runtime, "SELECT count(*)::integer AS count FROM tenant")).rows[0].count).toBe(0);
});

test("real database constraints bound namespace, chapter, shape, size, hashes and exact TTL", async () => {
  const value = entry();
  const row = { ...binding, payload: value.payload, contentHash: value.hash,
    fetchedAt: new Date(time), expiresAt: new Date(time + STUDY_CACHE_TTL_MS) };
  for (const change of [
    { provider: "other" }, { apiVersion: "v4" }, { parserVersion: "other" }, { policyVersion: "other" },
    { hebrewEdition: "other" }, { hebrewLanguage: "en" }, { translationEdition: "other" }, { translationLanguage: "he" },
    { book: "Unknown" }, { chapter: 0 }, { chapter: 51 }, { book: "genesis" },
    { payload: { ...value.payload, raw: {} } }, { payload: { editions: value.payload.editions } },
    { payload: { verses: [], editions: value.payload.editions } },
    { payload: { verses: value.payload.verses, editions: [] } },
    { payload: { verses: Array(177).fill(value.payload.verses[0]), editions: value.payload.editions } },
    { payload: { verses: [{ ...value.payload.verses[0], english: "x".repeat(525000) }], editions: value.payload.editions } },
    { contentHash: "0".repeat(63) }, { expiresAt: new Date(time + STUDY_CACHE_TTL_MS + 1) },
    { fetchedAt: new Date(-1), expiresAt: new Date(STUDY_CACHE_TTL_MS - 1) },
  ]) {
    expect(await denied(() => runtimeDb.insert(schema.sefariaTextCache).values({ ...row, ...change } as typeof row), "23514")).toBe(true);
  }
  expect(await denied(() => query(runtime, "UPDATE sefaria_text_cache SET fetched_at='infinity',expires_at='infinity'"), "23514")).toBe(true);
  expect(await denied(() => query(runtime, "UPDATE sefaria_text_cache SET fetched_at=TIMESTAMPTZ '2023-01-01 00:00:00.000001Z',expires_at=TIMESTAMPTZ '2023-01-02 00:00:00.000001Z'"), "23514")).toBe(true);
});

test("real persisted poison is denied despite a recomputed hash, and expiry never returns stale content", async () => {
  const cache = createPersistentStudyCache(runtimeDb, { now: () => time });
  await cache.set(binding, entry());
  expect(await createPersistentStudyCache(runtimeDb, { now: () => time + STUDY_CACHE_TTL_MS }).get(binding)).toBeNull();
  const payload: any = structuredClone(entry().payload);
  payload.verses[0].hebrew.text = "אב";
  await ownerDb.update(schema.sefariaTextCache).set({ payload, contentHash: studyChapterHash(payload) });
  expect(await cacheDenied(() => cache.get(binding))).toBe(true);
  await cache.set(binding, entry());
  await ownerDb.update(schema.sefariaTextCache).set({ contentHash: "0".repeat(64) });
  expect(await cacheDenied(() => cache.get(binding))).toBe(true);
  await cache.set(binding, entry());
  await ownerDb.update(schema.sefariaTextCache).set({ fetchedAt: new Date(time + 1), expiresAt: new Date(time + STUDY_CACHE_TTL_MS + 1) });
  expect(await cacheDenied(() => cache.get(binding))).toBe(true);
});

test("operator can clean expired rows in a bounded batch and rollback/reapply only the public cache table", async () => {
  // Unique fixture database only. Existing migration convention is additive SQL;
  // no application down-migrator is introduced. Recreate this disposable table
  // from the exact migration, leaving migration history/tenant tables untouched.
  await ownerDb.update(schema.sefariaTextCache).set({ fetchedAt: new Date(time), expiresAt: new Date(time + STUDY_CACHE_TTL_MS) });
  const cleaned = await query(owner, `WITH expired AS (
    SELECT ctid FROM sefaria_text_cache WHERE expires_at <= $1 ORDER BY expires_at LIMIT 100
    FOR UPDATE SKIP LOCKED
  ) DELETE FROM sefaria_text_cache WHERE ctid IN (SELECT ctid FROM expired) RETURNING 1`, [new Date(time + STUDY_CACHE_TTL_MS)]);
  expect(cleaned.rows.length).toBe(1);
  const { readFile } = await import("node:fs/promises");
  const migration = await readFile("src/server/db/migrations/0009_sefaria_text_cache.sql", "utf8");
  await query(owner, "DROP TABLE sefaria_text_cache");
  for (const statement of migration.split("--> statement-breakpoint")) if (statement.trim()) await query(owner, statement);
  await createPersistentStudyCache(runtimeDb, { now: () => time }).set(binding, entry());
  expect((await runtimeDb.select().from(schema.sefariaTextCache)).length).toBe(1);
  expect((await query(owner, "SELECT count(*)::integer AS count FROM tenant")).rows[0].count).toBe(1);
});
