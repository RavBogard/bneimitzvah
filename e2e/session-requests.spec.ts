import { expect, test, type Page } from "@playwright/test";
import { binding, mock } from "./student-fixture";

const ID = "11111111-1111-4111-8111-111111111111"; // the fixture student

// The signed-in shell reads the session once when it mounts (C2, 2026-11-17): not on a client route change and not around
// each read. A read is one request to its own endpoint; the server decides it. Synthetic student fixture only.
const reading = (page: Page) => page.getByRole("region", { name: "Assigned reading", exact: true });
function count(page: Page) {
  const seen = { session: 0, api: 0 };
  page.on("request", request => {
    const path = new URL(request.url()).pathname;
    if (!path.startsWith("/api/")) return;
    seen.api++; if (path === "/api/session") seen.session++;
  });
  return seen;
}

test("opening the student's reading reads the session once, and moving to My Readings and back reads it no more", async ({ page }) => {
  await mock(page, { got: [0, 1, 2] });
  const seen = count(page);
  await page.goto("/mine/reading");
  await expect(reading(page)).toBeVisible();
  await page.waitForLoadState("networkidle");
  test.info().annotations.push({ type: "requests: open the reading", description: JSON.stringify(seen) });
  expect(seen.session).toBe(1);
  // Client-side navigation through the site bar and back through the shelf's card.
  await page.getByRole("banner").getByRole("link", { name: "My Readings", exact: true }).click();
  await expect(page.locator("[data-pinned-card]")).toBeVisible();
  await page.locator("[data-pinned-card]").getByTestId("pinned-open").click();
  await expect(page).toHaveURL(/\/mine\/reading$/);
  await expect(reading(page)).toBeVisible();
  await page.waitForLoadState("networkidle");
  test.info().annotations.push({ type: "requests: to My Readings and back", description: JSON.stringify(seen) });
  expect(seen.session).toBe(1);
  // Never a "Checking your access" page between signed-in pages.
  await expect(page.getByTestId("workspace-state")).toHaveCount(0);
});

test("a tutor opening a student's page reads the session once", async ({ page }) => {
  await mock(page);
  await page.route("**/api/session", route => route.fulfill({ contentType: "application/json", body: JSON.stringify({ membershipAvailable: true, roles: ["tutor"], saved: true, approver: false, sessionBinding: binding }) }));
  const seen = count(page);
  await page.goto(`/workspace/tutor/${ID}`);
  // The fixture answers the reading as the student's own, which the tutor page does not take; the page and its reads still run.
  await expect(page).toHaveTitle("Noa Synthetic | CRC Torah");
  await page.waitForLoadState("networkidle");
  test.info().annotations.push({ type: "requests: tutor's student page", description: JSON.stringify(seen) });
  expect(seen.session).toBe(1);
});

test("the student's reading restored from the back-forward cache after the session ended hides at once and asks to sign in", async ({ page }) => {
  await mock(page);
  await page.goto("/mine/reading");
  await expect(reading(page)).toBeVisible();
  await page.route("**/api/session", route => route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: "authentication-required" }) }));
  await page.evaluate(() => { window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })); });
  await expect(page.locator('[data-testid="workspace-state"][data-workspace-state="signed-out"]')).toBeVisible();
  await expect(reading(page)).toHaveCount(0);
  await expect(page.getByText("Noa Synthetic")).toHaveCount(0);
});
