import "server-only";
import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { AccessTransaction, Actor } from "../access/types";
import { validateSettings, type CongregationSettings } from "../settings/validation";
import * as s from "../db/index";

export type SettingsRow = typeof s.tenantSettings.$inferSelect;

export async function settingsHead<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, tenantId: string) {
  const t = s.tenantSettings;
  const [row] = await tx.select().from(t).where(eq(t.tenantId, tenantId)).orderBy(desc(t.version)).limit(1);
  return row ?? null;
}
/** The head version's settings, or null when there is none or it no longer passes today's rules. */
export async function currentSettings<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, tenantId: string): Promise<CongregationSettings | null> {
  const row = await settingsHead(tx, tenantId);
  if (!row) return null;
  const checked = validateSettings(row.body);
  return checked.ok ? checked.value : null;
}
export async function settingsReceipt<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, actor: Actor, mutationId: string) {
  const t = s.tenantSettings;
  const [row] = await tx.select().from(t).where(and(eq(t.tenantId, actor.tenantId), eq(t.actorUserId, actor.userId), eq(t.mutationId, mutationId))).limit(1);
  return row ?? null;
}
export async function appendSettings<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, actor: Actor, write: { expected: number; body: CongregationSettings; mutationId: string; digest: string }) {
  const [row] = await tx.insert(s.tenantSettings).values({
    tenantId: actor.tenantId, version: write.expected + 1, baseVersion: write.expected, previousVersion: write.expected === 0 ? null : write.expected, body: write.body,
    actorUserId: actor.userId, actorMembershipId: actor.membershipId, roleGrantId: actor.roleGrantId, role: "admin", mode: "admin", channel: "web",
    mutationId: write.mutationId, requestDigest: write.digest,
  }).onConflictDoNothing().returning();
  if (row) await tx.insert(s.auditEvent).values({ tenantId: actor.tenantId, actorUserId: actor.userId, actorMembershipId: actor.membershipId, roleGrantId: actor.roleGrantId,
    mode: "admin", action: "tenant-settings.set", targetType: "tenant_settings", targetId: row.id, requestId: randomUUID() });
  return row ?? null;
}
