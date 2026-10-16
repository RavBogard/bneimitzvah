import { expect, test } from "@playwright/test";

test("technical placeholder loads at each supported device size", async ({ page }) => {
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  await expect(page).toHaveTitle("CRC B'nei Mitzvah");
  await expect(page.getByRole("heading", { level: 1, name: "CRC B'nei Mitzvah" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
