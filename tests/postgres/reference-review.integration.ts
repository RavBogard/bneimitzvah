import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import * as s from "../../src/server/db/index";
import { withTenantTransaction } from "../../src/server/db/runtime";
import { postgresAccessFixture } from "./access-fixture";

// The Finkel listening-review page and its code were removed (Daniel 2026-11-16); the reference_review tables stay,
// so their native guards (tenant RLS, no runtime admission, append-only decisions, immutable manifest) stay tested here.
type Base = Awaited<ReturnType<typeof postgresAccessFixture>>;
const opened: Base[] = [];
afterEach(async () => { for (const f of opened.splice(0)) await f.close(); });
async function sqlState(work: PromiseLike<unknown>) {
  try { await work; return "accepted"; } catch (error) {
    let current = error as { code?: unknown; cause?: unknown } | undefined;
    for (let i = 0; current && i < 4; i++, current = current.cause as typeof current) if (typeof current.code === "string" && /^[A-Z0-9]{5}$/.test(current.code)) return current.code;
    return "unknown";
  }
}
const CHECKS = ["privacy", "listening", "exactText", "musicalAccuracy", "rights"] as const;
const hex = (c: string) => c.repeat(64);

test("native SQL proves RLS, runtime admission refusal, append-only records, immutable manifest and all-five JSON-null rejection", async () => {
  const f = await postgresAccessFixture(); opened.push(f);
  const batchId = randomUUID(), [member] = await f.ownerDb.select().from(s.membership).where(eq(s.membership.userId, f.admin.id));
  await f.ownerDb.insert(s.referenceReviewBatch).values({ tenantId: "crc", id: batchId, manifestSha256: hex("a"), catalogSha256: hex("b"), reviewerUserId: f.admin.id, entryCount: 1, expiresAt: new Date(Date.now() + 3600000) });
  await f.ownerDb.insert(s.referenceReviewDecision).values({ tenantId: "crc", batchId, requestId: randomUUID(), assetKey: "fj_" + "0".repeat(20), generation: 1, revision: 1,
    manifestSha256: hex("a"), catalogSha256: hex("b"), identitySha256: hex("c"), targetSha256: hex("d"), textSha256: hex("e"), playbackSha256: hex("f"), playbackBytes: 1024, requestSha256: hex("1"),
    checks: { privacy: "pass", listening: "pass", exactText: "pass", musicalAccuracy: "pass", rights: "hold" }, actorUserId: f.admin.id, actorMembershipId: member.id, actorSessionId: f.admin.sessionId,
    roleGrantId: randomUUID(), authorityRevision: 1, roleGrantRevision: 1 });
  expect(await withTenantTransaction(f.aDb, { tenantId: "crc" }, tx => tx.select().from(s.referenceReviewDecision))).toHaveLength(1);
  expect(await withTenantTransaction(f.aDb, { tenantId: "other" }, tx => tx.select().from(s.referenceReviewBatch))).toEqual([]);
  expect(await withTenantTransaction(f.aDb, { tenantId: "other" }, tx => tx.select().from(s.referenceReviewDecision))).toEqual([]);
  expect(await sqlState(withTenantTransaction(f.aDb, { tenantId: "crc" }, tx => tx.insert(s.referenceReviewBatch).values({ tenantId: "crc", id: randomUUID(), manifestSha256: hex("a"), catalogSha256: hex("b"), reviewerUserId: f.admin.id, entryCount: 1, expiresAt: new Date(Date.now() + 60000) })))).toBe("42501");
  expect(await sqlState(withTenantTransaction(f.aDb, { tenantId: "crc" }, tx => tx.delete(s.referenceReviewDecision)))).toBe("42501");
  expect(await sqlState(f.ownerDb.update(s.referenceReviewDecision).set({ revision: 2 }))).toBe("P0001");
  expect(await sqlState(f.ownerDb.delete(s.referenceReviewDecision))).toBe("P0001");
  expect(await sqlState(f.ownerDb.update(s.referenceReviewBatch).set({ manifestSha256: hex("c") }))).toBe("P0001");
  const [row] = await f.ownerDb.select().from(s.referenceReviewDecision);
  for (const key of CHECKS) expect(await sqlState(f.ownerDb.insert(s.referenceReviewDecision).values({ ...row, requestId: randomUUID(), revision: 2, checks: { ...row.checks, [key]: null } as never }))).toBe("23514");
  await f.ownerDb.update(s.referenceReviewBatch).set({ revokedAt: new Date(), generation: sql`${s.referenceReviewBatch.generation} + 1` }).where(eq(s.referenceReviewBatch.id, batchId));
  expect(await sqlState(f.ownerDb.insert(s.referenceReviewDecision).values({ ...row, requestId: randomUUID(), revision: 2 }))).toBe("P0001");
});
