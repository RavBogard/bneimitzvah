import "server-only";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { createAuthStack } from "../auth/factory";
import { lockRoleGrant, lockStudent, lockStudentRelationship } from "../data/authority";
import { createVerifiedIdentityAccess } from "./identity";
import { lockVisibleStudentCandidates } from "../data/students";
import type { StudentPage, StudentView } from "../data/students";
import { requireCookieMutation } from "../http/mutations";
import { AccessDenied } from "./errors";
import type { AccessDatabase, AccessRequest, AccessTransaction, ActiveMode, Actor, DeploymentScope, LockIntent, StudentActor } from "./types";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type StudentCapability = "read" | "set-reading" | "practice-write";
type AdminCapability = "read-relationships" | "manage-students" | "manage-invites" | "manage-relationships" | "manage-defaults";
const adminRules: Record<AdminCapability, { fresh: boolean; intent: LockIntent }> = {
  "read-relationships": { fresh: false, intent: "read" },
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
  const withVerifiedIdentity = createVerifiedIdentityAccess(input);

  async function withActor<T>(request: AccessRequest, mode: ActiveMode, intent: LockIntent, fresh: boolean, action: (tx: AccessTransaction<Q>, actor: Actor) => Promise<T>) {
    // Base-mode services must not silently ignore a child-practice header and
    // grant a parent's overlapping staff role. Only practice consumes it.
    if (request.headers.has("X-Practice-Context")) throw new AccessDenied(403);
    return withVerifiedIdentity(request, { intent, fresh }, async (tx, identity) => {
      if (!["student", "parent", "tutor", "admin"].includes(mode)) throw new AccessDenied(403);
        if (!identity.membership) throw new AccessDenied(403);
        const grant = await lockRoleGrant(tx, identity.tenantId, identity.membership.id, mode, intent);
        if (!grant || grant.revokedAt) throw new AccessDenied(403);
        const actor: Actor = Object.freeze({
          tenantId: identity.tenantId, origin: identity.origin, userId: identity.userId, authSessionId: identity.authSessionId,
          membershipId: identity.membership.id, roleGrantId: grant.id, mode, authorityRevision: identity.membership.authorityRevision,
        });
        return action(tx, actor);
    });
  }

  async function withStudentCapability<T>(request: AccessRequest, selection: { mode: ActiveMode; studentId: string; capability: StudentCapability }, action: (tx: AccessTransaction<Q>, actor: StudentActor, student: StudentView) => Promise<T>) {
    if (!["read", "set-reading", "practice-write"].includes(selection.capability)) throw new AccessDenied(403);
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
      if (selection.capability === "practice-write") {
        if (actor.mode !== "student") throw new AccessDenied(403);
        requireCookieMutation(request, actor.origin);
      }
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
    withVerifiedIdentity,
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
