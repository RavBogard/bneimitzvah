import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT, PgTransaction } from "drizzle-orm/pg-core";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import * as schema from "./index";

export function createRuntimeDatabase(connectionString: string) {
  // Construct only after private deployment config is validated. This factory
  // neither connects on module import nor reads/logs environment variables.
  const pool = new Pool({ connectionString, max: 4 });
  return { db: drizzle(pool, { schema, logger: false }), close: () => pool.end() };
}

type TenantTransaction<Q extends PgQueryResultHKT> = PgTransaction<Q, typeof schema, ExtractTablesWithRelations<typeof schema>>;

// TenantScope is an internal value from exact host resolution, never a body/query
// parameter. This helper binds RLS; it does not grant a user's capabilities.
export async function withTenantTransaction<Q extends PgQueryResultHKT, T>(
  db: PgDatabase<Q, typeof schema>,
  scope: { readonly tenantId: string },
  action: (tx: TenantTransaction<Q>) => Promise<T>,
): Promise<T> {
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(scope.tenantId)) throw new Error("Invalid tenant scope");
  return db.transaction(async (tx) => {
    const roles = await tx.select({
      restricted: sql<boolean>`not rolsuper and not rolbypassrls and not rolcreatedb and not rolcreaterole and not rolreplication`,
      allowedActiveRole: sql<boolean>`current_user = session_user or current_user = 'portal_runtime'`,
      elevatedMembership: sql<boolean>`exists (
        select 1 from pg_catalog.pg_roles elevated
        where pg_has_role(pg_roles.oid, elevated.oid, 'MEMBER') and (
          elevated.rolsuper or elevated.rolbypassrls or elevated.rolcreatedb or elevated.rolcreaterole or elevated.rolreplication
          or exists (select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relowner = elevated.oid)
          or exists (select 1 from pg_catalog.pg_namespace n where n.nspname = 'public' and n.nspowner = elevated.oid)
          or exists (select 1 from pg_catalog.pg_database d where d.datname = current_database() and d.datdba = elevated.oid)
        )
      )`,
      unexpectedMembership: sql<boolean>`exists (
        select 1 from pg_catalog.pg_roles granted
        where pg_has_role(pg_roles.oid, granted.oid, 'MEMBER')
          and granted.rolname not in (session_user, 'portal_runtime')
      )`,
    }).from(sql`pg_catalog.pg_roles`).where(sql`rolname in (current_user, session_user)`);
    // SET ROLE must not disguise an elevated authenticated connection. Check
    // both session and active roles, plus their transitive owner memberships.
    if (!roles.length || roles.some((role) => !role.restricted || !role.allowedActiveRole || role.elevatedMembership || role.unexpectedMembership)) throw new Error("Restricted nonowner runtime role required");
    await tx.execute(sql`select set_config('app.tenant_id', ${scope.tenantId}, true)`);
    // The same awaited transaction handle must perform every query and audit.
    return action(tx);
  });
}
