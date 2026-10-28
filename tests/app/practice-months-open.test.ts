import { expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PracticeMonths } from "../../src/components/portal/workspace/practice-calendar/view";
import { dayOrdinal } from "../../src/components/portal/workspace/practice-calendar/api";
import type { CalendarMark } from "../../src/components/portal/workspace/practice-calendar/view";

// Student walk finding 16: the calendar opens on the month of the next marked day, not on a month with nothing marked.
const title = (today: string, first: string, marks: [string, CalendarMark][], lastDay?: string) => renderToStaticMarkup(createElement(PracticeMonths, {
  today: dayOrdinal(today), first: dayOrdinal(first), practiced: () => false, marks: new Map(marks), lastDay: lastDay ? dayOrdinal(lastDay) : undefined,
})).match(/practice-month-title[^>]*>([^<]*)</)?.[1];

it("opens on the month of the next rehearsal, then of the ceremony once rehearsals are past", () => {
  const marks: [string, CalendarMark][] = [["2026-12-12", "rehearsal"], ["2026-12-26", "ceremony"]];
  expect(title("2026-10-28", "2026-09-01", marks, "2026-12-26")).toBe("December 2026");
  expect(title("2026-12-20", "2026-09-01", marks, "2026-12-26")).toBe("December 2026");
  expect(title("2026-10-28", "2026-09-01", [["2026-11-14", "rehearsal"], ["2026-12-26", "ceremony"]], "2026-12-26")).toBe("November 2026");
});

it("opens on this month when nothing is marked ahead, or the marked month is outside the range", () => {
  expect(title("2026-10-28", "2026-09-01", [])).toBe("October 2026");
  expect(title("2026-10-28", "2026-09-01", [["2026-10-05", "rehearsal"]], "2026-10-28")).toBe("October 2026");
  expect(title("2026-10-28", "2026-09-01", [["2026-12-12", "rehearsal"]])).toBe("October 2026"); // no lastDay: the months stop at today
});
