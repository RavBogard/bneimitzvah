import "server-only";
import { sql } from "drizzle-orm";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import { AccessDenied } from "../access/errors";
import { courseEligibility } from "../data/course-progress";
import { createLearningOwnerAccess, learningOwnerName, type LearningAccess, type LearningOwner } from "../practice/learning-owner";

export type CourseOwner = LearningOwner;
export const courseOwnerName = (owner: Pick<LearningOwner, "tenantId" | "membershipId" | "student" | "legacy">) =>
  learningOwnerName("learn-progress-owner/v1", owner);

/** Names the directly signed-in member when that membership cannot keep course progress. */
export class CourseRefused extends AccessDenied {
  constructor(readonly owner: string) { super(403); this.name = "CourseRefused"; }
}

export function createCourseProgressAccess<Q extends PgQueryResultHKT>(input: LearningAccess<Q>) {
  return createLearningOwnerAccess(input, "learn", async (tx, tenantId, membershipId, legacy) => {
    if (!legacy && !await courseEligibility(tx, tenantId, membershipId)) throw new CourseRefused(courseOwnerName({ tenantId, membershipId }));
    await tx.execute(sql`select set_config('app.course_owner', ${membershipId}, true)`);
  });
}
