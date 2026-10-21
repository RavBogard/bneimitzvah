import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { expect as ui } from "@playwright/test";
import { chromium, type Browser, type BrowserContext, type Page, type Route, type Request as BrowserRequest } from "playwright";
import { eq } from "drizzle-orm";
import { isolatedEnv } from "../helpers/isolatedEnv.mjs";
import { browserFixture } from "./fixture";
import { BROWSER_ORIGIN, assertBrowserStartupAllowed, startBrowserServer } from "./server";
import { installLoopbackFetchGuard } from "./egress";
import { openAuthMail } from "./auth-navigation";
import { syntheticUiStudyPage } from "../helpers/study-ui";
import * as s from "../../src/server/db/index";
vi.mock("server-only", () => ({}));

let fixture: Awaited<ReturnType<typeof browserFixture>>, browser: Browser, sibling: { id: string };
let stop: (() => Promise<void>) | undefined, restore: (() => void) | undefined, isolation: Awaited<ReturnType<typeof isolatedEnv>> | undefined;
const contexts: BrowserContext[] = [];
type ServiceRead = { studentId: string; mode: string; status?: number; terminal: "pending" | "finished" | "aborted" | "failed" };
const serviceReads = new WeakMap<Page,ServiceRead[]>();
const selectedReads = (tab: Page, studentId=fixture.student.id, mode="student") => serviceReads.get(tab)?.filter(read=>read.studentId===studentId&&read.mode===mode)??[];
const safe = async <T>(action: () => Promise<T>): Promise<T> => { try { return await action(); } catch { throw new Error("Synthetic calendar session review failed; details withheld"); } };
const week = (tab: Page) => tab.getByRole("list", { name: "Practice this week", exact: true });
const click = (tab: Page, name: string) => safe(() => tab.getByRole("button", { name, exact: true }).click());
async function ready(tab: Page, expectedServiceReads=1, studentId=fixture.student.id, mode="student") {
  await ui(week(tab).getByRole("listitem")).toHaveCount(7);
  // This fixture has no connected ceremony. A completed successful read and
  // the resulting absent panel prove its post-authority probe settled too.
  // Navigation can legitimately abort the previous role's read. Only a finished
  // successful read for the current student/role establishes this barrier.
  await ui.poll(()=>{const reads=selectedReads(tab,studentId,mode),latest=reads.at(-1);return reads.length>=expectedServiceReads&&latest?.terminal==="finished"&&latest.status===200;}).toBe(true);
  const reads=selectedReads(tab,studentId,mode);
  expect(reads.filter(read=>read.status!==undefined).map(read=>read.status)).toEqual(reads.filter(read=>read.status!==undefined).map(()=>200));
  expect(reads.some(read=>read.terminal==="failed")).toBe(false);
  await ui(tab.locator("[data-my-service]")).toHaveCount(0);
}
const expired = () => fixture.ownerDb.update(s.session).set({ expiresAt: new Date(0) }).where(eq(s.session.userId, fixture.tutor.id));
const eventPath = (tab: Page) => `**/api/students/${fixture.student.id}/practice-events`;
function traffic(tab: Page) {
  const events: string[] = [], sessions: number[] = [];
  tab.on("request", request => { if (new URL(request.url()).pathname.endsWith("/practice-events")) events.push(request.method()); });
  tab.on("response", response => { if (new URL(response.url()).pathname === "/api/session") sessions.push(response.status()); });
  return { events, sessions };
}
async function page() {
  const context = await browser.newContext({ baseURL: BROWSER_ORIGIN, serviceWorkers: "block", acceptDownloads: false }); contexts.push(context);
  await context.route("**/*", async route => { try { if (new URL(route.request().url()).origin === BROWSER_ORIGIN) await route.continue(); else await route.abort(); } catch { await route.abort(); } });
  const tab = await context.newPage(), reads:ServiceRead[]=[],requests=new WeakMap<BrowserRequest,ServiceRead>();serviceReads.set(tab,reads);
  tab.on("request",request=>{const url=new URL(request.url()),match=/^\/api\/students\/([^/]+)\/my-service$/.exec(url.pathname);if(match){const read:ServiceRead={studentId:match[1],mode:url.searchParams.get("mode")??"",terminal:"pending"};reads.push(read);requests.set(request,read);}});
  tab.on("response",response=>{const read=requests.get(response.request());if(read)read.status=response.status();});
  tab.on("requestfinished",request=>{const read=requests.get(request);if(read)read.terminal="finished";});
  tab.on("requestfailed",request=>{const read=requests.get(request);if(read)read.terminal=request.failure()?.errorText==="net::ERR_ABORTED"?"aborted":"failed";});
  await safe(() => tab.goto("/", { waitUntil: "domcontentloaded" }));
  expect(await tab.evaluate(async () => (await fetch("/api/auth/sign-in/magic-link", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "pg-tutor@example.test" }) })).status)).toBe(200);
  await openAuthMail(tab, fixture.takeMail("pg-tutor@example.test")); await tab.goto("/workspace/student", { waitUntil: "domcontentloaded" });
  await ready(tab); await ui(tab.locator('.study-verses [data-verse-ref="Genesis 1:1"]')).toBeVisible(); await tab.waitForLoadState("networkidle"); return tab;
}
async function globallyGone(tab: Page) {
  await ui(tab.getByRole("heading", { name: "Sign in to continue", exact: true })).toBeVisible();
  expect(await tab.locator(".practice-day, .study-verses, [data-word-index], dialog[open]").count()).toBe(0);
  expect(await tab.getByRole("link", { name: "Parent", exact: true }).count()).toBe(0);
  await tab.waitForLoadState("networkidle");
}
beforeAll(async () => {
  try {
    assertBrowserStartupAllowed(); restore = installLoopbackFetchGuard(); fixture = await browserFixture({ studyLoad: async request => syntheticUiStudyPage(request) }); sibling = (await fixture.practice()).sibling;
    const [member] = await fixture.ownerDb.select().from(s.membership).where(eq(s.membership.userId, fixture.tutor.id));
    const [grant] = await fixture.ownerDb.insert(s.roleGrant).values({ tenantId: "crc", membershipId: member.id, role: "student" }).returning();
    await fixture.ownerDb.insert(s.studentIdentity).values({ tenantId: "crc", studentId: fixture.student.id, roleGrantId: grant.id });
    const [admin] = await fixture.ownerDb.select().from(s.membership).where(eq(s.membership.userId, fixture.admin.id));
    for (const [studentId, chapter, length] of [[fixture.student.id, 1, 3], [sibling.id, 2, 2]] as const) {
      const [assignment] = await fixture.ownerDb.insert(s.assignment).values({ tenantId: "crc", studentId, kind: "torah", basis: "custom", ref: `Genesis ${chapter}:1-${length}`, status: "confirmed", setByMembershipId: admin.id, proposalSnapshot: { ranges: [`Genesis ${chapter}:1-${length}`], confirmationDate: "2027-01-02", needsReview: false } }).returning();
      await fixture.ownerDb.insert(s.assignmentVerse).values(Array.from({ length }, (_, index) => ({ tenantId: "crc", studentId, assignmentId: assignment.id, ordinal: index + 1, verseRef: `Genesis ${chapter}:${index + 1}` })));
    }
    stop = await startBrowserServer(fixture.withRuntime); isolation = await isolatedEnv(); browser = await chromium.launch({ headless: true, env: isolation.env });
  } catch { await browser?.close().catch(() => undefined); await stop?.().catch(() => undefined); await fixture?.close().catch(() => undefined); restore?.(); await isolation?.cleanup(); throw new Error("Synthetic calendar session setup failed; details withheld"); }
}, 120_000);
afterAll(async () => { await Promise.all(contexts.map(context => context.close().catch(() => undefined))); await browser?.close().catch(() => undefined); await stop?.().catch(() => undefined); await fixture?.close().catch(() => undefined); restore?.(); await isolation?.cleanup(); }, 120_000);

it("conceals the whole own-student workspace when the calendar visit pre-probe finds actual session expiry", async () => {
  // Observe calendar pre-probe denial without starting the separate audio
  // resolver/session probe that main-reading Start intentionally invokes.
  const tab = await page(), seen = traffic(tab); await expired(); await click(tab, "View Genesis 1:1 up close"); await globallyGone(tab);
  expect(seen.sessions).toEqual([401, 401]); expect(seen.events).toEqual([]); await tab.context().close();
});

it("suppresses a committed calendar acknowledgement when the post-probe finds actual session expiry", async () => {
  const tab = await page(), seen = traffic(tab); let release!: () => void, held = false; const gate = new Promise<void>(resolve => { release = resolve; });
  const hold = async (route: Route) => { const response = await route.fetch(); expect(response.status()).toBe(200); await expired(); held = true; await gate; await route.fulfill({ response }).catch(() => undefined); };
  await tab.route(eventPath(tab), hold);
  // Isolate the calendar's exact pre/post session probes from the separate
  // reference-audio resolver used by main-text Start.
  try { await click(tab, "View Genesis 1:1 up close"); await ui.poll(() => held).toBe(true); } finally { release(); }
  await globallyGone(tab); expect(seen.events).toEqual(["POST"]); expect(seen.sessions).toEqual([200, 401, 401]);
  expect(await fixture.ownerDb.select().from(s.practiceEvent).where(eq(s.practiceEvent.studentId, fixture.student.id))).toHaveLength(1); await tab.context().close();
});

it("keeps calendar 403 and 404 local but makes a direct POST 401 globally terminal without an access-refresh loop", async () => {
  const tab = await page(), seen = traffic(tab);
  for (const status of [403, 404]) {
    await tab.route(eventPath(tab), route => route.fulfill({ status, contentType: "application/json", body: "{}" }));
    await click(tab, "View Genesis 1:1 up close"); await ui(week(tab)).toHaveCount(0); await ui(tab.locator(".study-verses")).toBeVisible();
    expect(await tab.getByRole("heading", { name: "Sign in to continue", exact: true }).count()).toBe(0);
    await click(tab, "Close practice view"); await tab.waitForLoadState("networkidle"); expect(seen.sessions).toEqual([200]);
    await tab.unroute(eventPath(tab));const expectedServiceReads=selectedReads(tab).length+1;
    await click(tab, "Refresh reading"); await ready(tab,expectedServiceReads); await tab.waitForLoadState("networkidle"); seen.sessions.length = 0;
  }
  await tab.route(eventPath(tab), async route => { await expired(); await route.fulfill({ status: 401, contentType: "application/json", body: "{}" }); });
  await click(tab, "View Genesis 1:1 up close"); await globallyGone(tab); expect(seen.sessions).toEqual([200, 401]); expect(seen.events).toEqual(["POST", "POST", "POST"]); await tab.context().close();
});

it("ignores a held old calendar 401 after a real role and child-context replacement", async () => {
  const tab = await page(), seen = traffic(tab); let release!: () => void, complete!: () => void, held = false;
  const gate = new Promise<void>(resolve => { release = resolve; }), completed = new Promise<void>(resolve => { complete = resolve; });
  const hold = async (route: Route) => { held = true; try { await gate; await route.fulfill({ status: 401, contentType: "application/json", body: "{}" }).catch(() => undefined); } finally { complete(); } };
  await tab.route(eventPath(tab), hold);
  try {
    await click(tab, "View Genesis 1:1 up close"); await ui.poll(() => held).toBe(true); await click(tab, "Close practice view");
    await tab.getByRole("link", { name: "Parent", exact: true }).click(); await tab.getByLabel("Child", { exact: true }).locator(`[data-student-id="${sibling.id}"]`).click();
    await click(tab, "Practice with Synthetic"); await ready(tab,1,sibling.id,"child-practice"); await ui(tab.locator('.study-verses [data-verse-ref="Genesis 2:1"]')).toBeVisible();
  } finally { release(); }
  await completed; await tab.waitForLoadState("networkidle"); await ready(tab,1,sibling.id,"child-practice");
  await ui(tab.getByRole("heading", { name: "Child practice", exact: true, level: 1 })).toBeVisible(); await ui(tab.locator('.study-verses [data-verse-ref="Genesis 2:1"]')).toBeVisible();
  expect(await tab.getByRole("heading", { name: "Sign in to continue", exact: true }).count()).toBe(0); expect(seen.events).toEqual(["POST"]);
  // A stale refusal cannot clear this rightful selection, but a real revoked
  // relationship still fails the existing authoritative focus/session check.
  await fixture.ownerDb.update(s.guardian).set({ revokedAt: new Date(), revision: 2 }).where(eq(s.guardian.studentId, sibling.id));
  const denied = tab.waitForResponse(response => new URL(response.url()).pathname === `/api/students/${sibling.id}/reading`);
  await tab.evaluate(() => window.dispatchEvent(new Event("focus"))); expect([403, 404]).toContain((await denied).status());
  await ui(tab.getByLabel("Child", { exact: true })).toBeVisible(); expect(await tab.locator(".practice-day, .study-verses, [data-word-index]").count()).toBe(0);
  expect(seen.events).toEqual(["POST"]); await tab.context().close();
});
