// The shelf's pure model (Area A, Task A4): which sections My Readings shows, in what order, and whether it is empty. No React, so it is
// unit-tested without a browser. Area D adds sections by extending `ShelfSection`; the order here is decision 9's.
import type { SessionSummary } from "../api";
import type { SavedReading } from "../saved/api";

export type OwnReadingsState = Readonly<{ status: "loading" } | { status: "ready"; readings: readonly SavedReading[] } | { status: "failed" } | { status: "hidden" }>;
/** What the shelf knows of the student's pinned reading once it is read (E1); `null` while it loads or for a session without the student role. */
export type PinnedState = Readonly<{ name: string; ceremony: string | null; done: number; total: number; href: string }>;
/** The Learn row's second line: the next lesson, "Start the course", or nothing once the course is done. */
export type LearnRowState = Readonly<{ meta: string | null }>;
export type ShelfSection = "students" | "find" | "pinned" | "own" | "learn" | "account";
export type ShelfView = Readonly<{
  /** The sections to draw, in order. */
  sections: readonly ShelfSection[];
  /** The first-sign-in state: nothing kept and nothing pinned. `line` is null where saving is not open to this membership yet (hidden). */
  empty: null | Readonly<{ line: string | null }>;
}>;

export type InterimRow = Readonly<{ role: "parent"; title: string; href: string; action: string | null }>;
/** The interim row, until E3's children's cards replace it. Existing words only. The student's row is E1's pinned card; the tutor's is D7's Your students. */
export function interimRows(roles: readonly string[]): InterimRow[] {
  const rows: InterimRow[] = [];
  if (roles.includes("parent")) rows.push({ role: "parent", title: "Beit Mitzvah", href: "/workspace/parent", action: "Open" });
  return rows;
}

export const EMPTY_LINE = "You’re signed in. Nothing is saved yet.";

/** Dated readings first, earliest date first; undated ones last, in the order the server gave them (most recent first). */
export function sortOwnReadings(readings: readonly SavedReading[]): SavedReading[] {
  const dated = readings.filter(reading => reading.date !== null).sort((a, b) => a.date!.localeCompare(b.date!));
  return [...dated, ...readings.filter(reading => reading.date === null)];
}

export function shelfModel(input: { summary: SessionSummary; own: OwnReadingsState; pinned: PinnedState | null; learn: LearnRowState }): ShelfView {
  const { own, pinned } = input;
  const keeps = own.status === "ready" && own.readings.length > 0;
  const settled = own.status === "ready" || own.status === "hidden";
  // A student's pinned card is there while it loads, so the shelf is never "empty" for a student.
  const empty = settled && !keeps && !pinned && !input.summary.roles.includes("student") ? { line: own.status === "ready" ? EMPTY_LINE : null } : null;
  const sections: ShelfSection[] = [];
  // A tutor (decisions 17 and 25): Your students first, then Find a learner; an admin who is not a tutor gets Find a learner alone, to see and undo claims.
  const roles = input.summary.roles;
  if (roles.includes("tutor")) sections.push("students");
  if (roles.includes("tutor") || roles.includes("admin")) sections.push("find");
  // A student's pinned reading (E1); a parent keeps an interim row until E3's children's cards.
  if (pinned || roles.includes("student") || interimRows(roles).length) sections.push("pinned");
  if (own.status === "loading" || own.status === "failed" || keeps) sections.push("own");
  sections.push("learn", "account");
  return { sections, empty };
}
