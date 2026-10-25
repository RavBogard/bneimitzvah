import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { expect as ui } from "@playwright/test";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { isolatedEnv } from "../helpers/isolatedEnv.mjs";
import { syntheticUiStudyPage } from "../helpers/study-ui";
import { syntheticServiceCatalog } from "../helpers/service-learning";
import { browserFixture } from "./fixture";
import { BROWSER_ORIGIN, assertBrowserStartupAllowed, startBrowserServer } from "./server";
import { installLoopbackFetchGuard } from "./egress";
import { closeVerseTools, openVerseTools, workPanel } from "./verse-tools";
import { openAuthMail } from "./auth-navigation";
import * as s from "../../src/server/db/index";
vi.mock("server-only", () => ({}));

let fixture: Awaited<ReturnType<typeof browserFixture>>, browser: Browser;
let stop: (() => Promise<void>) | undefined, restore: (() => void) | undefined;
let environment: Awaited<ReturnType<typeof isolatedEnv>> | undefined;
let cookies: Awaited<ReturnType<BrowserContext["cookies"]>> | undefined;
const contexts: BrowserContext[] = [];
async function safe<T>(action: () => Promise<T>): Promise<T> { try { return await action(); } catch { throw new Error("Service modal privacy operation failed; private details withheld"); } }
const click = (tab: Page, name: string) => safe(() => tab.getByRole("button", { name, exact: true }).click());
const sheet = (tab: Page) => tab.locator("dialog.editor-sheet");
const serviceGuard = (tab: Page) => tab.getByRole("dialog", { name: "Keep this service draft?", exact: true });
const workGuard = (tab: Page) => tab.getByRole("dialog", { name: "Review work before leaving", exact: true });
const panel = (tab: Page) => tab.locator(".service-learning-panel");
const modalCount = (tab: Page) => tab.evaluate(() => document.querySelectorAll("dialog:modal").length);
async function page(fresh = false) {
  const context = await browser.newContext({ baseURL: BROWSER_ORIGIN, serviceWorkers: "block", acceptDownloads: false, viewport: { width: 390, height: 844 }, reducedMotion: "reduce" }); contexts.push(context);
  await context.route("**/*", async route => { try { if (new URL(route.request().url()).origin === BROWSER_ORIGIN) await route.continue(); else await route.abort(); } catch { await route.abort(); } });
  if (!fresh && cookies) await context.addCookies(cookies);
  const tab = await context.newPage(); await safe(() => tab.goto("/", { waitUntil: "domcontentloaded" }));
  if (fresh || !cookies) {
    expect(await safe(() => tab.evaluate(async () => (await fetch("/api/auth/sign-in/magic-link", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "pg-tutor@example.test" }) })).status))).toBe(200);
    await openAuthMail(tab, fixture.takeMail("pg-tutor@example.test"));
    if (!fresh) cookies = await context.cookies();
  }
  await safe(() => tab.goto(`/workspace/tutor/${fixture.student.id}`, { waitUntil: "domcontentloaded" }));
  await ui(tab.locator(".study-verses")).toBeVisible(); return tab;
}
async function choose(tab: Page, part = 1) {
  await safe(() => tab.getByRole("tab", { name: "Service parts", exact: true }).click());
  await ui(panel(tab).getByText("Checking assigned service parts…", { exact: true })).toBeHidden();
  await click(tab, "Choose service parts");
  await safe(() => panel(tab).getByRole("checkbox", { name: new RegExp(`Synthetic part ${part}`) }).check());
  await safe(() => tab.getByRole("tab", { name: "Reading", exact: true }).click());
}
async function prepareReading(tab: Page) {
  await click(tab, "Change verses"); await ui(sheet(tab)).toBeVisible();
  await safe(() => tab.getByLabel("Passage", { exact: true }).selectOption("custom"));
  await safe(() => tab.getByText("Advanced references and aliyah boundaries", { exact: true }).click());
  await safe(() => tab.getByLabel("Custom verse ranges", { exact: true }).fill("Genesis 1:1-2"));
  await click(tab, "Review assignment"); await ui(tab.getByRole("button", { name: "Save assignment", exact: true })).toBeEnabled();
}
async function pendingService(tab: Page) {
  await choose(tab); await prepareReading(tab); await click(tab, "Save assignment");
  await ui(serviceGuard(tab)).toBeVisible(); await ui(sheet(tab)).toBeHidden(); expect(await modalCount(tab)).toBe(1);
}
async function holdSession(tab: Page) {
  let release!: () => void, held = false, delivered = 0; const gate = new Promise<void>(resolve => { release = resolve; });
  await tab.route("**/api/session", async route => { const response = await route.fetch(); held = true; await gate; await route.fulfill({ response }).catch(() => undefined); delivered++; });
  return { release, ready: () => ui.poll(() => held).toBe(true), completed: () => ui.poll(() => delivered).toBeGreaterThanOrEqual(4), remove: () => tab.unroute("**/api/session") };
}
function countWrites(tab: Page) {
  const counts = { confirm: 0, note: 0 };
  tab.on("request", request => { if (request.method() !== "POST") return; const path = new URL(request.url()).pathname; if (/\/(reading|service-plan)\/confirm$/.test(path)) counts.confirm++; if (path.endsWith("/work/note")) counts.note++; });
  return counts;
}
beforeAll(async () => {
  try {
    assertBrowserStartupAllowed(); restore = installLoopbackFetchGuard(); fixture = await browserFixture({ studyLoad: async request => syntheticUiStudyPage(request) });
    await fixture.practice();
    await fixture.ownerDb.update(s.student).set({ serviceSlot: "morning" }).where(eq(s.student.id, fixture.student.id));
    const [admin] = await fixture.ownerDb.select().from(s.membership).where(eq(s.membership.userId, fixture.admin.id));
    for (const [kind, ref, count] of [["torah", "Genesis 1:1-3", 3], ["haftarah", "Isaiah 1:1-2", 2]] as const) {
      const [assignment] = await fixture.ownerDb.insert(s.assignment).values({ tenantId: "crc", studentId: fixture.student.id, kind, basis: "custom", ref, status: "confirmed", setByMembershipId: admin.id, aliyahStarts: kind === "torah" ? [] : null,
        proposalSnapshot: { slotProvenance: 1, serviceSlot: "morning", readingDate: "2027-01-02", confirmationDate: "2027-01-02", needsReview: false } }).returning();
      await fixture.ownerDb.insert(s.assignmentVerse).values(Array.from({ length: count }, (_, index) => ({ tenantId: "crc", studentId: fixture.student.id, assignmentId: assignment.id, ordinal: index + 1, verseRef: `${kind === "torah" ? "Genesis" : "Isaiah"} 1:${index + 1}` })));
    }
    const content = syntheticServiceCatalog(), catalogId = randomUUID();
    await fixture.ownerDb.insert(s.serviceCatalog).values({ id: catalogId, tenantId: "crc", identity: content.identity, feedBytes: content.feedBytes, provenanceBytes: content.provenanceBytes, pins: content.pins });
    await fixture.ownerDb.insert(s.serviceCatalogLifecycle).values({ tenantId: "crc", catalogId, state: "active" });
    await fixture.ownerDb.insert(s.studentServicePlan).values({ tenantId: "crc", studentId: fixture.student.id, catalogId, catalogIdentity: content.identity, selectedIds: [content.first], reviewedDate: "2027-01-02", reviewedSlot: "morning", setByMembershipId: admin.id });
    stop = await startBrowserServer(fixture.withRuntime); environment = await isolatedEnv(); browser = await chromium.launch({ headless: true, env: environment.env });
  } catch { await browser?.close().catch(() => undefined); await stop?.().catch(() => undefined); await fixture?.close().catch(() => undefined); restore?.(); await environment?.cleanup(); throw new Error("Service modal privacy setup failed; private details withheld"); }
}, 120_000);
afterAll(async () => { await Promise.all(contexts.map(context => context.close().catch(() => undefined))); await browser?.close().catch(() => undefined); await stop?.().catch(() => undefined); await fixture?.close().catch(() => undefined); restore?.(); await environment?.cleanup(); }, 120_000);

it("retains only the rightful service decision during a quiet check, preserving both drafts and focus while another tab stays independent", async () => {
  const tab = await page(), other = await page(), writes = countWrites(tab);
  await choose(other, 2); await safe(() => other.getByRole("tab", { name: "Service parts", exact: true }).click());
  await pendingService(tab); const hold = await holdSession(tab);
  try {
    await safe(() => tab.evaluate(() => window.dispatchEvent(new Event("focus")))); await hold.ready();
    await ui(tab.getByRole("heading", { name: "Checking your access", exact: true })).toBeHidden();
    expect(await modalCount(tab)).toBe(1); await ui(serviceGuard(tab)).toBeVisible(); await ui(sheet(tab)).toBeHidden(); expect(writes).toEqual({ confirm: 0, note: 0 });
    expect(await modalCount(other)).toBe(0); await ui(panel(other).getByRole("checkbox", { name: /Synthetic part 2/ })).toBeChecked();
    await ui(other.getByRole("heading", { name: "Checking your access", exact: true })).toBeHidden();
  } finally { hold.release(); }
  await hold.completed(); await ui(serviceGuard(tab)).toBeVisible(); expect(await modalCount(tab)).toBe(1); await ui(sheet(tab)).toBeHidden();
  await ui(tab.getByRole("button", { name: "Keep editing service parts", exact: true })).toBeFocused();
  await click(tab, "Keep editing service parts"); await ui(serviceGuard(tab)).toBeHidden(); await ui(sheet(tab)).toBeVisible();
  expect(await modalCount(tab)).toBe(1); expect(await sheet(tab).evaluate(node => node.contains(document.activeElement))).toBe(true);
  await ui(tab.getByLabel("Custom verse ranges", { exact: true })).toHaveValue("Genesis 1:1-2");
  await safe(() => tab.keyboard.press("Escape")); await ui(sheet(tab)).toBeHidden(); expect(await modalCount(tab)).toBe(0);
  await ui(tab.getByRole("button", { name: "Change verses", exact: true })).toBeFocused();
  await safe(() => tab.getByRole("tab", { name: "Service parts", exact: true }).click());
  await ui(panel(tab).getByRole("checkbox", { name: /Synthetic part 1/ })).toBeChecked();
  await ui(panel(other).getByRole("checkbox", { name: /Synthetic part 2/ })).toBeChecked(); expect(writes).toEqual({ confirm: 0, note: 0 });
  await hold.remove(); await safe(() => tab.context().close()); await safe(() => other.context().close());
});

it("serializes service and unknown-note guards, and canceling the later decision stops the reading request and preserves the unknown note", async () => {
  const tab = await page(), writes = countWrites(tab), text = "Synthetic uncertain service-guard note";
  await choose(tab);
  const note = await workPanel(tab); await safe(() => note.locator("summary").first().click());
  await safe(() => note.getByRole("button", { name: "Teacher notes", exact: true }).click()); await safe(() => note.getByRole("textbox").fill(text));
  // A real authorized commit followed by a lost response creates an unknown
  // outcome. No second POST may be issued by the departure sequence.
  await tab.route("**/work/note", async route => { const response = await route.fetch(); expect(response.status()).toBe(200); await response.dispose(); await route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"unavailable"}' }); });
  await safe(() => note.getByRole("button", { name: "Add student-visible note", exact: true }).click());
  await ui(note.locator(".work-status")).toContainText("Save not confirmed");
  await closeVerseTools(tab); // the page's controls are behind the sheet; the unknown note stays in the tab's work state
  await prepareReading(tab); await click(tab, "Save assignment");
  await ui(serviceGuard(tab)).toBeVisible(); expect(await modalCount(tab)).toBe(1); await ui(sheet(tab)).toBeHidden();
  await click(tab, "Discard service draft and continue"); await ui(serviceGuard(tab)).toBeHidden(); await ui(workGuard(tab)).toBeVisible();
  expect(await modalCount(tab)).toBe(1); await ui(sheet(tab)).toBeHidden();
  await ui(tab.getByRole("button", { name: "Check what saved and continue", exact: true })).toBeVisible();
  await click(tab, "Keep working"); await ui(workGuard(tab)).toBeHidden(); await ui(sheet(tab)).toBeVisible();
  expect(await modalCount(tab)).toBe(1); expect(await sheet(tab).evaluate(node => node.contains(document.activeElement))).toBe(true);
  await ui(tab.getByLabel("Custom verse ranges", { exact: true })).toHaveValue("Genesis 1:1-2");
  await safe(() => tab.keyboard.press("Escape")); await ui(sheet(tab)).toBeHidden(); expect(await modalCount(tab)).toBe(0);
  // The service decision brought its tab forward. Reopen the rightful reading
  // tab/stream before checking retained coordinator text, not a hidden control.
  await safe(() => tab.getByRole("tab", { name: "Reading", exact: true }).click());
  await ui(tab.getByRole("tab", { name: "Reading", exact: true })).toHaveAttribute("aria-selected", "true");
  await openVerseTools(tab, "Genesis 1:1");
  if (await note.getAttribute("open") === null) await safe(() => note.locator("summary").first().click());
  await safe(() => note.getByRole("button", { name: "Teacher notes", exact: true }).click());
  await ui(note.getByRole("textbox")).toHaveValue(text); await ui(note.locator(".work-status")).toContainText("Save not confirmed");
  expect(writes).toEqual({ confirm: 0, note: 1 }); await tab.unroute("**/work/note");
  // An explicit departure clears the unknown local copy and unmounts both
  // modal owners; this must not resurrect the suspended reading sheet.
  await closeVerseTools(tab); // the role links are behind the sheet
  await safe(() => tab.getByRole("navigation", { name: "Workspace roles", exact: true }).getByRole("link", { name: "Parent", exact: true }).click());
  await ui(workGuard(tab)).toBeVisible(); expect(await modalCount(tab)).toBe(1); await click(tab, "Leave without confirming");
  await ui(tab.getByRole("list", { name: "Child", exact: true })).toBeVisible(); expect(await modalCount(tab)).toBe(0);
  expect(await tab.locator("dialog.editor-sheet, .service-plan-editor").count()).toBe(0);
  expect(await tab.evaluate(value => !document.body.textContent?.includes(value), text)).toBe(true); expect(writes).toEqual({ confirm: 0, note: 1 });
  await safe(() => tab.context().close());
});

it("clears pending service and reading modals after real session expiry or relationship revocation and keeps recovery usable", async () => {
  for (const failure of ["session", "relationship"] as const) {
    const tab = await page(true), writes = countWrites(tab); await pendingService(tab); const hold = await holdSession(tab);
    try {
      await safe(() => tab.evaluate(() => window.dispatchEvent(new Event("focus")))); await hold.ready(); expect(await modalCount(tab)).toBe(1); await ui(serviceGuard(tab)).toBeVisible();
      if (failure === "session") await fixture.ownerDb.update(s.session).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(s.session.userId, fixture.tutor.id));
      else await fixture.ownerDb.update(s.tutorStudent).set({ revokedAt: new Date() }).where(eq(s.tutorStudent.id, fixture.link.id));
    } finally { hold.release(); }
    if (failure === "session") await ui(tab.getByRole("heading", { name: "Sign in to continue", exact: true })).toBeVisible();
    // Revoking the only tutor link follows StudentSelection's empty-roster
    // branch, not its nonempty-roster/foreign-focused-student heading.
    else await ui(tab.getByText("No student is currently linked to this role. Ask the congregation for help with your assignment.", { exact: true })).toBeVisible();
    const deniedStatus = await safe(() => tab.evaluate(async id => (await fetch(`/api/students/${id}/reading?mode=tutor`, { cache: "no-store" })).status, fixture.student.id));
    expect(deniedStatus).toBe(failure === "session" ? 401 : 404);
    expect(await modalCount(tab)).toBe(0); expect(await tab.locator("dialog.editor-sheet, .service-plan-editor, .study-hebrew").count()).toBe(0);
    expect(await tab.evaluate(() => !document.body.textContent?.includes("Keep this service draft?") && !document.body.textContent?.includes("Synthetic part 1") && !JSON.stringify({ local: { ...localStorage }, tab: { ...sessionStorage } }).includes("Genesis 1:1-2"))).toBe(true);
    expect(writes).toEqual({ confirm: 0, note: 0 }); await hold.remove();
    if (failure === "session") { await safe(() => tab.getByRole("link", { name: "Sign in", exact: true }).click()); await ui(tab).toHaveURL(`${BROWSER_ORIGIN}/sign-in`); }
    else { await safe(() => tab.getByRole("navigation", { name: "Workspace roles", exact: true }).getByRole("link", { name: "Parent", exact: true }).click()); await ui(tab.getByRole("list", { name: "Child", exact: true })).toBeVisible(); expect(await modalCount(tab)).toBe(0); }
    await safe(() => tab.context().close());
  }
});
