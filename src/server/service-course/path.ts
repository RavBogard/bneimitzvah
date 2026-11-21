import "server-only";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { createAccessService } from "../access/service";
import type { AccessRequest } from "../access/types";
import { AccessDenied, AccessUnavailable } from "../access/errors";
import { PERSONAL_STUDY_HEADER } from "../../lib/learn/child-practice";
import { childLearningSelection } from "../practice/learning-owner";
import type { createPracticeService } from "../practice/service";
import { tenantFile } from "../../lib/service-course/course";
import { assignedItems, defaultItems, type Path, type PathPlan } from "../../lib/service-course/path";

/**
 * The student's service path, composed from a live self link or child-practice selection
 * and the service-learning metadata for that student. The result maps feed unit IDs
 * to lesson IDs and pages without returning any licensed feed text.
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
type Learning = Readonly<{ metadata(request: AccessRequest, selection: { mode: "student" | "child-practice"; studentId: string }): Promise<Metadata> }>;
const planOf = (plan: { id: string; revision: number; catalogId: string; catalogIdentity: string }): PathPlan =>
  Object.freeze({ id: plan.id, revision: plan.revision, catalogId: plan.catalogId, catalogIdentity: plan.catalogIdentity });

export function createServiceCoursePath<Q extends PgQueryResultHKT>(input: { access: Access<Q>; serviceLearning: Learning; practice?: Pick<ReturnType<typeof createPracticeService<Q>>, "read"> }) {
  return Object.freeze({
    async read(request: AccessRequest, tenantId: string): Promise<Path> {
      const tenant = tenantFile(tenantId);
      // A congregation without its own course file has no course and so no path (A4 12).
      if (!tenant) throw new AccessDenied(404);
      const child = childLearningSelection(request);
      if (request.headers.has(PERSONAL_STUDY_HEADER)) throw new AccessDenied(403);
      const students = child
        ? input.practice ? [(await input.practice.read(request, child)).student] : []
        : await input.access.listStudents(request, { mode: "student", limit: 2 });
      if (students.length !== 1) throw new AccessDenied(403);
      const student = students[0], slot = student.serviceSlot;
      const selection = child ?? { mode: "student" as const, studentId: student.id };
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
