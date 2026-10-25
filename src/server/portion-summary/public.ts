import "server-only";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { AccessTransaction } from "../access/types";
import { OUTLINE_ALIYOT, type ApprovedPortionSummary } from "../../lib/portion-summary/credit";
import { approvedSummaryRow } from "./data";
import { parashahOf } from "./validation";

/**
 * The one read every reader surface uses for a portion summary (1.9 N6, decision 4): /read and Study through the public route,
 * the print sheet and the offline pack through the same route's answer. It reads portion_summary_public only, so a draft or a
 * withdrawn revision is never in it, and it names no person beyond the approved credit. Null when the parashah has no approved
 * summary (or is not a parashah at all): nothing is shown, never a placeholder.
 */
export async function readApprovedPortionSummary<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, tenantId: string, reading: string): Promise<ApprovedPortionSummary | null> {
  const parashah = parashahOf(reading);
  if (!parashah || parashah.slug !== reading) return null;
  const row = await approvedSummaryRow(tx, tenantId, parashah.slug);
  if (!row || !Array.isArray(row.outline) || row.outline.length !== OUTLINE_ALIYOT.length) return null;
  return Object.freeze({ reading: row.readingKey, revision: row.revision, summary: row.summary,
    outline: Object.freeze(OUTLINE_ALIYOT.map((aliyah, i) => Object.freeze({ aliyah, line: row.outline[i] }))), credit: row.credit, approvedAt: row.approvedAt.toISOString() });
}
