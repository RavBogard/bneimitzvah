import "server-only";
import { sql } from "drizzle-orm";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import { AccessDenied } from "../access/errors";
import { verseReviewEligibility } from "../data/verse-review";
import { createLearningOwnerAccess, learningOwnerName, type LearningAccess, type LearningOwner } from "../practice/learning-owner";

export type VerseReviewOwner = LearningOwner;
export const verseReviewOwnerName = (owner: Pick<LearningOwner, "tenantId" | "membershipId" | "student" | "legacy">) =>
  learningOwnerName("learn-verses-owner/v1", owner);

export function createVerseReviewAccess<Q extends PgQueryResultHKT>(input: LearningAccess<Q>) {
  return createLearningOwnerAccess(input, "verses", async (tx, tenantId, membershipId, legacy) => {
    if (!legacy && !await verseReviewEligibility(tx, tenantId, membershipId)) throw new AccessDenied(403);
    await tx.execute(sql`select set_config('app.verse_review_owner', ${membershipId}, true)`);
  });
}
