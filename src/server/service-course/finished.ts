import "server-only";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { createAccessService } from "../access/service";
import type { AccessRequest, AccessTransaction } from "../access/types";
import { AccessDenied } from "../access/errors";
import { lockRoleGrant, lockStudent, lockStudentRelationship } from "../data/authority";
import * as data from "../data/service-part-finished";
import { lessonForUnit, tenantFile } from "../../lib/service-course/path";
import type { Tenant } from "../../lib/service-course/course";
import { lessonsDoneBy, type Progress } from "../../lib/service-course/progress";

/**
 * The per-part "finished" mark (2.0 SC5, A4 9; Daniel, Batch 3 Q12 and Batch 3b Q18). This widens ruling 45 for the service
 * course only: a student's assigned tutors and the congregation's admins (rabbis are admins) see, for each part on the student's
 * service plan, whether the student has finished that part's lesson, and on which day. Nothing else: no answers, attempts,
 * scores, counts or other lessons. Parents in parent view never see it.
 *
 * The only place that sets `app.service_part_reader` (a structural test holds this), and only in two ways:
 * - `markFinishedParts`, from inside the student's own progress sync (progress-service.ts), with the student's own live student
 *   grant after the grant, student and link are share-locked in the house order;
 * - `read`, the staff read behind `GET /api/students/{id}/service-finished`, with the tutor's or admin's grant after
 *   withStudentCapability has checked the live grant and, for a tutor, the live tutor_student row.
 * Nothing sets `app.service_part_context` yet: the course carries no practice context (SC4 item 7), so no parent in child practice
 * reads or writes here; 0048's policy admits one only with a live child-practice context naming that child.
 */
type Access<Q extends PgQueryResultHKT> = Pick<ReturnType<typeof createAccessService<Q>>, "withStudentCapability">;
export type FinishedPart = Readonly<{ lesson: string; finished: string | null }>;
export type FinishedParts = Readonly<{ parts: readonly FinishedPart[] }>;
/** The member whose progress was just saved: the owner of the service-course progress document, fixed for one request. */
type Owner = Readonly<{ tenantId: string; membershipId: string; userId: string }>;

/** The plan's parts as course lessons, in service order, each once; a unit no lesson teaches is left out (A4 6.3 step 4). */
export function assignedLessons(tenant: Tenant, unitIds: readonly string[]): string[] {
  const out: string[] = [];
  for (const unit of unitIds) { const lesson = lessonForUnit(tenant, unit); if (lesson && !out.includes(lesson)) out.push(lesson); }
  return out;
}

/**
 * After the member's own progress is stored: every lesson the stored document has done under this account (its `by` is `stamp`, the
 * member's own owner name; Daniel, 2026-10-26, "Count only signed-in", 2.0 SC5a) that is one of the member's own student's
 * assigned parts, and is not yet marked, is marked now (finished_at is the server's now()). A side effect of sync, not a request of
 * its own: a lesson done signed out, or sent by an older browser (no `by`), a member without a live student grant and link (a parent, a tutor, an approved Member), a student with no plan, and every
 * lesson outside the plan (fluency, Review, any other prayer) write nothing. Runs in a savepoint of the sync's own transaction, so a
 * failure here never loses the student's progress; the next sync marks what this one could not, from the whole stored document.
 */
export async function markFinishedParts<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, owner: Owner, progress: Progress, stamp: string): Promise<readonly string[]> {
  const tenant = tenantFile(owner.tenantId), done = lessonsDoneBy(progress, stamp);
  if (!tenant || !done.length) return [];
  try {
    return await tx.transaction(async sp => {
      const grant = await lockRoleGrant(sp, owner.tenantId, owner.membershipId, "student", "read");
      if (!grant || grant.revokedAt) return [];
      const studentId = await data.studentOfGrant(sp, owner.tenantId, grant.id);
      if (!studentId) return [];
      const student = await lockStudent(sp, owner.tenantId, studentId, "read");
      if (!student || student.disabledAt) return [];
      if (!await lockStudentRelationship(sp, owner.tenantId, student.id, grant.id, "student", "read")) return [];
      const units = await data.planUnits(sp, owner.tenantId, student.id);
      const parts = new Set(assignedLessons(tenant, units ?? []));
      const due = done.filter(lesson => parts.has(lesson));
      if (!due.length) return [];
      await data.setReader(sp, grant.id);
      const marked = await data.insertFinished(sp, owner.tenantId, student.id, due);
      await data.auditFinished(sp, { tenantId: owner.tenantId, userId: owner.userId, membershipId: owner.membershipId, roleGrantId: grant.id }, student.id, marked);
      await data.clearReader(sp);
      return marked;
    });
  } catch {
    // A fixed line only: a driver error can carry the query's parameters (a student id), so nothing of it is written.
    try { console.error(JSON.stringify({ event: "service-part.finish-skipped" })); } catch { /* Logging cannot change the outcome. */ }
    return [];
  }
}

export function createServicePartFinished<Q extends PgQueryResultHKT>(input: { access: Access<Q> }) {
  return Object.freeze({
    /**
     * A tutor's or admin's view of one student's parts: one row per part on the plan, in service order, with the day it was
     * finished or null. Another mode is refused before anything is read; a tutor without a live tutor_student row for this student
     * is refused by withStudentCapability (404, the same as a student who does not exist), and RLS would show them no rows anyway.
     */
    async read(request: AccessRequest, selection: { mode: "tutor" | "admin"; studentId: string }): Promise<FinishedParts> {
      if (selection.mode !== "tutor" && selection.mode !== "admin") throw new AccessDenied(403);
      return input.access.withStudentCapability(request, { mode: selection.mode, studentId: selection.studentId, capability: "read" }, async (tx, actor, student) => {
        if (actor.mode !== "tutor" && actor.mode !== "admin") throw new AccessDenied(403);
        const tenant = tenantFile(actor.tenantId);
        // A congregation without a course file has no course, so no parts to show (A4 12).
        if (!tenant) return Object.freeze({ parts: Object.freeze([]) });
        const lessons = assignedLessons(tenant, await data.planUnits(tx, actor.tenantId, student.id) ?? []);
        await data.setReader(tx, actor.roleGrantId);
        const rows = lessons.length ? await data.finishedDays(tx, actor.tenantId, student.id) : [];
        await data.clearReader(tx);
        if (actor.authSessionExpiresAt <= Date.now()) throw new AccessDenied(401);
        const days = new Map(rows.map(row => [row.lessonId, row.day]));
        return Object.freeze({ parts: Object.freeze(lessons.map(lesson => Object.freeze({ lesson, finished: days.get(lesson) ?? null }))) });
      });
    },
  });
}
export type ServicePartFinishedService = ReturnType<typeof createServicePartFinished>;
