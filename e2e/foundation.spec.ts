import { expect, test } from "@playwright/test";

test("built portal presents an honest unavailable state with accessible retry at each supported device size", async ({ page }) => {
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  await expect(page).toHaveTitle("CRC Torah");
  // Unconfigured, the reading call fails too: This week says so plainly and its actions still work.
  await expect(page.getByRole("heading", { level: 1, name: "This week’s reading", exact: true })).toBeVisible();
  await expect(page.locator("[data-skeleton]")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Lein", exact: true })).toHaveAttribute("href", "/read");
  await expect(page.getByRole("link", { name: "Study", exact: true })).toHaveAttribute("href", "/read?lens=study");
  await expect(page.getByRole("heading", { level: 2, name: "Beit Mitzvah", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Learn to lein", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Sign-in is unavailable", exact: true })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByLabel("Email address")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Continue with Google" })).toHaveCount(0);
  const retry = page.getByRole("button", { name: "Try again", exact: true });
  await retry.click();
  await expect(page.getByRole("heading", { name: "Sign-in is unavailable", exact: true })).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.keyboard.press("Tab");
  await expect(retry).toBeFocused();
  const unavailable = await page.request.get("/api/session");
  expect(unavailable.status()).toBe(503);
  expect(await unavailable.json()).toEqual({ error: "unavailable" });
});

test("built sign-in and invitation entry preserve private setup failure without test identity or provider diagnostics", async ({ page }) => {
  for (const path of ["/sign-in?error=authentication", "/invitations/accept"]) {
    expect((await page.goto(path))?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: "Sign-in is unavailable", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Try again", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Accept invitation", exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});
