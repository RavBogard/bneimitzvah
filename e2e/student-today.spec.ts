import { expect, test, type Page } from "@playwright/test";
import { TANAKH_VERSE_COUNTS } from "../src/lib/readings/catalog";
import { expandReadingRanges } from "../src/lib/readings/ranges";

// 1.9 N11: the student's Today. The built, unconfigured production server answers; the session, student list, reading, marks, practice
// calendar and lesson notes are synthetic route fulfilments with made-up names, and the browser clock is pinned so no check depends on
// the day it runs. Noa's first rehearsal is 2026-10-17; the ceremony is 2026-12-12, two months on.
const binding = "A".repeat(43);
const ID = "11111111-1111-4111-8111-111111111111", TORAH_ID = "33333333-3333-4333-8333-333333333333", HAFTARAH_ID = "44444444-4444-4444-8444-444444444444";
const TORAH = ["Genesis 37:1-40:23"], HAFTARAH = ["Amos 2:6-3:8"];
const torahVerses = expandReadingRanges(TORAH, "torah", TANAKH_VERSE_COUNTS), haftarahVerses = expandReadingRanges(HAFTARAH, "haftarah", TANAKH_VERSE_COUNTS);
const STARTS = ["Genesis 37:23", "Genesis 38:1", "Genesis 38:15", "Genesis 39:1", "Genesis 39:7", "Genesis 40:1"];
const SOURCE = { status: "available", fetchedAt: 0, date: "2026-12-12", calendar: "diaspora", attribution: { name: "Hebcal", url: "https://www.hebcal.com/" } };
const json = (body: unknown, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });

type Fixture = { today?: string; rehearsal1?: string | null; rehearsal2?: string | null; ceremony?: string; practised?: string[]; solid?: number; working?: number[]; note?: boolean; noAliyot?: boolean; beforeNext?: string | null };
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
    const state = (index: number) => ({ assessment: kind === "torah" && index < (f.solid ?? 0) ? "solid" : "not-started", self: kind === "torah" && (f.working ?? []).includes(index) ? "working" : "unmarked" });
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
const today = (page: Page) => page.locator("[data-today]");
const bar = (page: Page) => page.getByRole("navigation", { name: "Workspace", exact: true });

test.use({ timezoneId: "America/Chicago" });
test.describe("at 390x844", () => {
  test.beforeEach(async ({ page }) => { await page.setViewportSize({ width: 390, height: 844 }); });

  test("on the first rehearsal day it says Rehearsal today, in the lake field with the parashah, the countdown and the readings as chips", async ({ page }) => {
    await mock(page, { practised: ["2026-10-12", "2026-10-14", "2026-10-16"] });
    await page.goto("/workspace/student");
    await expect(page.getByRole("heading", { level: 1, name: "Vayeshev", exact: true })).toBeVisible();
    await expect(today(page).getByText("Rehearsal today", { exact: true })).toBeVisible();
    await expect(today(page).getByText(/Next rehearsal/)).toHaveCount(0);
    await expect(today(page).getByText("56 days to go", { exact: true })).toBeVisible();
    await expect(today(page).getByText("Sat, Dec 12, 2026", { exact: true })).toBeVisible();
    const chips = today(page).getByRole("list", { name: "Assigned readings", exact: true }).getByRole("listitem");
    await expect(chips).toHaveText(["Torah Genesis 37:1–40:23", "Haftarah Amos 2:6–3:8"]);
    await expect(bar(page).getByRole("link", { name: "Today", exact: true })).toHaveAttribute("aria-current", "page");
  });

  test("before the first rehearsal it names the next one", async ({ page }) => {
    await mock(page, { today: "2026-10-10" });
    await page.goto("/workspace/student");
    await expect(today(page).getByText("Next rehearsal: Sat, Oct 17", { exact: true })).toBeVisible();
  });

  test("after both rehearsals it names none", async ({ page }) => {
    await mock(page, { today: "2026-11-20" });
    await page.goto("/workspace/student");
    await expect(page.getByRole("heading", { level: 1, name: "Vayeshev", exact: true })).toBeVisible();
    await expect(today(page).getByText(/rehearsal/i)).toHaveCount(0);
  });

  test("Today fits in one and a half screens", async ({ page }) => {
    await mock(page, { practised: ["2026-10-14"], solid: 23, working: [30] });
    await page.goto("/workspace/student");
    await expect(today(page).getByRole("list", { name: "Reading sections", exact: true }).getByRole("listitem")).toHaveCount(8);
    await expect(today(page).getByText("Practice calendar", { exact: true })).toBeVisible();
    // Today is the screen: the shell around it (app bar, footer, tab bar) is not counted. The fullest case is checked, a Torah reading with seven aliyot and a haftarah (eight rows).
    const height = await page.locator("#workspace-main").evaluate(node => node.getBoundingClientRect().height);
    expect(height, "Today height").toBeLessThanOrEqual(Math.round(844 * 1.5));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });

  test("the Next card has one button, Start where you left off, once there is something to leave off from", async ({ page }) => {
    await mock(page, { practised: ["2026-10-14"], solid: 23 });
    await page.goto("/workspace/student");
    const next = today(page).locator("section").filter({ has: page.getByRole("link", { name: /Start where you left off|Practice verses/ }) });
    await expect(next.getByRole("link")).toHaveCount(1);
    await expect(next.getByRole("link", { name: "Start where you left off", exact: true })).toHaveAttribute("href", "/workspace/student?tab=reading");
    // Aliyah 1 is solid, so the place is the second aliyah.
    await expect(next.getByRole("heading", { name: /^Aliyah 2 Genesis 37:23.36$/ })).toBeVisible();
  });

  test("with nothing practised yet the one button is Practice verses and the first range", async ({ page }) => {
    await mock(page);
    await page.goto("/workspace/student");
    await expect(page.getByRole("link", { name: "Practice verses Genesis 37:1–22", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Start where you left off" })).toHaveCount(0);
  });

  test("each reading section is a row with a dot and the words not started, working or solid", async ({ page }) => {
    await mock(page, { solid: 23, working: [30] });
    await page.goto("/workspace/student");
    const rows = today(page).getByRole("list", { name: "Reading sections", exact: true }).getByRole("listitem");
    await expect(rows).toHaveCount(8);
    await expect(rows.nth(0)).toContainText("Aliyah 1"); await expect(rows.nth(0)).toContainText("Solid");
    await expect(rows.nth(1)).toContainText("Aliyah 2"); await expect(rows.nth(1)).toContainText("Working");
    await expect(rows.nth(2)).toContainText("Not started");
    await expect(rows.nth(7)).toContainText("Haftarah"); await expect(rows.nth(7)).toContainText("Not started");
    await expect(rows.nth(0).locator("a")).toHaveAttribute("href", "/workspace/student?tab=reading");
  });

  test("a reading without aliyot is a row for the Torah and one for the haftarah", async ({ page }) => {
    await mock(page, { noAliyot: true });
    await page.goto("/workspace/student");
    const rows = today(page).getByRole("list", { name: "Reading sections", exact: true }).getByRole("listitem");
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText("Torah"); await expect(rows.nth(1)).toContainText("Haftarah");
  });

  test("seven quiet dots show the last seven days with no number, tally or streak wording", async ({ page }) => {
    await mock(page, { practised: ["2026-10-12", "2026-10-14", "2026-10-16"] });
    await page.goto("/workspace/student");
    const dots = today(page).locator(".practice-week");
    await expect(dots.locator("li")).toHaveCount(7);
    await expect(dots.locator(".practice-day-done")).toHaveCount(3);
    const text = (await dots.textContent()) ?? "", section = (await today(page).locator("section").filter({ has: page.locator(".practice-week") }).textContent()) ?? "";
    expect(text).not.toMatch(/\d/);
    expect(section).not.toMatch(/streak|in a row|total|\bof\b.*\bdays\b/i);
    await expect(today(page).getByText("Days you practised · a day fills when you open your reading up close", { exact: true })).toBeVisible();
  });

  test("the latest lesson note is pinned, with Before next time when the tutor wrote one", async ({ page }) => {
    await mock(page, { beforeNext: "When I finish the first aliyah, I will chant it once without the recording." });
    await page.goto("/workspace/student");
    await expect(today(page).getByText("Latest from Synthetic Tutor · Oct 14:", { exact: true })).toBeVisible();
    await expect(today(page).getByText("Chanted the first aliyah twice. Slow down at the etnachta.")).toBeVisible();
    await expect(today(page).getByText("Before your next lesson: When I finish the first aliyah, I will chant it once without the recording.", { exact: true })).toBeVisible();
  });

  test("without a Before next time line the note stands alone", async ({ page }) => {
    await mock(page);
    await page.goto("/workspace/student");
    await expect(today(page).getByText("Latest from Synthetic Tutor · Oct 14:", { exact: true })).toBeVisible();
    await expect(today(page).getByText(/Before your next lesson/)).toHaveCount(0);
  });

  test("the calendar marks the rehearsals and the ceremony, and goes forward to the ceremony month", async ({ page }) => {
    await mock(page, { practised: ["2026-10-14"] });
    await page.goto("/workspace/student");
    await today(page).getByText("Practice calendar", { exact: true }).click();
    await expect(today(page).getByText("October 2026", { exact: true })).toBeVisible();
    await expect(today(page).getByRole("cell", { name: /Saturday, October 17, today, rehearsal/ })).toBeVisible();
    await today(page).getByRole("button", { name: "Next month", exact: true }).click();
    await expect(today(page).getByRole("cell", { name: /Saturday, November 7, rehearsal/ })).toBeVisible();
    await today(page).getByRole("button", { name: "Next month", exact: true }).click();
    await expect(today(page).getByText("December 2026", { exact: true })).toBeVisible();
    await expect(today(page).getByRole("cell", { name: /Saturday, December 12, ceremony/ })).toBeVisible();
    // The months stop at the ceremony month.
    await expect(today(page).getByRole("button", { name: "Next month", exact: true })).toBeDisabled();
    // A mark is said in words as well as drawn.
    await expect(today(page).getByText("Rehearsal", { exact: true })).toBeVisible(); await expect(today(page).getByText("Ceremony", { exact: true })).toBeVisible();
  });
});

for (const width of [375, 390, 412]) {
  test(`no reference or date breaks across lines at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await mock(page, { practised: ["2026-10-14"], solid: 23 });
    await page.goto("/workspace/student");
    await expect(page.getByRole("heading", { level: 1, name: "Vayeshev", exact: true })).toBeVisible();
    await expect(today(page).getByRole("list", { name: "Reading sections", exact: true }).getByRole("listitem")).toHaveCount(8);
    expect(await page.locator("[data-nobreak]").count()).toBeGreaterThan(8);
    const broken = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>("[data-nobreak], [data-today] li > span")].flatMap(node => {
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
