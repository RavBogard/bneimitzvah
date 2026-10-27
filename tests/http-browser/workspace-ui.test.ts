import { observeSilentAudio, expectSilentAudio, observeInitialShortPage } from "./audio-observation";
import { openAuthMail, switchRole } from "./auth-navigation";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { expect as ui } from "@playwright/test";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { browserFixture } from "./fixture";
import { BROWSER_ORIGIN, assertBrowserStartupAllowed, startBrowserServer } from "./server";
import { installLoopbackFetchGuard } from "./egress";
import { syntheticUiStudyPage } from "../helpers/study-ui";
import * as s from "../../src/server/db/index";
vi.mock("server-only", () => ({}));

let fixture: Awaited<ReturnType<typeof browserFixture>>, browser: Browser, stop: (() => Promise<void>) | undefined, restore: (() => void) | undefined;
let sibling: { id: string };
const heldShortPages = new WeakMap<Page, ReturnType<typeof observeInitialShortPage>>();
const contexts: BrowserContext[] = [];
async function safe<T>(action: () => Promise<T>): Promise<T> { try { return await action(); } catch { throw new Error("Workspace browser operation failed; private details withheld"); } }
async function navigate(tab: Page, path: string) { await safe(() => tab.goto(path, { waitUntil: "domcontentloaded", timeout: 30_000 })); }
const heldMetadata = new WeakMap<Page, { count: number }>();
function observeHeldMetadata(tab: Page) {
  const seen = { count: 0 }; heldMetadata.set(tab, seen);
  tab.on("request", request => { if (/\/(?:reference-audio|reading\/explore\/reference)\//.test(new URL(request.url()).pathname)) seen.count++; });
}
async function heldReading(tab: Page) {
  expect(heldMetadata.get(tab)!.count).toBe(0);
  expect(heldShortPages.get(tab)!.counts()).toEqual({ seen: 0, terminals: 0, pending: 0 });
  await expectSilentAudio(tab);
  expect(await tab.evaluate(() => (window as unknown as { silentAudioProbe: { elements: HTMLAudioElement[] } }).silentAudioProbe.elements.length)).toBe(0);
}
async function page(mobile = false) {
  const context = await browser.newContext({ baseURL: BROWSER_ORIGIN, serviceWorkers: "block", acceptDownloads: false, viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 } }); contexts.push(context);
  await observeSilentAudio(context);
  await context.route("**/*", async route => { try { if (new URL(route.request().url()).origin === BROWSER_ORIGIN) await route.continue(); else await route.abort(); } catch { await route.abort(); } });
  const tab = await context.newPage(); observeHeldMetadata(tab); heldShortPages.set(tab, observeInitialShortPage(tab)); return tab;
}
async function api(tab: Page, path: string, body?: unknown, handle?: string) {
  return safe(() => tab.evaluate(async ({ path, body, handle }) => {
    const headers: Record<string, string> = body === undefined ? {} : { "content-type": "application/json" };
    if (handle) headers["X-Practice-Context"] = handle;
    const response = await fetch(path, { method: body === undefined ? "GET" : "POST", body: body === undefined ? undefined : JSON.stringify(body), headers, cache: "no-store" });
    return { status: response.status, data: await response.json() };
  }, { path, body, handle }));
}
async function signIn(tab: Page, email: string) {
  await navigate(tab, "/"); expect((await api(tab, "/api/auth/sign-in/magic-link", { email })).status === 200).toBe(true);
  await openAuthMail(tab, fixture.takeMail(email));
}
async function capture(tab: Page, name: string) {
  if (process.env.CI) return;
  await ui(tab.locator("#workspace-main").getByRole("heading", { name: "Checking your access", exact: true })).toBeHidden();
  if (name === "workspace-admin-draft") await ui(tab.getByLabel("First name", { exact: true })).toBeVisible();
  else if (name === "workspace-admin-roster") await ui(tab.getByRole("button", { name: "Details for Synthetic revised Workspace", exact: true })).toBeVisible();
  else await ui(tab.getByRole("heading", { name: name.includes("empty-assignment") ? "Synthetic Sibling" : "Synthetic Learner", exact: true }).first()).toBeVisible();
  const directory = join(process.cwd(), ".impeccable", "review"); await mkdir(directory, { recursive: true });
  await safe(() => tab.screenshot({ path: join(directory, `${name}-${(tab.viewportSize()?.width ?? 0) < 640 ? "mobile" : "desktop"}.png`), fullPage: true }));
}
async function focus(tab: Page) { await safe(() => tab.evaluate(() => window.dispatchEvent(new Event("focus")))); }
async function checkedRefresh(tab: Page, trigger: () => Promise<unknown>) {
  let release!: () => void, seen = false;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const pattern = `${BROWSER_ORIGIN}/api/session`;
  await tab.route(pattern, async route => { seen = true; const response = await route.fetch(); await gate; await route.fulfill({ response }); });
  try {
    await trigger(); await ui.poll(() => seen).toBe(true);
    await ui(tab.locator("#workspace-main").getByRole("heading", { name: "Checking your access", exact: true })).toBeVisible();
    await ui(tab.getByLabel("First name", { exact: true })).toBeHidden();
  } finally { release(); }
  await ui(tab.locator("#workspace-main").getByRole("heading", { name: "Checking your access", exact: true })).toBeHidden();
  await tab.unroute(pattern);
}
beforeAll(async () => {
  try {
    assertBrowserStartupAllowed(); restore = installLoopbackFetchGuard(); fixture = await browserFixture({ referenceStudentRelease: false, studyLoad: async request => syntheticUiStudyPage(request) }); sibling = (await fixture.practice()).sibling;
    stop = await startBrowserServer(fixture.withRuntime); browser = await chromium.launch({ headless: true });
  } catch { await browser?.close().catch(() => undefined); await stop?.().catch(() => undefined); await fixture?.close().catch(() => undefined); restore?.(); throw new Error("Workspace browser setup failed; private details withheld"); }
}, 120_000);
afterAll(async () => { await Promise.all(contexts.map(context => context.close().catch(() => undefined))); await browser?.close().catch(() => undefined); await stop?.().catch(() => undefined); await fixture?.close().catch(() => undefined); restore?.(); }, 120_000);

it("retains a draft through same-session Zoom focus and visible return, then discards it for a new session with the same role", async () => {
  const tab = await page(); await signIn(tab, "pg-admin@example.test"); await navigate(tab, "/workspace/admin/students?tab=students");
  const prepared = await api(tab, `/api/students/${fixture.student.id}/reading/prepare`, { mode: "admin", ranges: ["Genesis 1:1-3"] });
  expect(prepared.status === 200 && prepared.data.status === "prepared").toBe(true);
  expect((await api(tab, `/api/students/${fixture.student.id}/reading/confirm`, { mode: "admin", binding: prepared.data.binding })).status === 200).toBe(true);
  await ui(tab.getByRole("button", { name: "Add student", exact: true })).toBeEnabled();
  await safe(() => tab.getByRole("button", { name: "Add student", exact: true }).click());
  await safe(() => tab.getByLabel("First name", { exact: true }).fill("Unsaved synthetic draft"));
  const quietCheck = async (trigger: () => Promise<unknown>) => {
    let release!: () => void, seen = false; const gate = new Promise<void>(resolve => { release = resolve; });
    const pattern = `${BROWSER_ORIGIN}/api/session`;
    await tab.route(pattern, async route => { seen = true; const response = await route.fetch(); await gate; await route.fulfill({ response }).catch(() => undefined); });
    try {
      await trigger(); await ui.poll(() => seen).toBe(true);
      await ui(tab.getByRole("heading", { name: "Checking your access", exact: true })).toBeHidden();
      await ui(tab.getByLabel("First name", { exact: true })).toBeVisible();
      await ui(tab.getByLabel("First name", { exact: true })).toHaveValue("Unsaved synthetic draft");
    } finally { release(); }
    await tab.waitForLoadState("networkidle"); await tab.unroute(pattern);
  };
  await quietCheck(() => focus(tab));
  await ui(tab.getByLabel("First name", { exact: true })).toBeVisible(); await ui(tab.getByLabel("First name", { exact: true })).toHaveValue("Unsaved synthetic draft");
  await safe(() => tab.evaluate(() => { Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" }); document.dispatchEvent(new Event("visibilitychange")); }));
  await ui(tab.getByLabel("First name", { exact: true })).toBeVisible();
  await quietCheck(() => safe(() => tab.evaluate(() => { Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" }); document.dispatchEvent(new Event("visibilitychange")); })));
  await ui(tab.getByLabel("First name", { exact: true })).toBeVisible(); await ui(tab.getByLabel("First name", { exact: true })).toHaveValue("Unsaved synthetic draft");
  await capture(tab, "workspace-admin-draft");
  const fresh = await page(); await signIn(fresh, "pg-admin@example.test");
  await tab.context().addCookies(await fresh.context().cookies()); await focus(tab);
  await ui(tab.getByLabel("First name", { exact: true })).toHaveCount(0);
  await ui(tab.getByRole("button", { name: "Add student", exact: true })).toBeVisible(); await ui(tab.getByRole("button", { name: "Add student", exact: true })).toBeEnabled();
  expect(await tab.getByLabel("First name", { exact: true }).count()).toBe(0);
  expect(await tab.evaluate(() => !JSON.stringify({ local: { ...localStorage }, tab: { ...sessionStorage } }).includes("Unsaved synthetic draft"))).toBe(true);
});

it("creates and edits a real roster record, blocks stale409 overwrite and leaves delayed mutation outcomes uncertain", async () => {
  const tab = await page(true); await signIn(tab, "pg-admin@example.test"); await navigate(tab, "/workspace/admin/students?tab=students");
  await safe(() => tab.getByRole("button", { name: "Add student", exact: true }).click());
  for (const [label, value] of [["First name", "Synthetic"], ["Last name", "Workspace"], ["Ceremony date", "2027-01-02"], ["Parent email", "workspace-parent@example.test"]]) await safe(() => tab.getByLabel(label, { exact: true }).fill(value));
  await safe(() => tab.getByRole("button", { name: "Save student", exact: true }).click());
  await ui(tab.getByRole("button", { name: "Edit details for Synthetic Workspace", exact: true })).toBeVisible();
  await safe(() => tab.getByRole("button", { name: "Edit details for Synthetic Workspace", exact: true }).click());
  await safe(() => tab.getByLabel("First name", { exact: true }).fill("Draft retained"));
  const current = (await api(tab, "/api/admin/students")).data.students.find((row: { lastName: string }) => row.lastName === "Workspace");
  expect(Boolean(current)).toBe(true);
  await fixture.ownerDb.update(s.student).set({ revision: current.revision + 1 }).where(eq(s.student.id, current.id));
  await safe(() => tab.getByRole("button", { name: "Save student", exact: true }).click());
  await ui(tab.getByRole("dialog").getByRole("alert")).toContainText("since you opened it"); await ui(tab.getByRole("button", { name: "Save student", exact: true })).toBeDisabled();
  await safe(() => tab.getByRole("dialog").getByRole("button", { name: "Reload roster", exact: true }).click());
  await ui(tab.getByText("Someone changed this student since you opened it. Nothing was overwritten. Reload the roster to see the current details.", { exact: true })).toBeHidden();
  await ui(tab.getByRole("dialog")).toBeHidden();
  await safe(() => tab.getByRole("button", { name: "Edit details for Synthetic Workspace", exact: true }).click());
  await safe(() => tab.getByLabel("First name", { exact: true }).fill("Synthetic revised"));
  let release!: () => void, mutations = 0; const gate = new Promise<void>(resolve => { release = resolve; });
  await tab.route("**/api/admin/students/*/edit", async route => { mutations++; const response = await route.fetch(); await gate; await route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"unavailable"}' }); await response.dispose(); });
  try {
    await safe(() => tab.getByRole("button", { name: "Save student", exact: true }).click()); await ui.poll(() => mutations).toBe(1);
    await focus(tab);
  } finally { release(); }
  await ui(tab.getByRole("button", { name: "Save student", exact: true })).toBeDisabled(); expect(mutations).toBe(1);
  // Either outcome message is honest here (the write may have landed); both block saving until a reload.
  await ui(tab.getByRole("dialog").getByRole("alert")).toHaveText(/^(We couldn’t confirm whether this saved|This student changed while you were away)/);
  await safe(() => tab.getByRole("dialog").getByRole("button", { name: "Reload roster", exact: true }).click());
  await ui(tab.getByRole("button", { name: "Edit details for Synthetic revised Workspace", exact: true })).toBeVisible();
  expect(await tab.getByText(/Your draft is kept here but can’t be saved/).count()).toBe(0);
  await safe(() => tab.getByRole("button", { name: "Edit details for Synthetic revised Workspace", exact: true }).click());
  await safe(() => tab.getByRole("button", { name: "Disable student", exact: true }).click());
  await safe(() => tab.getByRole("button", { name: "Confirm disable", exact: true }).click());
  const rows = tab.getByRole("list", { name: "Students", exact: true }).getByRole("listitem");
  const disabledRow = rows.filter({ has: tab.getByRole("button", { name: "Details for Synthetic revised Workspace", exact: true }) });
  await ui(disabledRow.getByText("Disabled", { exact: true })).toBeVisible();
  expect(await disabledRow.getByRole("link").filter({ hasText: "Synthetic revised Workspace" }).count()).toBe(0);
  await ui(tab.getByText("Synthetic revised Workspace is disabled. Their record stays in the list.", { exact: true })).toBeVisible();
  await safe(() => tab.getByRole("button", { name: "Details for Synthetic revised Workspace", exact: true }).click());
  await ui(tab.getByText("This student is disabled. Their record is kept for reference; editing and reactivation aren’t offered here.", { exact: true })).toBeVisible();
  expect(await tab.getByRole("button", { name: "Save student", exact: true }).count()).toBe(0);
  expect(await tab.getByRole("button", { name: "Disable student", exact: true }).count()).toBe(0);
  await safe(() => tab.getByRole("button", { name: "Close student details", exact: true }).click());
  // Active students carry no status chip and link to their page.
  await ui(rows.filter({ hasNot: tab.getByText("Disabled", { exact: true }) }).first().getByRole("link").first()).toBeVisible();
  await capture(tab, "workspace-admin-roster");
  expect(await tab.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

it("keeps sibling tab handles isolated, rejects a copied practice URL and discards delayed old-child reads after switching", async () => {
  const tab = await page(); await signIn(tab, "pg-tutor@example.test"); await navigate(tab, "/workspace/parent");
  await safe(() => tab.getByLabel("Child", { exact: true }).locator(`[data-student-id="${fixture.student.id}"]`).click());
  await ui(tab.getByRole("heading", { name: "Synthetic Learner", exact: true })).toBeVisible();
  // Once a child is chosen the page is about that child: no "Choose a child" heading or line is left.
  await ui(tab.getByRole("heading", { name: /^Choose a child/ })).toHaveCount(0); await ui(tab.getByText("Choose a child to see their reading.", { exact: true })).toHaveCount(0);
  const copied = await tab.context().newPage(); await navigate(copied, `/workspace/practice/${fixture.student.id}`);
  await ui(copied.getByLabel("Child", { exact: true })).toBeVisible();
  let rawHandle = "";
  await tab.route("**/api/practice/enter", async route => { const response = await route.fetch(); rawHandle = (await response.json()).handle; await route.fulfill({ response }); });
  await safe(() => tab.getByRole("button", { name: "Practice with Synthetic", exact: true }).click());
  await ui(tab.getByRole("heading", { name: /^Practising with /, level: 1 })).toBeVisible();
  await ui(tab.getByText("Genesis 1:1\u20133", { exact: true })).toBeVisible();
  await capture(tab, "workspace-child-confirmed-reading");
  await tab.setViewportSize({ width: 390, height: 844 });
  await safe(() => tab.getByRole("button", { name: "Refresh reading", exact: true }).focus());
  await safe(() => tab.keyboard.press("Tab"));
  await ui(tab.getByRole("button", { name: "Start reading", exact: true }), "First Tab after Refresh reaches Start").toBeFocused();
  await ui(tab.locator(".study-verses").getByRole("heading", { name: "Genesis 1:1", exact: true })).toBeVisible();
  await safe(() => tab.keyboard.press("Enter"));
  await ui(tab.locator(".study-verses"), "Held Start focuses the current flowing text").toBeFocused();
  await heldReading(tab); await ui(tab.getByRole("region", { name: "Reading playback", exact: true })).toHaveCount(0);
  await ui(tab.getByRole("dialog")).toHaveCount(0);
  await safe(() => tab.keyboard.press("Escape"));
  await ui(tab.getByRole("dialog")).toHaveCount(0);
  await ui(tab.locator(".study-verses"), "Held Start keeps the flowing text focused without requiring a dialog").toBeFocused(); await heldReading(tab);
  expect(await tab.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await capture(tab, "workspace-child-confirmed-reading");
  await tab.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
  expect(await tab.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await capture(tab, "workspace-child-confirmed-reading-zoom");
  await tab.evaluate(() => { document.documentElement.style.fontSize = ""; });
  await tab.setViewportSize({ width: 1440, height: 1000 });
  await safe(() => copied.getByLabel("Child", { exact: true }).locator(`[data-student-id="${sibling.id}"]`).click()); await safe(() => copied.getByRole("button", { name: "Practice with Synthetic", exact: true }).click());
  await ui(copied.getByRole("heading", { name: "Synthetic Sibling", exact: true })).toBeVisible();
  let release!: () => void, held = false; const gate = new Promise<void>(resolve => { release = resolve; });
  await tab.route(`**/api/students/${fixture.student.id}/reading?mode=child-practice`, async route => { const response = await route.fetch(); held = true; await gate; await route.fulfill({ response }).catch(() => undefined); });
  // Hold one real old-child response while switching; its private payload must
  // not replace the later child view when released.
  await safe(() => tab.getByRole("button", { name: "Refresh reading", exact: true }).click()); await ui.poll(() => held).toBe(true);
  try {
    await safe(() => tab.getByRole("button", { name: "Switch to Synthetic Sibling", exact: true }).click());
    await ui(tab.getByRole("heading", { name: "Synthetic Sibling", exact: true })).toBeVisible();
  } finally { release(); }
  await tab.unroute(`**/api/students/${fixture.student.id}/reading?mode=child-practice`);
  await ui(tab.getByRole("heading", { name: "Synthetic Learner", exact: true })).toBeHidden();
  expect((await api(tab, `/api/practice/read?mode=child-practice&studentId=${fixture.student.id}`, undefined, rawHandle)).status === 404).toBe(true);
  await focus(copied); await ui(copied.getByRole("heading", { name: "Synthetic Sibling", exact: true })).toBeVisible();
  expect(await tab.evaluate(handle => !location.href.includes(handle) && !document.body.textContent?.includes(handle) && !JSON.stringify({ local: { ...localStorage }, tab: { ...sessionStorage } }).includes(handle), rawHandle)).toBe(true);
  await capture(tab, "workspace-child-practice-empty-assignment");
  await safe(() => tab.getByRole("button", { name: "Done", exact: true }).click()); await ui(tab.getByLabel("Child", { exact: true })).toBeVisible();
  await ui(tab.locator("#workspace-main").getByText("You’re back in your read-only parent view.", { exact: true })).toBeVisible();
  await ui(copied.getByRole("heading", { name: "Synthetic Sibling", exact: true })).toBeVisible();
  await safe(() => switchRole(tab, "Tutor"));
  await safe(() => tab.getByLabel("Student", { exact: true }).locator(`[data-student-id="${fixture.student.id}"]`).click());
  await ui(tab.getByRole("region", { name: "Assigned reading", exact: true }).locator(".reading-reference").getByText("Genesis 1:1-3", { exact: true })).toBeVisible();
  expect(await tab.locator("#workspace-main").getByText("You’re back in your read-only parent view.", { exact: true }).count()).toBe(0);
  expect(await tab.getByRole("button", { name: "Practice with Synthetic", exact: true }).count()).toBe(0);
  // A real exit response arriving after role navigation must neither announce
  // parent mode nor send the active tutor back to the parent workspace.
  await safe(() => switchRole(tab, "Parent"));
  await safe(() => tab.getByLabel("Child", { exact: true }).locator(`[data-student-id="${fixture.student.id}"]`).click());
  await safe(() => tab.getByRole("button", { name: "Practice with Synthetic", exact: true }).click());
  await ui(tab.getByRole("heading", { name: /^Practising with /, level: 1 })).toBeVisible();
  let finishExit!: () => void, exitHeld = false, exitDelivered = false;
  const exitGate = new Promise<void>(resolve => { finishExit = resolve; });
  await tab.route("**/api/practice/exit", async route => { const response = await route.fetch(); exitHeld = true; await exitGate; await route.fulfill({ response }); exitDelivered = true; });
  await safe(() => tab.getByRole("button", { name: "Done", exact: true }).click());
  try {
    await ui.poll(() => exitHeld).toBe(true);
    await safe(() => switchRole(tab, "Tutor"));
    await ui(tab.getByRole("heading", { name: "Your assigned students", level: 1, exact: true })).toBeVisible();
  } finally { finishExit(); }
  await ui.poll(() => exitDelivered).toBe(true); await tab.unroute("**/api/practice/exit");
  await safe(() => tab.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))));
  await ui(tab).toHaveURL(`${BROWSER_ORIGIN}/workspace/tutor`);
  expect(await tab.locator("#workspace-main").getByText(/read-only parent view|server closure could not be confirmed/).count()).toBe(0);
  await safe(() => tab.getByLabel("Student", { exact: true }).locator(`[data-student-id="${fixture.student.id}"]`).click());
  await ui(tab.getByRole("region", { name: "Assigned reading", exact: true }).locator(".reading-reference").getByText("Genesis 1:1-3", { exact: true })).toBeVisible();
  await capture(tab, "workspace-tutor-reading");
});
