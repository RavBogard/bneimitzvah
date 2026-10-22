import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { expect as ui } from "@playwright/test";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { browserFixture } from "./fixture";
import { BROWSER_ORIGIN, assertBrowserStartupAllowed, startBrowserServer } from "./server";
import { installLoopbackFetchGuard } from "./egress";
import { openAuthMail } from "./auth-navigation";
import { syntheticUiStudyPage } from "../helpers/study-ui";
import * as s from "../../src/server/db/index";
vi.mock("server-only", () => ({}));

let fixture: Awaited<ReturnType<typeof browserFixture>>, browser: Browser, stop: (() => Promise<void>) | undefined, restore: (() => void) | undefined;
let sibling: { id: string };
const contexts: BrowserContext[] = [], captureDirectory = join(process.cwd(), ".local-logs", "tutor-route-review");
async function safe<T>(action: () => Promise<T>): Promise<T> { try { return await action(); } catch { throw new Error("Tutor route browser operation failed; private details withheld"); } }
async function navigate(tab: Page, path: string) { await safe(() => tab.goto(path, { waitUntil: "domcontentloaded", timeout: 30_000 })); }
async function api(tab: Page, path: string, body?: unknown) {
  return safe(() => tab.evaluate(async ({ path, body }) => {
    const response = await fetch(path, { method: body === undefined ? "GET" : "POST", body: body === undefined ? undefined : JSON.stringify(body), headers: body === undefined ? {} : { "content-type": "application/json" }, cache: "no-store" });
    return { status: response.status, data: await response.json() };
  }, { path, body }));
}
async function page(who: "tutor" | "admin" | "student" | "anonymous" = "tutor") {
  const context = await browser.newContext({ baseURL: BROWSER_ORIGIN, serviceWorkers: "block", acceptDownloads: false, viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" }); contexts.push(context);
  await context.route("**/*", async route => { try { if (new URL(route.request().url()).origin === BROWSER_ORIGIN) await route.continue(); else await route.abort(); } catch { await route.abort(); } });
  const tab = await context.newPage(); await navigate(tab, "/"); if (who === "anonymous") return tab;
  const email = who === "tutor" ? "pg-tutor@example.test" : who === "student" ? "pg-route-student@example.test" : "pg-admin@example.test";
  expect((await api(tab, "/api/auth/sign-in/magic-link", { email })).status).toBe(200); await openAuthMail(tab, fixture.takeMail(email)); return tab;
}
const cards = (tab: Page) => tab.getByRole("list", { name: "Student", exact: true });
const card = (tab: Page, id: string) => cards(tab).locator(`[data-student-id="${id}"]`);
async function loaded(tab: Page, ref: string) { await ui(tab.locator(".study-verses").getByRole("heading", { name: ref, exact: true })).toBeVisible(); }
async function capture(tab: Page, name: string) {
  await safe(() => tab.evaluate(async () => { await document.fonts.ready; scrollTo(0, 0); }));
  expect(await tab.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await mkdir(captureDirectory, { recursive: true });
  await safe(() => tab.addStyleTag({ content: "nextjs-portal { display: none !important; }" }));
  await safe(() => tab.screenshot({ path: join(captureDirectory, `${name}.png`) }));
}
async function assignment(studentId: string, ref: string) {
  const [member] = await fixture.ownerDb.select().from(s.membership).where(eq(s.membership.userId, fixture.admin.id));
  const [row] = await fixture.ownerDb.insert(s.assignment).values({ tenantId: "crc", studentId, kind: "torah", basis: "custom", ref, status: "confirmed", setByMembershipId: member.id,
    proposalSnapshot: { ranges: [ref], confirmationDate: "2027-01-02", needsReview: true } }).returning();
  await fixture.ownerDb.insert(s.assignmentVerse).values({ tenantId: "crc", studentId, assignmentId: row.id, ordinal: 1, verseRef: ref });
}
beforeAll(async () => {
  try {
    assertBrowserStartupAllowed(); restore = installLoopbackFetchGuard(); fixture = await browserFixture({ studyLoad: async request => syntheticUiStudyPage(request) });
    sibling = (await fixture.practice()).sibling;
    const student = await fixture.signIn("pg-route-student");
    const [member] = await fixture.ownerDb.insert(s.membership).values({ tenantId: "crc", userId: student.id }).returning();
    const [grant] = await fixture.ownerDb.insert(s.roleGrant).values({ tenantId: "crc", membershipId: member.id, role: "student" }).returning();
    await fixture.ownerDb.insert(s.studentIdentity).values({ tenantId: "crc", studentId: fixture.student.id, roleGrantId: grant.id });
    await fixture.ownerDb.insert(s.tutorStudent).values({ tenantId: "crc", studentId: sibling.id, tutorGrantId: fixture.tutorGrant.id });
    await assignment(fixture.student.id, "Genesis 1:1"); await assignment(sibling.id, "Genesis 2:1");
    stop = await startBrowserServer(fixture.withRuntime); browser = await chromium.launch({ headless: true });
  } catch { await browser?.close().catch(() => undefined); await stop?.().catch(() => undefined); await fixture?.close().catch(() => undefined); restore?.(); throw new Error("Tutor route setup failed; private details withheld"); }
}, 120_000);
afterAll(async () => { await Promise.all(contexts.map(context => context.close().catch(() => undefined))); await browser?.close().catch(() => undefined); await stop?.().catch(() => undefined); await fixture?.close().catch(() => undefined); restore?.(); }, 120_000);

it("opens authorized card and copied direct routes, captures tutor home and phone reading, and guards canceled and confirmed card departure", async () => {
  const tab = await page(); await navigate(tab, "/workspace/tutor"); await ui(card(tab, fixture.student.id)).toBeVisible(); await capture(tab, "desktop-home");
  await safe(() => tab.setViewportSize({ width: 390, height: 844 })); await capture(tab, "phone-home");
  await safe(() => tab.getByRole("navigation", { name: "Workspace roles", exact: true }).getByRole("link", { name: "Parent", exact: true }).click());
  await ui(tab.getByRole("list", { name: "Child", exact: true })).toBeVisible(); await capture(tab, "phone-parent-home");
  await safe(() => tab.getByRole("navigation", { name: "Workspace roles", exact: true }).getByRole("link", { name: "Tutor", exact: true }).click());
  await safe(() => card(tab, fixture.student.id).focus()); await safe(() => tab.keyboard.press("Enter")); await loaded(tab, "Genesis 1:1");
  await ui(tab).toHaveURL(`${BROWSER_ORIGIN}/workspace/tutor/${fixture.student.id}`);
  await ui(tab.getByRole("navigation", { name: "Workspace roles", exact: true }).getByRole("link", { name: "Tutor", exact: true })).toHaveAttribute("aria-current", "page");
  await capture(tab, "phone-reading");
  await safe(() => tab.setViewportSize({ width: 1440, height: 1000 })); await capture(tab, "desktop-reading");
  const copied = await tab.context().newPage(); await navigate(copied, `/workspace/tutor/${fixture.student.id}`); await loaded(copied, "Genesis 1:1");
  const panel = tab.locator(".verse-work").first(); await safe(() => panel.locator("summary").click());
  await safe(() => panel.getByRole("button", { name: "Teacher notes", exact: true }).click());
  const field = panel.getByRole("textbox"), draft = "Synthetic unsent tutor card departure note"; await ui(field).toBeVisible(); await safe(() => field.fill(draft));
  let writes = 0; tab.on("request", request => { if (request.method() === "POST" && new URL(request.url()).pathname.endsWith("/work/note")) writes++; });
  await safe(() => card(tab, sibling.id).click()); await ui(tab.getByRole("dialog", { name: "Review work before leaving", exact: true })).toBeVisible();
  await safe(() => tab.getByRole("button", { name: "Keep working", exact: true }).click()); await ui(field).toHaveValue(draft);
  await ui(tab).toHaveURL(`${BROWSER_ORIGIN}/workspace/tutor/${fixture.student.id}`);
  await safe(() => card(tab, sibling.id).click()); await safe(() => tab.getByRole("button", { name: "Discard unsent edits and continue", exact: true }).click()); await loaded(tab, "Genesis 2:1");
  await ui(tab).toHaveURL(`${BROWSER_ORIGIN}/workspace/tutor/${sibling.id}`); expect(writes).toBe(0);
  expect(await tab.evaluate(value => !document.body.textContent?.includes(value) && !JSON.stringify({ local: { ...localStorage }, tab: { ...sessionStorage } }).includes(value), draft)).toBe(true);
  await ui(tab.locator(".study-verses").getByRole("heading", { name: "Genesis 1:1", exact: true })).toHaveCount(0);
});

it("does not substitute another reading for foreign or unknown routes and rejects delayed old-student reads across a role switch and revocation", async () => {
  const tab = await page(); await navigate(tab, `/workspace/tutor/${fixture.student.id}`); await loaded(tab, "Genesis 1:1");
  let held = false, release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  const pattern = `**/api/students/${fixture.student.id}/reading?mode=tutor`;
  await tab.route(pattern, async route => { const response = await route.fetch(); held = true; await gate; await route.fulfill({ response }).catch(() => undefined); });
  await safe(() => tab.getByRole("button", { name: "Refresh reading", exact: true }).click()); await ui.poll(() => held).toBe(true);
  try { await safe(() => card(tab, sibling.id).click()); await loaded(tab, "Genesis 2:1"); } finally { release(); }
  await tab.unroute(pattern); await ui(tab.locator(".study-verses").getByRole("heading", { name: "Genesis 1:1", exact: true })).toHaveCount(0);
  for (const id of [fixture.otherStudent.id, "ffffffff-ffff-4fff-8fff-fffffffffff1", "not-a-student"]) {
    let reads = 0; const listener = (request: import("playwright").Request) => { const path = new URL(request.url()).pathname; if (path.startsWith(`/api/students/${id}/`) && /\/(reading|study-text|work)$/.test(path)) reads++; }; tab.on("request", listener);
    await navigate(tab, `/workspace/tutor/${id}`); await ui(tab.getByRole("heading", { name: "Student not found", exact: true })).toBeVisible(); expect(await tab.locator(".study-verses, .verse-work").count()).toBe(0);
    expect(reads).toBe(0); tab.off("request", listener);
    if (id === "not-a-student") continue;
    expect((await api(tab, `/api/students/${id}/reading?mode=tutor`)).status).toBe(404);
  }
  // The verse marks and the study guide are read after the text is shown. Either one answering after
  // the revocation denies in place and unregisters the reading's focus check, so the check under test
  // would have nothing to verify. Revoke only once both have answered under the current link.
  const followOn = ["progress", "study-guide"].map(name => tab.waitForResponse(response => response.request().method() === "GET" && new URL(response.url()).pathname === `/api/students/${fixture.student.id}/${name}`, { timeout: 30_000 }));
  await navigate(tab, `/workspace/tutor/${fixture.student.id}`); await loaded(tab, "Genesis 1:1"); await safe(() => Promise.all(followOn));
  await fixture.ownerDb.update(s.tutorStudent).set({ revokedAt: new Date() }).where(eq(s.tutorStudent.id, fixture.link.id));
  await safe(() => tab.evaluate(() => window.dispatchEvent(new Event("focus"))));
  await ui(tab.getByRole("heading", { name: "Student not found", exact: true })).toBeVisible(); expect(await tab.locator(".study-verses, .verse-work").count()).toBe(0);
  await safe(() => tab.getByRole("navigation", { name: "Workspace roles", exact: true }).getByRole("link", { name: "Parent", exact: true }).click());
  await safe(() => tab.getByRole("list", { name: "Child", exact: true }).locator(`[data-student-id="${fixture.student.id}"]`).click()); await loaded(tab, "Genesis 1:1");
  expect(await tab.getByRole("link", { name: "Change verses", exact: true }).count()).toBe(0);
  await navigate(tab, `/workspace/tutor/${fixture.student.id}`); await ui(tab.getByRole("heading", { name: "Student not found", exact: true })).toBeVisible(); expect(await tab.locator(".study-verses, .verse-work").count()).toBe(0);
  expect((await api(tab, `/api/students/${fixture.student.id}/reading?mode=tutor`)).status).toBe(404);
  await ui(card(tab, sibling.id)).toBeVisible();
});

it("opens a later-page authorized card and direct URL and waits for exhausted pagination before showing an absent target", async () => {
  const target = "ffffffff-ffff-4fff-8fff-fffffffffff0";
  const rows = Array.from({ length: 100 }, (_, index) => ({ id: `10000000-0000-4000-8000-${(index + 1).toString().padStart(12, "0")}`, tenantId: "crc", firstName: "Synthetic", lastName: `Page ${index + 1}`, ceremonyDate: "2027-01-02", parentEmail: "synthetic@example.test" }));
  await fixture.ownerDb.insert(s.student).values([...rows, { ...rows[0], id: target, lastName: "Routed" }]);
  await fixture.ownerDb.insert(s.tutorStudent).values([...rows.map(row => row.id), target].map(studentId => ({ tenantId: "crc", studentId, tutorGrantId: fixture.tutorGrant.id })));
  await assignment(target, "Genesis 3:1");
  const tab = await page(); await navigate(tab, "/workspace/tutor"); await ui(cards(tab).locator(".student-card")).toHaveCount(100);
  await safe(() => tab.getByRole("button", { name: "Load more students", exact: true }).click()); await ui(card(tab, target)).toBeVisible();
  await safe(() => card(tab, target).click()); await loaded(tab, "Genesis 3:1"); await ui(tab).toHaveURL(`${BROWSER_ORIGIN}/workspace/tutor/${target}`);
  const direct = await tab.context().newPage(); await navigate(direct, `/workspace/tutor/${target}`); await loaded(direct, "Genesis 3:1");
  let release!: () => void, held = false; const gate = new Promise<void>(resolve => { release = resolve; });
  await direct.route("**/api/students?mode=tutor&limit=100&afterId=*", async route => { const response = await route.fetch(); held = true; await gate; await route.fulfill({ response }).catch(() => undefined); });
  const pending = navigate(direct, "/workspace/tutor/ffffffff-ffff-4fff-8fff-fffffffffff1"); await ui.poll(() => held).toBe(true);
  try { await ui(direct.getByText("Loading available students…", { exact: true })).toBeVisible(); expect(await direct.getByRole("heading", { name: "Student not found", exact: true }).count()).toBe(0); expect(await direct.locator(".study-verses").count()).toBe(0); }
  finally { release(); }
  await pending; await ui(direct.getByRole("heading", { name: "Student not found", exact: true })).toBeVisible(); expect(await direct.locator(".study-verses").count()).toBe(0);
});

it("does not turn a different account role into tutor authority through the new URL", async () => {
  for (const who of ["admin", "student", "anonymous"] as const) {
    const tab = await page(who); let reads = 0;
    tab.on("request", request => { if (/\/api\/students\/[^/]+\/(reading|study-text|work)$/.test(new URL(request.url()).pathname)) reads++; });
    await navigate(tab, `/workspace/tutor/${sibling.id}`);
    await ui(tab.getByRole("heading", { name: who === "anonymous" ? "Sign in to continue" : "Role unavailable", exact: true })).toBeVisible(); expect(await tab.locator(".study-verses, .student-cards, .verse-work").count()).toBe(0); expect(reads).toBe(0);
  }
});
