import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { expect as ui } from "@playwright/test";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { isolatedEnv } from "../helpers/isolatedEnv.mjs";
import { syntheticUiStudyPage } from "../helpers/study-ui";
import { browserFixture } from "./fixture";
import { BROWSER_ORIGIN, assertBrowserStartupAllowed, startBrowserServer } from "./server";
import { installLoopbackFetchGuard } from "./egress";
import { openAuthMail } from "./auth-navigation";
import * as s from "../../src/server/db/index";
vi.mock("server-only", () => ({}));

let fixture: Awaited<ReturnType<typeof browserFixture>>, browser: Browser, stop: (() => Promise<void>) | undefined, restore: (() => void) | undefined;
let isolation: Awaited<ReturnType<typeof isolatedEnv>> | undefined;
const contexts: BrowserContext[] = [], cookies = new Map<string, Awaited<ReturnType<BrowserContext["cookies"]>>>();
const safe = async <T>(action: () => Promise<T>): Promise<T> => { try { return await action(); } catch { throw new Error("Reading preview browser operation failed; private details withheld"); } };
const panel = (tab: Page) => tab.locator(".reading-preview");
async function click(tab: Page, name: string) { await safe(() => tab.getByRole("button", { name, exact: true }).click()); }
async function api(tab: Page, path: string, body?: unknown) {
  return safe(() => tab.evaluate(async ({ path, body }) => {
    const response = await fetch(path, { method: body === undefined ? "GET" : "POST", body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store", headers: body === undefined ? {} : { "content-type": "application/json" } });
    return { status: response.status, data: await response.json() };
  }, { path, body }));
}
async function page(role: "admin" | "tutor" = "admin") {
  const context = await browser.newContext({ baseURL: BROWSER_ORIGIN, serviceWorkers: "block", acceptDownloads: false, viewport: { width: 1440, height: 1000 } }); contexts.push(context);
  await context.route("**/*", async route => { try { if (new URL(route.request().url()).origin === BROWSER_ORIGIN) await route.continue(); else await route.abort(); } catch { await route.abort(); } });
  const saved = cookies.get(role); if (saved) await context.addCookies(saved);
  const tab = await context.newPage(); await safe(() => tab.goto("/", { waitUntil: "domcontentloaded" }));
  if (!saved) {
    const email = role === "admin" ? "pg-admin@example.test" : "pg-tutor@example.test";
    expect((await api(tab, "/api/auth/sign-in/magic-link", { email })).status).toBe(200); await openAuthMail(tab, fixture.takeMail(email)); cookies.set(role, await context.cookies());
  }
  return tab;
}
async function reading(tab: Page, role = "admin") {
  await safe(() => tab.goto(role === "admin" ? `/workspace/admin/students/${fixture.student.id}/reading` : "/workspace/tutor", { waitUntil: "domcontentloaded" }));
  if (role === "tutor") await safe(() => tab.getByLabel("Student", { exact: true }).selectOption(fixture.student.id));
  await ui(tab.getByLabel("Custom verse ranges", { exact: true })).toBeVisible();
}
async function captures(tab: Page) {
  if (process.env.CI) return;
  const folder = join(process.cwd(), ".impeccable", "review"); await mkdir(folder, { recursive: true });
  // One batched, settled-layout round. No live provider content enters captures.
  for (const [name, viewport] of [["desktop", { width: 1440, height: 1000 }], ["mobile", { width: 390, height: 844 }]] as const) {
    await tab.setViewportSize(viewport); await ui(panel(tab).getByText(/Preview page 1 of 2\./)).toBeVisible();
    await safe(() => tab.evaluate(async () => { await document.fonts.ready; scrollTo(0, 0); await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); }));
    expect(await tab.evaluate(() => scrollY === 0 && document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await safe(() => tab.screenshot({ path: join(folder, `${name}.png`), fullPage: true }));
  }
}
beforeAll(async () => {
  try {
    assertBrowserStartupAllowed(); restore = installLoopbackFetchGuard(); fixture = await browserFixture({ studyLoad: async request => syntheticUiStudyPage(request) });
    await fixture.ownerDb.update(s.student).set({ serviceSlot: "morning" }).where(eq(s.student.id, fixture.student.id));
    const [member] = await fixture.ownerDb.select().from(s.membership).where(eq(s.membership.userId, fixture.admin.id));
    const [assignment] = await fixture.ownerDb.insert(s.assignment).values({ tenantId: "crc", studentId: fixture.student.id, kind: "torah", basis: "custom", ref: "Genesis 1:1-3", status: "confirmed", setByMembershipId: member.id,
      proposalSnapshot: { slotProvenance: 1, serviceSlot: "morning", readingDate: "2027-01-02", confirmationDate: "2027-01-02", needsReview: false } }).returning();
    await fixture.ownerDb.insert(s.assignmentVerse).values([1, 2, 3].map(n => ({ tenantId: "crc", studentId: fixture.student.id, assignmentId: assignment.id, ordinal: n, verseRef: `Genesis 1:${n}` })));
    stop = await startBrowserServer(fixture.withRuntime); isolation = await isolatedEnv(); browser = await chromium.launch({ headless: true, env: isolation.env });
  } catch { await browser?.close().catch(() => undefined); await isolation?.cleanup(); await stop?.().catch(() => undefined); await fixture?.close().catch(() => undefined); restore?.(); throw new Error("Reading preview browser setup failed; private details withheld"); }
}, 120000);
afterAll(async () => { await Promise.all(contexts.map(context => context.close().catch(() => undefined))); await browser?.close().catch(() => undefined); await isolation?.cleanup(); await stop?.().catch(() => undefined); await fixture?.close().catch(() => undefined); restore?.(); }, 120000);

it("previews a staff whole portion across pages and chapters while preserving custom draft and assignment, with desktop/mobile captures", async () => {
  const tab = await page(); await reading(tab);
  const draft = "Genesis 1:5-8"; await safe(() => tab.getByLabel("Custom verse ranges", { exact: true }).fill(draft));
  const before = await api(tab, `/api/students/${fixture.student.id}/reading?mode=admin`);
  let mutations = 0; const tokens: string[] = [];
  tab.on("request", request => {
    const path = new URL(request.url()).pathname;
    if (request.method() === "POST" && /\/reading\/(?:prepare|confirm)$/.test(path)) mutations++;
    if (path.endsWith("/reading/preview/page")) tokens.push(request.postDataJSON().binding);
  });
  await click(tab, "Preview whole Torah portion"); await ui(panel(tab).getByText(/Preview page 1 of 2\./)).toBeVisible();
  await ui(panel(tab).getByText("Calendar aliyah 1 starts here · orientation only", { exact: true })).toBeVisible();
  await ui(panel(tab).getByText(/Calendar maftir, shown separately: Numbers 28:9-10/)).toBeVisible();
  expect(await panel(tab).locator(".study-verses").getByRole("heading", { name: /Numbers/ }).count()).toBe(0);
  await click(tab, "Next preview page"); await ui(panel(tab).getByText(/Preview page 2 of 2\./)).toBeVisible();
  await ui(tab.getByRole("button", { name: "Next preview page", exact: true })).toBeDisabled();
  await safe(() => panel(tab).getByLabel("Jump to chapter (opens its first preview page)", { exact: true }).selectOption("Genesis 1"));
  await ui(panel(tab).getByText(/Preview page 1 of 2\./)).toBeVisible(); await ui(tab.getByLabel("Custom verse ranges", { exact: true })).toHaveValue(draft);
  expect(tokens.length >= 3 && tokens.every(token => token === tokens[0])).toBe(true); expect(mutations).toBe(0);
  const after = await api(tab, `/api/students/${fixture.student.id}/reading?mode=admin`); expect(after.data).toEqual(before.data);
  expect(await tab.getByRole("button", { name: "Confirm assigned reading", exact: true }).count()).toBe(0);
  await captures(tab);
});

it("previews explicit manual fallback and discards a delayed manual response when its custom draft changes", async () => {
  const tab = await page();
  const [student] = await fixture.ownerDb.select().from(s.student).where(eq(s.student.id, fixture.student.id));
  expect((await api(tab, `/api/admin/students/${student.id}/edit`, { expectedRevision: student.revision, student: { firstName: student.firstName, lastName: student.lastName, ceremonyDate: student.ceremonyDate, serviceSlot: "unknown", parentEmail: "fixture@example.test" } })).status).toBe(200);
  await reading(tab); await safe(() => tab.getByLabel("Custom verse ranges", { exact: true }).fill("Genesis 2:1-2"));
  await click(tab, "Preview whole Torah portion"); await ui(panel(tab).getByText("The service slot is not yet set. Choose custom references; no calendar date has been assumed.", { exact: true })).toBeVisible();
  expect(await panel(tab).locator(".study-verses").count()).toBe(0);
  await click(tab, "Preview custom references"); await ui(panel(tab).getByRole("heading", { name: "Genesis 2:1", exact: true })).toBeVisible();
  expect(await panel(tab).getByText(/Calendar aliyah \d starts/).count()).toBe(0);
  await safe(() => tab.getByLabel("Custom verse ranges", { exact: true }).fill("Genesis 3:1-2"));
  let release!: () => void, held = false, delivered = false; const gate = new Promise<void>(resolve => { release = resolve; });
  await tab.route("**/reading/preview/page", async route => { const response = await route.fetch(); held = true; await gate; await route.fulfill({ response }).catch(() => undefined); delivered = true; });
  try {
    await click(tab, "Preview custom references"); await ui.poll(() => held).toBe(true);
    await safe(() => tab.getByLabel("Custom verse ranges", { exact: true }).fill("Genesis 4:1-2"));
    await ui(panel(tab).locator(".study-verses")).toHaveCount(0); release(); await ui.poll(() => delivered).toBe(true);
    await safe(() => tab.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))));
    await ui(panel(tab).locator(".study-verses")).toHaveCount(0); await ui(tab.getByLabel("Custom verse ranges", { exact: true })).toHaveValue("Genesis 4:1-2");
  } finally { release(); await tab.unroute("**/reading/preview/page"); }
  await click(tab, "Preview custom references"); await ui(panel(tab).getByRole("heading", { name: "Genesis 4:1", exact: true })).toBeVisible();
});

it("clears preview text during access revalidation and fences a late response, while parent mode has no preview authority", async () => {
  const tab = await page("tutor"); await reading(tab, "tutor");
  await safe(() => tab.getByLabel("Custom verse ranges", { exact: true }).fill("Genesis 1:1-2"));
  let release!: () => void, held = false, delivered = false; const gate = new Promise<void>(resolve => { release = resolve; });
  await tab.route("**/reading/preview/page", async route => { const response = await route.fetch(); held = true; await gate; await route.fulfill({ response }).catch(() => undefined); delivered = true; });
  try {
    await click(tab, "Preview custom references"); await ui.poll(() => held).toBe(true);
    const rechecked=tab.waitForResponse(response=>new URL(response.url()).pathname==="/api/session" && response.status()===200);
    await safe(() => tab.evaluate(() => window.dispatchEvent(new Event("focus"))));await safe(()=>rechecked);
    await ui(tab.getByLabel("Custom verse ranges", { exact: true })).toBeVisible();
    await ui(tab.getByLabel("Custom verse ranges", { exact: true })).toHaveValue("Genesis 1:1-2");
    release(); await ui.poll(() => delivered).toBe(true); await ui(panel(tab).locator(".study-verses")).toHaveCount(0);
  } finally { release(); await tab.unroute("**/reading/preview/page"); }
  expect((await api(tab, `/api/students/${fixture.student.id}/reading/preview/prepare`, { mode: "parent", kind: "torah", source: "calendar" })).status).toBe(400);
  await safe(() => tab.goto("/workspace/parent", { waitUntil: "domcontentloaded" })); await safe(() => tab.getByLabel("Child", { exact: true }).selectOption(fixture.student.id));
  await ui(tab.locator(".reading-current-assignment")).toBeVisible(); expect(await tab.getByRole("button", { name: "Preview custom references", exact: true }).count()).toBe(0);
});
