/**
 * The portion summary's credit (decision 4, Daniel 2026-10-24: "Claude drafts, you approve"). It is the congregation's own
 * `tenant.summary_credit` (migration 0056), stamped onto a revision when it is approved, so print, offline and the reader all
 * show the same words. A congregation with none set cannot approve a summary at all, rather than showing one uncredited.
 */

/** Aliyot one to seven, in order: the outline has exactly one plain line for each. */
export const OUTLINE_ALIYOT = Object.freeze([1, 2, 3, 4, 5, 6, 7] as const);

/** What every public read returns for an approved summary (the route, print and the offline pack read the same shape). */
export type ApprovedPortionSummary = Readonly<{
  reading: string; revision: number; summary: string;
  outline: readonly Readonly<{ aliyah: (typeof OUTLINE_ALIYOT)[number]; line: string }>[];
  credit: string; approvedAt: string;
}>;
