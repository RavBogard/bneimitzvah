import "server-only";
import { eq } from "drizzle-orm";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { AccessTransaction } from "../access/types";
import { currentSettings } from "../data/tenant-settings";
import { effectiveRabbiName } from "../settings/validation";
import * as s from "../db/index";

/**
 * The curator's public name for "Selected by {name}" (1.7 M6): the congregation's rabbi display name, exactly as study guide
 * labels read it (settings first, then the legacy customs key, then "the rabbi"). Only admins curate, through the rabbi's own
 * grant check, and the runtime cannot read a source's selected_by at all, so no membership or account name is ever looked up.
 */
export async function curatorName<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, tenantId: string): Promise<string> {
  const [row] = await tx.select({ customs: s.tenant.customs }).from(s.tenant).where(eq(s.tenant.id, tenantId)).limit(1);
  const name = effectiveRabbiName(await currentSettings(tx, tenantId), row?.customs);
  return name.includes("@") ? "the rabbi" : name;
}
