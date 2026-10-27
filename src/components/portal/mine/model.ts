// The shelf's pure model (Area A, Task A4): which sections My Readings shows, in what order, and whether it is empty. No React, so it is
// unit-tested without a browser. Area D adds sections by extending `ShelfSection`; the order here is decision 9's.
import type { SessionSummary } from "../api";
import type { SavedReading } from "../saved/api";

export type OwnReadingsState = Readonly<{ status: "loading" } | { status: "ready"; readings: readonly SavedReading[] } | { status: "failed" } | { status: "hidden" }>;
/** The student's pinned reading card. Filled by Task E1; `null` until then. */
export type PinnedState = Readonly<{ name: string; ceremony: string | null; done: number; total: number; href: string }>;
/** The Learn row's second line: the next lesson, "Start the course", or nothing once the course is done. */
export type LearnRowState = Readonly<{ meta: string | null }>;
export type ShelfSection = "pinned" | "own" | "learn" | "account";
export type ShelfView = Readonly<{
  /** The sections to draw, in order. */
  sections: readonly ShelfSection[];
  /** The first-sign-in state: nothing kept and nothing pinned. `line` is null where saving is not open to this membership yet (hidden). */
  empty: null | Readonly<{ line: string | null }>;
}>;

export type InterimRow = Readonly<{ role: "student" | "parent" | "tutor"; title: string; href: string; action: string | null }>;
/** The interim rows, in role order. Existing words only. */
export function interimRows(roles: readonly string[]): InterimRow[] {
  const rows: InterimRow[] = [];
  if (roles.includes("student")) rows.push({ role: "student", title: "Beit Mitzvah", href: "/workspace/student", action: "Open" });
  if (roles.includes("parent")) rows.push({ role: "parent", title: "Beit Mitzvah", href: "/workspace/parent", action: "Open" });
  if (roles.includes("tutor")) rows.push({ role: "tutor", title: "Your students", href: "/workspace/tutor", action: null });
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
  const empty = settled && !keeps && !pinned ? { line: own.status === "ready" ? EMPTY_LINE : null } : null;
  const sections: ShelfSection[] = [];
  // Interim: a student, parent or tutor gets a row to their Beit Mitzvah pages until Area E (E1, E2, D7) replaces it.
  if (pinned || interimRows(input.summary.roles).length) sections.push("pinned");
  if (own.status === "loading" || own.status === "failed" || keeps) sections.push("own");
  sections.push("learn", "account");
  return { sections, empty };
}
