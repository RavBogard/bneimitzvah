import { expect, test, type Page } from "@playwright/test";

// The built, unconfigured production server. Session and reading answers are synthetic route
// fulfilments, so the home's own client code is what is under test; no person or text is involved.
const binding = "A".repeat(43);
async function session(page: Page, answer: { status: number; body: unknown }) {
  await page.route("**/api/session", route => route.fulfill({ status: answer.status, contentType: "application/json", body: JSON.stringify(answer.body) }));
}
const signedOut = { status: 401, body: { error: "unauthenticated" } };
const roles = (list: string[]) => ({ status: 200, body: { membershipAvailable: list.length > 0, roles: list, saved: list.some(role => role !== "student"), approver: false, sessionBinding: binding } });
async function week(page: Page) {
  await page.route("**/api/public/reading?*", route => {
    const date = new URL(route.request().url()).searchParams.get("date");
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ date, parashah: "Noach", fetchedAt: 0, listening: { pocketTorah: false },
      torah: { kind: "torah", ranges: ["Genesis 6:9-11:32"], verseCount: 153, pages: [{ offset: 0, first: "Genesis 6:9", last: "Genesis 10:11" }, { offset: 100, first: "Genesis 10:12", last: "Genesis 11:32" }] },
      haftarah: { kind: "haftarah", ranges: ["Isaiah 54:1-55:5"], verseCount: 22, pages: [{ offset: 0, first: "Isaiah 54:1", last: "Isaiah 55:5" }] } }) });
  });
}
const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
// Every test but the Saturday one runs on a Wednesday, so the home's links do not depend on the day the suite runs.
test.beforeEach(async ({ page }) => { await page.clock.setFixedTime(new Date("2026-10-21T15:00:00Z")); });

test("on a Saturday the home leads with next Shabbat: its parashah and date, Lein and Study open it, and this Shabbat is one link away (N5)", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-10-24T15:00:00Z"));
  await session(page, signedOut); await week(page);
  await page.goto("/");
  await expect(page.getByTestId("this-week")).toHaveAttribute("data-week-which", "next");
  await expect(page.getByTestId("this-shabbat-link")).toBeVisible(); // the link back to the day's own reading
  await expect(page.getByRole("heading", { level: 1, name: "Noach", exact: true })).toBeVisible();
  await expect(page.locator("time")).toHaveAttribute("datetime", "2026-10-31");
  await expect(page.getByRole("link", { name: "Lein", exact: true })).toHaveAttribute("href", "/read?date=2026-10-31");
  await expect(page.getByRole("link", { name: "Study", exact: true })).toHaveAttribute("href", "/read?date=2026-10-31&lens=study");
  await expect(page.getByTestId("this-shabbat-link")).toHaveAttribute("href", "/read");
});

// Deliberate wording test for the front door: approved copy, change only with the copy.
test("the home is a front door to This week, Beit Mitzvah and Learn to lein", async ({ page }, testInfo) => {
  await session(page, signedOut); await week(page);
  expect((await page.goto("/"))?.status()).toBe(200);
  await expect(page).toHaveTitle("CRC Torah");
  await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", "Lein, learn to lein, and study the weekly Torah and haftarah at Central Reform Congregation");
  await expect(page.getByTestId("site-brand")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Noach", exact: true })).toBeVisible();
  await expect(page.getByTestId("week-ranges")).toHaveText(/Torah Genesis 6:9–11:32 · Haftarah Isaiah 54:1–55:5$/);
  await expect(page.getByRole("link", { name: "Lein", exact: true })).toHaveAttribute("href", "/read");
  await expect(page.getByRole("link", { name: "Study", exact: true })).toHaveAttribute("href", "/read?lens=study");
  await expect(page.locator('[data-door="beit-mitzvah"]')).toBeVisible();
  // Signed out, the door is Your readings: Sign in and How accounts work; the form itself lives on /sign-in alone.
  const beit = page.locator('[data-door="beit-mitzvah"]');
  await expect(beit.getByRole("heading", { level: 2, name: "Your readings", exact: true })).toBeVisible();
  await expect(beit.getByRole("link", { name: "Sign in", exact: true })).toHaveAttribute("href", "/sign-in");
  await expect(beit.getByRole("link", { name: "How accounts work", exact: true })).toHaveAttribute("href", "/about#accounts");
  await expect(page.getByRole("link", { name: "Ask for an account", exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Email address")).toHaveCount(0);
  await expect(page.locator('[data-door="learn"]')).toBeVisible();
  await expect(page.getByRole("link", { name: "Start", exact: true })).toHaveAttribute("href", "/learn");
  await expect(page.getByTestId("learn-door-line")).toHaveText("Hear the phrases, then lein a verse of this week's reading.");
  await expect(page.getByRole("link", { name: "Trope chart", exact: true })).toHaveAttribute("href", "/trope-chart");
  for (const [name, scope] of [["Lein", page], ["Study", page], ["Start", page], ["Sign in", beit], ["How accounts work", beit]] as const) {
    const box = await scope.getByRole("link", { name, exact: true }).boundingBox();
    expect(box && box.height >= 44 && box.width >= 44, `${name} is at least 44px`).toBe(true);
  }
  expect(await noHorizontalScroll(page)).toBe(true);
  await page.evaluate(async () => { await document.fonts.ready; scrollTo(0, 0); });
  if (testInfo.project.name !== "tablet") await page.screenshot({ path: testInfo.outputPath(`front-door-${testInfo.project.name}.png`), fullPage: true });
});

test("on a 390px phone the Beit Mitzvah door is one scroll away, Sign in is a plain link to /sign-in in the bar and in the door, and nothing scrolls sideways", async ({ page }, testInfo) => {
  await session(page, signedOut); await week(page);
  for (const width of [390, 360]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/");
    await expect(page.locator('[data-door="beit-mitzvah"]')).toBeVisible();
    await expect(page.locator('[data-door="beit-mitzvah"]').getByRole("link", { name: "Sign in", exact: true })).toHaveAttribute("href", "/sign-in");
    await expect(page.getByLabel("Email address")).toHaveCount(0);
    expect(await noHorizontalScroll(page)).toBe(true);
    const doors = await page.locator("[data-door]").evaluateAll(nodes => nodes.map(node => node.getAttribute("data-door")));
    expect(doors).toEqual(["beit-mitzvah", "learn"]);
    // Sign in no longer scrolls to the door: it is the site bar's link to the sign-in page.
    const signIn = page.getByRole("navigation", { name: "Site", exact: true }).getByRole("link", { name: "Sign in", exact: true });
    await expect(signIn).toHaveAttribute("href", "/sign-in");
    expect((await signIn.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(await noHorizontalScroll(page)).toBe(true);
    if (width === 390 && testInfo.project.name === "phone") { await page.evaluate(() => scrollTo(0, 0)); await page.screenshot({ path: testInfo.outputPath("front-door-390.png"), fullPage: true }); }
  }
});

test("a failed reading call still shows This week's reading with working Lein and Study links", async ({ page }) => {
  await session(page, signedOut);
  await page.route("**/api/public/reading?*", route => route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"unavailable"}' }));
  await page.goto("/");
  await expect(page.getByTestId("this-week")).toHaveAttribute("data-week-state", "failed");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.locator("[data-skeleton]")).toHaveCount(0);
  await expect(page.locator('[data-door="beit-mitzvah"]').getByRole("link", { name: "Sign in", exact: true })).toBeVisible();
  // /read later tidies its own address, so check the navigation the link made rather than the final URL.
  const opened = page.waitForRequest(request => request.isNavigationRequest() && new URL(request.url()).pathname === "/read" && new URL(request.url()).search === "?lens=study");
  await page.getByRole("link", { name: "Study", exact: true }).click();
  await opened;
});

test("a single-role student at the root sees the front door, not the workspace, and reaches My Readings in one tap", async ({ page }) => {
  await session(page, roles(["student"])); await week(page);
  await page.goto("/");
  const door = page.locator('[data-door="beit-mitzvah"]');
  await expect(door).toHaveAttribute("data-door-role", "student");
  expect(new URL(page.url()).pathname).toBe("/");
  await expect(door.getByTestId("door-action")).toHaveAttribute("href", "/mine");
  await expect(page.getByRole("link", { name: "Lein", exact: true })).toHaveAttribute("href", "/read");
  await door.getByTestId("door-action").click();
  await expect(page).toHaveURL(/\/mine$/);
});

test("signed in, the site bar shows My Readings and the Beit Mitzvah door is the highest role's door; the form is gone", async ({ page }) => {
  await session(page, roles(["tutor"])); await week(page);
  await page.goto("/");
  const door = page.locator('[data-door="beit-mitzvah"]');
  await expect(door).toHaveAttribute("data-door-role", "tutor");
  await expect(page.getByRole("link", { name: "My Readings", exact: true })).toHaveAttribute("href", "/mine");
  await expect(page.getByRole("link", { name: "Sign in", exact: true })).toHaveCount(0);
  await expect(door.getByTestId("door-action")).toHaveAttribute("href", "/mine");
  await expect(page.getByTestId("account-roles")).toHaveCount(0);
  await page.unroute("**/api/session"); await session(page, roles(["student", "parent", "tutor", "admin"]));
  await page.reload();
  await expect(door).toHaveAttribute("data-door-role", "admin");
  await expect(door.getByTestId("door-action")).toHaveAttribute("href", "/workspace/admin/students");
  await page.unroute("**/api/session"); await session(page, roles(["parent"]));
  await page.reload();
  await expect(door).toHaveAttribute("data-door-role", "parent");
  await expect(door.getByTestId("door-action")).toHaveAttribute("href", "/mine");
  await expect(door.getByRole("heading", { level: 2, name: "Your readings", exact: true })).toBeVisible();
  await expect(door.getByTestId("door-action")).toHaveText("Open My Readings");
});

test("the Beit Mitzvah door holds its height from the access check to the signed-in door, so nothing below it moves", async ({ page }) => {
  await week(page);
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    let answer!: () => void; const held = new Promise<void>(resolve => { answer = resolve; });
    await page.unroute("**/api/session");
    await page.route("**/api/session", async route => { await held; await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(roles(["tutor"]).body) }); });
    await page.goto("/");
    const door = page.locator('[data-door="beit-mitzvah"]');
    await expect(door).toHaveAttribute("data-door-state", "loading");
    // Measured from the Beit Mitzvah door's own top, so the week above it loading in does not count.
    const gap = () => page.evaluate(() => document.querySelector('[data-door="learn"]')!.getBoundingClientRect().top - document.querySelector('[data-door="beit-mitzvah"]')!.getBoundingClientRect().top);
    const before = await gap();
    answer();
    await expect(door).toHaveAttribute("data-door-state", "role");
    expect(Math.abs(await gap() - before), `the Learn door moved at ${width}px`).toBeLessThanOrEqual(8);
  }
});

test("a signed-in account that is refused gets Sign out in the door, under the same site bar as every page", async ({ page }) => {
  await session(page, { status: 403, body: { error: "forbidden" } }); await week(page);
  await page.goto("/");
  await expect(page.locator('[data-testid="entry-task"][data-entry-state="forbidden"]')).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
  const site = page.getByRole("navigation", { name: "Site", exact: true });
  await expect(site.getByRole("link", { name: "Read", exact: true })).toHaveAttribute("href", "/read");
  await expect(site.getByRole("link", { name: "Learn", exact: true })).toHaveAttribute("href", "/learn");
});

test("the invitation page stays a plain invitation page with no doors", async ({ page }) => {
  await page.route("**/api/invitations/pending", route => route.fulfill({ status: 404, contentType: "application/json", body: '{"error":"not_found"}' }));
  await page.goto("/invitations/accept");
  await expect(page.getByTestId("entry-introduction")).toHaveAttribute("data-entry-mode", "invitation");
  await expect(page.locator('[data-testid="entry-task"][data-entry-state="invalid-invitation"]')).toBeVisible();
  await expect(page.locator("[data-door]")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Lein", exact: true })).toHaveCount(0);
});
