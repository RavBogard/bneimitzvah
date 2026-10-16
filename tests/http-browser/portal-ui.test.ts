import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { expect as ui } from "@playwright/test";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { browserFixture } from "./fixture";
import { assertBrowserStartupAllowed, BROWSER_ORIGIN, startBrowserServer } from "./server";
import { installLoopbackFetchGuard } from "./egress";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { openAuthMail } from "./auth-navigation";
import { rateLimit } from "../../src/server/db/auth-schema";
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
async function capture(tab: Page, state: "sign-in" | "invitation-review" | "email-confirm") {
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
  const link = fixture.takeMail(email), token = new URLSearchParams(new URL(link).hash.slice(1)).get("token")!;
  await openAuthMail(tab, link);
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
beforeEach(async () => {
  // Cases share this generated disposable database, but not an SDK request
  // budget. Reset only synthetic fixture counters at the case boundary; every
  // request within a case still uses the unchanged real SDK/Google limiters.
  await fixture.ownerDb.delete(rateLimit);
});

afterAll(async () => {
  await Promise.all(contexts.map(context => context.close().catch(() => undefined)));
  await browser?.close().catch(() => undefined); await stop?.().catch(() => undefined); await fixture?.close().catch(() => undefined); restore?.();
}, 120_000);

async function installGoogleBoundary(tab: Page) {
  // Only GIS's external library is replaced here. Crypto/SDK behavior is tested
  // with synthetic signed keys in app/auth-http; this is not a Google round trip.
  await tab.route("https://accounts.google.com/gsi/client", route => route.fulfill({ contentType: "text/javascript", body: `(() => {
    window.google = { accounts: { id: {
      initialize(options) { window.__syntheticGoogleCallback = options.callback; window.__syntheticGoogleNonce = options.nonce; },
      renderButton(parent, options) { const button = document.createElement("button"); button.textContent = "Continue with Google"; button.type = "button"; button.addEventListener("click", () => options.click_listener()); parent.append(button); }
    } } };
  })();` }));
}
const syntheticGoogleCredential = `${Buffer.from('{"alg":"RS256"}').toString("base64url")}.e30.AA`;
async function callback(tab: Page, old = false) {
  await safe(() => tab.evaluate(({ credential, old }) => {
    const state = window as Window & { __syntheticGoogleCallback?: (result: { credential: string }) => void; __oldSyntheticGoogleCallback?: (result: { credential: string }) => void };
    (old ? state.__oldSyntheticGoogleCallback : state.__syntheticGoogleCallback)?.({ credential });
  }, { credential: syntheticGoogleCredential, old }));
}

it("prepares the real browser challenge and submits GIS credentials only in a bounded body", async () => {
  const tab = await page(); await installGoogleBoundary(tab);
  let posts = 0, valid = false;
  await tab.route("**/api/auth/sign-in/social", async route => {
    posts++; const body = route.request().postDataJSON();
    valid = Object.keys(body).sort().join() === "challengeId,credential,csrfToken" && body.credential === syntheticGoogleCredential
      && /^[A-Za-z0-9_-]{43}$/.test(body.challengeId) && /^[A-Za-z0-9_-]{43}$/.test(body.csrfToken) && !new URL(route.request().url()).search;
    await route.fulfill({ status: 400, contentType: "application/json", body: '{"error":"authentication"}' });
  });
  await navigate(tab, "/");
  await ui(tab.getByRole("button", { name: "Continue with Google", exact: true })).toBeVisible();
  expect(await tab.evaluate(() => /^[A-Za-z0-9_-]{43}$/.test((window as Window & { __syntheticGoogleNonce?: string }).__syntheticGoogleNonce ?? ""))).toBe(true);
  await safe(() => tab.getByRole("button", { name: "Continue with Google", exact: true }).click());
  await ui(tab.getByRole("button", { name: "Cancel Google sign-in", exact: true })).toBeVisible();
  await callback(tab);
  await ui(tab.getByText("Google sign-in is unavailable or this attempt ended. You can use email below.", { exact: true })).toBeVisible();
  expect(posts === 1 && valid).toBe(true);
  expect(new URL(tab.url()).pathname).toBe("/"); await clean(tab, [syntheticGoogleCredential]);
});

it("cancellation and acknowledged logout discard late GIS callbacks without posting an old credential", async () => {
  const tab = await page(); await installGoogleBoundary(tab); let posts = 0, signedIn = false;
  await tab.route("**/api/auth/sign-in/social", async route => { posts++; await route.fulfill({ status: 400, contentType: "application/json", body: '{"error":"authentication"}' }); });
  await tab.route("**/api/session", route => signedIn ? route.fulfill({ contentType: "application/json", body: JSON.stringify({ roles: [], membershipAvailable: false, sessionBinding: "A".repeat(43) }) }) : route.fallback());
  await navigate(tab, "/"); await ui(tab.getByRole("button", { name: "Continue with Google", exact: true })).toBeVisible();
  await safe(() => tab.getByRole("button", { name: "Continue with Google", exact: true }).click());
  await safe(() => tab.getByRole("button", { name: "Cancel Google sign-in", exact: true }).click());
  await callback(tab); expect(posts).toBe(0);
  // Keep the old closure in this document while the entry component unmounts.
  await navigate(tab, "/"); await ui(tab.getByRole("button", { name: "Continue with Google", exact: true })).toBeVisible();
  await safe(() => tab.evaluate(() => {
    const state = window as Window & { __syntheticGoogleCallback?: unknown; __oldSyntheticGoogleCallback?: unknown };
    state.__oldSyntheticGoogleCallback = state.__syntheticGoogleCallback;
  }));
  signedIn = true; await safe(() => tab.evaluate(() => window.dispatchEvent(new Event("focus"))));
  await ui(tab.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
  signedIn = false; await safe(() => tab.getByRole("button", { name: "Sign out", exact: true }).click());
  await ui(tab.getByRole("heading", { level: 2, name: "Sign in", exact: true })).toBeVisible();
  await callback(tab, true); expect(posts).toBe(0);
  await ui(tab.getByLabel("Email address")).toBeEnabled();
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
  const link = fixture.takeMail("pg-tutor@example.test"), token = new URLSearchParams(new URL(link).hash.slice(1)).get("token")!;
  await openAuthMail(tab, link); await ui(tab.getByRole("heading", { name: "You’re signed in", exact: true })).toBeVisible();
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

it("clears fragment history at both widths and waits for keyboard confirmation before sending a secret body", async () => {
  for (const mobile of [false, true]) {
    const tab = await page(mobile); await navigate(tab, "/sign-in");
    const email = mobile ? "fragment-mobile@example.test" : "fragment-desktop@example.test";
    expect((await api(tab, "/api/auth/sign-in/magic-link", { email })).status).toBe(200);
    const link = fixture.takeMail(email), token = new URLSearchParams(new URL(link).hash.slice(1)).get("token")!;
    let posts = 0, cleanRequests = true;
    tab.on("request", request => { if (new URL(request.url()).origin === BROWSER_ORIGIN && request.url().includes(token)) cleanRequests = false; });
    await tab.route("**/api/auth/email/confirm", async route => { posts++; expect(route.request().postDataJSON()).toEqual({ token }); await route.continue(); });
    await navigate(tab, link);
    await ui(tab.getByRole("button", { name: "Continue signing in", exact: true })).toBeEnabled();
    expect(posts).toBe(0); expect((await api(tab, "/api/session")).status).toBe(401);
    await clean(tab, [token, email]); await capture(tab, "email-confirm");
    await safe(() => tab.getByRole("button", { name: "Continue signing in", exact: true }).focus());
    await safe(() => tab.keyboard.press("Enter"));
    await ui(tab.getByRole("heading", { name: "You’re signed in", exact: true })).toBeVisible();
    expect(posts === 1 && cleanRequests).toBe(true);
    await navigate(tab, link); await safe(() => tab.reload({ waitUntil: "domcontentloaded" }));
    await ui(tab.getByRole("button", { name: "Continue signing in", exact: true })).toBeDisabled();
    expect(posts).toBe(1); await clean(tab, [token]);
  }
});

it("keeps invitation landing nonaccepting and accepts one reviewed binding only, with invalid/replayed links denied", async () => {
  const admin = await page(), recipient = await page(true);
  await navigate(admin, "/"); await signIn(admin, "pg-admin@example.test");
  const email = "ui-recipient@example.test";
  expect((await api(admin, "/api/admin/invitations", { role: "student", email, studentId: fixture.student.id })).status).toBe(201);
  const link = fixture.takeMail(email), token = new URLSearchParams(new URL(link).hash.slice(1)).get("token")!;
  let accepts = 0, bindingOnly = true, release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await recipient.route("**/api/invitations/accept", async route => {
    accepts++; const body = route.request().postDataJSON();
    bindingOnly = bindingOnly && Object.keys(body).join() === "reviewBinding" && typeof body.reviewBinding === "string" && !JSON.stringify(body).includes(token);
    const response = await route.fetch(); await gate; await route.fulfill({ response });
  });
  await navigate(recipient, link);
  await ui(recipient.getByRole("button", { name: "Review invitation", exact: true })).toBeEnabled();
  expect((await recipient.context().cookies()).some(cookie => cookie.name.includes("portal_pending_invitation"))).toBe(false);
  await clean(recipient, [token]);
  await safe(() => recipient.getByRole("button", { name: "Review invitation", exact: true }).click());
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
  await openAuthMail(recipient, link);
  await ui(recipient.getByRole("heading", { name: "Invitation unavailable", exact: true })).toBeVisible();
  expect((await navigate(recipient, "/invitations/open?token=invalid"))?.status()).toBe(400);
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
    await ui(tab.getByText("Google sign-in is unavailable or this attempt ended. You can use email below.", { exact: true })).toBeVisible();
    await ui(tab.getByLabel("Email address")).toBeEnabled();
    await clean(tab, ["PRIVATE_PROVIDER_SENTINEL"]);
  }
});
