import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import { eq } from "drizzle-orm";
import { AccessDenied, AccessUnavailable } from "../access/errors";
import type { createAccessService } from "../access/service";
import type { AccessDatabase, AccessRequest, AccessTransaction, Actor } from "../access/types";
import { withTenantTransaction } from "../db/runtime";
import { requireCookieMutation } from "../http/mutations";
import type { AccountMailKind, AccountMailOutcome } from "../mail/transport";
import { linkRequestedStudent } from "../learners/link";
import * as s from "../db/index";
import * as data from "./data";
import * as validate from "./validation";

/**
 * Release 1.4 accounts (plan sections 2b, 3, 4). Anyone signed in may ask for an account; an admin, or a tutor an
 * admin designated, approves it into the Member role (a tenant_member row, never a role_grant). Exactly two emails
 * exist: a request tells the approvers, an approval tells the new member. Both are sent after their transaction
 * commits, and only by the production transport.
 */
export type AccountMailSender = (kind: AccountMailKind, to: string, tenant: Readonly<{ name: string; productName: string }>, idempotencyKey: string) => Promise<AccountMailOutcome>;
type Request = AccessRequest & { method?: string };
type Mode = validate.ApproverMode;
// Readings for everyone (plan D6, decision 4): approving with a target links the account to a student record through the
// invitation layer's writes in src/server/learners/link.ts, the one grant an approval ever causes (the structural test names it).
const failed = <C extends string>(code: C) => ({ ok: false as const, code });
/** A stable UUID from a string, for the provider's idempotency key. */
const derivedKey = (value: string) => {
  const hex = createHash("sha256").update(value).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${((parseInt(hex[16], 16) & 3) | 8).toString(16)}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};

export function createAccountsService<Q extends PgQueryResultHKT>(input: {
  db: AccessDatabase<Q>; access: Pick<ReturnType<typeof createAccessService<Q>>, "withVerifiedIdentity" | "withAccountsCapability">;
  send: AccountMailSender; throttleSecret: string; now?: () => number;
}) {
  if (typeof input.send !== "function" || typeof input.throttleSecret !== "string" || input.throttleSecret.length < 32) throw new AccessUnavailable();
  const now = input.now ?? Date.now;

  /** An approver's capability: admin mode, or tutor mode with a live designation on that very tutor grant. */
  function withApprover<T>(request: Request, mode: Mode, capability: "read-accounts" | "manage-accounts", action: (tx: AccessTransaction<Q>, actor: Actor) => Promise<T>) {
    return input.access.withAccountsCapability(request, { mode, capability }, async (tx, actor) => {
      if (capability === "manage-accounts") requireCookieMutation(request, actor.origin);
      if (actor.mode === "tutor" && !await data.liveDesignation(tx, actor.tenantId, actor.membershipId, actor.roleGrantId)) throw new AccessDenied(403);
      return action(tx, actor);
    });
  }
  function withAdmin<T>(request: Request, capability: "read-accounts" | "manage-accounts" | "manage-approvers", action: (tx: AccessTransaction<Q>, actor: Actor) => Promise<T>) {
    return input.access.withAccountsCapability(request, { mode: "admin", capability }, async (tx, actor) => {
      if (actor.mode !== "admin") throw new AccessDenied(403);
      if (capability !== "read-accounts") requireCookieMutation(request, actor.origin);
      return action(tx, actor);
    });
  }
  /** After commit: send, then record what happened in a second transaction. Never fails the caller. */
  async function deliver(tenantId: string, sends: readonly { to: string; key: string }[], kind: AccountMailKind, names: { name: string; productName: string }, record: (tx: AccessTransaction<Q>, status: "sent" | "failed" | "skipped") => Promise<void>) {
    // All recipients at once, each bounded by the transport's own timeout, so the reply never waits on them one by one.
    const outcomes = await Promise.all(sends.map(item => input.send(kind, item.to, names, item.key).catch((): AccountMailOutcome => "unknown")));
    const sent = outcomes.filter(outcome => outcome === "sent").length, skipped = outcomes.filter(outcome => outcome === "skipped").length;
    const status = sent ? "sent" : !sends.length || skipped === sends.length ? "skipped" : "failed";
    try { await withTenantTransaction(input.db, { tenantId }, tx => record(tx, status)); } catch { /* The status stays pending; nothing is resent. */ }
    return status;
  }

  return Object.freeze({
    /** What the signed-in person can do about an account: already a member, waiting, or able to ask. */
    async requestState(request: Request) {
      return input.access.withVerifiedIdentity(request, { intent: "read" }, async (tx, identity) => {
        const [account] = await tx.select({ name: s.user.name }).from(s.user).where(eq(s.user.id, identity.userId)).limit(1);
        // The account's own name, when it is a plain name rather than an address.
        const shown = account ? validate.shownName(account.name) : "", suggestedName = shown === "Portal member" ? "" : shown;
        const { productName } = await data.tenantNames(tx, identity.tenantId);
        if (identity.membership && await data.activeMember(tx, identity.tenantId, identity.membership.id)) return { ok: true as const, state: "member" as const, suggestedName, productName };
        const pending = await data.requestOf(tx, identity.tenantId, identity.userId);
        return { ok: true as const, state: pending ? "pending" as const : "requestable" as const, suggestedName, productName };
      });
    },

    /** Ask for an account. Idempotent while pending; 3 a day per person; at most 50 waiting; 12 request emails an hour. */
    async request(request: Request, supplied: unknown) {
      const value = validate.request(supplied);
      const result = await input.access.withVerifiedIdentity(request, { intent: "data-write", mutation: true }, async (tx, identity) => {
        if (identity.membership && await data.activeMember(tx, identity.tenantId, identity.membership.id)) return { ok: true as const, state: "member" as const, mail: null };
        await data.lockRequestQueue(tx, identity.tenantId);
        if (await data.requestOf(tx, identity.tenantId, identity.userId)) return { ok: true as const, state: "pending" as const, mail: null };
        const at = now();
        // A full queue is refused before the person's own daily budget is spent.
        if (await data.pendingCount(tx, identity.tenantId) >= data.ACCOUNT_LIMITS.pendingPerTenant) return failed("busy");
        if (!await data.consume(tx, { tenantId: identity.tenantId, scope: "account-request", subject: identity.userId, limit: data.ACCOUNT_LIMITS.requestsPerDay, secret: input.throttleSecret, now: at }))
          return failed("rate-limited");
        // A named student record must be this congregation's and enabled; the approver still chooses whom to link.
        if (value.studentId && !await data.requestableStudent(tx, identity.tenantId, value.studentId)) throw new AccessDenied(404);
        const row = await data.insertRequest(tx, identity.tenantId, identity.userId, value.name, value.purpose, value.studentId);
        if (!row) return { ok: true as const, state: "pending" as const, mail: null };
        // Over the congregation's hourly mail budget the request still waits in the list; only its email is skipped.
        if (!await data.consume(tx, { tenantId: identity.tenantId, scope: "account-mail", subject: "requests", limit: data.ACCOUNT_LIMITS.requestMailsPerHour, secret: input.throttleSecret, now: at })) {
          await data.markRequestNotice(tx, identity.tenantId, row.id, "skipped", new Date(at));
          return { ok: true as const, state: "pending" as const, mail: null };
        }
        const recipients = await data.approverRecipients(tx, identity.tenantId, data.ACCOUNT_LIMITS.recipients);
        return { ok: true as const, state: "pending" as const, mail: { tenantId: identity.tenantId, requestId: row.id, recipients, names: await data.tenantNames(tx, identity.tenantId) } };
      });
      if (!result.ok) return result;
      if (result.mail) {
        const mail = result.mail;
        await deliver(mail.tenantId, mail.recipients.map(row => ({ to: row.email, key: derivedKey(`${mail.requestId}:${row.userId}`) })), "account-request", mail.names,
          (tx, status) => data.markRequestNotice(tx, mail.tenantId, mail.requestId, status, new Date(now())));
      }
      return { ok: true as const, state: result.state };
    },

    async summary(request: Request, mode: Mode) {
      return withApprover(request, mode, "read-accounts", async (tx, actor) => ({ ok: true as const, requests: await data.pendingCount(tx, actor.tenantId) }));
    },
    /** The queue, with each requester's verified email so an approver can spot impersonation. */
    async requests(request: Request, mode: Mode) {
      return withApprover(request, mode, "read-accounts", async (tx, actor) => ({ ok: true as const,
        requests: (await data.listRequests(tx, actor.tenantId, data.ACCOUNT_LIMITS.pendingPerTenant)).map(row => ({ id: row.id, name: row.name, purpose: row.purpose,
          email: row.verified ? row.email : null, requestedAt: row.requestedAt.toISOString(),
          student: row.studentId && row.studentFirstName && row.studentLastName ? { id: row.studentId, firstName: row.studentFirstName, lastName: row.studentLastName } : null })), productName: (await data.tenantNames(tx, actor.tenantId)).productName }));
    },
    /**
     * Approve: the Member role and, when it is new, one email to that person. With a target student (plan D6), the account is
     * linked to that student record first, which does grant the student role, as accepting a student invitation would; the email
     * then says "linked". An approver never decides their own request (someone who asked, then became a designated tutor); it is
     * kept for another approver.
     */
    async approve(request: Request, supplied: unknown) {
      const value = validate.decision(supplied);
      const result = await withApprover(request, value.mode, "manage-accounts", async (tx, actor) => {
        const pending = await data.lockRequest(tx, actor.tenantId, value.requestId);
        if (!pending) throw new AccessDenied(404);
        if (pending.userId === actor.userId) return failed("own-request");
        const requester = await data.lockRequester(tx, actor.tenantId, pending.userId);
        if (!requester.account) throw new AccessDenied(404);
        if (requester.membership?.disabledAt) return failed("disabled");
        const membership = requester.membership ?? await data.insertMembership(tx, actor.tenantId, pending.userId);
        let member = await data.activeMember(tx, actor.tenantId, membership.id, "update"), created = false;
        // Only an admin approves again someone an admin ended (Decided here, 2026-10-23); the request is kept for one.
        if (!member && actor.mode !== "admin" && requester.membership && await data.wasEnded(tx, actor.tenantId, membership.id)) return failed("admin-only");
        // The link comes first: a refusal (identity taken, account already linked) keeps the request and writes no member row.
        if (value.studentId) { const linked = await linkRequestedStudent(tx, actor, membership.id, value.studentId); if (!linked.ok) return linked; }
        if (!member) { member = await data.insertMember(tx, { tenantId: actor.tenantId, membershipId: membership.id, userId: pending.userId, displayName: pending.displayName, approvedBy: actor.membershipId }); created = true; }
        if (!await data.deleteRequest(tx, actor.tenantId, pending.id)) throw new Error("Account request unavailable");
        await data.audit(tx, actor, "account-request.approve", "tenant_member", member.id, randomUUID());
        const mail = created && requester.account.verified ? { tenantId: actor.tenantId, memberId: member.id, to: requester.account.email, names: await data.tenantNames(tx, actor.tenantId) } : null;
        return { ok: true as const, memberId: member.id, linked: value.studentId !== null, mail };
      });
      if (!result.ok) return result;
      if (result.mail) {
        const mail = result.mail;
        await deliver(mail.tenantId, [{ to: mail.to, key: mail.memberId }], result.linked ? "account-linked" : "account-approved", mail.names, (tx, status) => data.markWelcome(tx, mail.tenantId, mail.memberId, status, new Date(now())));
      }
      return { ok: true as const, memberId: result.memberId, linked: result.linked };
    },
    /**
     * Decline: the request is removed and nothing is sent. One's own request may be declined: it grants nothing, and it
     * is how an approver who asked before gaining a role clears it (a lone admin has no one else to).
     */
    async decline(request: Request, supplied: unknown) {
      const value = validate.decision(supplied);
      return withApprover(request, value.mode, "manage-accounts", async (tx, actor) => {
        const pending = await data.lockRequest(tx, actor.tenantId, value.requestId);
        if (!pending) throw new AccessDenied(404);
        if (!await data.deleteRequest(tx, actor.tenantId, pending.id)) throw new Error("Account request unavailable");
        await data.audit(tx, actor, "account-request.decline", "account_request", pending.id, randomUUID());
        return { ok: true as const };
      });
    },

    /** Members, for admins: names and since when only. No email, no counts, nothing saved. */
    async members(request: Request) {
      return withAdmin(request, "read-accounts", async (tx, actor) => ({ ok: true as const,
        members: (await data.listMembers(tx, actor.tenantId, 500)).map(row => ({ id: row.id, name: row.name, since: row.since.toISOString() })) }));
    },
    async endMember(request: Request, supplied: unknown) {
      const value = validate.endMember(supplied);
      return withAdmin(request, "manage-accounts", async (tx, actor) => {
        const ended = await data.endMember(tx, actor, value.memberId);
        if (!ended) throw new AccessDenied(404);
        await data.audit(tx, actor, "member.revoke", "tenant_member", ended.id, randomUUID());
        return { ok: true as const };
      });
    },

    async approvers(request: Request) {
      return withAdmin(request, "read-accounts", async (tx, actor) => {
        const view = await data.approverView(tx, actor.tenantId);
        return { ok: true as const, admins: view.admins.map(row => validate.shownName(row.name)),
          designated: view.designated.map(row => ({ id: row.id, name: validate.shownName(row.name) })),
          candidates: view.candidates.map(row => ({ tutorGrantId: row.tutorGrantId, name: validate.shownName(row.name) })) };
      });
    },
    /** Designate a tutor (never an admin: admins already approve). Needs a fresh sign-in. */
    async addApprover(request: Request, supplied: unknown) {
      const value = validate.addApprover(supplied);
      return withAdmin(request, "manage-approvers", async (tx, actor) => {
        const grant = await data.lockTutorGrant(tx, actor.tenantId, value.tutorGrantId);
        if (!grant || grant.role !== "tutor" || grant.revokedAt || grant.disabledAt) throw new AccessDenied(404);
        if (await data.hasActiveAdmin(tx, actor.tenantId, grant.membershipId)) return failed("admin");
        const existing = await data.activeDesignationOf(tx, actor.tenantId, grant.membershipId);
        if (existing && !existing.grantRevokedAt) return failed("designated");
        // A tutor whose earlier grant (and so designation) ended and who teaches again: close the dead designation first.
        if (existing && await data.revokeDesignation(tx, actor, existing.id)) await data.audit(tx, actor, "approver.revoke", "account_approver", existing.id, randomUUID());
        const row = await data.insertDesignation(tx, actor, grant);
        if (!row) return failed("designated");
        await data.audit(tx, actor, "approver.designate", "account_approver", row.id, randomUUID());
        return { ok: true as const, approverId: row.id };
      });
    },
    async removeApprover(request: Request, supplied: unknown) {
      const value = validate.removeApprover(supplied);
      return withAdmin(request, "manage-accounts", async (tx, actor) => {
        const row = await data.revokeDesignation(tx, actor, value.approverId);
        if (!row) throw new AccessDenied(404);
        await data.audit(tx, actor, "approver.revoke", "account_approver", row.id, randomUUID());
        return { ok: true as const };
      });
    },
  });
}
export type AccountsService = ReturnType<typeof createAccountsService>;
