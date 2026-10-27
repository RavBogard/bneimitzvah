import "server-only";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { createAccessService } from "../access/service";
import type { AccessRequest, AccessTransaction, Actor } from "../access/types";
import { AccessDenied } from "../access/errors";
import { requireCookieMutation, type CookieMutationRequest } from "../http/mutations";
import { identifier, revision } from "../students/validation";
import * as data from "./data";
import { isCeremonyDone } from "../data/ceremony-done";
import { auditClaim, liveClaimForLink, revokeClaim } from "../learners/data";
import type { AdminSelection, EligibleTutor, FlagSelection, LinkSelection } from "./types";

const conflict = () => Object.freeze({ ok: false as const, code: "stale-state" as const });
function active(value: unknown) { if (value !== "active") throw new AccessDenied(403); }
function boolean(value: unknown): boolean { if (typeof value !== "boolean") throw new AccessDenied(403); return value; }
export function displayName(value: string, fallback: "Parent" | "Student" | "Tutor" | "Learner" = "Tutor") {
  const label = value.trim();
  // This is only the label of an already tenant-authorized tutor, never an
  // arbitrary global-user search. Do not turn email-shaped names into contacts.
  return label.length > 0 && label.length <= 160 && !/[<>@\x00-\x1f\x7f]/.test(label) ? label : fallback;
}

/**
 * The one tutor-assignment write, shared by the portal's relationship controls and the portal MCP; the
 * caller has already established admin authority in this transaction (manage-relationships, or a live
 * admin MCP connection with the roster consent).
 */
export async function writeTutorAssignment<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, actor: Actor, studentId: string, grantId: string) {
  const subject = await data.subjectGrant(tx, actor.tenantId, grantId, "authority-write");
  if (subject.grant.role !== "tutor" || subject.grant.revokedAt || subject.membership.disabledAt || !subject.verified) throw new AccessDenied(404);
  const student = await data.student(tx, actor.tenantId, studentId, "authority-write");
  if (student.disabledAt) throw new AccessDenied(404);
  // N21: no tutor assignment while the student's ceremony is done (0049's trigger refuses it as well). After a reversal an admin
  // assigns tutors again here, by hand; the reversal itself restores none.
  if (await isCeremonyDone(tx, actor.tenantId, studentId)) return conflict();
  if (await data.activeTutorLink(tx, actor.tenantId, studentId, grantId)) return conflict();
  const link = await data.insertTutor(tx, actor.tenantId, studentId, grantId);
  await data.audit(tx, actor, "tutor.assign", link.id, studentId);
  return Object.freeze({ ok: true as const, id: link.id, studentId, tutorGrantId: grantId });
}
/** The one tutor-revocation write, shared like writeTutorAssignment. */
export async function writeTutorRevocation<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, actor: Actor, studentId: string, linkId: string) {
  const probe = await data.tutorProbe(tx, actor.tenantId, studentId, linkId);
  await data.subjectGrant(tx, actor.tenantId, probe.grantId, "authority-write");
  await data.student(tx, actor.tenantId, studentId, "authority-write");
  const link = await data.tutorLink(tx, actor.tenantId, studentId, linkId);
  if (link.revokedAt || !await data.revokeTutor(tx, actor.tenantId, link.id, new Date())) return conflict();
  await data.audit(tx, actor, "tutor.revoke", link.id, studentId);
  // Readings for everyone (plan D5): a link a tutor's claim made ends with the claim, whoever revokes it (the admin on the access
  // page, the tutor or an admin on the shelf), audited as learner.unclaim in the revoker's own mode and grant.
  const claim = await liveClaimForLink(tx, actor.tenantId, link.id);
  if (claim && await revokeClaim(tx, actor.tenantId, claim.id, actor.mode === "admin" ? "admin" : "tutor", actor.membershipId)) await auditClaim(tx, actor, "learner.unclaim", claim.id);
  return Object.freeze({ ok: true as const, id: link.id });
}

export function createRelationshipService<Q extends PgQueryResultHKT>(input: { access: ReturnType<typeof createAccessService<Q>> }) {
  function write<T>(request: CookieMutationRequest, selection: AdminSelection, action: (tx: AccessTransaction<Q>, actor: Actor) => Promise<T>) {
    return input.access.withAdminCapability(request, { mode: selection.mode, capability: "manage-relationships" }, async (tx, actor) => {
      requireCookieMutation(request, actor.origin);
      return action(tx, actor);
    });
  }
  function read<T>(request: AccessRequest, selection: AdminSelection, action: (tx: AccessTransaction<Q>, actor: Actor) => Promise<T>) {
    return input.access.withAdminCapability(request, { mode: selection.mode, capability: "read-relationships" }, action);
  }

  async function listEligibleTutors(request: AccessRequest, selection: AdminSelection & { afterId?: string; limit?: number }) {
    const afterId = selection.afterId === undefined ? undefined : identifier(selection.afterId), limit = selection.limit ?? 100;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new AccessDenied(403);
    return read(request, selection, async (tx, actor): Promise<readonly EligibleTutor[]> => Object.freeze((await data.eligibleTutors(tx, actor.tenantId, afterId, limit))
      .map(({ grant, displayName: label }) => Object.freeze({ id: grant.id, revision: grant.revision, isCantor: grant.isCantor, displayName: displayName(label) }))));
  }

  async function inspectStudent(request: AccessRequest, selection: AdminSelection & { studentId: string }) {
    const studentId = identifier(selection.studentId);
    return read(request, selection, async (tx, actor) => {
      const student = await data.student(tx, actor.tenantId, studentId, "read"), links = await data.inspectLinks(tx, actor.tenantId, studentId);
      const available = (row: { revokedGrant: Date | null; disabledMembership: Date | null; verified: boolean }) => !student.disabledAt && !row.revokedGrant && !row.disabledMembership && row.verified;
      return Object.freeze({ student: Object.freeze({ id: student.id, firstName: student.firstName, lastName: student.lastName, ceremonyDate: student.ceremonyDate,
        revision: student.revision, disabled: student.disabledAt !== null }),
        guardians: Object.freeze(links.guardians.map(row => Object.freeze({ id: row.link.id, revision: row.link.revision, parentGrantId: row.link.parentGrantId,
          parentGrantRevision: row.grantRevision, displayName: displayName(row.displayName, "Parent"), practiceEnabled: row.link.practiceEnabled, effectiveRead: available(row), effectivePractice: available(row) && row.link.practiceEnabled }))),
        identities: Object.freeze(links.identities.map(row => Object.freeze({ id: row.link.id, studentGrantId: row.link.roleGrantId, studentGrantRevision: row.grantRevision, displayName: displayName(row.displayName, "Student"), effectivePractice: available(row) }))),
        tutors: Object.freeze(links.tutors.map(row => Object.freeze({ id: row.link.id, tutorGrantId: row.link.tutorGrantId, tutorGrantRevision: row.grantRevision, displayName: displayName(row.displayName, "Tutor"), isCantor: row.isCantor, effectiveRead: available(row) }))) });
    });
  }

  async function assignTutor(request: CookieMutationRequest, selection: AdminSelection & { studentId: string; tutorGrantId: string; expectedState: "unassigned" }) {
    const studentId = identifier(selection.studentId), grantId = identifier(selection.tutorGrantId);
    if (selection.expectedState !== "unassigned") throw new AccessDenied(403);
    return write(request, selection, (tx, actor) => writeTutorAssignment(tx, actor, studentId, grantId));
  }

  async function revokeTutor(request: CookieMutationRequest, selection: LinkSelection) {
    active(selection.expectedState); const studentId = identifier(selection.studentId), linkId = identifier(selection.linkId);
    return write(request, selection, (tx, actor) => writeTutorRevocation(tx, actor, studentId, linkId));
  }

  async function revokeGuardian(request: CookieMutationRequest, selection: LinkSelection) {
    active(selection.expectedState); const studentId = identifier(selection.studentId), linkId = identifier(selection.linkId);
    return write(request, selection, async (tx, actor) => {
      const probe = await data.guardianProbe(tx, actor.tenantId, studentId, linkId);
      await data.subjectGrant(tx, actor.tenantId, probe.grantId, "authority-write");
      await data.student(tx, actor.tenantId, studentId, "authority-write");
      const link = await data.guardian(tx, actor.tenantId, studentId, linkId), now = new Date();
      if (link.revokedAt || !await data.revokeGuardian(tx, actor.tenantId, link.id, link.revision, now)) return conflict();
      await data.revokeContexts(tx, actor.tenantId, { kind: "guardian", id: link.id }, now);
      await data.audit(tx, actor, "guardian.revoke", link.id, studentId, link.id);
      return Object.freeze({ ok: true as const, id: link.id, revision: link.revision + 1 });
    });
  }

  async function revokeStudentIdentity(request: CookieMutationRequest, selection: LinkSelection) {
    active(selection.expectedState); const studentId = identifier(selection.studentId), linkId = identifier(selection.linkId);
    return write(request, selection, async (tx, actor) => {
      const probe = await data.identityProbe(tx, actor.tenantId, studentId, linkId);
      await data.subjectGrant(tx, actor.tenantId, probe.grantId, "authority-write");
      await data.student(tx, actor.tenantId, studentId, "authority-write");
      const link = await data.identity(tx, actor.tenantId, studentId, linkId), now = new Date();
      if (link.revokedAt || !await data.revokeIdentity(tx, actor.tenantId, link.id, now)) return conflict();
      await data.revokeContexts(tx, actor.tenantId, { kind: "identity", id: link.id }, now);
      await data.audit(tx, actor, "identity.revoke", link.id, studentId);
      return Object.freeze({ ok: true as const, id: link.id });
    });
  }

  async function setGuardianPractice(request: CookieMutationRequest, selection: FlagSelection & { studentId: string; guardianId: string; practiceEnabled: boolean }) {
    const studentId = identifier(selection.studentId), linkId = identifier(selection.guardianId), expected = revision(selection.expectedRevision), enabled = boolean(selection.practiceEnabled);
    return write(request, selection, async (tx, actor) => {
      const probe = await data.guardianProbe(tx, actor.tenantId, studentId, linkId), subject = await data.subjectGrant(tx, actor.tenantId, probe.grantId, "authority-write");
      const student = await data.student(tx, actor.tenantId, studentId, "authority-write"), link = await data.guardian(tx, actor.tenantId, studentId, linkId);
      if (link.revokedAt || link.revision !== expected) return conflict();
      if (enabled && (student.disabledAt || subject.grant.revokedAt || subject.membership.disabledAt || !subject.verified)) throw new AccessDenied(404);
      if (link.practiceEnabled === enabled) return Object.freeze({ ok: true as const, id: link.id, revision: link.revision, practiceEnabled: enabled });
      const updated = await data.guardianPractice(tx, actor.tenantId, link.id, expected, enabled);
      if (!updated) return conflict();
      if (!enabled) await data.revokeContexts(tx, actor.tenantId, { kind: "guardian", id: link.id }, new Date());
      await data.audit(tx, actor, "guardian.practice-set", link.id, studentId, link.id);
      return Object.freeze({ ok: true as const, id: link.id, revision: updated.revision, practiceEnabled: enabled });
    });
  }

  async function revokeRoleGrant(request: CookieMutationRequest, selection: FlagSelection & { roleGrantId: string; expectedState: "active" }) {
    active(selection.expectedState); const grantId = identifier(selection.roleGrantId), expected = revision(selection.expectedRevision);
    return write(request, selection, async (tx, actor) => {
      const subject = await data.subjectGrant(tx, actor.tenantId, grantId, "authority-write");
      if (subject.grant.role === "admin") throw new AccessDenied(403);
      if (subject.grant.revokedAt || subject.grant.revision !== expected) return conflict();
      const now = new Date(), updated = await data.revokeGrant(tx, actor.tenantId, grantId, expected, now);
      if (!updated) return conflict();
      await data.revokeContexts(tx, actor.tenantId, { kind: "grant", id: grantId }, now);
      await data.audit(tx, actor, "grant.revoke", grantId);
      return Object.freeze({ ok: true as const, id: grantId, revision: updated.revision });
    });
  }

  async function setCantor(request: CookieMutationRequest, selection: FlagSelection & { roleGrantId: string; isCantor: boolean }) {
    const grantId = identifier(selection.roleGrantId), expected = revision(selection.expectedRevision), enabled = boolean(selection.isCantor);
    return write(request, selection, async (tx, actor) => {
      const subject = await data.subjectGrant(tx, actor.tenantId, grantId, "authority-write");
      if (subject.grant.role !== "tutor" || subject.membership.disabledAt || !subject.verified) throw new AccessDenied(404);
      if (subject.grant.revokedAt || subject.grant.revision !== expected) return conflict();
      if (subject.grant.isCantor === enabled) return Object.freeze({ ok: true as const, id: grantId, revision: expected, isCantor: enabled });
      const updated = await data.cantorFlag(tx, actor.tenantId, grantId, expected, enabled);
      if (!updated) return conflict();
      await data.audit(tx, actor, "tutor.cantor-set", grantId);
      return Object.freeze({ ok: true as const, id: grantId, revision: updated.revision, isCantor: enabled });
    });
  }

  return Object.freeze({ listEligibleTutors, inspectStudent, assignTutor, revokeTutor, revokeGuardian, revokeStudentIdentity, setGuardianPractice, revokeRoleGrant, setCantor });
}
