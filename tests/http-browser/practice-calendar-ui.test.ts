import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { expect as ui } from "@playwright/test";
import { chromium, type Browser, type BrowserContext, type Page, type Request, type Route } from "playwright";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { eq, count } from "drizzle-orm";
import { isolatedEnv } from "../helpers/isolatedEnv.mjs";
import { browserFixture } from "./fixture";
import { BROWSER_ORIGIN, assertBrowserStartupAllowed, startBrowserServer } from "./server";
import { installLoopbackFetchGuard } from "./egress";
import { openAuthMail } from "./auth-navigation";
import { syntheticUiStudyPage } from "../helpers/study-ui";
import * as s from "../../src/server/db/index";
vi.mock("server-only", () => ({}));

// The quiet practice calendar: dates only, in the student's own view and an explicitly selected child practice.
// Reading it never reports practice; an explicit open of an assigned verse reports one visit on the server's day.
let fixture: Awaited<ReturnType<typeof browserFixture>>, browser: Browser, stop: (() => Promise<void>) | undefined, restore: (() => void) | undefined;
let isolation: Awaited<ReturnType<typeof isolatedEnv>> | undefined, assignmentId = "";
const contexts: BrowserContext[] = [];
const safe = async <T>(action: () => Promise<T>): Promise<T> => { try { return await action(); } catch { throw new Error("Practice calendar browser operation failed; private details withheld"); } };
async function api(tab: Page, path: string, body?: unknown) {
  return safe(() => tab.evaluate(async ({ path, body }) => { const r = await fetch(path, { method: body === undefined ? "GET" : "POST", cache: "no-store", headers: body === undefined ? {} : { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: r.status }; }, { path, body }));
}
async function page(role: "student" | "tutor", mobile = false) {
  const context = await browser.newContext({ baseURL: BROWSER_ORIGIN, serviceWorkers: "block", acceptDownloads: false, viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 }, reducedMotion: "reduce" }); contexts.push(context);
  await context.route("**/*", async route => { try { if (new URL(route.request().url()).origin === BROWSER_ORIGIN) await route.continue(); else await route.abort(); } catch { await route.abort(); } });
  const tab = await context.newPage(); await safe(() => tab.goto("/", { waitUntil: "domcontentloaded" }));
  const email = role === "student" ? "pg-calendar-student@example.test" : "pg-tutor@example.test";
  expect((await api(tab, "/api/auth/sign-in/magic-link", { email })).status).toBe(200); await openAuthMail(tab, fixture.takeMail(email));
  return tab;
}
const click = (tab: Page, name: string) => safe(() => tab.getByRole("button", { name, exact: true }).click());
const week = (tab: Page) => tab.getByRole("list", { name: "Practice this week", exact: true });
const checking = (tab: Page) => tab.locator("#workspace-main").getByRole("heading", { name: "Checking your access", exact: true });
const isCalendar = (request: Request) => new URL(request.url()).pathname.endsWith("/practice-calendar");
const isEvent = (request: Request) => new URL(request.url()).pathname.endsWith("/practice-events");
function traffic(tab: Page) {
  const posts: { body: Record<string, unknown>; context: string | null }[] = [], reads: string[] = [];
  tab.on("request", request => {
    if (isEvent(request)) { expect(request.method()).toBe("POST"); posts.push({ body: request.postDataJSON(), context: request.headers()["x-practice-context"] ?? null }); }
    if (isCalendar(request)) reads.push(request.url());
  });
  return { posts, reads };
}
async function serverDay(tab: Page, action: () => Promise<unknown>) {
  const response = tab.waitForResponse(response => isCalendar(response.request()) && response.status() === 200);
  await action(); return (await safe(async () => (await (await response).json()).serverDay)) as string;
}
async function capture(tab: Page, name: string) {
  expect(await tab.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (process.env.CI) return;
  await safe(() => tab.evaluate(async () => { await document.fonts.ready; await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); }));
  const dir = join(process.cwd(), ".impeccable", "review"); await mkdir(dir, { recursive: true });
  await safe(() => tab.screenshot({ path: join(dir, `${name}-${(tab.viewportSize()?.width ?? 0) < 640 ? "mobile" : "desktop"}.png`), fullPage: false }));
}
const todayMarked = (tab: Page, practiced: boolean) => ui(week(tab).locator(".practice-day-today")).toHaveClass(practiced ? /practice-day-done/ : /^(?!.*practice-day-done).*$/);
async function rows() {
  const [days] = await fixture.ownerDb.select({ n: count() }).from(s.practiceDay).where(eq(s.practiceDay.studentId, fixture.student.id));
  const [events] = await fixture.ownerDb.select({ n: count() }).from(s.practiceEvent).where(eq(s.practiceEvent.studentId, fixture.student.id));
  return { days: days.n, events: events.n };
}

beforeAll(async () => {
  try {
    assertBrowserStartupAllowed(); restore = installLoopbackFetchGuard(); fixture = await browserFixture({ studyLoad: async request => syntheticUiStudyPage(request) }); await fixture.practice();
    const learner = await fixture.signIn("pg-calendar-student"), [member] = await fixture.ownerDb.insert(s.membership).values({ tenantId: "crc", userId: learner.id }).returning();
    const [grant] = await fixture.ownerDb.insert(s.roleGrant).values({ tenantId: "crc", membershipId: member.id, role: "student" }).returning(); await fixture.ownerDb.insert(s.studentIdentity).values({ tenantId: "crc", studentId: fixture.student.id, roleGrantId: grant.id });
    const [admin] = await fixture.ownerDb.select().from(s.membership).where(eq(s.membership.userId, fixture.admin.id));
    const [assignment] = await fixture.ownerDb.insert(s.assignment).values({ tenantId: "crc", studentId: fixture.student.id, kind: "torah", basis: "custom", ref: "Genesis 1:1-3", status: "confirmed", setByMembershipId: admin.id, proposalSnapshot: { ranges: ["Genesis 1:1-3"], confirmationDate: "2027-01-02", needsReview: false } }).returning();
    await fixture.ownerDb.insert(s.assignmentVerse).values([1, 2, 3].map(ordinal => ({ tenantId: "crc", studentId: fixture.student.id, assignmentId: assignment.id, ordinal, verseRef: `Genesis 1:${ordinal}` })));
    assignmentId = assignment.id;
    stop = await startBrowserServer(fixture.withRuntime); isolation = await isolatedEnv(); browser = await chromium.launch({ headless: true, env: isolation.env });
  } catch { await browser?.close().catch(() => undefined); await stop?.().catch(() => undefined); await fixture?.close().catch(() => undefined); restore?.(); await isolation?.cleanup(); throw new Error("Practice calendar setup failed; private details withheld"); }
}, 120_000);
afterAll(async () => { await Promise.all(contexts.map(context => context.close().catch(() => undefined))); await browser?.close().catch(() => undefined); await stop?.().catch(() => undefined); await fixture?.close().catch(() => undefined); restore?.(); await isolation?.cleanup(); }, 120_000);

it("shows the student's week, reports explicit inline verse visits on the server's day, and retains dates through unchanged quiet checks", async () => {
  for (const mobile of [false, true]) {
    const tab = await page("student", mobile), seen = traffic(tab);
    const day = await serverDay(tab, () => safe(() => tab.goto("/workspace/student", { waitUntil: "domcontentloaded" })));
    await ui(week(tab).getByRole("listitem")).toHaveCount(7);
    await ui(tab.locator(".study-verses").getByRole("heading", { name: "Genesis 1:1", exact: true })).toBeVisible();
    // Loading the page, its text and its calendar is not practice.
    expect(seen.posts).toHaveLength(0);
    const before = await rows();
    await click(tab, "Start"); await ui(tab.getByRole("region", { name: "Reading playback", exact: true })).toContainText("Genesis 1:1");
    expect(await tab.locator("dialog.lift").count()).toBe(0);
    await ui.poll(() => seen.posts.length).toBe(1);
    expect(seen.posts[0]).toEqual({ context: null, body: { mode: "student", eventId: expect.stringMatching(/^[0-9a-f-]{36}$/), expectedDay: day, action: "visit", target: { type: "verse", kind: "torah", assignmentId, assignmentRevision: 1, verseRef: "Genesis 1:1" } } });
    await todayMarked(tab, true);
    await ui(week(tab).locator(".practice-day-today .sr-only")).toContainText("today: practiced");
    // Opening another verse is a new visit; opening the same one again adds nothing.
    await click(tab, "Hear Genesis 1:2"); await ui.poll(() => seen.posts.length).toBe(2);
    expect(seen.posts[1].body).toMatchObject({ expectedDay: day, target: { verseRef: "Genesis 1:2" } }); expect(seen.posts[1].body.eventId).not.toBe(seen.posts[0].body.eventId);
    await click(tab, "Hear Genesis 1:2");
    expect(seen.posts).toHaveLength(2);
    const after = await rows(); expect(after.days).toBe(1); expect(after.events - before.events).toBe(2);
    // Same-authority quiet verification retains the calendar and sends no visit.
    let release!: () => void, held = false; const gate = new Promise<void>(resolve => { release = resolve; });
    const hold = async (route: Route) => { held = true; await gate; await route.fallback().catch(() => undefined); };
    await safe(() => tab.route("**/api/session", hold));
    const readsBefore = seen.reads.length; let metadataSeen = false, finalSessions = 0;
    const observed = (response: import("playwright").Response) => { const path = new URL(response.url()).pathname;
      if (path === `/api/students/${fixture.student.id}/reading` && response.status() === 200) metadataSeen = true;
      if (metadataSeen && path === "/api/session" && response.status() === 200) finalSessions++;
    }; tab.on("response", observed);
    try {
      await safe(() => tab.evaluate(() => window.dispatchEvent(new Event("focus")))); await ui.poll(() => held).toBe(true);
      await ui(checking(tab)).toBeHidden(); await ui(week(tab).getByRole("listitem")).toHaveCount(7); await todayMarked(tab, true); expect(seen.posts).toHaveLength(2);
    } finally { release(); }
    await ui(checking(tab)).toBeHidden(); await ui(week(tab).getByRole("listitem")).toHaveCount(7); await todayMarked(tab, true);
    await ui.poll(() => finalSessions).toBeGreaterThanOrEqual(2); tab.off("response", observed);
    expect(seen.reads.length).toBe(readsBefore); expect(seen.posts).toHaveLength(2);
    await safe(() => tab.unroute("**/api/session", hold));
    // The month view is a plain disclosure: keyboard opens it and steps between months.
    const summary = tab.getByText("Practice calendar", { exact: true });
    await safe(() => summary.focus()); await safe(() => tab.keyboard.press("Enter"));
    const grid = tab.locator("table.practice-grid"); await ui(grid).toBeVisible();
    await ui(grid.locator("td.practice-cell-today")).toHaveClass(/practice-cell-done/);
    await ui(tab.getByRole("button", { name: "Next month", exact: true })).toBeDisabled();
    await safe(() => tab.getByRole("button", { name: "Previous month", exact: true }).focus()); await safe(() => tab.keyboard.press("Enter"));
    await ui(grid.locator("td.practice-cell-today")).toHaveCount(0);
    await ui(tab.getByRole("button", { name: "Next month", exact: true })).toBeEnabled();
    await safe(() => tab.getByRole("button", { name: "Next month", exact: true }).click());
    await capture(tab, "practice-calendar-student");
    // No raw practice detail is ever requested by this page.
    expect(seen.reads.every(url => new URL(url).pathname.endsWith("/practice-calendar"))).toBe(true);
    await safe(() => tab.context().close());
  }
});

it("re-reads after a stale day without resending, and the next explicit open uses the fresh day", async () => {
  const tab = await page("student"), seen = traffic(tab);
  const day = await serverDay(tab, () => safe(() => tab.goto("/workspace/student", { waitUntil: "domcontentloaded" })));
  await ui(week(tab).getByRole("listitem")).toHaveCount(7);
  let stale = true;
  await safe(() => tab.route("**/practice-events", async route => { if (!stale) return route.fallback(); stale = false; await route.fulfill({ status: 409, contentType: "application/json", body: '{"ok":false,"code":"stale-day"}' }); }));
  const reread = tab.waitForRequest(request => isCalendar(request));
  await click(tab, "Hear Genesis 1:3"); await safe(() => reread);
  await ui(week(tab).getByRole("listitem")).toHaveCount(7); expect(seen.posts).toHaveLength(1);
  await click(tab, "Hear Genesis 1:3"); await ui.poll(() => seen.posts.length).toBe(2);
  expect(seen.posts[1].body).toMatchObject({ expectedDay: day, target: { verseRef: "Genesis 1:3" } }); expect(seen.posts[1].body.eventId).not.toBe(seen.posts[0].body.eventId);
  await safe(() => tab.context().close());
});

it("shows dates only in an explicitly selected child practice, reports with that context, and clears when practice ends", async () => {
  const tab = await page("tutor"), seen = traffic(tab);
  await safe(() => tab.goto("/workspace/parent", { waitUntil: "domcontentloaded" }));
  await safe(() => tab.getByLabel("Child", { exact: true }).locator(`[data-student-id="${fixture.student.id}"]`).click());
  await ui(tab.locator("#reading-heading")).toBeVisible();
  // The read-only parent view has no calendar here, and asks for none.
  await ui(tab.getByRole("button", { name: "Enter child practice", exact: true })).toBeVisible();
  expect(await week(tab).count()).toBe(0); expect(seen.reads).toHaveLength(0);
  const day = await serverDay(tab, () => click(tab, "Enter child practice"));
  await ui(tab.getByRole("heading", { name: "Child practice", level: 1, exact: true })).toBeVisible();
  await ui(week(tab).getByRole("listitem")).toHaveCount(7); await todayMarked(tab, true);
  expect(seen.reads.every(url => new URL(url).searchParams.get("mode") === "child-practice")).toBe(true);
  expect(seen.posts).toHaveLength(0);
  await click(tab, "Start"); await ui.poll(() => seen.posts.length).toBe(1);
  expect(seen.posts[0].context).toEqual(expect.any(String));
  expect(seen.posts[0].body).toMatchObject({ mode: "child-practice", expectedDay: day, action: "visit", target: { type: "verse", assignmentId, verseRef: "Genesis 1:1" } });
  await capture(tab, "practice-calendar-child");
  await click(tab, "Return to parent view");
  await ui(tab.getByRole("heading", { name: "Child practice", level: 1, exact: true })).toBeHidden();
  expect(await tab.locator(".practice-week, .practice-day").count()).toBe(0); expect(seen.posts).toHaveLength(1);
  await safe(() => tab.context().close());
});
