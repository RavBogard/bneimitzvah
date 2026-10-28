import { expect, it } from "vitest";
import { calendarMarks, deviceDate, displayRef, lastSevenDays, parashahName, readingRows, nextDateLine, rehearsalLine, rowState } from "../../src/components/portal/workspace/today/model";
import type { Reading } from "../../src/components/portal/workspace/api";
import type { ProgressVerse } from "../../src/lib/progress/types";
import { expandReadingRanges } from "../../src/lib/readings/ranges";
import { TANAKH_VERSE_COUNTS } from "../../src/lib/readings/catalog";

const rehearsals = { rehearsal1: "2026-10-17", rehearsal2: "2026-11-07" };

it("says Rehearsal today on the day, and otherwise the next one still to come", () => {
  expect(rehearsalLine(rehearsals, "2026-10-17")).toBe("Rehearsal today");
  expect(rehearsalLine(rehearsals, "2026-11-07")).toBe("Rehearsal today");
  expect(rehearsalLine(rehearsals, "2026-10-10")).toBe("Next rehearsal: Sat, Oct 17");
  expect(rehearsalLine(rehearsals, "2026-10-18")).toBe("Next rehearsal: Sat, Nov 7");
  expect(rehearsalLine(rehearsals, "2026-11-08")).toBeNull();
  expect(rehearsalLine({ rehearsal1: null, rehearsal2: null }, "2026-10-17")).toBeNull();
  expect(rehearsalLine({}, "2026-10-17")).toBeNull();
});

it("names the next marked date: a rehearsal, then the Beit Mitzvah, then nothing", () => {
  const student = { ...rehearsals, ceremonyDate: "2026-12-26" };
  expect(nextDateLine(student, "2026-10-17")).toBe("Rehearsal today");
  expect(nextDateLine(student, "2026-10-10")).toBe("Next: Rehearsal Sat, Oct 17");
  expect(nextDateLine(student, "2026-11-08")).toBe("Next: Beit Mitzvah Sat, Dec 26");
  expect(nextDateLine({ rehearsal1: null, rehearsal2: null, ceremonyDate: "2026-12-26" }, "2026-10-10")).toBe("Next: Beit Mitzvah Sat, Dec 26");
  expect(nextDateLine(student, "2026-12-26")).toBeNull();
});

it("reads the device date on the calendar, not the instant", () => {
  expect(deviceDate(new Date(2026, 9, 17, 23, 59))).toBe("2026-10-17");
  expect(deviceDate(new Date(2026, 0, 2, 0, 1))).toBe("2026-01-02");
});

it("names the parashah from the reading key, and nothing for a reading that is not one", () => {
  expect(parashahName({ readingKey: "vayeshev" })).toBe("Vayeshev");
  expect(parashahName({ readingKey: "vayakhel-pekudei" })).toBe("Vayakhel-Pekudei");
  expect(parashahName({ readingKey: "pesach-day-1" })).toBeNull();
  expect(parashahName({ readingKey: null })).toBeNull();
  expect(parashahName(undefined)).toBeNull();
});

const reading = (kind: "torah" | "haftarah", ranges: string[], aliyahStarts: string[] | null): Reading => ({ id: kind, kind, revision: 1, ranges, verses: expandReadingRanges(ranges, kind, TANAKH_VERSE_COUNTS), needsReview: false, aliyahStarts, readingKey: null,
  source: { status: "available", fetchedAt: 0, date: null, calendar: null, attribution: null }, confirmationDate: null, basis: "custom" });

it("makes one row per aliyah where there are aliyot, else one per reading, and each reference stays one unit", () => {
  const torah = reading("torah", ["Genesis 37:1-40:23"], ["Genesis 37:23", "Genesis 38:1"]), haftarah = reading("haftarah", ["Amos 2:6-3:8"], null);
  expect(readingRows([torah, haftarah]).map(row => [row.label, row.ref])).toEqual([["Aliyah 1", "Genesis 37:1–22"], ["Aliyah 2", "Genesis 37:23–36"], ["Aliyah 3", "Genesis 38:1–40:23"], ["Haftarah", "Amos 2:6–3:8"]]);
  expect(readingRows([reading("torah", ["Genesis 37:1-40:23"], null), haftarah]).map(row => row.label)).toEqual(["Torah", "Haftarah"]);
  expect(readingRows([])).toEqual([]);
  expect(displayRef("Isaiah 27:6-28:13; Isaiah 29:22-23")).toBe("Isaiah 27:6–28:13; Isaiah 29:22–23");
});

const verse = (assessment: ProgressVerse["assessment"]["state"], self: ProgressVerse["selfCheck"]["state"] = "unmarked"): ProgressVerse => ({ verseRef: "Genesis 1:1", selfCheck: { state: self, version: 0 }, assessment: { state: assessment, version: 0 } });

it("calls a stretch solid only when the tutor has assessed every verse solid, and a student's own Got it never reads as Solid", () => {
  expect(rowState([verse("solid"), verse("solid")], 0, 2)).toBe("solid");
  expect(rowState([verse("solid"), verse("working")], 0, 2)).toBe("working");
  expect(rowState([verse("not-started", "got-it"), verse("not-started", "got-it")], 0, 2)).toBe("working");
  expect(rowState([verse("not-started", "working"), verse("not-started")], 0, 2)).toBe("working");
  expect(rowState([verse("not-started"), verse("not-started")], 0, 2)).toBe("not-started");
  // Only the stretch asked about counts.
  expect(rowState([verse("solid"), verse("not-started")], 0, 1)).toBe("solid");
  expect(rowState([], 0, 0)).toBe("not-started");
});

it("gives the last seven days oldest first, with no count in it", () => {
  const days = lastSevenDays("2026-10-17", new Set(["2026-10-11", "2026-10-15", "2026-10-17", "2026-09-01"]));
  expect(days.map(day => day.date)).toEqual(["2026-10-11", "2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17"]);
  expect(days.map(day => day.practised)).toEqual([true, false, false, false, true, false, true]);
  expect(days.filter(day => day.today).map(day => day.date)).toEqual(["2026-10-17"]);
  // 2026-10-17 is a Saturday (6), 2026-10-11 a Sunday (0).
  expect(days[0].weekday).toBe(0); expect(days[6].weekday).toBe(6);
  expect(JSON.stringify(days)).not.toMatch(/streak|count|total/i);
});

it("marks the rehearsals and the ceremony, the ceremony winning if they share a day", () => {
  const marks = calendarMarks({ ceremonyDate: "2026-12-12", ...rehearsals });
  expect([...marks]).toEqual([["2026-10-17", "rehearsal"], ["2026-11-07", "rehearsal"], ["2026-12-12", "ceremony"]]);
  expect(calendarMarks({ ceremonyDate: "2026-12-12", rehearsal1: "2026-12-12", rehearsal2: null }).get("2026-12-12")).toBe("ceremony");
});
