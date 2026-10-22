import { expect, test } from "@playwright/test";

// The built, unconfigured production server: the page and its headers are real; the
// reading API has no database here, so the page must fail plainly and stay signed-out.
test("the public reading is open to signed-out visitors, never asks for a session and tells search engines not to index", async ({ page, request }, testInfo) => {
  const api: string[] = [];
  page.on("request", item => { const url = new URL(item.url()); if (url.pathname.startsWith("/api/")) api.push(url.pathname); if (item.headers().cookie) api.push("cookie"); });
  const response = await page.goto("/read");
  expect(response?.status()).toBe(200);
  expect(response?.headers()["x-robots-tag"]).toBe("noindex, nofollow");
  await expect(page).toHaveTitle("This week’s reading | CRC Beit Mitzvah");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  await expect(page.getByRole("link", { name: "Sign in", exact: true }).first()).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Reading unavailable", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Next week", exact: true })).toBeEnabled();
  expect(api.length).toBeGreaterThan(0);
  expect(api.every(path => path === "/api/public/reading")).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (testInfo.project.name === "phone") await page.screenshot({ path: testInfo.outputPath("public-reading-phone-unconfigured.png"), fullPage: true });
  const robots = await request.get("/robots.txt");
  expect(robots.status()).toBe(200);
  expect(await robots.text()).toMatch(/User-Agent: \*\s+Disallow: \//i);
  const home = await page.goto("/");
  expect(home?.headers()["x-robots-tag"]).toBe("noindex, nofollow");
  await expect(page.getByRole("link", { name: "Read this week’s Torah and haftarah", exact: true })).toHaveAttribute("href", "/read");
});
