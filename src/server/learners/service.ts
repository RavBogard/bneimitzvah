import "server-only";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import { AccessDenied } from "../access/errors";
import type { createAccessService } from "../access/service";
import type { AccessRequest, AccessTransaction, Actor, VerifiedIdentity } from "../access/types";
import { lockRoleGrant } from "../data/authority";
import { isCeremonyDone } from "../data/ceremony-done";
import { activeClaimOf, liveStaffGrant, liveTutorLinksOf, notALearner } from "../data/learner-claims";
import { membershipOf } from "../data/portal";
import { closedObject } from "../http/query";
import { requireCookieMutation } from "../http/mutations";
import { HttpBoundaryError } from "../http/responses";
import { audit as auditRelationship, revokeTutor } from "../relationships/data";
import { displayName, writeTutorAssignment, writeTutorRevocation } from "../relationships/service";
import type { SavedService } from "../saved/service";
import * as data from "./data";
import { NAMELESS_LEARNER } from "../../lib/learner-name";

/**
 * Readings for everyone (Daniel, 2026-10-27, decision 15; plan decisions 2 and 6, task D5). Any tutor may see every signed-in
 * person in the congregation and claim any of them as a student, one tutor at a time; the learner may undo the claim; the rabbi
 * (an admin) may undo it too, here or from the student's access page. A claim on a person with a live student identity also
 * writes the tutor_student link every staff tool reads, and ends it again with the claim. A rabbi's own assignment is not a
 * claim: the learner is told so (409) rather than allowed to end it.
 */
type Request = AccessRequest & { method?: string };
const failed = <C extends string>(code: C) => ({ ok: false as const, code });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const LIMIT = 50;
// Control characters, line and paragraph separators: a search prefix never carries one (the account names it matches cannot either).
const CONTROLS = /[\x00-\x1f\x7f-\x9f\u2028\u2029]/;
function learnerOf(supplied: unknown) {
  const value = closedObject(supplied, ["learner"]).learner;
  if (typeof value !== "string" || !UUID.test(value.toLowerCase())) throw new HttpBoundaryError();
  return value.toLowerCase();
}
function search(value: string | null) {
  if (value === null || value === "") return null;
  if (!value.isWellFormed() || Array.from(value).length > 80 || CONTROLS.test(value)) throw new HttpBoundaryError();
  return value.trim() || null;
}
function cursor(value: string | null) {
  if (value === null) return null;
  if (!UUID.test(value.toLowerCase())) throw new HttpBoundaryError();
  return value.toLowerCase();
}

export function createLearnersService<Q extends PgQueryResultHKT>(input: { access: Pick<ReturnType<typeof createAccessService<Q>>, "withVerifiedIdentity">; saved: Pick<SavedService, "directory"> }) {
  const actorOf = (identity: VerifiedIdentity, membership: NonNullable<VerifiedIdentity["membership"]>, grant: { id: string; revision: number }, mode: "tutor" | "admin"): Actor => Object.freeze({
    tenantId: identity.tenantId, origin: identity.origin, userId: identity.userId, authSessionId: identity.authSessionId, membershipId: membership.id, roleGrantId: grant.id, mode,
    authorityRevision: membership.authorityRevision, authSessionExpiresAt: identity.sessionExpiresAt.getTime(), roleGrantRevision: grant.revision });
  /** The caller's live tutor and admin actors, each locked for update, under the cookie-mutation rule; at least one, or 403. */
  function withStaffWriter<T>(request: Request, action: (tx: AccessTransaction<Q>, actors: { tutor: Actor | null; admin: Actor | null }) => Promise<T>) {
    return input.access.withVerifiedIdentity(request, { intent: "authority-write", mutation: true }, async (tx, identity) => {
      if (!identity.membership) throw new AccessDenied(403);
      requireCookieMutation(request, identity.origin);
      const tutor = await lockRoleGrant(tx, identity.tenantId, identity.membership.id, "tutor", "authority-write");
      const admin = await lockRoleGrant(tx, identity.tenantId, identity.membership.id, "admin", "authority-write");
      if (!tutor && !admin) throw new AccessDenied(403);
      return action(tx, { tutor: tutor ? actorOf(identity, identity.membership, tutor, "tutor") : null, admin: admin ? actorOf(identity, identity.membership, admin, "admin") : null });
    });
  }
  /** The learner's tutor, from the claim (undoable) or, for a linked student, the first tutor link (the rabbi's assignment). */
  async function tutorOf(tx: AccessTransaction<Q>, tenantId: string, learnerMembershipId: string) {
    // The claim's grant is live (activeClaimOf checks); a link's tutor grant may not be: a revoked tutor is nobody's tutor.
    const claim = await activeClaimOf(tx, tenantId, learnerMembershipId);
    const candidates = claim ? [claim.tutorGrantId] : (await liveTutorLinksOf(tx, tenantId, learnerMembershipId)).map(link => link.tutorGrantId);
    for (const grantId of candidates) {
      const holder = await data.grantHolder(tx, tenantId, grantId);
      if (!holder || holder.revokedAt) continue;
      return Object.freeze({ grantId, name: displayName(holder.name, "Tutor"), claimed: claim !== null, claimId: claim?.id ?? null });
    }
    return null;
  }
  /** Ends a claim as a tutor or admin: the link it made goes first, through the one tutor-revocation write, whose hook ends the claim and audits it; a claim with no live link is ended here. */
  async function endClaim(tx: AccessTransaction<Q>, actor: Actor, claim: { id: string; tutorLinkId: string | null }) {
    if (claim.tutorLinkId) {
      const link = await data.tutorLinkRow(tx, actor.tenantId, claim.tutorLinkId);
      if (link && !link.revokedAt && (await writeTutorRevocation(tx, actor, link.studentId, link.id)).ok) return;
    }
    if (await data.revokeClaim(tx, actor.tenantId, claim.id, actor.mode === "admin" ? "admin" : "tutor", actor.membershipId)) await data.auditClaim(tx, actor, "learner.unclaim", claim.id);
  }

  return Object.freeze({
    /**
     * Find a learner: every live membership of the congregation but one's own, the staff's and the parents', by name, with how many readings each keeps and the
     * nearest dated one (the saved service's directory read, for a live admin or tutor), the tutor if any, and the student record if any.
     * Never an email: names go through displayName. `mine` is judged by the caller's own tutor grant.
     */
    async list(request: Request, query: { q: string | null; after: string | null }) {
      const q = search(query.q), after = cursor(query.after);
      const directory = await input.saved.directory(request);
      const shelves = new Map(directory.rows.map(row => [row.membershipId, row]));
      return input.access.withVerifiedIdentity(request, { intent: "read" }, async (tx, identity) => {
        if (!identity.membership) throw new AccessDenied(403);
        const grant = await liveStaffGrant(tx, identity.tenantId, identity.membership.id, "tutor");
        if (!grant) throw new AccessDenied(404);
        const rows = await data.listLearners(tx, identity.tenantId, { exceptMembershipId: identity.membership.id, q, after, limit: LIMIT });
        const learners = [];
        for (const row of rows) {
          const tutor = await tutorOf(tx, identity.tenantId, row.membershipId), student = await data.liveStudentOf(tx, identity.tenantId, row.membershipId), shelf = shelves.get(row.membershipId);
          learners.push(Object.freeze({ membershipId: row.membershipId, name: displayName(row.name, NAMELESS_LEARNER), readings: shelf?.readings ?? 0, nearest: shelf?.nearest ?? null,
            tutor: tutor ? Object.freeze({ name: tutor.name, claimed: tutor.claimed, mine: tutor.grantId === grant.id }) : null,
            student: student ? Object.freeze({ id: student.id, firstName: student.firstName, lastName: student.lastName, ceremonyDate: student.ceremonyDate }) : null }));
        }
        return { ok: true as const, learners: Object.freeze(learners) };
      });
    },
    /**
     * Claim as my student: a tutor's act (an admin without a tutor grant cannot). One tutor at a time: another tutor's live claim
     * or tutor link is 409 has-tutor (the rabbi reassigns on the access page). The same tutor claiming again, or claiming someone
     * the rabbi already assigned them, changes nothing. A learner with a live student identity gets the tutor link too, unless
     * the ceremony is done; a disabled, missing or other-congregation learner, a staff member or a parent (notALearner) and oneself, are 404.
     */
    async claim(request: Request, supplied: unknown) {
      const learner = learnerOf(supplied);
      return withStaffWriter(request, async (tx, actors) => {
        const actor = actors.tutor;
        if (!actor) throw new AccessDenied(403);
        if (learner === actor.membershipId) throw new AccessDenied(404);
        const member = await membershipOf(tx, actor.tenantId, learner);
        if (!member || member.disabledAt) throw new AccessDenied(404);
        // A1 (tutor and admin walks 2026-10-28): the rabbi and the tutors are colleagues and parents are family, not learners: the same 404 an unknown learner gets.
        if (await notALearner(tx, actor.tenantId, learner)) throw new AccessDenied(404);
        await data.lockLearnerClaims(tx, actor.tenantId, learner);
        const existing = await activeClaimOf(tx, actor.tenantId, learner, "update");
        if (existing) return existing.tutorGrantId === actor.roleGrantId ? { ok: true as const, learner, created: false } : failed("has-tutor");
        const links = await liveTutorLinksOf(tx, actor.tenantId, learner);
        if (links.some(link => link.tutorGrantId !== actor.roleGrantId)) return failed("has-tutor");
        if (links.some(link => link.tutorGrantId === actor.roleGrantId)) return { ok: true as const, learner, created: false };
        const student = await data.liveStudentOf(tx, actor.tenantId, learner);
        let tutorLinkId: string | null = null;
        if (student && !await isCeremonyDone(tx, actor.tenantId, student.id)) {
          const link = await writeTutorAssignment(tx, actor, student.id, actor.roleGrantId);
          if (!link.ok) return failed("has-tutor");
          tutorLinkId = link.id;
        }
        const claim = await data.insertClaim(tx, { tenantId: actor.tenantId, learnerMembershipId: learner, tutorGrantId: actor.roleGrantId, tutorLinkId });
        await data.auditClaim(tx, actor, "learner.claim", claim.id);
        return { ok: true as const, learner, created: true };
      });
    },
    /** Remove claim: the claiming tutor, or an admin. Another tutor's claim is 404 to a tutor who does not hold it. */
    async unclaim(request: Request, supplied: unknown) {
      const learner = learnerOf(supplied);
      return withStaffWriter(request, async (tx, actors) => {
        await data.lockLearnerClaims(tx, (actors.tutor ?? actors.admin)!.tenantId, learner);
        const claim = await activeClaimOf(tx, (actors.tutor ?? actors.admin)!.tenantId, learner, "update");
        if (!claim) throw new AccessDenied(404);
        const actor = actors.tutor && claim.tutorGrantId === actors.tutor.roleGrantId ? actors.tutor : actors.admin;
        if (!actor) throw new AccessDenied(404);
        await endClaim(tx, actor, claim);
        return { ok: true as const, learner };
      });
    },
    /** Tutor: {name} on one's own shelf: from the claim (with "Not my tutor") or, for a linked student, the rabbi's assignment (without). */
    async myTutor(request: Request) {
      return input.access.withVerifiedIdentity(request, { intent: "read" }, async (tx, identity) => {
        if (!identity.membership) throw new AccessDenied(403);
        const tutor = await tutorOf(tx, identity.tenantId, identity.membership.id);
        return { ok: true as const, tutor: tutor ? { name: tutor.name, claimed: tutor.claimed } : null };
      });
    },
    /**
     * Not my tutor: the learner ends the claim (revoked_by learner) and the tutor link it made. A rabbi's assignment is not a
     * claim: 409 assigned. The audit row carries the learner's own grant when they hold one; a membership with no grant leaves
     * the claim row itself as the record (audit rows need a grant).
     */
    async removeMyTutor(request: Request) {
      return input.access.withVerifiedIdentity(request, { intent: "authority-write", mutation: true }, async (tx, identity) => {
        if (!identity.membership) throw new AccessDenied(403);
        requireCookieMutation(request, identity.origin);
        const me = identity.membership.id;
        await data.lockLearnerClaims(tx, identity.tenantId, me);
        const claim = await activeClaimOf(tx, identity.tenantId, me, "update");
        if (!claim) { if ((await liveTutorLinksOf(tx, identity.tenantId, me)).length) return failed("assigned"); throw new AccessDenied(404); }
        if (!await data.revokeClaim(tx, identity.tenantId, claim.id, "learner", me)) throw new AccessDenied(404);
        const grant = await data.anyLiveGrant(tx, identity.tenantId, me);
        const actor: Actor | null = grant ? Object.freeze({ tenantId: identity.tenantId, origin: identity.origin, userId: identity.userId, authSessionId: identity.authSessionId, membershipId: me,
          roleGrantId: grant.id, roleGrantRevision: grant.revision, mode: grant.role, authorityRevision: identity.membership.authorityRevision, authSessionExpiresAt: identity.sessionExpiresAt.getTime() }) : null;
        if (claim.tutorLinkId) {
          const link = await data.tutorLinkRow(tx, identity.tenantId, claim.tutorLinkId);
          // The link the claim made ends too, audited as tutor.revoke under the learner's own grant when they hold one.
          if (link && !link.revokedAt && await revokeTutor(tx, identity.tenantId, link.id, new Date()) && actor) await auditRelationship(tx, actor, "tutor.revoke", link.id, link.studentId);
        }
        if (actor) await data.auditClaim(tx, actor, "learner.unclaim", claim.id);
        return { ok: true as const };
      });
    },
  });
}
export type LearnersService = ReturnType<typeof createLearnersService>;
