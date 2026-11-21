import { expect, test } from "@playwright/test";

test("an empty offline shelf offers the reading and help when connected", async ({ page, context }) => {
  await page.addInitScript(() => localStorage.setItem("crc.offline.force-installed", "browser"));
  await page.goto("/offline");
  const main = page.getByRole("main");
  const recovery = main.getByTestId("offline-recovery");
  const reading = main.getByRole("link", { name: "Open this week’s reading" });
  const help = main.getByRole("link", { name: "Installation help" });
  await expect(main.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(reading).toHaveAttribute("href", "/read");
  await expect(help).toHaveAttribute("href", "/about#about-install");
  await context.setOffline(true);
  await expect(recovery).toContainText("Reconnect");
  await expect(recovery).toContainText("this week’s reading");
  await expect(reading).toHaveCount(0);
  await expect(help).toHaveCount(0);
  await context.setOffline(false);
  await expect(reading).toBeVisible();
  await expect(help).toBeVisible();
});

test("a host without offline support has no installation or save prompts on the shelf", async ({ page }) => {
  await page.goto("/offline");
  await expect(page.getByTestId("offline-empty")).toBeVisible();
  await expect(page.getByTestId("offline-recovery")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Installation help" })).toHaveCount(0);
});

test("the unsubscribe page has a main heading when the email link is missing", async ({ page }) => {
  await page.goto("/unsubscribe");
  const heading = page.getByRole("main").getByRole("heading", { level: 1 });
  await expect(heading).toHaveText("This link doesn’t work");
  await expect(heading).toBeFocused();
});

for (const [status, title] of [[200, "You’re unsubscribed"], [404, "This link doesn’t work"], [503, "Something went wrong"]] as const) {
  test(`unsubscribe uses a main heading before and after response ${status}`, async ({ page }) => {
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    await page.route("**/api/notifications/unsubscribe", async route => {
      await held;
      await route.fulfill({ status, json: { ok: status === 200, kind: "weekly-digest" } });
    });
    try {
      await page.goto(`/unsubscribe#t=d.11111111-1111-4111-8111-111111111111.${"A".repeat(43)}`);
      const main = page.getByRole("main"), heading = main.getByRole("heading", { level: 1 });
      await expect(page).toHaveURL(/\/unsubscribe$/);
      await expect(heading).toHaveText("Stop these emails?");
      await main.getByRole("button", { name: "Unsubscribe", exact: true }).click();
      await expect(main.getByRole("button", { name: "Unsubscribing…" })).toBeDisabled();
      await expect(heading).toHaveText("Stop these emails?");
      release();
      await expect(heading).toHaveText(title);
      await expect(heading).toBeFocused();
    } finally { release(); }
  });
}
