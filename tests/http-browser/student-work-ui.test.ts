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
vi.mock("server-only", () => ({}));

let fixture: Awaited<ReturnType<typeof browserFixture>>, browser: Browser, stop: (() => Promise<void>) | undefined, restore: (() => void) | undefined;
let browserEnvironment: Awaited<ReturnType<typeof isolatedEnv>> | undefined;
let sibling: { id: string }, learnerId = "", unavailable = false;
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
async function loaded(tab: Page, ref = "Genesis 1:1") {
  try { await ui(tab.locator(".study-verses").getByRole("heading", { name: ref, level: 4, exact: true })).toBeVisible(); }
  catch {
    const states = await tab.evaluate(() => { const labels = ["Reading unavailable", "Text unavailable", "Checking your access", "Workspace unavailable", "Loading the assigned reading", "Checking the current assignment, text and saved work", "Sign in to continue", "No reading has been assigned yet"]; return labels.filter(label => document.body.innerText.includes(label)); });
    const directory = join(process.cwd(), ".local-logs"); await mkdir(directory, { recursive: true }); await tab.screenshot({ path: join(directory, "student-work-load-failure.png"), fullPage: true }).catch(() => undefined);
    throw new Error(`Assigned reading not visible; HTTP ${httpEvidence.get(tab)?.join(",")}; fixed states ${states.join(",") || "none"}; page error count ${browserErrors.get(tab) ?? 0}`);
  }
}
// A verse's translation and notes are in its verse tools (one Sheet for the selected verse, 1.9 N4): the verse is selected and its sheet opened, as a reader does.
// The sheet is modal, so a test that then uses the page's own controls closes it first (closeVerseTools); the unsent text stays in the tab's work state and is there on reopening.
async function tools(tab: Page, ref = "Genesis 1:1") { const panel = (await openVerseTools(tab, ref)).locator(".verse-work"); if (await panel.getAttribute("open") === null) await safe(() => panel.locator("summary").first().click()); await ui(panel.locator(".verse-work-content")).toBeVisible(); return panel; }
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
async function selection(tab: Page, mode: "student" | "admin" = "student") {
  const reading = await api(tab, `/api/students/${fixture.student.id}/reading?mode=${mode}`); expect(reading.status === 200).toBe(true); const row = reading.data.readings.find((r: { kind: string }) => r.kind === "torah");
  return { mode, kind: "torah", assignmentId: row.id, assignmentRevision: row.revision };
}
async function append(tab: Page, ref: string, text: string, expectedVersion: number) { return api(tab, `/api/students/${fixture.student.id}/work/draft`, { ...await selection(tab), verseRef: ref, text, expectedVersion, mutationId: randomUUID() }); }
async function head(tab: Page, ref: string) { const binding = await selection(tab), ordinal = expandReadingRanges(["Genesis 1:1-15"], "torah", TANAKH_VERSE_COUNTS).indexOf(ref), query = new URLSearchParams({ ...binding, assignmentRevision: String(binding.assignmentRevision), offset: String(ordinal) }); const result = await api(tab, `/api/students/${fixture.student.id}/work?${query}`); expect(result.status === 200).toBe(true); return result.data.verses[0].draft as { version: number; text: string } | null; }
async function capture(tab: Page, name: string) {
  if (process.env.CI) return; const original = tab.viewportSize(), state = name.replace(/-(mobile|desktop)$/, "");
  const directory = join(process.cwd(), ".impeccable", "review"); await mkdir(directory, { recursive: true });
  async function expectedState() {
    await ui(tab.locator(".reading-with-work")).toBeVisible();
    const panel = tab.locator(".study-verse-detail .verse-work[open]"); await ui(panel).toBeVisible();
    if (state === "revision-review" || state === "revision-unknown") {
      await ui(panel.getByRole("textbox")).toHaveJSProperty("readOnly", true);
      await ui(panel.getByRole("region", { name: /Review unsent translation/ })).toBeVisible();
      if (state === "revision-unknown") await ui(panel.getByRole("button", { name: "Check what saved", exact: true })).toBeVisible();
      else await ui(panel.getByRole("button", { name: "Review and keep my text", exact: true })).toBeEnabled();
    } else if (state === "unknown") {
      await ui(panel.locator(".work-status")).toHaveText("Save not confirmed. Your text is still in this tab.");
      await ui(panel.getByRole("button", { name: "Check what saved", exact: true })).toBeVisible();
      await ui(panel.getByRole("button", { name: "Send the same save again", exact: true })).toBeVisible();
      await ui(panel.locator(".work-history > summary")).toBeVisible();
    } else if (state === "conflict") {
      await ui(panel.locator(".work-status")).toHaveText("An earlier save succeeded. A newer version is saved. Review before saving yours.");
      await ui(panel.locator(".work-comparison")).toBeVisible();
    } else if (state === "student-edit") await ui(panel.locator(".work-status")).toHaveText("Saved");
    else if (state === "parent-readonly") await ui(panel.getByText("Saved student translation · Read-only", { exact: true })).toBeVisible();
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
    if (state === "student-edit") {
      await tab.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
      await settleCapture();
      await safe(() => tab.screenshot({ path: join(directory, "work-student-edit-mobile-200pct.png"), fullPage: true }));
      await tab.evaluate(() => { document.documentElement.style.removeProperty("font-size"); });
    }
  } finally { await tab.evaluate(() => { document.documentElement.style.removeProperty("font-size"); }); if (original) await tab.setViewportSize(original); }
}
async function accountReady(tab: Page) {
  await ui(tab.getByRole("heading", { name: "Your account", exact: true })).toBeVisible();
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
    fixture = await browserFixture({ studyLoad: async request => { if (unavailable) throw new StudyUnavailable("upstream"); return syntheticUiStudyPage(request); } }); sibling = (await fixture.practice()).sibling;
    const user = await fixture.signIn("pg-work-student"); learnerId = user.id;
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

it("edits own and assisted translations, preserves Unicode and literal markup, and keeps parent/staff drafts read-only with explicit visible staff notes", async () => {
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
  const panel = await tools(student), field = panel.getByRole("textbox"), text = "Synthetic <img src=x onerror=alert(1)> שָׁלוֹם 😀 e\u0301\n  spaced  ";
  await safe(() => field.fill(text)); await safe(() => panel.getByRole("button", { name: "Save now", exact: true }).click()); await ui(panel.locator(".work-status")).toHaveText("Saved"); expect((await head(student, "Genesis 1:1"))?.text === text).toBe(true); expect(await panel.locator("img").count()).toBe(0);
  await capture(student, "student-edit-mobile");
  const parent = await page("tutor"); await navigate(parent, "/workspace/parent"); await safe(() => parent.getByLabel("Child", { exact: true }).locator(`[data-student-id="${fixture.student.id}"]`).click()); await loaded(parent); const parentPanel = await tools(parent);
  expect(await parentPanel.getByRole("textbox").count()).toBe(0); await ui(parentPanel.getByText(text, { exact: true })).toBeVisible(); await capture(parent, "parent-readonly-desktop");
  await click(parent, "Practice with Synthetic"); await loaded(parent); const childPanel = await tools(parent); await safe(() => childPanel.getByRole("textbox").fill("Synthetic assisted reading")); await safe(() => childPanel.getByRole("button", { name: "Save now", exact: true }).click()); await ui(childPanel.locator(".work-status")).toHaveText("Saved");
  await safe(() => childPanel.getByRole("button", { name: "Notes from your teachers", exact: true }).click()); expect(await childPanel.getByRole("textbox").count()).toBe(0); expect(await childPanel.getByRole("button", { name: "Add student-visible note", exact: true }).count()).toBe(0);
  const admin = await page("admin"); await staff(admin); const adminPanel = await tools(admin); expect(await adminPanel.getByRole("textbox").count()).toBe(0); await ui(adminPanel.getByText("Synthetic assisted reading", { exact: true })).toBeVisible(); await ui(adminPanel.getByText(/Assisted child practice/)).toBeVisible();
  await safe(() => adminPanel.getByRole("button", { name: "Teacher notes", exact: true }).click()); await safe(() => adminPanel.getByRole("textbox").fill("Synthetic teacher note <strong>literal</strong>")); expect(await fixture.ownerDb.select().from(s.tutorNote)).toHaveLength(0);
  await capture(admin, "staff-visible-note-desktop"); await safe(() => adminPanel.getByRole("button", { name: "Add student-visible note", exact: true }).click()); await ui(adminPanel.getByText("Synthetic teacher note <strong>literal</strong>", { exact: true })).toBeVisible();
  const tutor = await page("tutor"); await navigate(tutor, "/workspace/tutor"); await safe(() => tutor.getByLabel("Student", { exact: true }).locator(`[data-student-id="${fixture.student.id}"]`).click()); await loaded(tutor); const tutorPanel = await tools(tutor);
  expect(await tutorPanel.getByRole("textbox").count()).toBe(0); await safe(() => tutorPanel.getByRole("button", { name: "Teacher notes", exact: true }).click()); await safe(() => tutorPanel.getByRole("textbox").fill("Synthetic assigned tutor note")); await safe(() => tutorPanel.getByRole("button", { name: "Add student-visible note", exact: true }).click()); await ui(tutorPanel.getByText("Synthetic assigned tutor note", { exact: true })).toBeVisible();
  await click(student, "Refresh reading"); await loaded(student); const refreshed = await tools(student); await safe(() => refreshed.getByRole("button", { name: "Notes from your teachers", exact: true }).click());
  for (const text of ["Synthetic teacher note <strong>literal</strong>", "Synthetic assigned tutor note"]) {
    const note = refreshed.locator(".work-notes article").filter({ hasText: text }); await ui(note.getByText(text, { exact: true })).toBeVisible(); await ui(note.getByText("Portal member", { exact: true })).toBeVisible();
  }
});

it("holds one real committed POST acknowledgement, queues typing and recovers exactly one PG version/audit by receipt", async () => {
  const tab = await page("student"); await learner(tab); const panel = await tools(tab, "Genesis 1:2"), field = panel.getByRole("textbox");
  let release!: () => void, committed = false, calls = 0, mutationId = ""; const gate = new Promise<void>(resolve => { release = resolve; });
  await tab.route("**/work/draft", async route => { calls++; mutationId = route.request().postDataJSON().mutationId; const response = await route.fetch(); committed = response.status() === 200; await gate; await route.fulfill({ response }).catch(() => undefined); });
  await safe(() => field.fill("Synthetic lost acknowledgement")); await safe(() => panel.getByRole("button", { name: "Save now", exact: true }).click()); await ui.poll(() => committed).toBe(true);
  await safe(() => field.fill("Synthetic latest queued edit")); await ui(panel.locator(".work-status")).toHaveText("Save not confirmed. Your text is still in this tab.", { timeout: 18_000 });
  await singleRecovery(panel, "Save not confirmed. Your text is still in this tab.");
  expect(calls).toBe(1); const [row] = await fixture.ownerDb.select().from(s.translationDraft).where(eq(s.translationDraft.mutationId, mutationId)); expect(row.version === 1 && row.text === "Synthetic lost acknowledgement").toBe(true);
  expect((await fixture.ownerDb.select().from(s.auditEvent).where(eq(s.auditEvent.targetId, row.id))).length).toBe(1); await capture(tab, "unknown-desktop");
  release(); await tab.unroute("**/work/draft"); await safe(() => panel.getByRole("button", { name: "Check what saved", exact: true }).click()); await ui(field).toHaveValue("Synthetic latest queued edit"); await ui(panel.locator(".work-status")).toHaveText("Saved", { timeout: 18_000 });
  const rows = await fixture.ownerDb.select().from(s.translationDraft).where(and(eq(s.translationDraft.verseRef, "Genesis 1:2"), eq(s.translationDraft.studentId, fixture.student.id))); expect(rows.length === 2 && rows.filter(row => row.mutationId === mutationId).length === 1).toBe(true);
  // A real missing receipt also permits only the original UUID/body retry.
  const retryPanel = await tools(tab, "Genesis 1:8"), bodies: string[] = [];
  await tab.route("**/work/draft", async route => { bodies.push(route.request().postData() ?? ""); if (bodies.length === 1) await route.abort(); else { const response = await route.fetch(); await route.fulfill({ response }); } });
  await safe(() => retryPanel.getByRole("textbox").fill("Synthetic identical retry")); await safe(() => retryPanel.getByRole("button", { name: "Save now", exact: true }).click()); await ui(retryPanel.locator(".work-status")).toHaveText("Save not confirmed. Your text is still in this tab.");
  await safe(() => retryPanel.getByRole("button", { name: "Check what saved", exact: true }).click());
  await singleRecovery(retryPanel, "Save not confirmed. Your text is still in this tab. No receipt was found; the request may still have saved. You can retry the same save under this assignment.");
  await safe(() => retryPanel.getByRole("button", { name: "Send the same save again", exact: true }).click()); await ui(retryPanel.locator(".work-status")).toHaveText("Saved"); expect(bodies.length === 2 && bodies[0] === bodies[1]).toBe(true); await tab.unroute("**/work/draft");
  const retryRows = await fixture.ownerDb.select().from(s.translationDraft).where(and(eq(s.translationDraft.verseRef, "Genesis 1:8"), eq(s.translationDraft.studentId, fixture.student.id))); expect(retryRows.length === 1 && (await fixture.ownerDb.select().from(s.auditEvent).where(eq(s.auditEvent.targetId, retryRows[0].id))).length === 1).toBe(true);
});

it("compares newer real head after lost acknowledgement and two-tab CAS contention without clobbering unsent text", async () => {
  const first = await page("student", true), second = await page("student"); await learner(first); await learner(second);
  const a = await tools(first, "Genesis 1:3"), b = await tools(second, "Genesis 1:3"); let release!: () => void, committed = false; const gate = new Promise<void>(resolve => { release = resolve; });
  await first.route("**/work/draft", async route => { const response = await route.fetch(); committed = response.status() === 200; await gate; await route.fulfill({ response }).catch(() => undefined); });
  await safe(() => a.getByRole("textbox").fill("Synthetic committed earlier")); await safe(() => a.getByRole("button", { name: "Save now", exact: true }).click()); await ui.poll(() => committed).toBe(true);
  expect((await append(second, "Genesis 1:3", "Synthetic newer saved head", 1)).status === 200).toBe(true); await safe(() => a.getByRole("textbox").fill("Synthetic retained queued comparison")); await ui(a.locator(".work-status")).toHaveText("Save not confirmed. Your text is still in this tab.", { timeout: 18_000 });
  release(); await first.unroute("**/work/draft"); await safe(() => a.getByRole("button", { name: "Check what saved", exact: true }).click()); await singleRecovery(a, "An earlier save succeeded. A newer version is saved. Review before saving yours."); await ui(a.getByRole("textbox")).toHaveValue("Synthetic retained queued comparison"); await ui(a.locator(".work-comparison")).toContainText("Synthetic newer saved head"); await capture(first, "conflict-mobile");
  await safe(() => b.getByRole("textbox").fill("Synthetic stale tab text")); await safe(() => b.getByRole("button", { name: "Save now", exact: true }).click()); await singleRecovery(b, "Another version was saved. Review before saving yours."); expect((await head(second, "Genesis 1:3"))?.version === 2).toBe(true);
});

it("supports composition and byte validation, clear without repeated empty versions, adaptive lazy pages and exclusive history", async () => {
  const tab = await page("student"); await learner(tab); let requests = 0; await tab.route("**/work/draft", async route => { requests++; await route.continue(); });
  const panel = await tools(tab, "Genesis 1:11"), field = panel.getByRole("textbox");
  const warnsBeforeUnload = () => tab.evaluate(() => { const event = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; });
  expect(await warnsBeforeUnload()).toBe(false);
  await safe(() => field.dispatchEvent("compositionstart")); await safe(() => field.fill("Synthetic IME שָׁלוֹם")); await safe(() => tab.waitForTimeout(1000)); expect(requests).toBe(0);
  expect(await warnsBeforeUnload()).toBe(true);
  await safe(() => field.dispatchEvent("compositionend")); await ui(panel.locator(".work-status")).toHaveText("Saved"); expect(requests).toBe(1);
  expect(await warnsBeforeUnload()).toBe(false);
  await safe(() => field.fill("😀".repeat(1025))); await ui(panel.getByText("Keep this text within 4,096 UTF-8 bytes.", { exact: true })).toBeVisible(); await ui(panel.getByRole("button", { name: "Save now", exact: true })).toBeDisabled();
  await safe(() => field.fill("")); await safe(() => panel.getByRole("button", { name: "Save now", exact: true }).click()); await ui(panel.locator(".work-status")).toHaveText("Translation cleared · Saved"); const before = requests; await safe(() => field.blur()); await safe(() => tab.waitForTimeout(1000)); expect(requests).toBe(before);
  let current = (await head(tab, "Genesis 1:11"))!.version; for (let i = 0; i < 22; i++) { const result = await append(tab, "Genesis 1:11", `Synthetic history ${i}`, current); expect(result.status === 200).toBe(true); current++; }
  await click(tab, "Refresh reading"); await loaded(tab); const historyPanel = await tools(tab, "Genesis 1:11"); await safe(() => historyPanel.locator(".work-history > summary").click()); await ui(historyPanel.locator(".work-history li")).toHaveCount(20);
  await safe(() => historyPanel.getByRole("button", { name: "Older versions", exact: true }).click()); await ui(historyPanel.locator(".work-history li")).toHaveCount(4);
  // The student workspace app bar hosts Learn to lein, whose device-only progress and sync outline (lesson ids, review boxes and dates, no student text) is the one
  // thing it may keep in this browser; everything the student wrote, saved or cleared above must still never touch web storage.
  expect(await tab.evaluate(() => {
    const own = new Set(["crc-torah:learn-progress/v1", "crc-torah:learn-sync/v1"]), texts = ["Synthetic", "😀", "שָׁלוֹם"];
    const entries = [localStorage, sessionStorage].flatMap(store => Object.keys(store).map(key => [store === localStorage && own.has(key), key, store.getItem(key) ?? ""] as const));
    return sessionStorage.length === 0 && entries.every(([allowed, key, value]) => allowed && !texts.some(text => key.includes(text) || value.includes(text)));
  })).toBe(true);
});

it("guards controlled leave, explicit reload barriers and quiet retained reading through text outage", async () => {
  let phase = "initial-departure";
  try {
  const tab = await page("student"); await learner(tab); const panel = await tools(tab, "Genesis 1:4");
  await safe(() => panel.getByRole("textbox").fill("Synthetic departure edit")); await closeVerseTools(tab); // the page's links sit behind the sheet; closing it loses no text
  await safe(() => tab.getByRole("link", { name: "Account and sign out", exact: true }).click()); await ui(tab.getByRole("dialog")).toBeVisible(); await ui(tab.getByRole("dialog").getByRole("button", { name: "Keep working", exact: true })).toBeFocused(); await click(tab, "Keep working"); await ui(tab.getByRole("link", { name: "Account and sign out", exact: true })).toBeFocused(); await tools(tab, "Genesis 1:4"); await ui(panel.getByRole("textbox")).toHaveValue("Synthetic departure edit");
  phase = "explicit-text-outage";
  // Pause before debounce, then verify all three independent reads hold the reveal barrier.
  // Dispatch only these deliberate reloads without moving focus: a real pointer
  // click blurs/saves the textarea before the barrier (covered by other cases).
  await safe(() => panel.getByRole("textbox").fill("Synthetic retained during text outage")); unavailable = true; phase = "outage-refresh-click"; await safe(() => tab.getByRole("button", { name: "Refresh reading", exact: true }).dispatchEvent("click"));
  phase = "outage-heading"; await ui(tab.getByRole("heading", { name: "Text unavailable", exact: true })).toBeVisible(); unavailable = false; phase = "outage-retained-draft"; await ui(tab.locator(".verse-work textarea")).toHaveValue("Synthetic retained during text outage");
  const outageSave = tab.locator(".verse-work").getByRole("button", { name: "Save now", exact: true });
  phase = "outage-save";
  await safe(() => outageSave.click()); phase = "outage-saved"; await ui(tab.locator(".verse-work .work-status")).toHaveText("Saved");
  phase = "outage-reload"; await click(tab, "Reload assigned text"); await loaded(tab); await tools(tab, "Genesis 1:4");
  phase = "held-text-barrier";
  // Work can finish first, but a held text response still prevents queued writes.
  let releaseText!: () => void, textHeld = false, workRead = false, writeCount = 0; const textGate = new Promise<void>(resolve => { releaseText = resolve; });
  await tab.route("**/work/draft", async route => { writeCount++; await route.continue(); });
  await tab.route("**/work?**", async route => { const response = await route.fetch(); workRead = true; await route.fulfill({ response }); });
  await tab.route("**/study-text?**", async route => { const response = await route.fetch(); textHeld = true; await textGate; await route.fulfill({ response }).catch(() => undefined); });
  const staged = await tools(tab, "Genesis 1:4"); await safe(() => staged.getByRole("textbox").fill("Synthetic queued behind text barrier")); await safe(() => tab.getByRole("button", { name: "Refresh reading", exact: true }).dispatchEvent("click"));
  await ui.poll(() => textHeld && workRead).toBe(true); await safe(() => tab.waitForTimeout(1100)); expect(writeCount).toBe(0); await ui(tab.locator(".study-hebrew").first()).toBeHidden();
  releaseText(); await tab.unroute("**/study-text?**"); await tab.unroute("**/work?**"); await loaded(tab); await ui(staged.locator(".work-status")).toHaveText("Saved"); await tab.unroute("**/work/draft");
  phase = "held-metadata-barrier";
  // The same pause applies while assignment metadata has not yet returned.
  let releaseMetadata!: () => void, metadataHeld = false; const metadataGate = new Promise<void>(resolve => { releaseMetadata = resolve; }); writeCount = 0;
  await tab.route("**/work/draft", async route => { writeCount++; await route.continue(); });
  await tab.route("**/reading?**", async route => { const response = await route.fetch(); metadataHeld = true; await metadataGate; await route.fulfill({ response }).catch(() => undefined); });
  await safe(() => staged.getByRole("textbox").fill("Synthetic queued behind metadata barrier")); await safe(() => tab.getByRole("button", { name: "Refresh reading", exact: true }).dispatchEvent("click")); await ui.poll(() => metadataHeld).toBe(true); await safe(() => tab.waitForTimeout(1100)); expect(writeCount).toBe(0);
  releaseMetadata(); await tab.unroute("**/reading?**"); await loaded(tab); await ui(staged.locator(".work-status")).toHaveText("Saved"); await tab.unroute("**/work/draft");
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
  await safe(() => tab.getByRole("link", { name: "Account and sign out", exact: true }).click()); await ui(tab.getByRole("dialog")).toBeVisible(); await click(tab, "Discard unsent edits and continue");
  await ui(tab.getByRole("dialog")).toBeHidden(); await accountReady(tab);
  // A fresh access check must keep sign-out available, rather than briefly visiting / and returning to the reading.
  phase = "account-session-check";
  const refreshed = tab.waitForResponse(response => new URL(response.url()).pathname === "/api/session");
  await safe(() => tab.evaluate(() => window.dispatchEvent(new Event("focus")))); expect((await refreshed).status()).toBe(200); await accountReady(tab); await captureAccount(tab);
  expect((await fixture.ownerDb.select().from(s.translationDraft).where(and(eq(s.translationDraft.studentId, fixture.student.id), eq(s.translationDraft.verseRef, "Genesis 1:4"), eq(s.translationDraft.text, discarded)))).length).toBe(0);
  phase = "staff-save-departure";
  const admin = await page("admin"); await staff(admin); const notePanel = await tools(admin, "Genesis 1:7"); await safe(() => notePanel.getByRole("button", { name: "Teacher notes", exact: true }).click());
  await safe(() => notePanel.getByRole("textbox").fill("Synthetic explicitly saved on departure")); await closeVerseTools(admin); await safe(() => admin.getByRole("link", { name: "All students", exact: true }).click()); await ui(admin.getByRole("dialog")).toBeVisible(); await click(admin, "Save and continue"); await ui.poll(() => new URL(admin.url()).pathname).toBe("/workspace/admin/students");
  expect((await fixture.ownerDb.select().from(s.tutorNote).where(and(eq(s.tutorNote.verseRef, "Genesis 1:7"), eq(s.tutorNote.text, "Synthetic explicitly saved on departure")))).length).toBe(1);
  } catch { throw new Error(`Student work lifecycle fixed phase: ${phase}; private details withheld`); }
});

it("honors a real byte-adaptive work page and preserves original assignment labels through remove and re-add", async () => {
  const student = await page("student"), admin = await page("admin"); await learner(student); await staff(admin);
  const studentBinding = await selection(student), adminBinding = await selection(admin, "admin"), expanded = "\\".repeat(4096);
  for (let i = 1; i <= 10; i++) {
    const ref = `Genesis 1:${i}`, latest = await head(student, ref); expect((await append(student, ref, expanded, latest?.version ?? 0)).status === 200).toBe(true);
    const noteQuery = new URLSearchParams({ ...adminBinding, assignmentRevision: String(adminBinding.assignmentRevision), offset: String(i - 1) }); const current = await api(admin, `/api/students/${fixture.student.id}/work?${noteQuery}`); let noteVersion = current.data.verses[0].notes[0]?.version ?? 0;
    for (let j = 0; j < 3; j++) { const note = await api(admin, `/api/students/${fixture.student.id}/work/note`, { ...adminBinding, verseRef: ref, text: expanded, expectedVersion: noteVersion, mutationId: randomUUID() }); expect(note.status === 200).toBe(true); noteVersion++; }
  }
  const query = new URLSearchParams({ ...studentBinding, assignmentRevision: String(studentBinding.assignmentRevision), offset: "0" }), first = await api(student, `/api/students/${fixture.student.id}/work?${query}`);
  expect(first.status === 200 && first.data.verses.length > 0 && first.data.verses.length < 10 && first.data.nextOffset === first.data.verses.length).toBe(true);
  await click(student, "Refresh reading"); await loaded(student); const missingOrdinal = first.data.nextOffset, lazy = await tools(student, `Genesis 1:${missingOrdinal + 1}`); await ui(lazy.getByRole("textbox")).toHaveValue(expanded);
  const replace = async (ranges: string[]) => { const prepared = await api(admin, `/api/students/${fixture.student.id}/reading/prepare`, { mode: "admin", ranges }); expect(prepared.status === 200 && prepared.data.status === "prepared").toBe(true); expect((await api(admin, `/api/students/${fixture.student.id}/reading/confirm`, { mode: "admin", binding: prepared.data.binding })).status === 200).toBe(true); };
  await replace(["Genesis 1:11-15"]); await click(student, "Refresh reading"); await loaded(student, "Genesis 1:11"); const earlier = await tools(student, "Genesis 1:11"); await ui(earlier.getByText(/Saved under an earlier assignment \(revision 1\)/)).toBeVisible();
  const currentBinding = await selection(student), historyQuery = new URLSearchParams({ ...currentBinding, assignmentRevision: String(currentBinding.assignmentRevision), stream: "draft", verseRef: "Genesis 1:1" }); expect((await api(student, `/api/students/${fixture.student.id}/work/history?${historyQuery}`)).status === 404).toBe(true);
  await replace(["Genesis 1:1-15"]); await click(student, "Refresh reading"); await loaded(student); const readded = await tools(student); await ui(readded.getByRole("textbox")).toHaveValue(expanded); await ui(readded.getByText(/Saved under an earlier assignment \(revision 1\)/)).toBeVisible();
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

it("retains unsent text after an assignment-only revision for explicit review without autosave", async () => {
  const student = await page("student"), admin = await page("admin"); await learner(student);
  let writes = 0; student.on("request", request => { if (new URL(request.url()).pathname.endsWith("/work/draft") && request.method() === "POST") writes++; });
  let panel = await tools(student, "Genesis 1:12");
  // An active composition gives a real unsent draft without racing debounce.
  await safe(() => panel.getByRole("textbox").evaluate(field => field.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }))));
  await safe(() => panel.getByRole("textbox").fill("Synthetic revision-retained translation")); await reviseSameVerses(admin); await focusRefresh(student);
  panel = await tools(student, "Genesis 1:12"); await ui(panel.getByRole("textbox")).toHaveValue("Synthetic revision-retained translation"); await ui(panel.getByRole("textbox")).toHaveJSProperty("readOnly", true);
  await ui(panel.locator(".work-status")).toHaveText("The reading was updated. Review your unsent text before saving."); await capture(student, "revision-review"); expect(writes).toBe(0);
  await safe(() => panel.getByRole("button", { name: "Review and keep my text", exact: true }).click()); await ui(panel.getByRole("textbox")).toHaveJSProperty("readOnly", false); expect(writes).toBe(0);
  await safe(() => panel.getByRole("button", { name: "Save now", exact: true }).click()); await ui(panel.locator(".work-status")).toHaveText("Saved"); expect(writes).toBe(1); expect((await head(student, "Genesis 1:12"))?.text).toBe("Synthetic revision-retained translation");
});

it("reconciles an old committed save across a revision while preserving later unsent text and using a new save identity", async () => {
  const student = await page("student"), admin = await page("admin"); await learner(student);
  const bodies: { mutationId: string; assignmentRevision: number; expectedVersion: number; text: string }[] = [];
  await student.route("**/work/draft", async route => { bodies.push(route.request().postDataJSON()); if (bodies.length === 1) { const response = await route.fetch(); expect(response.status()).toBe(200); await route.abort("failed"); } else await route.continue(); });
  let panel = await tools(student, "Genesis 1:13"); await safe(() => panel.getByRole("textbox").fill("Synthetic earlier revision commit")); await safe(() => panel.getByRole("button", { name: "Save now", exact: true }).click());
  await ui(panel.locator(".work-status")).toHaveText("Save not confirmed. Your text is still in this tab."); await safe(() => panel.getByRole("textbox").fill("Synthetic later revision draft")); await reviseSameVerses(admin); await focusRefresh(student);
  panel = await tools(student, "Genesis 1:13"); await ui(panel.getByRole("textbox")).toHaveValue("Synthetic later revision draft"); await ui(panel.locator(".work-status")).toHaveText("Your earlier save succeeded. Review the saved work and any later unsent text.");
  await ui(panel.locator(".work-comparison .work-text")).toHaveText("Synthetic earlier revision commit"); expect(bodies).toHaveLength(1);
  await safe(() => panel.getByRole("button", { name: "Review and keep my text", exact: true }).click()); expect(bodies).toHaveLength(1); await safe(() => panel.getByRole("button", { name: "Save now", exact: true }).click()); await ui(panel.locator(".work-status")).toHaveText("Saved");
  expect(bodies).toHaveLength(2); expect(bodies[1].mutationId).not.toBe(bodies[0].mutationId); expect(bodies[1].assignmentRevision).toBeGreaterThan(bodies[0].assignmentRevision); expect(bodies[1].expectedVersion).toBe(bodies[0].expectedVersion + 1); expect((await head(student, "Genesis 1:13"))?.text).toBe("Synthetic later revision draft");
  await student.unroute("**/work/draft");
});

it("blocks an uncertain old save through recovery outages until explicit authorized absence and fresh heads", async () => {
  const student = await page("student"), admin = await page("admin"); await learner(student);
  const bodies: { mutationId: string; assignmentRevision: number }[] = [];
  student.on("request", request => { if (new URL(request.url()).pathname.endsWith("/work/draft") && request.method() === "POST") bodies.push(request.postDataJSON()); });
  await student.route("**/work/draft", route => route.abort("failed")); await student.route("**/work/recovery", route => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "unavailable" }) }));
  let panel = await tools(student, "Genesis 1:14"); await safe(() => panel.getByRole("textbox").fill("Synthetic unsaved old revision")); await safe(() => panel.getByRole("button", { name: "Save now", exact: true }).click()); await ui(panel.locator(".work-status")).toHaveText("Save not confirmed. Your text is still in this tab.");
  await reviseSameVerses(admin); await focusRefresh(student); panel = await tools(student, "Genesis 1:14");
  await ui(panel.getByRole("textbox")).toHaveValue("Synthetic unsaved old revision"); await ui(panel.locator(".work-status")).toHaveText("We couldn’t confirm the earlier save. Your text stays here; check again before saving anything new.");
  expect(await panel.getByRole("button", { name: "Send the same save again", exact: true }).count()).toBe(0); expect(await panel.getByRole("button", { name: "Review and keep my text", exact: true }).count()).toBe(0); await capture(student, "revision-unknown"); expect(bodies).toHaveLength(1);
  await student.unroute("**/work/recovery"); await safe(() => panel.getByRole("button", { name: "Check what saved", exact: true }).click());
  await ui(panel.locator(".work-status")).toHaveText("The earlier save did not complete. Review your unsent text before saving it again."); expect(bodies).toHaveLength(1);
  await student.unroute("**/work/draft"); await safe(() => panel.getByRole("button", { name: "Review and keep my text", exact: true }).click()); await safe(() => panel.getByRole("button", { name: "Save now", exact: true }).click()); await ui(panel.locator(".work-status")).toHaveText("Saved");
  expect(bodies).toHaveLength(2); expect(bodies[1].mutationId).not.toBe(bodies[0].mutationId); expect(bodies[1].assignmentRevision).toBeGreaterThan(bodies[0].assignmentRevision);
});

it("clears old child work on forced revocation and fences an actual committed late reply across context loss", async () => {
  const parent = await page("tutor"); await navigate(parent, "/workspace/parent"); await safe(() => parent.getByLabel("Child", { exact: true }).locator(`[data-student-id="${fixture.student.id}"]`).click()); await loaded(parent); await click(parent, "Practice with Synthetic"); await loaded(parent);
  let releaseUnknown!: () => void, committedUnknown = false; const unknownGate = new Promise<void>(resolve => { releaseUnknown = resolve; }), bodies: { child: string; text: string }[] = [];
  await parent.route("**/work/draft", async route => { bodies.push({ child: new URL(route.request().url()).pathname.split("/")[3], text: route.request().postDataJSON().text }); const response = await route.fetch(); committedUnknown = response.status() === 200; await unknownGate; await route.fulfill({ response }).catch(() => undefined); });
  const uncertain = await tools(parent, "Genesis 1:9"); await safe(() => uncertain.getByRole("textbox").fill("Synthetic original child uncertain save")); await safe(() => uncertain.getByRole("button", { name: "Save now", exact: true }).click()); await ui.poll(() => committedUnknown).toBe(true); await safe(() => uncertain.getByRole("textbox").fill("Synthetic old child queue must not post"));
  await ui(uncertain.locator(".work-status")).toHaveText("Save not confirmed. Your text is still in this tab.", { timeout: 18_000 }); await click(parent, "Switch to Synthetic Sibling"); await ui(parent.getByRole("dialog")).toBeVisible(); await click(parent, "Leave without confirming"); await loaded(parent, "Genesis 2:1"); releaseUnknown(); await parent.unroute("**/work/draft");
  expect(bodies.length === 1 && bodies[0].child === fixture.student.id && !bodies.some(row => row.text === "Synthetic old child queue must not post")).toBe(true); expect((await fixture.ownerDb.select().from(s.translationDraft).where(eq(s.translationDraft.studentId, sibling.id))).length).toBe(0);
  await click(parent, "Switch to Synthetic Learner"); await loaded(parent); const panel = await tools(parent, "Genesis 1:5");
  let release!: () => void, held = false; const gate = new Promise<void>(resolve => { release = resolve; }); await parent.route("**/work/draft", async route => { const response = await route.fetch(); held = response.status() === 200; await gate; await route.fulfill({ response }).catch(() => undefined); });
  await safe(() => panel.getByRole("textbox").fill("Synthetic context-fenced write")); await safe(() => panel.getByRole("button", { name: "Save now", exact: true }).click()); await ui.poll(() => held).toBe(true);
  await fixture.ownerDb.update(s.guardian).set({ revokedAt: new Date() }).where(and(eq(s.guardian.studentId, fixture.student.id), eq(s.guardian.parentGrantId, (await fixture.ownerDb.select().from(s.roleGrant).where(and(eq(s.roleGrant.membershipId, (await fixture.ownerDb.select().from(s.membership).where(eq(s.membership.userId, fixture.tutor.id)))[0].id), eq(s.roleGrant.role, "parent"))))[0].id)));
  await safe(() => parent.evaluate(() => window.dispatchEvent(new Event("focus")))); await ui.poll(() => new URL(parent.url()).pathname).toBe("/workspace/parent"); await ui(parent.getByLabel("Child", { exact: true })).toBeVisible(); await ui(parent.getByText("Practice access changed. Choose an available child again.", { exact: true })).toBeVisible(); expect(await parent.locator(".verse-work textarea").count()).toBe(0); release(); await parent.unroute("**/work/draft"); expect(await parent.getByText("Synthetic context-fenced write", { exact: true }).count()).toBe(0);
  // An expired SDK session bypasses every local departure choice.
  const student = await page("student"); await learner(student); const own = await tools(student, "Genesis 1:6"); await safe(() => own.getByRole("textbox").fill("Synthetic discarded on expiry")); await fixture.ownerDb.update(s.session).set({ expiresAt: new Date(Date.now() - 60_000) }).where(eq(s.session.userId, learnerId));
  await safe(() => student.evaluate(() => window.dispatchEvent(new Event("focus")))); await ui(student.getByRole("heading", { name: "Sign in to continue", exact: true })).toBeVisible(); expect(await student.locator(".verse-work textarea").count()).toBe(0);
});
