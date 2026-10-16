import "server-only";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { createAccessService } from "../access/service";
import type { AccessDatabase, ActiveMode, Actor } from "../access/types";
import { AccessDenied, AccessUnavailable } from "../access/errors";
import { requireCookieMutation } from "../http/mutations";
import type { CookieMutationRequest } from "../http/mutations";
import { withTenantTransaction } from "../db/runtime";
import * as data from "../data/invitations";
import type { InvitedRole } from "../data/invitations";
import { createInvitationSecret, hashInvitationToken, INVITATION_LIFETIME_MS, normalizedInvitationEmail } from "./tokens";

export type InvitationTransport = (message: Readonly<{ email: string; url: string }>) => Promise<void>;
export type InvitationDeliveryStatus = "pending" | "sent" | "failed";
type Delivery = Readonly<{ inviteId: string; delivery: "sent" | "failed" | "unknown" }>;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createInvitationService<Q extends PgQueryResultHKT>(input: {
  db: AccessDatabase<Q>; access: ReturnType<typeof createAccessService<Q>>; transport: InvitationTransport; throttleSecret: string;
}) {
  if (typeof input.transport !== "function" || typeof input.throttleSecret !== "string" || input.throttleSecret.length < 32) throw new AccessUnavailable();
  async function deliver(pending: { invitation: data.IssuedInvitation; actor: Actor; token: string }): Promise<Delivery> {
    const url = new URL("/invitations/accept", pending.actor.origin);
    url.searchParams.set("token", pending.token);
    let outcome: "sent" | "failed" = "sent";
    try {
      // Issue/reissue committed before this call. Provider diagnostics and the
      // token stay private; crashes leave the durable initial state pending.
      await input.transport({ email: pending.invitation.email, url: url.toString() });
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
        if (selection.role === "student" && (normalizedInvitationEmail(student.parentEmail) === email || await data.mailboxHasParentIdentity(tx, actor.tenantId, email))) throw new AccessDenied(403);
      }
      const now = new Date();
      await data.consumeInvitationBudget(tx, actor, email, input.throttleSecret, now.getTime());
      const invitation = await data.insertInvitation(tx, { tenantId: actor.tenantId, tokenHash: secret.tokenHash, email, role: selection.role,
        studentId: selection.studentId ?? null, inviterMembershipId: actor.membershipId, createdAt: now, expiresAt: new Date(now.getTime() + INVITATION_LIFETIME_MS) });
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

  async function reissue(request: CookieMutationRequest, selection: { mode: ActiveMode; inviteId: string }) {
    const secret = createInvitationSecret();
    const pending = await input.access.withAdminCapability(request, { mode: selection.mode, capability: "manage-invites" }, async (tx, actor) => {
      requireCookieMutation(request, actor.origin);
      if (!uuid.test(selection.inviteId)) throw new AccessDenied(404);
      const previous = await data.lockInvitation(tx, actor.tenantId, selection.inviteId);
      if (!previous || previous.acceptedAt || previous.revokedAt || previous.role === "admin") throw new AccessDenied(404);
      if (previous.studentId) {
        const student = await data.lockInvitationStudent(tx, actor.tenantId, previous.studentId);
        if (!student || student.disabledAt) throw new AccessDenied(404);
        if (previous.role === "student" && (normalizedInvitationEmail(student.parentEmail) === previous.email || await data.mailboxHasParentIdentity(tx, actor.tenantId, previous.email))) throw new AccessDenied(403);
      }
      const now = new Date();
      await data.consumeInvitationBudget(tx, actor, previous.email, input.throttleSecret, now.getTime());
      if (!await data.revokeInvitation(tx, actor.tenantId, previous.id, now)) throw new AccessDenied(404);
      const invitation = await data.insertInvitation(tx, { tenantId: actor.tenantId, tokenHash: secret.tokenHash, email: previous.email, role: previous.role,
        studentId: previous.studentId, inviterMembershipId: actor.membershipId, createdAt: now, expiresAt: new Date(now.getTime() + INVITATION_LIFETIME_MS) });
      await data.writeInvitationAudit(tx, actor, "invite.revoke", previous.id);
      await data.writeInvitationAudit(tx, actor, "invite.issue", invitation.id);
      return { invitation, actor, token: secret.token };
    });
    return deliver(pending);
  }

  async function accept(request: CookieMutationRequest, selection: { token: string }) {
    const hash = hashInvitationToken(selection.token);
    return input.access.withVerifiedIdentity(request, { intent: "authority-write", mutation: true }, async (tx, identity) => {
      const invitation = await data.lockInvitationByHash(tx, identity.tenantId, hash);
      const now = new Date();
      if (!invitation || invitation.acceptedAt || invitation.revokedAt || invitation.expiresAt <= now || invitation.email !== normalizedInvitationEmail(identity.email) || invitation.role === "admin") throw new AccessDenied(404);
      const student = invitation.studentId ? await data.lockInvitationStudent(tx, identity.tenantId, invitation.studentId) : null;
      if (invitation.studentId && (!student || student.disabledAt)) throw new AccessDenied(404);
      if (invitation.role === "student" && student && normalizedInvitationEmail(student.parentEmail) === normalizedInvitationEmail(identity.email)) throw new AccessDenied(404);
      const membershipId = await data.obtainMembership(tx, identity);
      const grants = await data.lockMembershipGrants(tx, identity.tenantId, membershipId);
      if (invitation.role === "student" && grants.some((grant) => grant.role === "parent")) throw new AccessDenied(404);
      if (grants.some((grant) => grant.role === invitation.role && grant.revokedAt && grant.revokedAt >= invitation.createdAt)) throw new AccessDenied(404);
      const activeGrant = grants.find((grant) => grant.role === invitation.role && !grant.revokedAt);
      const grantId = activeGrant?.id ?? await data.insertGrant(tx, identity.tenantId, membershipId, invitation.role);
      const actor: Actor = Object.freeze({ tenantId: identity.tenantId, origin: identity.origin, userId: identity.userId,
        authSessionId: identity.authSessionId, membershipId, roleGrantId: grantId, mode: invitation.role, authorityRevision: identity.membership?.authorityRevision ?? 1 });
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
  return Object.freeze({ issue, revoke, reissue, accept });
}
