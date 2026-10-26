// 1.9 N13: what the parent's "This week" card says, as pure functions over data the parent's existing reads already return
// (the child's ceremony and rehearsal dates, the practice calendar's dates). Nothing here fetches or stores anything.
import type { Student } from "./api";
import { dayOrdinal } from "./practice-calendar/api";
import { rehearsalLine, shortDay } from "./today/model";

/** How far a day is, in the words the hero already uses: "6 days to go", "Tomorrow", "Today"; nothing once it has passed. */
export function relativeDay(days: number): string | null {
  return days > 1 ? `${days} days to go` : days === 1 ? "Tomorrow" : days === 0 ? "Today" : null;
}

/**
 * The next date that matters, in relative words: "Rehearsal today" (or "Next rehearsal: Sat, Oct 31 · 6 days to go") for the
 * nearest rehearsal still to come, or "Ceremony: Sat, Nov 14 · 20 days to go" when the ceremony is nearer or no rehearsal is
 * left. Nothing once every date has passed. A day that is the ceremony and a rehearsal says the ceremony.
 */
export function nextDateLine(student: Pick<Student, "ceremonyDate" | "rehearsal1" | "rehearsal2">, today: string): string | null {
  const now = dayOrdinal(today);
  const upcoming = [
    ...[student.rehearsal1, student.rehearsal2].filter((value): value is string => !!value).map(date => ({ date, rehearsal: true })),
    { date: student.ceremonyDate, rehearsal: false },
  ].filter(row => dayOrdinal(row.date) >= now)
    .sort((a, b) => dayOrdinal(a.date) - dayOrdinal(b.date) || Number(a.rehearsal) - Number(b.rehearsal));
  const next = upcoming[0]; if (!next) return null;
  const phrase = relativeDay(dayOrdinal(next.date) - now);
  if (next.rehearsal) {
    const line = rehearsalLine({ rehearsal1: next.date, rehearsal2: null }, today);
    return line === "Rehearsal today" || !phrase ? line : `${line} · ${phrase}`;
  }
  return `Ceremony: ${shortDay(next.date)}${phrase ? ` · ${phrase}` : ""}`;
}

/** "Sat" for a calendar date: the weekday of a practice day, said short. */
export const weekdayShort = (date: string) => new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
