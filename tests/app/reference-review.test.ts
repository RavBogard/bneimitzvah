import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { accessFixture } from "./access-fixture";
import * as s from "../../src/server/db/index";

// The Finkel listening-review page and its code were removed (Daniel 2026-11-16); the reference_review tables stay,
// so their native guards (RLS, append-only decisions, immutable batches, no runtime admission) stay tested here.
const fixtures: Awaited<ReturnType<typeof accessFixture>>[] = [];
afterEach(async () => { for (const f of fixtures.splice(0)) await f.client.close(); });
const CHECKS = ["privacy", "listening", "exactText", "musicalAccuracy", "rights"] as const;
const hex = (c: string) => c.repeat(64);

test("migration enforces append-only decisions, immutable binding controls, no runtime admission and strict checklist values", async () => {
  const f = await accessFixture(); fixtures.push(f);
  const batchId = randomUUID(), admin = f.identities.admin;
  const [member] = await f.owner(() => f.db.select().from(s.membership).where(eq(s.membership.userId, admin.id)));
  await f.owner(() => f.db.insert(s.referenceReviewBatch).values({ tenantId: "crc", id: batchId, manifestSha256: hex("a"), catalogSha256: hex("b"), reviewerUserId: admin.id, entryCount: 1, expiresAt: new Date(Date.now() + 3600000) }));
  await f.owner(() => f.db.insert(s.referenceReviewDecision).values({ tenantId: "crc", batchId, requestId: randomUUID(), assetKey: "fj_" + "0".repeat(20), generation: 1, revision: 1,
    manifestSha256: hex("a"), catalogSha256: hex("b"), identitySha256: hex("c"), targetSha256: hex("d"), textSha256: hex("e"), playbackSha256: hex("f"), playbackBytes: 1024, requestSha256: hex("1"),
    checks: { privacy: "pass", listening: "pass", exactText: "pass", musicalAccuracy: "pass", rights: "hold" }, actorUserId: admin.id, actorMembershipId: member.id, actorSessionId: admin.sessionId,
    roleGrantId: randomUUID(), authorityRevision: 1, roleGrantRevision: 1 }));
  await expect(f.owner(() => f.db.update(s.referenceReviewDecision).set({ revision: 3 }))).rejects.toThrow();
  await expect(f.owner(() => f.db.delete(s.referenceReviewDecision))).rejects.toThrow();
  await expect(f.owner(() => f.db.update(s.referenceReviewBatch).set({ manifestSha256: hex("b") }))).rejects.toThrow();
  await expect(f.db.insert(s.referenceReviewBatch).values({ tenantId: "crc", id: randomUUID(), manifestSha256: hex("a"), catalogSha256: hex("b"), reviewerUserId: admin.id, entryCount: 1, expiresAt: new Date(Date.now() + 60000) })).rejects.toThrow();
  const [row] = await f.owner(() => f.db.select().from(s.referenceReviewDecision));
  for (const key of CHECKS) await expect(f.owner(() => f.db.insert(s.referenceReviewDecision).values({ ...row, requestId: randomUUID(), revision: 2, checks: { ...row.checks, [key]: null } as never }))).rejects.toThrow();
  const flags = await f.owner(() => f.db.execute(sql`select relname, relrowsecurity, relforcerowsecurity from pg_class where relname in ('reference_review_batch','reference_review_decision')`));
  expect(flags.rows).toHaveLength(2); expect(flags.rows.every(row => row.relrowsecurity === true && row.relforcerowsecurity === true)).toBe(true);
});
