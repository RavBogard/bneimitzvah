import { expect, test, type Page } from "@playwright/test";
import { SEAM_KEY } from "../src/lib/offline/policy";

const BINDING = "A".repeat(43);
const ALL_ROLES = ["student", "parent", "tutor", "admin"];
const summary = (roles: string[], sessionBinding = BINDING) => ({
  membershipAvailable: true, roles, saved: true, approver: roles.includes("admin"), sessionBinding,
});

async function previewApi(page: Page, answer: () => { status?: number; body: unknown }) {
  const calls: string[] = [];
  await page.route("**/api/**", route => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    calls.push(`${method} ${path}`);
    if (path !== "/api/session" || method !== "GET") return route.fulfill({ status: 503 });
    const { status = 200, body } = answer();
    return route.fulfill({ status, json: body });
  });
  return calls;
}

const restore = (page: Page) => page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));

test("an overlapping admin walks through all five sample views on the existing session", async ({ page }) => {
  const calls = await previewApi(page, () => ({ body: summary(ALL_ROLES) }));
  await page.addInitScript(key => {
    // Exercise the path as if opened in the installed app. Preview must not attempt a pack owner read.
    localStorage.setItem(key, "1");
  }, SEAM_KEY);
  await page.route("**/api/students?*", route => {
    // A live workspace read is allowed only after exiting preview.
    if (new URL(route.request().frame().url()).pathname === "/preview") return route.fallback();
    return route.fulfill({ json: { students: [] } });
  });
  await page.goto("/preview?mode=constructor");

  const group = page.getByRole("group", { name: "View as" });
  await expect(group.getByRole("button", { name: "Admin", exact: true })).toHaveAttribute("aria-pressed", "true");
  const preview = page.getByTestId("preview-screen");
  await expect(preview.getByRole("heading", { name: "This week" })).toBeVisible();
  await expect(page.locator('link[data-crc-offline]')).toHaveCount(0);

  const tutor = group.getByRole("button", { name: "Tutor", exact: true });
  await tutor.focus();
  await page.keyboard.press("Enter");
  await expect(tutor).toBeFocused();
  await expect(page.getByRole("navigation", { name: "Staff" }).getByRole("button", { name: "My Students" })).toBeVisible();
  await preview.getByRole("button", { name: /Noa Example/ }).click();
  await expect(preview.getByRole("heading", { name: "Noa Example" })).toBeFocused();
  await preview.getByRole("button", { name: "Manage reading" }).click();
  await expect(preview.getByRole("heading", { name: "Manage reading" })).toBeFocused();

  await group.getByRole("button", { name: "Student", exact: true }).click();
  await preview.getByRole("button", { name: /Aliyah 1.+Practice/ }).click();
  await expect(preview.getByRole("heading", { name: "Practice", exact: true })).toBeFocused();
  await expect(preview.locator('[lang="he"][dir="rtl"]')).toHaveCount(2);
  await preview.getByRole("button", { name: "Got it, Genesis 1:1" }).click();
  await expect(preview.getByRole("button", { name: "Got it, Genesis 1:1" })).toHaveAttribute("aria-pressed", "true");
  await preview.getByRole("button", { name: "Tikkun" }).click();
  await expect(preview.locator("[data-tikkun-ref]")).toHaveCount(2);

  await group.getByRole("button", { name: "Parent", exact: true }).click();
  await expect(preview.getByText("Verses Noa has got: 1 of 2")).toBeVisible();
  await preview.getByRole("button", { name: "Open", exact: true }).click();
  await expect(preview.getByRole("heading", { name: "Noa Example" })).toBeFocused();

  await group.getByRole("button", { name: "Signed out", exact: true }).click();
  const site = page.getByRole("navigation", { name: "Site" });
  await expect(site.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/preview");
  await expect(preview.getByRole("button", { name: "Practice a reading" })).toBeVisible();
  await expect(preview.getByRole("button", { name: "Study Torah" })).toBeVisible();
  await expect(preview.getByRole("button", { name: "Learn to lein" })).toBeVisible();
  await site.getByRole("link", { name: "Sign in" }).click();
  await expect(preview.getByRole("heading", { name: "Sign in" })).toBeFocused();
  await expect(page).toHaveURL(/\/preview\?mode=constructor$/);
  await expect(page.getByText("Preview mode", { exact: true })).toBeVisible();
  expect(new Set(calls)).toEqual(new Set(["GET /api/session"]));
  expect(await page.evaluate(() => ({ local: Object.keys(localStorage), session: Object.keys(sessionStorage) })))
    .toEqual({ local: [SEAM_KEY], session: [] });

  await page.getByRole("link", { name: "Return to admin workspace" }).click();
  await expect(page).toHaveURL(/\/workspace\/admin\/students$/);
  await expect(page.getByRole("heading", { name: "This week" })).toBeVisible();
  await expect(page.getByTestId("preview-screen")).toHaveCount(0);
});

test("direct preview entry fails closed for signed-out and non-admin accounts", async ({ page }) => {
  let answer: { status?: number; body: unknown } = { status: 401, body: {} };
  const calls = await previewApi(page, () => answer);
  for (const status of [
    { status: 401, body: {} },
    { body: summary(["tutor", "parent"]) },
    { body: { ...summary([]), membershipAvailable: false, saved: false } },
  ]) {
    answer = status;
    await page.goto("/preview");
    await expect(page.getByRole("heading", { name: "Admin access required" })).toBeVisible();
    await expect(page.getByRole("group", { name: "View as" })).toHaveCount(0);
  }
  expect(calls).toEqual(["GET /api/session", "GET /api/session", "GET /api/session"]);
});

test("a restored preview closes on loss of admin or a different admin session", async ({ page }) => {
  let answer: { status?: number; body: unknown } = { body: summary(["admin"]) };
  const calls = await previewApi(page, () => answer);
  const group = page.getByRole("group", { name: "View as" });
  for (const revoked of [
    { body: summary(["tutor"]) },
    { body: summary(["admin"], "B".repeat(43)) },
    { status: 401, body: {} },
  ]) {
    answer = { body: summary(["admin"]) };
    await page.goto("/preview");
    await expect(group).toBeVisible();
    answer = revoked;
    await restore(page);
    await expect(page.getByRole("heading", { name: "Your admin session changed" })).toBeVisible();
    await expect(group).toHaveCount(0);
  }
  expect(new Set(calls)).toEqual(new Set(["GET /api/session"]));
});

test("an unavailable read hides preview until the same admin session is confirmed", async ({ page }) => {
  let answer: { status?: number; body: unknown } = { body: summary(["admin"]) };
  await previewApi(page, () => answer);
  await page.goto("/preview");
  const group = page.getByRole("group", { name: "View as" });
  await group.getByRole("button", { name: "Student" }).click();
  answer = { status: 503, body: {} };
  await restore(page);
  await expect(group).toBeHidden();
  answer = { body: summary(["admin"]) };
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(group.getByRole("button", { name: "Student" })).toHaveAttribute("aria-pressed", "true");
});

test("the preview controls and public bar fit a narrow screen", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await previewApi(page, () => ({ body: summary(["admin"]) }));
  await page.goto("/preview");
  const group = page.getByRole("group", { name: "View as" });
  for (const role of ["Admin", "Tutor", "Student", "Parent", "Signed out"]) {
    await group.getByRole("button", { name: role, exact: true }).click();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), { message: role }).toBe(true);
  }
});
