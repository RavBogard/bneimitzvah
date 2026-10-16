import "server-only";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { createAccessService } from "../access/service";
import type { AccessRequest, AccessTransaction, LockIntent, VerifiedIdentity } from "../access/types";
import { AccessDenied } from "../access/errors";
import { lockRoleGrant, lockStudent } from "../data/authority";
import type { StudentView } from "../data/students";
import * as data from "../data/practice";
import { requireCookieMutation } from "../http/mutations";
import type { CookieMutationRequest } from "../http/mutations";
import { createPracticeHandle, hashPracticeHandle, PRACTICE_HEADER, PRACTICE_LIFETIME_MS } from "./handles";
import type { PracticeActor, PracticeCapability, PracticeContextView, PracticeMode } from "./types";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const studentView = (student: StudentView): StudentView => Object.freeze({ id: student.id, firstName: student.firstName,
  lastName: student.lastName, ceremonyDate: student.ceremonyDate, revision: student.revision });
const contextView = (row: data.StoredPracticeContext, student: StudentView): PracticeContextView => Object.freeze({ id: row.id,
  authorityRevision: row.authorityRevision, studentId: student.id, studentRevision: student.revision, expiresAt: row.expiresAt.toISOString() });

export function createPracticeService<Q extends PgQueryResultHKT>(input: { access: ReturnType<typeof createAccessService<Q>> }) {
  async function authorizeChild(tx: AccessTransaction<Q>, identity: VerifiedIdentity, studentId: string, intent: LockIntent) {
    if (!identity.membership) throw new AccessDenied(403);
    const grant = await lockRoleGrant(tx, identity.tenantId, identity.membership.id, "parent", intent);
    if (!grant) throw new AccessDenied(403);
    if (typeof studentId !== "string" || !uuid.test(studentId)) throw new AccessDenied(404);
    const student = await lockStudent(tx, identity.tenantId, studentId, intent);
    if (!student || student.disabledAt) throw new AccessDenied(404);
    const guardian = await data.lockPracticeGuardian(tx, identity.tenantId, student.id, grant.id, intent);
    if (!guardian || !guardian.practiceEnabled) throw new AccessDenied(404);
    return { grant, student, guardian };
  }

  async function selectChild(request: CookieMutationRequest, selection: { studentId: string }, switching: boolean) {
    // A fresh enter must be deliberate, without accidentally retaining another
    // tab/selection's header. Switch explicitly presents the prior tab handle.
    if (!switching && request.headers.has(PRACTICE_HEADER)) throw new AccessDenied(404);
    const previousHash = switching ? hashPracticeHandle(request) : null;
    const secret = createPracticeHandle();
    return input.access.withVerifiedIdentity(request, { intent: "authority-write", mutation: true, allowPracticeContext: true }, async (tx, identity) => {
      const { grant, student, guardian } = await authorizeChild(tx, identity, selection.studentId, "authority-write");
      // Authorize the new child first. Clearing the old immutable binding does
      // not depend on its expired session context or revoked guardian/grant.
      const previous = previousHash ? await data.lockPracticeContext(tx, identity, previousHash, "authority-write") : null;
      if (previousHash && !previous) throw new AccessDenied(404);
      // Already-closed handles may be cleared, but cannot initiate a late switch.
      if (previous?.revokedAt) throw new AccessDenied(404);
      const now = new Date();
      const expiresAt = new Date(Math.min(now.getTime() + PRACTICE_LIFETIME_MS, identity.sessionExpiresAt.getTime()));
      if (expiresAt <= now) throw new AccessDenied(401);
      if (previous) {
        if (!await data.revokePracticeContext(tx, previous, now)) throw new AccessDenied(404);
        await data.writePracticeAudit(tx, previous, "context.exit");
      }
      const context = await data.insertPracticeContext(tx, { tenantId: identity.tenantId, tokenHash: secret.tokenHash, authSessionId: identity.authSessionId,
        actorUserId: identity.userId, actorMembershipId: identity.membership!.id, roleGrantId: grant.id, role: "parent", mode: "child-practice",
        actingStudentId: student.id, guardianId: guardian.id, authorityRevision: identity.membership!.authorityRevision, createdAt: now, expiresAt });
      await data.writePracticeAudit(tx, context, "context.enter");
      // Only the private POST creation response contains the raw handle. Future
      // handlers must apply no-store and never put this in URLs or log payloads.
      return Object.freeze({ handle: secret.handle, context: contextView(context, student) });
    });
  }

  async function exit(request: CookieMutationRequest) {
    const hash = hashPracticeHandle(request);
    return input.access.withVerifiedIdentity(request, { intent: "authority-write", mutation: true, allowPracticeContext: true }, async (tx, identity) => {
      const context = await data.lockPracticeContext(tx, identity, hash, "authority-write");
      if (!context) throw new AccessDenied(404);
      if (!context.revokedAt) {
        if (!await data.revokePracticeContext(tx, context, new Date())) throw new AccessDenied(404);
        await data.writePracticeAudit(tx, context, "context.exit");
      }
      return Object.freeze({ status: "closed" as const, contextId: context.id });
    });
  }

  async function withPracticeCapability<T>(request: AccessRequest & { method?: string }, selection: { mode: PracticeMode; studentId: string; capability: PracticeCapability },
    action: (tx: AccessTransaction<Q>, actor: PracticeActor, student: StudentView) => Promise<T>) {
    if (!["read", "practice-write"].includes(selection.capability) || !["student", "child-practice"].includes(selection.mode)) throw new AccessDenied(403);
    if (selection.mode === "student") {
      if (request.headers.has(PRACTICE_HEADER)) throw new AccessDenied(404);
      return input.access.withStudentCapability(request, { mode: "student", studentId: selection.studentId, capability: selection.capability }, async (tx, actor, student) => {
        if (selection.capability === "practice-write") requireCookieMutation(request, actor.origin);
        return action(tx, Object.freeze({ ...actor, mode: "student", role: "student", context: null }), student);
      });
    }
    const hash = hashPracticeHandle(request);
    const intent: LockIntent = selection.capability === "read" ? "read" : "data-write";
    return input.access.withVerifiedIdentity(request, { intent, mutation: selection.capability === "practice-write", allowPracticeContext: true }, async (tx, identity) => {
      const { grant, student, guardian } = await authorizeChild(tx, identity, selection.studentId, intent);
      // Context is last in the lock order. SHARE writes finish before an UPDATE
      // switch/revoke; if that commits first the old-handle write is denied.
      const context = await data.lockPracticeContext(tx, identity, hash, intent);
      if (!context || context.revokedAt || context.expiresAt.getTime() <= Date.now() || context.expiresAt > identity.sessionExpiresAt
        || context.roleGrantId !== grant.id || context.actingStudentId !== student.id || context.guardianId !== guardian.id
        || context.authorityRevision !== identity.membership!.authorityRevision) throw new AccessDenied(404);
      const actor: PracticeActor = Object.freeze({ tenantId: identity.tenantId, origin: identity.origin, userId: identity.userId,
        authSessionId: identity.authSessionId, membershipId: identity.membership!.id, roleGrantId: grant.id, mode: "child-practice", role: "parent",
        authorityRevision: identity.membership!.authorityRevision, studentId: student.id, relationshipId: guardian.id, context: contextView(context, student) });
      return action(tx, actor, studentView(student));
    });
  }

  return Object.freeze({
    enter: (request: CookieMutationRequest, selection: { studentId: string }) => selectChild(request, selection, false),
    switch: (request: CookieMutationRequest, selection: { studentId: string }) => selectChild(request, selection, true),
    exit,
    withPracticeCapability,
    read: (request: AccessRequest, selection: { mode: PracticeMode; studentId: string }) => withPracticeCapability(request, { ...selection, capability: "read" },
      async (_tx, actor, student) => Object.freeze({ student, mode: actor.mode, context: actor.context })),
  });
}
