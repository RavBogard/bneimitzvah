import "server-only";
import { sql, type SQLWrapper } from "drizzle-orm";
import { accountDisplayName } from "../db/account-display-name-schema";
import { membership } from "../db/tenant-schema";

/** Use the congregation's edited name ahead of the surface's existing fallback. */
export function nameForMembership(fallback: SQLWrapper, tenantId: SQLWrapper | string = membership.tenantId, membershipId: SQLWrapper | string = membership.id) {
  const table = accountDisplayName;
  return sql<string>`coalesce((select ${table.name} from ${table}
    where ${table.tenantId} = ${tenantId} and ${table.membershipId} = ${membershipId}), ${fallback})`;
}
