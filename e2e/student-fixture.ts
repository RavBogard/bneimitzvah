import type { Page } from "@playwright/test";
import { TANAKH_VERSE_COUNTS } from "../src/lib/readings/catalog";
import { expandReadingRanges } from "../src/lib/readings/ranges";

// Readings for everyone E1: the student's pinned reading, the first card on /mine (was the 1.9 N11 Today). The built, unconfigured production server answers; the session, student list, reading, marks, practice
// calendar and lesson notes are synthetic route fulfilments with made-up names, and the browser clock is pinned so no check depends on
// the day it runs. Noa's first rehearsal is 2026-10-17; the ceremony is 2026-12-12, two months on.
export const binding = "A".repeat(43);
const ID = "11111111-1111-4111-8111-111111111111", TORAH_ID = "33333333-3333-4333-8333-333333333333", HAFTARAH_ID = "44444444-4444-4444-8444-444444444444";
const TORAH = ["Genesis 37:1-40:23"], HAFTARAH = ["Amos 2:6-3:8"];
const torahVerses = expandReadingRanges(TORAH, "torah", TANAKH_VERSE_COUNTS), haftarahVerses = expandReadingRanges(HAFTARAH, "haftarah", TANAKH_VERSE_COUNTS);
/** How many verses the two readings have together. */
export const verseTotal = torahVerses.length + haftarahVerses.length;
const STARTS = ["Genesis 37:23", "Genesis 38:1", "Genesis 38:15", "Genesis 39:1", "Genesis 39:7", "Genesis 40:1"];
const SOURCE = { status: "available", fetchedAt: 0, date: "2026-12-12", calendar: "diaspora", attribution: { name: "Hebcal", url: "https://www.hebcal.com/" } };
const json = (body: unknown, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });

export type Fixture = { today?: string; rehearsal1?: string | null; rehearsal2?: string | null; ceremony?: string; practised?: string[]; solid?: number; working?: number[]; got?: number[]; note?: boolean; noAliyot?: boolean; beforeNext?: string | null };
export async function mock(page: Page, f: Fixture = {}) {
  const today = f.today ?? "2026-10-17", ceremony = f.ceremony ?? "2026-12-12";
  await page.clock.setFixedTime(new Date(`${today}T15:00:00-05:00`));
  await page.route("**/api/**", route => route.fulfill(json({}, 503)));
  await page.route("**/api/session", route => route.fulfill(json({ membershipAvailable: true, roles: ["student"], saved: true, approver: false, sessionBinding: binding })));
  const student = { id: ID, firstName: "Noa", lastName: "Synthetic", ceremonyDate: ceremony, revision: 1, rehearsal1: f.rehearsal1 === undefined ? "2026-10-17" : f.rehearsal1, rehearsal2: f.rehearsal2 === undefined ? "2026-11-07" : f.rehearsal2 };
  await page.route("**/api/students?*", route => route.fulfill(json({ students: [student] })));
  const readings = [
    { id: TORAH_ID, status: "confirmed", kind: "torah", basis: "triennial", revision: 1, ranges: TORAH, verses: torahVerses, confirmationDate: null, needsReview: false, source: SOURCE, aliyahStarts: f.noAliyot ? null : STARTS, readingKey: "vayeshev" },
    { id: HAFTARAH_ID, status: "confirmed", kind: "haftarah", basis: "custom", revision: 1, ranges: HAFTARAH, verses: haftarahVerses, confirmationDate: null, needsReview: false, source: SOURCE, aliyahStarts: null },
  ];
  await page.route("**/api/students/*/reading?*", route => route.fulfill(json({ student, mode: "student", context: null, readings, referenceListeningEnabled: false })));
  await page.route("**/api/students/*/progress?*", route => {
    const q = new URL(route.request().url()).searchParams, kind = q.get("kind") as "torah" | "haftarah", offset = Number(q.get("offset") ?? "0");
    const all = kind === "torah" ? torahVerses : haftarahVerses, reading = readings.find(row => row.kind === kind)!;
    const state = (index: number) => ({ assessment: kind === "torah" && index < (f.solid ?? 0) ? "solid" : "not-started", self: kind === "torah" && (f.got ?? []).includes(index) ? "got-it" : kind === "torah" && (f.working ?? []).includes(index) ? "working" : "unmarked" });
    const rows = all.map((ref, index) => ({ verseRef: ref, selfCheck: { state: state(index).self, version: 0 }, assessment: { state: state(index).assessment, version: 0 } }));
    const page_ = rows.slice(offset, offset + 100), next = offset + page_.length < all.length ? offset + page_.length : null;
    const tally = (pick: (row: (typeof rows)[number]) => string, states: string[]) => Object.fromEntries(states.map(name => [name, rows.filter(row => pick(row) === name).length]));
    route.fulfill(json({ ok: true, binding: { studentId: ID, mode: "student", kind, assignmentId: reading.id, assignmentRevision: 1 }, offset, nextOffset: next, totalVerses: all.length, verses: page_,
      counts: { selfCheck: tally(row => row.selfCheck.state, ["unmarked", "working", "got-it"]), assessment: tally(row => row.assessment.state, ["not-started", "working", "solid"]) } }));
  });
  await page.route("**/api/students/*/practice-calendar?*", route => {
    const q = new URL(route.request().url()).searchParams;
    route.fulfill(json({ ok: true, studentId: ID, mode: "student", serverDay: today, dates: (f.practised ?? []).filter(date => date >= q.get("fromDate")! && date <= q.get("throughDate")!) }));
  });
  await page.route("**/api/students/*/lesson-log?*", route => route.fulfill(json({ ok: true, studentId: ID, mode: "student", nextCursor: null,
    entries: f.note === false ? [] : [{ entryId: "55555555-5555-4555-8555-555555555555", lessonDate: "2026-10-14", summary: "Chanted the first aliyah twice. Slow down at the etnachta.",
      beforeNext: f.beforeNext === undefined ? null : f.beforeNext, version: 1, displayName: "Synthetic Tutor", canEdit: false, canDelete: false }] })));
}
