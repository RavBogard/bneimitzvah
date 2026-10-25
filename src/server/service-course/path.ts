import "server-only";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { createAccessService } from "../access/service";
import type { AccessRequest } from "../access/types";
import { AccessDenied, AccessUnavailable } from "../access/errors";
import { assignedItems, defaultItems, tenantFile, type Path, type PathPlan } from "../../lib/service-course/path";

/**
 * A signed-in student's own path through the service course (2.0 SC4, A4 6.3), behind `GET /api/learn/service/path`.
 * It composes two existing reads and adds no authority of its own:
 * 1. the student's own student record, through `listStudents` in student mode (a live student grant and its live
 *    student_identity link; no practice context; signed out is 401, any other account 403);
 * 2. that student's service plan, through the service-learning `metadata` read in student mode, which checks the same
 *    relationship again in its own transaction.
 * The plan's Beit Mitzvah unit ids become lesson ids through the congregation's course file; each unit's `name` and `caption`
 * (licensed feed text) are dropped here and never leave the server. Only lesson ids, printed pages, the slot, the service's
 * first page and the plan's own ids are returned, to the student themself.
 */
type Access<Q extends PgQueryResultHKT> = Pick<ReturnType<typeof createAccessService<Q>>, "listStudents">;
/**
 * What the path needs of the service-learning read, and nothing more: a plan's state and ids, and each selected unit's id and
 * printed page. This module never imports the service-learning service, its catalog or its parser (the course's licensed-text
 * guard, service-course-text.test.ts, holds that); the composition hands it that service's `metadata` read, whose other fields
 * (a unit's name, caption and section) this module never reads.
 */
type PlanView = Readonly<{ id: string; revision: number; needsReview: boolean; catalogId: string; catalogIdentity: string }>;
type Metadata = { readonly state: "no-plan" } | { readonly state: "stale" } | { readonly state: "cleared"; readonly plan: PlanView } | { readonly state: "withdrawn"; readonly plan: PlanView }
  | { readonly state: "assigned"; readonly plan: PlanView; readonly units: readonly Readonly<{ id: string; page?: number }>[]; readonly serviceStart?: number };
type Learning = Readonly<{ metadata(request: AccessRequest, selection: { mode: "student"; studentId: string }): Promise<Metadata> }>;
const planOf = (plan: { id: string; revision: number; catalogId: string; catalogIdentity: string }): PathPlan =>
  Object.freeze({ id: plan.id, revision: plan.revision, catalogId: plan.catalogId, catalogIdentity: plan.catalogIdentity });

export function createServiceCoursePath<Q extends PgQueryResultHKT>(input: { access: Access<Q>; serviceLearning: Learning }) {
  return Object.freeze({
    async read(request: AccessRequest, tenantId: string): Promise<Path> {
      const tenant = tenantFile(tenantId);
      // A congregation without its own course file has no course and so no path (A4 12).
      if (!tenant) throw new AccessDenied(404);
      // Exactly one student of one's own: a student grant names one student; anything else has no path rather than a guess.
      const students = await input.access.listStudents(request, { mode: "student", limit: 2 });
      if (students.length !== 1) throw new AccessDenied(403);
      const student = students[0], slot = student.serviceSlot;
      const selection = { mode: "student" as const, studentId: student.id };
      let result = await input.serviceLearning.metadata(request, selection);
      // A plan saved during the read: read once more; still moving is a plain failure, and the home says the parts did not load.
      if (result.state === "stale") result = await input.serviceLearning.metadata(request, selection);
      if (result.state === "stale") throw new AccessUnavailable();
      if (result.state === "no-plan") return Object.freeze({ ok: true as const, state: "no-plan" as const, slot, review: false, items: Object.freeze(defaultItems(tenant, slot)) });
      const plan = planOf(result.plan);
      if (result.state === "cleared" || result.state === "withdrawn") return Object.freeze({ ok: true as const, state: result.state, slot, review: result.plan.needsReview, items: Object.freeze([]), plan });
      const items = assignedItems(tenant, result.units.map(unit => ({ id: unit.id, ...(unit.page !== undefined ? { page: unit.page } : {}) })));
      return Object.freeze({ ok: true as const, state: "assigned" as const, slot, review: result.plan.needsReview, items: Object.freeze(items),
        ...(result.serviceStart !== undefined ? { serviceStart: result.serviceStart } : {}), plan });
    },
  });
}
export type ServiceCoursePath = ReturnType<typeof createServiceCoursePath>;
