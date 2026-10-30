import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { AccessTransaction } from "../access/types";
import * as s from "../db/index";
import { portionSummaryPublic } from "./public-view";

/**
 * Portion summary rows (migration 0044). Every select names its columns: the runtime holds no SELECT grant on drafted_by,
 * approved_by or approved_grant_id, so a `select *` or a bare `returning()` would be refused by the database itself.
 */
export type SummaryStatus = "draft" | "approved" | "withdrawn";
export type SummaryRow = Readonly<{ id: string; readingKey: string; revision: number; status: SummaryStatus; summary: string; outline: string[];
  approvedAt: Date | null; credit: string | null; withdrawnAt: Date | null; mutationId: string; requestDigest: string; createdAt: Date; updatedAt: Date }>;
/** The approving rabbi: their membership and live admin grant, re-locked in this transaction. */
export type Approver = Readonly<{ tenantId: string; membershipId: string; roleGrantId: string }>;

const p = s.portionSummary;
const columns = { id: p.id, readingKey: p.readingKey, revision: p.revision, status: p.status, summary: p.summary, outline: p.outline, approvedAt: p.approvedAt,
  credit: p.credit, withdrawnAt: p.withdrawnAt, mutationId: p.mutationId, requestDigest: p.requestDigest, createdAt: p.createdAt, updatedAt: p.updatedAt };

export async function summaryReceipt<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, tenantId: string, mutationId: string): Promise<SummaryRow | null> {
  const [row] = await tx.select(columns).from(p).where(and(eq(p.tenantId, tenantId), eq(p.mutationId, mutationId))).limit(1);
  return (row as SummaryRow | undefined) ?? null;
}
/** Every revision of one parashah, newest first; `lock` holds them all for an approval or a withdrawal. */
export async function revisionsOf<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, tenantId: string, readingKey: string, lock = false): Promise<SummaryRow[]> {
  const query = tx.select(columns).from(p).where(and(eq(p.tenantId, tenantId), eq(p.readingKey, readingKey))).orderBy(desc(p.revision));
  return (lock ? await query.for("update") : await query) as SummaryRow[];
}
/** Revisions in one state across every parashah (newest change first), at most `limit`. */
export async function summariesIn<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, tenantId: string, status: SummaryStatus | null, limit: number): Promise<SummaryRow[]> {
  return await tx.select(columns).from(p).where(and(eq(p.tenantId, tenantId), status ? eq(p.status, status) : undefined))
    .orderBy(desc(p.updatedAt), p.readingKey, desc(p.revision)).limit(limit) as SummaryRow[];
}
export async function insertDraft<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, value: { tenantId: string; membershipId: string; readingKey: string; revision: number;
  summary: string; outline: readonly string[]; mutationId: string; requestDigest: string }) {
  const [row] = await tx.insert(p).values({ tenantId: value.tenantId, readingKey: value.readingKey, revision: value.revision, status: "draft", summary: value.summary,
    outline: [...value.outline], draftedBy: value.membershipId, mutationId: value.mutationId, requestDigest: value.requestDigest })
    .onConflictDoNothing().returning({ id: p.id, revision: p.revision });
  return row ?? null;
}
/** The congregation's own credit (tenant.summary_credit), or null while an operator has not set one. */
export async function summaryCredit<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, tenantId: string): Promise<string | null> {
  const [row] = await tx.select({ credit: s.tenant.summaryCredit }).from(s.tenant).where(eq(s.tenant.id, tenantId)).limit(1);
  return row?.credit ?? null;
}
/** Approve one draft under the approver's own admin grant, stamped now with the congregation's credit. */
export async function approveDraft<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, approver: Approver, id: string, credit: string) {
  const [row] = await tx.update(p).set({ status: "approved", approvedBy: approver.membershipId, approvedGrantId: approver.roleGrantId, approvedRole: "admin",
    approvedAt: sql`now()`, credit, updatedAt: sql`now()` }).where(and(eq(p.tenantId, approver.tenantId), eq(p.id, id), eq(p.status, "draft")))
    .returning({ revision: p.revision, approvedAt: p.approvedAt, credit: p.credit });
  return row ?? null;
}
/** Withdraw a draft or an approved revision; withdrawn is final. */
export async function withdraw<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, tenantId: string, id: string, from: "draft" | "approved") {
  const [row] = await tx.update(p).set({ status: "withdrawn", withdrawnAt: sql`now()`, updatedAt: sql`now()` })
    .where(and(eq(p.tenantId, tenantId), eq(p.id, id), eq(p.status, from))).returning({ revision: p.revision });
  return row ?? null;
}

export type PublicSummaryRow = Readonly<{ readingKey: string; revision: number; summary: string; outline: string[]; credit: string; approvedAt: Date }>;
/** The public read, through portion_summary_public only: the one approved revision of a parashah, or null. */
export async function approvedSummaryRow<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, tenantId: string, readingKey: string): Promise<PublicSummaryRow | null> {
  const v = portionSummaryPublic;
  const [row] = await tx.select({ readingKey: v.readingKey, revision: v.revision, summary: v.summary, outline: v.outline, credit: v.credit, approvedAt: v.approvedAt })
    .from(v).where(and(eq(v.tenantId, tenantId), eq(v.readingKey, readingKey))).orderBy(desc(v.revision)).limit(1);
  return row ?? null;
}
