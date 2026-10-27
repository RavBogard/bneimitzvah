import { expect, test, type Page } from "@playwright/test";

// Find a reading on the home, against synthetic route fulfilments: the calendar, the week and the session are fixed, so the field's own
// client code is what is under test. The clock is fixed to a Wednesday so "This Shabbat" is 2026-10-24's following Saturday.
const NAMES = ["Vayera", "Chayei Sara", "Toldot", "Vayetzei", "Vayishlach", "Vayeshev", "Miketz"];
async function mock(page: Page, calendar: "ok" | "fail" = "ok") {
  await page.route("**/api/session", route => route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: "unauthenticated" }) }));
  await page.route("**/api/public/calendar", route => {
    if (calendar === "fail") return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "unavailable" }) });
    const rows = Array.from({ length: 66 }, (_, i) => ({ date: new Date(Date.UTC(2026, 9, 24 + 7 * i)).toISOString().slice(0, 10), name: NAMES[i % NAMES.length], kind: "regular" }));
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ today: rows[0].date, rows }) });
  });
  await page.route("**/api/public/reading?*", route => route.fulfill({ contentType: "application/json", body: JSON.stringify({ date: new URL(route.request().url()).searchParams.get("date"),
    parashah: "Vayera", fetchedAt: 0, listening: { pocketTorah: false }, torah: null, haftarah: null }) }));
}
test.beforeEach(async ({ page }) => { await page.clock.setFixedTime(new Date("2026-10-21T15:00:00Z")); });

test("typing a parashah lists it with the Shabbat it is next read, and Enter opens it", async ({ page }) => {
  await mock(page);
  await page.route("**/read?reading=*", route => route.fulfill({ contentType: "text/html", body: "<title>reading</title>" }));
  await page.goto("/");
  const field = page.getByRole("combobox", { name: "Find a reading" });
  await field.fill("Tol");
  await expect(page.getByRole("option").first()).toContainText("Toldot");
  await field.press("Enter");
  await expect(page).toHaveURL(/\/read\?reading=toldot$/);
});

test("a date finds the Shabbat on or after it, with that week's name", async ({ page }) => {
  await mock(page);
  await page.route("**/read?date=*", route => route.fulfill({ contentType: "text/html", body: "<title>reading</title>" }));
  await page.goto("/");
  const field = page.getByRole("combobox", { name: "Find a reading" });
  await field.fill("Nov 14");
  await expect(page.getByRole("option").first()).toContainText("November 14, 2026");
  await field.press("Enter");
  await expect(page).toHaveURL(/\/read\?date=2026-11-14$/);
});

test("an unknown text says so, and the Coming up chips are links to the next four Shabbatot", async ({ page }) => {
  await mock(page);
  await page.goto("/");
  await expect(page.getByRole("link", { name: "This Shabbat", exact: true }).first()).toBeVisible();
  const chips = page.locator("[data-chip-date]");
  await expect(chips).toHaveCount(4);
  await page.getByRole("combobox", { name: "Find a reading" }).fill("zzz");
  await expect(page.getByRole("status").filter({ hasText: "No reading called zzz." })).toBeVisible();
  await expect(page.getByRole("link", { name: "Every parashah, holiday and passage" })).toHaveAttribute("href", "/readings");
});

test("a calendar that fails says so with Try again, and the field still answers a name", async ({ page }) => {
  await mock(page, "fail");
  await page.goto("/");
  await expect(page.getByText("Couldn’t load the calendar.")).toBeVisible();
  await page.getByRole("combobox", { name: "Find a reading" }).fill("Noach");
  await expect(page.getByRole("option").first()).toContainText("Noach");
  await expect(page.getByRole("button", { name: "Try again to load the calendar" })).toBeVisible();
});
