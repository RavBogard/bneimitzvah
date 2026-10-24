import { expect, test, type Page } from "@playwright/test";
import { syntheticCourseRoutes } from "./learn-synthetic";

// 2.0 F1 (F-SITE-REVIEW finding 1). The built, unconfigured production server; every /api/public answer is a synthetic route fulfilment.
// The platform's firewall rule (120 requests a minute per address on /api/public/, counting every request that reaches the edge) is not
// here, so a counter stands in for it: it counts every public request the pages send and answers 429 past its limit.
const RATE = "Too many requests from this connection. Try again in a minute.";
const RECORDING = "The recording did not load. Try again.";
const KEY = "crc-torah:learn-progress/v1";
const introDone = JSON.stringify({ schema: "learn-progress/v1", lessons: { "intro-phrases": { done: "2026-10-20T15:00:00.000Z" } }, cards: {} });
async function seed(page: Page, value: string) { await page.addInitScript(([key, text]) => { if (!sessionStorage.getItem("seeded")) { localStorage.setItem(key, text); sessionStorage.setItem("seeded", "1"); } }, [KEY, value]); }
const limited = (route: { fulfill(options: { status: number; contentType: string; body: string; headers: Record<string, string> }): Promise<void> }) =>
  route.fulfill({ status: 429, contentType: "text/plain", body: "Too Many Requests", headers: { "retry-after": "60" } });

test("a 429 on the course's text says so, and keeps the recording line for recordings that really fail", async ({ page }) => {
  const routes = syntheticCourseRoutes(); await routes.install(page); await seed(page, introDone);
  // Last registered wins: the text answers 429 for every course verse.
  await page.route("**/api/public/text?*", route => limited(route));
  await page.goto("/learn/torah-sof-pasuk");
  await expect(page.getByText(RATE)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(RECORDING)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Next", exact: true })).toHaveCount(0);
});

test("a 429 on the recordings' short page says so too, not that the recording did not load", async ({ page }) => {
  const routes = syntheticCourseRoutes(); await routes.install(page); await seed(page, introDone);
  await page.route("**/api/public/reference/short?*", route => limited(route));
  await page.goto("/learn/torah-sof-pasuk");
  await expect(page.getByText(RATE)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(RECORDING)).toHaveCount(0);
});

test("Try again after a 429 loads the lesson once the limit has passed", async ({ page }) => {
  const routes = syntheticCourseRoutes(); await routes.install(page); await seed(page, introDone);
  let refuse = true;
  await page.route("**/api/public/text?*", route => refuse ? limited(route) : route.fallback());
  await page.goto("/learn/torah-sof-pasuk");
  await expect(page.getByText(RATE)).toBeVisible({ timeout: 20_000 });
  refuse = false;
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.locator("main[data-step=hear]")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(RATE)).toHaveCount(0);
});

test("the reader says the same on a 429: its text and the week", async ({ page }) => {
  const routes = syntheticCourseRoutes(); await routes.install(page);
  await page.route("**/api/public/text?*", route => limited(route));
  await page.goto("/read");
  await expect(page.getByText(RATE)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("The verses didn’t load.")).toHaveCount(0);
  await page.unroute("**/api/public/text?*");
  await page.route("**/api/public/reading?*", route => limited(route));
  await page.goto("/read?date=2026-10-31");
  await expect(page.getByText(RATE)).toBeVisible({ timeout: 20_000 });
});

/**
 * The walk from finding 1, twice in a row: this week in Lein and in Study, Vayera in Study, the print sheet, then the first Learn lesson.
 * A counter that behaves like the firewall rule (a fixed minute, 120 requests, every public request counted whether or not a cache could
 * have answered it) sits in front of the synthetic routes. The walk must not meet a 429, and the count is the page's own budget.
 */
test("the finding-1 walk runs twice in a row without meeting the limit", async ({ page }) => {
  test.setTimeout(180_000);
  const routes = syntheticCourseRoutes(); await routes.install(page); await seed(page, introDone);
  const LIMIT = 120;
  let counted = 0, refused = 0, windowStart = Date.now();
  const perStep: Record<string, number> = {};
  let step = "";
  await page.route("**/api/public/**", route => {
    if (Date.now() - windowStart >= 60_000) { windowStart = Date.now(); counted = 0; }
    counted++; perStep[step] = (perStep[step] ?? 0) + 1;
    if (counted > LIMIT) { refused++; return limited(route); }
    return route.fallback();
  });
  const visit = async (name: string, path: string, ready: () => Promise<void>) => { step = name; await page.goto(path); await ready(); await page.waitForTimeout(500); };
  for (let round = 1; round <= 2; round++) {
    await visit(`${round} read`, "/read", () => expect(page.locator("section[aria-label='Torah text']")).toBeVisible({ timeout: 20_000 }));
    await visit(`${round} study`, "/read?lens=study", () => expect(page.locator("section[aria-label='Torah text']")).toBeVisible({ timeout: 20_000 }));
    await visit(`${round} vayera`, "/read?date=2026-10-31&lens=study", () => expect(page.locator("section[aria-label='Torah text']")).toBeVisible({ timeout: 20_000 }));
    await visit(`${round} print`, "/print?date=2026-10-31", () => expect(page.locator("main")).toBeVisible({ timeout: 20_000 }));
    await visit(`${round} learn`, "/learn/intro-phrases", () => expect(page.locator("main[data-step=hear]")).toBeVisible({ timeout: 20_000 }));
  }
  console.log("public requests by step", JSON.stringify(perStep), "total", Object.values(perStep).reduce((a, b) => a + b, 0));
  expect(refused, JSON.stringify(perStep)).toBe(0);
  await expect(page.getByText(RATE)).toHaveCount(0);
  await expect(page.getByText(RECORDING)).toHaveCount(0);
});
