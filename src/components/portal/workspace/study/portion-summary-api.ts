import { PortalRequestError } from "../../api";
import { getJson } from "../../public-reading/api";
import { OUTLINE_ALIYOT, type ApprovedPortionSummary } from "../../../../lib/portion-summary/credit";
import { portionSummaryPath } from "../../../../lib/portion-summary/reading";
import { plainCredit } from "../../../../lib/readings/edition-credit";

/**
 * The portion summary in the browser (1.9 N7): one same-origin GET to /api/public/portion-summary (no cookie, no Authorization, the same
 * answer signed in or out), parsed strictly. The route answers only an approved revision, so a draft or a withdrawn one never reaches
 * this code; and anything that is not exactly the approved shape (seven outline lines in order, a credit, prose without markup that
 * the reader's markdown subset does not draw) is a failure, and a failure shows nothing at all.
 */
export const PORTION_SUMMARY_BYTES = 32 * 1024;
const bad = (): never => { throw new PortalRequestError(503); };
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : bad();
// Prose: paragraphs, emphasis and lists. No control or invisible characters (the server's guide rules refuse them too); newlines stay.
const PROSE_UNSAFE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f​-‏‪-‮⁠-⁤⁦-⁩﻿]/u;
const prose = (value: unknown, max: number): string => typeof value === "string" && value.trim() !== "" && value.length <= max && !PROSE_UNSAFE.test(value) ? value : bad();
const plain = (value: unknown, max: number): string => { const text = plainCredit(value, max); return text !== null && text === value ? text : bad(); };

export function parsePortionSummary(value: unknown, reading: string): ApprovedPortionSummary | null {
  const root = object(value);
  if (root.reading !== reading) return bad();
  if (root.summary === null) return null;
  const row = object(root.summary);
  if (row.reading !== reading || !Number.isSafeInteger(row.revision) || Number(row.revision) < 1 || !Array.isArray(row.outline) || row.outline.length !== OUTLINE_ALIYOT.length) return bad();
  const approvedAt = plain(row.approvedAt, 40);
  if (Number.isNaN(Date.parse(approvedAt))) return bad();
  const outline = row.outline.map((line, at) => {
    const item = object(line);
    if (item.aliyah !== OUTLINE_ALIYOT[at]) return bad();
    return Object.freeze({ aliyah: OUTLINE_ALIYOT[at], line: plain(item.line, 400) });
  });
  return Object.freeze({ reading, revision: Number(row.revision), summary: prose(row.summary, 8 * 1024), outline: Object.freeze(outline), credit: plain(row.credit, 120), approvedAt });
}

/** The approved summary for a parashah, null when it has none, or a rejection (any failure: the reader shows nothing). */
export async function fetchPortionSummary(reading: string, signal: AbortSignal): Promise<ApprovedPortionSummary | null> {
  return parsePortionSummary(await getJson(portionSummaryPath(reading), PORTION_SUMMARY_BYTES, signal), reading);
}
