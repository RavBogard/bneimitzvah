import "server-only";
import { and, eq } from "drizzle-orm";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import { withTenantTransaction } from "../db/runtime";
import { lockRoleGrant } from "../data/authority";
import { AccessDenied } from "../access/errors";
import type { AccessDatabase, AccessTransaction } from "../access/types";
import * as s from "../db/index";
import type { RabbiAuthority, RabbiWriter } from "./service";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Re-lock a named membership's live admin grant inside the write transaction. Lock order follows
 * the access service: tenant, membership, grant. A disabled tenant or membership, a revoked or
 * missing admin grant, or a membership in another tenant all deny identically.
 */
export async function lockRabbi<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, tenantId: string, membershipId: string) {
  if (!UUID.test(membershipId)) throw new AccessDenied(403);
  const [tenant] = await tx.select({ enabled: s.tenant.enabled }).from(s.tenant).where(eq(s.tenant.id, tenantId)).for("share");
  if (!tenant?.enabled) throw new AccessDenied(403);
  const [member] = await tx.select({ id: s.membership.id, userId: s.membership.userId, disabledAt: s.membership.disabledAt }).from(s.membership)
    .where(and(eq(s.membership.tenantId, tenantId), eq(s.membership.id, membershipId))).for("share");
  if (!member || member.disabledAt) throw new AccessDenied(403);
  const grant = await lockRoleGrant(tx, tenantId, member.id, "admin", "data-write");
  if (!grant || grant.revokedAt || grant.role !== "admin") throw new AccessDenied(403);
  return { userId: member.userId, membershipId: member.id, roleGrantId: grant.id };
}

/**
 * A rabbi authority for one named admin membership. The MCP builds one from its verified delegation
 * (channel "mcp"; mayReview false for an unattended routine's consent); the operator bridge uses
 * operatorRabbiAuthority below.
 */
export function membershipRabbiAuthority<Q extends PgQueryResultHKT>(input: {
  db: AccessDatabase<Q>; tenantId: string; membershipId: string; channel: "mcp" | "operator"; mayReview: boolean; live?: () => void;
}): RabbiAuthority<Q> {
  if (input.channel === "operator" && input.mayReview) throw new AccessDenied(403);
  return {
    run: (action) => withTenantTransaction(input.db, { tenantId: input.tenantId }, async tx => {
      input.live?.();
      const rabbi = await lockRabbi(tx as AccessTransaction<Q>, input.tenantId, input.membershipId);
      const writer: RabbiWriter = Object.freeze({ tenantId: input.tenantId, ...rabbi, channel: input.channel, mayReview: input.mayReview });
      return action(tx as AccessTransaction<Q>, writer, input.live ?? (() => {}));
    }),
  };
}

/**
 * The reviewed operator bridge (spec §3a): a designated admin membership named on the command line.
 * It can never mark a guide reviewed or publish one; only the rabbi in Cowork can (S25).
 */
export function operatorRabbiAuthority<Q extends PgQueryResultHKT>(input: { db: AccessDatabase<Q>; tenantId: string; membershipId: string }): RabbiAuthority<Q> {
  return membershipRabbiAuthority({ ...input, channel: "operator", mayReview: false });
}
