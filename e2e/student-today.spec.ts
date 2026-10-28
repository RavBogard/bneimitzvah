import { expect, test, type Page } from "@playwright/test";
import { TANAKH_VERSE_COUNTS } from "../src/lib/readings/catalog";
import { expandReadingRanges } from "../src/lib/readings/ranges";

// Readings for everyone E1: the student's pinned reading, the first card on /mine (was the 1.9 N11 Today). The built, unconfigured production server answers; the session, student list, reading, marks, practice
// calendar and lesson notes are synthetic route fulfilments with made-up names, and the browser clock is pinned so no check depends on
// the day it runs. Noa's first rehearsal is 2026-10-17; the ceremony is 2026-12-12, two months on.
const binding = "A".repeat(43);
const ID = "11111111-1111-4111-8111-111111111111", TORAH_ID = "33333333-3333-4333-8333-333333333333", HAFTARAH_ID = "44444444-4444-4444-8444-444444444444";
const TORAH = ["Genesis 37:1-40:23"], HAFTARAH = ["Amos 2:6-3:8"];
const torahVerses = expandReadingRanges(TORAH, "torah", TANAKH_VERSE_COUNTS), haftarahVerses = expandReadingRanges(HAFTARAH, "haftarah", TANAKH_VERSE_COUNTS);
const STARTS = ["Genesis 37:23", "Genesis 38:1", "Genesis 38:15", "Genesis 39:1", "Genesis 39:7", "Genesis 40:1"];
const SOURCE = { status: "available", fetchedAt: 0, date: "2026-12-12", calendar: "diaspora", attribution: { name: "Hebcal", url: "https://www.hebcal.com/" } };
const json = (body: unknown, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });

type Fixture = { today?: string; rehearsal1?: string | null; rehearsal2?: string | null; ceremony?: string; practised?: string[]; solid?: number; working?: number[]; got?: number[]; note?: boolean; noAliyot?: boolean; beforeNext?: string | null };
async function mock(page: Page, f: Fixture = {}) {
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
const card = (page: Page) => page.locator("[data-pinned-card]");

test.use({ timezoneId: "America/Chicago" });
test.describe("at 390x844", () => {
  test.beforeEach(async ({ page }) => { await page.setViewportSize({ width: 390, height: 844 }); });

  test("the pinned card is first on /mine: the chip with the date, the name, the countdown and the ranges", async ({ page }) => {
    await mock(page, { practised: ["2026-10-12", "2026-10-14", "2026-10-16"] });
    await page.goto("/mine");
    await expect(page.getByRole("heading", { level: 1, name: "My Readings", exact: true })).toBeVisible();
    await expect(card(page).getByText("Beit Mitzvah · Sat, Dec 12, 2026", { exact: true })).toBeVisible();
    await expect(card(page).getByRole("heading", { level: 2, name: "Noa Synthetic", exact: true })).toBeVisible();
    await expect(card(page).getByText("56 days to go", { exact: true })).toBeVisible();
    await expect(card(page).getByText("Torah Genesis 37:1–40:23 · Haftarah Amos 2:6–3:8", { exact: true })).toBeVisible();
    await expect(card(page).getByText("Rehearsal today", { exact: true })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Workspace", exact: true })).toHaveCount(0); // a student has no tab bar (Area A)
  });

  test("before the first rehearsal it names the next one; after both it names none", async ({ page }) => {
    await mock(page, { today: "2026-10-10" });
    await page.goto("/mine");
    await expect(card(page).getByText("Next rehearsal: Sat, Oct 17", { exact: true })).toBeVisible();
    await mock(page, { today: "2026-11-20" });
    await page.goto("/mine");
    await expect(card(page).getByText("Sat, Dec 12, 2026")).toBeVisible();
    await expect(card(page).getByText(/rehearsal/i)).toHaveCount(0);
  });

  test("it says what the student has, as a position: Verses you've got and 9 of the reading", async ({ page }) => {
    await mock(page, { got: [0, 1, 2, 3, 4, 5, 6, 7, 8] });
    await page.goto("/mine");
    const total = torahVerses.length + haftarahVerses.length;
    await expect(card(page).getByText("Verses you’ve got", { exact: true })).toBeVisible();
    await expect(card(page).getByText(`9 of ${total}`, { exact: true })).toBeVisible();
  });

  test("the card has one primary link, Open, to the reading, and the two places inside it", async ({ page }) => {
    await mock(page);
    await page.goto("/mine");
    await expect(card(page).getByRole("link", { name: "Open", exact: true })).toHaveAttribute("href", "/mine/reading");
    await expect(card(page).getByRole("link", { name: "Service parts", exact: true })).toHaveAttribute("href", "/mine/reading#service-parts");
    await expect(card(page).getByRole("link", { name: "Lessons", exact: true })).toHaveAttribute("href", "/mine/reading#lessons");
    await expect(page.getByRole("link", { name: /Practice verses|Start where you left off/ })).toHaveCount(0);
  });

  test("no button or link in the card clips its text at 320px", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await mock(page, { practised: ["2026-10-14"], got: [0, 1, 2] });
    await page.goto("/mine");
    await expect(card(page).getByRole("link", { name: "Open", exact: true })).toBeVisible();
    const clipped = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>("button, a.button, [data-pinned-card] a")].filter(node => node.scrollWidth > node.clientWidth).map(node => node.textContent));
    expect(clipped).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });

  test("seven quiet dots show the last seven days with no number, tally or streak wording", async ({ page }) => {
    await mock(page, { practised: ["2026-10-12", "2026-10-14", "2026-10-16"] });
    await page.goto("/mine");
    const dots = card(page).locator(".practice-week");
    await expect(dots.locator("li")).toHaveCount(7);
    await expect(dots.locator(".practice-day-done")).toHaveCount(3);
    const text = (await dots.textContent()) ?? "";
    expect(text).not.toMatch(/\d/);
    expect(text).toContain("practised"); expect(text).not.toContain("practiced");
    await expect(card(page).getByText("Days you practised · a day fills when you open your reading up close", { exact: true })).toBeVisible();
  });

  test("the latest lesson note is pinned, with Before next time when the tutor wrote one", async ({ page }) => {
    await mock(page, { beforeNext: "When I finish the first aliyah, I will chant it once without the recording." });
    await page.goto("/mine");
    await expect(card(page).getByText("Latest from Synthetic Tutor · Oct 14:", { exact: true })).toBeVisible();
    await expect(card(page).getByText("Chanted the first aliyah twice. Slow down at the etnachta.")).toBeVisible();
    await expect(card(page).getByText("Before your next lesson: When I finish the first aliyah, I will chant it once without the recording.", { exact: true })).toBeVisible();
  });

  test("without a note there is no note block, and without a Before next time line the note stands alone", async ({ page }) => {
    await mock(page, { note: false });
    await page.goto("/mine");
    await expect(card(page).getByRole("heading", { level: 2, name: "Noa Synthetic" })).toBeVisible();
    await expect(card(page).getByTestId("today-note")).toHaveCount(0);
    await mock(page);
    await page.goto("/mine");
    await expect(card(page).getByText(/Before your next lesson/)).toHaveCount(0);
    await expect(card(page).getByTestId("today-note")).toBeVisible();
  });

  test("the calendar marks the rehearsals and the ceremony, and goes forward to the ceremony month", async ({ page }) => {
    await mock(page, { practised: ["2026-10-14"] });
    await page.goto("/mine");
    await card(page).getByText("Practice calendar", { exact: true }).click();
    await expect(card(page).getByText("October 2026", { exact: true })).toBeVisible();
    await expect(card(page).getByRole("cell", { name: /Saturday, October 17, today, rehearsal/ })).toBeVisible();
    await card(page).getByRole("button", { name: "Next month", exact: true }).click();
    await expect(card(page).getByRole("cell", { name: /Saturday, November 7, rehearsal/ })).toBeVisible();
    await card(page).getByRole("button", { name: "Next month", exact: true }).click();
    await expect(card(page).getByText("December 2026", { exact: true })).toBeVisible();
    await expect(card(page).getByRole("cell", { name: /Saturday, December 12, ceremony/ })).toBeVisible();
    await expect(card(page).getByRole("button", { name: "Next month", exact: true })).toBeDisabled();
  });
});

for (const width of [375, 390, 412]) {
  test(`no reference or date breaks across lines at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await mock(page, { practised: ["2026-10-14"], solid: 23 });
    await page.goto("/mine");
    await expect(card(page).getByRole("heading", { level: 2, name: "Noa Synthetic" })).toBeVisible();
    const broken = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>("[data-pinned-card] [data-nobreak]")].flatMap(node => {
      const tops = new Set<number>(), walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
      for (let text = walker.nextNode(); text; text = walker.nextNode()) { const range = document.createRange(); range.selectNodeContents(text); for (const rect of range.getClientRects()) if (rect.width > 0) tops.add(Math.round(rect.top / 4)); }
      return tops.size > 1 ? [`${node.textContent} on ${tops.size} lines`] : [];
    }));
    expect(broken).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test("Account has Need help? for a student", async ({ page }) => {
  await mock(page);
  await page.goto("/account");
  await expect(page.getByRole("link", { name: "Need help?", exact: true })).toBeVisible();
});
