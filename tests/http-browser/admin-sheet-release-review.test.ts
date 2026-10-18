import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { expect as ui } from "@playwright/test";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { eq } from "drizzle-orm";
import { isolatedEnv } from "../helpers/isolatedEnv.mjs";
import { browserFixture } from "./fixture";
import { BROWSER_ORIGIN, assertBrowserStartupAllowed, startBrowserServer } from "./server";
import { installLoopbackFetchGuard } from "./egress";
import { openAuthMail } from "./auth-navigation";
import * as s from "../../src/server/db/index";
vi.mock("server-only", () => ({}));

let fixture: Awaited<ReturnType<typeof browserFixture>>, browser: Browser;
let stop: (() => Promise<void>) | undefined, restore: (() => void) | undefined, isolation: Awaited<ReturnType<typeof isolatedEnv>> | undefined;
const contexts: BrowserContext[] = [];
type Kind = "roster" | "access" | "invitation";
async function safe<T>(operation: () => Promise<T>): Promise<T> { try { return await operation(); } catch { throw new Error("Synthetic admin sheet operation failed; details withheld"); } }
const dialog = (tab: Page) => tab.getByRole("dialog");
const click = (tab: Page, name: string) => safe(() => tab.getByRole("button", { name, exact: true }).click());
const modalCount = (tab: Page) => tab.evaluate(() => document.querySelectorAll("dialog:modal").length);
async function api(tab: Page, path: string, body?: unknown) {
  return safe(() => tab.evaluate(async ({ path, body }) => {
    const response = await fetch(path, { method: body === undefined ? "GET" : "POST", cache: "no-store", headers: body === undefined ? {} : { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  }, { path, body }));
}
async function page(kind: Kind) {
  const context = await browser.newContext({ baseURL: BROWSER_ORIGIN, serviceWorkers: "block", acceptDownloads: false, viewport: { width: 390, height: 844 } }); contexts.push(context);
  await context.route("**/*", async route => { try { if (new URL(route.request().url()).origin === BROWSER_ORIGIN) await route.continue(); else await route.abort(); } catch { await route.abort(); } });
  const tab = await context.newPage(); await safe(() => tab.goto("/", { waitUntil: "domcontentloaded" }));
  // Every case deliberately expires its exact SDK session, so none is reused.
  expect((await api(tab, "/api/auth/sign-in/magic-link", { email: "pg-admin@example.test" })).status).toBe(200);
  await openAuthMail(tab, fixture.takeMail("pg-admin@example.test"));
  const path = kind === "roster" ? "/workspace/admin/students" : kind === "access" ? "/workspace/admin/tutors" : "/workspace/admin/invitations";
  await safe(() => tab.goto(path, { waitUntil: "domcontentloaded" })); return tab;
}
async function holdSession(tab: Page) {
  let release!: () => void, held = false, status = 0, delivered = 0; const gate = new Promise<void>(resolve => { release = resolve; });
  await tab.route("**/api/session", async route => { const response = await route.fetch(); status = response.status(); held = true; await gate; await route.fulfill({ response }).catch(() => undefined); delivered++; });
  return { release, status: () => status, ready: () => ui.poll(() => held).toBe(true), completed: () => ui.poll(() => delivered).toBeGreaterThanOrEqual(2), remove: () => tab.unroute("**/api/session") };
}
async function open(tab: Page, kind: Kind, after = false) {
  if (kind === "roster") {
    await ui(tab.getByRole("button", { name: "Add student", exact: true })).toBeEnabled(); await click(tab, "Add student");
    for (const [label, value] of [["First name", "Synthetic"], ["Last name", after ? "UnsentPrivateAdminDraft" : "AdminSheetReview"], ["Ceremony date", "2027-03-06"], ["Parent email", "synthetic-sheet@example.test"]]) await safe(() => dialog(tab).getByLabel(label, { exact: true }).fill(value));
  } else if (kind === "access") {
    await ui(tab.getByRole("button", { name: new RegExp(`^${after ? "Remove cantor flag" : "Mark as cantor"} `) })).toBeEnabled();
    await safe(() => tab.getByRole("button", { name: new RegExp(`^${after ? "Remove cantor flag" : "Mark as cantor"} `) }).click());
  } else {
    await ui(tab.getByRole("button", { name: "Review invitation", exact: true })).toBeEnabled();
    await safe(() => tab.getByRole("radio", { name: "Parent", exact: true }).check());
    await safe(() => tab.getByLabel("Recipient email", { exact: true }).fill("synthetic-sheet-parent@example.test"));
    await safe(() => tab.getByLabel("Student to link", { exact: true }).selectOption(fixture.student.id)); await click(tab, "Review invitation");
  }
  await ui(dialog(tab)).toBeVisible(); expect(await modalCount(tab)).toBe(1);
}
async function verifyRetained(tab: Page, kind: Kind) {
  if (kind === "roster") await ui(dialog(tab).getByLabel("Last name", { exact: true })).toHaveValue("AdminSheetReview");
  else if (kind === "access") await ui(dialog(tab).getByRole("heading", { name: "Mark as cantor", exact: true })).toBeVisible();
  else await ui(dialog(tab)).toContainText("synthetic-sheet-parent@example.test");
}
beforeAll(async () => {
  try {
    assertBrowserStartupAllowed(); restore = installLoopbackFetchGuard(); fixture = await browserFixture();
    stop = await startBrowserServer(fixture.withRuntime); isolation = await isolatedEnv(); browser = await chromium.launch({ headless: true, env: isolation.env });
  } catch { await browser?.close().catch(() => undefined); await stop?.().catch(() => undefined); await fixture?.close().catch(() => undefined); restore?.(); await isolation?.cleanup(); throw new Error("Synthetic admin sheet setup failed; details withheld"); }
}, 120_000);
afterAll(async () => { await Promise.all(contexts.map(context => context.close().catch(() => undefined))); await browser?.close().catch(() => undefined); await stop?.().catch(() => undefined); await fixture?.close().catch(() => undefined); restore?.(); await isolation?.cleanup(); }, 120_000);

for (const kind of ["roster", "access", "invitation"] as const) it(`admin ${kind} sheet preserves only rightful review, blocks repeated pending dismissal, and clears after real session expiry`, async () => {
  const tab = await page(kind);
  const mutationPath = kind === "roster" ? "/api/admin/students" : kind === "access" ? `/api/admin/tutors/${fixture.tutorGrant.id}/cantor` : "/api/admin/invitations";
  let observedPosts = 0;
  tab.on("request", request => { if (request.method() === "POST" && new URL(request.url()).pathname === mutationPath) observedPosts++; });
  await open(tab, kind);
  const session = await holdSession(tab);
  try {
    await safe(() => tab.evaluate(() => window.dispatchEvent(new Event("focus")))); await session.ready(); expect(session.status()).toBe(200);
    await ui(tab.getByRole("heading", { name: "Checking your access", exact: true })).toBeHidden(); expect(await modalCount(tab)).toBe(1); await ui(dialog(tab)).toBeVisible(); await verifyRetained(tab, kind); expect(observedPosts).toBe(0);
  } finally { session.release(); }
  await session.completed(); await ui(dialog(tab)).toBeVisible(); expect(await modalCount(tab)).toBe(1); await verifyRetained(tab, kind); await session.remove();
  // Quiet validation retains the rightful opener instead of reloading its row.
  await safe(() => tab.keyboard.press("Escape"));
  // A retained roster draft asks before it is discarded; the other sheets close directly.
  if (kind === "roster") await safe(() => dialog(tab).getByRole("button", { name: "Discard changes", exact: true }).click());
  await ui(dialog(tab)).toBeHidden(); expect(await modalCount(tab)).toBe(0);
  const opener = kind === "roster" ? tab.getByRole("button", { name: "Add student", exact: true }) : kind === "access" ? tab.getByRole("button", { name: /^Mark as cantor / }) : tab.getByRole("button", { name: "Review invitation", exact: true });
  await ui(opener).toBeFocused(); expect(observedPosts).toBe(0); await open(tab, kind);

  const pattern = BROWSER_ORIGIN + mutationPath; let release!: () => void, held = false, posts = 0, responseStatus = 0; const gate = new Promise<void>(resolve => { release = resolve; });
  await tab.route(pattern, async route => {
    if (route.request().method() !== "POST") return route.continue();
    posts++; const response = await route.fetch(); responseStatus = response.status(); held = true; await gate; await route.fulfill({ response }).catch(() => undefined);
  });
  const confirm = kind === "roster" ? "Save student" : kind === "access" ? "Confirm access change" : "Send invitation";
  try {
    await click(tab, confirm); await ui.poll(() => held).toBe(true); expect([200, 201]).toContain(responseStatus); expect(posts).toBe(1);
    await ui(dialog(tab).getByRole("button", { name: /^Close / })).toBeDisabled();
    await safe(() => tab.keyboard.press("Escape")); await safe(() => tab.keyboard.press("Escape"));
    await ui(dialog(tab)).toBeVisible(); expect(await modalCount(tab)).toBe(1);
    // Simulate browsers without closedby; the scoped capture listener must still block both Escapes.
    await safe(() => dialog(tab).evaluate(element => element.removeAttribute("closedby")));
    await safe(() => tab.keyboard.press("Escape")); await safe(() => tab.keyboard.press("Escape"));
    await ui(dialog(tab)).toBeVisible(); expect(await modalCount(tab)).toBe(1);
    // Native close events must synchronize safely while the actual response is held.
    await safe(() => dialog(tab).evaluate(element => (element as HTMLDialogElement).close()));
    await ui(dialog(tab)).toBeVisible(); expect(await modalCount(tab)).toBe(1); expect(posts).toBe(1);
  } finally { release(); }
  await ui(dialog(tab)).toBeHidden(); expect(await modalCount(tab)).toBe(0); await tab.unroute(pattern); expect(posts).toBe(1); expect(observedPosts).toBe(1);
  if (kind === "roster") {
    const result = await api(tab, "/api/admin/students"); expect(result.status).toBe(200); expect(result.data.students.filter((row: { lastName: string }) => row.lastName === "AdminSheetReview")).toHaveLength(1);
  } else if (kind === "access") {
    const [row] = await fixture.ownerDb.select().from(s.roleGrant).where(eq(s.roleGrant.id, fixture.tutorGrant.id)); expect(row.isCantor).toBe(true);
  } else {
    const result = await api(tab, "/api/admin/invitations"); expect(result.status).toBe(200); expect(result.data.invitations.filter((row: { recipientEmail: string }) => row.recipientEmail === "synthetic-sheet-parent@example.test")).toHaveLength(1);
  }
  await open(tab, kind, true);
  const cookie = (await tab.context().cookies()).map(value => `${value.name}=${value.value}`).join("; ");
  const proof = await fixture.runtime.auth.api.getSession({ headers: new Headers({ cookie }), query: { disableRefresh: true, disableCookieCache: true } });
  expect(Boolean(proof && proof.user.id === fixture.admin.id)).toBe(true);
  await fixture.ownerDb.update(s.session).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(s.session.id, proof!.session.id));
  const denied = await holdSession(tab);
  try {
    await safe(() => tab.evaluate(() => window.dispatchEvent(new Event("focus")))); await denied.ready(); expect(denied.status()).toBe(401);
    // The held401 is not yet known to the client; actual delivery below clears it.
    expect(await modalCount(tab)).toBe(1); await ui(dialog(tab)).toBeVisible();
  } finally { denied.release(); }
  await ui(tab.getByRole("heading", { name: "Sign in to continue", exact: true })).toBeVisible();
  expect(await modalCount(tab)).toBe(0); expect(await tab.locator("dialog").count()).toBe(0);
  expect(await tab.evaluate(() => !document.body.textContent?.includes("UnsentPrivateAdminDraft") && !document.body.textContent?.includes("synthetic-sheet-parent@example.test"))).toBe(true);
  expect((await api(tab, kind === "access" ? "/api/admin/tutors?limit=100" : mutationPath)).status).toBe(401); expect(posts).toBe(1); expect(observedPosts).toBe(1); await denied.remove(); await tab.context().close();
});
