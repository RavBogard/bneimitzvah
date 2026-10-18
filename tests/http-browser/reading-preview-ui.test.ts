import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { expect as ui } from "@playwright/test";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { isolatedEnv } from "../helpers/isolatedEnv.mjs";
import { syntheticUiStudyPage } from "../helpers/study-ui";
import { browserFixture } from "./fixture";
import { BROWSER_ORIGIN, assertBrowserStartupAllowed, startBrowserServer } from "./server";
import { installLoopbackFetchGuard } from "./egress";
import { openAuthMail } from "./auth-navigation";
import * as s from "../../src/server/db/index";
vi.mock("server-only", () => ({}));

let fixture: Awaited<ReturnType<typeof browserFixture>>, browser: Browser, stop: (() => Promise<void>) | undefined, restore: (() => void) | undefined;
let isolation: Awaited<ReturnType<typeof isolatedEnv>> | undefined;
const contexts: BrowserContext[] = [], cookies = new Map<string, Awaited<ReturnType<BrowserContext["cookies"]>>>();
const safe = async <T>(action: () => Promise<T>): Promise<T> => { try { return await action(); } catch { throw new Error("Reading preview browser operation failed; private details withheld"); } };
const panel = (tab: Page) => tab.locator(".reading-preview");
async function click(tab: Page, name: string) { await safe(() => tab.getByRole("button", { name, exact: true }).click()); }
// Staff edit verses in a sheet over the reading; verse notes are on the page beneath it.
async function openSheet(tab: Page) {
  await safe(() => tab.getByRole("button", { name: /^(Change|Assign) verses$/ }).click());
  await ui(tab.locator(".reading-editor").getByText(/^Calendar:/)).toBeVisible();
  for (const name of ["Advanced references and aliyah boundaries", "Hebrew preview and verse selection (optional)"]) {
    const summary = tab.getByText(name, { exact: true });
    if (!await summary.evaluate(node => (node.parentElement as HTMLDetailsElement).open)) await safe(() => summary.click());
  }
  await ui(tab.getByLabel("Custom verse ranges", { exact: true })).toBeVisible();
}
async function closeSheet(tab: Page) { await click(tab, "Close verse editor"); await ui(tab.getByLabel("Custom verse ranges", { exact: true })).toBeHidden(); }
async function api(tab: Page, path: string, body?: unknown) {
  return safe(() => tab.evaluate(async ({ path, body }) => {
    const response = await fetch(path, { method: body === undefined ? "GET" : "POST", body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store", headers: body === undefined ? {} : { "content-type": "application/json" } });
    return { status: response.status, data: await response.json() };
  }, { path, body }));
}
async function page(role: "admin" | "tutor" | "student" = "admin") {
  const context = await browser.newContext({ baseURL: BROWSER_ORIGIN, serviceWorkers: "block", acceptDownloads: false, viewport: { width: 1440, height: 1000 } }); contexts.push(context);
  await context.route("**/*", async route => { try { if (new URL(route.request().url()).origin === BROWSER_ORIGIN) await route.continue(); else await route.abort(); } catch { await route.abort(); } });
  const saved = cookies.get(role); if (saved) await context.addCookies(saved);
  const tab = await context.newPage(); await safe(() => tab.goto("/", { waitUntil: "domcontentloaded" }));
  if (!saved) {
    const email = role === "admin" ? "pg-admin@example.test" : role === "tutor" ? "pg-tutor@example.test" : "pg-aliyah-student@example.test";
    expect((await api(tab, "/api/auth/sign-in/magic-link", { email })).status).toBe(200); await openAuthMail(tab, fixture.takeMail(email)); cookies.set(role, await context.cookies());
  }
  return tab;
}
async function reading(tab: Page, role = "admin") {
  await safe(() => tab.goto(role === "admin" ? `/workspace/admin/students/${fixture.student.id}/reading` : "/workspace/tutor", { waitUntil: "domcontentloaded" }));
  if (role === "tutor") await safe(() => tab.getByLabel("Student", { exact: true }).locator(`[data-student-id="${fixture.student.id}"]`).click());
  // Staff change verses in a sheet over the reading.
  await openSheet(tab);
}
async function assertDesktopStudyColumns(tab: Page) {
  const layout = await safe(() => tab.locator(".assigned-study").evaluate(section => {
    const flow = section.querySelector(".study-verses"), marker = flow?.querySelector(".student-aliyah"), verse = flow?.querySelector('p[lang="he"]'), tools = section.querySelector(".study-verse-detail");
    if (!marker || !verse || !tools || !flow) return null;
    const bounds = (element: Element) => { const rect = element.getBoundingClientRect(); return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }; };
    return { marker: bounds(marker), flow: bounds(flow), verse: bounds(verse), tools: bounds(tools), viewport: innerWidth, words: flow.querySelectorAll("[data-word-index]").length };
  }));
  expect(layout).not.toBeNull();
  expect(layout!.words).toBeGreaterThan(0);
  expect(layout!.verse.left).toBeGreaterThanOrEqual(0); expect(layout!.verse.right).toBeLessThanOrEqual(layout!.viewport);
  expect(layout!.tools.left).toBeGreaterThanOrEqual(0); expect(layout!.tools.right).toBeLessThanOrEqual(layout!.viewport);
  // The real section marker precedes the flowing passage, with individual
  // verse tools below the passage rather than obsolete side-by-side cards.
  expect(layout!.marker.bottom).toBeLessThanOrEqual(layout!.verse.top);
  expect(layout!.flow.bottom).toBeLessThanOrEqual(layout!.tools.top);
}
async function captures(tab: Page, stage: "selection" | "cut-review" | "student-markers", selector: string) {
  if (process.env.CI) return;
  const folder = join(process.cwd(), ".impeccable", "review"); await mkdir(folder, { recursive: true });
  // One batched, settled-layout round. No live provider content enters captures.
  for (const [name, viewport] of [["desktop", { width: 1440, height: 1000 }], ["mobile", { width: 390, height: 844 }]] as const) {
    await tab.setViewportSize(viewport); await ui(tab.locator(selector)).toBeVisible();
    await safe(() => tab.evaluate(async () => {
      await document.fonts.ready;
      // Access revalidation can restore focus to the skip link. Clear that
      // incidental overlay without changing styles or interactive states.
      if (document.activeElement instanceof HTMLElement && document.activeElement.matches(".skip-link")) document.activeElement.blur();
      scrollTo(0, 0);
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    }));
    expect(await tab.evaluate(() => scrollY === 0 && document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await safe(() => tab.screenshot({ path: join(folder, `aliyah-${stage}-${name}.png`), fullPage: true }));
    await safe(() => tab.locator(selector).screenshot({ path: join(folder, `aliyah-${stage}-${name}-detail.png`) }));
  }
}
beforeAll(async () => {
  try {
    assertBrowserStartupAllowed(); restore = installLoopbackFetchGuard(); fixture = await browserFixture({ studyLoad: async request => syntheticUiStudyPage(request) });
    const learner = await fixture.signIn("pg-aliyah-student");
    const [learnerMember] = await fixture.ownerDb.insert(s.membership).values({ tenantId: "crc", userId: learner.id }).returning();
    const [learnerGrant] = await fixture.ownerDb.insert(s.roleGrant).values({ tenantId: "crc", membershipId: learnerMember.id, role: "student" }).returning();
    await fixture.ownerDb.insert(s.studentIdentity).values({ tenantId: "crc", studentId: fixture.student.id, roleGrantId: learnerGrant.id });
    await fixture.ownerDb.update(s.student).set({ serviceSlot: "morning" }).where(eq(s.student.id, fixture.student.id));
    const [member] = await fixture.ownerDb.select().from(s.membership).where(eq(s.membership.userId, fixture.admin.id));
    const [assignment] = await fixture.ownerDb.insert(s.assignment).values({ tenantId: "crc", studentId: fixture.student.id, kind: "torah", basis: "custom", ref: "Genesis 1:1-3", status: "confirmed", setByMembershipId: member.id,
      proposalSnapshot: { slotProvenance: 1, serviceSlot: "morning", readingDate: "2027-01-02", confirmationDate: "2027-01-02", needsReview: false } }).returning();
    await fixture.ownerDb.insert(s.assignmentVerse).values([1, 2, 3].map(n => ({ tenantId: "crc", studentId: fixture.student.id, assignmentId: assignment.id, ordinal: n, verseRef: `Genesis 1:${n}` })));
    stop = await startBrowserServer(fixture.withRuntime); isolation = await isolatedEnv(); browser = await chromium.launch({ headless: true, env: isolation.env });
  } catch { await browser?.close().catch(() => undefined); await isolation?.cleanup(); await stop?.().catch(() => undefined); await fixture?.close().catch(() => undefined); restore?.(); throw new Error("Reading preview browser setup failed; private details withheld"); }
}, 120000);
afterAll(async () => { await Promise.all(contexts.map(context => context.close().catch(() => undefined))); await browser?.close().catch(() => undefined); await isolation?.cleanup(); await stop?.().catch(() => undefined); await fixture?.close().catch(() => undefined); restore?.(); }, 120000);

it("previews a staff whole portion across pages and chapters while preserving custom draft and assignment, with desktop/mobile captures", async () => {
  const tab = await page(); await reading(tab);
  const draft = "Genesis 1:5-8"; await safe(() => tab.getByLabel("Custom verse ranges", { exact: true }).fill(draft));
  const before = await api(tab, `/api/students/${fixture.student.id}/reading?mode=admin`);
  let mutations = 0; const tokens: string[] = [];
  tab.on("request", request => {
    const path = new URL(request.url()).pathname;
    if (request.method() === "POST" && /\/reading\/(?:prepare|confirm)$/.test(path)) mutations++;
    if (path.endsWith("/reading/preview/page")) tokens.push(request.postDataJSON().binding);
  });
  await click(tab, "Preview whole Torah portion"); await ui(panel(tab).getByText(/Preview page 1 of 2\./)).toBeVisible();
  await ui(panel(tab).getByText("Calendar aliyah 1 starts here · orientation only", { exact: true })).toBeVisible();
  await ui(panel(tab).getByText(/Calendar maftir, shown separately: Numbers 28:9-10/)).toBeVisible();
  expect(await panel(tab).locator(".study-verses").getByRole("heading", { name: /Numbers/ }).count()).toBe(0);
  await click(tab, "Next preview page"); await ui(panel(tab).getByText(/Preview page 2 of 2\./)).toBeVisible();
  await ui(tab.getByRole("button", { name: "Next preview page", exact: true })).toBeDisabled();
  await safe(() => panel(tab).getByLabel("Jump to chapter (opens its first preview page)", { exact: true }).selectOption("Genesis 1"));
  await ui(panel(tab).getByText(/Preview page 1 of 2\./)).toBeVisible(); await ui(tab.getByLabel("Custom verse ranges", { exact: true })).toHaveValue(draft);
  expect(tokens.length >= 3 && tokens.every(token => token === tokens[0])).toBe(true); expect(mutations).toBe(0);
  const after = await api(tab, `/api/students/${fixture.student.id}/reading?mode=admin`); expect(after.data).toEqual(before.data);
  expect(await tab.getByRole("button", { name: "Save assignment", exact: true }).count()).toBe(0);
});

it("previews explicit manual fallback and discards a delayed manual response when its custom draft changes", async () => {
  const tab = await page();
  const [student] = await fixture.ownerDb.select().from(s.student).where(eq(s.student.id, fixture.student.id));
  expect((await api(tab, `/api/admin/students/${student.id}/edit`, { expectedRevision: student.revision, student: { firstName: student.firstName, lastName: student.lastName, ceremonyDate: student.ceremonyDate, serviceSlot: "unknown", parentEmail: "fixture@example.test" } })).status).toBe(200);
  await reading(tab); await safe(() => tab.getByLabel("Custom verse ranges", { exact: true }).fill("Genesis 2:1-2"));
  await click(tab, "Preview whole Torah portion"); await ui(panel(tab).getByText("The service slot is not yet set. Choose custom references; no calendar date has been assumed.", { exact: true })).toBeVisible();
  expect(await panel(tab).locator(".study-verses").count()).toBe(0);
  await click(tab, "Preview custom references"); await ui(panel(tab).getByRole("heading", { name: "Genesis 2:1", exact: true })).toBeVisible();
  expect(await panel(tab).getByText(/Calendar aliyah \d starts/).count()).toBe(0);
  await safe(() => tab.getByLabel("Custom verse ranges", { exact: true }).fill("Genesis 3:1-2"));
  let release!: () => void, held = false, delivered = false; const gate = new Promise<void>(resolve => { release = resolve; });
  await tab.route("**/reading/preview/page", async route => { const response = await route.fetch(); held = true; await gate; await route.fulfill({ response }).catch(() => undefined); delivered = true; });
  try {
    await click(tab, "Preview custom references"); await ui.poll(() => held).toBe(true);
    await safe(() => tab.getByLabel("Custom verse ranges", { exact: true }).fill("Genesis 4:1-2"));
    await ui(panel(tab).locator(".study-verses")).toHaveCount(0); release(); await ui.poll(() => delivered).toBe(true);
    await safe(() => tab.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))));
    await ui(panel(tab).locator(".study-verses")).toHaveCount(0); await ui(tab.getByLabel("Custom verse ranges", { exact: true })).toHaveValue("Genesis 4:1-2");
  } finally { release(); await tab.unroute("**/reading/preview/page"); }
  await click(tab, "Preview custom references"); await ui(panel(tab).getByRole("heading", { name: "Genesis 4:1", exact: true })).toBeVisible();
});

it("retains a bound preview through unchanged quiet verification, fences explicit refresh, and gives parent mode no preview authority", async () => {
  const tab = await page("tutor"); await reading(tab, "tutor");
  await safe(() => tab.getByLabel("Custom verse ranges", { exact: true }).fill("Genesis 1:1-2"));
  let release!: () => void, held = false, delivered = false; const gate = new Promise<void>(resolve => { release = resolve; });
  await tab.route("**/reading/preview/page", async route => { const response = await route.fetch(); held = true; await gate; await route.fulfill({ response }).catch(() => undefined); delivered = true; });
  try {
    await click(tab, "Preview custom references"); await ui.poll(() => held).toBe(true);
    let metadataSeen = false, finalSessions = 0;
    const observed = (response: import("playwright").Response) => { const path = new URL(response.url()).pathname;
      if (path === `/api/students/${fixture.student.id}/reading` && response.status() === 200) metadataSeen = true;
      if (metadataSeen && path === "/api/session" && response.status() === 200) finalSessions++;
    }; tab.on("response", observed);
    await safe(() => tab.evaluate(() => window.dispatchEvent(new Event("focus")))); await ui.poll(() => finalSessions).toBeGreaterThanOrEqual(2); tab.off("response", observed);
    await ui(tab.getByRole("heading", { name: "Checking your access", exact: true })).toBeHidden();
    await ui(tab.getByLabel("Custom verse ranges", { exact: true })).toBeVisible();
    await ui(tab.getByLabel("Custom verse ranges", { exact: true })).toHaveValue("Genesis 1:1-2");
    release(); await ui.poll(() => delivered).toBe(true); await ui(panel(tab).locator(".study-verses")).toHaveCount(1);
  } finally { release(); await tab.unroute("**/reading/preview/page"); }
  // Explicit Refresh remains a blocking lifecycle boundary. Dispatch the real
  // page control without asking a modal-covered pointer to reach it.
  let releaseRefresh!: () => void, heldRefresh = false, deliveredRefresh = false;
  const refreshGate = new Promise<void>(resolve => { releaseRefresh = resolve; });
  const holdRefresh = async (route: import("playwright").Route) => { const response = await route.fetch(); heldRefresh = true; await refreshGate; await route.fulfill({ response }).catch(() => undefined); deliveredRefresh = true; };
  await tab.route("**/reading/preview/page", holdRefresh);
  try {
    await click(tab, "Preview custom references"); await ui.poll(() => heldRefresh).toBe(true);
    const reloaded = tab.waitForResponse(response => new URL(response.url()).pathname === `/api/students/${fixture.student.id}/reading` && response.status() === 200);
    await tab.locator('button[aria-label="Refresh reading"]').evaluate(button => (button as HTMLButtonElement).click()); await reloaded;
    await ui(panel(tab).locator(".study-verses")).toHaveCount(0);
    releaseRefresh(); await ui.poll(() => deliveredRefresh).toBe(true); await ui(panel(tab).locator(".study-verses")).toHaveCount(0);
    await ui(tab.getByLabel("Custom verse ranges", { exact: true })).toHaveValue("Genesis 1:1-2");
  } finally { releaseRefresh(); await tab.unroute("**/reading/preview/page", holdRefresh); }
  if (!process.env.CI) { // The tutor sheet: the preview is the picker, with the selection kept in reach.
    await click(tab, "Preview custom references"); await ui(panel(tab).locator(".study-verses li").first()).toBeVisible();
    await click(tab, "Start at Genesis 1:1"); await safe(() => tab.getByRole("button", { name: "End at Genesis 1:2", exact: true }).scrollIntoViewIfNeeded());
    const directory = join(process.cwd(), ".impeccable", "review"); await mkdir(directory, { recursive: true });
    await safe(() => tab.screenshot({ path: join(directory, "tutor-sheet-picker-desktop.png") }));
    const size = tab.viewportSize(); await safe(() => tab.setViewportSize({ width: 390, height: 844 }));
    expect(await tab.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await safe(() => tab.screenshot({ path: join(directory, "tutor-sheet-picker-mobile.png") }));
    if (size) await safe(() => tab.setViewportSize(size));
  }
  expect((await api(tab, `/api/students/${fixture.student.id}/reading/preview/prepare`, { mode: "parent", kind: "torah", source: "calendar" })).status).toBe(400);
  await safe(() => tab.goto("/workspace/parent", { waitUntil: "domcontentloaded" })); await safe(() => tab.getByLabel("Child", { exact: true }).locator(`[data-student-id="${fixture.student.id}"]`).click());
  await ui(tab.locator(".reading-current-assignment")).toBeVisible(); expect(await tab.getByRole("button", { name: "Preview custom references", exact: true }).count()).toBe(0);
});

it("stages a cross-page excerpt and cuts, isolates Torah/haftarah drafts, and rejects a selection crossing a manual gap", async () => {
  await fixture.ownerDb.update(s.student).set({ serviceSlot: "morning" }).where(eq(s.student.id, fixture.student.id));
  const tab = await page(); await reading(tab);
  const before = await api(tab, `/api/students/${fixture.student.id}/reading?mode=admin`);
  const originalDraft = before.data.readings.find((row: { kind: string }) => row.kind === "torah").ranges.join("\n");
  let mutations = 0, suggestionReads = 0;
  tab.on("request", request => {
    const path = new URL(request.url()).pathname;
    if (request.method() !== "POST" || !/\/reading\/(?:prepare|confirm)$/.test(path)) return;
    const body = request.postDataJSON();
    if (path.endsWith("/prepare") && !body.pick && !body.ranges && !body.preparationMode) suggestionReads++;
    else mutations++;
  });
  await click(tab, "Preview whole Torah portion");
  await ui(panel(tab).getByText(/Preview page 1 of 2\./)).toBeVisible();
  await safe(() => panel(tab).getByLabel("Jump to chapter (opens its first preview page)", { exact: true }).selectOption("Genesis 4"));
  await click(tab, "Start at Genesis 4:19");
  await click(tab, "Next preview page");
  await ui(panel(tab).getByText(/Preview page 2 of 2\./)).toBeVisible();
  await click(tab, "End at Genesis 4:23");
  await ui(tab.getByLabel("Custom verse ranges", { exact: true })).toHaveValue(originalDraft);
  await click(tab, "Use selected verses");
  await ui(tab.getByLabel("Custom verse ranges", { exact: true })).toHaveValue("Genesis 4:19-23");
  await safe(() => panel(tab).getByRole("checkbox", { name: "Start new aliyah at Genesis 4:22", exact: true }).check());
  await ui(tab.getByLabel("Subsequent aliyah starts", { exact: true })).toHaveValue("Genesis 4:22");
  await safe(() => tab.getByRole("combobox", { name: "Reading", exact: true }).selectOption("haftarah"));
  await ui(tab.getByLabel("Custom verse ranges", { exact: true })).toHaveValue("");
  expect(await tab.getByRole("group", { name: "Student Torah aliyah starts", exact: true }).count()).toBe(0);
  await safe(() => tab.getByLabel("Custom verse ranges", { exact: true }).fill("Isaiah 1:1-2"));
  await safe(() => tab.getByRole("combobox", { name: "Reading", exact: true }).selectOption("torah"));
  await ui(tab.getByLabel("Custom verse ranges", { exact: true })).toHaveValue("Genesis 4:19-23");
  await ui(tab.getByLabel("Subsequent aliyah starts", { exact: true })).toHaveValue("Genesis 4:22");
  // Reopen the staged excerpt, keeping the capture bounded to five synthetic verses.
  await click(tab, "Preview custom references");
  await ui(panel(tab).getByRole("heading", { name: "Genesis 4:19", exact: true })).toBeVisible();
  await click(tab, "Start at Genesis 4:19"); await click(tab, "End at Genesis 4:23");
  await captures(tab, "selection", ".reading-editor");
  await safe(() => tab.getByLabel("Custom verse ranges", { exact: true }).fill("Genesis 1:1-2\nGenesis 1:4-5"));
  await click(tab, "Preview custom references");
  await click(tab, "Start at Genesis 1:2"); await click(tab, "End at Genesis 1:4");
  await ui(panel(tab).getByText("Choose Start before End without crossing a gap in the preview references.", { exact: true })).toBeVisible();
  await ui(tab.getByRole("button", { name: "Use selected verses", exact: true })).toBeDisabled();
  await ui(tab.getByLabel("Custom verse ranges", { exact: true })).toHaveValue("Genesis 1:1-2\nGenesis 1:4-5");
  expect(mutations).toBe(0); expect(suggestionReads).toBe(2);
  expect((await api(tab, `/api/students/${fixture.student.id}/reading?mode=admin`)).data).toEqual(before.data);
});

it("reviews and confirms only cuts with truthful preserved context, retaining saved notes and their earlier-revision history", async () => {
  const tab = await page();
  const [assignment] = await fixture.ownerDb.select().from(s.assignment).where(eq(s.assignment.studentId, fixture.student.id));
  const snapshot = { slotProvenance: 1, serviceSlot: "morning", readingDate: "2026-12-26", confirmationDate: "2026-12-26", needsReview: true,
    sourceStatus: "unavailable", sourceFetchedAt: null, source: { date: "2026-12-26", calendar: "diaspora" } };
  await fixture.ownerDb.update(s.assignment).set({ proposalSnapshot: snapshot }).where(eq(s.assignment.id, assignment.id));
  await reading(tab); await closeSheet(tab);
  const tools = tab.locator(".assigned-study .verse-work").first();
  await safe(() => tools.locator("summary").first().click());
  await safe(() => tools.getByRole("button", { name: "Student-visible notes", exact: true }).click());
  await safe(() => tools.getByRole("textbox").fill("Synthetic note retained after a cut-only revision"));
  await safe(() => tools.getByRole("button", { name: "Add student-visible note", exact: true }).click());
  await ui(tools.locator(".work-notes")).toContainText("Synthetic note retained after a cut-only revision");
  const before = await api(tab, `/api/students/${fixture.student.id}/reading?mode=admin`);
  const requests: Record<string, unknown>[] = [];
  tab.on("request", request => { if (request.method() === "POST" && new URL(request.url()).pathname.endsWith("/reading/prepare")) requests.push(request.postDataJSON()); });
  await openSheet(tab); await click(tab, "Use current assignment");
  await safe(() => tab.getByLabel("Subsequent aliyah starts", { exact: true }).fill("Genesis 1:3"));
  await click(tab, "Review assignment");
  const review = tab.locator(".reading-proposal");
  await ui(review.getByRole("heading", { name: "Review Torah assignment", exact: true })).toBeVisible();
  expect(requests.at(-1)).toMatchObject({ kind: "torah", preparationMode: "current-assignment", expectedAssignmentRevision: assignment.revision, aliyahStarts: ["Genesis 1:3"] });
  expect(requests.at(-1)).not.toHaveProperty("ranges"); expect(requests.at(-1)).not.toHaveProperty("pick");
  await ui(review).toContainText("References unchanged. Existing confirmation date: 2026-12-26.");
  await ui(review).toContainText("The reading still needs review with the tutor or rabbi.");
  await safe(() => review.getByText("Calendar source details", { exact: true }).click());
  await ui(review).toContainText("Preserved calendar source: unavailable when the assignment was saved.");
  await ui(review).toContainText("No calendar result was newly checked.");
  expect((await api(tab, `/api/students/${fixture.student.id}/reading?mode=admin`)).data).toEqual(before.data);
  await captures(tab, "cut-review", ".reading-editor");
  // A manual reference edit explicitly leaves cut-only mode; a fresh seed returns to it.
  await safe(() => tab.getByLabel("Custom verse ranges", { exact: true }).fill("Genesis 1:1-2"));
  await click(tab, "Record one aliyah"); await click(tab, "Review assignment");
  await ui(tab.getByRole("button", { name: "Save assignment", exact: true })).toBeEnabled();
  expect(requests.at(-1)).toMatchObject({ ranges: ["Genesis 1:1-2"], aliyahStarts: [] });
  expect(requests.at(-1)).not.toHaveProperty("preparationMode");
  await click(tab, "Use current assignment");
  await safe(() => tab.getByLabel("Subsequent aliyah starts", { exact: true }).fill("Genesis 1:3"));
  await click(tab, "Review assignment"); await ui(tab.getByRole("button", { name: "Save assignment", exact: true })).toBeEnabled();
  await click(tab, "Save assignment");
  await ui(tab.getByText("Saved. The current reading above shows what the student will see.", { exact: true })).toBeVisible();
  const after = await api(tab, `/api/students/${fixture.student.id}/reading?mode=admin`);
  expect(after.data.readings[0]).toEqual({ ...before.data.readings[0], revision: assignment.revision + 1, aliyahStarts: ["Genesis 1:3"] });
  const [persisted] = await fixture.ownerDb.select().from(s.assignment).where(eq(s.assignment.id, assignment.id));
  expect(persisted.proposalSnapshot).toEqual(snapshot);
  await closeSheet(tab);
  const reloadedTools = tab.locator(".assigned-study .verse-work").first();
  if (await reloadedTools.getAttribute("open") === null) await safe(() => reloadedTools.locator("summary").first().click());
  await safe(() => reloadedTools.getByRole("button", { name: "Student-visible notes", exact: true }).click());
  await safe(() => reloadedTools.locator(".work-history > summary").click());
  await ui(reloadedTools.locator(".work-history")).toContainText("Synthetic note retained after a cut-only revision");
  await ui(reloadedTools.locator(".work-history")).toContainText(`Saved under an earlier assignment (revision ${assignment.revision})`);
});

it("requires an explicit current-assignment reseed after a cut-only revision and recovers unsent note text under that revision", async () => {
  const tab = await page(); await reading(tab); await click(tab, "Use current assignment");
  await safe(() => tab.getByLabel("Subsequent aliyah starts", { exact: true }).fill("Genesis 1:3"));
  await closeSheet(tab);
  const tools = tab.locator(".assigned-study .verse-work").first();
  await safe(() => tools.locator("summary").first().click());
  await safe(() => tools.getByRole("button", { name: "Student-visible notes", exact: true }).click());
  const text = "Synthetic unsent note recovered across a cut-only change";
  await safe(() => tools.getByRole("textbox").fill(text));
  const before = await api(tab, `/api/students/${fixture.student.id}/reading?mode=admin`), revision = before.data.readings[0].revision;
  const prepared = await api(tab, `/api/students/${fixture.student.id}/reading/prepare`, { mode: "admin", kind: "torah", preparationMode: "current-assignment", expectedAssignmentRevision: revision, aliyahStarts: ["Genesis 1:2"] });
  expect(prepared.status).toBe(200);
  expect((await api(tab, `/api/students/${fixture.student.id}/reading/confirm`, { mode: "admin", binding: prepared.data.binding })).status).toBe(200);
  await safe(() => tab.evaluate(() => window.dispatchEvent(new Event("focus"))));
  await openSheet(tab);
  await ui(tab.getByText(/The saved reading changed after you started\./)).toBeVisible();
  await ui(tab.getByRole("button", { name: "Review assignment", exact: true })).toBeDisabled();
  await ui(tab.getByLabel("Subsequent aliyah starts", { exact: true })).toHaveValue("Genesis 1:3");
  await closeSheet(tab);
  const recovered = tab.locator(".assigned-study .verse-work").first();
  await safe(() => recovered.getByRole("button", { name: "Student-visible notes", exact: true }).click());
  await ui(recovered.getByRole("textbox")).toHaveValue(text);
  await ui(recovered.getByRole("textbox")).toHaveAttribute("readonly", "");
  await ui(recovered.getByRole("region", { name: "Review unsent note for Genesis 1:1", exact: true })).toBeVisible();
  await safe(() => recovered.getByRole("button", { name: "Review and keep my text", exact: true }).click());
  await safe(() => recovered.getByRole("button", { name: "Add student-visible note", exact: true }).click());
  await ui(recovered.locator(".work-notes")).toContainText(text);
  await openSheet(tab); await click(tab, "Use current assignment");
  await ui(tab.getByLabel("Subsequent aliyah starts", { exact: true })).toHaveValue("Genesis 1:2");
  await ui(tab.getByRole("button", { name: "Review assignment", exact: true })).toBeEnabled();
  // Preview selection also leaves the captured current-assignment mode.
  await click(tab, "Preview whole Torah portion"); await click(tab, "Start at Genesis 1:1"); await click(tab, "End at Genesis 1:3"); await click(tab, "Use selected verses");
  const request = tab.waitForRequest(request => request.method() === "POST" && new URL(request.url()).pathname.endsWith("/reading/prepare"));
  await click(tab, "Review assignment");
  const body = (await request).postDataJSON();
  expect(body).toMatchObject({ ranges: ["Genesis 1:1-3"], aliyahStarts: ["Genesis 1:2"] });
  expect(body).not.toHaveProperty("preparationMode");
});

it("shows recorded student boundaries and page continuation, distinguishing unrecorded metadata from one aliyah", async () => {
  const staff = await page(); await reading(staff);
  await safe(() => staff.getByLabel("Custom verse ranges", { exact: true }).fill("Genesis 1:1-4:24"));
  await safe(() => staff.getByLabel("Subsequent aliyah starts", { exact: true }).fill("Genesis 4:19"));
  await click(staff, "Review assignment"); await ui(staff.getByRole("button", { name: "Save assignment", exact: true })).toBeEnabled();
  await click(staff, "Save assignment");
  await ui(staff.getByText("Saved. The current reading above shows what the student will see.", { exact: true })).toBeVisible();
  const learner = await page("student"); await safe(() => learner.goto("/workspace/student", { waitUntil: "domcontentloaded" }));
  const study = learner.locator(".assigned-study");
  await ui(study.getByText("Aliyah 1 starts here", { exact: true })).toBeVisible();
  await ui(study.getByText("Aliyah 2 starts here", { exact: true })).toBeVisible();
  await click(learner, "Next text page");
  await ui(study.getByText("Aliyah 2 · continued from the previous text page", { exact: true })).toBeVisible();
  expect(await study.getByText(/Aliyah \d starts here/).count()).toBe(0);
  await assertDesktopStudyColumns(learner);
  await captures(learner, "student-markers", ".assigned-study");
  const [assignment] = await fixture.ownerDb.select().from(s.assignment).where(eq(s.assignment.studentId, fixture.student.id));
  for (const aliyahStarts of [null, []] as const) {
    await fixture.ownerDb.update(s.assignment).set({ aliyahStarts: aliyahStarts === null ? null : [], revision: assignment.revision + (aliyahStarts === null ? 1 : 2) }).where(eq(s.assignment.id, assignment.id));
    await click(learner, "Refresh reading");
    if (aliyahStarts === null) {
      expect(await study.getByText("Aliyah boundaries have not been recorded for this assignment.", { exact: true }).count()).toBe(0); // Students see no assignment status.
      expect(await study.locator(".student-aliyah").count()).toBe(0);
    } else {
      await ui(study.getByText("Aliyah 1 starts here", { exact: true })).toBeVisible();
      await click(learner, "Next text page");
      await ui(study.getByText("Aliyah 1 · continued from the previous text page", { exact: true })).toBeVisible();
    }
  }
});
