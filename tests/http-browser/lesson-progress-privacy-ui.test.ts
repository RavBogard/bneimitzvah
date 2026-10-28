import { privateRouteFetch } from "./audio-observation";
import { dayOrdinal, dayString } from "../../src/components/portal/workspace/practice-calendar/api";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { expect as ui } from "@playwright/test";
import { chromium, type Browser, type BrowserContext, type Page, type Route } from "playwright";
import { randomUUID, createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { eq, count, sql } from "drizzle-orm";
import { isolatedEnv } from "../helpers/isolatedEnv.mjs";
import { browserFixture } from "./fixture";
import { BROWSER_ORIGIN, assertBrowserStartupAllowed, startBrowserServer } from "./server";
import { installLoopbackFetchGuard } from "./egress";
import { openAuthMail } from "./auth-navigation";
import { syntheticUiStudyPage } from "../helpers/study-ui";
import * as s from "../../src/server/db/index";
import { refreshReading, goChild } from "./reading-nav";
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
  await safe(() => tab.goto(role === "admin" ? `/workspace/admin/students/${fixture.student.id}/reading` : role === "tutor" ? `/workspace/tutor/${fixture.student.id}` : `/workspace/${role}${role === "student" ? "?tab=reading" : ""}`, { waitUntil: "domcontentloaded" }));
  if (role === "parent") await safe(() => goChild(tab, fixture.student.id));
  await ui(tab.locator("#reading-heading")).toBeVisible();
}
async function lessonsTab(tab: Page) { await safe(() => tab.locator("#lessons").scrollIntoViewIfNeeded()); await ui(lessons(tab).getByRole("button", { name: "Add lesson note", exact: true })).toBeEnabled(); }
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
async function addDraft(tab: Page, text: string) { await click(tab, "Add lesson note"); await safe(() => field(tab).fill(text)); }

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

const parentSummary = (tab: Page) => tab.getByRole("region", { name: "Preparation summary", exact: true });
// Explicit local opt-in only; region captures exclude reading text and use this fixture's synthetic note.
async function captureParentSummary(tab: Page) {
  if (process.env.PARENT_SUMMARY_CAPTURE !== "1") return;
  const root = join(process.cwd(), ".local-logs", "parent-summary-captures-v1"), region = parentSummary(tab), note = region.locator(".parent-summary-note");
  await mkdir(root); const captures: { file: string; sha256: string; viewportWidth: number; width: number; height: number }[] = [];
  expect(await region.locator(".parent-summary-note").textContent()).toBe("Synthetic parent saved note <b>plain text</b>");
  try {
    for (const width of [1440, 390]) {
      await safe(() => tab.setViewportSize({ width, height: width === 390 ? 844 : 1000 }));
      await safe(() => tab.evaluate(async () => { await document.fonts.ready; }));
      for (const open of [true]) {
        const file = `${width}-${open ? "open" : "closed"}.png`, bytes = await safe(() => region.screenshot({ path: join(root, file), animations: "disabled" }));
        captures.push({ file, sha256: createHash("sha256").update(bytes).digest("hex"), viewportWidth: width, width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) });
      }
    }
    await writeFile(join(root, "manifest.json"), JSON.stringify({ synthetic: true, region: "parent-summary", captures }, null, 2) + "\n", { flag: "wx" });
  } finally { await safe(() => tab.setViewportSize({ width: 1440, height: 1000 })); }
}

it("keeps selected-parent saved notes and server-day dates read-only, quiet, and isolated across held sibling reads", async () => {
  const tab = await page("tutor"), noteId = randomUUID(); let seededDay: string | undefined;
  const requests = { lessons: 0, dates: 0, writes: 0, raw: 0 };
  tab.on("request", request => { const path = new URL(request.url()).pathname;
    if (path.endsWith("/lesson-log")) requests.lessons++;
    if (path.endsWith("/practice-calendar")) requests.dates++;
    if (/\/(lesson-log|progress|practice-events)(?:\/|$)/.test(path) && request.method() !== "GET") requests.writes++;
    if (path.endsWith("/practice-events")) requests.raw++;
  });
  await safe(() => tab.goto("/workspace/parent", { waitUntil: "domcontentloaded" })); await ui(tab.getByTestId("mine-children")).toBeVisible();
  // E3: each child's card reads that child's latest lesson note (and nothing else of the lessons); the page's own counts start after them.
  await ui.poll(() => requests.lessons).toBe(2); requests.lessons = 0;
  expect(requests).toEqual({ lessons: 0, dates: 0, writes: 0, raw: 0 }); await ui(parentSummary(tab)).toHaveCount(0);
  const calendar = tab.waitForResponse(response => new URL(response.url()).pathname.endsWith("/practice-calendar") && response.status() === 200);
  await safe(() => goChild(tab, fixture.student.id));
  seededDay = await safe(async () => (await (await calendar).json()).serverDay as string);
  await ui(parentSummary(tab).getByText("No saved lesson yet.", { exact: true })).toBeVisible();
  await ui(parentSummary(tab).getByText("No practice dates recorded in these seven days.", { exact: true })).toBeVisible();
  expect(requests).toEqual({ lessons: 1, dates: 1, writes: 0, raw: 0 });
  try {
    await fixture.ownerDb.insert(s.lessonLog).values({ tenantId: "crc", studentId: fixture.student.id, entryId: noteId, creatorMembershipId: tutorMemberId, creatorUserId: fixture.tutor.id, lessonDate: seededDay, summary: "Synthetic parent saved note <b>plain text</b>", version: 1, deleted: false });
    await fixture.ownerDb.insert(s.practiceDay).values([{ tenantId: "crc", studentId: fixture.student.id, practiceDay: seededDay }, { tenantId: "crc", studentId: fixture.student.id, practiceDay: dayString(dayOrdinal(seededDay) - 8) }]);
    await refreshReading(tab);
    const summary = parentSummary(tab); await ui(summary.getByText(/· from /)).toBeVisible();
    const disclosure = summary.locator(".parent-summary-note"); await ui(disclosure).toBeVisible();
    await ui(summary.locator(".parent-summary-dates time")).toHaveCount(1); await ui(summary.locator(".parent-summary-dates time")).toHaveAttribute("datetime", seededDay);
    expect(requests).toEqual({ lessons: 2, dates: 2, writes: 0, raw: 0 });
    await captureParentSummary(tab);
    await ui(summary.locator(".parent-summary-note")).toHaveText("Synthetic parent saved note <b>plain text</b>"); expect(await summary.locator(".parent-summary-note b").count()).toBe(0);
    const node = await summary.elementHandle(), before = { ...requests }; let release!: () => void, ready = false, used = false, readingChecked = false, afterReadingSessions = 0;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const observed = (response: import("playwright").Response) => { const path = new URL(response.url()).pathname; if (path === `/api/students/${fixture.student.id}/reading` && response.status() === 200) readingChecked = true; if (readingChecked && path === "/api/session" && response.status() === 200) afterReadingSessions++; };
    tab.on("response", observed);
    const hold = async (route: Route) => { const response = await privateRouteFetch(route, tab); if (!response) return; if (!used) { used = true; ready = true; await gate; } try { await route.fulfill({ response }); } catch { if (!tab.isClosed()) throw new Error("Controlled quiet response could not be delivered"); } finally { await response.dispose(); } };
    await tab.route("**/api/session", hold);
    try {
      await safe(() => tab.evaluate(() => window.dispatchEvent(new Event("focus")))); await ui.poll(() => ready).toBe(true);
      await ui(disclosure).toBeVisible(); await ui(summary.getByText("Loading the latest lesson…", { exact: true })).toHaveCount(0);
      expect(await node!.evaluate(value => value === document.querySelector(".parent-study-summary"))).toBe(true); expect(requests).toEqual(before);
    } finally { release(); }
    await ui.poll(() => afterReadingSessions).toBeGreaterThanOrEqual(2); await tab.unroute("**/api/session", hold); tab.off("response", observed);
    await ui(disclosure).toBeVisible(); expect(await node!.evaluate(value => value === document.querySelector(".parent-study-summary"))).toBe(true); expect(requests).toEqual(before);
    // A changed authorized parent reading takes the real blocking provider refresh path.
    const blocking = await held(tab, "**/lesson-log?*");
    try {
      await fixture.ownerDb.update(s.student).set({ revision: sql`${s.student.revision}+1` }).where(eq(s.student.id, fixture.student.id));
      await safe(() => tab.evaluate(() => window.dispatchEvent(new Event("focus")))); await blocking.ready();
      await ui(parentSummary(tab)).toHaveCount(0); expect(requests).toEqual({ lessons: 3, dates: 2, writes: 0, raw: 0 });
    } finally { blocking.release(); }
    await blocking.remove(); await ui(parentSummary(tab).getByText(/· from /)).toBeVisible();
    await ui(parentSummary(tab).locator(".parent-summary-dates time")).toHaveAttribute("datetime", seededDay);
    await ui(parentSummary(tab).locator(".parent-summary-note")).toBeVisible();
    expect(requests).toEqual({ lessons: 3, dates: 3, writes: 0, raw: 0 });
    let releaseOld!: () => void, oldReady = false, drained!: () => void; const oldGate = new Promise<void>(resolve => { releaseOld = resolve; }), oldDone = new Promise<void>(resolve => { drained = resolve; });
    const oldPattern = new RegExp(`/api/students/${fixture.student.id}/practice-calendar\\?`);
    await tab.route(oldPattern, async route => { try { const response = await privateRouteFetch(route, tab); if (!response) return; oldReady = true; await oldGate; try { await route.fulfill({ response }); } catch {} finally { await response.dispose(); } } finally { drained(); } });
    try {
      await refreshReading(tab); await ui.poll(() => oldReady).toBe(true);
      await safe(() => goChild(tab, sibling.id));
      await ui(parentSummary(tab).getByText("No saved lesson yet.", { exact: true })).toBeVisible(); await ui(parentSummary(tab).getByText("No practice dates recorded in these seven days.", { exact: true })).toBeVisible();
    } finally { releaseOld(); }
    await oldDone; await tab.unroute(oldPattern); expect(await parentSummary(tab).textContent()).not.toContain("Synthetic parent saved note"); await ui(parentSummary(tab).locator(".parent-summary-dates time")).toHaveCount(0);
    await safe(() => tab.setViewportSize({ width: 390, height: 844 })); expect(await tab.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(requests.writes).toBe(0); expect(requests.raw).toBe(0);
  } finally {
    await safe(() => tab.context().close()); await fixture.ownerDb.delete(s.lessonLog).where(eq(s.lessonLog.entryId, noteId)); await fixture.ownerDb.delete(s.practiceDay).where(eq(s.practiceDay.studentId, fixture.student.id));
  }
});
it("initial parent-calendar guardian denial clears the accepted selected-child view", async () => {
  const tab = await page("tutor"); let release!: () => void, ready = false, status = 0;
  const gate = new Promise<void>(resolve => { release = resolve; }), pattern = new RegExp(`/api/students/${fixture.student.id}/practice-calendar\\?`);
  const guardians = (await fixture.ownerDb.select({ id: s.guardian.id, parentGrantId: s.guardian.parentGrantId, practiceEnabled: s.guardian.practiceEnabled, revokedAt: s.guardian.revokedAt }).from(s.guardian).where(eq(s.guardian.studentId, fixture.student.id))).filter(row => row.revokedAt === null), revoked: typeof guardians = [];
  await tab.route(pattern, async route => { ready = true; await gate; const response = await privateRouteFetch(route, tab); if (!response) return; status = response.status(); try { await route.fulfill({ response }); } catch {} finally { await response.dispose(); } });
  try {
    await workspace(tab, "parent"); await ui.poll(() => ready).toBe(true); await ui(parentSummary(tab)).toBeVisible();
    for (const guardian of guardians) { await fixture.ownerDb.update(s.guardian).set({ revokedAt: new Date(), revision: sql`${s.guardian.revision}+1` }).where(eq(s.guardian.id, guardian.id)); revoked.push(guardian); } release();
    // The denied child's view is cleared. The parent's other linked child (the sibling) may then open in its place; that is the parent's own access, so the check is that the denied child is gone.
    const [denied] = await fixture.ownerDb.select({ firstName: s.student.firstName, lastName: s.student.lastName }).from(s.student).where(eq(s.student.id, fixture.student.id));
    await ui.poll(() => status).toBe(404); await ui(parentSummary(tab)).toHaveCount(0); await ui(tab.locator("#reading-heading", { hasText: `${denied.firstName} ${denied.lastName}` })).toHaveCount(0); await ui(tab.locator(".lesson-entry")).toHaveCount(0);
  } finally {
    release(); try { await safe(() => tab.context().close()); } finally {
      // Revocation is permanent: only this test's formerly active pairs receive fresh grants.
      for (const guardian of revoked) await fixture.ownerDb.insert(s.guardian).values({ tenantId: "crc", studentId: fixture.student.id, parentGrantId: guardian.parentGrantId, practiceEnabled: guardian.practiceEnabled, linkProvenance: "synthetic-denial-regrant" });
    }
  }
});

it("reconciles a held successful mark across same-scope refresh and rejects its old-assignment result after replacement", async () => {
  const tab = await page("student"), admin = await page("admin"); await workspace(tab, "student"); await loaded(tab, "Genesis 1:1");
  let writes = 0; tab.on("request", r => { if (r.method() === "POST" && r.url().endsWith("/progress/self-check")) writes++; });
  const post = await held(tab, "**/progress/self-check");
  try {
    await firstMark(tab, "Got it"); await post.ready(); await safe(() => tab.keyboard.press("Escape")); await refreshReading(tab); await loaded(tab, "Genesis 1:1");
    expect((await markStatus(tab)).data.verses[0].selfCheck).toEqual({ state: "got-it", version: 1 });
  } finally { post.release(); }
  await ui(tab.locator(".hero-marked")).toHaveText(/^\s*·\s*1 got it$/); await ui(tab.locator(".study-verse-bar .verse-mark")).toHaveText("Got it"); // the selected verse's mark (the first verse, until another is chosen) await post.remove(); expect(writes).toBe(1);
  const old = await held(tab, "**/progress/self-check");
  try {
    await firstMark(tab, "Still working"); await old.ready(); await safe(() => tab.keyboard.press("Escape"));
    const prepared = await api(admin, `/api/students/${fixture.student.id}/reading/prepare`, { mode: "admin", ranges: ["Genesis 2:1-2"] }); expect(prepared.status).toBe(200);
    expect((await api(admin, `/api/students/${fixture.student.id}/reading/confirm`, { mode: "admin", binding: prepared.data.binding })).status).toBe(200);
    await refreshReading(tab); await loaded(tab, "Genesis 2:1");
  } finally { old.release(); }
  await old.remove(); await ui(tab.locator(".study-verses [data-verse-ref]")).toHaveCount(2); expect(await tab.locator(".study-verses").getByRole("heading", { name: "Genesis 1:1", exact: true }).count()).toBe(0);
  const current = await markStatus(tab); expect(current.status).toBe(200); expect(current.data.verses.map((x: { selfCheck: unknown }) => x.selfCheck)).toEqual([{ state: "unmarked", version: 0 }, { state: "unmarked", version: 0 }]); await ui(tab.locator(".hero-marked")).toHaveCount(0); expect(writes).toBe(2);
});

it("keeps overlapping parent views read-only and fences held child progress after a real child switch", async () => {
  const tab = await page("tutor"); await workspace(tab, "parent");
  const assigned = await api(tab, `/api/students/${fixture.student.id}/reading?mode=parent`); expect(assigned.status).toBe(200); const currentRef = assigned.data.readings.find((x: { kind: string }) => x.kind === "torah").verses[0]; await loaded(tab, currentRef);
  await openFirstVerse(tab); await ui(tab.locator("dialog.lift .lift-progress button")).toHaveCount(0); await safe(() => tab.keyboard.press("Escape"));
  await click(tab, "Practice with Synthetic"); await tab.waitForURL(/\/workspace\/practice\//, { timeout: 60_000 }); await loaded(tab, currentRef); await firstMark(tab, "Still working");
  await ui(tab.locator("dialog.lift").getByRole("button", { name: "Still working", exact: true })).not.toHaveAttribute("aria-disabled", "true");
  await safe(() => tab.locator("dialog.lift").getByRole("button", { name: "Got it", exact: true }).click());
  await ui(tab.locator("dialog.lift").getByRole("button", { name: "Got it", exact: true })).toHaveAttribute("aria-pressed", "true");
  await ui(tab.locator("dialog.lift").getByRole("button", { name: "Solid", exact: true })).toHaveCount(0); await safe(() => tab.keyboard.press("Escape"));
  // E2: the practice page has no Refresh reading button, so the held old-child progress read is not started here; the switch itself is what is checked.
  await click(tab, "Switch to Synthetic Sibling"); await loaded(tab, "Genesis 3:1");
  await ui(tab.locator(".hero-marked")).toHaveCount(0); expect(await tab.locator(".study-verse-bar .verse-mark").count()).toBe(0);
  await openFirstVerse(tab); await ui(tab.locator("dialog.lift .lift-ref")).toHaveText("Genesis 3:1"); await ui(tab.locator("dialog.lift").getByRole("button", { name: "Got it", exact: true })).toHaveAttribute("aria-pressed", "false"); await safe(() => tab.keyboard.press("Escape"));
  await ui(lessons(tab).getByRole("button", { name: "Add lesson note", exact: true })).toHaveCount(0);
});

it("retains the rightful lesson prompt during quiet checks and clears it on real tutor revocation without a write continuation", async () => {
  const tab = await page("tutor"); await workspace(tab, "tutor"); await lessonsTab(tab);
  const text = "Synthetic private rightful lesson draft"; let writes = 0; tab.on("request", r => { if (r.method() === "POST" && /\/lesson-log(?:\/|$)/.test(new URL(r.url()).pathname)) writes++; });
  await addDraft(tab, text); await click(tab, "Close lesson note"); await ui(prompt(tab)).toBeVisible(); expect(await modals(tab)).toBe(1);
  const session = await held(tab, "**/api/session");
  try { await safe(() => tab.evaluate(() => window.dispatchEvent(new Event("focus")))); await session.ready(); await ui(tab.getByRole("heading", { name: "Checking your access", exact: true })).toBeHidden(); await ui(prompt(tab)).toBeVisible(); expect(await modals(tab)).toBe(1); expect(writes).toBe(0); } finally { session.release(); }
  await session.remove(); await ui(prompt(tab)).toBeVisible(); expect(await modals(tab)).toBe(1); await click(tab, "Keep writing"); await ui(field(tab)).toHaveValue(text); await ui(field(tab)).toBeFocused();
  await click(tab, "Close lesson note"); await click(tab, "Discard note"); await ui(sheet(tab)).toBeHidden(); expect(await modals(tab)).toBe(0); await ui(lessons(tab).getByRole("button", { name: "Add lesson note", exact: true })).toBeFocused(); expect(writes).toBe(0);
  await addDraft(tab, "Synthetic bounded pending lesson"); const write = await held(tab, "**/lesson-log", r => r.request().method() === "POST");
  try { await click(tab, "Save lesson"); await write.ready(); await safe(() => tab.keyboard.press("Escape")); await safe(() => tab.keyboard.press("Escape")); await ui(sheet(tab)).toBeVisible(); await ui(sheet(tab).getByRole("button", { name: "Close lesson note", exact: true })).toBeDisabled(); expect(await modals(tab)).toBe(1); } finally { write.release(); }
  await write.remove(); await ui(sheet(tab)).toBeHidden(); await ui(lessons(tab).locator(".lesson-log-notice")).toHaveText("Lesson added."); expect(writes).toBe(1);
  await addDraft(tab, text); await click(tab, "Close lesson note"); await ui(prompt(tab)).toBeVisible();
  await fixture.ownerDb.update(s.tutorStudent).set({ revokedAt: new Date() }).where(eq(s.tutorStudent.id, fixture.link.id));
  await safe(() => tab.evaluate(() => window.dispatchEvent(new Event("focus")))); await ui(tab.getByRole("heading", { name: "Checking your access", exact: true })).toBeHidden();
  await ui(tab.getByLabel("Student", { exact: true })).toBeHidden(); expect(await modals(tab)).toBe(0); expect(await tab.locator(".lesson-sheet textarea, .lesson-entry").count()).toBe(0);
  expect(await tab.evaluate(value => !document.body.textContent?.includes(value), text)).toBe(true); expect((await api(tab, `/api/students/${fixture.student.id}/lesson-log?mode=tutor`)).status).toBe(404); expect(writes).toBe(1);
  await safe(() => (async () => { await tab.getByRole("banner").getByRole("link", { name: "My Readings", exact: true }).click(); })()); await ui(tab.getByTestId("mine-children")).toBeVisible(); expect(await modals(tab)).toBe(0); expect(writes).toBe(1);
});

it("gives admin full lesson authority and child read-only paging while rejecting wrong-student private answers", async () => {
  const initial = (await fixture.ownerDb.select({ total: count() }).from(s.lessonLog).where(eq(s.lessonLog.studentId, fixture.student.id)))[0].total;
  await fixture.ownerDb.insert(s.lessonLog).values(Array.from({ length: 51 }, (_, i) => ({ tenantId: "crc", studentId: fixture.student.id, entryId: randomUUID(), creatorMembershipId: tutorMemberId, creatorUserId: fixture.tutor.id, lessonDate: "2026-10-15", summary: `Synthetic paged lesson ${String(i).padStart(2, "0")}`, version: 1, deleted: false })));
  const admin = await page("admin"); await workspace(admin, "admin"); await safe(() => admin.locator("#lessons").scrollIntoViewIfNeeded()); /* Admins read lessons in the staff Lessons tab. */ await ui(lessons(admin).locator(".lesson-entry")).toHaveCount(50); await click(admin, "Show earlier lessons"); await ui(lessons(admin).locator(".lesson-entry")).toHaveCount(initial + 51);
  const otherAuthor = lessons(admin).locator(".lesson-entry").filter({ hasText: "Synthetic paged lesson 00" }); await safe(() => otherAuthor.getByRole("button", { name: /^Edit lesson from / }).click()); await ui(sheet(admin).getByRole("button", { name: "Delete lesson", exact: true })).toBeVisible(); await safe(() => field(admin).fill("Synthetic admin-edited lesson")); await click(admin, "Save lesson"); await ui(sheet(admin)).toBeHidden();
  const tab = await page("tutor"); await workspace(tab, "parent"); await click(tab, "Practice with Synthetic"); await ui(tab.locator(".study-verses [data-verse-ref]").first()).toBeVisible(); await safe(() => tab.locator("#lessons").scrollIntoViewIfNeeded()); await ui(lessons(tab).locator(".lesson-entry")).toHaveCount(50); await click(tab, "Show earlier lessons"); await ui(lessons(tab).locator(".lesson-entry")).toHaveCount(initial + 51); await ui(lessons(tab).getByRole("button", { name: /^Edit lesson/ })).toHaveCount(0); await ui(lessons(tab).getByRole("button", { name: "Add lesson note", exact: true })).toHaveCount(0);
  const marker = "Synthetic WRONG STUDENT PRIVATE NOTE"; let mismatched = false;
  await tab.route("**/lesson-log?*", async route => { const response = await route.fetch(), body = await response.json(); expect(response.status()).toBe(200); if (!body.entries?.length) return route.fulfill({ response, json: body }); body.studentId = sibling.id; body.entries[0].summary = marker; mismatched = true; await route.fulfill({ response, json: body }); });
  // E2: the practice page has no Refresh reading button; entering the practice again asks for the lessons again.
  await click(tab, "Done"); await goChild(tab, fixture.student.id); await click(tab, "Practice with Synthetic"); await ui.poll(() => mismatched).toBe(true); await ui(lessons(tab).getByText("Lesson notes couldn’t be loaded.", { exact: true })).toBeVisible(); expect(await tab.evaluate(value => !document.body.textContent?.includes(value), marker)).toBe(true); await ui(lessons(tab).locator(".lesson-entry")).toHaveCount(0);
  await tab.unroute("**/lesson-log?*"); await safe(() => lessons(tab).getByRole("button", { name: "Try again", exact: true }).click()); await ui(lessons(tab).locator(".lesson-entry")).toHaveCount(50);
});

it("actual session expiry on quiet return removes the selected-parent summary and saved history", async () => {
  const tab = await page("tutor"); await workspace(tab, "parent"); await ui(parentSummary(tab)).toBeVisible();
  await fixture.ownerDb.update(s.session).set({ expiresAt: new Date(0) }).where(eq(s.session.userId, fixture.tutor.id));
  await safe(() => tab.evaluate(() => window.dispatchEvent(new Event("focus")))); await ui(tab.getByRole("heading", { name: "Sign in to continue", exact: true })).toBeVisible();
  await ui(parentSummary(tab)).toHaveCount(0); await ui(tab.locator(".lesson-entry")).toHaveCount(0);
});
