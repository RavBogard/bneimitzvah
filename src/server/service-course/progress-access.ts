import "server-only";
import { sql } from "drizzle-orm";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import { AccessDenied } from "../access/errors";
import { serviceCourseEligibility } from "../data/service-course-progress";
import { createLearningOwnerAccess, learningOwnerName, type LearningAccess, type LearningOwner } from "../practice/learning-owner";

export type ServiceCourseOwner = LearningOwner;
export const serviceCourseOwnerName = (owner: Pick<LearningOwner, "tenantId" | "membershipId" | "student" | "legacy">) =>
  learningOwnerName("service-course-progress-owner/v1", owner);

/** Names the directly signed-in member when that membership cannot keep course progress. */
export class ServiceCourseRefused extends AccessDenied {
  constructor(readonly owner: string) { super(403); this.name = "ServiceCourseRefused"; }
}

export function createServiceCourseProgressAccess<Q extends PgQueryResultHKT>(input: LearningAccess<Q>) {
  return createLearningOwnerAccess(input, "service", async (tx, tenantId, membershipId, legacy) => {
    if (!legacy && !await serviceCourseEligibility(tx, tenantId, membershipId)) throw new ServiceCourseRefused(serviceCourseOwnerName({ tenantId, membershipId }));
    await tx.execute(sql`select set_config('app.service_course_owner', ${membershipId}, true)`);
  });
}
