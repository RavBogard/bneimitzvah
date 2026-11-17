import { closeVerseTools, openVerseTools } from "./verse-tools";
import { openAuthMail } from "./auth-navigation";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { expect as ui } from "@playwright/test";
import { chromium, type Browser, type BrowserContext, type Page, type Locator } from "playwright";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { and, eq } from "drizzle-orm";
import { browserFixture } from "./fixture";
import { BROWSER_ORIGIN, assertBrowserStartupAllowed, startBrowserServer } from "./server";
import { installLoopbackFetchGuard } from "./egress";
import { syntheticUiStudyPage } from "../helpers/study-ui";
import { StudyUnavailable } from "../../src/server/study/types";
import { expandReadingRanges } from "../../src/lib/readings/ranges";
import { TANAKH_VERSE_COUNTS } from "../../src/lib/readings/catalog";
import { isolatedEnv } from "../helpers/isolatedEnv.mjs";
import * as s from "../../src/server/db/index";
import { refreshReading as refreshPage, goChild } from "./reading-nav";
vi.mock("server-only", () => ({}));

// A verse's notes from a tutor or the rabbi: staff write them, the student and the student's parents read them. A student's own translation
// ("My translation") was removed on 2026-11-17 (Daniel); its route answers as an unknown route and nothing in the browser writes or shows it.
let fixture: Awaited<ReturnType<typeof browserFixture>>, browser: Browser, stop: (() => Promise<void>) | undefined, restore: (() => void) | undefined;
let browserEnvironment: Awaited<ReturnType<typeof isolatedEnv>> | undefined;
let unavailable = false;
const contexts: BrowserContext[] = [];
const sdkCookies = new Map<string, Awaited<ReturnType<BrowserContext["cookies"]>>>();
const httpEvidence = new WeakMap<Page, string[]>(), browserErrors = new WeakMap<Page, number>();
function observe(tab: Page) {
  const events: string[] = []; httpEvidence.set(tab, events); browserErrors.set(tab, 0);
  tab.on("pageerror", () => browserErrors.set(tab, (browserErrors.get(tab) ?? 0) + 1));
  tab.on("response", response => { const path = new URL(response.url()).pathname; const label = path.endsWith("/reading") ? "metadata" : path.endsWith("/study-text") ? "text" : /\/work(?:\/[^/]+)?$/.test(path) ? "work" : path === "/api/session" ? "session" : null; if (label) { events.push(`${label}:${response.status()}`); if (events.length > 30) events.shift(); } });
  return tab;
}
async function safe<T>(action: () => Promise<T>, step = "workspace interaction"): Promise<T> { try { return await action(); } catch { throw new Error(`Student work browser ${step} failed; private details withheld`); } }
async function navigate(tab: Page, path: string) { await safe(() => tab.goto(path, { waitUntil: "domcontentloaded", timeout: 30_000 })); }
async function api(tab: Page, path: string, body?: unknown, step = "workspace interaction") {
  return safe(() => tab.evaluate(async ({ path, body }) => { const response = await fetch(path, { method: body === undefined ? "GET" : "POST", body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store", headers: body === undefined ? {} : { "content-type": "application/json" } }); return { status: response.status, data: await response.json() }; }, { path, body }), step);
}
async function page(who: "student" | "tutor" | "admin", mobile = false) {
  const context = await browser.newContext({ baseURL: BROWSER_ORIGIN, serviceWorkers: "block", acceptDownloads: false, viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 } }); contexts.push(context);
  await context.route("**/*", async route => { try { if (new URL(route.request().url()).origin === BROWSER_ORIGIN) await route.continue(); else await route.abort(); } catch { await route.abort(); } });
  const cached = sdkCookies.get(who); if (cached) { await context.addCookies(cached); return observe(await context.newPage()); }
  const tab = observe(await context.newPage()); await navigate(tab, "/"); const email = who === "student" ? "pg-work-student@example.test" : who === "admin" ? "pg-admin@example.test" : "pg-tutor@example.test";
  const login = await api(tab, "/api/auth/sign-in/magic-link", { email }); expect(login.status, "synthetic SDK sign-in HTTP status").toBe(200); await openAuthMail(tab, fixture.takeMail(email)); sdkCookies.set(who, await context.cookies()); return tab;
}
// The page's own controls sit behind the modal verse-tools sheet, so a reader closes it first; the unsent text stays in the tab's work state either way.
async function click(tab: Page, name: string) { if (await tab.getByRole("dialog", { name: /^Verse tools · / }).count()) await closeVerseTools(tab); await safe(() => tab.getByRole("button", { name, exact: true }).click()); }
// Refreshing goes through the page's Manage pill where there is one, which the open verse-tools sheet covers: close the sheet first, as a reader would.
async function refreshReading(tab: Page) { if (await tab.getByRole("dialog", { name: /^Verse tools · / }).count()) await closeVerseTools(tab); await refreshPage(tab); }
async function loaded(tab: Page, ref = "Genesis 1:1") {
  try { await ui(tab.locator(".study-verses").getByRole("heading", { name: ref, level: 4, exact: true })).toBeVisible(); }
  catch {
    const states = await tab.evaluate(() => { const labels = ["Reading unavailable", "Text unavailable", "Checking your access", "Workspace unavailable", "Loading the assigned reading", "Checking the current assignment, text and saved work", "Sign in to continue", "No reading has been assigned yet"]; return labels.filter(label => document.body.innerText.includes(label)); });
    const directory = join(process.cwd(), ".local-logs"); await mkdir(directory, { recursive: true }); await tab.screenshot({ path: join(directory, "student-work-load-failure.png"), fullPage: true }).catch(() => undefined);
    throw new Error(`Assigned reading not visible; HTTP ${httpEvidence.get(tab)?.join(",")}; fixed states ${states.join(",") || "none"}; page error count ${browserErrors.get(tab) ?? 0}`);
  }
}
// A verse's notes are in its verse tools (one Sheet for the selected verse, 1.9 N4): the verse is selected and its sheet opened, as a reader does.
// The sheet is modal, so a test that then uses the page's own controls closes it first (closeVerseTools); the unsent text stays in the tab's work state and is there on reopening.
async function tools(tab: Page, ref = "Genesis 1:1") { const panel = (await openVerseTools(tab, ref)).locator(".verse-work"); if (await panel.getAttribute("open") === null) await safe(() => panel.locator("summary").first().click()); await ui(panel.locator(".verse-work-content")).toBeVisible(); return panel; }
const add = (panel: Locator) => safe(() => panel.getByRole("button", { name: "Add student-visible note", exact: true }).click());
const state = (panel: Locator) => panel.getByTestId("work-status");
async function singleRecovery(panel: Locator, message: string) {
  await ui(panel.locator(".work-editor [role=status]")).toHaveCount(1);
  await ui(panel.locator(".work-editor .request-error")).toHaveCount(1);
  await ui(panel.locator(".work-status")).toHaveText(message);
  expect(await panel.getByRole("textbox").evaluate(field => {
    const ids = (field.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean), elements = ids.map(id => document.getElementById(id));
    return ids.length === 2 && elements.every(element => element && element.textContent?.trim()) && elements.filter(element => element?.getAttribute("role") === "status").length === 1;
  })).toBe(true);
}
async function learner(tab: Page) { await navigate(tab, "/workspace/student?tab=reading"); await loaded(tab); }
async function staff(tab: Page) { await navigate(tab, `/workspace/admin/students/${fixture.student.id}/reading`); await loaded(tab); }
async function selection(tab: Page, mode: "student" | "admin" = "admin") {
  const reading = await api(tab, `/api/students/${fixture.student.id}/reading?mode=${mode}`); expect(reading.status === 200).toBe(true); const row = reading.data.readings.find((r: { kind: string }) => r.kind === "torah");
  return { mode, kind: "torah", assignmentId: row.id, assignmentRevision: row.revision };
}
async function append(tab: Page, ref: string, text: string, expectedVersion: number) { return api(tab, `/api/students/${fixture.student.id}/work/note`, { ...await selection(tab), verseRef: ref, text, expectedVersion, mutationId: randomUUID() }); }
async function head(tab: Page, ref: string, mode: "student" | "admin" = "admin") { const binding = await selection(tab, mode), ordinal = expandReadingRanges(["Genesis 1:1-15"], "torah", TANAKH_VERSE_COUNTS).indexOf(ref), query = new URLSearchParams({ ...binding, assignmentRevision: String(binding.assignmentRevision), offset: String(ordinal) }); const result = await api(tab, `/api/students/${fixture.student.id}/work?${query}`); expect(result.status === 200).toBe(true); return (result.data.verses[0].notes[0] ?? null) as { version: number; text: string } | null; }
async function capture(tab: Page, name: string) {
  if (process.env.CI) return; const original = tab.viewportSize(), state = name.replace(/-(mobile|desktop)$/, "");
  const directory = join(process.cwd(), ".impeccable", "review"); await mkdir(directory, { recursive: true });
  async function expectedState() {
    await ui(tab.locator(".reading-with-work")).toBeVisible();
    const panel = tab.locator(".study-verse-detail .verse-work[open]"); await ui(panel).toBeVisible();
    if (state === "revision-review" || state === "revision-unknown") {
      await ui(panel.getByRole("textbox")).toHaveJSProperty("readOnly", true);
      await ui(panel.getByRole("region", { name: /Review unsent note/ })).toBeVisible();
      if (state === "revision-unknown") await ui(panel.getByRole("button", { name: "Try again", exact: true })).toBeVisible();
      else await ui(panel.getByRole("button", { name: "Review and keep my text", exact: true })).toBeEnabled();
    } else if (state === "unknown") {
      await ui(panel.locator(".work-status")).toHaveText("Save not confirmed. Your text is still in this tab.");
      await ui(panel.getByRole("button", { name: "Try again", exact: true })).toBeVisible();
      await ui(panel.getByRole("button", { name: "Save again", exact: true })).toBeVisible();
      await ui(panel.locator(".work-history > summary")).toBeVisible();
    } else if (state === "conflict") {
      await ui(panel.locator(".work-status")).toHaveText("An earlier save succeeded. A newer version is saved. Review before saving yours.");
      await ui(panel.locator(".work-comparison")).toBeVisible();
    } else if (state === "student-notes" || state === "parent-readonly") { await ui(panel.locator(".work-notes")).toBeVisible(); expect(await panel.getByRole("textbox").count()).toBe(0); }
    else if (state === "staff-visible-note") await ui(panel.getByRole("button", { name: "Add student-visible note", exact: true })).toBeVisible();
    else throw new Error("Unknown work capture scenario");
  }
  async function settleCapture() {
    await expectedState();
    await safe(() => tab.evaluate(async () => { await document.fonts.ready; scrollTo(0, 0); await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); }));
    await expectedState();
    expect(await tab.evaluate(() => scrollY === 0 && document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await ui(tab.locator(".portal-header")).toBeInViewport();
  }
  try {
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
      await tab.setViewportSize(viewport); await settleCapture();
      await safe(() => tab.screenshot({ path: join(directory, `work-${state}-${viewport.width === 390 ? "mobile" : "desktop"}.png`), fullPage: true }));
    }
    if (state === "student-notes") {
      await tab.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
      await settleCapture();
      await safe(() => tab.screenshot({ path: join(directory, "work-student-notes-mobile-200pct.png"), fullPage: true }));
      await tab.evaluate(() => { document.documentElement.style.removeProperty("font-size"); });
    }
  } finally { await tab.evaluate(() => { document.documentElement.style.removeProperty("font-size"); }); if (original) await tab.setViewportSize(original); }
}
async function accountReady(tab: Page) {
  // Leaving by the bar lands on My Readings (Area A); Account is one link from there.
  await ui.poll(() => ["/mine", "/account"].includes(new URL(tab.url()).pathname)).toBe(true);
  if (new URL(tab.url()).pathname === "/mine") await tab.getByTestId("mine-account").click();
  await ui(tab.getByRole("heading", { name: "Account", level: 1, exact: true })).toBeVisible();
  await ui(tab.getByRole("button", { name: "Sign out", exact: true })).toBeEnabled();
  expect(new URL(tab.url()).pathname).toBe("/account");
}
async function captureAccount(tab: Page) {
  if (process.env.CI) return;
  const original = tab.viewportSize(), directory = join(process.cwd(), ".impeccable", "review"); await mkdir(directory, { recursive: true });
  try {
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
      await tab.setViewportSize(viewport); await accountReady(tab);
      await safe(() => tab.evaluate(async () => { await document.fonts.ready; scrollTo(0, 0); await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); }));
      expect(await tab.evaluate(() => document.documentElement.scrollWidth <= innerWidth && scrollY === 0)).toBe(true);
      await safe(() => tab.screenshot({ path: join(directory, `student-account-${viewport.width === 390 ? "mobile" : "desktop"}.png`), fullPage: true }));
    }
  } finally { if (original) await tab.setViewportSize(original); }
}

beforeAll(async () => {
  try {
    assertBrowserStartupAllowed(); restore = installLoopbackFetchGuard();
    fixture = await browserFixture({ studyLoad: async request => { if (unavailable) throw new StudyUnavailable("upstream"); return syntheticUiStudyPage(request); } }); const sibling = (await fixture.practice()).sibling;
    const user = await fixture.signIn("pg-work-student");
    const [member] = await fixture.ownerDb.insert(s.membership).values({ tenantId: "crc", userId: user.id }).returning(); const [grant] = await fixture.ownerDb.insert(s.roleGrant).values({ tenantId: "crc", membershipId: member.id, role: "student" }).returning();
    await fixture.ownerDb.insert(s.studentIdentity).values({ tenantId: "crc", studentId: fixture.student.id, roleGrantId: grant.id });
    const [adminMember] = await fixture.ownerDb.select().from(s.membership).where(eq(s.membership.userId, fixture.admin.id));
    for (const [studentId, ranges] of [[fixture.student.id, ["Genesis 1:1-15"]], [sibling.id, ["Genesis 2:1-2"]]] as const) {
      const [assignment] = await fixture.ownerDb.insert(s.assignment).values({ tenantId: "crc", studentId, kind: "torah", basis: "custom", ref: ranges.join("; "), status: "confirmed", setByMembershipId: adminMember.id, proposalSnapshot: { ranges: [...ranges], confirmationDate: "2027-01-02", needsReview: false } }).returning();
      await fixture.ownerDb.insert(s.assignmentVerse).values(expandReadingRanges(ranges, "torah", TANAKH_VERSE_COUNTS).map((verseRef, index) => ({ tenantId: "crc", studentId, assignmentId: assignment.id, ordinal: index + 1, verseRef })));
    }
    stop = await startBrowserServer(fixture.withRuntime); browserEnvironment = await isolatedEnv(); browser = await chromium.launch({ headless: true, env: browserEnvironment.env });
  } catch { await browser?.close().catch(() => undefined); await browserEnvironment?.cleanup().catch(() => undefined); await stop?.().catch(() => undefined); await fixture?.close().catch(() => undefined); restore?.(); throw new Error("Student work browser setup failed; private details withheld"); }
}, 120_000);
afterAll(async () => { await Promise.all(contexts.map(context => context.close().catch(() => undefined))); await browser?.close().catch(() => undefined); await browserEnvironment?.cleanup().catch(() => undefined); await stop?.().catch(() => undefined); await fixture?.close().catch(() => undefined); restore?.(); }, 120_000);

it("staff write explicit visible notes with literal markup; the student, a parent and child practice read them with no editor and no translation", async () => {
  const student = await page("student", true); await learner(student);
  await safe(() => student.evaluate(async () => { await document.fonts.ready; scrollTo(0, 0); await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); }));
  const cdp = await student.context().newCDPSession(student);
  try {
    await cdp.send("DOM.enable"); await cdp.send("CSS.enable"); const dom = await cdp.send("DOM.getDocument");
    const { nodeId } = await cdp.send("DOM.querySelector", { nodeId: dom.root.nodeId, selector: ".study-hebrew > span" });
    const { fonts } = await cdp.send("CSS.getPlatformFontsForNode", { nodeId });
    expect(fonts.some(font => font.isCustomFont && font.familyName === "Taamey Frank CLM" && font.glyphCount > 0)).toBe(true);
    expect(fonts.every(font => font.isCustomFont)).toBe(true);
  } finally { await cdp.detach(); }
  const geometry = await student.locator(".study-hebrew > span").first().evaluate(span => { const range = document.createRange(); range.selectNodeContents(span); const box = range.getBoundingClientRect(); return { top: box.top, bottom: box.bottom, height: innerHeight, scroll: scrollY }; });
  expect(geometry.scroll === 0 && geometry.top >= 0 && geometry.bottom <= geometry.height).toBe(true);
  const own = await tools(student); expect(await own.getByRole("textbox").count()).toBe(0); expect(await own.getByRole("button", { name: "Add student-visible note", exact: true }).count()).toBe(0);
  const admin = await page("admin"); await staff(admin); const adminPanel = await tools(admin), text = "Synthetic teacher note <img src=x onerror=alert(1)> שָׁלוֹם 😀 é\n  spaced  ";
  await safe(() => adminPanel.getByRole("textbox").fill(text)); expect(await fixture.ownerDb.select().from(s.tutorNote)).toHaveLength(0);
  await capture(admin, "staff-visible-note-desktop"); await add(adminPanel); await ui(state(adminPanel)).toHaveAttribute("data-work-state", "empty"); expect((await head(admin, "Genesis 1:1"))?.text === text).toBe(true); expect(await adminPanel.locator("img").count()).toBe(0);
  const tutor = await page("tutor"); await navigate(tutor, "/workspace/tutor"); await safe(() => tutor.locator(`a[href="/workspace/tutor/${fixture.student.id}"]`).click()); await loaded(tutor); const tutorPanel = await tools(tutor);
  await safe(() => tutorPanel.getByRole("textbox").fill("Synthetic assigned tutor note")); await add(tutorPanel); await ui(tutorPanel.getByText("Synthetic assigned tutor note", { exact: true })).toBeVisible();
  await refreshReading(student); await loaded(student); const refreshed = await tools(student);
  for (const note of ["Synthetic assigned tutor note"]) {
    const row = refreshed.locator(".work-notes article").filter({ hasText: note }); await ui(row.getByText(note, { exact: true })).toBeVisible(); await ui(row.getByText("your tutor", { exact: true })).toBeVisible();
  }
  await ui(refreshed.locator(".work-notes article")).toHaveCount(2); expect(await refreshed.getByRole("textbox").count()).toBe(0); await capture(student, "student-notes-mobile");
  // The student workspace app bar hosts Learn to lein, whose device-only progress and sync outline (lesson ids, review boxes and dates, no student text) is the one
  // thing it may keep in this browser (besides the site bar's signed-in hint, the one character "1"); the notes shown above must still never touch web storage.
  expect(await student.evaluate(() => {
    const own = new Set(["crc-torah:learn-progress/v1", "crc-torah:learn-sync/v1", "crc-torah:signed-in/v1"]), texts = ["Synthetic", "😀", "שָׁלוֹם"];
    const entries = [localStorage, sessionStorage].flatMap(store => Object.keys(store).map(key => [store === localStorage && own.has(key), key, store.getItem(key) ?? ""] as const));
    return sessionStorage.length === 0 && entries.every(([allowed, key, value]) => allowed && !texts.some(text => key.includes(text) || value.includes(text)));
  })).toBe(true);
  const parent = await page("tutor"); await navigate(parent, "/workspace/parent"); await safe(() => goChild(parent, fixture.student.id)); await loaded(parent); const parentPanel = await tools(parent);
  expect(await parentPanel.getByRole("textbox").count()).toBe(0); await ui(parentPanel.getByText("Synthetic assigned tutor note", { exact: true })).toBeVisible(); await capture(parent, "parent-readonly-desktop");
  await click(parent, "Practice with Synthetic"); await parent.waitForURL(/\/workspace\/practice\//, { timeout: 60_000 }); await loaded(parent); const childPanel = await tools(parent);
  expect(await childPanel.getByRole("textbox").count()).toBe(0); expect(await childPanel.getByRole("button", { name: "Add student-visible note", exact: true }).count()).toBe(0); await ui(childPanel.getByText("Synthetic assigned tutor note", { exact: true })).toBeVisible();
});

it("holds one real committed POST acknowledgement, keeps later typing and recovers exactly one PG version/audit by receipt", async () => {
  const tab = await page("admin"); await staff(tab); const panel = await tools(tab, "Genesis 1:2"), field = panel.getByRole("textbox");
  let release!: () => void, committed = false, calls = 0, mutationId = ""; const gate = new Promise<void>(resolve => { release = resolve; });
  await tab.route("**/work/note", async route => { calls++; mutationId = route.request().postDataJSON().mutationId; const response = await route.fetch(); committed = response.status() === 200; await gate; await route.fulfill({ response }).catch(() => undefined); });
  await safe(() => field.fill("Synthetic lost acknowledgement")); await add(panel); await ui.poll(() => committed).toBe(true);
  await safe(() => field.fill("Synthetic latest queued edit")); await ui(panel.locator(".work-status")).toHaveText("Save not confirmed. Your text is still in this tab.", { timeout: 18_000 });
  await singleRecovery(panel, "Save not confirmed. Your text is still in this tab.");
  expect(calls).toBe(1); const [row] = await fixture.ownerDb.select().from(s.tutorNote).where(eq(s.tutorNote.mutationId, mutationId)); expect(row.version === 1 && row.text === "Synthetic lost acknowledgement").toBe(true);
  expect((await fixture.ownerDb.select().from(s.auditEvent).where(eq(s.auditEvent.targetId, row.id))).length).toBe(1); await capture(tab, "unknown-desktop");
  release(); await tab.unroute("**/work/note"); await safe(() => panel.getByRole("button", { name: "Try again", exact: true }).click());
  // The confirmed note is listed; the later typing stays unsent in the editor.
  await ui(panel.locator(".work-notes")).toContainText("Synthetic lost acknowledgement", { timeout: 18_000 }); await ui(field).toHaveValue("Synthetic latest queued edit"); await ui(state(panel)).toHaveAttribute("data-work-state", "unsubmitted");
  const rows = await fixture.ownerDb.select().from(s.tutorNote).where(and(eq(s.tutorNote.verseRef, "Genesis 1:2"), eq(s.tutorNote.studentId, fixture.student.id))); expect(rows.length === 1 && rows[0].mutationId === mutationId).toBe(true);
  // A real missing receipt also permits only the original UUID/body retry.
  const retryPanel = await tools(tab, "Genesis 1:8"), bodies: string[] = [];
  await tab.route("**/work/note", async route => { bodies.push(route.request().postData() ?? ""); if (bodies.length === 1) await route.abort(); else { const response = await route.fetch(); await route.fulfill({ response }); } });
  await safe(() => retryPanel.getByRole("textbox").fill("Synthetic identical retry")); await add(retryPanel); await ui(retryPanel.locator(".work-status")).toHaveText("Save not confirmed. Your text is still in this tab.");
  await safe(() => retryPanel.getByRole("button", { name: "Try again", exact: true }).click());
  await singleRecovery(retryPanel, "Save not confirmed. Your text is still in this tab. It may have saved. Save again to send it once more.");
  await safe(() => retryPanel.getByRole("button", { name: "Save again", exact: true }).click()); await ui(state(retryPanel)).toHaveAttribute("data-work-state", "empty"); expect(bodies.length === 2 && bodies[0] === bodies[1]).toBe(true); await tab.unroute("**/work/note");
  const retryRows = await fixture.ownerDb.select().from(s.tutorNote).where(and(eq(s.tutorNote.verseRef, "Genesis 1:8"), eq(s.tutorNote.studentId, fixture.student.id))); expect(retryRows.length === 1 && (await fixture.ownerDb.select().from(s.auditEvent).where(eq(s.auditEvent.targetId, retryRows[0].id))).length === 1).toBe(true);
});

it("compares newer real head after lost acknowledgement and two-tab CAS contention without clobbering unsent text", async () => {
  const first = await page("admin", true), second = await page("admin"); await staff(first); await staff(second);
  const a = await tools(first, "Genesis 1:3"), b = await tools(second, "Genesis 1:3"); let release!: () => void, committed = false; const gate = new Promise<void>(resolve => { release = resolve; });
  await first.route("**/work/note", async route => { const response = await route.fetch(); committed = response.status() === 200; await gate; await route.fulfill({ response }).catch(() => undefined); });
  await safe(() => a.getByRole("textbox").fill("Synthetic committed earlier")); await add(a); await ui.poll(() => committed).toBe(true);
  expect((await append(second, "Genesis 1:3", "Synthetic newer saved head", 1)).status === 200).toBe(true); await safe(() => a.getByRole("textbox").fill("Synthetic retained queued comparison")); await ui(a.locator(".work-status")).toHaveText("Save not confirmed. Your text is still in this tab.", { timeout: 18_000 });
  release(); await first.unroute("**/work/note"); await safe(() => a.getByRole("button", { name: "Try again", exact: true }).click()); await singleRecovery(a, "An earlier save succeeded. A newer version is saved. Review before saving yours."); await ui(a.getByRole("textbox")).toHaveValue("Synthetic retained queued comparison"); await ui(a.locator(".work-comparison")).toContainText("Synthetic newer saved head"); await capture(first, "conflict-mobile");
  await safe(() => b.getByRole("textbox").fill("Synthetic stale tab text")); await add(b); await singleRecovery(b, "Another version was saved. Review before saving yours."); expect((await head(second, "Genesis 1:3"))?.version === 2).toBe(true);
});

it("never sends a note on its own, validates bytes, pages history exclusively and keeps typed text out of web storage", async () => {
  const tab = await page("admin"); await staff(tab); let requests = 0; await tab.route("**/work/note", async route => { requests++; await route.continue(); });
  const panel = await tools(tab, "Genesis 1:11"), field = panel.getByRole("textbox");
  const warnsBeforeUnload = () => tab.evaluate(() => { const event = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; });
  expect(await warnsBeforeUnload()).toBe(false);
  await safe(() => field.dispatchEvent("compositionstart")); await safe(() => field.fill("Synthetic IME שָׁלוֹם")); await safe(() => tab.waitForTimeout(1000)); expect(requests).toBe(0);
  expect(await warnsBeforeUnload()).toBe(true);
  await safe(() => field.dispatchEvent("compositionend")); await safe(() => field.blur()); await safe(() => tab.waitForTimeout(1000)); expect(requests).toBe(0);
  await add(panel); await ui(state(panel)).toHaveAttribute("data-work-state", "empty"); expect(requests).toBe(1);
  expect(await warnsBeforeUnload()).toBe(false);
  await safe(() => field.fill("😀".repeat(1025))); await ui(panel.getByText("Keep this text within 4,096 UTF-8 bytes.", { exact: true })).toBeVisible(); await ui(panel.getByRole("button", { name: "Add student-visible note", exact: true })).toBeDisabled();
  await safe(() => field.fill("   ")); await ui(panel.getByRole("button", { name: "Add student-visible note", exact: true })).toBeDisabled(); await safe(() => field.fill(""));
  let current = (await head(tab, "Genesis 1:11"))!.version; for (let i = 0; i < 22; i++) { const result = await append(tab, "Genesis 1:11", `Synthetic history ${i}`, current); expect(result.status === 200).toBe(true); current++; }
  await refreshReading(tab); await loaded(tab); const historyPanel = await tools(tab, "Genesis 1:11"); await safe(() => historyPanel.locator(".work-history > summary").click()); await ui(historyPanel.locator(".work-history li")).toHaveCount(20);
  await safe(() => historyPanel.getByRole("button", { name: "Older versions", exact: true }).click()); await ui(historyPanel.locator(".work-history li")).toHaveCount(3);
  // Nothing typed or saved above may touch web storage.
  expect(await tab.evaluate(() => {
    const texts = ["Synthetic", "😀", "שָׁלוֹם"];
    return [localStorage, sessionStorage].flatMap(store => Object.keys(store).map(key => [key, store.getItem(key) ?? ""] as const)).every(([key, value]) => !texts.some(text => key.includes(text) || value.includes(text)));
  })).toBe(true);
});

it("guards controlled leave and quiet retained reading, discards on request, and saves on request", async () => {
  let phase = "initial-departure";
  try {
  const tab = await page("admin"); await staff(tab); const panel = await tools(tab, "Genesis 1:4"), leave = () => tab.getByRole("link", { name: "All students", exact: true });
  await safe(() => panel.getByRole("textbox").fill("Synthetic departure edit")); await closeVerseTools(tab); // the page's links sit behind the sheet; closing it loses no text
  await safe(() => leave().click()); await ui(tab.getByRole("dialog")).toBeVisible(); await ui(tab.getByRole("dialog").getByRole("button", { name: "Keep working", exact: true })).toBeFocused(); await click(tab, "Keep working"); await ui(leave()).toBeFocused(); await tools(tab, "Genesis 1:4"); await ui(panel.getByRole("textbox")).toHaveValue("Synthetic departure edit");
  const staged = await tools(tab, "Genesis 1:4"); await safe(() => staged.getByRole("textbox").fill("Synthetic queued behind metadata barrier"));
  phase = "quiet-session-retention";
  let release!: () => void, held = false; const gate = new Promise<void>(resolve => { release = resolve; }); await tab.route("**/api/session", async route => { const response = await route.fetch(); held = true; await gate; await route.fulfill({ response }).catch(() => undefined); });
  const existingReading = await tab.locator(".study-verses").elementHandle();
  try { await safe(() => tab.evaluate(() => window.dispatchEvent(new Event("focus")))); await ui.poll(() => held).toBe(true); await ui(tab.getByRole("heading", { name: "Checking your access", exact: true })).toBeHidden(); await ui(tab.locator(".study-hebrew").first()).toBeVisible(); expect(await existingReading!.evaluate(node => node === document.querySelector(".study-verses"))).toBe(true); await ui(staged.getByRole("textbox")).toHaveValue("Synthetic queued behind metadata barrier"); }
  finally { release(); await tab.unroute("**/api/session"); await existingReading?.dispose(); }
  await loaded(tab);
  phase = "discard-departure";
  const leaving = await tools(tab, "Genesis 1:4"), discarded = "Synthetic discard before departure";
  // An unfinished composition stays unsent even when the ordinary link click blurs the field.
  await safe(() => leaving.getByRole("textbox").dispatchEvent("compositionstart")); await safe(() => leaving.getByRole("textbox").fill(discarded));
  await closeVerseTools(tab);
  await safe(() => leave().click()); await ui(tab.getByRole("dialog")).toBeVisible(); await click(tab, "Discard unsent edits and continue");
  await ui(tab.getByRole("dialog")).toBeHidden(); await ui.poll(() => new URL(tab.url()).pathname).toBe("/workspace/admin/students");
  expect((await fixture.ownerDb.select().from(s.tutorNote).where(and(eq(s.tutorNote.studentId, fixture.student.id), eq(s.tutorNote.verseRef, "Genesis 1:4"), eq(s.tutorNote.text, discarded)))).length).toBe(0);
  // A fresh access check must keep sign-out available, rather than briefly visiting / and returning to the reading.
  phase = "account-session-check";
  const student = await page("student"); await learner(student); await navigate(student, "/mine"); await accountReady(student);
  const refreshed = student.waitForResponse(response => new URL(response.url()).pathname === "/api/session");
  await safe(() => student.evaluate(() => window.dispatchEvent(new Event("focus")))); expect((await refreshed).status()).toBe(200); await accountReady(student); await captureAccount(student);
  phase = "staff-save-departure";
  const admin = await page("admin"); await staff(admin); const notePanel = await tools(admin, "Genesis 1:7");
  await safe(() => notePanel.getByRole("textbox").fill("Synthetic explicitly saved on departure")); await closeVerseTools(admin); await safe(() => admin.getByRole("link", { name: "All students", exact: true }).click()); await ui(admin.getByRole("dialog")).toBeVisible(); await click(admin, "Save and continue"); await ui.poll(() => new URL(admin.url()).pathname).toBe("/workspace/admin/students");
  expect((await fixture.ownerDb.select().from(s.tutorNote).where(and(eq(s.tutorNote.verseRef, "Genesis 1:7"), eq(s.tutorNote.text, "Synthetic explicitly saved on departure")))).length).toBe(1);
  } catch { throw new Error(`Student work lifecycle fixed phase: ${phase}; private details withheld`); }
});

it("honors a real byte-adaptive work page and preserves original assignment labels through remove and re-add", async () => {
  const student = await page("student"), admin = await page("admin"); await learner(student); await staff(admin);
  const studentBinding = await selection(student, "student"), adminBinding = await selection(admin), expanded = "\\".repeat(4096);
  for (let i = 1; i <= 10; i++) {
    const ref = `Genesis 1:${i}`, noteQuery = new URLSearchParams({ ...adminBinding, assignmentRevision: String(adminBinding.assignmentRevision), offset: String(i - 1) }); const current = await api(admin, `/api/students/${fixture.student.id}/work?${noteQuery}`); let noteVersion = current.data.verses[0].notes[0]?.version ?? 0;
    for (let j = 0; j < 3; j++) { const note = await api(admin, `/api/students/${fixture.student.id}/work/note`, { ...adminBinding, verseRef: ref, text: expanded, expectedVersion: noteVersion, mutationId: randomUUID() }); expect(note.status === 200).toBe(true); noteVersion++; }
  }
  const query = new URLSearchParams({ ...studentBinding, assignmentRevision: String(studentBinding.assignmentRevision), offset: "0" }), first = await api(student, `/api/students/${fixture.student.id}/work?${query}`);
  expect(first.status === 200 && first.data.verses.length > 0 && first.data.verses.length < 10 && first.data.nextOffset === first.data.verses.length).toBe(true);
  await refreshReading(student); await loaded(student); const missingOrdinal = first.data.nextOffset, lazy = await tools(student, `Genesis 1:${missingOrdinal + 1}`); await ui(lazy.locator(".work-notes article")).toHaveCount(3);
  const replace = async (ranges: string[]) => { const prepared = await api(admin, `/api/students/${fixture.student.id}/reading/prepare`, { mode: "admin", ranges }); expect(prepared.status === 200 && prepared.data.status === "prepared").toBe(true); expect((await api(admin, `/api/students/${fixture.student.id}/reading/confirm`, { mode: "admin", binding: prepared.data.binding })).status === 200).toBe(true); };
  await replace(["Genesis 1:11-15"]); await refreshReading(student); await loaded(student, "Genesis 1:11"); const earlier = await tools(student, "Genesis 1:11"); await ui(earlier.locator(".work-notes")).toBeVisible();
  const currentBinding = await selection(student, "student"), historyQuery = new URLSearchParams({ ...currentBinding, assignmentRevision: String(currentBinding.assignmentRevision), stream: "note", verseRef: "Genesis 1:1" }); expect((await api(student, `/api/students/${fixture.student.id}/work/history?${historyQuery}`)).status === 404).toBe(true);
  await replace(["Genesis 1:1-15"]); await refreshReading(student); await loaded(student); const readded = await tools(student); await ui(readded.locator(".work-notes article")).toHaveCount(3); await ui(readded.getByText(/Saved under an earlier assignment \(revision 1\)/).first()).toBeVisible();
});

async function reviseSameVerses(admin: Page) {
  // Cached SDK cookies create a blank page. Establish its loopback origin
  // before using browser-relative API fetches, as the existing staff flow does.
  await staff(admin);
  const prepare = await api(admin, `/api/students/${fixture.student.id}/reading/prepare`, { mode: "admin", ranges: ["Genesis 1:1-15"] }, "revision prepare");
  expect(prepare.status, "revision preparation HTTP status").toBe(200); expect(prepare.data.status === "prepared", "revision preparation fixed state").toBe(true);
  expect((await api(admin, `/api/students/${fixture.student.id}/reading/confirm`, { mode: "admin", binding: prepare.data.binding }, "revision confirm")).status, "revision confirmation HTTP status").toBe(200);
}
async function focusRefresh(tab: Page) {
  // These callers changed the actual assignment revision. Observe the resulting
  // authorized text reload rather than accepting the still-mounted old heading.
  const freshText = tab.waitForResponse(response => new URL(response.url()).pathname.endsWith("/study-text") && response.status() === 200);
  await safe(() => tab.evaluate(() => window.dispatchEvent(new Event("focus")))); await freshText; await loaded(tab);
}

it("retains an unsent note after an assignment-only revision for explicit review", async () => {
  const writer = await page("admin"), admin = await page("admin"); await staff(writer);
  let writes = 0; writer.on("request", request => { if (new URL(request.url()).pathname.endsWith("/work/note") && request.method() === "POST") writes++; });
  let panel = await tools(writer, "Genesis 1:12");
  await safe(() => panel.getByRole("textbox").fill("Synthetic revision-retained note")); await reviseSameVerses(admin); await focusRefresh(writer);
  panel = await tools(writer, "Genesis 1:12"); await ui(panel.getByRole("textbox")).toHaveValue("Synthetic revision-retained note"); await ui(panel.getByRole("textbox")).toHaveJSProperty("readOnly", true);
  await ui(panel.locator(".work-status")).toHaveText("The reading was updated. Review your unsent text before saving."); await capture(writer, "revision-review"); expect(writes).toBe(0);
  await safe(() => panel.getByRole("button", { name: "Review and keep my text", exact: true }).click()); await ui(panel.getByRole("textbox")).toHaveJSProperty("readOnly", false); expect(writes).toBe(0);
  await add(panel); await ui(state(panel)).toHaveAttribute("data-work-state", "empty"); expect(writes).toBe(1); expect((await head(writer, "Genesis 1:12"))?.text).toBe("Synthetic revision-retained note");
});

it("reconciles an old committed save across a revision while preserving later unsent text and using a new save identity", async () => {
  const writer = await page("admin"), admin = await page("admin"); await staff(writer);
  const bodies: { mutationId: string; assignmentRevision: number; expectedVersion: number; text: string }[] = [];
  await writer.route("**/work/note", async route => { bodies.push(route.request().postDataJSON()); if (bodies.length === 1) { const response = await route.fetch(); expect(response.status()).toBe(200); await route.abort("failed"); } else await route.continue(); });
  let panel = await tools(writer, "Genesis 1:13"); await safe(() => panel.getByRole("textbox").fill("Synthetic earlier revision commit")); await add(panel);
  await ui(panel.locator(".work-status")).toHaveText("Save not confirmed. Your text is still in this tab."); await safe(() => panel.getByRole("textbox").fill("Synthetic later revision note")); await reviseSameVerses(admin); await focusRefresh(writer);
  panel = await tools(writer, "Genesis 1:13"); await ui(panel.getByRole("textbox")).toHaveValue("Synthetic later revision note"); await ui(panel.locator(".work-status")).toHaveText("Your earlier save succeeded. Review the saved work and any later unsent text.");
  await ui(panel.locator(".work-comparison .work-text")).toHaveText("Synthetic earlier revision commit"); expect(bodies).toHaveLength(1);
  await safe(() => panel.getByRole("button", { name: "Review and keep my text", exact: true }).click()); expect(bodies).toHaveLength(1); await add(panel); await ui(state(panel)).toHaveAttribute("data-work-state", "empty");
  expect(bodies).toHaveLength(2); expect(bodies[1].mutationId).not.toBe(bodies[0].mutationId); expect(bodies[1].assignmentRevision).toBeGreaterThan(bodies[0].assignmentRevision); expect(bodies[1].expectedVersion).toBe(bodies[0].expectedVersion + 1); expect((await head(writer, "Genesis 1:13"))?.text).toBe("Synthetic later revision note");
  await writer.unroute("**/work/note");
});

it("blocks an uncertain old save through recovery outages until explicit authorized absence and fresh heads", async () => {
  const writer = await page("admin"), admin = await page("admin"); await staff(writer);
  const bodies: { mutationId: string; assignmentRevision: number }[] = [];
  writer.on("request", request => { if (new URL(request.url()).pathname.endsWith("/work/note") && request.method() === "POST") bodies.push(request.postDataJSON()); });
  await writer.route("**/work/note", route => route.abort("failed")); await writer.route("**/work/recovery", route => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "unavailable" }) }));
  let panel = await tools(writer, "Genesis 1:14"); await safe(() => panel.getByRole("textbox").fill("Synthetic unsaved old revision")); await add(panel); await ui(panel.locator(".work-status")).toHaveText("Save not confirmed. Your text is still in this tab.");
  await reviseSameVerses(admin); await focusRefresh(writer); panel = await tools(writer, "Genesis 1:14");
  await ui(panel.getByRole("textbox")).toHaveValue("Synthetic unsaved old revision"); await ui(panel.locator(".work-status")).toHaveText("We couldn’t confirm the earlier save. Your text stays here; check again before saving anything new.");
  expect(await panel.getByRole("button", { name: "Save again", exact: true }).count()).toBe(0); expect(await panel.getByRole("button", { name: "Review and keep my text", exact: true }).count()).toBe(0); await capture(writer, "revision-unknown"); expect(bodies).toHaveLength(1);
  await writer.unroute("**/work/recovery"); await safe(() => panel.getByRole("button", { name: "Try again", exact: true }).click());
  await ui(panel.locator(".work-status")).toHaveText("The earlier save did not complete. Review your unsent text before saving it again."); expect(bodies).toHaveLength(1);
  await writer.unroute("**/work/note"); await safe(() => panel.getByRole("button", { name: "Review and keep my text", exact: true }).click()); await add(panel); await ui(state(panel)).toHaveAttribute("data-work-state", "empty");
  expect(bodies).toHaveLength(2); expect(bodies[1].mutationId).not.toBe(bodies[0].mutationId); expect(bodies[1].assignmentRevision).toBeGreaterThan(bodies[0].assignmentRevision);
});

it("an expired SDK session clears an unsent note without any departure choice", async () => {
  const writer = await page("admin"); await staff(writer); const own = await tools(writer, "Genesis 1:6"); await safe(() => own.getByRole("textbox").fill("Synthetic discarded on expiry"));
  await fixture.ownerDb.update(s.session).set({ expiresAt: new Date(Date.now() - 60_000) }).where(eq(s.session.userId, fixture.admin.id));
  await safe(() => writer.evaluate(() => window.dispatchEvent(new Event("focus")))); await ui(writer.getByRole("heading", { name: "Sign in to continue", exact: true })).toBeVisible(); expect(await writer.locator(".verse-work textarea").count()).toBe(0);
  expect(await fixture.ownerDb.select().from(s.tutorNote).where(eq(s.tutorNote.text, "Synthetic discarded on expiry"))).toHaveLength(0);
});
