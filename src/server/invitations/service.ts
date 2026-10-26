import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { createAccessService } from "../access/service";
import type { AccessDatabase, AccessRequest, AccessTransaction, ActiveMode, Actor, VerifiedIdentity } from "../access/types";
import { AccessDenied, AccessUnavailable } from "../access/errors";
import { requireCookieMutation } from "../http/mutations";
import type { CookieMutationRequest } from "../http/mutations";
import { withTenantTransaction } from "../db/runtime";
import * as data from "../data/invitations";
import { isCeremonyDone } from "../data/ceremony-done";
import type { InvitedRole } from "../data/invitations";
import { createInvitationSecret, hashInvitationToken, invitationLifetimeMs, normalizedInvitationEmail } from "./tokens";

// The transport is given the role and the expiry so the email can name them; it is never given a student, so no
// child's name can reach a subject or a body (decision 12).
export type InvitationTransport = (message: Readonly<{ email: string; url: string; tenantId: string; role: InvitedRole; expiresAt: Date }>) => Promise<void>;
export type InvitationDeliveryStatus = "pending" | "sent" | "failed" | "copied";
type Delivery = Readonly<{ inviteId: string; delivery: "sent" | "failed" | "unknown" }>;
const REVIEW_LIFETIME_MS = 5 * 60_000;
const DAY_MS = 24 * 60 * 60_000;
function assertUsableInvitation(invitation: data.IssuedInvitation | undefined, identity: VerifiedIdentity, now: Date): asserts invitation is data.IssuedInvitation & { role: InvitedRole } {
  if (!invitation || invitation.acceptedAt || invitation.revokedAt || invitation.expiresAt <= now || invitation.email !== normalizedInvitationEmail(identity.email) || invitation.role === "admin") throw new AccessDenied(404);
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function invitationListRow(row: Awaited<ReturnType<typeof data.listInvitations>>[number], now: number) {
  const timestamp = (value: unknown): number => {
    if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new AccessUnavailable();
    return value.getTime();
  };
  const name = (value: unknown): string => {
    if (typeof value !== "string" || !value.trim() || value.length > 100 || /[<>\x00-\x1f\x7f]/.test(value)) throw new AccessUnavailable();
    return value;
  };
  let email: string;
  try { email = normalizedInvitationEmail(row.recipientEmail); } catch { throw new AccessUnavailable(); }
  if (email !== row.recipientEmail || !uuid.test(row.id) || !["parent", "student", "tutor"].includes(row.role)) throw new AccessUnavailable();
  const created = timestamp(row.createdAt), expires = timestamp(row.expiresAt);
  const accepted = row.acceptedAt === null ? null : timestamp(row.acceptedAt), revoked = row.revokedAt === null ? null : timestamp(row.revokedAt);
  const attempted = row.deliveryAttemptedAt === null ? null : timestamp(row.deliveryAttemptedAt);
  if (expires <= created || (accepted !== null && (accepted < created || accepted >= expires)) || (revoked !== null && revoked < created)
    || (accepted !== null && revoked !== null) || (attempted !== null && attempted < created)
    || !["pending", "sent", "failed", "copied"].includes(row.deliveryStatus) || (row.deliveryStatus === "pending") !== (attempted === null)) throw new AccessUnavailable();
  let student: Readonly<{ id: string; firstName: string; lastName: string }> | null = null;
  if (row.role === "tutor") {
    if (row.studentId !== null || row.targetId !== null || row.firstName !== null || row.lastName !== null) throw new AccessUnavailable();
  } else {
    if (typeof row.studentId !== "string" || !uuid.test(row.studentId) || row.targetId !== row.studentId) throw new AccessUnavailable();
    student = Object.freeze({ id: row.studentId, firstName: name(row.firstName), lastName: name(row.lastName) });
  }
  const status = accepted !== null ? "accepted" as const : revoked !== null ? "revoked" as const : expires <= now ? "expired" as const : "pending" as const;
  // "Expires tomorrow" (G13): a pending link with a day or less left.
  const expiresTomorrow = status === "pending" && expires - now <= DAY_MS;
  return Object.freeze({ id: row.id, role: row.role as InvitedRole, recipientEmail: email, student, status, expiresTomorrow,
    createdAt: row.createdAt.toISOString(), expiresAt: row.expiresAt.toISOString(), acceptedAt: row.acceptedAt?.toISOString() ?? null, revokedAt: row.revokedAt?.toISOString() ?? null,
    delivery: Object.freeze({ status: row.deliveryStatus, attemptedAt: row.deliveryAttemptedAt?.toISOString() ?? null }) });
}

// Absence is not a mailbox. Supplied malformed contacts still use the strict
// normalizer and fail closed; all grant/recipient/link checks remain separate.
function parentContactMatches(contact: string | null, email: string): boolean {
  return contact !== null && normalizedInvitationEmail(contact) === normalizedInvitationEmail(email);
}
function studentParentContactMatches(student:{parentEmail:string|null;secondParentEmail:string|null},email:string):boolean {
  // Validate both supplied contacts even if the first already matches.
  const first=parentContactMatches(student.parentEmail,email),second=parentContactMatches(student.secondParentEmail,email);
  return first || second;
}

export function createInvitationService<Q extends PgQueryResultHKT>(input: {
  db: AccessDatabase<Q>; access: ReturnType<typeof createAccessService<Q>>; transport: InvitationTransport; throttleSecret: string;
}) {
  if (typeof input.transport !== "function" || typeof input.throttleSecret !== "string" || input.throttleSecret.length < 32) throw new AccessUnavailable();
  const reviewKey = createHmac("sha256", input.throttleSecret).update("portal:invitation-review:v1").digest();
  async function list(request: AccessRequest, selection: { mode: ActiveMode; afterId?: string; limit?: number }) {
    const limit = selection.limit ?? 100;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || (selection.afterId !== undefined && (typeof selection.afterId !== "string" || !uuid.test(selection.afterId)))) throw new AccessDenied(403);
    return input.access.withAdminCapability(request, { mode: selection.mode, capability: "read-invites" }, async (tx, actor) => {
      const rows = await data.listInvitations(tx, actor.tenantId, selection.afterId, limit), now = Date.now();
      return Object.freeze(rows.map(row => invitationListRow(row, now)));
    });
  }
  function reviewDigest(invitation: data.IssuedInvitation, identity: VerifiedIdentity, expiry: number) {
    return createHmac("sha256", reviewKey).update(JSON.stringify(["invitation-review:v1", expiry, invitation.tokenHash, identity.authSessionId,
      identity.userId, identity.tenantId, identity.origin, invitation.role, invitation.studentId, invitation.expiresAt.getTime()])).digest();
  }
  function verifyReview(invitation: data.IssuedInvitation, identity: VerifiedIdentity, reviewBinding: unknown, now: number) {
    if (typeof reviewBinding !== "string" || !/^[1-9][0-9]{0,15}\.[A-Za-z0-9_-]{43}$/.test(reviewBinding)) throw new AccessDenied(404);
    const [expiryText, mac] = reviewBinding.split("."), expiry = Number(expiryText);
    const supplied = Buffer.from(mac, "base64url");
    if (!Number.isSafeInteger(expiry) || expiry <= now || expiry > invitation.expiresAt.getTime() || expiry > identity.sessionExpiresAt.getTime()
      || expiry > now + REVIEW_LIFETIME_MS || supplied.length !== 32 || supplied.toString("base64url") !== mac
      || !timingSafeEqual(supplied, reviewDigest(invitation, identity, expiry))) throw new AccessDenied(404);
  }

  async function deliver(pending: { invitation: data.IssuedInvitation; actor: Actor; token: string }): Promise<Delivery> {
    const url = new URL("/invitations/open", pending.actor.origin);
    url.hash = `token=${pending.token}`;
    let outcome: "sent" | "failed" = "sent";
    try {
      // Issue/reissue committed before this call. Provider diagnostics and the
      // token stay private; crashes leave the durable initial state pending.
      await input.transport({ email: pending.invitation.email, url: url.toString(), tenantId: pending.actor.tenantId,
        role: pending.invitation.role as InvitedRole, expiresAt: pending.invitation.expiresAt });
    } catch { outcome = "failed"; }
    try {
      await withTenantTransaction(input.db, { tenantId: pending.actor.tenantId }, (tx) => data.recordDeliveryOutcome(tx, pending.invitation, pending.actor, outcome));
      return { inviteId: pending.invitation.id, delivery: outcome };
    } catch {
      // Transport may have sent successfully. Never fabricate a confirmed
      // outcome when its transaction failed (or its commit is uncertain).
      return { inviteId: pending.invitation.id, delivery: "unknown" };
    }
  }

  async function issue(request: CookieMutationRequest, selection: { mode: ActiveMode; role: InvitedRole; email: string; studentId?: string }) {
    const email = normalizedInvitationEmail(selection.email);
    if (!["parent", "student", "tutor"].includes(selection.role)) throw new AccessDenied(403);
    if (selection.role === "tutor" ? selection.studentId !== undefined : typeof selection.studentId !== "string" || !uuid.test(selection.studentId)) throw new AccessDenied(403);
    const secret = createInvitationSecret();
    const pending = await input.access.withAdminCapability(request, { mode: selection.mode, capability: "manage-invites" }, async (tx, actor) => {
      requireCookieMutation(request, actor.origin);
      if (selection.studentId) {
        const student = await data.lockInvitationStudent(tx, actor.tenantId, selection.studentId);
        if (!student || student.disabledAt) throw new AccessDenied(404);
        // N21: no parent or student invitation for a student whose ceremony is done (the UI hides it; the server refuses it).
        if (await isCeremonyDone(tx, actor.tenantId, student.id)) throw new AccessDenied(404);
        if (selection.role === "student" && (studentParentContactMatches(student, email) || await data.mailboxHasParentIdentity(tx, actor.tenantId, email))) throw new AccessDenied(403);
      }
      const now = new Date();
      await data.consumeInvitationBudget(tx, actor, email, input.throttleSecret, now.getTime());
      const invitation = await data.insertInvitation(tx, { tenantId: actor.tenantId, tokenHash: secret.tokenHash, email, role: selection.role,
        studentId: selection.studentId ?? null, inviterMembershipId: actor.membershipId, createdAt: now, expiresAt: new Date(now.getTime() + invitationLifetimeMs(selection.role)) });
      await data.writeInvitationAudit(tx, actor, "invite.issue", invitation.id);
      return { invitation, actor, token: secret.token };
    });
    return deliver(pending);
  }

  async function revoke(request: CookieMutationRequest, selection: { mode: ActiveMode; inviteId: string }) {
    return input.access.withAdminCapability(request, { mode: selection.mode, capability: "manage-invites" }, async (tx, actor) => {
      requireCookieMutation(request, actor.origin);
      if (!uuid.test(selection.inviteId)) throw new AccessDenied(404);
      const invitation = await data.lockInvitation(tx, actor.tenantId, selection.inviteId);
      if (!invitation || invitation.acceptedAt || invitation.revokedAt) throw new AccessDenied(404);
      if (!await data.revokeInvitation(tx, actor.tenantId, invitation.id, new Date())) throw new AccessDenied(404);
      await data.writeInvitationAudit(tx, actor, "invite.revoke", invitation.id);
      return { inviteId: invitation.id };
    });
  }

  /**
   * Rotation, shared by "Send again" and "Copy link": the old link is revoked and a new invitation for the same person,
   * role and student is issued, with a fresh lifetime for its role, in one transaction. A copy is born in the final
   * delivery state "copied" (never "pending", so the list can't call it unconfirmed) and is audited as invite.copy, not
   * invite.issue. Audits name invitation ids only; the audit row has no column that could hold a token.
   */
  async function rotate(tx: AccessTransaction<Q>, actor: Actor, inviteId: string, tokenHash: string, copied: boolean) {
    if (!uuid.test(inviteId)) throw new AccessDenied(404);
    const previous = await data.lockInvitation(tx, actor.tenantId, inviteId);
    if (!previous || previous.acceptedAt || previous.revokedAt || previous.role === "admin") throw new AccessDenied(404);
    if (previous.studentId) {
      const student = await data.lockInvitationStudent(tx, actor.tenantId, previous.studentId);
      if (!student || student.disabledAt) throw new AccessDenied(404);
      // N21: Send again and Copy link are refused, like a new invitation, once the student's ceremony is done.
      if (await isCeremonyDone(tx, actor.tenantId, student.id)) throw new AccessDenied(404);
      if (previous.role === "student" && (studentParentContactMatches(student, previous.email) || await data.mailboxHasParentIdentity(tx, actor.tenantId, previous.email))) throw new AccessDenied(403);
    }
    const now = new Date();
    await data.consumeInvitationBudget(tx, actor, previous.email, input.throttleSecret, now.getTime());
    if (!await data.revokeInvitation(tx, actor.tenantId, previous.id, now)) throw new AccessDenied(404);
    const invitation = await data.insertInvitation(tx, { tenantId: actor.tenantId, tokenHash, email: previous.email, role: previous.role,
      studentId: previous.studentId, inviterMembershipId: actor.membershipId, createdAt: now, expiresAt: new Date(now.getTime() + invitationLifetimeMs(previous.role as InvitedRole)),
      ...(copied ? { deliveryStatus: "copied" as const, deliveryAttemptedAt: now } : {}) });
    await data.writeInvitationAudit(tx, actor, "invite.revoke", previous.id);
    await data.writeInvitationAudit(tx, actor, copied ? "invite.copy" : "invite.issue", invitation.id);
    return invitation;
  }

  async function reissue(request: CookieMutationRequest, selection: { mode: ActiveMode; inviteId: string }) {
    const secret = createInvitationSecret();
    const pending = await input.access.withAdminCapability(request, { mode: selection.mode, capability: "manage-invites" }, async (tx, actor) => {
      requireCookieMutation(request, actor.origin);
      const invitation = await rotate(tx, actor, selection.inviteId, secret.tokenHash, false);
      return { invitation, actor, token: secret.token };
    });
    return deliver(pending);
  }

  /**
   * "Copy link" (decision 12): tokens are stored hashed, so a copy rotates the invitation and the previous link stops
   * working. Only an admin who may manage invitations, in their own congregation, with a fresh sign-in. The new link
   * is returned once, in this response to this admin, and is never emailed, stored, logged or audited; nothing is sent.
   */
  async function copyLink(request: CookieMutationRequest, selection: { mode: ActiveMode; inviteId: string }) {
    const secret = createInvitationSecret();
    const copied = await input.access.withAdminCapability(request, { mode: selection.mode, capability: "manage-invites" }, async (tx, actor) => {
      requireCookieMutation(request, actor.origin);
      const invitation = await rotate(tx, actor, selection.inviteId, secret.tokenHash, true);
      return { inviteId: invitation.id, expiresAt: invitation.expiresAt, origin: actor.origin };
    });
    const url = new URL("/invitations/open", copied.origin);
    url.hash = `token=${secret.token}`;
    return Object.freeze({ inviteId: copied.inviteId, url: url.href, expiresAt: copied.expiresAt.toISOString() });
  }

  /**
   * "Needs a parent invitation" (G13), after an account request: approved members whose verified address is a roster
   * parent contact of an active student, who are not yet that student's parent here and have no live parent invitation
   * for that student. Admin only, read-only, in the admin's own congregation.
   */
  async function parentInvitationsNeeded(request: AccessRequest, selection: { mode: ActiveMode }) {
    return input.access.withAdminCapability(request, { mode: selection.mode, capability: "read-invites" }, async (tx, actor) => {
      const { members, students, links, invites } = await data.parentInvitationCandidates(tx, actor.tenantId, new Date());
      // Every address on every side goes through normalizedInvitationEmail; a malformed one matches nothing.
      const normal = (value: string | null) => { if (value === null) return null; try { return normalizedInvitationEmail(value); } catch { return null; } };
      const linked = new Set(links.map(link => `${link.studentId}|${link.membershipId}`));
      const invited = new Set(invites.flatMap(row => { const email = normal(row.email); return email && row.studentId ? [`${row.studentId}|${email}`] : []; }));
      const out: Readonly<{ memberId: string; name: string; email: string; student: Readonly<{ id: string; firstName: string; lastName: string }> }>[] = [];
      for (const member of members) {
        const email = normal(member.email);
        if (!email) continue;
        for (const student of students) {
          if (out.length >= 100) break;
          if (normal(student.parentEmail) !== email && normal(student.secondParentEmail) !== email) continue;
          if (linked.has(`${student.id}|${member.membershipId}`) || invited.has(`${student.id}|${email}`)) continue;
          if (!uuid.test(member.memberId) || !uuid.test(student.id)) throw new AccessUnavailable();
          out.push(Object.freeze({ memberId: member.memberId, name: member.name, email, student: Object.freeze({ id: student.id, firstName: student.firstName, lastName: student.lastName }) }));
        }
      }
      return Object.freeze(out);
    });
  }

  async function preview(request: AccessRequest, selection: { token: string }) {
    const hash = hashInvitationToken(selection.token);
    return input.access.withVerifiedIdentity(request, { intent: "read" }, async (tx, identity) => {
      const invitation = await data.lockInvitationByHash(tx, identity.tenantId, hash, "read");
      const now = new Date();
      assertUsableInvitation(invitation, identity, now);
      const grants = identity.membership ? await data.lockMembershipGrants(tx, identity.tenantId, identity.membership.id, "read") : [];
      if (invitation.role === "student" && grants.some(grant => grant.role === "parent")) throw new AccessDenied(404);
      if (grants.some(grant => grant.role === invitation.role && grant.revokedAt && grant.revokedAt >= invitation.createdAt)) throw new AccessDenied(404);
      const student = invitation.studentId ? await data.lockInvitationStudent(tx, identity.tenantId, invitation.studentId, "read") : null;
      if (invitation.studentId && (!student || student.disabledAt)) throw new AccessDenied(404);
      if (invitation.role === "student" && student && studentParentContactMatches(student, identity.email)) throw new AccessDenied(404);
      if (invitation.studentId && invitation.role !== "tutor") {
        const activeGrant = grants.find(grant => grant.role === invitation.role && !grant.revokedAt);
        await data.eligibleInvitedStudentLink(tx, identity.tenantId, invitation.studentId, activeGrant?.id ?? null, invitation.role, invitation.createdAt, "read");
      }
      const expiry = Math.min(now.getTime() + REVIEW_LIFETIME_MS, invitation.expiresAt.getTime(), identity.sessionExpiresAt.getTime());
      if (expiry <= now.getTime()) throw new AccessDenied(404);
      return Object.freeze({ role: invitation.role, student: student ? Object.freeze({ firstName: student.firstName, lastName: student.lastName }) : null,
        expiresAt: invitation.expiresAt.toISOString(), requiresConfirmation: true as const,
        reviewBinding: `${expiry}.${reviewDigest(invitation, identity, expiry).toString("base64url")}` });
    });
  }

  async function acceptCore(request: CookieMutationRequest, selection: { token: string; reviewBinding?: string }, reviewed: boolean) {
    const hash = hashInvitationToken(selection.token);
    return input.access.withVerifiedIdentity(request, { intent: "authority-write", mutation: true }, async (tx, identity) => {
      const invitation = await data.lockInvitationByHash(tx, identity.tenantId, hash);
      const now = new Date();
      assertUsableInvitation(invitation, identity, now);
      if (reviewed) verifyReview(invitation, identity, selection.reviewBinding, now.getTime());
      const student = invitation.studentId ? await data.lockInvitationStudent(tx, identity.tenantId, invitation.studentId) : null;
      if (invitation.studentId && (!student || student.disabledAt)) throw new AccessDenied(404);
      if (invitation.role === "student" && student && studentParentContactMatches(student, identity.email)) throw new AccessDenied(404);
      const membershipId = await data.obtainMembership(tx, identity);
      const grants = await data.lockMembershipGrants(tx, identity.tenantId, membershipId);
      if (invitation.role === "student" && grants.some((grant) => grant.role === "parent")) throw new AccessDenied(404);
      if (grants.some((grant) => grant.role === invitation.role && grant.revokedAt && grant.revokedAt >= invitation.createdAt)) throw new AccessDenied(404);
      const activeGrant = grants.find((grant) => grant.role === invitation.role && !grant.revokedAt);
      const grantId = activeGrant?.id ?? await data.insertGrant(tx, identity.tenantId, membershipId, invitation.role);
      const actor: Actor = Object.freeze({ tenantId: identity.tenantId, origin: identity.origin, userId: identity.userId,
        authSessionId: identity.authSessionId, authSessionExpiresAt: identity.sessionExpiresAt.getTime(), roleGrantRevision: activeGrant?.revision ?? 1,
        membershipId, roleGrantId: grantId, mode: invitation.role, authorityRevision: identity.membership?.authorityRevision ?? 1 });
      if (!activeGrant) await data.writeInvitationAudit(tx, actor, "grant.issue", grantId);
      if (invitation.studentId && invitation.role !== "tutor") {
        const link = await data.linkInvitedStudent(tx, identity.tenantId, invitation.studentId, grantId, invitation.role, invitation.id, invitation.createdAt);
        if (link.created) await data.writeInvitationAudit(tx, actor, invitation.role === "parent" ? "guardian.link" : "identity.link", link.id);
      }
      if (!await data.consumeInvitation(tx, identity.tenantId, invitation.id, membershipId, now)) throw new AccessDenied(404);
      await data.writeInvitationAudit(tx, actor, "invite.accept", invitation.id);
      return { inviteId: invitation.id, role: invitation.role, studentId: invitation.studentId };
    });
  }
  return Object.freeze({ issue, revoke, reissue, copyLink, parentInvitationsNeeded, preview, list,
    // Private compatibility/composition API; HTTP must exclusively use the
    // reviewed path, with raw token obtained only from its encrypted pending cookie.
    accept: (request: CookieMutationRequest, selection: { token: string }) => acceptCore(request, selection, false),
    acceptReviewed: (request: CookieMutationRequest, selection: { token: string; reviewBinding: string }) => acceptCore(request, selection, true),
  });
}
