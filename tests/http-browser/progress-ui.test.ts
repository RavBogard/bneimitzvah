import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { expect as ui } from "@playwright/test";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { isolatedEnv } from "../helpers/isolatedEnv.mjs";
import { browserFixture } from "./fixture";
import { BROWSER_ORIGIN, assertBrowserStartupAllowed, startBrowserServer } from "./server";
import { installLoopbackFetchGuard } from "./egress";
import { openAuthMail } from "./auth-navigation";
import { markOf } from "./verse-tools";
import { syntheticUiStudyPage } from "../helpers/study-ui";
import * as s from "../../src/server/db/index";
vi.mock("server-only", () => ({}));

let fixture: Awaited<ReturnType<typeof browserFixture>>, browser: Browser, stop: (() => Promise<void>) | undefined, restore: (() => void) | undefined;
let isolation: Awaited<ReturnType<typeof isolatedEnv>> | undefined;
const contexts: BrowserContext[] = [], cookies = new Map<string, Awaited<ReturnType<BrowserContext["cookies"]>>>();
const safe = async <T>(action: () => Promise<T>): Promise<T> => { try { return await action(); } catch { throw new Error("Progress UI browser operation failed; private details withheld"); } };
async function api(tab: Page, path: string, body?: unknown) {
  return safe(() => tab.evaluate(async ({ path, body }) => { const response = await fetch(path, { method: body === undefined ? "GET" : "POST", cache: "no-store", headers: body === undefined ? {} : { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: response.status, data: await response.json() }; }, { path, body }));
}
async function page(role: "tutor" | "student", mobile = false) {
  const context = await browser.newContext({ baseURL: BROWSER_ORIGIN, serviceWorkers: "block", acceptDownloads: false, viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 } }); contexts.push(context);
  await context.route("**/*", async route => { try { if (new URL(route.request().url()).origin === BROWSER_ORIGIN) await route.continue(); else await route.abort(); } catch { await route.abort(); } });
  const saved = cookies.get(role); if (saved) await context.addCookies(saved);
  const tab = await context.newPage(); await safe(() => tab.goto("/", { waitUntil: "domcontentloaded" }));
  if (!saved) {
    const email = role === "tutor" ? "pg-tutor@example.test" : "pg-progress-student@example.test";
    expect((await api(tab, "/api/auth/sign-in/magic-link", { email })).status).toBe(200);
    await openAuthMail(tab, fixture.takeMail(email)); cookies.set(role, await context.cookies());
  }
  return tab;
}
async function workspace(tab: Page, role: "tutor" | "student") {
  await safe(() => tab.goto(`/workspace/${role}${role === "student" ? "?tab=reading" : ""}`, { waitUntil: "domcontentloaded" }));
  if (role === "tutor") await safe(() => tab.getByLabel("Student", { exact: true }).locator(`[data-student-id="${fixture.student.id}"]`).click());
  await ui(tab.locator(".study-verses").getByRole("heading", { name: "Genesis 1:1", level: 4, exact: true })).toBeVisible();
}
async function openPractice(tab: Page) { await safe(() => tab.getByRole("button", { name: "View Genesis 1:1 up close", exact: true }).click()); await ui(lift(tab)).toBeVisible(); }
const lift = (tab: Page) => tab.locator("dialog.lift");
async function liftTo(tab: Page, ref: string) {
  for (let step = 0; step < 12 && (await lift(tab).locator(".lift-ref").textContent()) !== ref; step++) await safe(() => lift(tab).locator(".lift-step-next").click());
  await ui(lift(tab).locator(".lift-ref")).toHaveText(ref);
}
async function mark(tab: Page, group: string, name: string) {
  const button = lift(tab).getByRole("group", { name: group }).getByRole("button", { name, exact: true });
  await safe(() => button.click());
  await ui(button).not.toHaveAttribute("aria-disabled", "true");
  return button;
}
async function progress(tab: Page, mode: "student" | "tutor") {
  const reading = await api(tab, `/api/students/${fixture.student.id}/reading?mode=${mode}`); expect(reading.status).toBe(200);
  const row = reading.data.readings.find((value: { kind: string }) => value.kind === "torah"), binding = { mode, kind: "torah", assignmentId: row.id, assignmentRevision: row.revision };
  const result = await api(tab, `/api/students/${fixture.student.id}/progress?${new URLSearchParams({ ...binding, assignmentRevision: String(binding.assignmentRevision), offset: "0" })}`); expect(result.status).toBe(200);
  return { binding, verses: result.data.verses as { verseRef: string; selfCheck: { state: string; version: number }; assessment: { state: string; version: number } }[], counts: result.data.counts };
}
async function capture(tab: Page, name: string) {
  if (process.env.CI) return;
  const folder = join(process.cwd(), ".impeccable", "review"); await mkdir(folder, { recursive: true });
  await safe(() => tab.evaluate(async () => { await document.fonts.ready; await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); }));
  expect(await tab.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await safe(() => tab.screenshot({ path: join(folder, `progress-${name}.png`) }));
}

beforeAll(async () => {
  try {
    assertBrowserStartupAllowed(); restore = installLoopbackFetchGuard();
    fixture = await browserFixture({ studyLoad: async request => syntheticUiStudyPage(request) });
    const learner = await fixture.signIn("pg-progress-student"), [member] = await fixture.ownerDb.insert(s.membership).values({ tenantId: "crc", userId: learner.id }).returning();
    const [grant] = await fixture.ownerDb.insert(s.roleGrant).values({ tenantId: "crc", membershipId: member.id, role: "student" }).returning();
    await fixture.ownerDb.insert(s.studentIdentity).values({ tenantId: "crc", studentId: fixture.student.id, roleGrantId: grant.id });
    const [admin] = await fixture.ownerDb.select().from(s.membership).where(eq(s.membership.userId, fixture.admin.id));
    const [assignment] = await fixture.ownerDb.insert(s.assignment).values({ tenantId: "crc", studentId: fixture.student.id, kind: "torah", basis: "custom", ref: "Genesis 1:1-3", status: "confirmed", setByMembershipId: admin.id,
      proposalSnapshot: { ranges: ["Genesis 1:1-3"], confirmationDate: "2027-01-02", needsReview: false } }).returning();
    await fixture.ownerDb.insert(s.assignmentVerse).values([1, 2, 3].map(verse => ({ tenantId: "crc", studentId: fixture.student.id, assignmentId: assignment.id, ordinal: verse, verseRef: `Genesis 1:${verse}` })));
    stop = await startBrowserServer(fixture.withRuntime); isolation = await isolatedEnv(); browser = await chromium.launch({ headless: true, env: isolation.env });
  } catch { await browser?.close().catch(() => undefined); await isolation?.cleanup(); await stop?.().catch(() => undefined); await fixture?.close().catch(() => undefined); restore?.(); throw new Error("Progress UI setup failed; private details withheld"); }
}, 120_000);
afterAll(async () => { await Promise.all(contexts.map(context => context.close().catch(() => undefined))); await browser?.close().catch(() => undefined); await isolation?.cleanup(); await stop?.().catch(() => undefined); await fixture?.close().catch(() => undefined); restore?.(); }, 120_000);

it("lets a student mark verses in practice and a tutor assess them, keeping the two marks separate and visible to each other", async () => {
  const student = await page("student", true); await workspace(student, "student");
  await ui(student.locator(".verse-mark")).toHaveCount(0);
  await openPractice(student);
  await ui(lift(student).locator(".lift-ref")).toHaveText("Genesis 1:1");
  await ui(await mark(student, "How Genesis 1:1 is going", "Got it")).toHaveAttribute("aria-pressed", "true");
  await liftTo(student, "Genesis 1:2");
  await ui(await mark(student, "How Genesis 1:2 is going", "Still working")).toHaveAttribute("aria-pressed", "true");
  await capture(student, "student-lift-mobile");
  let saved = await progress(student, "student");
  expect(saved.verses.map(row => [row.selfCheck.state, row.selfCheck.version, row.assessment.state])).toEqual([["got-it", 1, "not-started"], ["working", 1, "not-started"], ["unmarked", 0, "not-started"]]);
  await safe(() => student.keyboard.press("Escape")); await ui(lift(student)).toBeHidden();
  await ui(await markOf(student, "Genesis 1:1")).toHaveText("Got it");
  await ui(await markOf(student, "Genesis 1:2")).toHaveText("Still working");
  await ui(await markOf(student, "Genesis 1:3")).toHaveCount(0);
  await ui(student.locator(".hero-marked")).toHaveText(/^\s*·\s*1 got it$/);
  await capture(student, "student-list-mobile");

  const tutor = await page("tutor"); await workspace(tutor, "tutor");
  await ui(await markOf(tutor, "Genesis 1:1")).toHaveText("Student: got it");
  await openPractice(tutor);
  await ui(lift(tutor).getByRole("group", { name: "How Genesis 1:1 is going" })).toHaveCount(0);
  await ui(lift(tutor).locator(".lift-progress-note:not([role])")).toHaveText("Student: got it");
  await ui(await mark(tutor, "Assessment for Genesis 1:1", "Solid")).toHaveAttribute("aria-pressed", "true");
  await ui(lift(tutor).getByRole("button", { name: "Not started", exact: true })).toHaveAttribute("aria-pressed", "false");
  await capture(tutor, "tutor-lift-desktop");
  await safe(() => tutor.keyboard.press("Escape"));
  await ui(await markOf(tutor, "Genesis 1:1")).toHaveText(["Student: got it", "Tutor: solid"]);
  await ui(tutor.locator(".hero-marked")).toHaveText(/^\s*·\s*1 got it · 1 solid$/);
  saved = await progress(tutor, "tutor");
  expect([saved.verses[0].selfCheck, saved.verses[0].assessment]).toEqual([{ state: "got-it", version: 1 }, { state: "solid", version: 1 }]);

  // The student sees the tutor's assessment, and clearing their own mark leaves it alone.
  await safe(() => student.getByRole("button", { name: "Refresh reading", exact: true }).click());
  await ui(await markOf(student, "Genesis 1:1")).toHaveText("Got it");
  await openPractice(student);
  await ui(lift(student).locator(".lift-progress-note:not([role])")).toHaveText("Your tutor: solid");
  await ui(await mark(student, "How Genesis 1:1 is going", "Got it")).toHaveAttribute("aria-pressed", "false");
  saved = await progress(student, "student");
  expect([saved.verses[0].selfCheck, saved.verses[0].assessment]).toEqual([{ state: "unmarked", version: 2 }, { state: "solid", version: 1 }]);
  expect(saved.counts.selfCheck).toEqual({ unmarked: 2, working: 1, "got-it": 0 });
});

it("shows the latest mark instead of overwriting one made elsewhere", async () => {
  const student = await page("student"); await workspace(student, "student");
  await openPractice(student); await liftTo(student, "Genesis 1:3");
  const { binding } = await progress(student, "student");
  expect((await api(student, `/api/students/${fixture.student.id}/progress/self-check`, { ...binding, verseRef: "Genesis 1:3", state: "working", expectedVersion: 0 })).status).toBe(200);
  await safe(() => lift(student).getByRole("button", { name: "Got it", exact: true }).click());
  await ui(lift(student).locator(".lift-progress-note[role=status]")).toHaveText("This verse was marked somewhere else. The latest mark is shown.");
  await ui(lift(student).getByRole("button", { name: "Still working", exact: true })).toHaveAttribute("aria-pressed", "true");
  await ui(lift(student).getByRole("button", { name: "Got it", exact: true })).toHaveAttribute("aria-pressed", "false");
  const saved = await progress(student, "student");
  expect(saved.verses[2].selfCheck).toEqual({ state: "working", version: 1 });
});

it("keeps an uncertain mark unverified until an explicit read succeeds, without replaying the write", async () => {
  const student = await page("student", true); await workspace(student, "student");
  await openPractice(student);
  let posts = 0, reads = 0, release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const pattern = `**/api/students/${fixture.student.id}/progress**`;
  await student.route(pattern, async route => {
    if (route.request().method() === "POST") {
      posts++;
      // The real authorized write commits; only its acknowledgement is lost.
      const response = await route.fetch(); expect(response.status()).toBe(200); await response.dispose();
      await route.abort("failed"); return;
    }
    reads++; await held;
    await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "unavailable" }) });
  });
  try {
    await safe(() => lift(student).getByRole("button", { name: "Got it", exact: true }).click());
    await ui(lift(student).getByRole("button", { name: "Checking mark…", exact: true })).toBeDisabled();
    await ui(lift(student).getByRole("group", { name: "How Genesis 1:1 is going" })).toHaveCount(0);
    await ui.poll(() => [posts, reads]).toEqual([1, 1]);
    release();
    const retry = lift(student).getByRole("button", { name: "Check what saved", exact: true });
    await ui(retry).toBeEnabled();
    await ui(lift(student).locator(".lift-progress-note[role=status]")).toContainText("The saved mark couldn’t be checked.");
    await ui(lift(student).getByRole("group", { name: "How Genesis 1:1 is going" })).toHaveCount(0);
    await capture(student, "unverified-retry-mobile");
    expect(posts).toBe(1);
    await student.unroute(pattern);
    await safe(() => retry.click());
    await ui(lift(student).getByRole("button", { name: "Got it", exact: true })).toHaveAttribute("aria-pressed", "true");
    await ui(lift(student).locator(".lift-progress-note[role=status]")).toHaveText("That mark may not have saved. The latest mark is shown.");
    expect(posts).toBe(1);
    await safe(() => student.keyboard.press("Escape"));
    await ui(student.locator(".hero-marked")).toContainText("1 got it");
    await ui(await markOf(student, "Genesis 1:1")).toHaveText("Got it");
  } finally { release(); await student.unroute(pattern); }
});
