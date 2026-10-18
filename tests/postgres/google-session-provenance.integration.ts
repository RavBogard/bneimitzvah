import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { eq } from "drizzle-orm";
import { session } from "../../src/server/db/auth-schema";
import { postgresAccessFixture } from "./access-fixture";
import { query } from "./disposable.mjs";

type Fixture = Awaited<ReturnType<typeof postgresAccessFixture>>;
const opened: Fixture[] = [];
afterEach(async () => { for (const f of opened.splice(0)) await f.close(); });
async function fixture() { const f = await postgresAccessFixture(); opened.push(f); return f; }
async function immutable(action: () => PromiseLike<unknown>) {
  try { await action(); return false; } catch (error) { const e = error as { code?: string; cause?: { code?: string } }; return (e.cause?.code ?? e.code) === "23514"; }
}

// The unchanged disposable loopback CI harness owns the database and restricted
// LOGIN pools. These tests do not select or start a database themselves.
test("native migration leaves ordinary sessions null and rejects retrospective Google promotion", async () => {
  const f = await fixture();
  // Apply the exact new SQL to an isolated old-shape table containing a row,
  // independently of the fixture's fresh full-ledger migration path.
  await query(f.owner, "CREATE SCHEMA synthetic_provenance_migration; CREATE TABLE synthetic_provenance_migration.session (id text PRIMARY KEY); INSERT INTO synthetic_provenance_migration.session VALUES ('synthetic-existing'); SET search_path TO synthetic_provenance_migration, public");
  try {
    await query(f.owner, readFileSync("src/server/db/migrations/0024_auth_session_google_provenance.sql", "utf8"));
    const oldRows = await query(f.owner, "SELECT google_authenticated_at IS NULL AS unmarked FROM session");
    expect(oldRows.rows.length === 1 && oldRows.rows[0].unmarked === true).toBe(true);
  } finally { await query(f.owner, "SET search_path TO public"); }
  const [existing] = await f.aDb.select().from(session).where(eq(session.id, f.admin.sessionId));
  expect(existing.googleAuthenticatedAt === null).toBe(true);
  expect(await immutable(() => f.aDb.update(session).set({ googleAuthenticatedAt: new Date() }).where(eq(session.id, existing.id)))).toBe(true);
  await f.aDb.update(session).set({ userAgent: "synthetic-normal-update", expiresAt: new Date(Date.now() + 60_000) }).where(eq(session.id, existing.id));
  expect((await f.bDb.select().from(session).where(eq(session.id, existing.id)))[0].googleAuthenticatedAt === null).toBe(true);
});

test("native restricted INSERT stamps atomically while marker mutation is immutable and recreation remains null", async () => {
  const f = await fixture(), stamp = new Date();
  const [marked] = await f.aDb.insert(session).values({ id: randomUUID(), token: randomUUID(), userId: f.admin.id,
    expiresAt: new Date(Date.now() + 60_000), updatedAt: new Date(), googleAuthenticatedAt: stamp }).returning();
  expect(marked.googleAuthenticatedAt?.getTime() === stamp.getTime()).toBe(true);
  for (const googleAuthenticatedAt of [null, new Date(stamp.getTime() + 1000)]) {
    expect(await immutable(() => f.aDb.update(session).set({ googleAuthenticatedAt }).where(eq(session.id, marked.id)))).toBe(true);
  }
  await f.aDb.update(session).set({ googleAuthenticatedAt: stamp, userAgent: "synthetic-same-marker" }).where(eq(session.id, marked.id));
  await f.aDb.delete(session).where(eq(session.id, marked.id));
  const [recreated] = await f.aDb.insert(session).values({ id: randomUUID(), token: randomUUID(), userId: f.admin.id,
    expiresAt: new Date(Date.now() + 60_000), updatedAt: new Date() }).returning();
  expect(recreated.googleAuthenticatedAt === null).toBe(true);
});

test("native rollback leaves no partially inserted marked session", async () => {
  const f = await fixture(), id = randomUUID();
  let refused = false;
  try {
    await f.aDb.transaction(async tx => {
      await tx.insert(session).values({ id, token: randomUUID(), userId: f.admin.id,
        expiresAt: new Date(Date.now() + 60_000), updatedAt: new Date(), googleAuthenticatedAt: new Date() });
      throw new Error("Synthetic rollback requested");
    });
  } catch (error) { refused = error instanceof Error && error.message === "Synthetic rollback requested"; }
  expect(refused && (await f.bDb.select({ id: session.id }).from(session).where(eq(session.id, id))).length === 0).toBe(true);
});
