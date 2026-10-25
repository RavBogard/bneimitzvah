import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { expect as ui } from "@playwright/test";
import { chromium, type Browser, type BrowserContext, type Page, type Route } from "playwright";
import { randomUUID } from "node:crypto";
import { count, eq, inArray } from "drizzle-orm";
import { isolatedEnv } from "../helpers/isolatedEnv.mjs";
import { browserFixture } from "./fixture";
import { BROWSER_ORIGIN, assertBrowserStartupAllowed, startBrowserServer } from "./server";
import { installLoopbackFetchGuard } from "./egress";
import { openAuthMail } from "./auth-navigation";
import { syntheticUiStudyPage } from "../helpers/study-ui";
import { syntheticServiceCatalog } from "../helpers/service-learning";
import * as s from "../../src/server/db/index";
vi.mock("server-only", () => ({}));

let fixture: Awaited<ReturnType<typeof browserFixture>>, browser: Browser;
let stop: (() => Promise<void>) | undefined, restore: (() => void) | undefined;
let isolation: Awaited<ReturnType<typeof isolatedEnv>> | undefined;
let sibling: { id: string }, catalogId: string, content: ReturnType<typeof syntheticServiceCatalog>;
const contexts: BrowserContext[] = [], plans = new Map<string, { id: string; revision: number }>();
const safe = async <T>(action: () => Promise<T>): Promise<T> => { try { return await action(); } catch { throw new Error("Synthetic calendar review operation failed; details withheld"); } };
const week = (tab: Page) => tab.getByRole("list", { name: "Practice this week", exact: true });
const click = (tab: Page, name: string) => safe(() => tab.getByRole("button", { name, exact: true }).click());
const ready = (tab: Page) => ui(week(tab).getByRole("listitem")).toHaveCount(7);
const marked = (tab: Page, yes: boolean) => ui(week(tab).locator(".practice-day-today")).toHaveClass(yes ? /practice-day-done/ : /^(?!.*practice-day-done).*$/);
function traffic(tab: Page) {
  const posts: { body: Record<string, unknown>; context: string | null }[] = [], rawReads: string[] = [];
  tab.on("request", request => {
    if (!new URL(request.url()).pathname.endsWith("/practice-events")) return;
    if (request.method() !== "POST") rawReads.push(request.method());
    else posts.push({ body: request.postDataJSON(), context: request.headers()["x-practice-context"] ?? null });
  });
  return { posts, rawReads };
}
async function page(role: "student" | "parent") {
  const context = await browser.newContext({ baseURL: BROWSER_ORIGIN, serviceWorkers: "block", acceptDownloads: false }); contexts.push(context);
  await context.route("**/*", async route => { try { if (new URL(route.request().url()).origin === BROWSER_ORIGIN) await route.continue(); else await route.abort(); } catch { await route.abort(); } });
  const tab = await context.newPage(); await safe(() => tab.goto("/", { waitUntil: "domcontentloaded" }));
  const email = role === "student" ? "pg-calendar-review@example.test" : "pg-tutor@example.test";
  const status = await safe(() => tab.evaluate(async email => (await fetch("/api/auth/sign-in/magic-link", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) })).status, email));
  expect(status).toBe(200); await openAuthMail(tab, fixture.takeMail(email)); return tab;
}
async function days(studentId: string) {
  const [row] = await fixture.ownerDb.select({ n: count() }).from(s.practiceDay).where(eq(s.practiceDay.studentId, studentId)); return row.n;
}
beforeAll(async () => {
  try {
    assertBrowserStartupAllowed(); restore = installLoopbackFetchGuard();
    fixture = await browserFixture({ studyLoad: async request => syntheticUiStudyPage(request) }); sibling = (await fixture.practice()).sibling;
    const learner = await fixture.signIn("pg-calendar-review"), [member] = await fixture.ownerDb.insert(s.membership).values({ tenantId: "crc", userId: learner.id }).returning();
    const [grant] = await fixture.ownerDb.insert(s.roleGrant).values({ tenantId: "crc", membershipId: member.id, role: "student" }).returning();
    await fixture.ownerDb.insert(s.studentIdentity).values({ tenantId: "crc", studentId: fixture.student.id, roleGrantId: grant.id });
    await fixture.ownerDb.update(s.student).set({ serviceSlot: "morning" }).where(inArray(s.student.id, [fixture.student.id, sibling.id]));
    const [admin] = await fixture.ownerDb.select().from(s.membership).where(eq(s.membership.userId, fixture.admin.id));
    content = syntheticServiceCatalog(); catalogId = randomUUID();
    await fixture.ownerDb.insert(s.serviceCatalog).values({ id: catalogId, tenantId: "crc", identity: content.identity, feedBytes: content.feedBytes, provenanceBytes: content.provenanceBytes, pins: content.pins });
    await fixture.ownerDb.insert(s.serviceCatalogLifecycle).values({ tenantId: "crc", catalogId, state: "active" });
    for (const studentId of [fixture.student.id, sibling.id]) {
      const [plan] = await fixture.ownerDb.insert(s.studentServicePlan).values({ tenantId: "crc", studentId, catalogId, catalogIdentity: content.identity, selectedIds: [content.first, content.second], reviewedDate: "2027-01-02", reviewedSlot: "morning", setByMembershipId: admin.id }).returning(); plans.set(studentId, plan);
      const [assignment] = await fixture.ownerDb.insert(s.assignment).values({ tenantId: "crc", studentId, kind: "torah", basis: "custom", ref: "Genesis 1:1-3", status: "confirmed", setByMembershipId: admin.id, aliyahStarts: [], proposalSnapshot: { slotProvenance: 1, serviceSlot: "morning", readingDate: "2027-01-02", confirmationDate: "2027-01-02", needsReview: false } }).returning();
      await fixture.ownerDb.insert(s.assignmentVerse).values([1, 2, 3].map(ordinal => ({ tenantId: "crc", studentId, assignmentId: assignment.id, ordinal, verseRef: `Genesis 1:${ordinal}` })));
    }
    stop = await startBrowserServer(fixture.withRuntime); isolation = await isolatedEnv(); browser = await chromium.launch({ headless: true, env: isolation.env });
  } catch { await browser?.close().catch(() => undefined); await stop?.().catch(() => undefined); await fixture?.close().catch(() => undefined); restore?.(); await isolation?.cleanup(); throw new Error("Synthetic calendar review setup failed; details withheld"); }
}, 120_000);
afterAll(async () => { await Promise.all(contexts.map(context => context.close().catch(() => undefined))); await browser?.close().catch(() => undefined); await stop?.().catch(() => undefined); await fixture?.close().catch(() => undefined); restore?.(); await isolation?.cleanup(); }, 120_000);

it("reports only explicit service choices with exact bindings and never manufactures visits on access restoration", async () => {
  const tab = await page("student"), seen = traffic(tab);
  const response = tab.waitForResponse(r => new URL(r.url()).pathname.endsWith("/practice-calendar") && r.status() === 200);
  await safe(() => tab.goto("/workspace/student", { waitUntil: "domcontentloaded" })); const { serverDay } = await (await response).json();
  await ready(tab); await safe(() => tab.getByRole("tab", { name: "Service parts", exact: true }).click()); await ui(tab.getByRole("button", { name: "Synthetic part 0", exact: true })).toBeVisible(); expect(seen.posts).toHaveLength(0);
  await click(tab, "Synthetic part 0"); await ui(tab.locator(".service-unit")).toContainText("Synthetic translation 0"); await ui.poll(() => seen.posts.length).toBe(1); await marked(tab, true);
  expect(seen.posts[0]).toEqual({ context: null, body: { mode: "student", eventId: expect.stringMatching(/^[0-9a-f-]{36}$/), expectedDay: serverDay, action: "visit", target: { type: "service-unit", catalogId, catalogIdentity: content.identity, planId: plans.get(fixture.student.id)!.id, planRevision: 1, unitId: content.first } } });
  await click(tab, "Synthetic part 0"); await ui(tab.locator(".service-unit")).toContainText("Synthetic translation 0"); expect(seen.posts).toHaveLength(1);
  let release!: () => void, held = false; const gate = new Promise<void>(resolve => { release = resolve; });
  const hold = async (route: Route) => { held = true; await gate; await route.fallback().catch(() => undefined); };
  let metadataSeen = false, finalSessions = 0;
  const observed = (response: import("playwright").Response) => { const path = new URL(response.url()).pathname;
    if (path === `/api/students/${fixture.student.id}/reading` && response.status() === 200) metadataSeen = true;
    if (metadataSeen && path === "/api/session" && response.status() === 200) finalSessions++;
  }; tab.on("response", observed);
  await tab.route("**/api/session", hold);
  try {
    await tab.evaluate(() => window.dispatchEvent(new Event("focus"))); await ui.poll(() => held).toBe(true);
    await ui(tab.locator("#workspace-main").getByRole("heading", { name: "Checking your access", exact: true })).toBeHidden(); await ready(tab); await marked(tab, true);
    await ui(tab.locator(".service-unit")).toContainText("Synthetic translation 0"); expect(seen.posts).toHaveLength(1);
  } finally { release(); }
  await ui.poll(() => finalSessions).toBeGreaterThanOrEqual(2); tab.off("response", observed);
  await ready(tab); await ui(tab.locator(".service-unit")).toContainText("Synthetic translation 0"); expect(seen.posts).toHaveLength(1);
  await tab.unroute("**/api/session", hold);
  const secondAck = tab.waitForResponse(response => new URL(response.url()).pathname.endsWith("/practice-events") && response.request().method() === "POST");
  await click(tab, "Synthetic part 2"); expect((await secondAck).status()).toBe(200); await ui.poll(() => seen.posts.length).toBe(2);
  expect(seen.posts[1].body).toMatchObject({ expectedDay: serverDay, action: "visit", target: { unitId: content.second, planId: plans.get(fixture.student.id)!.id } });
  expect(seen.posts[1].body.eventId).not.toBe(seen.posts[0].body.eventId); expect(seen.rawReads).toEqual([]);
  const events = await fixture.ownerDb.select().from(s.practiceEvent).where(eq(s.practiceEvent.studentId, fixture.student.id)); expect(events).toHaveLength(2);
  expect(events.map(row => row.target)).toEqual(expect.arrayContaining(seen.posts.map(row => row.body.target))); await tab.context().close();
});

it("drops a held service visit acknowledgement after a real child-context switch and keeps parent views dates-free", async () => {
  const tab = await page("parent"), seen = traffic(tab);
  await tab.goto("/workspace/parent", { waitUntil: "domcontentloaded" }); await tab.getByLabel("Child", { exact: true }).locator(`[data-student-id="${fixture.student.id}"]`).click();
  await ui(tab.getByRole("button", { name: "Practice with Synthetic", exact: true })).toBeVisible(); expect(await week(tab).count()).toBe(0); expect(seen.posts).toHaveLength(0);
  await click(tab, "Practice with Synthetic"); await ready(tab); await safe(() => tab.getByRole("tab", { name: "Service parts", exact: true }).click());
  let release!: () => void, complete!: () => void, held = false; const gate = new Promise<void>(resolve => { release = resolve; }), completed = new Promise<void>(resolve => { complete = resolve; });
  const hold = async (route: Route) => { try { const response = await route.fetch(); expect(response.status()).toBe(200); held = true; await gate; await route.fulfill({ response }).catch(() => undefined); } finally { complete(); } };
  const target = `**/api/students/${fixture.student.id}/practice-events`; await tab.route(target, hold);
  try {
    await click(tab, "Synthetic part 2"); await ui.poll(() => held).toBe(true); expect(seen.posts).toHaveLength(1);
    expect(seen.posts[0].context).toEqual(expect.any(String)); expect(seen.posts[0].body).toMatchObject({ mode: "child-practice", action: "visit", target: { unitId: content.second, planId: plans.get(fixture.student.id)!.id } });
    await click(tab, "Switch practice to Synthetic Sibling"); await ready(tab); await marked(tab, false);
    expect(await days(sibling.id)).toBe(0); expect(await days(fixture.student.id)).toBe(1);
  } finally { release(); }
  await completed; await tab.unroute(target, hold); await marked(tab, false); expect(seen.posts).toHaveLength(1);
  await click(tab, "Return to parent view"); await ui(tab.getByLabel("Child", { exact: true })).toBeVisible(); await ui(tab).toHaveURL(`${BROWSER_ORIGIN}/workspace/parent`);
  expect(await tab.locator(".practice-week, .practice-day").count()).toBe(0); expect(seen.posts).toHaveLength(1); expect(seen.rawReads).toEqual([]); await tab.context().close();
});
