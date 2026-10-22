import { isolatedEnv } from "../helpers/isolatedEnv.mjs";
import { openAuthMail } from "./auth-navigation";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { expect as ui } from "@playwright/test";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { browserFixture } from "./fixture";
import { BROWSER_ORIGIN, assertBrowserStartupAllowed, startBrowserServer } from "./server";
import { installLoopbackFetchGuard } from "./egress";
import * as s from "../../src/server/db/index";
import { installReadingRouteGuard, readingRouteCleanupError, routePageStep } from "./reading-route-guard";
vi.mock("server-only", () => ({}));

let fixture: Awaited<ReturnType<typeof browserFixture>>, browser: Browser, stop: (() => Promise<void>) | undefined, restore: (() => void) | undefined;
let browserEnv:Awaited<ReturnType<typeof isolatedEnv>>|undefined;
const contexts: BrowserContext[] = [];
const routeGuards = new Map<BrowserContext, Awaited<ReturnType<typeof installReadingRouteGuard>>>();
const cookies = new Map<"admin" | "tutor", Awaited<ReturnType<BrowserContext["cookies"]>>>();
async function safe<T>(action: () => Promise<T>): Promise<T> { try { return await action(); } catch { throw new Error("Reading UI browser operation failed; private details withheld"); } }
async function navigate(tab: Page, path: string) { await safe(() => tab.goto(path, { waitUntil: "domcontentloaded", timeout: 30_000 })); }
async function page(role: "admin" | "tutor", mobile = false) {
  const context = await browser.newContext({ baseURL: BROWSER_ORIGIN, serviceWorkers: "block", acceptDownloads: false, viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 } }); contexts.push(context);
  routeGuards.set(context, await installReadingRouteGuard(context, BROWSER_ORIGIN));
  const signedIn = cookies.get(role); if (signedIn) await context.addCookies(signedIn);
  const tab = await context.newPage(); await navigate(tab, "/");
  if (signedIn) return tab;
  const email = role === "admin" ? "pg-admin@example.test" : "pg-tutor@example.test";
  expect((await api(tab, "/api/auth/sign-in/magic-link", { email })).status).toBe(200); await openAuthMail(tab, fixture.takeMail(email));
  cookies.set(role, await context.cookies());
  return tab;
}
async function api(tab: Page, path: string, body?: unknown) {
  return safe(() => tab.evaluate(async ({ path, body }) => {
    const response = await fetch(path, { method: body === undefined ? "GET" : "POST", body: body === undefined ? undefined : JSON.stringify(body), headers: body === undefined ? {} : { "content-type": "application/json" }, cache: "no-store" });
    return { status: response.status, data: await response.json() };
  }, { path, body }));
}
const main = (tab: Page) => tab.locator("#workspace-main");
async function click(tab: Page, name: string) { await safe(() => tab.getByRole("button", { name, exact: true }).click()); }
async function capture(tab: Page, name: string) {
  if (process.env.CI) return;
  await ui(main(tab).getByRole("heading", { name: "Checking your access", level: 1, exact: true })).toBeHidden();
  await ui(tab.getByRole("heading", { name: "Set the assigned reading", level: 2, exact: true })).toBeVisible();
  if (name.includes("prepared")) await ui(tab.getByRole("button", { name: "Save assignment", exact: true })).toBeEnabled();
  if (name.includes("confirmed")) await ui(main(tab).getByText("Saved. The current reading above shows what the student will see.", { exact: true })).toBeVisible();
  if (name.includes("conflict")) await ui(main(tab).getByRole("alert")).toContainText("changed after this review");
  expect(await tab.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const directory = join(process.cwd(), ".impeccable", "review"); await mkdir(directory, { recursive: true });
  // An open sheet scrolls inside itself, so it is captured at the outcome rather than as a full page.
  const sheet = tab.locator("dialog.editor-sheet[open]");
  if (await sheet.count()) {
    const outcome = name.includes("prepared") ? sheet.getByRole("button", { name: "Save assignment", exact: true }) : name.includes("conflict") ? sheet.getByRole("alert") : sheet.getByText(/^Saved\. The current reading/);
    await safe(() => outcome.evaluate(node => node.scrollIntoView({ block: "center" })));
    await safe(() => tab.screenshot({ path: join(directory, `${name}.png`) }));
  } else await safe(() => tab.screenshot({ path: join(directory, `${name}.png`), fullPage: true }));
}
// Tutors change verses in a sheet over the reading; admin keeps the inline editor.
async function openEditor(tab: Page) { await safe(() => tab.getByRole("button", { name: /^(Change|Assign) verses$/ }).click()); await ui(tab.getByRole("dialog", { name: "Set the assigned reading" })).toBeVisible(); await ui(tab.locator(".reading-editor").getByText(/^Calendar:/)).toBeVisible(); }
async function closeEditor(tab: Page) { await click(tab, "Close verse editor"); await ui(tab.getByRole("dialog", { name: "Set the assigned reading" })).toBeHidden(); }
async function custom(tab: Page, value: string) { await safe(() => tab.getByLabel("Passage", { exact: true }).selectOption("custom")); const advanced = tab.locator("details").filter({ has: tab.getByText("Advanced references and aliyah boundaries", { exact: true }) }); if (!await advanced.getAttribute("open").then(value => value !== null)) await safe(() => advanced.locator(":scope > summary").click()); await safe(() => tab.getByLabel("Custom verse ranges", { exact: true }).fill(value)); }
beforeAll(async () => {
  try { assertBrowserStartupAllowed(); restore = installLoopbackFetchGuard(); fixture = await browserFixture({ emptyReadingDate: "2027-01-09" }); await fixture.ownerDb.update(s.student).set({serviceSlot:"morning"}).where(eq(s.student.id,fixture.student.id)); stop = await startBrowserServer(fixture.withRuntime); browserEnv=await isolatedEnv(); browser = await chromium.launch({ headless: true, env:browserEnv.env }); }
  catch { await browser?.close().catch(() => undefined); await stop?.().catch(() => undefined); await fixture?.close().catch(() => undefined); restore?.(); await browserEnv?.cleanup(); throw new Error("Reading UI setup failed; private details withheld"); }
}, 120_000);
afterAll(async () => {
  const closed = await Promise.allSettled(contexts.map(context => routeGuards.get(context)?.close() ?? context.close()));
  await browser?.close().catch(() => undefined); await stop?.().catch(() => undefined); await fixture?.close().catch(() => undefined); restore?.(); await browserEnv?.cleanup();
  const cleanupError = readingRouteCleanupError(closed); if (cleanupError) throw cleanupError;
}, 120_000);

it("lets an admin review actual calendar choices, confirm once and replace only after authoritative reload", async () => {
  const tab = await page("admin"); await navigate(tab, "/workspace/admin/students");
  await safe(() => tab.getByRole("list", { name: "Students", exact: true }).getByRole("link", { name: /^Synthetic Learner/ }).click());
  await openEditor(tab);
  await ui(tab.getByLabel("Passage",{exact:true})).toHaveValue("custom");
  await ui(tab.getByLabel("Passage", { exact: true }).getByRole("option", { name: /Triennial/ })).toHaveCount(0);
  await safe(() => tab.getByLabel("Passage", { exact: true }).selectOption("aliyah:1"));
  expect(await tab.getByRole("button", { name: "Save assignment", exact: true }).count()).toBe(0);
  await click(tab, "Review assignment");
  await ui(tab.getByRole("heading", { name: "Explore the full Torah portion", level: 3, exact: true })).toBeVisible();
  await capture(tab, "reading-admin-prepared-desktop");
  let confirmations = 0;
  const counted = await routePageStep(tab, "**/reading/confirm", async route => { confirmations++; const response = await route.fetch(); await route.fulfill({ response }); });
  await safe(() => tab.getByRole("button", { name: "Save assignment", exact: true }).evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); }));
  await ui(main(tab).getByText("Saved. The current reading above shows what the student will see.", { exact: true })).toBeVisible();
  expect(confirmations).toBe(1);
  await ui(tab.locator(".confirmed-reading").getByText("Genesis 1:31-2:2", { exact: true })).toBeVisible();
  await capture(tab, "reading-admin-confirmed-desktop");
  await counted.remove();
  const haftarahPreparations: Record<string, unknown>[] = [];
  tab.on("request", request => { if (request.method() === "POST" && new URL(request.url()).pathname.endsWith("/reading/prepare")) haftarahPreparations.push(request.postDataJSON()); });
  await safe(()=>tab.getByRole("combobox", { name: "Reading", exact: true }).selectOption("haftarah"));
  await ui(tab.getByLabel("Passage", { exact: true })).toHaveValue("custom");
  await ui(tab.getByLabel("Custom verse ranges", { exact: true })).toHaveValue("");
  await ui(tab.locator(".reading-editor").getByText(/^Calendar:/)).toBeVisible();
  // Each kind has its own draft. Empty custom passages use native validation;
  // the automatic suggestion read must not stage or inherit a Torah choice.
  await click(tab,"Review assignment");
  expect(await tab.getByLabel("Book", { exact: true }).evaluate(field => (field as HTMLSelectElement).validity.valueMissing)).toBe(true);
  expect(haftarahPreparations).toEqual([{ mode: "admin", kind: "haftarah" }]);
  expect(await tab.getByRole("button",{name:"Save assignment",exact:true}).count()).toBe(0);
  await safe(() => tab.getByLabel("Passage", { exact: true }).selectOption("calendar-haftarah"));
  await click(tab, "Review assignment");
  await click(tab,"Save assignment");
  await ui(main(tab).getByText("Saved. The current reading above shows what the student will see.", { exact: true })).toBeVisible();
  await closeEditor(tab);
  // The practice panel keeps Torah selected; Haftarah is intentionally in the
  // secondary assignment disclosure until the user opens it.
  const other=tab.locator(".reading-other-assignments");
  await ui(other).toBeVisible();await safe(()=>other.locator(":scope > summary").click());
  await ui(other.getByRole("heading",{name:"Haftarah",exact:true})).toBeVisible();
  await ui(other.getByText("Isaiah 1:1-2",{exact:true})).toBeVisible();
  await ui(tab.locator(".reading-current-assignment").getByText("Genesis 1:31-2:2",{exact:true})).toBeVisible();
});

it("retains a tutor draft during visible access revalidation, invalidates edited/stale reviews and never retries an uncertain confirmation", async () => {
  const tab = await page("tutor", true); await navigate(tab, "/workspace/tutor");
  await safe(() => tab.getByLabel("Student", { exact: true }).locator(`[data-student-id="${fixture.student.id}"]`).click()); await openEditor(tab); await custom(tab, "Genesis 1:1-3");
  let release!: () => void, held = false; const gate = new Promise<void>(resolve => { release = resolve; });
  let metadataSeen = false, finalSessions = 0;
  const observed = (response: import("playwright").Response) => { const path = new URL(response.url()).pathname;
    if (path === `/api/students/${fixture.student.id}/reading` && response.status() === 200) metadataSeen = true;
    if (metadataSeen && path === "/api/session" && response.status() === 200) finalSessions++;
  }; tab.on("response", observed);
  const sessions = await routePageStep(tab, "**/api/session", async route => { const response = await route.fetch(); held = true; await gate; await route.fulfill({ response }); });
  try {
    await safe(() => tab.evaluate(() => window.dispatchEvent(new Event("focus")))); await ui.poll(() => held).toBe(true);
    await ui(main(tab).getByRole("heading", { name: "Checking your access", level: 1, exact: true })).toBeHidden();
    await ui(tab.getByLabel("Custom verse ranges", { exact: true })).toBeVisible();
    await ui(tab.getByLabel("Custom verse ranges", { exact: true })).toHaveValue("Genesis 1:1-3");
  } finally { release(); }
  await ui.poll(() => finalSessions).toBeGreaterThanOrEqual(2); tab.off("response", observed);
  await ui(tab.getByLabel("Custom verse ranges", { exact: true })).toBeVisible(); await ui(tab.getByLabel("Custom verse ranges", { exact: true })).toHaveValue("Genesis 1:1-3");
  await sessions.remove();
  const [beforePrepare] = await fixture.ownerDb.select().from(s.student).where(eq(s.student.id, fixture.student.id));
  const admin = await page("admin");
  expect((await api(admin, `/api/admin/students/${beforePrepare.id}/edit`, { expectedRevision: beforePrepare.revision, student: {
    firstName: "Synthetic", lastName: "Learner", ceremonyDate: "2027-01-09", serviceSlot:"havdalah", parentEmail: "fixture@example.test"
  } })).status === 200).toBe(true);
  await click(tab, "Review assignment"); await ui(main(tab).getByRole("alert")).toContainText("changed while this review");
  expect(await tab.getByRole("button", { name: "Save assignment", exact: true }).count()).toBe(0);
  await click(tab, "Check what saved");
  await ui(tab.locator(".confirmed-reading")).toHaveCount(2); await closeEditor(tab);
  await safe(()=>tab.locator(".reading-other-assignments > summary").click());
  for(const kind of ["Torah","Haftarah"]){
    const assignment=tab.locator(".confirmed-reading").filter({has:tab.getByRole("heading",{name:kind,exact:true})});
    await ui(assignment.locator(".reading-review")).toContainText("Needs review with your tutor or rabbi");
    await ui(assignment.locator(".reading-review")).toBeVisible();
  }
  await ui(tab.getByLabel("Student", { exact: true }).locator('[aria-current="page"]')).toContainText(/Synthetic Learner\s*Sat, Jan 9, 2027/);
  await openEditor(tab); await ui(tab.getByLabel("Custom verse ranges", { exact: true })).toHaveValue("Genesis 1:1-3"); // The draft survives closing the sheet.
  await click(tab, "Review assignment"); await ui(tab.getByRole("button", { name: "Save assignment", exact: true })).toBeEnabled();
  await safe(() => tab.getByLabel("Custom verse ranges", { exact: true }).fill("Genesis 1:4-5")); expect(await tab.getByRole("button", { name: "Save assignment", exact: true }).count()).toBe(0);
  await click(tab, "Review assignment"); await ui(tab.getByRole("button", { name: "Save assignment", exact: true })).toBeEnabled();
  const [student] = await fixture.ownerDb.select().from(s.student).where(eq(s.student.id, fixture.student.id));
  expect((await api(admin, `/api/admin/students/${student.id}/edit`,{expectedRevision:student.revision,student:{firstName:student.firstName,lastName:student.lastName,ceremonyDate:student.ceremonyDate,serviceSlot:"morning",parentEmail:"fixture@example.test"}})).status).toBe(200);
  await click(tab, "Save assignment"); await ui(main(tab).getByRole("alert")).toContainText("changed after this review");
  await ui(tab.getByLabel("Custom verse ranges", { exact: true })).toHaveValue("Genesis 1:4-5"); await capture(tab, "reading-tutor-conflict-mobile");
  await click(tab, "Check what saved"); await click(tab, "Review assignment"); await capture(tab, "reading-tutor-prepared-mobile");
  await click(tab, "Save assignment");
  await ui(main(tab).getByText("Saved. The current reading above shows what the student will see.", { exact: true })).toBeVisible();
  await ui(tab.getByLabel("Student", { exact: true }).locator('[aria-current="page"]')).toContainText(/Synthetic Learner\s*Sat, Jan 9, 2027/);
  await capture(tab, "reading-tutor-confirmed-mobile");
  await custom(tab, "Genesis 1:6-7"); await click(tab, "Review assignment"); await ui(tab.getByRole("button", { name: "Save assignment", exact: true })).toBeEnabled();
  let mutations = 0;
  await routePageStep(tab, "**/reading/confirm", async route => { mutations++; const response = await route.fetch(); await response.dispose(); await route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"unavailable"}' }); });
  await click(tab, "Save assignment"); await ui(main(tab).getByRole("alert")).toContainText("may have saved");
  await safe(() => tab.evaluate(() => window.dispatchEvent(new Event("focus"))));
  await ui(tab.getByLabel("Custom verse ranges", { exact: true })).toBeVisible(); expect(mutations).toBe(1);
  await ui(tab.getByRole("button", { name: "Review assignment", exact: true })).toBeDisabled();
  await click(tab, "Check what saved"); await ui(tab.locator(".confirmed-reading").getByText("Genesis 1:6-7", { exact: true })).toBeVisible(); expect(mutations).toBe(1);
});

it("keeps the tutor sheet visible through prepare, confirm and local reload waits, rejecting immediate Escape and close until the outcome is visible", async () => {
  const tab = await page("tutor", true); await navigate(tab, `/workspace/tutor/${fixture.student.id}`); await openEditor(tab);
  await custom(tab, "Genesis 1:8-9");
  const sheet = tab.getByRole("dialog", { name: "Set the assigned reading", exact: true });
  const close = tab.getByRole("button", { name: "Close verse editor", exact: true });
  expect(await tab.locator("dialog.editor-sheet").evaluate(node => "closedBy" in node)).toBe(true);
  await safe(() => tab.locator("dialog.editor-sheet").evaluate(node => {
    const samples: object[] = [];
    for (const type of ["keydown", "cancel", "close"]) node.addEventListener(type, event => {
      if (type === "keydown" && (event as KeyboardEvent).key !== "Escape") return;
      queueMicrotask(() => {
        samples.push({ phase: type, cancelable: event.cancelable, prevented: event.defaultPrevented, open: (node as HTMLDialogElement).open, modal: node.matches(":modal"), concealed: Boolean(node.closest("[hidden], [inert]")), pending: Boolean(node.querySelector<HTMLButtonElement>(".sheet-close")?.disabled) });
        (node as HTMLElement).dataset.modalDiagnostics = JSON.stringify(samples.slice(-12));
      });
    });
  }));
  async function hold(pattern: string) {
    let release!: () => void, held = false; const gate = new Promise<void>(resolve => { release = resolve; });
    const step = await routePageStep(tab, pattern, async route => { const response = await route.fetch(); held = true; await gate; await route.fulfill({ response }).catch(() => undefined); });
    return { release, ready: () => ui.poll(() => held).toBe(true), remove: () => step.remove() };
  }
  async function rejectClosing(phase: string) {
    await safe(() => tab.keyboard.press("Escape"));
    const diagnostics = await tab.locator("dialog.editor-sheet").evaluate(node => ({ events: (node as HTMLElement).dataset.modalDiagnostics, open: (node as HTMLDialogElement).open, modal: node.matches(":modal"), concealed: Boolean(node.closest("[hidden], [inert]")), pending: Boolean(node.querySelector<HTMLButtonElement>(".sheet-close")?.disabled), labelled: Boolean(node.querySelector("#reading-editor-title")) }));
    await ui(sheet, `${phase}: ${JSON.stringify(diagnostics)}`).toBeVisible(); await ui(close, phase).toBeDisabled();
    await ui(sheet).toHaveAttribute("closedby", "none");
    // Exercise the scoped keyboard fallback without pretending to run another
    // browser: this Chromium run also asserts native closedBy support above.
    await safe(() => sheet.evaluate(node => node.removeAttribute("closedby")));
    await safe(() => tab.keyboard.press("Escape")); await safe(() => tab.keyboard.press("Escape")); await ui(sheet, `${phase}: keyboard fallback`).toBeVisible();
    await safe(() => sheet.evaluate(node => node.setAttribute("closedby", "none")));
    await safe(() => close.evaluate(node => (node as HTMLButtonElement).click())); await ui(sheet).toBeVisible();
    expect(await tab.evaluate(() => document.querySelectorAll("dialog:modal").length)).toBe(1);
  }
  const prepare = await hold("**/reading/prepare");
  try { await click(tab, "Review assignment"); await safe(() => tab.keyboard.press("Escape")); await prepare.ready(); await rejectClosing("prepare response held"); }
  finally { prepare.release(); }
  await ui(tab.getByRole("button", { name: "Save assignment", exact: true })).toBeEnabled(); await prepare.remove();
  // Synthetic phone/desktop review captures were already accepted from this
  // unchanged product source; this regression exercises behavior only.
  const confirm = await hold("**/reading/confirm"), reload = await hold("**/reading?**");
  try { await click(tab, "Save assignment"); await safe(() => tab.keyboard.press("Escape")); await confirm.ready(); await rejectClosing("confirm response held"); }
  finally { confirm.release(); }
  try { await reload.ready(); await ui(tab.getByText("Checking the current assignment, text and saved work…", { exact: true })).toBeVisible(); await rejectClosing("post-confirm metadata reload held"); }
  finally { reload.release(); }
  await ui(sheet.getByText("Saved. The current reading above shows what the student will see.", { exact: true })).toBeVisible();
  await confirm.remove(); await reload.remove();
  // Explicit recovery is offered only after a blocked review, not after a
  // successful confirmation. Exercise that real branch with a lost/stale
  // preparation response, while still sending the authorized server request.
  const stale = await routePageStep(tab, "**/reading/prepare", async route => {
    const response = await route.fetch(); await response.dispose();
    await route.fulfill({ status: 409, contentType: "application/json", body: '{"error":"conflict"}' });
  });
  await click(tab, "Review assignment"); await ui(sheet.getByRole("alert")).toContainText("changed while this review"); await stale.remove();
  const explicitReload = await hold("**/reading?**");
  try { await click(tab, "Check what saved"); await safe(() => tab.keyboard.press("Escape")); await explicitReload.ready(); await rejectClosing("explicit metadata reload held"); }
  finally { explicitReload.release(); }
  await ui(sheet.getByText("Showing what is saved now. Review the assignment again to make a change.", { exact: true })).toBeVisible(); await explicitReload.remove();
  await ui(close).toBeEnabled(); await ui(sheet).toHaveAttribute("closedby", "closerequest"); await safe(() => tab.keyboard.press("Escape")); await ui(sheet).toBeHidden();
  await ui(tab.getByRole("button", { name: "Change verses", exact: true })).toBeFocused();
  await openEditor(tab); await ui(tab.getByLabel("Custom verse ranges", { exact: true })).toHaveValue("Genesis 1:8-9"); await closeEditor(tab);
});

it("handles an empty calendar without invention and exposes no editor in parent or child-practice mode", async () => {
  const tab = await page("admin");
  const created = await api(tab, "/api/admin/students", { student: { firstName: "Synthetic", lastName: "Empty Calendar", ceremonyDate: "2027-01-09", parentEmail: "empty-calendar@example.test" } });
  expect(created.status === 201 || created.status === 200).toBe(true);
  await navigate(tab, `/workspace/admin/students/${created.data.id}/reading`); await ui(tab.locator(".hero-date")).toBeVisible(); await ui(tab.locator(".hero-slot")).toHaveCount(0); await openEditor(tab);
  await ui(tab.getByLabel("Passage",{exact:true})).toHaveValue("custom");
  await ui(tab.getByText(/^The service slot is not yet set\./)).toBeVisible();
  await ui(tab.getByText("No calendar selections are available. Choose your own verses.", { exact: true })).toBeVisible();
  await ui(tab.getByLabel("Passage", { exact: true }).getByRole("option")).toHaveCount(1);
  expect(await tab.getByRole("button", { name: "Save assignment", exact: true }).count()).toBe(0);
  await safe(() => tab.getByRole("combobox", { name: "Reading", exact: true }).selectOption("haftarah"));
  await ui(tab.getByLabel("Passage", { exact: true })).toHaveValue("custom");
  await ui(tab.locator(".reading-editor").getByText(/^Calendar:/)).toBeVisible();
  await ui(tab.getByText("No calendar selections are available. Choose your own verses.", { exact: true })).toBeVisible();
  await custom(tab, "Isaiah 1:1-2"); await click(tab, "Review assignment"); await click(tab, "Save assignment");
  await ui(tab.locator(".confirmed-reading").getByText("Isaiah 1:1-2", { exact: true })).toBeVisible();
  const parent = await page("tutor"); await navigate(parent, "/workspace/parent"); await safe(() => parent.getByLabel("Child", { exact: true }).locator(`[data-student-id="${fixture.student.id}"]`).click());
  await ui(parent.getByRole("heading", { name: "Synthetic Learner", level: 2, exact: true })).toBeVisible(); expect(await parent.getByRole("heading", { name: "Set the assigned reading", exact: true }).count()).toBe(0);
  const [{ serviceSlot }] = await fixture.ownerDb.select({ serviceSlot: s.student.serviceSlot }).from(s.student).where(eq(s.student.id, fixture.student.id)), service = serviceSlot === "morning" ? "Morning service" : "Havdalah service";
  expect(serviceSlot === "morning" || serviceSlot === "havdalah").toBe(true); await ui(parent.locator(".hero-who .hero-slot")).toHaveText(`· ${service}`);
  expect((await api(parent, `/api/students/${fixture.student.id}/reading/prepare`, { mode: "parent", ranges: ["Genesis 1:1"] })).status === 400).toBe(true);
  await click(parent, "Practice with Synthetic"); await ui(parent.getByRole("heading", { name: "Child practice", level: 1, exact: true })).toBeVisible();
  expect(await parent.getByRole("heading", { name: "Set the assigned reading", exact: true }).count()).toBe(0); await ui(parent.locator(".hero-who .hero-slot")).toHaveText(`· ${service}`);
});
