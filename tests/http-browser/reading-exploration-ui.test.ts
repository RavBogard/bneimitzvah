import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { expect as ui } from "@playwright/test";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { mkdir } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { eq } from "drizzle-orm";
import { isolatedEnv } from "../helpers/isolatedEnv.mjs";
import { deferred } from "../helpers/study";
import { syntheticUiStudyPage } from "../helpers/study-ui";
import { browserFixture } from "./fixture";
import { openAuthMail } from "./auth-navigation";
import { installLoopbackFetchGuard } from "./egress";
import { installReadingRouteGuard, readingRouteCleanupError } from "./reading-route-guard";
import { assertBrowserStartupAllowed, BROWSER_ORIGIN, startBrowserServer } from "./server";
import * as s from "../../src/server/db/index";
vi.mock("server-only", () => ({}));

let fixture: Awaited<ReturnType<typeof browserFixture>>, browser: Browser, stop: (() => Promise<void>) | undefined, restore: (() => void) | undefined;
let browserEnv: Awaited<ReturnType<typeof isolatedEnv>> | undefined;
let hold: { entered: ReturnType<typeof deferred>; release: ReturnType<typeof deferred> } | undefined;
const contexts: { context: BrowserContext; guard: Awaited<ReturnType<typeof installReadingRouteGuard>> }[] = [];
let signedIn: Awaited<ReturnType<BrowserContext["cookies"]>> | undefined;
const portion = (tab: Page) => tab.getByRole("region", { name: "Proposed Torah portion", exact: true });
async function safe<T>(action: () => Promise<T>): Promise<T> { try { return await action(); } catch { throw new Error("Exploration UI browser operation failed; private details withheld"); } }
beforeAll(async () => {
  try {
    assertBrowserStartupAllowed(); restore = installLoopbackFetchGuard();
    fixture = await browserFixture({ studyLoad: async request => { if (hold && request.offset === 100) { hold.entered.resolve(undefined); await hold.release.promise; } return syntheticUiStudyPage(request); } });
    stop = await startBrowserServer(fixture.withRuntime); browserEnv = await isolatedEnv(); browser = await chromium.launch({ headless: true, env: browserEnv.env });
  } catch { await browser?.close().catch(() => undefined); await stop?.().catch(() => undefined); await fixture?.close().catch(() => undefined); restore?.(); await browserEnv?.cleanup(); throw new Error("Exploration UI setup failed; private details withheld"); }
}, 120000);
beforeEach(async () => {
  hold = undefined;
  await fixture.ownerDb.delete(s.assignmentVerse).where(eq(s.assignmentVerse.studentId, fixture.student.id));
  await fixture.ownerDb.delete(s.assignment).where(eq(s.assignment.studentId, fixture.student.id));
  await fixture.ownerDb.update(s.student).set({ serviceSlot: "morning" }).where(eq(s.student.id, fixture.student.id));
});
afterEach(async () => { hold?.release.resolve(undefined); hold = undefined;
  const results = await Promise.allSettled(contexts.splice(0).map(value => value.guard.close()));
  const error = readingRouteCleanupError(results); if (error) throw error;
});
afterAll(async () => {
  const failures: string[] = [];
  for (const [label, action] of [["browser", () => browser?.close()], ["server", () => stop?.()], ["fixture", () => fixture?.close()], ["home", () => browserEnv?.cleanup()]] as const) {
    try { await action(); } catch { failures.push(label); }
  }
  restore?.();
  if (failures.length) throw new Error(`Exploration UI cleanup failed (${failures.join(",")}); private details withheld`);
}, 120000);
async function page(mobile = false, colorScheme: "light" | "dark" = "light") {
  const context = await browser.newContext({ baseURL: BROWSER_ORIGIN, viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 }, colorScheme, serviceWorkers: "block", acceptDownloads: false });
  const guard = await installReadingRouteGuard(context, BROWSER_ORIGIN); contexts.push({ context, guard });
  if (signedIn) await context.addCookies(signedIn);
  const tab = await context.newPage(); await safe(() => tab.goto("/", { waitUntil: "domcontentloaded" }));
  if (!signedIn) {
    const status = await safe(() => tab.evaluate(async () => (await fetch("/api/auth/sign-in/magic-link", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "pg-tutor@example.test" }) })).status));
    expect(status).toBe(200); await openAuthMail(tab, fixture.takeMail("pg-tutor@example.test")); signedIn = await context.cookies();
  }
  return tab;
}
async function tutor(tab: Page) { await safe(() => tab.goto(`/workspace/tutor/${fixture.student.id}`, { waitUntil: "domcontentloaded" })); await ui(portion(tab).getByText("Verses 1–100 of 146", { exact: true })).toBeVisible(); }
async function assign(kind: "torah" | "haftarah") {
  const membership = (await fixture.ownerDb.select().from(s.membership).where(eq(s.membership.userId, fixture.admin.id)))[0];
  const refs = kind === "torah" ? ["Genesis 1:1", "Genesis 1:2", "Genesis 1:3"] : ["Isaiah 1:1", "Isaiah 1:2"];
  const [row] = await fixture.ownerDb.insert(s.assignment).values({ tenantId: "crc", studentId: fixture.student.id, kind, basis: "custom", status: "confirmed", ref: kind === "torah" ? "Genesis 1:1-3" : "Isaiah 1:1-2", setByMembershipId: membership.id,
    proposalSnapshot: { confirmationDate: fixture.student.ceremonyDate } }).returning();
  await fixture.ownerDb.insert(s.assignmentVerse).values(refs.map((ref, i) => ({ tenantId: "crc", studentId: fixture.student.id, assignmentId: row.id, ordinal: i + 1, verseRef: ref })));
}
it("shows all proposed pages, retains unchanged text/scroll on quiet return, and captures one desktop/phone light/dark batch", async () => {
  for (const [mobile, scheme] of [[false, "light"], [false, "dark"], [true, "light"], [true, "dark"]] as const) {
    const tab = await page(mobile, scheme); let preparations = 0;
    tab.on("request", request => { if (new URL(request.url()).pathname.endsWith("/reading/explore/prepare")) preparations++; });
    await tutor(tab); await portion(tab).getByRole("button", { name: "Next text page", exact: true }).click();
    await ui(portion(tab).getByText("Verses 101–146 of 146", { exact: true })).toBeVisible();
    const element = await portion(tab).getByLabel("Hebrew reading", { exact: true }).elementHandle();
    await safe(() => portion(tab).evaluate(node => node.scrollIntoView({ block: "start" })));
    const scroll = await tab.evaluate(() => scrollY), count = preparations;
    const checked = tab.waitForResponse(response => new URL(response.url()).pathname.endsWith("/reading") && response.status() === 200);
    await tab.evaluate(() => window.dispatchEvent(new Event("focus"))); await checked;
    await tab.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    expect(await element!.evaluate(node => node.isConnected)).toBe(true); expect(preparations).toBe(count); expect(Math.abs(await tab.evaluate(() => scrollY) - scroll)).toBeLessThan(3);
    await ui(portion(tab).getByText("Verses 101–146 of 146", { exact: true })).toBeVisible();
    expect(await portion(tab).getByRole("button", { name: /^Hear / }).count()).toBe(0);
    expect(await tab.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const directory = process.env.EXPLORATION_UI_CAPTURE_DIR;
    if (directory) {
      const target = resolve(directory), allowed = resolve(".local-logs") + sep;
      if (!target.startsWith(allowed)) throw new Error("Exploration capture directory refused");
      await mkdir(target, { recursive: true }); await safe(() => tab.screenshot({ path: resolve(target, `proposed-torah-${mobile ? "phone" : "desktop"}-${scheme}.png`) }));
    }
  }
});
it("keeps parent dashboard read-only and enters exploration only after selecting linked child practice", async () => {
  const tab = await page(); let requests = 0;
  tab.on("request", request => { if (new URL(request.url()).pathname.includes("/reading/explore/")) requests++; });
  await safe(() => tab.goto("/workspace/parent", { waitUntil: "domcontentloaded" }));
  await tab.getByLabel("Child", { exact: true }).locator(`[data-student-id="${fixture.student.id}"]`).click();
  await ui(tab.getByRole("button", { name: "Practice with Synthetic", exact: true })).toBeVisible();
  expect(await portion(tab).count()).toBe(0); expect(requests).toBe(0);
  await tab.getByRole("button", { name: "Practice with Synthetic", exact: true }).click();
  await ui(portion(tab).getByText("Verses 1–100 of 146", { exact: true })).toBeVisible(); expect(requests).toBeGreaterThan(0);
});
it("withholds a held proposed page when confirmed Torah appears, then refreshes to the real assignment", async () => {
  const tab = await page(); await tutor(tab); hold = { entered: deferred(), release: deferred() };
  await portion(tab).getByRole("button", { name: "Next text page", exact: true }).click(); await hold.entered.promise;
  await assign("torah"); hold.release.resolve(undefined);
  await ui(portion(tab).getByText("The reading changed. Refresh it to continue.", { exact: true })).toBeVisible();
  expect(await portion(tab).getByLabel("Hebrew reading", { exact: true }).count()).toBe(0);
  await portion(tab).getByRole("button", { name: "Refresh reading", exact: true }).click();
  await ui(portion(tab)).toHaveCount(0); await ui(tab.getByRole("button", { name: "Hear Genesis 1:1", exact: true })).toBeVisible();
});
it("preserves confirmed Haftarah and honest unknown-slot state without borrowing assigned Torah APIs", async () => {
  await assign("haftarah"); const tab = await page(); let assignedTorah = 0;
  tab.on("request", request => { const url = new URL(request.url()); if (/\/study-|\/reference-audio$/.test(url.pathname) && url.searchParams.get("kind") === "torah") assignedTorah++; });
  await tutor(tab); await ui(tab.getByRole("heading", { name: "Assigned Haftarah", exact: true })).toBeVisible();
  await ui(tab.getByRole("button", { name: "Hear Isaiah 1:1", exact: true })).toBeVisible(); expect(assignedTorah).toBe(0);
  await fixture.ownerDb.update(s.student).set({ serviceSlot: "unknown" }).where(eq(s.student.id, fixture.student.id));
  await tab.getByRole("button", { name: "Refresh reading", exact: true }).click();
  await ui(portion(tab).getByText("Your rabbi needs to choose a service time before the Torah portion can be shown.", { exact: true })).toBeVisible();
  await ui(tab.getByRole("button", { name: "Hear Isaiah 1:1", exact: true })).toBeVisible(); expect(assignedTorah).toBe(0);
});
