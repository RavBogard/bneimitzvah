/**
 * 1.9 N23 (decision 7): the one gate for practice visibility. Null until the Opus adversarial privacy review passes and Daniel
 * approves the Account disclosure's wording; then the ISO date (America/Chicago) it opens on.
 *
 * Everything of N23 sits behind this one value, so nothing a tutor or parent could see can show before the student is told:
 * - the server refuses every practice-visibility read while it is null (src/server/practice-visibility/service.ts);
 * - the student's disclosures on Account and in Learn render only when it is set (src/components/portal/practice-visibility/);
 * - the tutor's and parent's lines render only from that server's answers, so never while it is null;
 * - once set, the per-day lines start on this date: nothing a student did before the disclosure shipped is shown per day.
 */
export const PRACTICE_VISIBILITY_FROM: string | null = null;

const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** The gate's date when it is a real calendar date, else null (closed). */
export function practiceVisibilityFrom(value: string | null = PRACTICE_VISIBILITY_FROM): string | null {
  if (typeof value !== "string" || !DAY.test(value)) return null;
  return new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value ? value : null;
}
