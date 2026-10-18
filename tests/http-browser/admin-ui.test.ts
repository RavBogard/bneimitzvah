import { openAuthMail } from "./auth-navigation";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { expect as ui } from "@playwright/test";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { browserFixture } from "./fixture";
import { BROWSER_ORIGIN, assertBrowserStartupAllowed, startBrowserServer } from "./server";
import { installLoopbackFetchGuard } from "./egress";
import { isolatedEnv } from "../helpers/isolatedEnv.mjs";
vi.mock("server-only", () => ({}));

let fixture: Awaited<ReturnType<typeof browserFixture>>, browser: Browser, stop: (() => Promise<void>) | undefined, restore: (() => void) | undefined;
const contexts: BrowserContext[] = [];
let signedCookies: Awaited<ReturnType<BrowserContext["cookies"]>> | undefined;
let cleanupBrowser: (() => Promise<void>) | undefined;
async function safe<T>(action: () => Promise<T>): Promise<T> { try { return await action(); } catch { throw new Error("Admin browser operation failed; private details withheld"); } }
async function navigate(tab: Page, path: string) { await safe(() => tab.goto(path, { waitUntil: "domcontentloaded", timeout: 30_000 })); }
async function api(tab: Page, path: string, body?: unknown) { return safe(() => tab.evaluate(async ({ path, body }) => { const response = await fetch(path, { method: body === undefined ? "GET" : "POST", body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store", headers: body === undefined ? {} : { "content-type": "application/json" } }); return { status: response.status, data: await response.json() }; }, { path, body })); }
async function page(mobile = false) {
  const context = await browser.newContext({ baseURL: BROWSER_ORIGIN, serviceWorkers: "block", acceptDownloads: false, viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 } }); contexts.push(context);
  await context.route("**/*", async route => { try { if (new URL(route.request().url()).origin === BROWSER_ORIGIN) await route.continue(); else await route.abort(); } catch { await route.abort(); } });
  if (signedCookies) await context.addCookies(signedCookies);
  const tab = await context.newPage(); await navigate(tab, "/");
  if (!signedCookies) {
    const email = "pg-admin@example.test";
    const result = await api(tab, "/api/auth/sign-in/magic-link", { email }); expect(result.status).toBe(200);
    await openAuthMail(tab, fixture.takeMail(email)); signedCookies = await context.cookies();
  }
  return tab;
}
const checking = (tab: Page) => tab.locator("#workspace-main").getByRole("heading", { name: "Checking your access", exact: true });
async function capture(tab: Page, name: string, full = true) {
  if (process.env.CI) return;
  await ui(checking(tab)).toBeHidden();
  await safe(() => tab.evaluate(async () => { await document.fonts.ready; await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); }));
  expect(await tab.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const dir = join(process.cwd(), ".impeccable", "review"); await mkdir(dir, { recursive: true });
  await safe(() => tab.screenshot({ path: join(dir, `${name}-${(tab.viewportSize()?.width ?? 0) < 640 ? "mobile" : "desktop"}.png`), fullPage: full }));
}
const roster = (tab: Page) => tab.getByRole("list", { name: "Students", exact: true });
const sheet = (tab: Page) => tab.getByRole("dialog");
beforeAll(async () => {
  try {
    assertBrowserStartupAllowed(); restore = installLoopbackFetchGuard(); fixture = await browserFixture(); await fixture.practice();
    stop = await startBrowserServer(fixture.withRuntime);
    const isolation = await isolatedEnv(); cleanupBrowser = isolation.cleanup;
    browser = await chromium.launch({ headless: true, env: isolation.env });
  } catch { await browser?.close().catch(() => undefined); await cleanupBrowser?.(); await stop?.().catch(() => undefined); await fixture?.close().catch(() => undefined); restore?.(); throw new Error("Admin browser setup failed; private details withheld"); }
}, 120_000);
afterAll(async () => { await Promise.all(contexts.map(context => context.close().catch(() => undefined))); await browser?.close().catch(() => undefined); await cleanupBrowser?.(); await stop?.().catch(() => undefined); await fixture?.close().catch(() => undefined); restore?.(); }, 120_000);

it("moves between admin areas, finds a student, and adds one in a sheet that returns focus", async () => {
  const tab = await page(); await navigate(tab, "/workspace/admin/students");
  const nav = tab.getByRole("navigation", { name: "Admin", exact: true });
  await ui(nav.getByRole("link", { name: "Students", exact: true })).toHaveAttribute("aria-current", "page");
  await ui(roster(tab).getByRole("listitem")).toHaveCount(2);
  await ui(tab.getByText("2 students", { exact: true })).toBeVisible();
  // Search narrows the list by name; a miss says so.
  await safe(() => tab.getByRole("searchbox", { name: "Find a student", exact: true }).fill("sib"));
  await ui(roster(tab).getByRole("listitem")).toHaveCount(1);
  await ui(roster(tab).getByRole("link", { name: /^Synthetic Sibling/ })).toBeVisible();
  await ui(tab.getByText("1 of 2 students", { exact: true })).toBeVisible();
  await safe(() => tab.getByRole("searchbox", { name: "Find a student", exact: true }).fill("nobody"));
  await ui(tab.getByText("No student matches “nobody”", { exact: true })).toBeVisible();
  await safe(() => tab.getByRole("searchbox", { name: "Find a student", exact: true }).fill(""));
  await ui(roster(tab).getByRole("listitem")).toHaveCount(2);
  await capture(tab, "admin-roster");
  // Add opens a sheet; Escape on a started form asks first, and discarding closes it without saving with focus back on Add.
  const add = tab.getByRole("button", { name: "Add student", exact: true });
  await safe(() => add.click());
  await ui(sheet(tab)).toBeVisible(); await ui(sheet(tab).getByRole("heading", { name: "Add a student", exact: true })).toBeFocused();
  await safe(() => sheet(tab).getByLabel("First name", { exact: true }).fill("Synthetic"));
  await safe(() => tab.keyboard.press("Escape")); await safe(() => sheet(tab).getByRole("button", { name: "Discard changes", exact: true }).click()); await ui(sheet(tab)).toBeHidden(); await ui(add).toBeFocused();
  await safe(() => add.click());
  await ui(sheet(tab).getByLabel("First name", { exact: true })).toHaveValue("");
  for (const [label, value] of [["First name", "Synthetic"], ["Last name", "Added"], ["Ceremony date", "2027-03-06"], ["Parent email", "synthetic-added@example.test"]]) await safe(() => sheet(tab).getByLabel(label, { exact: true }).fill(value));
  await capture(tab, "admin-roster-sheet", false);
  await safe(() => sheet(tab).getByRole("button", { name: "Save student", exact: true }).click());
  await ui(sheet(tab)).toBeHidden();
  await ui(tab.getByText("Added Synthetic Added. No invitation has been sent. Use People to invite family and choose a tutor.", { exact: true })).toBeVisible();
  await ui(roster(tab).getByRole("listitem")).toHaveCount(3);
  // Edit opens the same sheet with the student's details; the student kind is a two-way choice.
  await safe(() => roster(tab).getByRole("button", { name: "Edit details for Synthetic Added", exact: true }).click());
  await ui(sheet(tab).getByRole("heading", { name: "Synthetic Added", exact: true })).toBeFocused();
  await ui(sheet(tab).getByRole("radio", { name: "Child", exact: true })).toBeChecked();
  await safe(() => sheet(tab).getByRole("button", { name: "Close student details", exact: true }).click());
  await ui(roster(tab).getByRole("button", { name: "Edit details for Synthetic Added", exact: true })).toBeFocused();
  // A changed form asks before closing; an unchanged one (above) closes at once.
  await safe(() => roster(tab).getByRole("button", { name: "Edit details for Synthetic Added", exact: true }).click());
  await safe(() => sheet(tab).getByLabel("Last name", { exact: true }).fill("Changed"));
  await safe(() => sheet(tab).getByRole("button", { name: "Close student details", exact: true }).click());
  await ui(sheet(tab).getByRole("button", { name: "Keep editing", exact: true })).toBeFocused();
  await safe(() => sheet(tab).getByRole("button", { name: "Keep editing", exact: true }).click());
  await ui(sheet(tab).getByLabel("Last name", { exact: true })).toHaveValue("Changed");
  await safe(() => tab.keyboard.press("Escape")); await ui(sheet(tab)).toBeVisible();
  await safe(() => sheet(tab).getByRole("button", { name: "Discard changes", exact: true }).click());
  await ui(sheet(tab)).toBeHidden(); await ui(roster(tab).getByText("Synthetic Added", { exact: true })).toBeVisible();
  // An unclear save outcome stays on the list after the sheet closes, and blocks adding again until a reload.
  let posts = 0;
  await tab.route("**/api/admin/students", async route => { if (route.request().method() !== "POST") return route.continue(); posts++; const response = await route.fetch(); await response.dispose(); await route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"unavailable"}' }); });
  await safe(() => add.click());
  for (const [label, value] of [["First name", "Synthetic"], ["Last name", "Unclear"], ["Ceremony date", "2027-03-13"], ["Parent email", "synthetic-unclear@example.test"]]) await safe(() => sheet(tab).getByLabel(label, { exact: true }).fill(value));
  await safe(() => sheet(tab).getByRole("button", { name: "Save student", exact: true }).click());
  await ui(sheet(tab).getByRole("alert")).toHaveText("We couldn’t confirm whether this saved. Reload the roster to check before trying again.");
  await safe(() => sheet(tab).getByRole("button", { name: "Close student details", exact: true }).click());
  await ui(sheet(tab)).toBeHidden();
  await ui(tab.locator("#workspace-main").getByRole("alert")).toHaveText("We couldn’t confirm whether this saved. Reload the roster to check before trying again.");
  await ui(add).toBeDisabled(); await ui(roster(tab).getByRole("button", { name: "Edit details for Synthetic Added", exact: true })).toBeDisabled();
  await tab.unroute("**/api/admin/students"); expect(posts).toBe(1);
  await safe(() => tab.getByRole("button", { name: "Reload roster", exact: true }).first().click());
  await ui(add).toBeEnabled(); await ui(tab.locator("#workspace-main").getByRole("alert")).toHaveCount(0);
  await ui(roster(tab).getByRole("listitem")).toHaveCount(4); // The save had landed; the reload shows it once.
  // Other admin areas carry the same nav.
  await safe(() => nav.getByRole("link", { name: "Invitations", exact: true }).click());
  await ui(tab.getByRole("heading", { name: "Invitations", level: 1, exact: true })).toBeVisible();
  await ui(nav.getByRole("link", { name: "Invitations", exact: true })).toHaveAttribute("aria-current", "page");
  await safe(() => nav.getByRole("link", { name: "Tutors", exact: true }).click());
  await ui(tab.getByRole("heading", { name: "Tutors", level: 1, exact: true })).toBeVisible();
});

it("opens a student's page with the staff tabs and verse sheet, and links to their people", async () => {
  for (const mobile of [false, true]) {
    const tab = await page(mobile); await navigate(tab, "/workspace/admin/students");
    await safe(() => roster(tab).getByRole("link", { name: /^Synthetic Learner/ }).click());
    await ui(tab.getByRole("heading", { name: "Synthetic Learner", level: 2, exact: true })).toBeVisible();
    await ui(tab.getByRole("navigation", { name: "Admin", exact: true }).getByRole("link", { name: "Students", exact: true })).toHaveAttribute("aria-current", "location");
    const tabs = tab.getByRole("tablist", { name: "Student page", exact: true });
    await ui(tabs.getByRole("tab")).toHaveText(["Reading", "Service parts", "Lessons"]);
    await ui(tab.getByRole("button", { name: /^(Assign|Change) verses$/ })).toBeVisible();
    await capture(tab, "admin-student", false);
    await safe(() => tab.getByRole("button", { name: /^(Assign|Change) verses$/ }).click());
    await ui(tab.getByRole("dialog", { name: /verses|reading/i })).toBeVisible();
    await safe(() => tab.getByRole("button", { name: "Close verse editor", exact: true }).click());
    await safe(() => tabs.getByRole("tab", { name: "Lessons", exact: true }).click());
    await ui(tab.getByRole("button", { name: "Add a lesson", exact: true })).toBeVisible();
    await safe(() => tab.getByRole("link", { name: "People and access", exact: true }).click());
    await ui(tab.getByRole("heading", { name: "People and access", level: 1, exact: true })).toBeVisible();
    await ui(tab.getByRole("link", { name: "Student page", exact: true })).toBeVisible();
    await capture(tab, "admin-people");
    // The People card's raw role identifier is behind the confirm sheet's technical details, not on the page.
    expect(await tab.getByText("Role identifier", { exact: true }).count()).toBe(0);
    if (!mobile) {
      // "Invite a parent" fills the invitation for this student with their record's parent contact; nothing is sent yet.
      await safe(() => tab.getByRole("link", { name: "Invite a parent", exact: true }).click());
      await ui(tab.getByRole("heading", { name: "Invitations", level: 1, exact: true })).toBeVisible();
      await ui(tab.getByRole("radio", { name: "Parent", exact: true })).toBeChecked();
      await ui(tab.getByLabel("Student to link", { exact: true })).toHaveValue(fixture.student.id);
      await ui(tab.getByLabel("Recipient email", { exact: true })).toHaveValue("fixture@example.test");
      await ui(tab.getByRole("button", { name: "Review invitation", exact: true })).toBeEnabled();
    }
  }
});
