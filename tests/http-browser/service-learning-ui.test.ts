import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { expect as ui } from "@playwright/test";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { isolatedEnv } from "../helpers/isolatedEnv.mjs";
import { browserFixture } from "./fixture";
import { BROWSER_ORIGIN, assertBrowserStartupAllowed, startBrowserServer } from "./server";
import { installLoopbackFetchGuard } from "./egress";
import { openAuthMail } from "./auth-navigation";
import { syntheticServiceCatalog } from "../helpers/service-learning";
import { syntheticUiStudyPage } from "../helpers/study-ui";
import { StudyUnavailable } from "../../src/server/study/types";
import * as s from "../../src/server/db/index";
vi.mock("server-only", () => ({}));

let fixture: Awaited<ReturnType<typeof browserFixture>>, browser: Browser, stop: (() => Promise<void>) | undefined, restore: (() => void) | undefined;
let isolation: Awaited<ReturnType<typeof isolatedEnv>> | undefined, sibling: { id: string }, content: ReturnType<typeof syntheticServiceCatalog>, catalogId: string, scriptureUnavailable = false;
const contexts: BrowserContext[] = [], cookies = new Map<string, Awaited<ReturnType<BrowserContext["cookies"]>>>();
const safe = async <T>(action: () => Promise<T>): Promise<T> => { try { return await action(); } catch { throw new Error("Service UI browser operation failed; private details withheld"); } };
const panel = (tab: Page) => tab.locator(".service-learning-panel");
async function click(tab: Page, name: string) { await safe(() => tab.getByRole("button", { name, exact: true }).click()); }
async function api(tab: Page, studentId: string, action = "", body?: unknown) {
  return safe(() => tab.evaluate(async ({ path, body }) => { const response = await fetch(path, { method: body === undefined ? "GET" : "POST", cache: "no-store", headers: body === undefined ? {} : { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: response.status, data: await response.json() }; }, { path: `/api/students/${studentId}/service-plan${action}`, body }));
}
async function page(role: "admin" | "tutor" | "student", mobile = false) {
  const context = await browser.newContext({ baseURL: BROWSER_ORIGIN, serviceWorkers: "block", acceptDownloads: false, viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 } }); contexts.push(context);
  await context.route("**/*", async route => { try { if (new URL(route.request().url()).origin === BROWSER_ORIGIN) await route.continue(); else await route.abort(); } catch { await route.abort(); } });
  const saved = cookies.get(role); if (saved) await context.addCookies(saved);
  const tab = await context.newPage(); await safe(() => tab.goto("/", { waitUntil: "domcontentloaded" }));
  if (!saved) {
    const email = role === "admin" ? "pg-admin@example.test" : role === "tutor" ? "pg-tutor@example.test" : "pg-service-student@example.test";
    await safe(() => tab.evaluate(async email => { const response = await fetch("/api/auth/sign-in/magic-link", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) }); if (response.status !== 200) throw new Error("Synthetic sign-in unavailable"); }, email));
    await openAuthMail(tab, fixture.takeMail(email)); cookies.set(role, await context.cookies());
  }
  return tab;
}
async function workspace(tab: Page, role: "admin" | "tutor" | "student" | "parent") {
  await safe(() => tab.goto(role === "admin" ? `/workspace/admin/students/${fixture.student.id}/reading` : `/workspace/${role}`, { waitUntil: "domcontentloaded" }));
  if (role === "tutor" || role === "parent") await safe(() => tab.getByLabel(role === "parent" ? "Child" : "Student", { exact: true }).locator(`[data-student-id="${fixture.student.id}"]`).click());
  // Staff reach service parts through the tab beside the reading.
  if (role === "tutor" || role === "admin") await safe(() => tab.getByRole("tab", { name: "Service parts", exact: true }).click());
  await ui(panel(tab).getByRole("heading", { name: "Service parts", exact: true })).toBeVisible();
  await ui(panel(tab).getByText("Checking assigned service parts…", { exact: true })).toBeHidden();
}
async function assign(tab: Page, studentId: string, selectedIds: string[]) {
  const current = await api(tab, studentId, "/catalog", { mode: "admin" }); expect(current.status).toBe(200);
  const prepared = await api(tab, studentId, "/prepare", { mode: "admin", expectedStudentRevision: current.data.studentRevision, expectedPlanRevision: current.data.expectedPlanRevision, catalogId: current.data.catalogId, catalogIdentity: current.data.catalogIdentity, selectedIds });
  expect(prepared.status).toBe(200);
  expect((await api(tab, studentId, "/confirm", { mode: "admin", binding: prepared.data.binding })).status).toBe(200);
}
async function firstHebrew(tab: Page) {
  await safe(() => tab.evaluate(async () => { await document.fonts.ready; scrollTo(0, 0); await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); }));
  const geometry = await tab.locator(".assigned-study .study-hebrew > span").first().evaluate(span => { const range = document.createRange(); range.selectNodeContents(span); const rect = range.getBoundingClientRect(); return { top: rect.top, bottom: rect.bottom, width: innerWidth, height: innerHeight, scrollY }; });
  expect(geometry.width).toBe(390); expect(geometry.height).toBe(844); expect(geometry.scrollY).toBe(0);
  expect(geometry.top).toBeGreaterThanOrEqual(0); expect(geometry.bottom, JSON.stringify(geometry)).toBeLessThanOrEqual(820);
}
async function captures(tab: Page, stage: "review" | "selected" | "service-only") {
  if (process.env.CI) return;
  const folder = join(process.cwd(), ".impeccable", "review"); await mkdir(folder, { recursive: true });
  for (const [name, viewport] of [["desktop", { width: 1440, height: 1000 }], ["mobile", { width: 390, height: 844 }]] as const) {
    await tab.setViewportSize(viewport);
    await safe(() => tab.evaluate(async () => { await document.fonts.ready; if (document.activeElement instanceof HTMLElement && document.activeElement.matches(".skip-link")) document.activeElement.blur(); scrollTo(0, 0); await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); }));
    expect(await tab.evaluate(() => scrollY === 0 && document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await safe(() => tab.screenshot({ path: join(folder, `service-${stage}-${name}.png`), fullPage: true }));
    await safe(() => panel(tab).screenshot({ path: join(folder, `service-${stage}-${name}-detail.png`) }));
  }
}
beforeAll(async () => {
  try {
    assertBrowserStartupAllowed(); restore = installLoopbackFetchGuard();
    fixture = await browserFixture({ studyLoad: async request => { if (scriptureUnavailable) throw new StudyUnavailable("upstream"); return syntheticUiStudyPage(request); } });
    sibling = (await fixture.practice()).sibling;
    const learner = await fixture.signIn("pg-service-student"), [member] = await fixture.ownerDb.insert(s.membership).values({ tenantId: "crc", userId: learner.id }).returning();
    const [grant] = await fixture.ownerDb.insert(s.roleGrant).values({ tenantId: "crc", membershipId: member.id, role: "student" }).returning();
    await fixture.ownerDb.insert(s.studentIdentity).values({ tenantId: "crc", studentId: fixture.student.id, roleGrantId: grant.id });
    await fixture.ownerDb.update(s.student).set({ serviceSlot: "morning" }).where(inArray(s.student.id, [fixture.student.id, sibling.id]));
    const [admin] = await fixture.ownerDb.select().from(s.membership).where(eq(s.membership.userId, fixture.admin.id));
    for (const [kind, ref, count] of [["torah", "Genesis 1:1-3", 3], ["haftarah", "Isaiah 1:1-2", 2]] as const) {
      const [assignment] = await fixture.ownerDb.insert(s.assignment).values({ tenantId: "crc", studentId: fixture.student.id, kind, basis: "custom", ref, status: "confirmed", setByMembershipId: admin.id, aliyahStarts: kind === "torah" ? [] : null,
        proposalSnapshot: { slotProvenance: 1, serviceSlot: "morning", readingDate: "2027-01-02", confirmationDate: "2027-01-02", needsReview: false } }).returning();
      await fixture.ownerDb.insert(s.assignmentVerse).values(Array.from({ length: count }, (_, index) => ({ tenantId: "crc", studentId: fixture.student.id, assignmentId: assignment.id, ordinal: index + 1, verseRef: `${kind === "torah" ? "Genesis" : "Isaiah"} 1:${index + 1}` })));
    }
    content = syntheticServiceCatalog(); catalogId = randomUUID();
    await fixture.ownerDb.insert(s.serviceCatalog).values({ id: catalogId, tenantId: "crc", identity: content.identity, feedBytes: content.feedBytes, provenanceBytes: content.provenanceBytes, pins: content.pins });
    await fixture.ownerDb.insert(s.serviceCatalogLifecycle).values({ tenantId: "crc", catalogId, state: "active" });
    stop = await startBrowserServer(fixture.withRuntime); isolation = await isolatedEnv(); browser = await chromium.launch({ headless: true, env: isolation.env });
  } catch { await browser?.close().catch(() => undefined); await isolation?.cleanup(); await stop?.().catch(() => undefined); await fixture?.close().catch(() => undefined); restore?.(); throw new Error("Service UI setup failed; private details withheld"); }
}, 120_000);
afterAll(async () => { await Promise.all(contexts.map(context => context.close().catch(() => undefined))); await browser?.close().catch(() => undefined); await isolation?.cleanup(); await stop?.().catch(() => undefined); await fixture?.close().catch(() => undefined); restore?.(); }, 120_000);

it("keeps the saved plan unchanged through staff selection and authoritative review, then confirms exact source order", async () => {
  const tab = await page("admin"); await workspace(tab, "admin");
  await ui(panel(tab).getByText("No service parts have been assigned yet.", { exact: true })).toBeVisible();
  await click(tab, "Choose service parts");
  await safe(() => panel(tab).getByRole("checkbox", { name: /Synthetic part 2/ }).check());
  await safe(() => panel(tab).getByRole("checkbox", { name: /Synthetic part 0/ }).check());
  await click(tab, "Review service parts");
  await ui(panel(tab).getByRole("heading", { name: "Check before saving", exact: true })).toBeVisible();
  expect((await api(tab, fixture.student.id, "?mode=admin")).data).toEqual({ state: "no-plan" });
  expect(await panel(tab).locator(".service-plan-review ol li").allTextContents()).toEqual(["Synthetic part 0", "Synthetic part 2"]);
  expect(await panel(tab).locator(".service-unit").count()).toBe(0);
  await captures(tab, "review");
  await click(tab, "Save service parts");
  await ui(panel(tab).getByText("Saved. These are the student’s service parts now.", { exact: true })).toBeVisible();
  expect((await api(tab, fixture.student.id, "?mode=admin")).data.units.map((unit: { id: string }) => unit.id)).toEqual([content.first, content.second]);
});

it("preserves first-Hebrew phone geometry and offers read-only student/parent selection, exact credits and keyboard notes", async () => {
  const learner = await page("student", true); await workspace(learner, "student"); await firstHebrew(learner);
  await ui(learner.getByRole("button", { name: "Torah text", exact: true })).toBeVisible(); await ui(learner.getByRole("button", { name: "Haftarah text", exact: true })).toBeVisible();
  await safe(() => learner.getByRole("link", { name: "Service parts", exact: true }).click());
  expect(await panel(learner).getByRole("heading", { name: "Set service parts", exact: true }).count()).toBe(0);
  await click(learner, "Synthetic part 0");
  const unit = panel(learner).locator(".service-unit"); await ui(unit).toContainText("Synthetic translation 0");
  await ui(unit).toContainText("Synthetic original 0."); await ui(unit).toContainText("Synthetic caption 0"); await ui(unit).toContainText("Synthetic CRC-only credit");
  expect(await unit.textContent()).not.toMatch(/Synthetic translation [12]|Unselected synthetic front|omitted-synthetic/);
  expect(await unit.getByText("Translation", { exact: true }).count()).toBe(0);
  const summary = unit.locator(".service-unit-notes summary").first(); await safe(() => summary.focus()); await safe(() => summary.press("Enter"));
  await ui(unit.getByText("Synthetic credit", { exact: true })).toBeVisible();
  await captures(learner, "selected");
  const parent = await page("tutor"); await workspace(parent, "parent"); await click(parent, "Synthetic part 2");
  await ui(panel(parent).locator(".service-unit")).toContainText("Synthetic translation 2");
  expect(await parent.getByRole("heading", { name: "Set service parts", exact: true }).count()).toBe(0);
});

it("keeps service reading and its local retry available when scripture text returns503", async () => {
  scriptureUnavailable = true;
  try {
    const tab = await page("student"); await workspace(tab, "student");
    await ui(tab.getByRole("heading", { name: "Text unavailable", exact: true })).toBeVisible();
    let reads = 0; await tab.route("**/service-plan/unit", async route => { if (++reads === 1) await route.fulfill({ status: 503, contentType: "application/json", body: "{}" }); else await route.continue(); });
    await click(tab, "Synthetic part 0"); await ui(panel(tab).getByText("Service parts are unavailable. Your scripture reading is separate.", { exact: true })).toBeVisible();
    await click(tab, "Reload service parts");
    await ui(panel(tab).getByRole("button", { name: "Synthetic part 0", exact: true })).toBeVisible();
    await click(tab, "Synthetic part 0"); await ui(panel(tab).locator(".service-unit")).toContainText("Synthetic translation 0");
    await ui(tab.getByRole("heading", { name: "Text unavailable", exact: true })).toBeVisible();
  } finally { scriptureUnavailable = false; }
});

it("requires explicit draft disposal on controlled departure while allowing its own confirmation to respect scripture guards", async () => {
  const tab = await page("admin"); await workspace(tab, "admin"); await click(tab, "Choose service parts");
  await safe(() => panel(tab).getByRole("checkbox", { name: /Synthetic part 1/ }).check());
  await safe(() => tab.getByRole("link", { name: "All students", exact: true }).click());
  const dialog = tab.getByRole("dialog", { name: "Keep this service draft?", exact: true }); await ui(dialog).toBeVisible();
  await click(tab, "Keep editing service parts"); await ui(dialog).toBeHidden();
  await ui(panel(tab).getByRole("checkbox", { name: /Synthetic part 1/ })).toBeChecked();
  await safe(() => tab.getByRole("link", { name: "All students", exact: true }).click());
  await click(tab, "Discard service draft and continue");
  await ui(tab.getByRole("heading", { name: "Students", level: 1, exact: true })).toBeVisible();
});

it("retains staff choices and an unchanged review through quiet validation, then expires a fresh review without saving", async () => {
  const tab = await page("admin"); await workspace(tab, "admin"); await click(tab, "Choose service parts");
  await safe(() => panel(tab).getByRole("checkbox", { name: /Synthetic part 1/ }).check());
  await click(tab, "Review service parts");
  await ui(panel(tab).getByRole("button", { name: "Save service parts", exact: true })).toBeEnabled();
  const before = (await api(tab, fixture.student.id, "?mode=admin")).data;
  let verified = 0; const count = (response: import("playwright").Response) => { if (new URL(response.url()).pathname === "/api/session" && response.status() === 200) verified++; }; tab.on("response", count);
  try { await safe(() => tab.evaluate(() => window.dispatchEvent(new Event("focus")))); await ui.poll(() => verified).toBeGreaterThanOrEqual(4); } finally { tab.off("response", count); }
  await ui(panel(tab).getByRole("button", { name: "Review service parts", exact: true })).toBeEnabled();
  await ui(panel(tab).getByRole("checkbox", { name: /Synthetic part 1/ })).toBeChecked();
  await ui(panel(tab).getByRole("button", { name: "Save service parts", exact: true })).toBeEnabled();
  expect((await api(tab, fixture.student.id, "?mode=admin")).data).toEqual(before);
  let confirmations = 0;
  await tab.route("**/service-plan/confirm", async route => { confirmations++; await route.continue(); });
  await tab.route("**/service-plan/prepare", async route => {
    const response = await route.fetch(), body = await response.json();
    await route.fulfill({ response, json: { ...body, expiresAt: Date.now() + 1_500 } });
  });
  await click(tab, "Review service parts");
  await ui(panel(tab).getByRole("button", { name: "Save service parts", exact: true })).toBeEnabled();
  await ui(panel(tab).getByText("This service review expired. Prepare a new review before confirming.", { exact: true })).toBeVisible();
  expect(await panel(tab).getByRole("button", { name: "Save service parts", exact: true }).count()).toBe(0);
  await ui(panel(tab).getByRole("checkbox", { name: /Synthetic part 1/ })).toBeChecked();
  expect(confirmations).toBe(0); expect((await api(tab, fixture.student.id, "?mode=admin")).data).toEqual(before);
});

it("retains choices after an uncertain confirmation and requires authoritative reload without retry", async () => {
  const tab = await page("admin"); await workspace(tab, "admin"); await click(tab, "Choose service parts");
  await safe(() => panel(tab).getByRole("checkbox", { name: /Synthetic part 1/ }).check());
  await click(tab, "Review service parts");
  const before = (await api(tab, fixture.student.id, "?mode=admin")).data;
  let confirmations = 0;
  await tab.route("**/service-plan/confirm", async route => { confirmations++; await route.fulfill({ status: 503, contentType: "application/json", body: "{}" }); });
  await click(tab, "Save service parts");
  await ui(panel(tab).getByRole("alert")).toContainText("It may have saved");
  await ui(panel(tab).getByRole("checkbox", { name: /Synthetic part 1/ })).toBeChecked();
  await ui(panel(tab).getByRole("button", { name: "Review service parts", exact: true })).toBeDisabled();
  expect(confirmations).toBe(1); expect((await api(tab, fixture.student.id, "?mode=admin")).data).toEqual(before);
  await click(tab, "Check what saved"); await click(tab, "Discard choices and start again");
  await ui(panel(tab).getByRole("checkbox", { name: /Synthetic part 1/ })).not.toBeChecked();
  expect(confirmations).toBe(1);
});

it("rejects a stale review without overwriting a newer service plan, and explicitly reviews clearing", async () => {
  const tab = await page("admin"); await workspace(tab, "admin"); await click(tab, "Choose service parts");
  await safe(() => panel(tab).getByRole("checkbox", { name: /Synthetic part 0/ }).uncheck());
  await click(tab, "Review service parts"); await ui(panel(tab).getByRole("button", { name: "Save service parts", exact: true })).toBeEnabled();
  await assign(tab, fixture.student.id, [content.first]);
  await click(tab, "Save service parts");
  await ui(panel(tab).getByRole("alert")).toContainText("changed after this review");
  expect((await api(tab, fixture.student.id, "?mode=admin")).data.units.map((unit: { id: string }) => unit.id)).toEqual([content.first]);
  await click(tab, "Check what saved"); await click(tab, "Discard choices and start again");
  await click(tab, "Remove all service parts"); await click(tab, "Review service parts");
  await ui(panel(tab).locator(".service-plan-review")).toContainText("This removes every service part.");
  expect((await api(tab, fixture.student.id, "?mode=admin")).data.state).toBe("assigned");
  await click(tab, "Save service parts"); await ui(panel(tab).getByText("Saved. This student has no service parts now.", { exact: true })).toBeVisible();
  expect((await api(tab, fixture.student.id, "?mode=admin")).data.state).toBe("cleared");
  await assign(tab, fixture.student.id, [content.first, content.second]);
});

it("puts a tutor's service parts in a tab beside the reading, keeping open material and an unsent draft across switches and bringing a departure prompt's tab forward", async () => {
  const admin = await page("admin"); await assign(admin, fixture.student.id, [content.first, content.second]);
  const tab = await page("tutor"); await safe(() => tab.goto("/workspace/tutor", { waitUntil: "domcontentloaded" }));
  await safe(() => tab.getByLabel("Student", { exact: true }).locator(`[data-student-id="${fixture.student.id}"]`).click());
  const tabs = tab.getByRole("tablist", { name: "Student page" }), readingTab = tabs.getByRole("tab", { name: "Reading", exact: true }), serviceTab = tabs.getByRole("tab", { name: "Service parts", exact: true });
  await ui(readingTab).toHaveAttribute("aria-selected", "true"); await ui(tab.locator(".assigned-study")).toBeVisible();
  for (const control of [readingTab, serviceTab]) {
    const id = await control.getAttribute("aria-controls"); expect(id).toBeTruthy();
    await ui(tab.locator(`[id="${id}"][role="tabpanel"]`)).toHaveAttribute("aria-labelledby", (await control.getAttribute("id"))!);
  }
  await ui(panel(tab)).toBeHidden();
  expect(await tab.getByRole("link", { name: "Service parts", exact: true }).count()).toBe(0);
  await safe(() => readingTab.focus()); await safe(() => tab.keyboard.press("ArrowRight"));
  await ui(serviceTab).toHaveAttribute("aria-selected", "true"); await ui(serviceTab).toBeFocused();
  await ui(tab.locator(".assigned-study")).toBeHidden(); await ui(tab.locator(".reading-toolbar")).toHaveCount(0);
  await ui(panel(tab).getByText("Checking assigned service parts…", { exact: true })).toBeHidden();
  await click(tab, "Synthetic part 0"); await ui(panel(tab).locator(".service-unit")).toContainText("Synthetic translation 0");
  await capture(tab, "tutor-service-tab");
  // Start brings the main reading forward and explicitly requests verse playback.
  await click(tab, "Practice up close");
  await ui(readingTab).toHaveAttribute("aria-selected", "true"); await ui(tab.locator("dialog.lift")).toHaveCount(0);
  const inline = tab.getByRole("region", { name: "Reading playback", exact: true }); await ui(inline).toContainText("Genesis 1:1");
  await ui(inline.getByText("The recording couldn’t be loaded. Try again.", { exact: true })).toBeVisible();
  await ui(tab.getByRole("button", { name: "Practice up close", exact: true })).toBeFocused();
  await safe(() => serviceTab.click()); await ui(panel(tab).locator(".service-unit")).toContainText("Synthetic translation 0");
  await safe(() => tab.keyboard.press("Home")); await ui(readingTab).toHaveAttribute("aria-selected", "true"); await ui(readingTab).toBeFocused();
  // Left from the first tab wraps to the last (Lessons), then steps back to Service parts.
  await safe(() => tab.keyboard.press("ArrowLeft")); await ui(tabs.getByRole("tab", { name: "Lessons", exact: true })).toHaveAttribute("aria-selected", "true");
  await safe(() => tab.keyboard.press("ArrowLeft")); await ui(serviceTab).toHaveAttribute("aria-selected", "true"); await ui(serviceTab).toBeFocused();
  // An unsent service draft survives the panel being hidden.
  await click(tab, "Choose service parts"); await safe(() => panel(tab).getByRole("checkbox", { name: /Synthetic part 1/ }).check());
  await safe(() => readingTab.click()); await ui(panel(tab)).toBeHidden();
  await safe(() => serviceTab.click()); await ui(panel(tab).getByRole("checkbox", { name: /Synthetic part 1/ })).toBeChecked();
  // A guarded reading action from the Reading tab raises the draft prompt and brings Service parts forward.
  await safe(() => readingTab.click()); await click(tab, "Haftarah text");
  const prompt = tab.getByRole("dialog", { name: "Keep this service draft?", exact: true }); await ui(prompt).toBeVisible();
  await ui(serviceTab).toHaveAttribute("aria-selected", "true");
  await click(tab, "Keep editing service parts"); await ui(prompt).toBeHidden();
  await ui(serviceTab).toHaveAttribute("aria-selected", "true"); await ui(panel(tab).getByRole("checkbox", { name: /Synthetic part 1/ })).toBeChecked();
  await ui(panel(tab).getByRole("button", { name: "Discard choices and start again", exact: true })).toBeFocused();
  await safe(() => readingTab.click()); await click(tab, "Haftarah text"); await click(tab, "Discard service draft and continue");
  await ui(readingTab).toHaveAttribute("aria-selected", "true");
  await ui(tab.getByRole("button", { name: "Haftarah text", exact: true })).toHaveAttribute("aria-pressed", "true");
});

async function capture(tab: Page, name: string) {
  if (process.env.CI) return;
  const folder = join(process.cwd(), ".impeccable", "review"); await mkdir(folder, { recursive: true });
  await writeFile(join(folder, `${name}-desktop.png`), await tab.screenshot({ fullPage: true }));
  await tab.setViewportSize({ width: 390, height: 844 }); await writeFile(join(folder, `${name}-mobile.png`), await tab.screenshot({ fullPage: true }));
  await tab.setViewportSize({ width: 1440, height: 1000 });
}

it("suspends the reading sheet for a service decision and retains only that rightful modal during quiet validation", async () => {
  const admin = await page("admin"); await assign(admin, fixture.student.id, [content.first]);
  const tab = await page("tutor"); await workspace(tab, "tutor");
  await click(tab, "Choose service parts"); await safe(() => panel(tab).getByRole("checkbox", { name: /Synthetic part 1/ }).check());
  await safe(() => tab.getByRole("tab", { name: "Reading", exact: true }).click());
  await click(tab, "Change verses");
  const sheet = tab.locator("dialog.editor-sheet"), prompt = tab.getByRole("dialog", { name: "Keep this service draft?", exact: true });
  await ui(sheet).toBeVisible();
  await safe(() => tab.getByLabel("Passage", { exact: true }).selectOption("custom"));
  await safe(() => tab.getByText("Advanced references and aliyah boundaries", { exact: true }).click());
  await safe(() => tab.getByLabel("Custom verse ranges", { exact: true }).fill("Genesis 1:1-2"));
  await click(tab, "Review assignment"); await ui(tab.getByRole("button", { name: "Save assignment", exact: true })).toBeEnabled();
  let writes = 0; tab.on("request", request => { if (request.method() === "POST" && /\/(reading|service-plan)\/confirm$/.test(new URL(request.url()).pathname)) writes++; });
  await click(tab, "Save assignment"); await ui(prompt).toBeVisible();
  const snapshot = () => tab.evaluate(() => ({ modals: document.querySelectorAll("dialog:modal").length, service: Boolean(document.querySelector(".service-learning-panel dialog:modal")), sheet: Boolean(document.querySelector("dialog.editor-sheet:modal")) }));
  const phases = [await snapshot()];
  let release!: () => void, held = false, delivered = 0; const gate = new Promise<void>(resolve => { release = resolve; });
  await tab.route("**/api/session", async route => { const response = await route.fetch(); held = true; await gate; await route.fulfill({ response }).catch(() => undefined); delivered++; });
  try {
    await safe(() => tab.evaluate(() => window.dispatchEvent(new Event("focus")))); await ui.poll(() => held).toBe(true);
    await ui(tab.getByRole("heading", { name: "Checking your access", exact: true })).toBeHidden(); await ui(prompt).toBeVisible(); expect(writes).toBe(0); phases.push(await snapshot());
  } finally { release(); }
  await ui.poll(() => delivered).toBeGreaterThanOrEqual(4); await ui(prompt).toBeVisible(); await ui(tab.getByRole("heading", { name: "Checking your access", exact: true })).toBeHidden(); phases.push(await snapshot());
  expect(phases).toEqual([{ modals: 1, service: true, sheet: false }, { modals: 1, service: true, sheet: false }, { modals: 1, service: true, sheet: false }]);
  await ui(tab.getByRole("button", { name: "Keep editing service parts", exact: true })).toBeFocused();
  await safe(() => tab.keyboard.press("Escape")); await ui(prompt).toBeHidden(); await ui(sheet).toBeVisible();
  expect(await snapshot()).toEqual({ modals: 1, service: false, sheet: true });
  expect(await sheet.evaluate(node => node.contains(document.activeElement))).toBe(true);
  await ui(tab.getByLabel("Custom verse ranges", { exact: true })).toHaveValue("Genesis 1:1-2");
  await safe(() => tab.keyboard.press("Escape")); await ui(sheet).toBeHidden();
  expect(await snapshot()).toEqual({ modals: 0, service: false, sheet: false });
  await ui(tab.getByRole("button", { name: "Change verses", exact: true })).toBeFocused();
  await safe(() => tab.getByRole("tab", { name: "Service parts", exact: true }).click());
  await ui(panel(tab).getByRole("checkbox", { name: /Synthetic part 1/ })).toBeChecked(); expect(writes).toBe(0);
  await tab.unroute("**/api/session");
  // A real native close must settle this idle decision as cancellation, while
  // the quiet validation above must preserve the pending decision.
  await safe(() => tab.getByRole("tab", { name: "Reading", exact: true }).click()); await click(tab, "Haftarah text"); await ui(prompt).toBeVisible();
  await safe(() => prompt.evaluate(node => (node as HTMLDialogElement).close())); await ui(prompt).toBeHidden();
  expect(await snapshot()).toEqual({ modals: 0, service: false, sheet: false });
  await ui(panel(tab).getByRole("button", { name: "Discard choices and start again", exact: true })).toBeFocused();
  await safe(() => tab.getByRole("tab", { name: "Reading", exact: true }).click()); await click(tab, "Haftarah text"); await ui(prompt).toBeVisible();
  await click(tab, "Discard service draft and continue"); await ui(prompt).toBeHidden();
  expect(await snapshot()).toEqual({ modals: 0, service: false, sheet: false });
  await ui(tab.getByRole("tab", { name: "Reading", exact: true })).toHaveAttribute("aria-selected", "true");
  await ui(tab.getByRole("button", { name: "Haftarah text", exact: true })).toHaveAttribute("aria-pressed", "true"); expect(writes).toBe(0);
});

it("clears a denied tutor draft and material immediately when the actual relationship is revoked", async () => {
  // Establish this case's plan independently so it can be diagnosed in isolation.
  const admin = await page("admin"); await assign(admin, fixture.student.id, [content.first, content.second]);
  const tab = await page("tutor"); await workspace(tab, "tutor"); await click(tab, "Synthetic part 0");
  await ui(panel(tab).locator(".service-unit")).toBeVisible(); await click(tab, "Choose service parts");
  await safe(() => panel(tab).getByRole("checkbox", { name: /Synthetic part 1/ }).check());
  const statuses: { endpoint: string; status: number | "failed" }[] = [];
  const endpoint = (url: string) => {
    const path = new URL(url).pathname;
    if (path === "/api/session") return "session";
    if (path === "/api/students") return "student-roster";
    if (path === `/api/students/${fixture.student.id}/reading`) return "selected-reading";
    if (path.startsWith(`/api/students/${fixture.student.id}/service-plan`)) return `service-plan${path.slice(`/api/students/${fixture.student.id}/service-plan`.length)}`;
    return null;
  };
  const responseStatus = (response: import("playwright").Response) => { const name = endpoint(response.url()); if (name) statuses.push({ endpoint: name, status: response.status() }); };
  const requestFailed = (request: import("playwright").Request) => { const name = endpoint(request.url()); if (name) statuses.push({ endpoint: name, status: "failed" }); };
  tab.on("response", responseStatus); tab.on("requestfailed", requestFailed);
  const revoked = await fixture.ownerDb.update(s.tutorStudent).set({ revokedAt: new Date() })
    .where(and(eq(s.tutorStudent.studentId, fixture.student.id), isNull(s.tutorStudent.revokedAt))).returning();
  expect(revoked).toHaveLength(1);
  try {
    await click(tab, "Review service parts");
    // The fresh roster removes this student. Its unmounted reading request must
    // not fail the remaining, still-authorized tutor workspace.
    await ui(tab.getByText("No student is currently linked to this role. Ask the congregation for help with your assignment.", { exact: true })).toBeVisible();
    expect(await tab.locator(".service-unit, .service-plan-review, .service-catalog-choices").count()).toBe(0);
  } catch (error) {
    // This fixture contains synthetic UI text only. Never include request data,
    // storage, cookies, input values, attributes or raw response/error bodies.
    const folder = join(process.cwd(), ".local-logs"); await mkdir(folder, { recursive: true });
    const diagnostic = await tab.locator("#workspace-main").evaluate(main => ({
      visibleText: (main as HTMLElement).innerText.slice(0, 12_000),
      visibleHeadings: Array.from(main.querySelectorAll("h1,h2,h3,h4")).filter(node => (node as HTMLElement).checkVisibility()).map(node => node.textContent),
      serviceElementCounts: Object.fromEntries([".service-unit", ".service-plan-review", ".service-catalog-choices"].map(selector => [selector, main.querySelectorAll(selector).length])),
      visibleServiceElementCounts: Object.fromEntries([".service-unit", ".service-plan-review", ".service-catalog-choices"].map(selector => [selector, Array.from(main.querySelectorAll(selector)).filter(node => (node as HTMLElement).checkVisibility()).length])),
    }));
    await writeFile(join(folder, "service-revoked-ui.json"), JSON.stringify({ ...diagnostic, statuses }, null, 2));
    await tab.screenshot({ path: join(folder, "service-revoked-ui.png"), fullPage: true });
    throw error;
  } finally {
    tab.off("response", responseStatus); tab.off("requestfailed", requestFailed);
    // Revocation history is immutable; subsequent cases get a new synthetic link.
    await fixture.ownerDb.insert(s.tutorStudent).values(revoked.map(row => ({ tenantId: row.tenantId, studentId: row.studentId, tutorGrantId: row.tutorGrantId })));
  }
});

it("fences a late selected-unit response across linked-child switching and never restores the prior child's material", async () => {
  const admin = await page("admin"); await assign(admin, sibling.id, [content.second]);
  const parent = await page("tutor"); await workspace(parent, "parent"); await click(parent, "Practice with Synthetic");
  await ui(parent.getByRole("heading", { name: "Child practice", level: 1, exact: true })).toBeVisible();
  let release!: () => void, held = false, delivered = false; const gate = new Promise<void>(resolve => { release = resolve; });
  await parent.route("**/service-plan/unit", async route => { const response = await route.fetch(); held = true; await gate; await route.fulfill({ response }).catch(() => undefined); delivered = true; });
  try {
    await click(parent, "Synthetic part 0"); await ui.poll(() => held).toBe(true);
    await safe(() => parent.getByRole("button", { name: /^Switch practice to/ }).filter({ hasText: "Sibling" }).click());
    await ui(panel(parent).getByRole("button", { name: "Synthetic part 2", exact: true })).toBeVisible();
    release(); await ui.poll(() => delivered).toBe(true);
    expect(await panel(parent).locator(".service-unit").count()).toBe(0);
    expect(await panel(parent).getByRole("button", { name: "Synthetic part 0", exact: true }).count()).toBe(0);
  } finally { release(); await parent.unroute("**/service-plan/unit"); }
  await click(parent, "Synthetic part 2"); await ui(panel(parent).locator(".service-unit")).toContainText("Synthetic translation 2");
});

it("keeps old authorized parts readable with needs-review when the slot becomes unknown, while blocking a new catalog", async () => {
  const [student] = await fixture.ownerDb.select().from(s.student).where(eq(s.student.id, fixture.student.id));
  await fixture.ownerDb.update(s.student).set({ serviceSlot: "unknown", revision: student.revision + 1 }).where(eq(s.student.id, student.id));
  try {
    const tab = await page("admin"); await workspace(tab, "admin"); await click(tab, "Choose service parts");
    await ui(panel(tab).getByText(/Set the student’s morning or Havdalah/)).toBeVisible();
    await ui(panel(tab).getByText(/Service parts need review/)).toBeVisible();
    await click(tab, "Synthetic part 0"); await ui(panel(tab).locator(".service-unit")).toContainText("Synthetic translation 0");
  } finally { await fixture.ownerDb.update(s.student).set({ serviceSlot: "morning", revision: student.revision + 2 }).where(eq(s.student.id, student.id)); }
});

it("reads service-only student plans without scripture assignments and preserves single-kind phone access before removal", async () => {
  const [haftarah] = await fixture.ownerDb.select().from(s.assignment).where(eq(s.assignment.kind, "haftarah"));
  await fixture.ownerDb.delete(s.assignmentVerse).where(eq(s.assignmentVerse.assignmentId, haftarah.id)); await fixture.ownerDb.delete(s.assignment).where(eq(s.assignment.id, haftarah.id));
  const tab = await page("student", true); await workspace(tab, "student"); await firstHebrew(tab);
  expect(await tab.getByRole("link", { name: "Service parts", exact: true }).count()).toBe(1);
  await fixture.ownerDb.delete(s.assignmentVerse).where(eq(s.assignmentVerse.studentId, fixture.student.id)); await fixture.ownerDb.delete(s.assignment).where(eq(s.assignment.studentId, fixture.student.id));
  await click(tab, "Refresh reading");
  await ui(tab.getByRole("heading", { name: "No reading has been assigned yet", exact: true })).toBeVisible();
  await safe(() => tab.getByRole("link", { name: "Service parts", exact: true }).click()); await click(tab, "Synthetic part 0");
  await ui(panel(tab).locator(".service-unit")).toContainText("Synthetic translation 0");
  await captures(tab, "service-only");
});

it("retains superseded source readability but removes withdrawn material on authoritative refresh", async () => {
  await fixture.ownerDb.update(s.serviceCatalogLifecycle).set({ state: "superseded", revision: 2 }).where(eq(s.serviceCatalogLifecycle.catalogId, catalogId));
  const tab = await page("student"); await workspace(tab, "student"); await click(tab, "Synthetic part 0");
  await ui(panel(tab).locator(".service-unit")).toContainText("Synthetic translation 0");
  await fixture.ownerDb.update(s.serviceCatalogLifecycle).set({ state: "withdrawn", revision: 3 }).where(eq(s.serviceCatalogLifecycle.catalogId, catalogId));
  await click(tab, "Refresh reading");
  await ui(panel(tab).getByText("The assigned service material has been withdrawn. Ask your tutor or rabbi about a replacement.", { exact: true })).toBeVisible();
  expect(await panel(tab).locator(".service-unit, .service-part-choices").count()).toBe(0);
});
