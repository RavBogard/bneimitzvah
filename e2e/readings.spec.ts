import { expect, test, type Page } from "@playwright/test";

// /readings on the built, unconfigured production server. The calendar is a synthetic route fulfilment that arrives after a short delay,
// as a real network would, so the page's own loading states are what is measured.
const NAMES = ["Vayera", "Chayei Sara", "Toldot", "Vayetzei", "Vayishlach", "Vayeshev", "Miketz"];
async function mock(page: Page, latency = 150) {
  await page.route("**/api/public/calendar", async route => {
    await new Promise(resolve => setTimeout(resolve, latency));
    const rows = Array.from({ length: 66 }, (_, i) => ({ date: new Date(Date.UTC(2026, 9, 24 + 7 * i)).toISOString().slice(0, 10), name: NAMES[i % NAMES.length], kind: "regular" }));
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ today: rows[0].date, rows }) }).catch(() => {});
  });
  await page.route("**/api/session", route => route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: "unauthenticated" }) }));
}
test.beforeEach(async ({ page }) => { await page.clock.setFixedTime(new Date("2026-10-21T15:00:00Z")); });

type Shift = { value: number; time: number };
async function watchShifts(page: Page) {
  await page.addInitScript(() => {
    const seen: { value: number; time: number }[] = [];
    (window as unknown as { __shifts: typeof seen }).__shifts = seen;
    try {
      new PerformanceObserver(list => {
        for (const entry of list.getEntries() as unknown as { value: number; startTime: number; hadRecentInput: boolean }[]) if (!entry.hadRecentInput) seen.push({ value: entry.value, time: entry.startTime });
      }).observe({ type: "layout-shift", buffered: true });
    } catch { /* No layout-shift entries here. */ }
  });
}
function cls(shifts: readonly Shift[]): number {
  let worst = 0, total = 0, start = -Infinity, last = -Infinity;
  for (const shift of shifts) {
    if (shift.time - last > 1000 || shift.time - start > 5000) { total = 0; start = shift.time; }
    total += shift.value; last = shift.time; worst = Math.max(worst, total);
  }
  return worst;
}

test("the index lists coming-up Shabbatot, every parashah in Torah order and the holidays, with the next date beside each name", async ({ page }) => {
  await mock(page);
  await page.goto("/readings");
  await expect(page.getByRole("heading", { level: 1, name: "Readings", exact: true })).toBeVisible();
  for (const name of ["Coming up", "The Torah, in order", "Holidays and special Shabbatot", "Any verses"]) await expect(page.getByRole("heading", { level: 2, name, exact: true })).toBeVisible();
  const coming = page.getByTestId("readings-coming-up");
  await expect(coming.getByRole("link")).toHaveCount(6);
  await expect(coming.getByRole("link").first()).toContainText("This Shabbat");
  // The book of the parashah read next is open: Genesis, where Vayera is.
  await expect(page.locator('details[data-book="Genesis"]')).toHaveAttribute("open", "");
  await expect(page.locator('details[data-book="Exodus"]')).not.toHaveAttribute("open", "");
  await expect(page.getByRole("link", { name: /^Toldot next Nov 7$/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  // Roles and names, as visual-system.spec does for the other pages: one h1, a labelled field, named links and buttons, no duplicate ids.
  expect(await page.locator("h1").count()).toBe(1);
  await expect(page.getByRole("combobox", { name: "Find a reading" })).toBeVisible();
  const unnamed = await page.locator("main a, main button").evaluateAll(nodes => nodes.filter(node => !(node.getAttribute("aria-label") || node.textContent?.trim())).length);
  expect(unnamed).toBe(0);
  const ids = await page.locator("[id]").evaluateAll(nodes => nodes.map(node => node.id));
  expect(new Set(ids).size).toBe(ids.length);
});

test("add and prepare carry through: every row keeps the save offer, or opens the preparation page", async ({ page }) => {
  await mock(page);
  await page.goto("/readings?add=1");
  await page.locator("summary", { hasText: "Genesis" }).click();
  await expect(page.getByRole("link", { name: "Noach", exact: true })).toHaveAttribute("href", "/read?reading=noach&save=1");
  await page.goto("/readings?for=prepare");
  await page.locator("summary", { hasText: "Genesis" }).click();
  await expect(page.getByRole("link", { name: "Noach", exact: true })).toHaveAttribute("href", /^\/learn\/prepare\?/);
});

test("/readings does not jump while the calendar arrives (CLS at most 0.07 at 4x CPU, 390 px)", async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 390, height: 844 });
  const client = await page.context().newCDPSession(page);
  await client.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await watchShifts(page);
  await mock(page);
  await page.goto("/readings");
  await expect(page.getByTestId("readings-coming-up").getByRole("link").first()).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(2000);
  const shifts = await page.evaluate(() => (window as unknown as { __shifts: Shift[] }).__shifts);
  await client.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  expect(cls(shifts), JSON.stringify(shifts)).toBeLessThanOrEqual(0.07);
});
