import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { expect as ui } from "@playwright/test";
import { chromium, type Browser, type BrowserContext, type Page, type Route } from "playwright";
import { randomUUID } from "node:crypto";
import { eq, count } from "drizzle-orm";
import { isolatedEnv } from "../helpers/isolatedEnv.mjs";
import { browserFixture } from "./fixture";
import { BROWSER_ORIGIN, assertBrowserStartupAllowed, startBrowserServer } from "./server";
import { installLoopbackFetchGuard } from "./egress";
import { openAuthMail } from "./auth-navigation";
import { syntheticUiStudyPage } from "../helpers/study-ui";
import * as s from "../../src/server/db/index";
vi.mock("server-only", () => ({}));

let fixture: Awaited<ReturnType<typeof browserFixture>>, browser: Browser, stop: (() => Promise<void>) | undefined, restore: (() => void) | undefined;
let isolation: Awaited<ReturnType<typeof isolatedEnv>> | undefined, sibling: { id: string }, tutorMemberId: string;
const contexts: BrowserContext[] = [], cookies = new Map<string, Awaited<ReturnType<BrowserContext["cookies"]>>>();
const safe = async <T>(action: () => Promise<T>): Promise<T> => { try { return await action(); } catch { throw new Error("Lesson/progress privacy operation failed; private details withheld"); } };
async function api(tab: Page, path: string, body?: unknown) {
  return safe(() => tab.evaluate(async ({ path, body }) => { const r = await fetch(path, { method: body === undefined ? "GET" : "POST", cache: "no-store", headers: body === undefined ? {} : { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: r.status, data: await r.json() }; }, { path, body }));
}
async function page(role: "tutor" | "student" | "admin") {
  const context = await browser.newContext({ baseURL: BROWSER_ORIGIN, serviceWorkers: "block", acceptDownloads: false, viewport: { width: 1440, height: 1000 } }); contexts.push(context);
  await context.route("**/*", async route => { try { if (new URL(route.request().url()).origin === BROWSER_ORIGIN) await route.continue(); else await route.abort(); } catch { await route.abort(); } });
  const saved = cookies.get(role); if (saved) await context.addCookies(saved);
  const tab = await context.newPage(); await safe(() => tab.goto("/", { waitUntil: "domcontentloaded" }));
  if (!saved) { const email = role === "student" ? "pg-private-progress@example.test" : `pg-${role}@example.test`; expect((await api(tab, "/api/auth/sign-in/magic-link", { email })).status).toBe(200); await openAuthMail(tab, fixture.takeMail(email)); cookies.set(role, await context.cookies()); }
  return tab;
}
const click = (tab: Page, name: string) => safe(() => tab.getByRole("button", { name, exact: true }).click());
const sheet = (tab: Page) => tab.locator("dialog.lesson-sheet");
const prompt = (tab: Page) => tab.locator("dialog.work-departure").filter({ hasText: "Keep this lesson note?" });
const field = (tab: Page) => sheet(tab).getByLabel("What you worked on", { exact: true });
const lessons = (tab: Page) => tab.locator(".lesson-log");
const modals = (tab: Page) => tab.evaluate(() => document.querySelectorAll("dialog:modal").length);
const loaded = (tab: Page, ref: string) => ui(tab.locator(".study-verses").getByRole("heading", { name: ref, level: 4, exact: true })).toBeVisible();
async function workspace(tab: Page, role: "student" | "tutor" | "parent" | "admin") {
  await safe(() => tab.goto(role === "admin" ? `/workspace/admin/students/${fixture.student.id}/reading` : role === "tutor" ? `/workspace/tutor/${fixture.student.id}` : `/workspace/${role}`, { waitUntil: "domcontentloaded" }));
  if (role === "parent") await safe(() => tab.getByLabel("Child", { exact: true }).locator(`[data-student-id="${fixture.student.id}"]`).click());
  await ui(tab.locator("#reading-heading")).toBeVisible();
}
async function lessonsTab(tab: Page) { await safe(() => tab.getByRole("tab", { name: "Lessons", exact: true }).click()); await ui(lessons(tab).getByRole("button", { name: "Add a lesson", exact: true })).toBeEnabled(); }
async function openFirstVerse(tab: Page) { const ref = await tab.locator(".study-verses [data-verse-ref]").first().getAttribute("data-verse-ref"); expect(ref).toBeTruthy(); await click(tab, `View ${ref} up close`); await ui(tab.locator("dialog.lift")).toBeVisible(); }
async function firstMark(tab: Page, state: string) { await openFirstVerse(tab); await safe(() => tab.locator("dialog.lift").getByRole("group", { name: /^How / }).getByRole("button", { name: state, exact: true }).click()); }
async function markStatus(tab: Page, mode = "student") {
  const r = await api(tab, `/api/students/${fixture.student.id}/reading?mode=${mode}`); expect(r.status).toBe(200); const a = r.data.readings.find((x: { kind: string }) => x.kind === "torah");
  return api(tab, `/api/students/${fixture.student.id}/progress?${new URLSearchParams({ mode, kind: "torah", assignmentId: a.id, assignmentRevision: String(a.revision), offset: "0" })}`);
}
async function held(tab: Page, pattern: string | RegExp, eligible: (route: Route) => boolean = () => true) {
  let release!: () => void, ready = false, used = false;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await tab.route(pattern, async route => {
    if (used || !eligible(route)) return route.continue(); used = true;
    const response = await route.fetch(); ready = true; await gate; await route.fulfill({ response }).catch(() => undefined);
  });
  return { release, ready: () => ui.poll(() => ready).toBe(true), remove: () => tab.unroute(pattern) };
}
async function addDraft(tab: Page, text: string) { await click(tab, "Add a lesson"); await safe(() => field(tab).fill(text)); }

beforeAll(async () => {
  try {
    assertBrowserStartupAllowed(); restore = installLoopbackFetchGuard(); fixture = await browserFixture({ studyLoad: async request => syntheticUiStudyPage(request) }); sibling = (await fixture.practice()).sibling;
    const learner = await fixture.signIn("pg-private-progress"), [member] = await fixture.ownerDb.insert(s.membership).values({ tenantId: "crc", userId: learner.id }).returning();
    const [grant] = await fixture.ownerDb.insert(s.roleGrant).values({ tenantId: "crc", membershipId: member.id, role: "student" }).returning(); await fixture.ownerDb.insert(s.studentIdentity).values({ tenantId: "crc", studentId: fixture.student.id, roleGrantId: grant.id });
    const [admin] = await fixture.ownerDb.select().from(s.membership).where(eq(s.membership.userId, fixture.admin.id));
    [tutorMemberId] = (await fixture.ownerDb.select().from(s.membership).where(eq(s.membership.userId, fixture.tutor.id))).map(x => x.id);
    for (const [studentId, chapter, count] of [[fixture.student.id, 1, 3], [sibling.id, 3, 2]] as const) {
      const [assignment] = await fixture.ownerDb.insert(s.assignment).values({ tenantId: "crc", studentId, kind: "torah", basis: "custom", ref: `Genesis ${chapter}:1-${count}`, status: "confirmed", setByMembershipId: admin.id, proposalSnapshot: { ranges: [`Genesis ${chapter}:1-${count}`], confirmationDate: "2027-01-02", needsReview: false } }).returning();
      await fixture.ownerDb.insert(s.assignmentVerse).values(Array.from({ length: count }, (_, i) => ({ tenantId: "crc", studentId, assignmentId: assignment.id, ordinal: i + 1, verseRef: `Genesis ${chapter}:${i + 1}` })));
    }
    stop = await startBrowserServer(fixture.withRuntime); isolation = await isolatedEnv(); browser = await chromium.launch({ headless: true, env: isolation.env });
  } catch { await browser?.close().catch(() => undefined); await stop?.().catch(() => undefined); await fixture?.close().catch(() => undefined); restore?.(); await isolation?.cleanup(); throw new Error("Lesson/progress privacy setup failed; details withheld"); }
}, 120_000);
afterAll(async () => { await Promise.all(contexts.map(context => context.close().catch(() => undefined))); await browser?.close().catch(() => undefined); await stop?.().catch(() => undefined); await fixture?.close().catch(() => undefined); restore?.(); await isolation?.cleanup(); }, 120_000);

it("reconciles a held successful mark across same-scope refresh and rejects its old-assignment result after replacement", async () => {
  const tab = await page("student"), admin = await page("admin"); await workspace(tab, "student"); await loaded(tab, "Genesis 1:1");
  let writes = 0; tab.on("request", r => { if (r.method() === "POST" && r.url().endsWith("/progress/self-check")) writes++; });
  const post = await held(tab, "**/progress/self-check");
  try {
    await firstMark(tab, "Got it"); await post.ready(); await safe(() => tab.keyboard.press("Escape")); await click(tab, "Refresh reading"); await loaded(tab, "Genesis 1:1");
    expect((await markStatus(tab)).data.verses[0].selfCheck).toEqual({ state: "got-it", version: 1 });
  } finally { post.release(); }
  await ui(tab.locator(".hero-marked")).toHaveText(/^\s*·\s*1 got it$/); await ui(tab.locator(".study-verse-detail").first().locator(".verse-mark")).toHaveText("Got it"); await post.remove(); expect(writes).toBe(1);
  const old = await held(tab, "**/progress/self-check");
  try {
    await firstMark(tab, "Still working"); await old.ready(); await safe(() => tab.keyboard.press("Escape"));
    const prepared = await api(admin, `/api/students/${fixture.student.id}/reading/prepare`, { mode: "admin", ranges: ["Genesis 2:1-2"] }); expect(prepared.status).toBe(200);
    expect((await api(admin, `/api/students/${fixture.student.id}/reading/confirm`, { mode: "admin", binding: prepared.data.binding })).status).toBe(200);
    await click(tab, "Refresh reading"); await loaded(tab, "Genesis 2:1");
  } finally { old.release(); }
  await old.remove(); await ui(tab.locator(".study-verses [data-verse-ref]")).toHaveCount(2); expect(await tab.locator(".study-verses").getByRole("heading", { name: "Genesis 1:1", exact: true }).count()).toBe(0);
  const current = await markStatus(tab); expect(current.status).toBe(200); expect(current.data.verses.map((x: { selfCheck: unknown }) => x.selfCheck)).toEqual([{ state: "unmarked", version: 0 }, { state: "unmarked", version: 0 }]); await ui(tab.locator(".hero-marked")).toHaveCount(0); expect(writes).toBe(2);
});

it("keeps overlapping parent views read-only and fences held child progress after a real child switch", async () => {
  const tab = await page("tutor"); await workspace(tab, "parent");
  const assigned = await api(tab, `/api/students/${fixture.student.id}/reading?mode=parent`); expect(assigned.status).toBe(200); const currentRef = assigned.data.readings.find((x: { kind: string }) => x.kind === "torah").verses[0]; await loaded(tab, currentRef);
  await openFirstVerse(tab); await ui(tab.locator("dialog.lift .lift-progress button")).toHaveCount(0); await safe(() => tab.keyboard.press("Escape"));
  await click(tab, "Enter child practice"); await loaded(tab, currentRef); await firstMark(tab, "Still working");
  await ui(tab.locator("dialog.lift").getByRole("button", { name: "Still working", exact: true })).not.toHaveAttribute("aria-disabled", "true");
  await safe(() => tab.locator("dialog.lift").getByRole("button", { name: "Got it", exact: true }).click());
  await ui(tab.locator("dialog.lift").getByRole("button", { name: "Got it", exact: true })).toHaveAttribute("aria-pressed", "true");
  await ui(tab.locator("dialog.lift").getByRole("button", { name: "Solid", exact: true })).toHaveCount(0); await safe(() => tab.keyboard.press("Escape"));
  const hold = await held(tab, new RegExp(`/api/students/${fixture.student.id}/progress\\?`), route => route.request().method() === "GET");
  try { await click(tab, "Refresh reading"); await hold.ready(); await click(tab, "Switch practice to Synthetic Sibling"); await loaded(tab, "Genesis 3:1"); } finally { hold.release(); }
  await hold.remove(); await ui(tab.locator(".hero-marked")).toHaveCount(0); expect(await tab.locator(".study-verse-details .verse-mark").count()).toBe(0);
  await openFirstVerse(tab); await ui(tab.locator("dialog.lift .lift-ref")).toHaveText("Genesis 3:1"); await ui(tab.locator("dialog.lift").getByRole("button", { name: "Got it", exact: true })).toHaveAttribute("aria-pressed", "false"); await safe(() => tab.keyboard.press("Escape"));
  await ui(lessons(tab).getByRole("button", { name: "Add a lesson", exact: true })).toHaveCount(0);
});

it("retains the rightful lesson prompt during quiet checks and clears it on real tutor revocation without a write continuation", async () => {
  const tab = await page("tutor"); await workspace(tab, "tutor"); await lessonsTab(tab);
  const text = "Synthetic private rightful lesson draft"; let writes = 0; tab.on("request", r => { if (r.method() === "POST" && /\/lesson-log(?:\/|$)/.test(new URL(r.url()).pathname)) writes++; });
  await addDraft(tab, text); await click(tab, "Close lesson note"); await ui(prompt(tab)).toBeVisible(); expect(await modals(tab)).toBe(1);
  const session = await held(tab, "**/api/session");
  try { await safe(() => tab.evaluate(() => window.dispatchEvent(new Event("focus")))); await session.ready(); await ui(tab.getByRole("heading", { name: "Checking your access", exact: true })).toBeHidden(); await ui(prompt(tab)).toBeVisible(); expect(await modals(tab)).toBe(1); expect(writes).toBe(0); } finally { session.release(); }
  await session.remove(); await ui(prompt(tab)).toBeVisible(); expect(await modals(tab)).toBe(1); await click(tab, "Keep writing"); await ui(field(tab)).toHaveValue(text); await ui(field(tab)).toBeFocused();
  await click(tab, "Close lesson note"); await click(tab, "Discard note"); await ui(sheet(tab)).toBeHidden(); expect(await modals(tab)).toBe(0); await ui(lessons(tab).getByRole("button", { name: "Add a lesson", exact: true })).toBeFocused(); expect(writes).toBe(0);
  await addDraft(tab, "Synthetic bounded pending lesson"); const write = await held(tab, "**/lesson-log", r => r.request().method() === "POST");
  try { await click(tab, "Save lesson"); await write.ready(); await safe(() => tab.keyboard.press("Escape")); await safe(() => tab.keyboard.press("Escape")); await ui(sheet(tab)).toBeVisible(); await ui(sheet(tab).getByRole("button", { name: "Close lesson note", exact: true })).toBeDisabled(); expect(await modals(tab)).toBe(1); } finally { write.release(); }
  await write.remove(); await ui(sheet(tab)).toBeHidden(); await ui(lessons(tab).locator(".lesson-log-notice")).toHaveText("Lesson added."); expect(writes).toBe(1);
  await addDraft(tab, text); await click(tab, "Close lesson note"); await ui(prompt(tab)).toBeVisible();
  await fixture.ownerDb.update(s.tutorStudent).set({ revokedAt: new Date() }).where(eq(s.tutorStudent.id, fixture.link.id));
  await safe(() => tab.evaluate(() => window.dispatchEvent(new Event("focus")))); await ui(tab.getByRole("heading", { name: "Checking your access", exact: true })).toBeHidden();
  await ui(tab.getByLabel("Student", { exact: true })).toBeHidden(); expect(await modals(tab)).toBe(0); expect(await tab.locator(".lesson-sheet textarea, .lesson-entry").count()).toBe(0);
  expect(await tab.evaluate(value => !document.body.textContent?.includes(value), text)).toBe(true); expect((await api(tab, `/api/students/${fixture.student.id}/lesson-log?mode=tutor`)).status).toBe(404); expect(writes).toBe(1);
  await safe(() => tab.getByRole("navigation", { name: "Workspace roles", exact: true }).getByRole("link", { name: "Parent", exact: true }).click()); await ui(tab.getByLabel("Child", { exact: true })).toBeVisible(); expect(await modals(tab)).toBe(0); expect(writes).toBe(1);
});

it("gives admin full lesson authority and child read-only paging while rejecting wrong-student private answers", async () => {
  const initial = (await fixture.ownerDb.select({ total: count() }).from(s.lessonLog).where(eq(s.lessonLog.studentId, fixture.student.id)))[0].total;
  await fixture.ownerDb.insert(s.lessonLog).values(Array.from({ length: 51 }, (_, i) => ({ tenantId: "crc", studentId: fixture.student.id, entryId: randomUUID(), creatorMembershipId: tutorMemberId, creatorUserId: fixture.tutor.id, lessonDate: "2026-10-15", summary: `Synthetic paged lesson ${String(i).padStart(2, "0")}`, version: 1, deleted: false })));
  const admin = await page("admin"); await workspace(admin, "admin"); await safe(() => admin.getByRole("tab", { name: "Lessons", exact: true }).click()); /* Admins read lessons in the staff Lessons tab. */ await ui(lessons(admin).locator(".lesson-entry")).toHaveCount(50); await click(admin, "Show earlier lessons"); await ui(lessons(admin).locator(".lesson-entry")).toHaveCount(initial + 51);
  const otherAuthor = lessons(admin).locator(".lesson-entry").filter({ hasText: "Synthetic paged lesson 00" }); await safe(() => otherAuthor.getByRole("button", { name: /^Edit lesson from / }).click()); await ui(sheet(admin).getByRole("button", { name: "Delete lesson", exact: true })).toBeVisible(); await safe(() => field(admin).fill("Synthetic admin-edited lesson")); await click(admin, "Save lesson"); await ui(sheet(admin)).toBeHidden();
  const tab = await page("tutor"); await workspace(tab, "parent"); await click(tab, "Enter child practice"); await ui(tab.locator(".study-verses [data-verse-ref]").first()).toBeVisible(); await ui(lessons(tab).locator(".lesson-entry")).toHaveCount(50); await click(tab, "Show earlier lessons"); await ui(lessons(tab).locator(".lesson-entry")).toHaveCount(initial + 51); await ui(lessons(tab).getByRole("button", { name: /^Edit lesson/ })).toHaveCount(0); await ui(lessons(tab).getByRole("button", { name: "Add a lesson", exact: true })).toHaveCount(0);
  const marker = "Synthetic WRONG STUDENT PRIVATE NOTE"; let mismatched = false;
  await tab.route("**/lesson-log?*", async route => { const response = await route.fetch(), body = await response.json(); expect(response.status()).toBe(200); body.studentId = sibling.id; body.entries[0].summary = marker; mismatched = true; await route.fulfill({ response, json: body }); });
  await click(tab, "Refresh reading"); await ui.poll(() => mismatched).toBe(true); await ui(lessons(tab).getByText("Lesson notes couldn’t be loaded.", { exact: true })).toBeVisible(); expect(await tab.evaluate(value => !document.body.textContent?.includes(value), marker)).toBe(true); await ui(lessons(tab).locator(".lesson-entry")).toHaveCount(0);
  await tab.unroute("**/lesson-log?*"); await safe(() => lessons(tab).getByRole("button", { name: "Try again", exact: true }).click()); await ui(lessons(tab).locator(".lesson-entry")).toHaveCount(50);
});
