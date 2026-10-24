import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { expect as ui } from "@playwright/test";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { eq } from "drizzle-orm";
import { isolatedEnv } from "../helpers/isolatedEnv.mjs";
import { browserFixture } from "./fixture";
import { BROWSER_ORIGIN, assertBrowserStartupAllowed, startBrowserServer } from "./server";
import { installLoopbackFetchGuard } from "./egress";
import { openAuthMail } from "./auth-navigation";
import { syntheticUiStudyPage } from "../helpers/study-ui";
import { AccessDenied } from "../../src/server/access/errors";
import * as s from "../../src/server/db/index";
vi.mock("server-only", () => ({}));

// AD-01 (2026-10-24 review): a student with no assigned reading shows the proposed Torah portion.
// When the optional short reference-audio page for it was refused (403), the workspace cleared,
// re-checked the session, re-mounted and asked again: about 130 session checks every 4 seconds and
// "Loading the Torah portion..." for ever. The refusal must stay local and the portion must render.
let fixture: Awaited<ReturnType<typeof browserFixture>>, browser: Browser, stop: (() => Promise<void>) | undefined, restore: (() => void) | undefined;
let isolated: Awaited<ReturnType<typeof isolatedEnv>> | undefined, cookies: Awaited<ReturnType<BrowserContext["cookies"]>> | undefined, refusals = 0;
const contexts: BrowserContext[] = [];
const portion = (tab: Page) => tab.getByRole("region", { name: "Proposed Torah portion", exact: true });
beforeAll(async () => {
  try {
    assertBrowserStartupAllowed(); restore = installLoopbackFetchGuard();
    fixture = await browserFixture({ referenceStudentRelease: true, studyLoad: async request => syntheticUiStudyPage(request) });
    // Every short exploration page is refused, as the review sandbox's mismatched signing key did.
    Object.assign(fixture.runtime, { shortExplorationAudio: { page: async () => { refusals++; throw new AccessDenied(403); } } });
    await fixture.ownerDb.delete(s.assignmentVerse).where(eq(s.assignmentVerse.studentId, fixture.student.id));
    await fixture.ownerDb.delete(s.assignment).where(eq(s.assignment.studentId, fixture.student.id));
    await fixture.ownerDb.update(s.student).set({ serviceSlot: "morning" }).where(eq(s.student.id, fixture.student.id));
    stop = await startBrowserServer(fixture.withRuntime); isolated = await isolatedEnv(); browser = await chromium.launch({ headless: true, env: isolated.env });
  } catch { await stop?.().catch(() => undefined); await fixture?.close().catch(() => undefined); restore?.(); await isolated?.cleanup(); throw new Error("Synthetic exploration denial setup failed; details withheld"); }
}, 120_000);
afterEach(async () => { await Promise.all(contexts.splice(0).map(context => context.close().catch(() => undefined))); });
afterAll(async () => { await browser?.close().catch(() => undefined); await stop?.().catch(() => undefined); await fixture?.close().catch(() => undefined); restore?.(); await isolated?.cleanup(); }, 120_000);

async function tutorPage() {
  const context = await browser.newContext({ baseURL: BROWSER_ORIGIN, viewport: { width: 1200, height: 800 }, serviceWorkers: "block", acceptDownloads: false }); contexts.push(context);
  await context.route("**/*", async route => { try { if (new URL(route.request().url()).origin === BROWSER_ORIGIN) await route.continue(); else await route.abort(); } catch { await route.abort(); } });
  if (cookies) await context.addCookies(cookies);
  const tab = await context.newPage(); await tab.goto("/", { waitUntil: "domcontentloaded" });
  if (!cookies) {
    expect(await tab.evaluate(async () => (await fetch("/api/auth/sign-in/magic-link", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "pg-tutor@example.test" }) })).status)).toBe(200);
    await openAuthMail(tab, fixture.takeMail("pg-tutor@example.test")); cookies = await context.cookies();
  }
  return tab;
}

it("keeps a refused optional short reference page local: the proposed portion renders and requests stay bounded", async () => {
  const tab = await tutorPage(), counts = { session: 0, reading: 0, prepare: 0, page: 0, short: 0, refused: 0 };
  tab.on("response", response => {
    const path = new URL(response.url()).pathname;
    if (path === "/api/session") counts.session++;
    else if (path.endsWith("/reading/explore/reference/short/page")) { counts.short++; if (response.status() === 403) counts.refused++; }
    else if (path.endsWith("/reading/explore/prepare")) counts.prepare++;
    else if (path.endsWith("/reading/explore/page")) counts.page++;
    else if (path.endsWith(`/students/${fixture.student.id}/reading`)) counts.reading++;
  });
  await tab.goto(`/workspace/tutor/${fixture.student.id}`, { waitUntil: "domcontentloaded" });
  await ui(portion(tab).getByText("Verses 1–100 of 146", { exact: true })).toBeVisible();
  await ui.poll(() => counts.refused, { timeout: 30_000 }).toBeGreaterThan(0);
  const settled = { ...counts };
  await tab.waitForTimeout(4000);
  // Before the fix every refusal re-ran the access check and re-mounted the view (about 130
  // session checks per 4 s). After it: at most the one confirming reading check, then quiet.
  expect(counts.short - settled.short).toBeLessThanOrEqual(1);
  expect(counts.prepare - settled.prepare).toBe(0); expect(counts.page - settled.page).toBe(0);
  expect(counts.session - settled.session).toBeLessThanOrEqual(2); expect(counts.reading - settled.reading).toBeLessThanOrEqual(1);
  expect(counts.short).toBeLessThanOrEqual(2); expect(counts.prepare).toBeLessThanOrEqual(1); expect(counts.session).toBeLessThan(12);
  expect(refusals).toBeGreaterThan(0);
  await ui(portion(tab).getByText("Verses 1–100 of 146", { exact: true })).toBeVisible();
  await ui(portion(tab).getByLabel("Hebrew reading", { exact: true })).toBeVisible();
  await ui(tab.getByRole("heading", { name: "Checking your access", exact: true })).toHaveCount(0);
  await ui(tab.getByRole("heading", { name: "Access has changed", exact: true })).toHaveCount(0);
});

it("still clears the view when the tutor's access to the student is actually revoked", async () => {
  const tab = await tutorPage();
  await tab.goto(`/workspace/tutor/${fixture.student.id}`, { waitUntil: "domcontentloaded" });
  await ui(portion(tab).getByText("Verses 1–100 of 146", { exact: true })).toBeVisible();
  await ui.poll(() => refusals, { timeout: 30_000 }).toBeGreaterThan(0);
  await fixture.ownerDb.update(s.tutorStudent).set({ revokedAt: new Date() }).where(eq(s.tutorStudent.studentId, fixture.student.id));
  try {
    await tab.evaluate(() => { window.dispatchEvent(new Event("focus")); window.dispatchEvent(new Event("pageshow")); });
    await ui(portion(tab).getByLabel("Hebrew reading", { exact: true })).toHaveCount(0);
  } finally { await fixture.ownerDb.update(s.tutorStudent).set({ revokedAt: null }).where(eq(s.tutorStudent.studentId, fixture.student.id)); }
});
