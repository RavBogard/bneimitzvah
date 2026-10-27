import { expect, test, type Page, type Route } from "@playwright/test";

// Area A: /mine, the shelf of My Readings, in the built, unconfigured production server. The session and saved-readings answers are
// synthetic route fulfilments, so the page's own client code is under test. Invented reading names only.
const binding = "A".repeat(43);
const json = (route: Route, status: number, body: unknown) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
const row = (index: number) => ({ id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`, name: `Synthetic reading ${index}`, date: index % 2 ? "2026-10-24" : null,
  kind: index % 3 ? "torah" : "haftarah", ranges: index % 3 ? "Genesis 6:9-11:32" : "Isaiah 54:1-55:5", verseCount: index % 3 ? 153 : 22, revision: 1,
  createdAt: "2026-10-22T00:00:00.000Z", updatedAt: "2026-10-22T00:00:00.000Z" });
const session = (page: Page, roles: string[], saved = true) => page.route("**/api/session", route => json(route, 200, { membershipAvailable: true, roles, saved, approver: false, sessionBinding: binding }));

test("a member's shelf: the title, My Readings current in the bar, no tab bar, five readings and then all of them inline", async ({ page }, testInfo) => {
  for (const width of [360, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.unrouteAll({ behavior: "ignoreErrors" });
    await session(page, ["parent"]);
    await page.route("**/api/saved/readings", route => json(route, 200, { ok: true, readings: Array.from({ length: 7 }, (_, i) => row(i + 1)) }));
    await page.goto("/mine");
    await expect(page.getByRole("heading", { level: 1, name: "My Readings", exact: true })).toBeVisible();
    await expect(page.getByRole("banner").getByRole("link", { name: "My Readings", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(page.locator("[data-shell-tabs]")).toHaveCount(0);
    const own = page.getByRole("region", { name: "Also working on" });
    await expect(own).toBeVisible();
    await expect(own.getByRole("listitem")).toHaveCount(5);
    await expect(own.getByRole("link", { name: /Synthetic reading 1\b/ })).toHaveAttribute("href", `/read?saved=${row(1).id}`);
    for (const height of await own.getByRole("link").evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().height))) expect(height).toBeGreaterThanOrEqual(44);
    await own.getByRole("button", { name: "All my readings", exact: true }).click();
    await expect(own.getByRole("listitem")).toHaveCount(7);
    await expect(own.getByRole("button", { name: "Fewer readings", exact: true })).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByTestId("mine-account")).toHaveAttribute("href", "/account");
    expect(await noHorizontalScroll(page)).toBe(true);
    if (width === 360 && testInfo.project.name === "phone") await page.screenshot({ path: testInfo.outputPath("mine-360.png"), fullPage: true });
  }
});

test("with none saved the shelf says so and offers the first reading; a person whose saving is not open yet sees the same shelf without the line", async ({ page }) => {
  await session(page, ["parent", "tutor"]);
  await page.route("**/api/saved/readings", route => json(route, 200, { ok: true, readings: [] }));
  await page.goto("/mine");
  await expect(page.getByTestId("mine-empty")).toBeVisible();
  await expect(page.getByText("You’re signed in. Nothing is saved yet.", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Find a reading", exact: true })).toHaveAttribute("href", "/readings");
  await expect(page.getByRole("link", { name: "Add", exact: true })).toHaveAttribute("href", "/readings?add=1");
  await page.unroute("**/api/saved/readings");
  await page.route("**/api/saved/readings", route => json(route, 403, { error: "forbidden" }));
  await page.reload();
  await expect(page.getByTestId("mine-empty")).toBeVisible();
  await expect(page.getByText("You’re signed in. Nothing is saved yet.", { exact: true })).toHaveCount(0);
  await expect(page.getByTestId("mine-own")).toHaveCount(0);
});

test("signed out, /mine shows the sign-in step under the same bar and asks for no saved readings", async ({ page }) => {
  const saved: string[] = [];
  page.on("request", request => { if (new URL(request.url()).pathname.startsWith("/api/saved/")) saved.push(new URL(request.url()).pathname); });
  await page.route("**/api/session", route => json(route, 401, { error: "authentication-required" }));
  await page.goto("/mine");
  await expect(page.getByRole("heading", { name: "Sign in to continue", exact: true })).toBeVisible();
  await expect(page.getByRole("banner")).toBeVisible();
  await expect(page.getByTestId("mine-own")).toHaveCount(0);
  expect(saved).toEqual([]);
});
