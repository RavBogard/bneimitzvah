import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { eq } from "drizzle-orm";
import * as s from "../../src/server/db/index";
import { AccessDenied } from "../../src/server/access/errors";
import { createServiceCourseProgressService, serviceCourseOwnerName } from "../../src/server/service-course/progress-service";
import { deferred, postgresAccessFixture, waitForEntry } from "./access-fixture";
import { query } from "./disposable.mjs";
import { withTenantTransaction } from "../../src/server/db/runtime";

// Release 2.0 SC4: the service course's per-member write lock and eligibility share lock on two real PostgreSQL backends,
// on Learn to lein's (course-progress-races.integration.ts).
type Base = Awaited<ReturnType<typeof postgresAccessFixture>>;
const fixtures: Base[] = [];
afterEach(async () => { for (const f of fixtures.splice(0)) await f.close(); });
const safe = (operation: PromiseLike<unknown>) => Promise.resolve(operation).then(value => value, error => ({ denied: error instanceof AccessDenied ? error.status : 503 }));
const doc = (lesson: string, done: string) => ({ schema: "service-course-progress/v1", lessons: { [lesson]: { done } }, cards: {} });

async function fixture() {
  const f = await postgresAccessFixture(); fixtures.push(f);
  const courseA = createServiceCourseProgressService({ access: f.a }), courseB = createServiceCourseProgressService({ access: f.b });
  const mutation = () => { const value = f.request("tutor"); value.headers.set("origin", "http://localhost:3000"); return { ...value, method: "POST" }; };
  const member = (await f.ownerDb.select().from(s.membership).where(eq(s.membership.userId, f.tutor.id)))[0];
  return { ...f, courseA, courseB, mutation, member };
}

test("two devices merging at once: the write lock makes the second merge see the first, so neither device's lessons are lost", async () => {
  const f = await fixture();
  const entered = deferred(), release = deferred();
  const stop = await f.intercept("a", text => text.includes("pg_advisory_xact_lock"), async proceed => { const result = await proceed(); entered.resolve(); await release.promise; return result; });
  const a = safe(f.courseA.merge(f.mutation(), { progress: doc("shma", "2026-10-20T10:00:00.000Z"), owner: serviceCourseOwnerName({ tenantId: "crc", membershipId: f.member.id }) }));
  let b: Promise<unknown> | undefined;
  try {
    await waitForEntry(entered.promise, a);
    b = safe(f.courseB.merge(f.mutation(), { progress: doc("vahavta", "2026-10-21T10:00:00.000Z"), owner: serviceCourseOwnerName({ tenantId: "crc", membershipId: f.member.id }) }));
    await f.waitForLock(f.pidB, f.pidA);
  } finally { release.resolve(); stop(); }
  const results = await Promise.all([a, b!]) as { ok?: boolean; version?: number }[];
  expect(results.map(r => r.version).sort()).toEqual([1, 2]);
  const row = (await query(f.owner, "SELECT progress, version FROM service_course_progress WHERE membership_id=$1", [f.member.id])).rows[0] as { progress: { lessons: Record<string, unknown> }; version: number };
  expect(row.version).toBe(2);
  expect(Object.keys(row.progress.lessons).sort()).toEqual(["shma", "vahavta"]);
});

test("revoking the grant a progress request holds waits for it, and without any live grant the progress is out of reach but kept", async () => {
  const f = await fixture();
  const grants = await f.ownerDb.select().from(s.roleGrant).where(eq(s.roleGrant.membershipId, f.member.id));
  const entered = deferred(), release = deferred();
  const stop = await f.intercept("a", text => text.includes("pg_advisory_xact_lock"), async proceed => { const result = await proceed(); entered.resolve(); await release.promise; return result; });
  const a = safe(f.courseA.merge(f.mutation(), { progress: doc("shma", "2026-10-20T10:00:00.000Z"), owner: serviceCourseOwnerName({ tenantId: "crc", membershipId: f.member.id }) }));
  let revoke: Promise<unknown> | undefined;
  try {
    await waitForEntry(entered.promise, a);
    // The eligibility check share-locked the first live grant by role; its revocation must wait for the request.
    const first = [...grants].filter(grant => !grant.revokedAt).sort((x, y) => x.role.localeCompare(y.role) || x.id.localeCompare(y.id))[0];
    revoke = withTenantTransaction(f.bDb, { tenantId: "crc" }, tx => tx.update(s.roleGrant).set({ revokedAt: new Date() }).where(eq(s.roleGrant.id, first.id)));
    await f.waitForLock(f.pidB, f.pidA);
  } finally { release.resolve(); stop(); }
  expect(await a).toMatchObject({ ok: true, version: 1 });
  await revoke;
  await query(f.owner, "UPDATE role_grant SET revoked_at = now() WHERE membership_id = $1 AND revoked_at IS NULL", [f.member.id]);
  expect(await safe(f.courseB.get(f.request("tutor")))).toEqual({ denied: 403 });
  expect((await query(f.owner, "SELECT count(*)::int AS n FROM service_course_progress WHERE membership_id=$1", [f.member.id])).rows[0].n).toBe(1);
});
