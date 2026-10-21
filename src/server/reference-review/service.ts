import "server-only";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { createAccessService } from "../access/service";
import type { AccessRequest, AccessTransaction, Actor, LockIntent } from "../access/types";
import { AccessDenied } from "../access/errors";
import { lockRoleGrant } from "../data/authority";
import * as data from "../data/reference-review";
import type { ReferenceCatalogGet } from "../reference-audio/storage";
import { loadReviewAudio, loadReviewManifest } from "./batch-storage";
import { REVIEW_CHECKS, ReviewUnavailable, parseDecisionWrite, reviewAsset, reviewDigest, reviewHash, reviewNeed, reviewUuid, reviewUserId, reviewRecord, type ReviewerConfig, type ReviewManifest } from "./batch-contract";
import { bindReviewResult } from "./response-barrier";

type ReviewRequest = AccessRequest & { method?: string; signal?: AbortSignal };
const conflict = () => Object.freeze({ ok: false as const, error: "conflict" as const });
function publicBatch(row: data.ReviewBatchRow) {
  return Object.freeze({ id: row.id, manifestSha256: row.manifestSha256, catalogSha256: row.catalogSha256, generation: row.generation,
    entryCount: row.entryCount, expiresAt: row.expiresAt.toISOString(), studentReady: false as const, timing: "unavailable" as const });
}
function publicDecision(row: data.ReviewDecisionRow | undefined | null) {
  return row ? Object.freeze({ revision: row.revision, requestId: row.requestId, checks: row.checks, createdAt: row.createdAt.toISOString(),
    wholeClipAccepted: REVIEW_CHECKS.every(key => row.checks[key] === "pass"), studentReady: false as const, timing: "unavailable" as const }) : null;
}
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export function createReferenceReviewService<Q extends PgQueryResultHKT>(input: {
  access: Pick<ReturnType<typeof createAccessService<Q>>, "withVerifiedIdentity">;
  reviewer: ReviewerConfig | undefined; get: ReferenceCatalogGet;
}) {
  const reviewer = input.reviewer ? Object.freeze({ ...input.reviewer }) : undefined;
  if (reviewer && (reviewer.tenantId !== "crc" || !reviewUserId(reviewer.userId))) throw new ReviewUnavailable();
  const connected = (request: ReviewRequest) => { if (request.signal?.aborted) throw new ReviewUnavailable(); };
  const live = (request: ReviewRequest, actor: Actor) => { connected(request); if (actor.authSessionExpiresAt <= Date.now()) throw new AccessDenied(401); };
  async function authorized<T>(request: ReviewRequest, mutation: boolean, action: (tx: AccessTransaction<Q>, actor: Actor) => Promise<T>) {
    if (!reviewer) throw new ReviewUnavailable();
    const intent: LockIntent = mutation ? "data-write" : "read";
    connected(request);
    const barrier: { actor?: Actor } = {};
    const result = await input.access.withVerifiedIdentity(request, { intent, mutation, fresh: mutation }, async (tx, identity) => {
      if (identity.tenantId !== reviewer!.tenantId || identity.userId !== reviewer!.userId || !identity.membership) throw new AccessDenied(404);
      const grant = await lockRoleGrant(tx, identity.tenantId, identity.membership.id, "admin", intent);
      if (!grant || grant.revokedAt) throw new AccessDenied(404);
      const actor: Actor = Object.freeze({ tenantId: identity.tenantId, origin: identity.origin, userId: identity.userId, authSessionId: identity.authSessionId,
        membershipId: identity.membership.id, authSessionExpiresAt: identity.sessionExpiresAt.getTime(), roleGrantId: grant.id, roleGrantRevision: grant.revision,
        authorityRevision: identity.membership.authorityRevision, mode: "admin" });
      barrier.actor = actor;
      live(request, actor); const result = await action(tx, actor); live(request, actor); return result;
    });
    if (!barrier.actor) throw new ReviewUnavailable();
    live(request, barrier.actor); // COMMIT is asynchronous: recheck after it too.
    if (result !== null && typeof result === "object") bindReviewResult(result, barrier.actor.authSessionExpiresAt);
    return result;
  }
  function active(request: ReviewRequest, actor: Actor, batch: data.ReviewBatchRow | null): asserts batch is data.ReviewBatchRow {
    live(request, actor);
    if (!batch || batch.revokedAt || batch.expiresAt.getTime() <= Date.now()) throw new AccessDenied(404);
  }
  async function capture(request: ReviewRequest, id: string, mutation = false) {
    reviewNeed(reviewUuid(id));
    const result = await authorized(request, mutation, async (tx, actor) => { const batch = await data.lockBatch(tx, actor, id); active(request, actor, batch); return Object.freeze({ actor, batch }); });
    active(request, result.actor, result.batch); return result;
  }
  function bound(manifest: ReviewManifest, batch: data.ReviewBatchRow) {
    if (manifest.catalogSha256 !== batch.catalogSha256 || manifest.entries.length !== batch.entryCount) throw new ReviewUnavailable();
  }
  async function revalidate<T>(request: ReviewRequest, first: Awaited<ReturnType<typeof capture>>, mutation: boolean, action: (tx: AccessTransaction<Q>, actor: Actor, batch: data.ReviewBatchRow) => Promise<T>) {
    const result = await authorized(request, mutation, async (tx, actor) => {
      const batch = await data.lockBatch(tx, actor, first.batch.id, mutation); active(request, actor, batch);
      if (!equal(first.actor, actor) || !equal(first.batch, batch)) throw new AccessDenied(404);
      const result = await action(tx, actor, batch); active(request, actor, batch); return result;
    });
    active(request, first.actor, first.batch);
    if (result !== null && typeof result === "object") bindReviewResult(result, first.actor.authSessionExpiresAt, first.batch.expiresAt.getTime());
    return result;
  }
  return Object.freeze({
    async list(request: ReviewRequest) {
      const result = await authorized(request, false, async (tx, actor) => { const rows = await data.batches(tx, actor); live(request, actor); return { ok: true as const, batches: rows.map(publicBatch) }; });
      result.batches = result.batches.filter(row => Date.parse(row.expiresAt) > Date.now()); return Object.freeze(result);
    },
    async detail(request: ReviewRequest, id: string) {
      const first = await capture(request, id), manifest = await loadReviewManifest(input.get, first.batch.manifestSha256, request.signal); bound(manifest, first.batch);
      return revalidate(request, first, false, async (tx, actor, batch) => {
        const rows = await data.decisions(tx, actor, id, batch.generation);
        return Object.freeze({ ok: true as const, batch: publicBatch(batch), entries: manifest.entries.map(entry => Object.freeze({ ...entry, decision: publicDecision(rows.find(row => row.assetKey === entry.assetKey)) })) });
      });
    },
    async media(request: ReviewRequest, id: string, assetKey: string) {
      reviewNeed(reviewAsset(assetKey));
      const first = await capture(request, id), manifest = await loadReviewManifest(input.get, first.batch.manifestSha256, request.signal); bound(manifest, first.batch);
      const entry = manifest.entries.find(e => e.assetKey === assetKey); if (!entry) throw new AccessDenied(404);
      // Recheck authority after manifest I/O, before requesting any audio.
      await revalidate(request, first, false, async () => undefined);
      const bytes = await loadReviewAudio(input.get, entry, request.signal);
      return revalidate(request, first, false, async () => Object.freeze({ ok: true as const, bytes }));
    },
    async decide(request: ReviewRequest, id: string, assetKey: string, value: unknown) {
      reviewNeed(reviewAsset(assetKey)); const write = parseDecisionWrite(value);
      const first = await capture(request, id, true);
      if (write.manifestSha256 !== first.batch.manifestSha256 || write.generation !== first.batch.generation) return bindReviewResult(conflict(), first.actor.authSessionExpiresAt, first.batch.expiresAt.getTime());
      const manifest = await loadReviewManifest(input.get, first.batch.manifestSha256, request.signal); bound(manifest, first.batch);
      const entry = manifest.entries.find(e => e.assetKey === assetKey); if (!entry) throw new AccessDenied(404);
      const requestSha256 = reviewHash(JSON.stringify({ assetKey, ...write, checks: Object.fromEntries(REVIEW_CHECKS.map(key => [key, write.checks[key]])) }));
      return revalidate(request, first, true, async (tx, actor, batch) => {
        const prior = await data.requestDecision(tx, actor, id, write.requestId);
        if (prior) return prior.requestSha256 === requestSha256 ? Object.freeze({ ok: true as const, decision: publicDecision(prior) }) : conflict();
        const latest = (await data.decisions(tx, actor, id, batch.generation)).find(row => row.assetKey === assetKey);
        active(request, actor, batch);
        if ((latest?.revision ?? 0) !== write.expectedRevision) return conflict();
        const row = await data.insertDecision(tx, actor, batch, entry, write, requestSha256); active(request, actor, batch);
        return Object.freeze({ ok: true as const, decision: publicDecision(row) });
      });
    },
    async revoke(request: ReviewRequest, id: string, value: unknown) {
      reviewNeed(reviewUuid(id));
      const write = reviewRecord(value, ["generation", "manifestSha256"]);
      reviewNeed(Number.isSafeInteger(write.generation) && Number(write.generation) > 0 && reviewDigest(write.manifestSha256));
      let batchExpiresAt: number | undefined;
      const result = await authorized(request, true, async (tx, actor) => {
        const batch = await data.lockBatch(tx, actor, id, true); active(request, actor, batch);
        batchExpiresAt = batch.expiresAt.getTime();
        if (batch.generation !== write.generation || batch.manifestSha256 !== write.manifestSha256) return conflict();
        const changed = await data.revokeBatch(tx, actor, batch); live(request, actor);
        if (batch.expiresAt.getTime() <= Date.now()) throw new AccessDenied(404);
        return changed ? Object.freeze({ ok: true as const, id, generation: changed.generation, revoked: true as const, studentReady: false as const }) : conflict();
      });
      if (batchExpiresAt === undefined || batchExpiresAt <= Date.now()) throw new AccessDenied(404);
      return bindReviewResult(result, Infinity, batchExpiresAt);
    },
  });
}
export type ReferenceReviewService = ReturnType<typeof createReferenceReviewService>;
