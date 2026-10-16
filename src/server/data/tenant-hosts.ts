import "server-only";
import { and, eq } from "drizzle-orm";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { AccessDatabase, DeploymentScope } from "../access/types";
import { tenantHost } from "../db/tenant-schema";

// Narrow pre-auth directory lookup: no tenant content/contact table is queried.
export async function lookupTenantHost<Q extends PgQueryResultHKT>(db: AccessDatabase<Q>, host: string, origin: string, scope: DeploymentScope) {
  const [row] = await db.select({ tenantId: tenantHost.tenantId }).from(tenantHost).where(and(
    eq(tenantHost.host, host), eq(tenantHost.origin, origin),
    eq(tenantHost.environment, scope.environment), eq(tenantHost.deployment, scope.deployment),
  ));
  return row;
}
