import "server-only";
import { eq } from "drizzle-orm";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { AccessTransaction } from "../access/types";
import * as s from "../db/index";
import { resolveIdentity } from "../../lib/site/identity";

/**
 * The congregation's own names (Daniel, E1, 2026-10-23): `productName` is set per congregation in `tenant.product_name`
 * (CRC's is "CRC Torah", migration 0035), and every approved string that names the product uses it. This is the one reader;
 * the account emails and screens use it, and the sign-in code email should too.
 */
export async function readTenantNames<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, tenantId: string): Promise<Readonly<{ name: string; productName: string }>> {
  const [row] = await tx.select({ name: s.tenant.name, productName: s.tenant.productName }).from(s.tenant).where(eq(s.tenant.id, tenantId)).limit(1);
  if (!row) throw new Error("Congregation unavailable");
  // A fork keeps the internal tenant id and its stored names; what people read comes from its identity settings.
  const identity = resolveIdentity();
  return identity.crc ? Object.freeze({ name: row.name, productName: row.productName }) : Object.freeze({ name: identity.name, productName: identity.productName });
}
export async function readProductName<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, tenantId: string): Promise<string> {
  return (await readTenantNames(tx, tenantId)).productName;
}
