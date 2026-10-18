import "server-only";
import { randomUUID } from "node:crypto";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { AccessDatabase, AccessRequest, DeploymentScope, StudentActor } from "../access/types";
import type { createAccessService } from "../access/service";
import { withTenantTransaction } from "../db/runtime";
import { resolveTenantHost } from "../tenancy/resolve";
import { AccessDenied } from "../access/errors";
import * as data from "../data/honoree";
import * as honors from "../data/honors";
import * as s from "../db/index";
import { capture, validMappings } from "../honors/context";
import type { HonorsContextView } from "../../lib/honors/types";
import { createHonoreeTokens, hardExpiry } from "./tokens";
import * as validate from "./validation";
import { material, unitPair, type GuestMaterial } from "./recipient-material";
type Request = AccessRequest & { method?: string; signal?: AbortSignal };
type Selection = Parameters<typeof validate.selection>[0];
const unavailable = (): never => { throw new AccessDenied(404); };
const conflict = Object.freeze({ ok: false as const, code: "conflict" as const });
type ReturnClock = Readonly<{ databaseNow: number; monotonicStart: number }>;
function returnBarrier(request: Request, sessionExpiresAt?: number, expiresAt?: number, clock?: ReturnClock) {
  const wallNow = Date.now();
  if (request.signal?.aborted || sessionExpiresAt !== undefined && sessionExpiresAt <= wallNow) return unavailable();
  // Anchor before the last DB-time await so its round trip and COMMIT wait
  // cannot extend a credential. Wall time also catches a forward clock change;
  // monotonic elapsed time prevents a backward change from extending expiry.
  if (expiresAt !== undefined) {
    if (!clock) return unavailable();
    const now = Math.max(wallNow, clock.databaseNow + Math.max(0, performance.now() - clock.monotonicStart));
    if (!Number.isFinite(now) || expiresAt <= now) return unavailable();
  }
}
export function createHonoreeService<Q extends PgQueryResultHKT>(input: { db: AccessDatabase<Q>; access: ReturnType<typeof createAccessService<Q>>; deployment: DeploymentScope; origin: string; signingSecret: string;
  /** Trusted synthetic composition seam. Runtime deliberately supplies none in B1. */
  projectMaterial?: (release: data.Release) => Promise<GuestMaterial | null> }) {
  const tokenScope = (tenantId: string) => createHonoreeTokens({ secret: input.signingSecret, origin: input.origin, environment: input.deployment.environment, project: "crc-bneimitzvah", tenantId });
  async function projection(release: data.Release | null) {
    if (!release || !input.projectMaterial) return unavailable();
    const projected = await input.projectMaterial(release); if (!projected) return unavailable();
    const result = material(projected, release.projectionDigest), pair = unitPair(release.slot);
    if (release.beforeId !== pair[0] || release.afterId !== pair[1] || result.version !== release.materialVersion || JSON.stringify(result.credits) !== JSON.stringify(release.notices)) return unavailable();
    return result;
  }
  function ready(context: HonorsContextView, row: honors.HonorsRow | null, start: string) {
    if (!row || row.contextHash !== context.hash || context.status !== "assigned" || context.unknownSlot || context.readingNeedsReview || !validMappings(honors.view(row).form, context)) return unavailable();
    const group = row.form.aliyot.find(a => a.startVerse === start), span = context.spans.find(a => a.startVerse === start);
    if (!group?.participants.length || !span) return unavailable(); return span;
  }
  function compatible(row: data.Operation, actor: StudentActor, digest: string) {
    return row.requestDigest === digest && row.actorUserId === actor.userId && row.actorMembershipId === actor.membershipId && row.roleGrantId === actor.roleGrantId && row.role === actor.mode && row.guardianId === actor.relationshipId;
  }
  async function mutate(original: Request, supplied: Selection, suppliedIntent: unknown, receiptOnly: boolean) {
    const selected = validate.selection(supplied), write = validate.intent(suppliedIntent), digest = validate.digest({ selected, write });
    const request = { url: original.url, method: original.method, signal: original.signal, headers: new Headers(original.headers) };
    let sessionExpiresAt: number | undefined, expiresAt: number | undefined, returnClock: ReturnClock | undefined;
    const result = await input.access.withStudentCapability(request, { ...selected, capability: "honoree-link-write" }, async (tx, actor, student) => {
      sessionExpiresAt = actor.authSessionExpiresAt;
      const live = () => { if (request.signal?.aborted || actor.authSessionExpiresAt <= Date.now()) return unavailable(); };
      live(); const prior = await data.operation(tx, actor, write.mutationId); live();
      if (prior) return compatible(prior, actor, digest) ? Object.freeze({ ok: true as const, outcome: "committed" as const, replayed: true, operation: prior.operation, linkId: prior.linkId, startVerse: write.startVerse }) : conflict;
      if (receiptOnly) return Object.freeze({ ok: true as const, outcome: "unconfirmed" as const });
      let current: HonorsContextView | null = null;
      let release: data.Release | null = null;
      if (write.operation !== "revoke") {
        current = await capture(tx, actor, student); live();
        const head = await honors.latest(tx, actor); live(); ready(current, head, write.startVerse);
        if (head!.version !== write.expectedVersion || current.hash !== write.contextHash) return conflict;
        release = await data.release(tx, actor.tenantId, current.snapshot.serviceSlot as "morning" | "havdalah"); live();
        await projection(release); live();
      }
      const epochs = await data.epochs(tx, actor.tenantId, actor.studentId, write.startVerse); live();
      const existing = await data.lockLink(tx, actor.tenantId, actor.studentId, write.startVerse, write.linkId ?? undefined); live();
      if (write.operation === "issue" ? !!existing : !existing || !!existing.revokedAt) return conflict;
      const instant = await data.now(tx); live();
      let issued: ReturnType<ReturnType<typeof tokenScope>["issue"]> | null = null;
      if (write.operation !== "revoke") {
        if (!epochs || !release) return unavailable();
        // Re-read after counter waits. Direct verse DML can commit between the
        // first capture and epoch acquisition; never bind old facts to new epochs.
        current = await capture(tx, actor, student); const head = await honors.latest(tx, actor); live(); ready(current, head, write.startVerse);
        if (head!.version !== write.expectedVersion || current.hash !== write.contextHash) return conflict;
        issued = tokenScope(actor.tenantId).issue();
        if (existing) await data.revoke(tx, existing, instant);
        await tx.insert(s.honoreeLink).values({ id: issued.id, tenantId: actor.tenantId, studentId: actor.studentId, startVerse: write.startVerse, readingEpoch: epochs.reading, groupEpoch: epochs.group,
          honorsVersion: head!.version, contextHash: current.hash, materialReleaseId: release.id, actorUserId: actor.userId, actorMembershipId: actor.membershipId, roleGrantId: actor.roleGrantId,
          guardianId: actor.relationshipId, role: actor.mode as "parent" | "admin", tokenHash: issued.hash, keyId: issued.keyId, issuedAt: new Date(instant), expiresAt: new Date(hardExpiry(instant, student.ceremonyDate)) });
      } else { await data.revoke(tx, existing!, instant); }
      live();
      await tx.insert(s.honoreeOperation).values({ tenantId: actor.tenantId, studentId: actor.studentId, mutationId: write.mutationId, requestDigest: digest, operation: write.operation, linkId: issued?.id ?? existing!.id,
        actorUserId: actor.userId, actorMembershipId: actor.membershipId, roleGrantId: actor.roleGrantId, guardianId: actor.relationshipId, role: actor.mode as "parent" | "admin" });
      await tx.insert(s.auditEvent).values({ tenantId: actor.tenantId, actorUserId: actor.userId, actorMembershipId: actor.membershipId, roleGrantId: actor.roleGrantId, guardianId: actor.relationshipId,
        mode: actor.mode, actingStudentId: actor.studentId, action: `honoree.${write.operation}`, targetType: "honoree_link", targetId: issued?.id ?? existing!.id, requestId: randomUUID() });
      const monotonicStart = performance.now(), finalNow = await data.now(tx); live();
      if (issued) {
        expiresAt = hardExpiry(instant, student.ceremonyDate);
        returnClock = { databaseNow: finalNow, monotonicStart };
        if (expiresAt <= finalNow) return unavailable();
      }
      return validate.bounded(Object.freeze({ ok: true as const, outcome: "committed" as const, replayed: false, operation: write.operation, linkId: issued?.id ?? existing!.id, startVerse: write.startVerse,
        ...(issued ? { url: `${input.origin}/honoree#token=${issued.token}`, expiresAt: new Date(hardExpiry(instant, student.ceremonyDate)).toISOString() } : {}) }));
    });
    // COMMIT may have completed here. Withhold a cancelled/expired URL without
    // pretending to undo committed link/receipt/audit rows. The original UUID
    // remains confirmable; recovering the secret requires explicit reissue.
    returnBarrier(request, sessionExpiresAt, expiresAt, returnClock);
    return result;
  }
  return Object.freeze({ mutate: (request: Request, selected: Selection, write: unknown) => mutate(request, selected, write, false),
    receipt: (request: Request, selected: Selection, write: unknown) => mutate(request, selected, write, true),
    /** Private management metadata, not a validity claim and never a guest DTO.
     * A stale/expired present credential still requires explicit reissue/revoke. */
    async status(original: Request, supplied: Selection, suppliedStart: unknown) {
      const selected = validate.selection(supplied), startVerse = validate.start(suppliedStart);
      const request = { url: original.url, method: original.method, signal: original.signal, headers: new Headers(original.headers) };
      let sessionExpiresAt: number | undefined;
      const result = await input.access.withStudentCapability(request, { ...selected, capability: "honors-read" }, async (tx, actor) => {
        sessionExpiresAt = actor.authSessionExpiresAt;
        const live = () => { if (request.signal?.aborted || actor.authSessionExpiresAt <= Date.now()) return unavailable(); };
        live(); const row = await data.lockLink(tx, actor.tenantId, actor.studentId, startVerse); live();
        return validate.bounded(Object.freeze({ ok: true as const, currentLink: row ? Object.freeze({ id: row.id, startVerse: row.startVerse, issuedAt: row.issuedAt.toISOString(), expiresAt: row.expiresAt.toISOString() }) : null }), 1024);
      });
      returnBarrier(request, sessionExpiresAt);
      return result;
    },
    async read(original: Request, token: unknown) {
      try {
        const request = { url: original.url, method: original.method, signal: original.signal, headers: new Headers(original.headers) };
        const live = () => { if (request.signal?.aborted) return unavailable(); };
        live(); if (request.headers.has("cookie") || request.headers.has("authorization") || request.headers.has("X-Practice-Context")) return unavailable();
        const resolved = await resolveTenantHost(input.db, request, input.deployment); live();
        if (resolved.origin !== input.origin) return unavailable();
        const proof = tokenScope(resolved.tenantId).verify(token);
        let expiresAt: number | undefined, returnClock: ReturnClock | undefined;
        const result = await withTenantTransaction(input.db, resolved, async tx => {
          const found = await data.discover(tx, resolved.tenantId, proof.id); live();
          if (!found || found.tokenHash !== proof.hash || found.keyId !== proof.keyId) return unavailable();
          const issuer = await data.lockIssuer(tx, found, resolved.origin); live(); if (!issuer) return unavailable();
          let current = await capture(tx, issuer.actor, issuer.student); live();
          if (current.unknownSlot) return unavailable();
          const release = await data.release(tx, resolved.tenantId, current.snapshot.serviceSlot as "morning" | "havdalah", found.materialReleaseId); live();
          const projected = await projection(release); live();
          const epochs = await data.epochs(tx, resolved.tenantId, found.studentId, found.startVerse); live();
          const row = await data.lockLink(tx, resolved.tenantId, found.studentId, found.startVerse, proof.id); live();
          if (!row || row.tokenHash !== proof.hash || row.revokedAt || !epochs || row.readingEpoch !== epochs.reading || row.groupEpoch !== epochs.group) return unavailable();
          current = await capture(tx, issuer.actor, issuer.student); const head = await honors.latest(tx, issuer.actor); live();
          const span = ready(current, head, row.startVerse);
          if (row.contextHash !== current.hash) return unavailable();
          const result = validate.bounded(Object.freeze({ ok: true as const, schemaVersion: 1 as const, student: Object.freeze({ firstName: issuer.student.firstName, ceremonyDate: issuer.student.ceremonyDate }), aliyah: span, material: projected, expiresAt: row.expiresAt.toISOString() }));
          const monotonicStart = performance.now(), instant = await data.now(tx); live();
          expiresAt = row.expiresAt.getTime(); returnClock = { databaseNow: instant, monotonicStart };
          if (expiresAt <= instant) return unavailable(); return result;
        });
        returnBarrier(request, undefined, expiresAt, returnClock);
        return result;
      } catch { return unavailable(); }
    },
  });
}
