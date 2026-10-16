import "server-only";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { createAuthStack } from "../auth/factory";
import { withTenantTransaction } from "../db/runtime";
import { resolveTenantHost } from "../tenancy/resolve";
import { lockActorRecords, lockStudent, lockStudentRelationship } from "../data/authority";
import { lockVisibleStudentCandidates } from "../data/students";
import type { StudentPage, StudentView } from "../data/students";
import { AccessDenied, AccessUnavailable } from "./errors";
import type { AccessDatabase, AccessRequest, AccessTransaction, ActiveMode, Actor, DeploymentScope, LockIntent, StudentActor } from "./types";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type StudentCapability = "read" | "set-reading";
type AdminCapability = "manage-students" | "manage-invites" | "manage-relationships" | "manage-defaults";
const adminRules: Record<AdminCapability, { fresh: boolean; intent: LockIntent }> = {
  "manage-students": { fresh: false, intent: "authority-write" },
  "manage-invites": { fresh: true, intent: "authority-write" },
  "manage-relationships": { fresh: true, intent: "authority-write" },
  "manage-defaults": { fresh: false, intent: "authority-write" },
};

const studentView = (row: StudentView): StudentView => Object.freeze({
  id: row.id, firstName: row.firstName, lastName: row.lastName, ceremonyDate: row.ceremonyDate, revision: row.revision,
});

export function createAccessService<Q extends PgQueryResultHKT>(input: {
  db: AccessDatabase<Q>;
  auth: Pick<ReturnType<typeof createAuthStack>, "api">;
  deployment: DeploymentScope;
}) {
  const { db, auth } = input;
  const deployment = Object.freeze({ ...input.deployment });

  async function withActor<T>(request: AccessRequest, mode: ActiveMode, intent: LockIntent, fresh: boolean, action: (tx: AccessTransaction<Q>, actor: Actor) => Promise<T>) {
    try {
      const resolved = await resolveTenantHost(db, request, deployment);
      if (!["student", "parent", "tutor", "admin"].includes(mode)) throw new AccessDenied(403);
      // This is the actual Better Auth cookie/session API, not a caller-provided
      // actor ID. Cache and refresh are disabled; live rows are locked below.
      const proof = await auth.api.getSession({ headers: new Headers(request.headers), query: { disableCookieCache: true, disableRefresh: true } });
      if (!proof || proof.session.userId !== proof.user.id) throw new AccessDenied(401);
      return await withTenantTransaction(db, resolved, async (tx) => {
        const records = await lockActorRecords(tx, resolved.tenantId, { id: proof.session.id, userId: proof.user.id, token: proof.session.token }, mode, intent);
        const now = Date.now();
        if (!records.tenant?.enabled) throw new AccessDenied(404);
        if (!records.user || !records.session || records.session.userId !== records.user.id || records.session.expiresAt.getTime() <= now) throw new AccessDenied(401);
        if (!records.user.verified || !records.membership || records.membership.disabledAt || !records.grant || records.grant.revokedAt) throw new AccessDenied(403);
        if (fresh && now - records.session.createdAt.getTime() >= 15 * 60_000) throw new AccessDenied(403);
        const actor: Actor = Object.freeze({
          tenantId: resolved.tenantId, userId: records.user.id, authSessionId: records.session.id,
          membershipId: records.membership.id, roleGrantId: records.grant.id, mode, authorityRevision: records.membership.authorityRevision,
        });
        return action(tx, actor);
      });
    } catch (error) {
      if (error instanceof AccessDenied) throw error;
      // Keep provider/SQL diagnostics, cookie material and record values internal.
      throw new AccessUnavailable();
    }
  }

  async function withStudentCapability<T>(request: AccessRequest, selection: { mode: ActiveMode; studentId: string; capability: StudentCapability }, action: (tx: AccessTransaction<Q>, actor: StudentActor, student: StudentView) => Promise<T>) {
    if (!["read", "set-reading"].includes(selection.capability)) throw new AccessDenied(403);
    const intent: LockIntent = selection.capability === "read" ? "read" : "data-write";
    return withActor(request, selection.mode, intent, false, async (tx, actor) => {
      if (!uuid.test(selection.studentId)) throw new AccessDenied(404);
      const student = await lockStudent(tx, actor.tenantId, selection.studentId, intent);
      if (!student || student.disabledAt) throw new AccessDenied(404);
      const relationship = await lockStudentRelationship(tx, actor.tenantId, student.id, actor.roleGrantId, actor.mode, intent);
      if (!relationship) throw new AccessDenied(404);
      // First establish view access, then distinguish forbidden action from an
      // unavailable target. Foreign/missing/unrelated IDs share the same denial.
      if (selection.capability === "set-reading" && actor.mode !== "admin" && actor.mode !== "tutor") throw new AccessDenied(403);
      return action(tx, Object.freeze({ ...actor, studentId: student.id, relationshipId: relationship.id }), studentView(student));
    });
  }

  async function withAdminCapability<T>(request: AccessRequest, selection: { mode: ActiveMode; capability: AdminCapability }, action: (tx: AccessTransaction<Q>, actor: Actor) => Promise<T>) {
    if (!Object.hasOwn(adminRules, selection.capability)) throw new AccessDenied(403);
    const rule = adminRules[selection.capability];
    return withActor(request, selection.mode, rule.intent, rule.fresh, async (tx, actor) => {
      if (actor.mode !== "admin") throw new AccessDenied(403);
      return action(tx, actor);
    });
  }

  return Object.freeze({
    // Callback APIs are INTERNAL server composition, never transport handlers.
    // A trusted operation chooses its literal capability and callback; callers
    // supply only a mode selector/target, both checked against live authority.
    withStudentCapability,
    withAdminCapability,
    readStudent: (request: AccessRequest, selection: { mode: ActiveMode; studentId: string }) => withStudentCapability(request, { ...selection, capability: "read" }, async (_tx, _actor, student) => student),
    listStudents: (request: AccessRequest, selection: { mode: ActiveMode } & StudentPage) => withActor(request, selection.mode, "read", false, async (tx, actor) => {
      if ((selection.afterId !== undefined && !uuid.test(selection.afterId)) || (selection.limit !== undefined && (!Number.isInteger(selection.limit) || selection.limit < 1 || selection.limit > 100))) throw new AccessDenied(403);
      // Lock all candidate student rows in ID order before their relationships.
      // Recheck each live link after acquiring the student locks; a revoked link
      // disappears instead of surviving from an earlier candidate query.
      const candidates = await lockVisibleStudentCandidates(tx, actor, selection);
      const visible: StudentView[] = [];
      for (const student of candidates) {
        if (await lockStudentRelationship(tx, actor.tenantId, student.id, actor.roleGrantId, actor.mode, "read")) visible.push(studentView(student));
      }
      return visible;
    }),
  });
}
