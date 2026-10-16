import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { expect as ui } from "@playwright/test";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { browserFixture } from "./fixture";
import { BROWSER_ORIGIN, assertBrowserStartupAllowed, startBrowserServer } from "./server";
import { installLoopbackFetchGuard } from "./egress";
import { CSV_HEADER } from "../../src/components/portal/workspace/csv-import/api";
import * as s from "../../src/server/db/index";
vi.mock("server-only", () => ({}));

let fixture: Awaited<ReturnType<typeof browserFixture>>, browser: Browser, stop: (() => Promise<void>) | undefined, restore: (() => void) | undefined, sibling: { id: string };
const contexts: BrowserContext[] = [];
const signedCookies: Partial<Record<"admin" | "tutor", Awaited<ReturnType<BrowserContext["cookies"]>>>> = {};
async function safe<T>(action: () => Promise<T>): Promise<T> { try { return await action(); } catch { throw new Error("Roster controls browser operation failed; private details withheld"); } }
async function navigate(tab: Page, path: string) { await safe(() => tab.goto(path, { waitUntil: "domcontentloaded", timeout: 30_000 })); }
async function api(tab: Page, path: string, body?: unknown) { return safe(() => tab.evaluate(async ({ path, body }) => { const response = await fetch(path, { method: body === undefined ? "GET" : "POST", body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store", headers: body === undefined ? {} : { "content-type": "application/json" } }); return { status: response.status, data: await response.json() }; }, { path, body })); }
async function page(who: "admin" | "tutor" = "admin", mobile = false) {
  const context = await browser.newContext({ baseURL: BROWSER_ORIGIN, serviceWorkers: "block", acceptDownloads: false, viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 } }); contexts.push(context);
  await context.route("**/*", async route => { try { if (new URL(route.request().url()).origin === BROWSER_ORIGIN) await route.continue(); else await route.abort(); } catch { await route.abort(); } });
  const cached = signedCookies[who]; if (cached) await context.addCookies(cached);
  const tab = await context.newPage(); await navigate(tab, "/");
  if (!cached) {
    const email = who === "admin" ? "pg-admin@example.test" : "pg-tutor@example.test";
    const result = await api(tab, "/api/auth/sign-in/magic-link", { email }); expect(result.status).toBe(200);
    await navigate(tab, fixture.takeMail(email)); signedCookies[who] = await context.cookies();
  }
  return tab;
}
async function click(tab: Page, name: string) { await safe(() => tab.getByRole("button", { name, exact: true }).click()); }
async function accessLoaded(tab: Page) { await ui(tab.getByText("Checking current access records…", { exact: true })).toBeHidden(); await ui(tab.getByRole("button", { name: "Reload access", exact: true })).toBeEnabled(); }
async function importLoaded(tab: Page) { await ui(tab.getByText("Checking the current roster…", { exact: true })).toBeHidden(); await ui(tab.getByRole("button", { name: "Reload roster for import", exact: true })).toBeEnabled(); }
async function confirm(tab: Page) { await click(tab, "Confirm access change"); await ui(tab.getByText("Access change saved. The current access records have been refreshed.", { exact: true })).toBeVisible(); await accessLoaded(tab); }
async function create(tab: Page, suffix: string, firstName = "Synthetic") { const result = await api(tab, "/api/admin/students", { student: { firstName, lastName: suffix, ceremonyDate: "2027-01-02", parentEmail: "synthetic-access@example.test" } }); expect(result.status === 201).toBe(true); return result.data.id as string; }
async function capture(tab: Page, name: string) {
  if (process.env.CI) return;
  await ui(tab.locator("#workspace-main").getByRole("heading", { name: "Checking your access", exact: true })).toBeHidden();
  await safe(() => tab.evaluate(async () => {
    await document.fonts.ready;
    scrollTo(0, 0);
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  }));
  expect(await tab.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const dir = join(process.cwd(), ".impeccable", "review"); await mkdir(dir, { recursive: true }); await safe(() => tab.screenshot({ path: join(dir, `${name}.png`), fullPage: true }));
}
async function focus(tab: Page) {
  const next = tab.waitForResponse(response => new URL(response.url()).pathname === "/api/session"); await safe(() => tab.evaluate(() => window.dispatchEvent(new Event("focus")))); await next;
  await ui(tab.locator("#workspace-main").getByRole("heading", { name: "Checking your access", exact: true })).toBeHidden();
}
beforeAll(async () => {
  try {
    assertBrowserStartupAllowed(); restore = installLoopbackFetchGuard(); fixture = await browserFixture(); sibling = (await fixture.practice()).sibling;
    const learner = await fixture.signIn("pg-access-student"); const [member] = await fixture.ownerDb.insert(s.membership).values({ tenantId: "crc", userId: learner.id }).returning();
    const [grant] = await fixture.ownerDb.insert(s.roleGrant).values({ tenantId: "crc", membershipId: member.id, role: "student" }).returning(); await fixture.ownerDb.insert(s.studentIdentity).values({ tenantId: "crc", studentId: fixture.student.id, roleGrantId: grant.id });
    stop = await startBrowserServer(fixture.withRuntime); browser = await chromium.launch({ headless: true });
  } catch { await browser?.close().catch(() => undefined); await stop?.().catch(() => undefined); await fixture?.close().catch(() => undefined); restore?.(); throw new Error("Roster controls browser setup failed; private details withheld"); }
}, 120_000);
afterAll(async () => { await Promise.all(contexts.map(context => context.close().catch(() => undefined))); await browser?.close().catch(() => undefined); await stop?.().catch(() => undefined); await fixture?.close().catch(() => undefined); restore?.(); }, 120_000);

it("reviews tutor assignment/removal with fresh target reads, blocks duplicate submits and keeps disabled-student cleanup", async () => {
  const tab = await page(), id = await create(tab, "RosterAccess"); await navigate(tab, `/workspace/admin/students/${id}/access`); await accessLoaded(tab);
  await safe(() => tab.getByLabel("Tutor to assign", { exact: true }).selectOption(fixture.tutorGrant.id)); await click(tab, "Review tutor assignment");
  expect((await api(tab, `/api/admin/students/${id}/relationships`)).data.tutors.length === 0).toBe(true); await capture(tab, "roster-assignment-review-desktop");
  let posts = 0, targetReads = 0;
  await tab.route(`**/api/admin/students/${id}/relationships**`, async route => { if (route.request().method() === "POST") posts++; else targetReads++; const response = await route.fetch(); await route.fulfill({ response }); });
  await safe(() => tab.getByRole("button", { name: "Confirm access change", exact: true }).evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); }));
  await ui(tab.getByText("Access change saved. The current access records have been refreshed.", { exact: true })).toBeVisible(); expect(posts === 1 && targetReads >= 1).toBe(true); await accessLoaded(tab);
  const current = await api(tab, `/api/admin/students/${id}/relationships`); expect(current.data.tutors.length === 1).toBe(true);
  await api(tab, `/api/admin/students/${id}/disable`, { expectedRevision: current.data.student.revision }); await click(tab, "Reload access"); await accessLoaded(tab);
  await ui(tab.getByLabel("Tutor to assign", { exact: true })).toBeDisabled(); await click(tab, "Review assignment removal"); await confirm(tab); expect((await api(tab, `/api/admin/students/${id}/relationships`)).data.tutors.length === 0).toBe(true);
  await tab.unroute(`**/api/admin/students/${id}/relationships**`);
});

it("revokes only the selected parent practice context, removes exact parent/student links and preserves sibling access", async () => {
  const admin = await page(), parent = await page("tutor"); await navigate(parent, "/workspace/parent"); await safe(() => parent.getByLabel("Child", { exact: true }).selectOption(fixture.student.id)); await click(parent, "Enter child practice"); await ui(parent.getByRole("heading", { name: "Child practice", level: 1, exact: true })).toBeVisible();
  const other = await parent.context().newPage(); await navigate(other, "/workspace/parent"); await safe(() => other.getByLabel("Child", { exact: true }).selectOption(sibling.id)); await click(other, "Enter child practice"); await ui(other.getByRole("heading", { name: "Child practice", level: 1, exact: true })).toBeVisible();
  await navigate(admin, `/workspace/admin/students/${fixture.student.id}/access`); await accessLoaded(admin); await click(admin, "Review stopping practice"); await confirm(admin);
  const denied = parent.waitForResponse(response => new URL(response.url()).pathname === `/api/students/${fixture.student.id}/reading`);
  await focus(parent); expect((await denied).status()).toBe(404); await ui.poll(() => new URL(parent.url()).pathname).toBe("/workspace/parent"); await ui(parent.getByText("Practice access changed. Choose an available child again.", { exact: true })).toBeVisible(); await ui(parent.getByLabel("Child", { exact: true })).toBeVisible();
  expect(await parent.locator(".reading-workspace").count()).toBe(0);
  await focus(other); await ui(other.getByRole("heading", { name: "Child practice", level: 1, exact: true })).toBeVisible();
  await click(admin, "Review allowing practice"); await confirm(admin); await click(admin, "Review parent link removal"); await confirm(admin); await click(admin, "Review student sign-in removal"); await confirm(admin);
  const current = (await api(admin, `/api/admin/students/${fixture.student.id}/relationships`)).data; expect(current.guardians.length === 0 && current.identities.length === 0).toBe(true);
  expect((await api(admin, `/api/admin/students/${sibling.id}/relationships`)).data.guardians.length === 1).toBe(true);
});

it("rejects changed reviewed identities before POST, isolates uncertain access outcomes and renders long phone identity reviews", async () => {
  const tab = await page("admin", true); await navigate(tab, "/workspace/admin/tutors"); await accessLoaded(tab); await click(tab, "Review cantor flag");
  let posts = 0; await tab.route(`**/api/admin/tutors/${fixture.tutorGrant.id}/cantor`, async route => { posts++; const response = await route.fetch(); await route.fulfill({ response }); });
  const longName = `Synthetic${"N".repeat(130)}`; await fixture.ownerDb.update(s.user).set({ name: longName }).where(eq(s.user.id, fixture.tutor.id));
  await click(tab, "Confirm access change"); await ui(tab.getByText("The reviewed identity or access state changed. Review the current record again.", { exact: true })).toBeVisible(); expect(posts).toBe(0);
  await click(tab, "Review cantor flag"); await capture(tab, "roster-long-review-mobile"); await confirm(tab); expect(posts).toBe(1);
  await tab.unroute(`**/api/admin/tutors/${fixture.tutorGrant.id}/cantor`);
  await tab.route(`**/api/admin/tutors/${fixture.tutorGrant.id}/cantor`, async route => { posts++; const response = await route.fetch(); await response.dispose(); await route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"unavailable"}' }); });
  await click(tab, "Review removing cantor flag"); await click(tab, "Confirm access change"); await ui(tab.locator("#workspace-main").getByRole("alert")).toContainText("outcome is unknown"); await capture(tab, "roster-unknown-mobile");
  await focus(tab); expect(posts).toBe(2); await ui(tab.getByRole("button", { name: "Review cantor flag", exact: true })).toBeDisabled(); await click(tab, "Reload access"); await accessLoaded(tab); expect(posts).toBe(2);
  await tab.unroute(`**/api/admin/tutors/${fixture.tutorGrant.id}/cantor`); await fixture.ownerDb.update(s.user).set({ name: "Synthetic Tutor" }).where(eq(s.user.id, fixture.tutor.id));
});

it("reviews valid/invalid and duplicate CSV rows, invalidates changed drafts and checks stale roster plus focus lifecycle", async () => {
  const tab = await page(); await navigate(tab, "/workspace/admin/students/import"); await importLoaded(tab);
  const draft = `${CSV_HEADER}\nSynthetic,CsvReviewed,2027-01-02,parent@example.test,`;
  await safe(() => tab.getByLabel("CSV draft to review", { exact: true }).fill(`${CSV_HEADER}\nSynthetic,Invalid,not-a-date,parent@example.test,`)); await click(tab, "Preview import");
  await ui(tab.getByText("Row 2: invalid name, date or email.", { exact: true })).toBeVisible(); expect(await tab.getByRole("button", { name: "Import reviewed students", exact: true }).count()).toBe(0);
  await safe(() => tab.getByLabel("CSV draft to review", { exact: true }).fill(draft)); await click(tab, "Preview import"); await ui(tab.getByRole("button", { name: "Import reviewed students", exact: true })).toBeEnabled(); await capture(tab, "csv-review-desktop");
  await focus(tab); await ui(tab.getByLabel("CSV draft to review", { exact: true })).toHaveValue(draft); expect(await tab.getByRole("button", { name: "Import reviewed students", exact: true }).count()).toBe(0);
  await click(tab, "Preview import"); await create(tab, "CsvRosterChanged"); await click(tab, "Import reviewed students"); await ui(tab.locator("#workspace-main").getByRole("alert")).toContainText("reviewed roster");
  await click(tab, "Reload roster for import"); await importLoaded(tab); await click(tab, "Preview import"); await click(tab, "Import reviewed students"); await ui(tab.getByText("1 student record created. No invitations were sent.", { exact: true })).toBeVisible(); await importLoaded(tab);
  await safe(() => tab.getByLabel("CSV draft to review", { exact: true }).fill(draft)); await click(tab, "Preview import"); await ui(tab.getByText(/Exact duplicate rows: 2\./)).toBeVisible(); expect(await tab.getByRole("button", { name: "Import reviewed students", exact: true }).count()).toBe(0);
  await safe(() => tab.getByLabel("Allow additional records for exact duplicates", { exact: true }).check()); await click(tab, "Preview import"); await ui(tab.getByRole("button", { name: "Import reviewed students", exact: true })).toBeEnabled();
  await safe(() => tab.getByLabel("CSV draft to review", { exact: true }).fill(draft + "\n")); expect(await tab.getByRole("button", { name: "Import reviewed students", exact: true }).count()).toBe(0);
});

it("requires explicit roster inspection after an unknown import, never retries automatically, and expires client reviews", async () => {
  const tab = await page("admin", true); await navigate(tab, "/workspace/admin/students/import"); await importLoaded(tab);
  const draft = `${CSV_HEADER}\n${Array.from({ length: 24 }, (_, index) => `Synthetic,CsvUnknown${index || ""},2027-01-02,parent@example.test,`).join("\n")}`; await safe(() => tab.getByLabel("CSV draft to review", { exact: true }).fill(draft)); await click(tab, "Preview import"); await ui(tab.getByRole("button", { name: "Import reviewed students", exact: true })).toBeEnabled(); await capture(tab, "csv-review-mobile");
  let posts = 0; await tab.route("**/api/admin/students/import/confirm", async route => { posts++; const response = await route.fetch(); await response.dispose(); await route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"unavailable"}' }); });
  await click(tab, "Import reviewed students"); await ui(tab.locator("#workspace-main").getByRole("alert")).toContainText("import outcome is unknown"); await capture(tab, "csv-unknown-mobile"); await focus(tab); expect(posts).toBe(1); await ui(tab.getByRole("button", { name: "Preview import", exact: true })).toBeDisabled();
  const retained = tab.getByLabel("CSV draft to review", { exact: true });
  await ui(retained).toHaveValue(draft); await ui(retained).toHaveJSProperty("readOnly", true); await ui(retained).toBeEnabled();
  await safe(() => retained.focus()); await ui(retained).toBeFocused(); await safe(() => retained.press("Control+End")); await ui.poll(() => retained.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  await safe(() => retained.press("Control+Home")); await ui.poll(() => retained.evaluate(element => element.scrollTop)).toBe(0); await ui(retained).toHaveValue(draft);
  await ui(tab.getByLabel("Choose a CSV file", { exact: true })).toBeDisabled();
  await click(tab, "Reload roster for import"); await importLoaded(tab); await ui(tab.getByRole("heading", { name: "Inspect the current roster", exact: true })).toBeVisible(); await ui(tab.getByRole("link", { name: "Synthetic CsvUnknown", exact: true })).toBeVisible(); await ui(tab.getByRole("button", { name: "Preview import", exact: true })).toBeDisabled();
  await click(tab, "I checked the roster; allow a new preview"); await ui(tab.getByLabel("Allow additional records for exact duplicates", { exact: true })).not.toBeChecked(); await click(tab, "Preview import"); await ui(tab.getByText(/Exact duplicate rows: 2,/)).toBeVisible(); expect(posts).toBe(1);
  await tab.unroute("**/api/admin/students/import/confirm");
  await safe(() => tab.getByLabel("CSV draft to review", { exact: true }).fill(`${CSV_HEADER}\nSynthetic,CsvExpiry,2027-01-02,parent@example.test,`)); await tab.clock.install(); await click(tab, "Preview import"); await ui(tab.getByRole("button", { name: "Import reviewed students", exact: true })).toBeEnabled(); await tab.clock.fastForward(5 * 60_000 + 1); await ui(tab.getByText("The import review expired. Preview the current draft again before importing.", { exact: true })).toBeVisible(); expect(await tab.getByRole("button", { name: "Import reviewed students", exact: true }).count()).toBe(0);
});

it("reviews congregation-wide parent/tutor grant consequences and denies tutor access to admin controls", async () => {
  const admin = await page(), tutor = await page("tutor"); await navigate(tutor, "/workspace/admin/tutors"); await ui(tutor.getByRole("heading", { name: "Role unavailable", exact: true })).toBeVisible();
  await navigate(admin, `/workspace/admin/students/${sibling.id}/access`); await accessLoaded(admin); await click(admin, "Review parent role revocation"); await ui(admin.locator(".access-review")).toContainText("ALL linked children"); await confirm(admin);
  const current = (await api(admin, `/api/admin/students/${sibling.id}/relationships`)).data; expect(current.guardians[0].effectiveRead === false).toBe(true);
  await navigate(admin, "/workspace/admin/tutors"); await accessLoaded(admin); await click(admin, "Review tutor role revocation"); await ui(admin.locator(".access-review")).toContainText("ALL assigned students"); await confirm(admin); await ui(admin.getByText("No eligible tutors on this page.", { exact: true })).toBeVisible();
});
