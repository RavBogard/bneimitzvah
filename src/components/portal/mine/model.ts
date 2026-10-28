// The shelf's pure model (Area A, Task A4): which sections My Readings shows, in what order, and whether it is empty. No React, so it is
// unit-tested without a browser. Area D adds sections by extending `ShelfSection`; the order here is decision 9's.
import type { SessionSummary } from "../api";
import type { SavedReading } from "../saved/api";

export type OwnReadingsState = Readonly<{ status: "loading" } | { status: "ready"; readings: readonly SavedReading[] } | { status: "failed" } | { status: "hidden" }>;
/** What the shelf knows of the student's pinned reading once it is read (E1); `null` while it loads or for a session without the student role. */
export type PinnedState = Readonly<{ name: string; ceremony: string | null; done: number; total: number; href: string }>;
/** The Learn row's second line: the next lesson, "Start the course", or nothing once the course is done. */
export type LearnRowState = Readonly<{ meta: string | null }>;
export type ShelfSection = "students" | "find" | "pinned" | "children" | "own" | "learn" | "account";
export type ShelfView = Readonly<{
  /** The sections to draw, in order. */
  sections: readonly ShelfSection[];
  /** The first-sign-in state: nothing kept and nothing pinned. `line` is null where saving is not open to this membership yet (hidden). */
  empty: null | Readonly<{ line: string | null }>;
}>;

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
  // A student's pinned card and a parent's children are there while they load, so the shelf is never "empty" for either.
  const empty = settled && !keeps && !pinned && !input.summary.roles.includes("student") && !input.summary.roles.includes("parent") ? { line: own.status === "ready" ? EMPTY_LINE : null } : null;
  const sections: ShelfSection[] = [];
  // A tutor (decisions 17 and 25): Your students first, then Find a learner; an admin who is not a tutor gets Find a learner alone, to see and undo claims.
  const roles = input.summary.roles;
  if (roles.includes("tutor")) sections.push("students");
  if (roles.includes("tutor") || roles.includes("admin")) sections.push("find");
  // A student's pinned reading (E1), then a parent's card for each child (E3).
  if (pinned || roles.includes("student")) sections.push("pinned");
  if (roles.includes("parent")) sections.push("children");
  if (own.status === "loading" || own.status === "failed" || keeps) sections.push("own");
  sections.push("learn", "account");
  return { sections, empty };
}
