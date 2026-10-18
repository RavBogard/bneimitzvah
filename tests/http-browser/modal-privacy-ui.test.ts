import { isolatedEnv } from "../helpers/isolatedEnv.mjs";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { expect as ui } from "@playwright/test";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { eq } from "drizzle-orm";
import { browserFixture } from "./fixture";
import { BROWSER_ORIGIN, assertBrowserStartupAllowed, startBrowserServer } from "./server";
import { installLoopbackFetchGuard } from "./egress";
import { openAuthMail } from "./auth-navigation";
import { syntheticUiStudyPage } from "../helpers/study-ui";
import * as s from "../../src/server/db/index";
vi.mock("server-only", () => ({}));

let fixture: Awaited<ReturnType<typeof browserFixture>>, browser: Browser, stop: (() => Promise<void>) | undefined, restore: (() => void) | undefined;
let browserEnv: Awaited<ReturnType<typeof isolatedEnv>> | undefined;
const contexts: BrowserContext[] = [];
async function safe<T>(action: () => Promise<T>): Promise<T> { try { return await action(); } catch { throw new Error("Modal privacy browser operation failed; private details withheld"); } }
async function click(tab: Page, name: string) { await safe(() => tab.getByRole("button", { name, exact: true }).click()); }
const editor = (tab: Page) => tab.getByRole("dialog", { name: "Set the assigned reading", exact: true });
const departure = (tab: Page) => tab.getByRole("dialog", { name: "Review work before leaving", exact: true });
async function page() {
  const context = await browser.newContext({ baseURL: BROWSER_ORIGIN, serviceWorkers: "block", acceptDownloads: false, viewport: { width: 390, height: 844 }, reducedMotion: "reduce" }); contexts.push(context);
  await context.route("**/*", async route => { try { if (new URL(route.request().url()).origin === BROWSER_ORIGIN) await route.continue(); else await route.abort(); } catch { await route.abort(); } });
  const tab = await context.newPage(); await safe(() => tab.goto("/", { waitUntil: "domcontentloaded" }));
  expect(await safe(() => tab.evaluate(async () => (await fetch("/api/auth/sign-in/magic-link", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "pg-tutor@example.test" }) })).status))).toBe(200);
  await openAuthMail(tab, fixture.takeMail("pg-tutor@example.test"));
  await safe(() => tab.goto(`/workspace/tutor/${fixture.student.id}`, { waitUntil: "domcontentloaded" }));
  await ui(tab.locator(".study-verses").getByRole("heading", { name: "Genesis 1:1", exact: true })).toBeVisible(); return tab;
}
async function pendingDeparture(tab: Page, draft: string) {
  const verse = tab.locator(".verse-work").first(); await safe(() => verse.locator("summary").click());
  await safe(() => verse.getByRole("button", { name: "Student-visible notes", exact: true }).click());
  await safe(() => verse.getByRole("textbox").fill(draft));
  await click(tab, "Change verses"); await ui(editor(tab)).toBeVisible();
  await safe(() => tab.getByLabel("Passage", { exact: true }).selectOption("custom"));
  await safe(() => tab.getByText("Advanced references and aliyah boundaries", { exact: true }).click());
  await safe(() => tab.getByLabel("Custom verse ranges", { exact: true }).fill("Genesis 1:1-2"));
  await click(tab, "Review reading"); await ui(tab.getByRole("button", { name: "Confirm assigned reading", exact: true })).toBeEnabled();
  await click(tab, "Confirm assigned reading"); await ui(departure(tab)).toBeVisible(); await ui(editor(tab)).toBeHidden();
  expect(await tab.evaluate(() => document.querySelectorAll("dialog:modal").length)).toBe(1);
}
beforeAll(async () => {
  try {
    assertBrowserStartupAllowed(); restore = installLoopbackFetchGuard(); fixture = await browserFixture({ studyLoad: async request => syntheticUiStudyPage(request) });
    const { sibling } = await fixture.practice();
    await fixture.ownerDb.insert(s.tutorStudent).values({ tenantId: "crc", studentId: sibling.id, tutorGrantId: fixture.tutorGrant.id });
    await fixture.ownerDb.update(s.student).set({ serviceSlot: "morning" }).where(eq(s.student.id, fixture.student.id));
    const [member] = await fixture.ownerDb.select().from(s.membership).where(eq(s.membership.userId, fixture.admin.id));
    const [assignment] = await fixture.ownerDb.insert(s.assignment).values({ tenantId: "crc", studentId: fixture.student.id, kind: "torah", basis: "custom", ref: "Genesis 1:1-3", status: "confirmed", setByMembershipId: member.id, proposalSnapshot: { ranges: ["Genesis 1:1-3"], confirmationDate: "2027-01-02", needsReview: true } }).returning();
    await fixture.ownerDb.insert(s.assignmentVerse).values([1, 2, 3].map(ordinal => ({ tenantId: "crc", studentId: fixture.student.id, assignmentId: assignment.id, ordinal, verseRef: `Genesis 1:${ordinal}` })));
    stop = await startBrowserServer(fixture.withRuntime); browserEnv = await isolatedEnv(); browser = await chromium.launch({ headless: true, env: browserEnv.env });
  } catch { await browser?.close().catch(() => undefined); await stop?.().catch(() => undefined); await fixture?.close().catch(() => undefined); restore?.(); await browserEnv?.cleanup(); throw new Error("Modal privacy setup failed; private details withheld"); }
}, 120_000);
afterAll(async () => { await Promise.all(contexts.map(context => context.close().catch(() => undefined))); await browser?.close().catch(() => undefined); await stop?.().catch(() => undefined); await fixture?.close().catch(() => undefined); restore?.(); await browserEnv?.cleanup(); }, 120_000);

it("retains the sole rightful departure modal during a quiet check without confirming or losing its guarded editor and note", async () => {
  const tab = await page(), draft = "Synthetic same-authority modal privacy draft";
  let writes = 0; tab.on("request", request => { if (request.method() === "POST" && /\/(reading\/confirm|work\/note)$/.test(new URL(request.url()).pathname)) writes++; });
  await pendingDeparture(tab, draft);
  let release!: () => void, held = false, delivered = 0; const gate = new Promise<void>(resolve => { release = resolve; });
  await tab.route("**/api/session", async route => { const response = await route.fetch(); held = true; await gate; await route.fulfill({ response }).catch(() => undefined); delivered++; });
  try {
    await safe(() => tab.evaluate(() => window.dispatchEvent(new Event("focus")))); await ui.poll(() => held).toBe(true);
    await ui(tab.getByRole("heading", { name: "Checking your access", exact: true })).toBeHidden();
    expect(await tab.evaluate(() => document.querySelectorAll("dialog:modal").length)).toBe(1);
    await ui(departure(tab)).toBeVisible(); await ui(editor(tab)).toBeHidden(); expect(writes).toBe(0);
  } finally { release(); }
  await ui.poll(() => delivered).toBeGreaterThanOrEqual(4); await ui(departure(tab)).toBeVisible(); await ui(editor(tab)).toBeHidden();
  expect(await tab.evaluate(() => document.querySelectorAll("dialog:modal").length)).toBe(1);
  await ui(tab.getByRole("button", { name: "Keep working", exact: true })).toBeFocused();
  // A real click proves the pending decision remains above the retained sheet.
  await click(tab, "Keep working"); await ui(departure(tab)).toBeHidden(); await ui(editor(tab)).toBeVisible();
  expect(await editor(tab).evaluate(node => node.contains(document.activeElement))).toBe(true);
  await ui(tab.getByLabel("Custom verse ranges", { exact: true })).toHaveValue("Genesis 1:1-2");
  await safe(() => tab.keyboard.press("Escape")); await ui(editor(tab)).toBeHidden();
  await ui(tab.getByRole("button", { name: "Change verses", exact: true })).toBeFocused();
  // The retained note stream remains independently selectable after the guard.
  const notePanel = tab.locator(".verse-work").first();
  await safe(() => notePanel.getByRole("button", { name: "Student-visible notes", exact: true }).click());
  await ui(notePanel.getByRole("textbox")).toHaveValue(draft);
  await click(tab, "Change verses"); await ui(tab.getByLabel("Custom verse ranges", { exact: true })).toHaveValue("Genesis 1:1-2");
  expect(writes).toBe(0); await tab.unroute("**/api/session");
});

it("clears nested private dialogs on real session expiry and tutor revocation, leaving public or authorized recovery usable", async () => {
  for (const failure of ["session", "relationship"] as const) {
    const tab = await page(), draft = `Synthetic revoked ${failure} modal privacy draft`;
    let confirmations = 0; tab.on("request", request => { if (request.method() === "POST" && new URL(request.url()).pathname.endsWith("/reading/confirm")) confirmations++; });
    await pendingDeparture(tab, draft);
    if (failure === "session") await fixture.ownerDb.update(s.session).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(s.session.userId, fixture.tutor.id));
    else await fixture.ownerDb.update(s.tutorStudent).set({ revokedAt: new Date() }).where(eq(s.tutorStudent.id, fixture.link.id));
    await safe(() => tab.evaluate(() => window.dispatchEvent(new Event("focus"))));
    await ui(tab.getByRole("heading", { name: failure === "session" ? "Sign in to continue" : "Student not found", exact: true })).toBeVisible();
    expect(await tab.evaluate(value => document.querySelectorAll("dialog:modal, .editor-sheet, .verse-work, .study-hebrew").length === 0 && !document.body.textContent?.includes(value) && !JSON.stringify({ local: { ...localStorage }, tab: { ...sessionStorage } }).includes(value), draft)).toBe(true);
    expect(confirmations).toBe(0);
    if (failure === "session") {
      await safe(() => tab.getByRole("link", { name: "Sign in", exact: true }).click()); await ui(tab).toHaveURL(`${BROWSER_ORIGIN}/sign-in`);
    } else {
      await safe(() => tab.getByRole("navigation", { name: "Workspace roles", exact: true }).getByRole("link", { name: "Parent", exact: true }).click());
      await ui(tab.getByRole("list", { name: "Child", exact: true })).toBeVisible();
      expect(await tab.evaluate(value => !document.body.textContent?.includes(value) && document.querySelectorAll("dialog:modal").length === 0, draft)).toBe(true);
    }
    await safe(() => tab.context().close());
  }
});
