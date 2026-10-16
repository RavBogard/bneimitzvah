import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { expect as ui } from "@playwright/test";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { browserFixture } from "./fixture";
import { assertBrowserStartupAllowed, BROWSER_ORIGIN, startBrowserServer } from "./server";
import { installLoopbackFetchGuard } from "./egress";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
vi.mock("server-only", () => ({}));

let fixture: Awaited<ReturnType<typeof browserFixture>>, browser: Browser, stop: (() => Promise<void>) | undefined;
let restore: (() => void) | undefined;
const contexts: BrowserContext[] = [];
async function safe<T>(action: () => Promise<T>): Promise<T> {
  try { return await action(); } catch { throw new Error("Portal UI browser operation failed; private details withheld"); }
}
async function navigate(tab: Page, url: string) { return safe(() => tab.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 })); }
async function page(mobile = false) {
  const context = await browser.newContext({ baseURL: BROWSER_ORIGIN, viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    serviceWorkers: "block", acceptDownloads: false });
  contexts.push(context);
  await context.addInitScript(() => {
    const state = window as Window & { __reviewHistoryRestored?: boolean };
    state.__reviewHistoryRestored = false;
    window.addEventListener("pageshow", event => { state.__reviewHistoryRestored = event.persisted; });
  });
  await context.route("**/*", async route => {
    try { if (new URL(route.request().url()).origin === BROWSER_ORIGIN) await route.continue(); else await route.abort(); }
    catch { await route.abort(); }
  });
  return context.newPage();
}
async function capture(tab: Page, state: "sign-in" | "invitation-review") {
  if (process.env.CI) return;
  const directory = join(process.cwd(), ".impeccable", "review");
  await mkdir(directory, { recursive: true });
  const device = (tab.viewportSize()?.width ?? 0) < 640 ? "mobile" : "desktop";
  await safe(() => tab.screenshot({ path: join(directory, `${state}-${device}.png`), fullPage: true }));
}
async function clean(tab: Page, secrets: string[] = []) {
  expect(await tab.evaluate(values => {
    const stored = JSON.stringify({ local: { ...localStorage }, tab: { ...sessionStorage } });
    const visible = document.body.textContent ?? "";
    return document.documentElement.scrollWidth <= innerWidth && !location.search && !location.hash
      && values.every(value => value.length > 0 && !visible.includes(value) && !stored.includes(value) && !document.cookie.includes(value));
  }, secrets)).toBe(true);
}
async function signIn(tab: Page, email: string, invitation = false) {
  await ui(tab.getByRole("heading", { level: 2, name: "Sign in", exact: true })).toBeVisible();
  if (!invitation) await capture(tab, "sign-in");
  await safe(() => tab.getByLabel("Email address", { exact: true }).fill(email));
  await safe(() => tab.getByRole("button", { name: "Email me a sign-in link", exact: true }).click());
  await ui(tab.getByRole("heading", { name: "Check your email", exact: true })).toBeVisible();
  const link = fixture.takeMail(email), token = new URL(link).searchParams.get("token")!;
  await navigate(tab, link);
  await ui(tab.getByRole("heading", { name: invitation ? "Review your invitation" : "You’re signed in", exact: true })).toBeVisible();
  await clean(tab, [email, token]);
}
async function api(tab: Page, path: string, body?: unknown) {
  return safe(() => tab.evaluate(async ({ path, body }) => {
    const response = await fetch(path, { method: body === undefined ? "GET" : "POST", cache: "no-store",
      headers: body === undefined ? {} : { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  }, { path, body }));
}

beforeAll(async () => {
  try {
    assertBrowserStartupAllowed(); restore = installLoopbackFetchGuard();
    fixture = await browserFixture({ google: true });
    stop = await startBrowserServer(fixture.withRuntime);
    browser = await chromium.launch({ headless: true, ignoreDefaultArgs: ["--disable-back-forward-cache"] });
  } catch {
    await browser?.close().catch(() => undefined); await stop?.().catch(() => undefined); await fixture?.close().catch(() => undefined); restore?.();
    throw new Error("Portal UI test startup failed; private details withheld");
  }
}, 120_000);
afterAll(async () => {
  await Promise.all(contexts.map(context => context.close().catch(() => undefined)));
  await browser?.close().catch(() => undefined); await stop?.().catch(() => undefined); await fixture?.close().catch(() => undefined); restore?.();
}, 120_000);

it("uses the actual SDK Google start while the browser intercepts provider navigation without external traffic", async () => {
  const tab = await page(); let google = 0, valid = false;
  await tab.route("https://accounts.google.com/**", async route => {
    const url = new URL(route.request().url()); google++;
    valid = url.pathname === "/o/oauth2/v2/auth" && url.searchParams.get("redirect_uri") === `${BROWSER_ORIGIN}/api/auth/callback/google`
      && url.searchParams.get("code_challenge_method") === "S256" && Boolean(url.searchParams.get("state"));
    await route.fulfill({ contentType: "text/html", body: "<title>Synthetic provider boundary</title><p>Provider navigation intercepted.</p>" });
  });
  await navigate(tab, "/");
  await ui(tab.getByRole("heading", { level: 1, name: "Open your reading" })).toBeVisible();
  await ui(tab.getByLabel("Email address")).toBeVisible();
  await capture(tab, "sign-in");
  await safe(() => tab.getByRole("button", { name: "Continue with Google", exact: true }).click());
  await safe(() => tab.waitForFunction(() => document.title === "Synthetic provider boundary"));
  expect(google === 1 && valid).toBe(true); // No Google success or provider round trip is claimed.
});

it("single-submits a real magic link, shows separate genuine roles without fake destinations, and signs out", async () => {
  const tab = await page(); await navigate(tab, "/sign-in");
  await ui(tab.getByRole("heading", { name: "Sign in", exact: true })).toBeVisible();
  await safe(() => tab.getByLabel("Email address").fill("pg-tutor@example.test"));
  let posts = 0, release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await tab.route("**/api/auth/sign-in/magic-link", async route => { posts++; const response = await route.fetch(); await gate; await route.fulfill({ response }); });
  try {
    await safe(() => tab.getByRole("button", { name: "Email me a sign-in link", exact: true }).evaluate(node => { const button = node as HTMLButtonElement; button.click(); button.click(); }));
    await ui(tab.getByRole("button", { name: "Sending link…", exact: true })).toBeDisabled();
    await ui(tab.getByLabel("Email address")).toBeDisabled(); await ui.poll(() => posts).toBe(1);
  } finally { release(); }
  await ui(tab.getByRole("heading", { name: "Check your email", exact: true })).toBeVisible();
  const link = fixture.takeMail("pg-tutor@example.test"), token = new URL(link).searchParams.get("token")!;
  await navigate(tab, link); await ui(tab.getByRole("heading", { name: "You’re signed in", exact: true })).toBeVisible();
  const roles = tab.getByRole("list", { name: "Available roles" });
  await ui(roles).toContainText("Parent"); await ui(roles).toContainText("Tutor");
  expect(await roles.getByRole("link").count()).toBe(2);
  expect(await roles.getByRole("link", { name: "Parent", exact: true }).getAttribute("href") === "/workspace/parent").toBe(true);
  expect(await roles.getByRole("link", { name: "Tutor", exact: true }).getAttribute("href") === "/workspace/tutor").toBe(true);
  await clean(tab, [token, "pg-tutor@example.test"]);
  await safe(() => tab.getByRole("button", { name: "Sign out", exact: true }).click());
  await ui(tab.getByRole("heading", { name: "Sign in", exact: true })).toBeVisible();
  expect((await api(tab, "/api/session")).status).toBe(401);
});

it("keeps invitation landing nonaccepting and accepts one reviewed binding only, with invalid/replayed links denied", async () => {
  const admin = await page(), recipient = await page(true);
  await navigate(admin, "/"); await signIn(admin, "pg-admin@example.test");
  const email = "ui-recipient@example.test";
  expect((await api(admin, "/api/admin/invitations", { role: "student", email, studentId: fixture.student.id })).status).toBe(201);
  const link = fixture.takeMail(email), token = new URL(link).searchParams.get("token")!;
  let accepts = 0, bindingOnly = true, release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await recipient.route("**/api/invitations/accept", async route => {
    accepts++; const body = route.request().postDataJSON();
    bindingOnly = bindingOnly && Object.keys(body).join() === "reviewBinding" && typeof body.reviewBinding === "string" && !JSON.stringify(body).includes(token);
    const response = await route.fetch(); await gate; await route.fulfill({ response });
  });
  await navigate(recipient, link);
  await ui(recipient.getByRole("heading", { name: "Sign in", exact: true })).toBeVisible();
  expect(accepts).toBe(0);
  expect(await recipient.getByRole("button", { name: "Accept invitation", exact: true }).count()).toBe(0);
  await signIn(recipient, email, true);
  await capture(recipient, "invitation-review");
  const desktopReview = await recipient.context().newPage();
  try {
    await desktopReview.setViewportSize({ width: 1440, height: 900 }); await navigate(desktopReview, "/invitations/accept");
    await ui(desktopReview.getByRole("heading", { name: "Review your invitation", exact: true })).toBeVisible();
    await capture(desktopReview, "invitation-review");
  } finally { await desktopReview.close(); }
  expect((await api(recipient, "/api/session")).data.membershipAvailable).toBe(false);
  expect(accepts).toBe(0);
  // Leave an unaccepted review in browser history, log out in another tab,
  // then restore it. A stale private review must not remain visible on return.
  await navigate(recipient, "/");
  await ui(recipient.getByRole("heading", { name: "You’re signed in", exact: true })).toBeVisible();
  const logoutTab = await recipient.context().newPage();
  try {
    await navigate(logoutTab, "/");
    expect((await api(logoutTab, "/api/auth/sign-out", {})).status).toBe(200);
    await safe(() => recipient.goBack({ waitUntil: "domcontentloaded", timeout: 30_000 }));
    await ui(recipient.getByRole("heading", { name: "Sign in", exact: true })).toBeVisible();
    const restored = await recipient.evaluate(() => Boolean((window as Window & { __reviewHistoryRestored?: boolean }).__reviewHistoryRestored));
    console.info("History privacy probe used native BFCache:", restored);
    expect(await recipient.getByRole("button", { name: "Accept invitation", exact: true }).count()).toBe(0);
    expect(await recipient.evaluate(label => !(document.body.textContent ?? "").includes(label), `${fixture.student.firstName} ${fixture.student.lastName}`)).toBe(true);
  } finally { await logoutTab.close(); }
  await signIn(recipient, email, true);
  try {
    await safe(() => recipient.getByRole("button", { name: "Accept invitation", exact: true }).evaluate(node => { const button = node as HTMLButtonElement; button.click(); button.click(); }));
    await ui(recipient.getByRole("button", { name: "Accepting invitation…", exact: true })).toBeDisabled();
    await ui.poll(() => accepts).toBe(1); expect(bindingOnly).toBe(true);
  } finally { release(); }
  await ui(recipient.getByRole("heading", { name: "Invitation accepted", exact: true })).toBeVisible();
  await clean(recipient, [token, email]);
  await safe(() => recipient.getByRole("link", { name: "Continue to the portal", exact: true }).click());
  await ui(recipient.getByRole("heading", { name: "Your assigned reading", exact: true })).toBeVisible();
  expect(new URL(recipient.url()).pathname === "/workspace/student").toBe(true);
  expect(await recipient.getByRole("heading", { name: "Choose your workspace", exact: true }).count()).toBe(0);
  await navigate(recipient, link);
  await ui(recipient.getByRole("heading", { name: "Invitation unavailable", exact: true })).toBeVisible();
  expect((await navigate(recipient, "/invitations/open?token=invalid"))?.status()).toBe(404);
  const unknown = await page(); await navigate(unknown, "/invitations/accept");
  await ui(unknown.getByRole("heading", { name: "Invitation unavailable", exact: true })).toBeVisible();
  expect(accepts).toBe(1);
});

it("revalidates an uninvited real session after logout in another tab", async () => {
  const tab = await page(true); await navigate(tab, "/"); await signIn(tab, "ui-uninvited@example.test");
  expect(await tab.getByRole("list", { name: "Available roles" }).count()).toBe(0);
  await ui(tab.getByText("No congregation role is linked to this account yet.", { exact: true })).toBeVisible();
  const other = await tab.context().newPage(); await navigate(other, "/");
  expect((await api(other, "/api/auth/sign-out", {})).status).toBe(200);
  await safe(() => tab.evaluate(() => window.dispatchEvent(new Event("focus"))));
  await ui(tab.getByRole("heading", { name: "Sign in", exact: true })).toBeVisible();
  await clean(tab, ["ui-uninvited@example.test"]);
});

it("handles mocked setup/provider failures with retry, fixed diagnostics and accessible focus at both widths", async () => {
  for (const mobile of [false, true]) {
    const tab = await page(mobile); let unavailable = true;
    await tab.route("**/api/session", route => unavailable
      ? route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"PRIVATE_PROVIDER_SENTINEL"}' }) : route.fallback());
    await navigate(tab, "/"); await ui(tab.getByRole("heading", { name: "Sign-in is unavailable", exact: true })).toBeVisible();
    expect(await tab.getByLabel("Email address").count()).toBe(0); await clean(tab, ["PRIVATE_PROVIDER_SENTINEL"]);
    unavailable = false; await safe(() => tab.getByRole("button", { name: "Try again", exact: true }).click());
    await ui(tab.getByRole("heading", { name: "Sign in", exact: true })).toBeFocused();
    await tab.route("**/api/auth/sign-in/social", route => route.fulfill({ contentType: "application/json", body: '{"url":"https://foreign.invalid/PRIVATE_PROVIDER_SENTINEL"}' }));
    await safe(() => tab.getByRole("button", { name: "Continue with Google", exact: true }).click());
    await ui(tab.getByRole("main").getByRole("alert")).toHaveText("Sign-in could not be started. Please try again shortly.");
    await clean(tab, ["PRIVATE_PROVIDER_SENTINEL"]);
  }
});
