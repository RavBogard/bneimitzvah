// What the workspace reading's title block says (Readings for everyone E2), as pure functions, so the line and the pills are tested without a browser.
import type { Reading, Student } from "./api";

const displayRange = (ranges: readonly string[]) => ranges.join("; ").replace(/(\d)-(\d)/g, "$1\u2013$2");

/** The reading the line names: the Torah when there is one, else the first. Nothing while the portion is only being explored (no Torah is assigned). */
export function titleReading(readings: readonly Reading[], exploring: boolean): string | null {
  const row = readings.find(item => item.kind === "torah") ?? readings[0];
  return !exploring && row ? `${row.kind === "torah" ? "Torah" : "Haftarah"} ${displayRange(row.ranges)}` : null;
}

/** "Beit Mitzvah · Sat, May 1, 2027 · Torah Genesis 1:1–3": the one muted line under the name. `date` is the ceremony date's label. */
export const titleLineText = (date: string, reading: string | null) => `Beit Mitzvah · ${date}${reading ? ` · ${reading}` : ""}`;

/** The title block's name: first and last, never a pronoun. */
export const titleName = (student: Pick<Student, "firstName" | "lastName">) => `${student.firstName} ${student.lastName}`;

/** The pills, in order: every reader has Change (Go to verse); staff also have Manage, where the other actions are. */
export const titlePillKeys = (staff: boolean): ("change" | "manage")[] => staff ? ["change", "manage"] : ["change"];
