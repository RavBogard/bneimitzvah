import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { AccessTransaction } from "./types";
import * as s from "../db/index";

/**
 * Whether a membership keeps member features now (readings for everyone, Daniel 2026-10-27): a live, undisabled
 * membership in this tenant, and nothing more. Every signed-in person gets a membership at first sign-in
 * (POST /api/session/begin), so the saved layer and Learn progress sync are open to everyone who signs in; role
 * grants and the approver's tenant_member row are no longer consulted here. Share-locks the row it finds, so a
 * concurrent disabling waits. The saved layer, the course-progress layers and the session summary all ask here.
 */
export async function memberEligible<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, tenantId: string, membershipId: string) {
  const [row] = await tx.select({ id: s.membership.id }).from(s.membership)
    .where(and(eq(s.membership.tenantId, tenantId), eq(s.membership.id, membershipId), isNull(s.membership.disabledAt))).limit(1).for("share");
  return row !== undefined;
}
