import "server-only";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { AccessTransaction } from "../access/types";
import { savedEligibility } from "../data/saved";

/** Whether a membership keeps a saved layer now (a live parent, tutor or admin grant, or a live Member row), share-locked. */
export function savedEligible<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, tenantId: string, membershipId: string): Promise<boolean> {
  return savedEligibility(tx, tenantId, membershipId);
}
