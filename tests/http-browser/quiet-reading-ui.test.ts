import { observeSilentAudio, expectSilentAudio, observeInitialShortPage, privateRouteFetch } from "./audio-observation";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { expect as ui } from "@playwright/test";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { eq, sql } from "drizzle-orm";
import { isolatedEnv } from "../helpers/isolatedEnv.mjs";
import { browserFixture } from "./fixture";
import { BROWSER_ORIGIN, assertBrowserStartupAllowed, startBrowserServer } from "./server";
import { installLoopbackFetchGuard } from "./egress";
import { openVerseTools } from "./verse-tools";
import { openAuthMail } from "./auth-navigation";
import { syntheticUiStudyPage } from "../helpers/study-ui";
import * as s from "../../src/server/db/index";
vi.mock("server-only", () => ({}));
let fixture: Awaited<ReturnType<typeof browserFixture>>, browser: Browser, stop: (() => Promise<void>) | undefined, restore: (() => void) | undefined;
let isolated: Awaited<ReturnType<typeof isolatedEnv>> | undefined;
const contexts: BrowserContext[] = [], cached = new Map<string, Awaited<ReturnType<BrowserContext["cookies"]>>>();
const shortRequests = new WeakMap<Page, ReturnType<typeof observeInitialShortPage>>();
const focus = (tab: Page) => tab.evaluate(() => { window.dispatchEvent(new Event("focus")); window.dispatchEvent(new Event("pageshow")); document.dispatchEvent(new Event("visibilitychange")); });
const readPath = () => `/api/students/${fixture.student.id}/reading?mode=parent`;
const heldMetadata = new WeakMap<Page, { count: number }>();
function observeHeldMetadata(tab: Page) {
  const seen = { count: 0 }; heldMetadata.set(tab, seen);
  tab.on("request", request => { if (/\/(?:reference-audio|reading\/explore\/reference)\//.test(new URL(request.url()).pathname)) seen.count++; });
}
async function heldReading(tab: Page) {
  expect(heldMetadata.get(tab)!.count).toBe(0);
  expect(shortRequests.get(tab)!.counts()).toEqual({ seen: 0, terminals: 0, pending: 0 });
  await expectSilentAudio(tab);
  expect(await tab.evaluate(() => (window as unknown as { silentAudioProbe: { elements: HTMLAudioElement[] } }).silentAudioProbe.elements.length)).toBe(0);
}
async function page(mode: "student" | "parent" = "student") {
  const context = await browser.newContext({ baseURL: BROWSER_ORIGIN, viewport: { width: 1200, height: 700 }, serviceWorkers: "block", acceptDownloads: false }); contexts.push(context);
  await observeSilentAudio(context);
  await context.route("**/*", async route => { try { if (new URL(route.request().url()).origin === BROWSER_ORIGIN) await route.continue(); else await route.abort(); } catch { await route.abort(); } });
  const cookies = cached.get("tutor"); if (cookies) await context.addCookies(cookies);
  const tab = await context.newPage(), initialShort = observeInitialShortPage(tab); observeHeldMetadata(tab); shortRequests.set(tab, initialShort); await tab.goto("/", { waitUntil: "domcontentloaded" });
  if (!cookies) {
    expect(await tab.evaluate(async () => (await fetch("/api/auth/sign-in/magic-link", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "pg-tutor@example.test" }) })).status)).toBe(200);
    await openAuthMail(tab, fixture.takeMail("pg-tutor@example.test")); cached.set("tutor", await context.cookies());
  }
  await tab.goto(`/workspace/${mode}${mode === "student" ? "?tab=reading" : ""}`, { waitUntil: "domcontentloaded" });
  if (mode === "parent") await tab.getByLabel("Child", { exact: true }).locator(`[data-student-id="${fixture.student.id}"]`).click();
  await ui(tab.locator(".study-verses")).toBeVisible(); await heldReading(tab); return tab;
}
async function editor(tab: Page, ordinal = 0) {
  const tools = (await openVerseTools(tab, `Genesis 1:${ordinal + 1}`)).locator(".verse-work");
  if (await tools.getAttribute("open") === null) await tools.locator("summary").click();
  const field = tools.getByRole("textbox", { name: `My translation · Genesis 1:${ordinal + 1}`, exact: true }); await ui(field).toBeVisible(); return { tools, field };
}
beforeAll(async () => {
  try {
    assertBrowserStartupAllowed(); restore = installLoopbackFetchGuard(); fixture = await browserFixture({ referenceStudentRelease: false, studyLoad: async request => syntheticUiStudyPage(request) });
    const [member] = await fixture.ownerDb.select().from(s.membership).where(eq(s.membership.userId, fixture.tutor.id));
    const [grant] = await fixture.ownerDb.insert(s.roleGrant).values({ tenantId: "crc", membershipId: member.id, role: "student" }).returning();
    await fixture.ownerDb.insert(s.studentIdentity).values({ tenantId: "crc", studentId: fixture.student.id, roleGrantId: grant.id });
    const [admin] = await fixture.ownerDb.select().from(s.membership).where(eq(s.membership.userId, fixture.admin.id));
    const [assignment] = await fixture.ownerDb.insert(s.assignment).values({ tenantId: "crc", studentId: fixture.student.id, kind: "torah", basis: "custom", ref: "Genesis 1:1-3", status: "confirmed", setByMembershipId: admin.id,
      proposalSnapshot: { confirmationDate: "2027-01-02", needsReview: false } }).returning();
    await fixture.ownerDb.insert(s.assignmentVerse).values([1, 2, 3].map(n => ({ tenantId: "crc", studentId: fixture.student.id, assignmentId: assignment.id, ordinal: n, verseRef: `Genesis 1:${n}` })));
    stop = await startBrowserServer(fixture.withRuntime); isolated = await isolatedEnv(); browser = await chromium.launch({ headless: true, env: isolated.env });
  } catch { await stop?.().catch(() => undefined); await fixture?.close().catch(() => undefined); restore?.(); await isolated?.cleanup(); throw new Error("Synthetic quiet reading setup failed; details withheld"); }
}, 120_000);
afterAll(async () => { await Promise.all(contexts.map(context => context.close().catch(() => undefined))); await browser?.close().catch(() => undefined); await stop?.().catch(() => undefined); await fixture?.close().catch(() => undefined); restore?.(); await isolated?.cleanup(); }, 120_000);
afterEach(async () => { for (const context of contexts) for (const tab of context.pages()) if (!tab.isClosed()) await heldReading(tab); await Promise.all(contexts.splice(0).map(context => context.close().catch(() => undefined))); });

it("coalesces tab-return checks while preserving actual reading DOM, scroll and unsent work without text reload", async () => {
  const tab = await page(), { field, tools } = await editor(tab), initialPageCount = shortRequests.get(tab)!.counts().seen; await field.fill("Synthetic quiet unsent draft");
  const node = await tab.locator(".study-verses").elementHandle(), scroll = await tab.evaluate(() => { window.scrollTo(0, 200); return window.scrollY; });
  let release!: () => void, entered = false, sessions = 0, text = 0, metadata = 0; const gate = new Promise<void>(yes => { release = yes; });
  tab.on("request", request => { const path = new URL(request.url()).pathname; if (path.endsWith("/study-text")) text++; if (path.endsWith("/reading")) metadata++; });
  await tab.route("**/api/session", async route => { sessions++; const response = await privateRouteFetch(route, tab); if (!response) return; if (!entered) { entered = true; await gate; } await route.fulfill({ response }).catch(() => undefined); });
  try {
    // A real hidden→visible lifecycle clears metadata/media but return alone
    // must not prepare another private page; the quiet check stays coalesced.
    await tab.evaluate(() => { Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" }); document.dispatchEvent(new Event("visibilitychange")); });
    await tab.evaluate(() => { Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" }); });
    await focus(tab); await ui.poll(() => entered).toBe(true); await focus(tab);
    expect(sessions).toBe(1); await ui(tab.getByRole("heading", { name: "Checking your access", exact: true })).toBeHidden();
    await ui(field).toHaveValue("Synthetic quiet unsent draft"); expect(await node!.evaluate(value => value === document.querySelector(".study-verses"))).toBe(true); expect(await tab.evaluate(() => window.scrollY)).toBe(scroll);
  } finally { release(); }
  await ui.poll(() => metadata).toBe(1); await ui.poll(() => sessions).toBe(4); expect(shortRequests.get(tab)!.counts().seen).toBe(initialPageCount); expect(text).toBe(0); expect(await node!.evaluate(value => value === document.querySelector(".study-verses"))).toBe(true);
  await ui(field).toHaveValue("Synthetic quiet unsent draft"); await ui(tools.locator(".work-status")).toHaveText("Saved"); await heldReading(tab); await tab.context().close();
});

it("a committed draft acknowledgement remains authoritative while an independent focus check is pending", async () => {
  const tab = await page(), { field, tools } = await editor(tab, 1); let release!: () => void, responded = false, status = 0, code: string | null = null, expectedVersion = -1; const gate = new Promise<void>(yes => { release = yes; });
  await tab.route("**/work/draft", async route => {
    expectedVersion = Number(route.request().postDataJSON().expectedVersion);
    const response = await privateRouteFetch(route, tab); if (!response) return; status = response.status();
    if (status !== 200) { const value = await response.json(); code = ["conflict", "stale-revision", "invalid-request"].includes(value.code) ? value.code : "other"; }
    responded = true; if (status === 200) await gate;
    await route.fulfill({ response }).catch(() => undefined);
  });
  try {
    await field.fill("Synthetic focus committed draft"); await tools.getByRole("button", { name: "Save now", exact: true }).click(); await ui.poll(() => responded).toBe(true);
    expect({ status, code, expectedVersion }).toMatchObject({ status: 200, code: null });
    const checked = tab.waitForResponse(response => new URL(response.url()).pathname.endsWith("/reading") && response.status() === 200);
    await focus(tab); await checked; await ui(tab.locator(".study-verses")).toBeVisible();
  } finally { release(); }
  await ui(tools.locator(".work-status")).toHaveText("Saved"); await ui(field).toHaveValue("Synthetic focus committed draft");
  expect(await tab.getByText("Save not confirmed. Your text is still in this tab.", { exact: true }).count()).toBe(0); await heldReading(tab); await tab.context().close();
});

it("transient session503 retains reading but real ordinary-parent guardian revocation clears it despite unchanged session binding", async () => {
  const tab = await page("parent"), node = await tab.locator(".study-verses").elementHandle(); let failed = false;
  const before = await tab.evaluate(async () => (await (await fetch("/api/session")).json()).sessionBinding as string);
  await tab.route("**/api/session", async route => { failed = true; await route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"unavailable"}' }); });
  const refused = tab.waitForResponse(response => new URL(response.url()).pathname === "/api/session" && response.status() === 503);
  await focus(tab); await ui.poll(() => failed).toBe(true); await refused; await ui(tab.locator(".study-verses")).toBeVisible(); expect(await node!.evaluate(value => value === document.querySelector(".study-verses"))).toBe(true);
  await tab.unroute("**/api/session");
  await fixture.ownerDb.update(s.guardian).set({ revokedAt: new Date(), revision: sql`${s.guardian.revision}+1` }).where(eq(s.guardian.studentId, fixture.student.id));
  const after = await tab.evaluate(async () => (await (await fetch("/api/session")).json()).sessionBinding as string); expect(after === before).toBe(true);
  await focus(tab); await ui(tab.locator(".study-verses")).toHaveCount(0);
  expect(await tab.evaluate(async path => (await fetch(path)).status, readPath())).toBe(404); await heldReading(tab); await tab.context().close();
});

it("actual SDK session expiry on focus removes private reading rather than quietly retaining it", async () => {
  const tab = await page(); await fixture.ownerDb.update(s.session).set({ expiresAt: new Date(0) }).where(eq(s.session.userId, fixture.tutor.id));
  await focus(tab); await ui(tab.getByRole("heading", { name: "Sign in to continue", exact: true })).toBeVisible(); expect(await tab.locator(".study-verses").count()).toBe(0); await heldReading(tab); await tab.context().close();
});
