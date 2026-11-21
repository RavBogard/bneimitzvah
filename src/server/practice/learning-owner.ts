import "server-only";
import { createHash } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import { AccessDenied } from "../access/errors";
import type { createAccessService } from "../access/service";
import type { AccessRequest, AccessTransaction } from "../access/types";
import { lockRoleGrant, lockStudent, lockStudentRelationship } from "../data/authority";
import { studentLearningLegacy } from "../db/student-learning-schema";
import { studentIdentity } from "../db/tenant-schema";
import type { StudentLearningKind } from "../db/student-learning-schema";
import { PRACTICE_HEADER } from "./handles";
import { PERSONAL_STUDY_HEADER, PRACTICE_STUDENT_HEADER } from "../../lib/learn/child-practice";
import type { createPracticeService } from "./service";
import type { PracticeActor } from "./types";

export type LearningOwner = Readonly<{
  tenantId: string;
  membershipId: string;
  userId: string;
  sessionExpiresAt: number;
  legacy?: Readonly<{ membershipId: string; userId: string }>;
  student?: Readonly<{ id: string; ceremonyDate: string; roleGrantId: string; delegated?: PracticeActor }>;
}>;
export type LearningAccess<Q extends PgQueryResultHKT> = {
  access: Pick<ReturnType<typeof createAccessService<Q>>, "withVerifiedIdentity">;
  practice?: Pick<ReturnType<typeof createPracticeService<Q>>, "withPracticeCapability">;
};
type Request = AccessRequest & { method?: string };
type Intent = "read" | "data-write";
type OwnerName = Pick<LearningOwner, "tenantId" | "membershipId" | "student" | "legacy">;

export const learningOwnerKey = (owner: OwnerName) => owner.legacy?.membershipId ?? (owner.student ? `student:${owner.student.id}` : owner.membershipId);
export const learningOwnerName = (namespace: string, owner: OwnerName) =>
  createHash("sha256").update(`${namespace}:${owner.tenantId}:${learningOwnerKey(owner)}`).digest("hex").slice(0, 32);

export function childLearningSelection(request: AccessRequest) {
  const child = request.headers.get(PRACTICE_STUDENT_HEADER);
  if (request.headers.has(PRACTICE_STUDENT_HEADER) !== request.headers.has(PRACTICE_HEADER)
    || child !== null && (!child || request.headers.has(PERSONAL_STUDY_HEADER))) throw new AccessDenied(403);
  return child ? { mode: "child-practice" as const, studentId: child } : null;
}

/** The student scope is installed only after the live self link or guardian context has been locked. */
export function createLearningOwnerAccess<Q extends PgQueryResultHKT>(input: LearningAccess<Q>, kind: StudentLearningKind,
  memberScope: (tx: AccessTransaction<Q>, tenantId: string, membershipId: string, legacy: boolean) => Promise<void>) {
  return async function withLearningOwner<T>(request: Request, intent: Intent,
    action: (tx: AccessTransaction<Q>, owner: LearningOwner) => Promise<T>): Promise<T> {
    if (intent !== "read" && intent !== "data-write") throw new AccessDenied(403);
    const selection = childLearningSelection(request);
    const personal = request.headers.get(PERSONAL_STUDY_HEADER);
    if (personal !== null && personal !== "1") throw new AccessDenied(403);
    const run = async (tx: AccessTransaction<Q>, owner: LearningOwner) => {
      const assertLive = () => { if (owner.sessionExpiresAt <= Date.now()) throw new AccessDenied(401); };
      assertLive();
      if (owner.student) {
        await tx.execute(sql`select set_config('app.learning_student', ${owner.student.id}, true),
          set_config('app.learning_kind', ${kind}, true)`);
        const [legacy] = await tx.select({ membershipId: studentLearningLegacy.membershipId, userId: studentLearningLegacy.userId })
          .from(studentLearningLegacy).where(and(eq(studentLearningLegacy.tenantId, owner.tenantId), eq(studentLearningLegacy.studentId, owner.student.id))).limit(1);
        if (legacy) {
          await memberScope(tx, owner.tenantId, legacy.membershipId, true);
          owner = { ...owner, legacy };
        }
      } else {
        // A former account for this student cannot open the legacy row as personal progress
        // after the live student link is gone or has been reassigned.
        await tx.execute(sql`select set_config('app.learning_member', ${owner.membershipId}, true)`);
        const [legacy] = await tx.select({ membershipId: studentLearningLegacy.membershipId }).from(studentLearningLegacy)
          .where(and(eq(studentLearningLegacy.tenantId, owner.tenantId), eq(studentLearningLegacy.membershipId, owner.membershipId))).limit(1);
        if (legacy) throw new AccessDenied(403);
        await memberScope(tx, owner.tenantId, owner.membershipId, false);
      }
      const result = await action(tx, owner);
      assertLive();
      return result;
    };
    if (selection) {
      if (!input.practice) throw new AccessDenied(403);
      return input.practice.withPracticeCapability(request, { ...selection, capability: intent === "read" ? "read" : "practice-write" },
        async (tx, actor, student) => {
          if (!actor.context || actor.mode !== "child-practice") throw new AccessDenied(403);
          return run(tx, { tenantId: actor.tenantId, membershipId: actor.membershipId, userId: actor.userId,
            sessionExpiresAt: Math.min(actor.authSessionExpiresAt, Date.parse(actor.context.expiresAt)),
            student: { id: student.id, ceremonyDate: student.ceremonyDate, roleGrantId: actor.roleGrantId, delegated: actor } });
        });
    }

    return input.access.withVerifiedIdentity(request, { intent, mutation: intent !== "read" }, async (tx, identity) => {
      if (!identity.membership) throw new AccessDenied(403);
      const { tenantId, userId } = identity, membershipId = identity.membership.id;
      const grant = personal ? undefined : await lockRoleGrant(tx, tenantId, membershipId, "student", intent);
      const [link] = grant ? await tx.select({ studentId: studentIdentity.studentId }).from(studentIdentity)
        .where(and(eq(studentIdentity.tenantId, tenantId), eq(studentIdentity.roleGrantId, grant.id), isNull(studentIdentity.revokedAt))).limit(1) : [];
      const current = link ? await lockStudent(tx, tenantId, link.studentId, intent) : undefined;
      const student = grant && current && !current.disabledAt && await lockStudentRelationship(tx, tenantId, current.id, grant.id, "student", intent)
        ? { id: current.id, ceremonyDate: current.ceremonyDate, roleGrantId: grant.id } : undefined;
      return run(tx, { tenantId, membershipId, userId, student, sessionExpiresAt: identity.sessionExpiresAt.getTime() });
    });
  };
}
