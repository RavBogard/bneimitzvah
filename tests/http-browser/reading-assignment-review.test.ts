import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { expect as ui } from "@playwright/test";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { and, eq, sql } from "drizzle-orm";
import { isolatedEnv } from "../helpers/isolatedEnv.mjs";
import { browserFixture } from "./fixture";
import { BROWSER_ORIGIN, assertBrowserStartupAllowed, startBrowserServer } from "./server";
import { installLoopbackFetchGuard } from "./egress";
import { openAuthMail } from "./auth-navigation";
import * as s from "../../src/server/db/index";
import { openVerseEditor } from "./reading-nav";
vi.mock("server-only", () => ({}));

let fixture: Awaited<ReturnType<typeof browserFixture>>, browser: Browser;
let stop: (() => Promise<void>) | undefined, restore: (() => void) | undefined;
let isolation: Awaited<ReturnType<typeof isolatedEnv>> | undefined;
let barrierDiagnostic: { phase: string; responses: { kind: string; status: number }[]; failed: string[] } | undefined;
const contexts: BrowserContext[] = [], cookies = new Map<string, Awaited<ReturnType<BrowserContext["cookies"]>>>();
const safe = async <T>(action: () => Promise<T>): Promise<T> => { try { return await action(); } catch { throw new Error("Reading assignment review browser operation failed; private details withheld"); } };
const sheet = (tab: Page) => tab.getByRole("dialog", { name: "Set the assigned reading", exact: true });
const field = (tab: Page, name: string) => sheet(tab).getByRole("combobox", { name, exact: true });
async function click(tab: Page, name: string) { await safe(() => tab.getByRole("button", { name, exact: true }).click()); }
async function api(tab: Page, path: string, body?: unknown) {
  return safe(() => tab.evaluate(async ({ path, body }) => {
    const response = await fetch(path, { method: body === undefined ? "GET" : "POST", body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store", headers: body === undefined ? {} : { "content-type": "application/json" } });
    return { status: response.status, data: await response.json() };
  }, { path, body }));
}
const readPath = () => `/api/students/${fixture.student.id}/reading?mode=admin`;
async function page(role: "admin" | "tutor" = "admin") {
  const context = await browser.newContext({ baseURL: BROWSER_ORIGIN, serviceWorkers: "block", acceptDownloads: false, viewport: { width: 1440, height: 1000 } }); contexts.push(context);
  await context.route("**/*", async route => { try { if (new URL(route.request().url()).origin === BROWSER_ORIGIN) await route.continue(); else await route.abort(); } catch { await route.abort(); } });
  const saved = cookies.get(role); if (saved) await context.addCookies(saved);
  const tab = await context.newPage(); await safe(() => tab.goto("/", { waitUntil: "domcontentloaded" }));
  if (!saved) {
    const email = role === "admin" ? "pg-admin@example.test" : "pg-tutor@example.test";
    expect((await api(tab, "/api/auth/sign-in/magic-link", { email })).status).toBe(200);
    await openAuthMail(tab, fixture.takeMail(email)); cookies.set(role, await context.cookies());
  }
  return tab;
}
async function navigate(tab: Page, role = "admin") {
  await safe(() => tab.goto(`/workspace/${role === "admin" ? "admin/students" : "tutor"}/${fixture.student.id}${role === "admin" ? "/reading" : ""}`, { waitUntil: "domcontentloaded" }));
  await ui(tab.getByRole("button", { name: "Manage", exact: true })).toBeEnabled();
}
async function open(tab: Page) { await safe(() => openVerseEditor(tab)); await ui(sheet(tab)).toBeVisible(); }
async function close(tab: Page) { await click(tab, "Close verse editor"); await ui(sheet(tab)).toBeHidden(); }
async function capture(tab: Page, stage: "initial" | "review") {
  if (process.env.READING_ASSIGNMENT_CAPTURE !== "1") return;
  const directory = join(process.cwd(), ".impeccable", "review"); await mkdir(directory, { recursive: true });
  for (const [size, viewport] of [["desktop", { width: 1440, height: 1000 }], ["phone", { width: 390, height: 844 }]] as const) {
    await tab.setViewportSize(viewport);
    for (const colorScheme of ["light", "dark"] as const) {
      await tab.emulateMedia({ colorScheme });
      if (stage === "initial") await safe(() => sheet(tab).evaluate(node => { node.scrollTop = 0; }));
      else await safe(() => sheet(tab).locator(".reading-proposal").evaluate(node => node.scrollIntoView({ block: "end" })));
      expect(await tab.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(await sheet(tab).evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
      await safe(() => tab.screenshot({ path: join(directory, `reading-assignment-${stage}-${size}-${colorScheme}.png`) }));
    }
  }
}
beforeAll(async () => {
  try {
    assertBrowserStartupAllowed(); restore = installLoopbackFetchGuard(); fixture = await browserFixture();
    await fixture.ownerDb.update(s.student).set({ serviceSlot: "morning" }).where(eq(s.student.id, fixture.student.id));
    stop = await startBrowserServer(fixture.withRuntime); isolation = await isolatedEnv(); browser = await chromium.launch({ headless: true, env: isolation.env });
  } catch { await browser?.close().catch(() => undefined); await stop?.().catch(() => undefined); await fixture?.close().catch(() => undefined); restore?.(); await isolation?.cleanup(); throw new Error("Reading assignment review setup failed; private details withheld"); }
}, 120_000);
afterEach(async () => {
  if (barrierDiagnostic) console.log("Reading review barrier: " + JSON.stringify(barrierDiagnostic));
  barrierDiagnostic = undefined;
  await Promise.all(contexts.splice(0).map(context => context.close().catch(() => undefined)));
});
afterAll(async () => { await browser?.close().catch(() => undefined); await stop?.().catch(() => undefined); await fixture?.close().catch(() => undefined); restore?.(); await isolation?.cleanup(); }, 120_000);

it("loads date suggestions only when the actual editor opens and stages a native keyboard-selected passage without saving", async () => {
  const tab = await page(); let suggestions = 0, confirmations = 0;
  const evidence = { phase: "navigate", responses: [] as { kind: string; status: number }[], failed: [] as string[] }; barrierDiagnostic = evidence;
  const category = (path: string) => path.endsWith("/reading/explore/prepare") ? "exploration-prepare" : path.endsWith("/reading/explore/page") ? "exploration-page" : path.endsWith("/reading/prepare") ? "editor-prepare" : null;
  tab.on("response", response => { const kind = category(new URL(response.url()).pathname); if (kind && evidence.responses.length < 16) evidence.responses.push({ kind, status: response.status() }); });
  tab.on("requestfailed", request => { const kind = category(new URL(request.url()).pathname); if (kind && evidence.failed.length < 16) evidence.failed.push(kind); });
  const requests: unknown[] = [];
  tab.on("request", request => {
    const path = new URL(request.url()).pathname;
    if (path.endsWith("/reading/prepare")) { suggestions++; requests.push(request.postDataJSON()); }
    if (path.endsWith("/reading/confirm")) confirmations++;
  });
  // Missing Torah legitimately starts read-only exploration. Its text loader is
  // deliberately unavailable in this fixture; settle that actual request/render,
  // rather than treating unrelated network silence as editor readiness.
  const explorationPage = tab.waitForResponse(response => new URL(response.url()).pathname.endsWith("/reading/explore/page") && response.request().method() === "POST");
  await navigate(tab); evidence.phase = "exploration-response"; const explored = await explorationPage; expect(explored.status()).toBe(503);
  // The client rejects a non-OK status without consuming its body. Observe its
  // completed error render, not Response.finished() on that failed fetch.
  evidence.phase = "exploration-error-render";
  await ui(tab.getByText("The Torah portion couldn’t be loaded. Try again in a moment.", { exact: true })).toBeVisible();
  await ui(sheet(tab)).toBeHidden(); expect(suggestions).toBe(0); evidence.phase = "initial-reading-api";
  const before = await api(tab, readPath());
  await open(tab); await ui(sheet(tab).getByText(/Suggested for this service: Synthetic/)).toBeVisible();
  await ui(field(tab, "Passage")).toHaveValue("custom");
  await ui(field(tab, "Passage")).toBeEnabled();
  await ui(field(tab, "Passage").locator("option")).toContainText(["Choose my own verses", "Full", "Aliyah 1"]);
  await safe(() => field(tab, "Passage").selectOption("aliyah:1"));
  expect(suggestions).toBe(1);
  await safe(() => field(tab, "Passage").selectOption("custom"));
  expect(suggestions).toBe(1); expect(requests[0]).toEqual({ mode: "admin", kind: "torah" });
  await ui(field(tab, "Passage")).toHaveValue("custom");
  await ui(sheet(tab).getByLabel("Custom verse ranges", { exact: true })).toBeHidden();
  expect(await sheet(tab).getByRole("button", { name: "Save assignment", exact: true }).count()).toBe(0);
  await capture(tab, "initial");
  // Actual native selects are focusable and operable without reference syntax.
  await safe(() => field(tab, "Book").focus()); await safe(() => tab.keyboard.press("g")); await safe(() => tab.keyboard.press("Enter"));
  await ui(field(tab, "Book")).toHaveValue("Genesis");
  await safe(() => field(tab, "End verse").focus()); await safe(() => tab.keyboard.press("ArrowDown")); await safe(() => tab.keyboard.press("Enter"));
  await ui(field(tab, "End verse")).toHaveValue("2");
  await click(tab, "Review assignment");
  await ui(sheet(tab).getByRole("heading", { name: "Review Torah assignment", exact: true })).toBeVisible();
  await ui(sheet(tab).locator(".reading-proposal")).toContainText("Genesis 1:1-2");
  await capture(tab, "review");
  evidence.phase = "unchanged-reading-api"; expect(confirmations).toBe(0); expect((await api(tab, readPath())).data).toEqual(before.data);
  barrierDiagnostic = undefined;
});

it("fences delayed Torah suggestions on kind changes and closed editor lifetimes", async () => {
  const tab = await page();
  const evidence = { phase: "navigate", responses: [] as { kind: string; status: number }[], failed: [] as string[] }; barrierDiagnostic = evidence;
  const prepareKind = (request: import("playwright").Request) => {
    if (!new URL(request.url()).pathname.endsWith("/reading/prepare")) return null;
    try { const kind = request.postDataJSON()?.kind; return kind === "torah" || kind === "haftarah" ? kind : "unknown"; } catch { return "unknown"; }
  };
  tab.on("response", response => { const kind = prepareKind(response.request()); if (kind && evidence.responses.length < 16) evidence.responses.push({ kind, status: response.status() }); });
  tab.on("requestfailed", request => { const kind = prepareKind(request); if (kind && evidence.failed.length < 16) evidence.failed.push(kind); });
  await navigate(tab);
  let release!: () => void, entered = false, settled = false;
  const gate = new Promise<void>(yes => { release = yes; });
  await tab.route("**/reading/prepare", async route => {
    const response = await route.fetch();
    if (route.request().postDataJSON().kind === "torah" && !entered) {
      entered = true; await gate;
      try { await route.fulfill({ response }); } catch { await route.abort().catch(() => undefined); } finally { settled = true; }
    } else await route.fulfill({ response });
  });
  try {
    evidence.phase = "open-held-torah"; await open(tab); await ui.poll(() => entered).toBe(true);
    evidence.phase = "switch-haftarah";
    await safe(() => field(tab, "Reading").selectOption("haftarah"));
    await ui(field(tab, "Passage")).toBeEnabled();
    await ui(field(tab, "Passage").locator("option")).toContainText(["Choose my own verses", "Isaiah 1:1-2"]);
    evidence.phase = "close-release-torah"; await close(tab); release(); await ui.poll(() => settled).toBe(true);
    const reopenedHaftarah = tab.waitForResponse(response => new URL(response.url()).pathname.endsWith("/reading/prepare") && response.request().postDataJSON().kind === "haftarah");
    evidence.phase = "reopen-haftarah";
    await open(tab); await ui(field(tab, "Reading")).toHaveValue("haftarah");
    const refreshed = await reopenedHaftarah; expect(refreshed.status()).toBe(200);
    // The parsed response enables these options. Transport finished() is not
    // needed to prove this new editor lifetime consumed the current suggestion.
    evidence.phase = "reopened-options";
    await ui(field(tab, "Passage")).toBeEnabled();
    await ui(field(tab, "Passage").locator("option")).toContainText(["Choose my own verses", "Isaiah 1:1-2"]);
    expect(await field(tab, "Passage").getByRole("option", { name: /Aliyah/ }).count()).toBe(0);
    expect(await sheet(tab).getByRole("button", { name: "Save assignment", exact: true }).count()).toBe(0);
    evidence.phase = "complete";
  } finally { release(); await tab.unroute("**/reading/prepare"); }
});

it("initializes ordered multiple ranges without flattening them and confirms a cut-only review with original provenance", async () => {
  const tab = await page(), ranges = ["Genesis 1:1-2", "Genesis 2:1-2"];
  const prepared = await api(tab, `/api/students/${fixture.student.id}/reading/prepare`, { mode: "admin", kind: "torah", ranges });
  expect(prepared.status).toBe(200); expect(prepared.data.status).toBe("prepared");
  expect((await api(tab, `/api/students/${fixture.student.id}/reading/confirm`, { mode: "admin", binding: prepared.data.binding })).status).toBe(200);
  const before = (await api(tab, readPath())).data.readings[0];
  await navigate(tab); await open(tab); await ui(sheet(tab).getByText(/Suggested for this service: Synthetic/)).toBeVisible();
  // Plain multiple ranges get one picker each; they are never flattened into one passage.
  await ui(sheet(tab).getByRole("group", { name: "Passage 1", exact: true }).getByRole("combobox", { name: "Start chapter", exact: true })).toHaveValue("1");
  await ui(sheet(tab).getByRole("group", { name: "Passage 2", exact: true }).getByRole("combobox", { name: "Start chapter", exact: true })).toHaveValue("2");
  await safe(() => sheet(tab).getByText("Advanced references and aliyah boundaries", { exact: true }).click());
  await ui(sheet(tab).getByLabel("Custom verse ranges", { exact: true })).toHaveValue(ranges.join("\n"));
  await safe(() => sheet(tab).getByLabel("Subsequent aliyah starts", { exact: true }).fill("Genesis 2:1"));
  let request: Record<string, unknown> | undefined;
  tab.on("request", value => { if (new URL(value.url()).pathname.endsWith("/reading/prepare")) request = value.postDataJSON(); });
  await click(tab, "Review assignment"); await ui(sheet(tab).locator(".reading-preserved-context")).toBeVisible();
  expect(request).toMatchObject({ preparationMode: "current-assignment", expectedAssignmentRevision: before.revision, aliyahStarts: ["Genesis 2:1"] });
  expect(request).not.toHaveProperty("ranges"); expect(request).not.toHaveProperty("pick");
  await click(tab, "Save assignment");
  await ui(sheet(tab).getByText("Saved. The current reading above shows what the student will see.", { exact: true })).toBeVisible();
  const after = (await api(tab, readPath())).data.readings[0];
  expect(after).toEqual({ ...before, revision: before.revision + 1, aliyahStarts: ["Genesis 2:1"] });
});

it("erases private suggestions when the actual SDK session expires while a suggestion response is held", async () => {
  const tab = await page("tutor"); await navigate(tab, "tutor");
  let release!: () => void, entered = false, settled = false;
  const gate = new Promise<void>(yes => { release = yes; });
  await tab.route("**/reading/prepare", async route => {
    const response = await route.fetch(); entered = true; await gate;
    try { await route.fulfill({ response }); } catch { await route.abort().catch(() => undefined); } finally { settled = true; }
  });
  try {
    await open(tab); await ui.poll(() => entered).toBe(true);
    await fixture.ownerDb.update(s.session).set({ expiresAt: new Date(0) }).where(eq(s.session.userId, fixture.tutor.id));
    await safe(() => tab.evaluate(() => window.dispatchEvent(new Event("focus"))));
    await ui(tab.getByRole("heading", { name: "Sign in to continue", exact: true })).toBeVisible();
    release(); await ui.poll(() => settled).toBe(true);
    expect(await tab.locator("dialog:modal").count()).toBe(0);
    expect(await tab.locator(".reading-editor").count()).toBe(0);
    expect((await api(tab, `/api/students/${fixture.student.id}/reading?mode=tutor`)).status).toBe(401);
  } finally { release(); await tab.unroute("**/reading/prepare"); }
});

it("assigns two chosen passages divided into aliyot from pickers and saves exactly what was reviewed", async () => {
  const tab = await page(); await navigate(tab); await open(tab);
  await ui(sheet(tab).getByText(/Suggested for this service: Synthetic/)).toBeVisible();
  const passage = (name: RegExp) => sheet(tab).getByRole("group", { name });
  const picker = (group: RegExp, name: string) => passage(group).getByRole("combobox", { name, exact: true });
  while (await sheet(tab).getByRole("button", { name: /^Remove passage \d+$/ }).count() > 0) await safe(() => sheet(tab).getByRole("button", { name: /^Remove passage \d+$/ }).last().click());
  const first = /^(Custom passage|Passage 1)$/;
  await safe(() => picker(first, "Book").selectOption("Exodus")); await safe(() => picker(first, "End verse").selectOption("3"));
  await click(tab, "Add another passage");
  await safe(() => picker(/^Passage 2$/, "Start chapter").selectOption("2")); await safe(() => picker(/^Passage 2$/, "Start verse").selectOption("1"));
  await ui(sheet(tab).getByText("Your selection: Exodus 1:1-3; Exodus 2:1-4 (7 verses)", { exact: true })).toBeVisible();
  await safe(() => sheet(tab).getByText(/^Divide into aliyot \(optional\)/).click());
  // Divisions saved for the earlier verses don't fit these; the editor asks before starting over.
  if (await sheet(tab).getByRole("button", { name: "Start divisions again", exact: true }).count()) await click(tab, "Start divisions again");
  await click(tab, "Add an aliyah division");
  await safe(() => sheet(tab).getByRole("combobox", { name: "Aliyah 2 starts at", exact: true }).selectOption("Exodus 2:1"));
  await ui(sheet(tab).getByLabel("Subsequent aliyah starts", { exact: true })).toHaveValue("Exodus 2:1");
  await click(tab, "Review assignment");
  const review = sheet(tab).locator(".reading-proposal");
  await ui(review).toContainText("Exodus 1:1-3; Exodus 2:1-4"); await ui(review).toContainText("7 verses · Verses you chose");
  await ui(review).toContainText("2 aliyot."); await ui(review).toContainText("Replaces");
  await click(tab, "Save assignment");
  await ui(sheet(tab).getByText("Saved. The current reading above shows what the student will see.", { exact: true })).toBeVisible();
  await ui(sheet(tab).locator("p", { hasText: "Current Torah:" })).toContainText("Exodus 1:1-3; Exodus 2:1-4 (7 verses)");
  const saved = (await api(tab, readPath())).data.readings.find((row: { kind: string }) => row.kind === "torah");
  expect(saved).toMatchObject({ ranges: ["Exodus 1:1-3", "Exodus 2:1-4"], aliyahStarts: ["Exodus 2:1"], needsReview: false });
});

it("flags a saved reading after a ceremony change without replacing it", async () => {
  const tab = await page();
  await fixture.ownerDb.update(s.assignment).set({ proposalSnapshot: sql`jsonb_set(coalesce(${s.assignment.proposalSnapshot}, '{}'::jsonb), '{needsReview}', 'true'::jsonb)` })
    .where(and(eq(s.assignment.studentId, fixture.student.id), eq(s.assignment.kind, "torah")));
  const before = (await api(tab, readPath())).data.readings.find((row: { kind: string }) => row.kind === "torah");
  expect(before.needsReview).toBe(true);
  await navigate(tab); await open(tab);
  await ui(sheet(tab).getByRole("note")).toContainText("The ceremony date or service changed after it was saved. The saved verses have not been changed");
  await close(tab);
  expect((await api(tab, readPath())).data.readings.find((row: { kind: string }) => row.kind === "torah")).toEqual(before);
});
