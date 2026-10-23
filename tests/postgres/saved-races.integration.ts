import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { eq } from "drizzle-orm";
import * as s from "../../src/server/db/index";
import { AccessDenied } from "../../src/server/access/errors";
import { createSavedService } from "../../src/server/saved/service";
import { deferred, postgresAccessFixture, waitForEntry } from "./access-fixture";
import { query } from "./disposable.mjs";
import { withTenantTransaction } from "../../src/server/db/runtime";

// The saved layer's per-member write lock and eligibility share lock on two real PostgreSQL backends.
type Base = Awaited<ReturnType<typeof postgresAccessFixture>>;
const fixtures: Base[] = [];
afterEach(async () => { for (const f of fixtures.splice(0)) await f.close(); });
const safe = (operation: PromiseLike<unknown>) => Promise.resolve(operation).then(value => value, error => ({ denied: error instanceof AccessDenied ? error.status : 503 }));

async function fixture() {
  const f = await postgresAccessFixture(); fixtures.push(f);
  const savedA = createSavedService({ access: f.a }), savedB = createSavedService({ access: f.b });
  const mutation = (who: "admin" | "tutor" = "tutor") => { const value = f.request(who); value.headers.set("origin", "http://localhost:3000"); return { ...value, method: "POST" }; };
  const member = (await f.ownerDb.select().from(s.membership).where(eq(s.membership.userId, f.tutor.id)))[0];
  return { ...f, savedA, savedB, mutation, member };
}
const body = (name: string) => ({ name, date: null, kind: "torah", ranges: "Genesis 1:1-3" });

test("two backends creating the member's 100th reading at once: the write lock makes exactly one succeed", async () => {
  const f = await fixture();
  await query(f.owner, "INSERT INTO saved_reading (tenant_id,membership_id,user_id,name,kind,ranges,verse_count) SELECT 'crc',$1,$2,'Seed '||g,'torah','Genesis 1:1',1 FROM generate_series(1,99) g", [f.member.id, f.tutor.id]);
  const entered = deferred(), release = deferred();
  const stop = await f.intercept("a", text => text.includes("pg_advisory_xact_lock"), async proceed => { const result = await proceed(); entered.resolve(); await release.promise; return result; });
  const a = safe(f.savedA.create(f.mutation(), body("From A")));
  let b: Promise<unknown> | undefined;
  try {
    await waitForEntry(entered.promise, a);
    b = safe(f.savedB.create(f.mutation(), body("From B")));
    await f.waitForLock(f.pidB, f.pidA);
  } finally { release.resolve(); stop(); }
  const results = await Promise.all([a, b!]) as { ok?: boolean; code?: string }[];
  expect(results.map(r => r.ok ? "ok" : r.code).sort()).toEqual(["limit", "ok"]);
  expect((await query(f.owner, "SELECT count(*)::int AS n FROM saved_reading WHERE membership_id=$1", [f.member.id])).rows[0].n).toBe(100);
});

test("revoking the grant a saved request holds waits for that request, and the member's access follows the remaining grants", async () => {
  const f = await fixture();
  const grants = await f.ownerDb.select().from(s.roleGrant).where(eq(s.roleGrant.membershipId, f.member.id));
  const parent = grants.find(grant => grant.role === "parent")!, tutor = grants.find(grant => grant.role === "tutor")!;
  const entered = deferred(), release = deferred();
  const stop = await f.intercept("a", text => text.includes("pg_advisory_xact_lock"), async proceed => { const result = await proceed(); entered.resolve(); await release.promise; return result; });
  const a = safe(f.savedA.create(f.mutation(), body("Before revoke")));
  let revoke: Promise<unknown> | undefined;
  try {
    await waitForEntry(entered.promise, a);
    // The eligibility check share-locked the first eligible grant (parent sorts before tutor); its revocation must wait.
    // Revoked on the second runtime backend, as the relationships service would, so the owner connection stays free to observe the lock edge.
    revoke = withTenantTransaction(f.bDb, { tenantId: "crc" }, tx => tx.update(s.roleGrant).set({ revokedAt: new Date() }).where(eq(s.roleGrant.id, parent.id)));
    await f.waitForLock(f.pidB, f.pidA);
  } finally { release.resolve(); stop(); }
  expect(await a).toMatchObject({ ok: true });
  await revoke;
  // Still a tutor: the saved layer remains. Without either grant it is gone, rows kept.
  expect(await safe(f.savedB.list(f.request("tutor")))).toMatchObject({ ok: true, readings: [{ name: "Before revoke" }] });
  await query(f.owner, "UPDATE role_grant SET revoked_at = now() WHERE id = $1", [tutor.id]);
  expect(await safe(f.savedB.list(f.request("tutor")))).toEqual({ denied: 403 });
  expect((await query(f.owner, "SELECT count(*)::int AS n FROM saved_reading WHERE membership_id=$1", [f.member.id])).rows[0].n).toBe(1);
});
