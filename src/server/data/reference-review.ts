import "server-only";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { AccessTransaction, Actor } from "../access/types";
import { referenceReviewBatch as b, referenceReviewDecision as d } from "../db/reference-review-schema";
import { parseReviewManifest, reviewNeed, reviewUuid, reviewUserId, type DecisionWrite, type ReviewEntry } from "../reference-review/batch-contract";

export type ReviewBatchRow = typeof b.$inferSelect;
export type ReviewDecisionRow = typeof d.$inferSelect;
export async function batches<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, actor: Actor) {
  return tx.select().from(b).where(and(eq(b.tenantId, actor.tenantId), eq(b.reviewerUserId, actor.userId), isNull(b.revokedAt), gt(b.expiresAt, new Date()))).orderBy(desc(b.createdAt), desc(b.id)).limit(25);
}
export async function lockBatch<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, actor: Actor, id: string, write = false) {
  const [row] = await tx.select().from(b).where(and(eq(b.tenantId, actor.tenantId), eq(b.id, id), eq(b.reviewerUserId, actor.userId))).for(write ? "update" : "share");
  return row ?? null;
}
export async function decisions<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, actor: Actor, batchId: string, generation: number) {
  return tx.select().from(d).where(and(eq(d.tenantId, actor.tenantId), eq(d.batchId, batchId), eq(d.generation, generation))).orderBy(desc(d.revision));
}
export async function requestDecision<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, actor: Actor, batchId: string, requestId: string) {
  const [row] = await tx.select().from(d).where(and(eq(d.tenantId, actor.tenantId), eq(d.batchId, batchId), eq(d.requestId, requestId))); return row ?? null;
}
export async function insertDecision<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, actor: Actor, batch: ReviewBatchRow, entry: ReviewEntry, write: DecisionWrite, requestSha256: string) {
  const [row] = await tx.insert(d).values({ tenantId: actor.tenantId, batchId: batch.id, requestId: write.requestId, generation: batch.generation, revision: write.expectedRevision + 1,
    manifestSha256: batch.manifestSha256, catalogSha256: batch.catalogSha256, assetKey: entry.assetKey, identitySha256: entry.identitySha256, targetSha256: entry.targetSha256,
    textSha256: entry.textSha256, playbackSha256: entry.playback.sha256, playbackBytes: entry.playback.bytes, requestSha256, checks: write.checks,
    actorUserId: actor.userId, actorMembershipId: actor.membershipId, actorSessionId: actor.authSessionId, roleGrantId: actor.roleGrantId,
    authorityRevision: actor.authorityRevision, roleGrantRevision: actor.roleGrantRevision }).returning(); return row;
}
export async function revokeBatch<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, actor: Actor, row: ReviewBatchRow) {
  const [changed] = await tx.update(b).set({ generation: row.generation + 1, revokedAt: new Date() }).where(and(eq(b.tenantId, actor.tenantId), eq(b.id, row.id), eq(b.generation, row.generation), isNull(b.revokedAt))).returning(); return changed;
}
/** Internal admission seam, never exposed by HTTP. The operator must verify upload
 * readback separately; no receipt supplied by a browser can call this helper. */
export async function admitReviewBatch<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, input: {
  tenantId: "crc"; id: string; reviewerUserId: string; manifestBytes: Uint8Array; manifestSha256: string; expiresAt: Date;
}) {
  reviewNeed(input.tenantId === "crc" && reviewUuid(input.id) && reviewUserId(input.reviewerUserId) && input.expiresAt instanceof Date && input.expiresAt.getTime() > Date.now() && input.expiresAt.getTime() <= Date.now() + 7 * 86400000);
  const manifest = parseReviewManifest(input.manifestBytes, input.manifestSha256);
  const [row] = await tx.insert(b).values({ tenantId: input.tenantId, id: input.id, reviewerUserId: input.reviewerUserId, manifestSha256: input.manifestSha256, catalogSha256: manifest.catalogSha256,
    entryCount: manifest.entries.length, expiresAt: input.expiresAt }).returning(); return row;
}
