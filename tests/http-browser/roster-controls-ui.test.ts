import { openAuthMail } from "./auth-navigation";
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
import { isolatedEnv } from "../helpers/isolatedEnv.mjs";
vi.mock("server-only", () => ({}));

let fixture: Awaited<ReturnType<typeof browserFixture>>, browser: Browser, stop: (() => Promise<void>) | undefined, restore: (() => void) | undefined, sibling: { id: string };
const contexts: BrowserContext[] = [];
const signedCookies: Partial<Record<"admin" | "tutor", Awaited<ReturnType<BrowserContext["cookies"]>>>> = {};
let cleanupBrowser: (() => Promise<void>) | undefined;
// Only the error class (e.g. TimeoutError) is kept: it names no locator, value or person.
async function safe<T>(action: () => Promise<T>): Promise<T> { try { return await action(); } catch (error) { const kind = error instanceof Error && /^[A-Za-z]{1,40}$/.test(error.name) ? error.name : "Error"; throw new Error(`Roster controls browser operation failed (${kind}); private details withheld`); } }
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
    await openAuthMail(tab, fixture.takeMail(email)); signedCookies[who] = await context.cookies();
  }
  return tab;
}
async function click(tab: Page, name: string) { await safe(() => tab.getByRole("button", { name, exact: true }).click()); }
// The roster lists 25 students a page in server (id) order, and earlier cases here add more than 25, so a named
// student is found through the roster search, as an admin would, before its row action is used.
async function editDetails(tab: Page, name: string) { await safe(() => tab.getByRole("searchbox", { name: "Find a student", exact: true }).fill(name)); await click(tab, `Edit details for ${name}`); }
// Row actions are named for the person they change ("Remove Synthetic Tutor from Synthetic"); this finds one by its verb within a card.
const cards = { Tutors: "people-tutors", Parents: "people-parents", "Student sign-in": "people-students", "Congregation-wide removal": "people-congregation" } as const;
function action(tab: Page, card: keyof typeof cards, verb: string) { return tab.getByTestId(cards[card]).getByRole("button", { name: new RegExp(`^${verb} `) }); }
async function accessLoaded(tab: Page) { await ui(tab.getByTestId("access-loading")).toBeHidden(); await ui(tab.getByRole("button", { name: "Reload access", exact: true })).toBeEnabled(); }
async function importLoaded(tab: Page) { await ui(tab.getByTestId("csv-roster-loading")).toBeHidden(); await ui(tab.getByRole("button", { name: "Reload roster for import", exact: true })).toBeEnabled(); }
async function confirm(tab: Page) { await click(tab, "Confirm access change"); await ui(tab.getByTestId("access-message")).toHaveAttribute("data-message-kind", "saved"); await accessLoaded(tab); }
async function create(tab: Page, suffix: string, firstName = "Synthetic") { const result = await api(tab, "/api/admin/students", { student: { firstName, lastName: suffix, ceremonyDate: "2027-01-02", parentEmail: "synthetic-access@example.test" } }); expect(result.status === 201).toBe(true); return result.data.id as string; }
async function capture(tab: Page, name: string) {
  if (process.env.CI) return;
  await ui(tab.locator('[data-workspace-state="checking"]')).toBeHidden();
  await safe(() => tab.evaluate(async () => {
    await document.fonts.ready;
    scrollTo(0, 0);
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  }));
  expect(await tab.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const dir = join(process.cwd(), ".impeccable", "review"); await mkdir(dir, { recursive: true }); await safe(() => tab.screenshot({ path: join(dir, `${name}.png`), fullPage: true }));
}
async function focus(tab: Page) {
  let delivered = 0; const expected = new URL(tab.url()).pathname.startsWith("/workspace/practice/") ? 4 : 2;
  const count = (response: import("playwright").Response) => { if (new URL(response.url()).pathname === "/api/session") delivered++; }; tab.on("response", count);
  try { await safe(() => tab.evaluate(() => window.dispatchEvent(new Event("focus")))); await ui.poll(() => delivered).toBeGreaterThanOrEqual(expected); }
  finally { tab.off("response", count); }
  await ui(tab.locator('[data-workspace-state="checking"]')).toBeHidden();
}
beforeAll(async () => {
  try {
    assertBrowserStartupAllowed(); restore = installLoopbackFetchGuard(); fixture = await browserFixture(); sibling = (await fixture.practice()).sibling;
    const learner = await fixture.signIn("pg-access-student"); const [member] = await fixture.ownerDb.insert(s.membership).values({ tenantId: "crc", userId: learner.id }).returning();
    const [grant] = await fixture.ownerDb.insert(s.roleGrant).values({ tenantId: "crc", membershipId: member.id, role: "student" }).returning(); await fixture.ownerDb.insert(s.studentIdentity).values({ tenantId: "crc", studentId: fixture.student.id, roleGrantId: grant.id });
    stop = await startBrowserServer(fixture.withRuntime);
    const isolation = await isolatedEnv(); cleanupBrowser = isolation.cleanup;
    browser = await chromium.launch({ headless: true, env: isolation.env });
  } catch { await browser?.close().catch(() => undefined); await cleanupBrowser?.(); await stop?.().catch(() => undefined); await fixture?.close().catch(() => undefined); restore?.(); throw new Error("Roster controls browser setup failed; private details withheld"); }
}, 120_000);
afterAll(async () => { await Promise.all(contexts.map(context => context.close().catch(() => undefined))); await browser?.close().catch(() => undefined); await cleanupBrowser?.(); await stop?.().catch(() => undefined); await fixture?.close().catch(() => undefined); restore?.(); }, 120_000);

it("creates adults without parent contact, requires the contact for each kind and preserves explicit access across kind edits", async () => {
  const tab = await page(); await navigate(tab, "/workspace/admin/students?tab=students");
  await ui(tab.getByRole("button", { name: "Add student", exact: true })).toBeEnabled(); await click(tab, "Add student");
  await ui(tab.getByLabel("Service (needed to suggest the reading)", { exact: true })).toHaveValue("unknown");
  await safe(() => tab.getByRole("radio", { name: "Adult", exact: true }).check());
  await safe(() => tab.getByLabel("First name", { exact: true }).fill("Synthetic"));
  await safe(() => tab.getByLabel("Last name", { exact: true }).fill("AdultContact"));
  await safe(() => tab.getByLabel("Ceremony date", { exact: true }).fill("2027-01-02"));
  await ui(tab.getByLabel("Parent email (optional)", { exact: true })).toHaveJSProperty("required", false);
  await ui(tab.getByLabel("Student email", { exact: true })).toHaveJSProperty("required", true);
  await click(tab, "Save student");
  expect(await tab.getByLabel("Student email", { exact: true }).evaluate(element => (element as HTMLInputElement).validity.valueMissing)).toBe(true);
  const contact = { firstName: "Synthetic", lastName: "AdultContact", ceremonyDate: "2027-01-02", studentKind: "adult", parentEmail: null, ownEmail: "synthetic-adult@example.test" };
  expect((await api(tab, "/api/admin/students", { student: { ...contact, ownEmail: null } })).status).toBe(403);
  await safe(() => tab.getByLabel("Student email", { exact: true }).fill(contact.ownEmail)); await capture(tab, "roster-adult-contact-desktop");
  await click(tab, "Save student"); await ui(tab.getByTestId("roster-added").locator('a[href$="/access"]')).toBeVisible();
  let row = (await api(tab, "/api/admin/students")).data.students.find((row: { lastName: string }) => row.lastName === contact.lastName);
  expect(row.serviceSlot === "unknown" && row.studentKind === "adult" && row.parentEmail === null && row.ownEmail === contact.ownEmail).toBe(true);
  const originalRevision = row.revision;
  await click(tab, "Edit details for Synthetic AdultContact"); await safe(() => tab.getByRole("radio", { name: "Child", exact: true }).check());
  await safe(()=>tab.getByLabel("Service (needed to suggest the reading)",{exact:true}).selectOption("havdalah"));
  await ui(tab.getByLabel("Parent email", { exact: true })).toHaveJSProperty("required", true);
  await ui(tab.getByLabel("Student email (optional)", { exact: true })).toHaveValue(contact.ownEmail);
  await click(tab, "Save student");
  expect(await tab.getByLabel("Parent email", { exact: true }).evaluate(element => (element as HTMLInputElement).validity.valueMissing)).toBe(true);
  const child = { ...contact, studentKind: "child", parentEmail: "synthetic-parent@example.test" };
  expect((await api(tab, "/api/admin/students", { student: { ...child, parentEmail: null } })).status).toBe(403);
  await safe(() => tab.getByLabel("Parent email", { exact: true }).fill(child.parentEmail));
  await tab.setViewportSize({ width: 390, height: 844 }); await capture(tab, "roster-child-contact-mobile");
  await click(tab, "Save student"); await ui(tab.getByTestId("roster-message")).toHaveAttribute("data-message-kind", "saved-review");
  row = (await api(tab, "/api/admin/students")).data.students.find((value: { id: string }) => value.id === row.id);
  expect(row.serviceSlot === "havdalah" && row.studentKind === "child" && row.parentEmail === child.parentEmail && row.ownEmail === contact.ownEmail).toBe(true);
  expect((await api(tab, `/api/admin/students/${row.id}/edit`, { expectedRevision: originalRevision, student: contact })).status).toBe(409);
  await click(tab, "Edit details for Synthetic AdultContact"); await safe(() => tab.getByRole("radio", { name: "Adult", exact: true }).check());
  await ui(tab.getByLabel("Parent email (optional)", { exact: true })).toHaveValue(child.parentEmail);
  await click(tab, "Save student"); await ui(tab.getByTestId("roster-message")).toHaveAttribute("data-message-kind", "saved");
  const access = (await api(tab, `/api/admin/students/${row.id}/relationships`)).data;
  expect(access.guardians.length === 0 && access.identities.length === 0 && access.tutors.length === 0).toBe(true);
});

it("reviews tutor assignment/removal with fresh target reads, blocks duplicate submits and keeps disabled-student cleanup", async () => {
  const tab = await page(), id = await create(tab, "RosterAccess"); await navigate(tab, `/workspace/admin/students/${id}/access`); await accessLoaded(tab);
  await safe(() => tab.getByLabel("Tutor to assign", { exact: true }).selectOption(fixture.tutorGrant.id)); await click(tab, "Assign");
  await ui(tab.getByRole("dialog").locator("#access-review-heading")).toBeFocused();
  // The role identifier is kept for checking, folded under Technical details.
  await ui(tab.getByRole("dialog").getByTestId("access-grant-id")).toBeHidden();
  await safe(() => tab.getByRole("dialog").getByTestId("access-technical").locator("summary").click());
  await ui(tab.getByRole("dialog").getByTestId("access-grant-id")).toHaveText(fixture.tutorGrant.id);
  expect((await api(tab, `/api/admin/students/${id}/relationships`)).data.tutors.length === 0).toBe(true); await capture(tab, "roster-assignment-review-desktop");
  let posts = 0, targetReads = 0;
  await tab.route(`**/api/admin/students/${id}/relationships**`, async route => { if (route.request().method() === "POST") posts++; else targetReads++; const response = await route.fetch(); await route.fulfill({ response }); });
  await safe(() => tab.getByRole("button", { name: "Confirm access change", exact: true }).evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); }));
  await ui(tab.getByTestId("access-message")).toHaveAttribute("data-message-kind", "saved"); await ui(tab.getByRole("dialog")).toBeHidden(); await ui(tab.getByRole("heading", { level: 1 })).toBeFocused(); expect(posts === 1 && targetReads >= 1).toBe(true); await accessLoaded(tab);
  const current = await api(tab, `/api/admin/students/${id}/relationships`); expect(current.data.tutors.length === 1).toBe(true);
  await api(tab, `/api/admin/students/${id}/disable`, { expectedRevision: current.data.student.revision }); await click(tab, "Reload access"); await accessLoaded(tab);
  await ui(tab.getByLabel("Tutor to assign", { exact: true })).toBeDisabled(); await safe(() => action(tab, "Tutors", "Remove").click()); await confirm(tab); expect((await api(tab, `/api/admin/students/${id}/relationships`)).data.tutors.length === 0).toBe(true);
  await tab.unroute(`**/api/admin/students/${id}/relationships**`);
});

it("revokes only the selected parent practice context, removes exact parent/student links and preserves sibling access", async () => {
  const admin = await page(), parent = await page("tutor"); await navigate(parent, "/workspace/parent"); await safe(() => parent.getByLabel("Child", { exact: true }).locator(`[data-student-id="${fixture.student.id}"]`).click()); await click(parent, "Practice with Synthetic"); await ui(parent.getByTestId("practice-bar-title")).toBeVisible();
  const other = await parent.context().newPage(); await navigate(other, "/workspace/parent"); await safe(() => other.getByLabel("Child", { exact: true }).locator(`[data-student-id="${sibling.id}"]`).click()); await click(other, "Practice with Synthetic"); await ui(other.getByTestId("practice-bar-title")).toBeVisible();
  await navigate(admin, `/workspace/admin/students/${fixture.student.id}/access`); await accessLoaded(admin); await safe(() => action(admin, "Parents", "Stop child practice").click()); await confirm(admin);
  const denied = parent.waitForResponse(response => new URL(response.url()).pathname === `/api/students/${fixture.student.id}/reading` && response.status() === 404);
  // A real denial short-circuits the normal successful quiet probe sequence.
  // Bind this case to the actual rejection and terminal recovery instead.
  await safe(() => parent.evaluate(() => window.dispatchEvent(new Event("focus")))); expect((await denied).status()).toBe(404); await ui.poll(() => new URL(parent.url()).pathname).toBe("/workspace/parent"); await ui(parent.getByTestId("workspace-notice")).toHaveAttribute("data-notice-kind", "practice-access-changed"); await ui(parent.getByLabel("Child", { exact: true })).toBeVisible();
  expect(await parent.getByTestId("reading-workspace").count()).toBe(0);
  await ui(parent.locator("[data-testid='study-verses'], [data-testid='study-hebrew'], [data-testid='verse-work'], dialog:modal")).toHaveCount(0);
  await focus(other); await ui(other.getByTestId("practice-bar-title")).toBeVisible();
  await safe(() => action(admin, "Parents", "Allow child practice").click()); await confirm(admin); await safe(() => action(admin, "Parents", "Remove").click()); await confirm(admin); await safe(() => action(admin, "Student sign-in", "Remove").click()); await confirm(admin);
  const current = (await api(admin, `/api/admin/students/${fixture.student.id}/relationships`)).data; expect(current.guardians.length === 0 && current.identities.length === 0).toBe(true);
  expect((await api(admin, `/api/admin/students/${sibling.id}/relationships`)).data.guardians.length === 1).toBe(true);
});

it("rejects changed reviewed identities before POST, isolates uncertain access outcomes and renders long phone identity reviews", async () => {
  const tab = await page("admin", true); await navigate(tab, "/workspace/admin/tutors"); await accessLoaded(tab); await safe(() => action(tab, "Tutors", "Mark as cantor").click());
  let posts = 0; await tab.route(`**/api/admin/tutors/${fixture.tutorGrant.id}/cantor`, async route => { posts++; const response = await route.fetch(); await route.fulfill({ response }); });
  const longName = `Synthetic${"N".repeat(130)}`; await fixture.ownerDb.update(s.user).set({ name: longName }).where(eq(s.user.id, fixture.tutor.id));
  await click(tab, "Confirm access change"); await ui(tab.getByTestId("access-message")).toHaveAttribute("data-message-kind", "changed"); expect(posts).toBe(0);
  await ui(tab.getByRole("dialog")).toBeHidden();
  await safe(() => action(tab, "Tutors", "Mark as cantor").click()); await capture(tab, "roster-long-review-mobile"); await confirm(tab); expect(posts).toBe(1);
  await tab.unroute(`**/api/admin/tutors/${fixture.tutorGrant.id}/cantor`);
  await tab.route(`**/api/admin/tutors/${fixture.tutorGrant.id}/cantor`, async route => { posts++; const response = await route.fetch(); await response.dispose(); await route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"unavailable"}' }); });
  await safe(() => action(tab, "Tutors", "Remove cantor flag").click()); await click(tab, "Confirm access change"); await ui(tab.getByTestId("access-message")).toHaveAttribute("data-message-kind", "unconfirmed"); await ui(tab.getByTestId("access-message")).toHaveAttribute("role", "alert"); await capture(tab, "roster-unknown-mobile");
  await focus(tab); expect(posts).toBe(2); await ui(action(tab, "Tutors", "Remove cantor flag")).toBeDisabled(); await click(tab, "Reload access"); await accessLoaded(tab); expect(posts).toBe(2);
  await tab.unroute(`**/api/admin/tutors/${fixture.tutorGrant.id}/cantor`); await fixture.ownerDb.update(s.user).set({ name: "Synthetic Tutor" }).where(eq(s.user.id, fixture.tutor.id));
});

// Deliberate wording test for the CSV import: approved copy, change only with the copy.
it("reviews valid/invalid and duplicate CSV rows, invalidates changed drafts and checks stale roster plus focus lifecycle", async () => {
  const tab = await page(); await navigate(tab, "/workspace/admin/students/import"); await importLoaded(tab);
  const draft = `${CSV_HEADER}\nSynthetic,CsvReviewed,2027-01-02,parent@example.test,`;
  await safe(() => tab.getByLabel("CSV draft to review", { exact: true }).fill(`${CSV_HEADER}\nSynthetic,Invalid,not-a-date,parent@example.test,`)); await click(tab, "Preview import");
  await ui(tab.getByTestId("csv-issues").getByRole("rowheader", { name: "2", exact: true })).toBeVisible(); expect(await tab.getByRole("button", { name: "Import reviewed students", exact: true }).count()).toBe(0);
  // G21: the ready rows import on their own; the row to fix stays in the draft, and a later row with the same name and date is flagged.
  await safe(() => tab.getByLabel("CSV draft to review", { exact: true }).fill(`${CSV_HEADER}\nSynthetic,Invalid,not-a-date,parent@example.test,\nSynthetic,CsvReady,2027-01-09,parent@example.test,`)); await click(tab, "Preview import");
  await safe(() => tab.getByTestId("csv-import-ready").click()); await ui(tab.getByTestId("csv-receipt")).toHaveText("1 student record created. No invitations were sent."); await importLoaded(tab);
  expect((await fixture.ownerDb.select().from(s.student).where(eq(s.student.lastName, "CsvReady")))).toHaveLength(1);
  expect((await tab.getByLabel("CSV draft to review", { exact: true }).inputValue()).split(/\r?\n/).filter(Boolean)).toEqual([CSV_HEADER, "Synthetic,Invalid,not-a-date,parent@example.test,"]);
  await safe(() => tab.getByLabel("CSV draft to review", { exact: true }).fill(`${CSV_HEADER}\nSynthetic,CsvReady,2027-01-09,other@example.test,`)); await click(tab, "Preview import"); await ui(tab.getByTestId("csv-same-name")).toBeVisible();
  await safe(() => tab.getByLabel("CSV draft to review", { exact: true }).fill(draft)); await click(tab, "Preview import"); await ui(tab.getByRole("button", { name: "Import reviewed students", exact: true })).toBeEnabled(); await capture(tab, "csv-review-desktop");
  await focus(tab); await ui(tab.getByLabel("CSV draft to review", { exact: true })).toHaveValue(draft); await ui(tab.getByRole("button", { name: "Import reviewed students", exact: true })).toBeEnabled();
  await click(tab, "Preview import"); await create(tab, "CsvRosterChanged"); await click(tab, "Import reviewed students"); await ui(tab.getByTestId("csv-message")).toHaveAttribute("data-message-kind", "changed");
  expect((await fixture.ownerDb.select().from(s.student).where(eq(s.student.lastName, "CsvReviewed")))).toHaveLength(0);
  await click(tab, "Reload roster for import"); await importLoaded(tab); await click(tab, "Preview import"); await click(tab, "Import reviewed students"); await ui(tab.getByTestId("csv-receipt")).toHaveAttribute("data-created", "1"); await importLoaded(tab);
  await safe(() => tab.getByLabel("CSV draft to review", { exact: true }).fill(draft)); await click(tab, "Preview import"); await ui(tab.getByTestId("csv-duplicates")).toHaveAttribute("data-rows", "2"); expect(await tab.getByRole("button", { name: "Import reviewed students", exact: true }).count()).toBe(0);
  await safe(() => tab.getByLabel("Allow additional records for exact duplicates", { exact: true }).check()); await click(tab, "Preview import"); await ui(tab.getByRole("button", { name: "Import reviewed students", exact: true })).toBeEnabled();
  await safe(() => tab.getByLabel("CSV draft to review", { exact: true }).fill(draft + "\n")); expect(await tab.getByRole("button", { name: "Import reviewed students", exact: true }).count()).toBe(0);
});

it("requires explicit roster inspection after an unknown import, never retries automatically, and expires client reviews", async () => {
  const tab = await page("admin", true); await navigate(tab, "/workspace/admin/students/import"); await importLoaded(tab);
  const draft = `${CSV_HEADER}\n${Array.from({ length: 24 }, (_, index) => `Synthetic,CsvUnknown${index || ""},2027-01-02,parent@example.test,`).join("\n")}`; await safe(() => tab.getByLabel("CSV draft to review", { exact: true }).fill(draft)); await click(tab, "Preview import"); await ui(tab.getByRole("button", { name: "Import reviewed students", exact: true })).toBeEnabled(); await capture(tab, "csv-review-mobile");
  let posts = 0; await tab.route("**/api/admin/students/import/confirm", async route => { posts++; const response = await route.fetch(); await response.dispose(); await route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"unavailable"}' }); });
  await click(tab, "Import reviewed students"); await ui(tab.getByTestId("csv-message")).toHaveAttribute("data-message-kind", "unknown"); await ui(tab.getByTestId("csv-message")).toHaveAttribute("role", "alert"); await capture(tab, "csv-unknown-mobile"); await focus(tab); expect(posts).toBe(1); await ui(tab.getByRole("button", { name: "Preview import", exact: true })).toBeDisabled();
  const retained = tab.getByLabel("CSV draft to review", { exact: true });
  await ui(retained).toHaveValue(draft); await ui(retained).toHaveJSProperty("readOnly", true); await ui(retained).toBeEnabled();
  await safe(() => retained.focus()); await ui(retained).toBeFocused(); await safe(() => retained.press("Control+End")); await ui.poll(() => retained.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  await safe(() => retained.press("Control+Home")); await ui.poll(() => retained.evaluate(element => element.scrollTop)).toBe(0); await ui(retained).toHaveValue(draft);
  await ui(tab.getByLabel("Choose a CSV file", { exact: true })).toBeDisabled();
  await click(tab, "Reload roster for import"); await importLoaded(tab); await ui(tab.getByTestId("csv-recovery")).toBeVisible(); await ui(tab.getByRole("link", { name: "Synthetic CsvUnknown", exact: true })).toBeVisible(); await ui(tab.getByRole("button", { name: "Preview import", exact: true })).toBeDisabled();
  await click(tab, "I checked the roster; allow a new preview"); await ui(tab.getByLabel("Allow additional records for exact duplicates", { exact: true })).not.toBeChecked(); await click(tab, "Preview import"); await ui(tab.getByTestId("csv-duplicates")).toHaveAttribute("data-rows", /^2,/); expect(posts).toBe(1);
  await tab.unroute("**/api/admin/students/import/confirm");
  await safe(() => tab.getByLabel("CSV draft to review", { exact: true }).fill(`${CSV_HEADER}\nSynthetic,CsvExpiry,2027-01-02,parent@example.test,`)); await tab.clock.install(); await click(tab, "Preview import"); await ui(tab.getByRole("button", { name: "Import reviewed students", exact: true })).toBeEnabled(); await tab.clock.fastForward(5 * 60_000 + 1); await ui(tab.getByTestId("csv-message")).toHaveAttribute("data-message-kind", "expired"); expect(await tab.getByRole("button", { name: "Import reviewed students", exact: true }).count()).toBe(0);
});

// Deliberate wording test for the access review: approved consequence copy, change only with the copy.
it("reviews congregation-wide parent/tutor grant consequences and denies tutor access to admin controls", async () => {
  const admin = await page(), tutor = await page("tutor"); await navigate(tutor, "/workspace/admin/tutors"); await ui(tutor.getByTestId("role-unavailable")).toBeVisible();
  await navigate(admin, `/workspace/admin/students/${sibling.id}/access`); await accessLoaded(admin); await ui(action(admin, "Parents", "Remove")).toBeVisible(); expect(await admin.getByRole("region", { name: "Parents", exact: true }).getByRole("button", { name: /^Remove as a parent / }).count()).toBe(0);
  await safe(() => admin.getByTestId("congregation-removal-toggle").click()); await safe(() => action(admin, "Congregation-wide removal", "Remove as a parent").click()); await ui(admin.getByTestId("access-review")).toHaveAttribute("data-access-scope", "congregation"); await ui(admin.getByTestId("access-consequence")).toContainText("every linked child"); await confirm(admin);
  const current = (await api(admin, `/api/admin/students/${sibling.id}/relationships`)).data; expect(current.guardians[0].effectiveRead === false).toBe(true);
  await navigate(admin, "/workspace/admin/tutors"); await accessLoaded(admin); await safe(() => action(admin, "Tutors", "Remove as a tutor").click()); await ui(admin.getByTestId("access-review")).toHaveAttribute("data-access-scope", "congregation"); await ui(admin.getByTestId("access-consequence")).toContainText("every student they teach"); await confirm(admin); await ui(admin.getByTestId("tutors-empty")).toBeVisible();
});

it("sets rehearsal dates in order on or before the ceremony, shows them in the reading header and clears them", async () => {
  const tab = await page(); await navigate(tab, "/workspace/admin/students?tab=students");
  const name = `${fixture.student.firstName} ${fixture.student.lastName}`, first = () => tab.getByLabel("First rehearsal (optional)", { exact: true }), second = () => tab.getByLabel("Second rehearsal (optional)", { exact: true });
  const stored = async () => (await api(tab, "/api/admin/students")).data.students.find((row: { id: string }) => row.id === fixture.student.id) as { rehearsal1: string | null; rehearsal2: string | null; revision: number };
  const before = await stored(); expect(before.rehearsal1 === null && before.rehearsal2 === null).toBe(true);
  await editDetails(tab, name); await ui(first()).toHaveValue(""); await ui(second()).toHaveValue("");
  await ui(first()).toHaveAttribute("max", fixture.student.ceremonyDate); await ui(second()).toHaveAttribute("max", fixture.student.ceremonyDate);
  await safe(() => first().fill("2026-12-26")); await safe(() => second().fill("2026-12-12"));
  await click(tab, "Save student");
  expect(await second().evaluate(element => (element as HTMLInputElement).validity.rangeUnderflow)).toBe(true);
  expect((await stored()).revision).toBe(before.revision);
  await safe(() => first().fill("2026-12-12")); await safe(() => second().fill("2026-12-26")); await capture(tab, "roster-rehearsals-desktop");
  await click(tab, "Save student"); await ui(tab.getByTestId("roster-message")).toHaveAttribute("data-message-kind", "saved");
  expect(await stored()).toMatchObject({ rehearsal1: "2026-12-12", rehearsal2: "2026-12-26", revision: before.revision + 1 });
  await navigate(tab, `/workspace/admin/students/${fixture.student.id}/reading`);
  await ui(tab.getByTestId("hero-rehearsals")).toBeVisible();
  expect(await tab.getByTestId("hero-rehearsals").locator("time").evaluateAll(nodes => nodes.map(node => node.getAttribute("datetime")))).toEqual(["2026-12-12", "2026-12-26"]);
  await navigate(tab, "/workspace/admin/students?tab=students"); await editDetails(tab, name);
  await ui(first()).toHaveValue("2026-12-12"); await safe(() => first().fill("")); await safe(() => second().fill(""));
  await click(tab, "Save student"); await ui(tab.getByTestId("roster-message")).toHaveAttribute("data-message-kind", "saved");
  expect(await stored()).toMatchObject({ rehearsal1: null, rehearsal2: null, revision: before.revision + 2 });
  await navigate(tab, `/workspace/admin/students/${fixture.student.id}/reading`);
  await ui(tab.getByTestId("hero-date")).toBeVisible(); await ui(tab.getByTestId("hero-rehearsals")).toHaveCount(0);
});

// 1.9 N21: "Ceremony done" (decision 13).
// Deliberate wording test for the roster Ceremony done flow: approved copy, change only with the copy.
// The approved confirmation and the approved Disable warning are the wording; everything else is found by role, label or test id.
it("warns before Disable, marks a ceremony done after the approved confirmation, lists the student apart and undoes it", async () => {
  const tab = await page(), id = await create(tab, "CeremonyDone", "Noa"), name = "Noa CeremonyDone";
  await navigate(tab, "/workspace/admin/students?tab=students"); await editDetails(tab, name);
  await click(tab, "Disable student");
  await ui(tab.getByTestId("disable-warning")).toHaveText("This can't be undone here.");
  await click(tab, "Keep student active");
  await click(tab, "Ceremony done");
  await ui(tab.getByTestId("ceremony-done-confirm")).toHaveText("Mark Noa's ceremony done? Noa keeps the account, Learn and Study. Tutors stop seeing Noa. You can undo this.");
  await click(tab, "Ceremony done");
  await ui(tab.getByText("Noa: ceremony done.", { exact: true })).toBeVisible();
  const list = tab.getByTestId("ceremony-done-list");
  await ui(list.getByRole("heading", { level: 2 })).toBeVisible();
  await ui(list.getByText(name, { exact: true })).toBeVisible();
  await ui(tab.getByRole("list", { name: "Students", exact: true }).getByText(name, { exact: true })).toHaveCount(0);
  const row = (await api(tab, "/api/admin/students")).data.students.find((value: { id: string }) => value.id === id);
  expect(typeof row.ceremonyDoneAt === "string" && row.disabledAt === null).toBe(true);
  await safe(() => list.getByTestId("ceremony-done-undo").click());
  await ui(tab.getByText("Noa is back in the active list. Choose a tutor.", { exact: true })).toBeVisible();
  await ui(tab.getByRole("button", { name: `Edit details for ${name}`, exact: true })).toBeVisible();
  await ui(tab.getByTestId("ceremony-done-list")).toHaveCount(0);
  expect((await api(tab, "/api/admin/students")).data.students.find((value: { id: string }) => value.id === id).ceremonyDoneAt).toBeNull();
});
