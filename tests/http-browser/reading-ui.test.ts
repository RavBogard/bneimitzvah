import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { expect as ui } from "@playwright/test";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { browserFixture } from "./fixture";
import { BROWSER_ORIGIN, assertBrowserStartupAllowed, startBrowserServer } from "./server";
import { installLoopbackFetchGuard } from "./egress";
import * as s from "../../src/server/db/index";
vi.mock("server-only", () => ({}));

let fixture: Awaited<ReturnType<typeof browserFixture>>, browser: Browser, stop: (() => Promise<void>) | undefined, restore: (() => void) | undefined;
const contexts: BrowserContext[] = [];
async function safe<T>(action: () => Promise<T>): Promise<T> { try { return await action(); } catch { throw new Error("Reading UI browser operation failed; private details withheld"); } }
async function navigate(tab: Page, path: string) { await safe(() => tab.goto(path, { waitUntil: "domcontentloaded", timeout: 30_000 })); }
async function page(role: "admin" | "tutor", mobile = false) {
  const context = await browser.newContext({ baseURL: BROWSER_ORIGIN, serviceWorkers: "block", acceptDownloads: false, viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 } }); contexts.push(context);
  await context.route("**/*", async route => { try { if (new URL(route.request().url()).origin === BROWSER_ORIGIN) await route.continue(); else await route.abort(); } catch { await route.abort(); } });
  const tab = await context.newPage(); await navigate(tab, "/");
  const email = role === "admin" ? "pg-admin@example.test" : "pg-tutor@example.test";
  expect((await api(tab, "/api/auth/sign-in/magic-link", { email })).status === 200).toBe(true); await navigate(tab, fixture.takeMail(email));
  return tab;
}
async function api(tab: Page, path: string, body?: unknown) {
  return safe(() => tab.evaluate(async ({ path, body }) => {
    const response = await fetch(path, { method: body === undefined ? "GET" : "POST", body: body === undefined ? undefined : JSON.stringify(body), headers: body === undefined ? {} : { "content-type": "application/json" }, cache: "no-store" });
    return { status: response.status, data: await response.json() };
  }, { path, body }));
}
const main = (tab: Page) => tab.locator("#workspace-main");
async function click(tab: Page, name: string) { await safe(() => tab.getByRole("button", { name, exact: true }).click()); }
async function capture(tab: Page, name: string) {
  if (process.env.CI) return;
  await ui(main(tab).getByRole("heading", { name: "Checking your access", level: 1, exact: true })).toBeHidden();
  await ui(tab.getByRole("heading", { name: "Set the assigned reading", level: 2, exact: true })).toBeVisible();
  if (name.includes("prepared")) await ui(tab.getByRole("button", { name: "Confirm assigned reading", exact: true })).toBeEnabled();
  if (name.includes("confirmed")) await ui(main(tab).getByText("Reading confirmed and reloaded from the server. The assignment above is current.", { exact: true })).toBeVisible();
  if (name.includes("conflict")) await ui(main(tab).getByRole("alert")).toContainText("changed after this review");
  expect(await tab.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const directory = join(process.cwd(), ".impeccable", "review"); await mkdir(directory, { recursive: true });
  await safe(() => tab.screenshot({ path: join(directory, `${name}.png`), fullPage: true }));
}
async function custom(tab: Page, value: string) { await safe(() => tab.getByLabel("Selection method", { exact: true }).selectOption("custom")); await safe(() => tab.getByLabel("Custom verse ranges", { exact: true }).fill(value)); }
beforeAll(async () => {
  try { assertBrowserStartupAllowed(); restore = installLoopbackFetchGuard(); fixture = await browserFixture({ emptyReadingDate: "2027-01-09" }); stop = await startBrowserServer(fixture.withRuntime); browser = await chromium.launch({ headless: true }); }
  catch { await browser?.close().catch(() => undefined); await stop?.().catch(() => undefined); await fixture?.close().catch(() => undefined); restore?.(); throw new Error("Reading UI setup failed; private details withheld"); }
}, 120_000);
afterAll(async () => { await Promise.all(contexts.map(context => context.close().catch(() => undefined))); await browser?.close().catch(() => undefined); await stop?.().catch(() => undefined); await fixture?.close().catch(() => undefined); restore?.(); }, 120_000);

it("lets an admin review actual calendar choices, confirm once and replace only after authoritative reload", async () => {
  const tab = await page("admin"); await navigate(tab, "/workspace/admin/students");
  await safe(() => tab.getByRole("link", { name: "Review reading for Synthetic Learner", exact: true }).click());
  await click(tab, "Prepare reading review");
  await ui(tab.getByRole("heading", { name: "Choose a reading explicitly", level: 3, exact: true })).toBeVisible();
  expect(await tab.getByRole("button", { name: /Triennial/ }).count()).toBe(0);
  await click(tab, "Aliyah 1: Genesis 1:31-2:2");
  await ui(tab.getByRole("heading", { name: "No reading has been assigned yet", level: 3, exact: true })).toBeVisible();
  await capture(tab, "reading-admin-prepared-desktop");
  let confirmations = 0;
  await tab.route("**/reading/confirm", async route => { confirmations++; const response = await route.fetch(); await route.fulfill({ response }); });
  await safe(() => tab.getByRole("button", { name: "Confirm assigned reading", exact: true }).evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); }));
  await ui(main(tab).getByText("Reading confirmed and reloaded from the server. The assignment above is current.", { exact: true })).toBeVisible();
  expect(confirmations).toBe(1);
  await ui(tab.locator(".confirmed-reading").getByText("Genesis 1:31-2:2", { exact: true })).toBeVisible();
  await capture(tab, "reading-admin-confirmed-desktop");
  await tab.unroute("**/reading/confirm");
});

it("retains a tutor draft during visible access revalidation, invalidates edited/stale reviews and never retries an uncertain confirmation", async () => {
  const tab = await page("tutor", true); await navigate(tab, "/workspace/tutor");
  await safe(() => tab.getByLabel("Student", { exact: true }).selectOption(fixture.student.id)); await custom(tab, "Genesis 1:1-3");
  let release!: () => void, held = false; const gate = new Promise<void>(resolve => { release = resolve; });
  await tab.route("**/api/session", async route => { const response = await route.fetch(); held = true; await gate; await route.fulfill({ response }); });
  try {
    await safe(() => tab.evaluate(() => window.dispatchEvent(new Event("focus")))); await ui.poll(() => held).toBe(true);
    await ui(main(tab).getByRole("heading", { name: "Checking your access", level: 1, exact: true })).toBeVisible();
    await ui(tab.getByLabel("Custom verse ranges", { exact: true })).toBeHidden();
  } finally { release(); }
  await ui(tab.getByLabel("Custom verse ranges", { exact: true })).toBeVisible(); await ui(tab.getByLabel("Custom verse ranges", { exact: true })).toHaveValue("Genesis 1:1-3");
  await tab.unroute("**/api/session");
  const [beforePrepare] = await fixture.ownerDb.select().from(s.student).where(eq(s.student.id, fixture.student.id));
  const admin = await page("admin");
  expect((await api(admin, `/api/admin/students/${beforePrepare.id}/edit`, { expectedRevision: beforePrepare.revision, student: {
    firstName: "Synthetic", lastName: "Learner", ceremonyDate: "2027-01-09", parentEmail: "fixture@example.test"
  } })).status === 200).toBe(true);
  await click(tab, "Prepare reading review"); await ui(main(tab).getByRole("alert")).toContainText("changed while this proposal");
  expect(await tab.getByRole("button", { name: "Confirm assigned reading", exact: true }).count()).toBe(0);
  await click(tab, "Reload current reading");
  await ui(tab.locator(".reading-review")).toContainText("Needs review with your tutor or rabbi");
  await ui(tab.getByLabel("Student", { exact: true }).locator("option:checked")).toHaveText("Synthetic Learner — 2027-01-09");
  await click(tab, "Prepare reading review"); await ui(tab.getByRole("button", { name: "Confirm assigned reading", exact: true })).toBeEnabled();
  await safe(() => tab.getByLabel("Custom verse ranges", { exact: true }).fill("Genesis 1:4-5")); expect(await tab.getByRole("button", { name: "Confirm assigned reading", exact: true }).count()).toBe(0);
  await click(tab, "Prepare reading review"); await ui(tab.getByRole("button", { name: "Confirm assigned reading", exact: true })).toBeEnabled();
  const [student] = await fixture.ownerDb.select().from(s.student).where(eq(s.student.id, fixture.student.id));
  await fixture.ownerDb.update(s.student).set({ revision: student.revision + 1 }).where(eq(s.student.id, student.id));
  await click(tab, "Confirm assigned reading"); await ui(main(tab).getByRole("alert")).toContainText("changed after this review");
  await ui(tab.getByLabel("Custom verse ranges", { exact: true })).toHaveValue("Genesis 1:4-5"); await capture(tab, "reading-tutor-conflict-mobile");
  await click(tab, "Reload current reading"); await click(tab, "Prepare reading review"); await capture(tab, "reading-tutor-prepared-mobile");
  await click(tab, "Confirm assigned reading");
  await ui(main(tab).getByText("Reading confirmed and reloaded from the server. The assignment above is current.", { exact: true })).toBeVisible();
  await ui(tab.getByLabel("Student", { exact: true }).locator("option:checked")).toHaveText("Synthetic Learner — 2027-01-09");
  await capture(tab, "reading-tutor-confirmed-mobile");
  await custom(tab, "Genesis 1:6-7"); await click(tab, "Prepare reading review"); await ui(tab.getByRole("button", { name: "Confirm assigned reading", exact: true })).toBeEnabled();
  let mutations = 0;
  await tab.route("**/reading/confirm", async route => { mutations++; const response = await route.fetch(); await response.dispose(); await route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"unavailable"}' }); });
  await click(tab, "Confirm assigned reading"); await ui(main(tab).getByRole("alert")).toContainText("may have saved");
  await safe(() => tab.evaluate(() => window.dispatchEvent(new Event("focus"))));
  await ui(tab.getByLabel("Custom verse ranges", { exact: true })).toBeVisible(); expect(mutations).toBe(1);
  await ui(tab.getByRole("button", { name: "Prepare reading review", exact: true })).toBeDisabled();
  await click(tab, "Reload current reading"); await ui(tab.locator(".confirmed-reading").getByText("Genesis 1:6-7", { exact: true })).toBeVisible(); expect(mutations).toBe(1);
});

it("handles an empty calendar without invention and exposes no editor in parent or child-practice mode", async () => {
  const tab = await page("admin");
  const created = await api(tab, "/api/admin/students", { student: { firstName: "Synthetic", lastName: "Empty Calendar", ceremonyDate: "2027-01-09", parentEmail: "empty-calendar@example.test" } });
  expect(created.status === 201 || created.status === 200).toBe(true);
  await navigate(tab, `/workspace/admin/students/${created.data.id}/reading`); await click(tab, "Prepare reading review");
  await ui(tab.getByText("No calendar selections are available for this date.", { exact: true })).toBeVisible();
  expect(await tab.getByRole("button", { name: "Confirm assigned reading", exact: true }).count()).toBe(0);
  await safe(() => tab.getByLabel("Reading", { exact: true }).selectOption("haftarah")); await click(tab, "Prepare reading review");
  await ui(tab.getByText("No haftarah was returned for this date. Use custom references if appropriate.", { exact: true })).toBeVisible();
  await custom(tab, "Isaiah 1:1-2"); await click(tab, "Prepare reading review"); await click(tab, "Confirm assigned reading");
  await ui(tab.locator(".confirmed-reading").getByText("Isaiah 1:1-2", { exact: true })).toBeVisible();
  const parent = await page("tutor"); await navigate(parent, "/workspace/parent"); await safe(() => parent.getByLabel("Child", { exact: true }).selectOption(fixture.student.id));
  await ui(parent.getByRole("heading", { name: "Synthetic Learner", level: 2, exact: true })).toBeVisible(); expect(await parent.getByRole("heading", { name: "Set the assigned reading", exact: true }).count()).toBe(0);
  expect((await api(parent, `/api/students/${fixture.student.id}/reading/prepare`, { mode: "parent", ranges: ["Genesis 1:1"] })).status === 400).toBe(true);
  await click(parent, "Enter child practice"); await ui(parent.getByRole("heading", { name: "Child practice", level: 1, exact: true })).toBeVisible();
  expect(await parent.getByRole("heading", { name: "Set the assigned reading", exact: true }).count()).toBe(0);
});
