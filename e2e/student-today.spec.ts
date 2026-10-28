import { expect, test, type Page } from "@playwright/test";
import { mock, verseTotal } from "./student-fixture";

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
    await expect(card(page).getByTestId("rehearsal-line")).toHaveCount(0);
  });

  test("it says what the student has, as a position: Verses you've got and 9 of the reading", async ({ page }) => {
    await mock(page, { got: [0, 1, 2, 3, 4, 5, 6, 7, 8] });
    await page.goto("/mine");
    const total = verseTotal;
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
    expect(text).toContain("practiced");
    await expect(card(page).getByText("Days you practiced · a day fills when you open your reading up close", { exact: true })).toBeVisible();
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
