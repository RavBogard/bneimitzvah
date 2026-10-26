import "server-only";
import { randomUUID } from "node:crypto";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { createAccessService } from "../access/service";
import type { AccessTransaction, Actor } from "../access/types";
import { AccessDenied } from "../access/errors";
import { requireCookieMutation, type CookieMutationRequest } from "../http/mutations";
import * as roster from "../data/roster";
import * as data from "../data/ceremony-done";
import { audit as relationshipAudit } from "../relationships/data";
import { identifier, revision } from "./validation";
import * as s from "../db/index";

/**
 * "Ceremony done" (release 1.9 N21; Daniel, decision 13; PLAN Decided here 5: ceremony done narrows access, never widens it).
 *
 * The only writer of student_ceremony_done and the only place that sets `app.ceremony_done_actor` (a structural test holds this).
 * Both writes run inside withAdminCapability (admin mode only; rabbis are admins), in the actor's own tenant, on a same-origin POST:
 * a tutor, parent or student is refused before anything is read, and 0049's policies refuse any writer that is not a live admin
 * grant of an enabled membership in this tenant.
 *
 * Setting it, in one transaction: lock the student; end every live tutor_student row of that student (one tutor.revoke audit row
 * each); insert the live row (0049 refuses it while any live tutor row is left); bump the student's revision; audit
 * ceremony-done.set. The student keeps the account, its grant and student_identity, Learn, saved readings and Study; parents keep
 * their guardian rows. Reversing fills the reversal on the live row, bumps the revision and audits ceremony-done.reverse; it
 * touches no tutor_student row, so no tutor gets access back until an admin assigns one by hand.
 */
type Access<Q extends PgQueryResultHKT> = Pick<ReturnType<typeof createAccessService<Q>>, "withAdminCapability">;
type Selection = { mode: "admin" | "tutor" | "parent" | "student"; studentId: string; expectedRevision: number };
const conflict = () => Object.freeze({ ok: false as const, code: "stale-revision" as const });

async function auditState<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, actor: Actor, action: "ceremony-done.set" | "ceremony-done.reverse", studentId: string) {
  await tx.insert(s.auditEvent).values({ tenantId: actor.tenantId, actorUserId: actor.userId, actorMembershipId: actor.membershipId, roleGrantId: actor.roleGrantId,
    mode: "admin", actingStudentId: studentId, action, targetType: "student", targetId: studentId, requestId: randomUUID() });
}

export function createCeremonyDoneService<Q extends PgQueryResultHKT>(input: { access: Access<Q>; now?: () => number }) {
  const now = input.now ?? Date.now;
  function write<T>(request: CookieMutationRequest, selection: Selection, action: (tx: AccessTransaction<Q>, actor: Actor, studentId: string, expected: number) => Promise<T>) {
    // Admin mode only: any other mode is refused here, and withAdminCapability refuses again on the live grant.
    if (selection.mode !== "admin") throw new AccessDenied(403);
    const studentId = identifier(selection.studentId), expected = revision(selection.expectedRevision);
    return input.access.withAdminCapability(request, { mode: "admin", capability: "manage-students" }, async (tx, actor) => {
      if (actor.mode !== "admin") throw new AccessDenied(403);
      requireCookieMutation(request, actor.origin);
      return action(tx, actor, studentId, expected);
    });
  }

  /** Marks the student's ceremony done and ends every tutor assignment of that student in the same transaction. */
  async function set(request: CookieMutationRequest, selection: Selection) {
    return write(request, selection, async (tx, actor, studentId, expected) => {
      const current = await roster.editableStudent(tx, actor.tenantId, studentId);
      if (!current || current.disabledAt) throw new AccessDenied(404);
      if (current.revision !== expected) return conflict();
      if (await data.liveRow(tx, actor.tenantId, studentId)) return conflict();
      const ended = await data.endTutorRows(tx, actor.tenantId, studentId, new Date(now()));
      for (const link of ended) await relationshipAudit(tx, actor, "tutor.revoke", link.id, studentId);
      await data.setActor(tx, actor.roleGrantId);
      const row = await data.insertLive(tx, actor.tenantId, studentId, actor.roleGrantId);
      await data.clearActor(tx);
      if (!row) throw new AccessDenied(403);
      const updated = await roster.updateStudent(tx, actor.tenantId, studentId, expected, {});
      if (!updated) return conflict();
      await auditState(tx, actor, "ceremony-done.set", studentId);
      if (actor.authSessionExpiresAt <= Date.now()) throw new AccessDenied(401);
      return Object.freeze({ ok: true as const, id: studentId, revision: updated.revision, endedTutorAssignments: ended.length });
    });
  }

  /** Reverses the state. Restores no tutor assignment: tutors are assigned again by hand. */
  async function reverse(request: CookieMutationRequest, selection: Selection) {
    return write(request, selection, async (tx, actor, studentId, expected) => {
      const current = await roster.editableStudent(tx, actor.tenantId, studentId);
      if (!current || current.disabledAt) throw new AccessDenied(404);
      if (current.revision !== expected) return conflict();
      const live = await data.liveRow(tx, actor.tenantId, studentId);
      if (!live) return conflict();
      await data.setActor(tx, actor.roleGrantId);
      const row = await data.reverseLive(tx, actor.tenantId, live.id, actor.roleGrantId);
      await data.clearActor(tx);
      if (!row) throw new AccessDenied(403);
      const updated = await roster.updateStudent(tx, actor.tenantId, studentId, expected, {});
      if (!updated) return conflict();
      await auditState(tx, actor, "ceremony-done.reverse", studentId);
      if (actor.authSessionExpiresAt <= Date.now()) throw new AccessDenied(401);
      return Object.freeze({ ok: true as const, id: studentId, revision: updated.revision });
    });
  }

  return Object.freeze({ set, reverse });
}
export type CeremonyDoneService = ReturnType<typeof createCeremonyDoneService>;
