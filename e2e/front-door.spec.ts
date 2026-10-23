import { expect, test, type Page } from "@playwright/test";

// The built, unconfigured production server. Session and reading answers are synthetic route
// fulfilments, so the home's own client code is what is under test; no person or text is involved.
const binding = "A".repeat(43);
async function session(page: Page, answer: { status: number; body: unknown }) {
  await page.route("**/api/session", route => route.fulfill({ status: answer.status, contentType: "application/json", body: JSON.stringify(answer.body) }));
}
const signedOut = { status: 401, body: { error: "unauthenticated" } };
const roles = (list: string[]) => ({ status: 200, body: { membershipAvailable: list.length > 0, roles: list, sessionBinding: binding } });
async function week(page: Page) {
  await page.route("**/api/public/reading?*", route => {
    const date = new URL(route.request().url()).searchParams.get("date");
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ date, parashah: "Noach", fetchedAt: 0, listening: { pocketTorah: false },
      torah: { kind: "torah", ranges: ["Genesis 6:9-11:32"], verseCount: 153, pages: [{ offset: 0, first: "Genesis 6:9", last: "Genesis 10:11" }, { offset: 100, first: "Genesis 10:12", last: "Genesis 11:32" }] },
      haftarah: { kind: "haftarah", ranges: ["Isaiah 54:1-55:5"], verseCount: 22, pages: [{ offset: 0, first: "Isaiah 54:1", last: "Isaiah 55:5" }] } }) });
  });
}
const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

test("the home is a front door to This week, Beit Mitzvah and Learn to lein", async ({ page }, testInfo) => {
  await session(page, signedOut); await week(page);
  expect((await page.goto("/"))?.status()).toBe(200);
  await expect(page).toHaveTitle("CRC Torah");
  await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", "Lein, learn to lein, and study the weekly Torah and haftarah at Central Reform Congregation");
  await expect(page.getByRole("link", { name: "CRC Torah home", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Noach", exact: true })).toBeVisible();
  await expect(page.getByText("Torah Genesis 6:9–11:32 · Haftarah Isaiah 54:1–55:5")).toBeVisible();
  await expect(page.getByRole("link", { name: "Lein", exact: true })).toHaveAttribute("href", "/read");
  await expect(page.getByRole("link", { name: "Study", exact: true })).toHaveAttribute("href", "/read?lens=study");
  await expect(page.getByRole("heading", { level: 2, name: "Beit Mitzvah", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { level: 3, name: "Sign in", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Learn to lein", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Start", exact: true })).toHaveAttribute("href", "/learn");
  await expect(page.getByText("Hear the phrases, then lein a verse of this week's reading.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Trope chart", exact: true })).toHaveAttribute("href", "/trope-chart");
  for (const name of ["Lein", "Study", "Start", "Sign in"]) {
    const box = await page.getByRole("link", { name, exact: true }).boundingBox();
    expect(box && box.height >= 44 && box.width >= 44, `${name} is at least 44px`).toBe(true);
  }
  expect(await noHorizontalScroll(page)).toBe(true);
  await page.evaluate(async () => { await document.fonts.ready; scrollTo(0, 0); });
  if (testInfo.project.name !== "tablet") await page.screenshot({ path: testInfo.outputPath(`front-door-${testInfo.project.name}.png`), fullPage: true });
});

test("on a 390px phone the Beit Mitzvah sign-in is one scroll away, Sign in jumps there, and nothing scrolls sideways", async ({ page }, testInfo) => {
  await session(page, signedOut); await week(page);
  for (const width of [390, 360]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/");
    const heading = page.getByRole("heading", { name: "Sign in", exact: true });
    await expect(heading).toBeVisible();
    await expect(page.getByLabel("Email address")).toBeVisible();
    expect(await noHorizontalScroll(page)).toBe(true);
    const top = await heading.evaluate(node => node.getBoundingClientRect().top + scrollY);
    expect(top, "sign-in starts within the first two screens").toBeLessThan(844 * 2 - 120);
    const doors = await page.locator("[data-door]").evaluateAll(nodes => nodes.map(node => node.getAttribute("data-door")));
    expect(doors).toEqual(["beit-mitzvah", "learn"]);
    await page.getByRole("link", { name: "Sign in", exact: true }).click();
    await expect(heading).toBeFocused();
    await expect(heading).toBeInViewport();
    expect(new URL(page.url()).hash).toBe("");
    if (width === 390 && testInfo.project.name === "phone") { await page.evaluate(() => scrollTo(0, 0)); await page.screenshot({ path: testInfo.outputPath("front-door-390.png"), fullPage: true }); }
  }
});

test("a failed reading call still shows This week's reading with working Lein and Study links", async ({ page }) => {
  await session(page, signedOut);
  await page.route("**/api/public/reading?*", route => route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"unavailable"}' }));
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "This week’s reading", exact: true })).toBeVisible();
  await expect(page.locator("[data-skeleton]")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Sign in", exact: true })).toBeVisible();
  // /read later tidies its own address, so check the navigation the link made rather than the final URL.
  const opened = page.waitForRequest(request => request.isNavigationRequest() && new URL(request.url()).pathname === "/read" && new URL(request.url()).search === "?lens=study");
  await page.getByRole("link", { name: "Study", exact: true }).click();
  await opened;
});

test("a single-role student still goes straight to their reading from the home", async ({ page }) => {
  await session(page, roles(["student"])); await week(page);
  await page.goto("/");
  await expect(page).toHaveURL(/\/workspace\/student$/);
});

test("signed in, the app bar shows the account and the Beit Mitzvah door offers the existing role links", async ({ page }) => {
  await session(page, roles(["tutor"])); await week(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 3, name: "You’re signed in", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Account: Tutor", exact: true })).toHaveAttribute("href", "/account");
  await expect(page.getByRole("link", { name: "Sign in", exact: true })).toHaveCount(0);
  await expect(page.getByText("Continue to your work.", { exact: true })).toBeVisible();
  await expect(page.getByRole("list", { name: "Available roles" }).getByRole("link", { name: "Tutor", exact: true })).toHaveAttribute("href", "/workspace/tutor");
  await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
  await page.unroute("**/api/session"); await session(page, roles(["parent", "tutor"]));
  await page.reload();
  await expect(page.getByRole("link", { name: "Account", exact: true })).toHaveAttribute("href", "/account");
});

test("a signed-in account that is refused gets Sign out in the door and no Sign in or account link in the app bar", async ({ page }) => {
  await session(page, { status: 403, body: { error: "forbidden" } }); await week(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 3, name: "Access is unavailable", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
  await expect(page.locator(".app-bar-account")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Sign in", exact: true })).toHaveCount(0);
});

test("the invitation page stays a plain invitation page with no doors", async ({ page }) => {
  await page.route("**/api/invitations/pending", route => route.fulfill({ status: 404, contentType: "application/json", body: '{"error":"not_found"}' }));
  await page.goto("/invitations/accept");
  await expect(page.getByRole("heading", { level: 1, name: "Join your congregation’s practice", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Invitation unavailable", exact: true })).toBeVisible();
  await expect(page.locator("[data-door]")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Lein", exact: true })).toHaveCount(0);
});
