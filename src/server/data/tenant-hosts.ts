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

/** The directory's answer for one host and origin under one deployment scope. */
export type TenantHostLookup = (host: string, origin: string) => Promise<{ tenantId: string } | undefined>;
/**
 * One request's tenant directory: each host and origin is looked up once and the answer reused for the rest of the
 * request (the runtime's configured check, the dispatcher's incoming check and every identity check). Built per request
 * with that request's database and the deployment's scope; nothing outlives the request. A failed lookup is not kept.
 */
export function createTenantHostDirectory<Q extends PgQueryResultHKT>(db: AccessDatabase<Q>, scope: DeploymentScope): TenantHostLookup {
  const answers = new Map<string, { tenantId: string } | undefined>();
  return async (host, origin) => {
    const key = `${host}\n${origin}`;
    if (answers.has(key)) return answers.get(key);
    const row = await lookupTenantHost(db, host, origin, scope);
    const answer = row ? Object.freeze({ tenantId: row.tenantId }) : undefined;
    answers.set(key, answer);
    return answer;
  };
}
