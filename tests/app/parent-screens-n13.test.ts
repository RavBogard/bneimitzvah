// 1.9 N13: the parent's "This week" card, the practice bar, the honors row's place and the G20 adult/learner wording.
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { nextDateLine, relativeDay, weekdayShort } from "../../src/components/portal/workspace/parent-week";

const source = (path: string) => readFileSync(new URL(`../../src/components/portal/${path}`, import.meta.url), "utf8");
const dates = { ceremonyDate: "2026-11-14", rehearsal1: "2026-10-31", rehearsal2: null };

test("the next date is said in relative words, the rehearsal first while one is left and the ceremony after", () => {
  expect(relativeDay(6)).toBe("6 days to go"); expect(relativeDay(1)).toBe("Tomorrow"); expect(relativeDay(0)).toBe("Today"); expect(relativeDay(-2)).toBeNull();
  expect(nextDateLine(dates, "2026-10-25")).toBe("Next rehearsal: Sat, Oct 31 · 6 days to go");
  expect(nextDateLine(dates, "2026-10-31")).toBe("Rehearsal today");
  expect(nextDateLine(dates, "2026-11-01")).toBe("Ceremony: Sat, Nov 14 · 13 days to go");
  expect(nextDateLine(dates, "2026-11-14")).toBe("Ceremony: Sat, Nov 14 · Today");
  expect(nextDateLine(dates, "2026-11-15")).toBeNull();
  expect(weekdayShort("2026-10-24")).toBe("Sat");
});

test("the parent summary is one This week card with the note open and no retired heading", () => {
  const ui = source("workspace/parent-summary.tsx");
  expect(ui).toContain("<h3>This week</h3>"); expect(ui).toContain("Practiced this week:"); expect(ui).toContain("· from ");
  for (const retired of ["Latest saved lesson", "Recorded practice dates", "Read saved lesson note", "Lesson author:", "Seven days ending"]) expect(ui).not.toContain(retired);
  expect(ui).not.toMatch(/<details/);
});

test("every retired TP-14 row is gone from the parent, practice and honors screens and the approved wording stands", () => {
  const all = ["workspace/students.tsx", "workspace/reading.tsx", "workspace/honors/sheet.tsx", "workspace/honors/fields.tsx", "workspace/parent-summary.tsx", "entry.tsx"].map(source).join("\n");
  for (const retired of ["Practice with another child", "Switch practice to", "Return to parent view", "This tab only", "Read-only overview", "Child practice is entered separately", "Use Save honors to record the review"]) expect(all).not.toContain(retired);
  for (const approved of ["Sit down with", "Open the honors form", "Remember to tap Save honors.", "Blessing from family", "Not part of my service", "Send a new code", "Sit with <bdi", "Practicing with <bdi", "reading and practice with"]) expect(all).toContain(approved);
  expect(source("workspace/service-learning/panel.tsx")).toContain("Your service parts will show up here soon. Nothing you've practiced is lost.");
  expect(source("entry.tsx")).toContain("RESEND_AFTER_MS = 60_000");
  // The pre-choice lines went with the lists they sat above: a child's page is opened from the shelf's card, so nothing here asks who to choose (E2, E5).
  for (const retired of ["Choose a child to see their reading.", "Who are you teaching today?", "Choose a child to practice"]) expect(source("workspace/students.tsx")).not.toContain(retired);
});

test("the parent's honors row follows the summary inside the reading, and an adult's follows the reading", () => {
  const reading = source("workspace/reading.tsx"), students = source("workspace/students.tsx");
  expect(reading.indexOf("<ParentStudySummary")).toBeGreaterThan(-1); expect(reading.indexOf("{mode === \"parent\" && afterSummary}")).toBeGreaterThan(reading.indexOf("<ParentStudySummary"));
  const panel = students.indexOf("<ReadingPanel mode={mode}"), adult = students.indexOf("mode === \"student\" && selectedRow?.ownAdultHonors === true");
  expect(panel).toBeGreaterThan(-1); expect(adult).toBeGreaterThan(panel);
});
