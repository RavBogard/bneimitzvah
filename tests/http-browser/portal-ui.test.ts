import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { expect as ui } from "@playwright/test";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { browserFixture } from "./fixture";
import { assertBrowserStartupAllowed, BROWSER_ORIGIN, startBrowserServer } from "./server";
import { installLoopbackFetchGuard } from "./egress";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { entryTask, openAuthMail } from "./auth-navigation";
import { rateLimit } from "../../src/server/db/auth-schema";
vi.mock("server-only", () => ({}));

let fixture: Awaited<ReturnType<typeof browserFixture>>, browser: Browser, stop: (() => Promise<void>) | undefined;
let restore: (() => void) | undefined;
const contexts: BrowserContext[] = [];
async function safe<T>(action: () => Promise<T>): Promise<T> {
  try { return await action(); } catch { throw new Error("Portal UI browser operation failed; private details withheld"); }
}
async function navigate(tab: Page, url: string) { return safe(() => tab.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 })); }
// The harness aborts a trip to another origin. Chromium then commits its error page, and a goto issued before that commit fails with
// "Navigation ... is interrupted by another navigation to chrome-error://chromewebdata/". Start this before the click that leaves, and await it
// (after the leaving request) before the next navigation.
const errorPageAfterLeaving = (tab: Page) => tab.waitForEvent("framenavigated", { predicate: frame => frame === tab.mainFrame() && frame.url().startsWith("chrome-error:"), timeout: 30_000 });
async function referrerPolicy(tab: Page, value: "no-referrer" | "strict-origin-when-cross-origin") {
  await ui.poll(() => tab.locator('head meta[name="referrer"]').evaluateAll(nodes => nodes.map(node => (node as HTMLMetaElement).content))).toEqual([value]);
}
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
  await ui(entryTask(tab, "sign-in", "address")).toBeVisible();
  if (!invitation) await capture(tab, "sign-in");
  await safe(() => tab.getByLabel("Email address", { exact: true }).fill(email));
  await safe(() => tab.getByTestId("entry-email-submit").click());
  await ui(entryTask(tab, "sign-in", "code")).toBeVisible();
  const link = fixture.takeMail(email), token = new URLSearchParams(new URL(link).hash.slice(1)).get("token")!;
  await openAuthMail(tab, link);
  // An invitation link lands on its review page; a plain sign-in link lands on the front door, now signed in (its header offers Account).
  if (invitation) await ui(entryTask(tab, "invitation")).toBeVisible();
  else { await navigate(tab, "/"); await ui(tab.locator('[data-door="beit-mitzvah"]:not([data-door-state="loading"])')).toBeVisible(); await ui(tab.getByRole("banner").getByRole("link", { name: "My Readings", exact: true })).toBeVisible(); }
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

it("restricts inline Google metadata to public safe queries and preserves private handoff policy", async () => {
  const tab = await page(); await installGoogleBoundary(tab); let libraries = 0;
  tab.on("request", request => { if (request.url() === "https://accounts.google.com/gsi/client") libraries++; });
  await navigate(tab, "/account"); await ui(entryTask(tab, "sign-in", "address")).toBeVisible(); await referrerPolicy(tab, "no-referrer");
  const handoff = tab.getByRole("link", { name: "Continue with Google", exact: true }); expect(await handoff.getAttribute("href")).toBe("/sign-in?intent=account"); expect(libraries).toBe(0);
  let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; });
  try {
    await tab.route("**/api/auth/sign-in/magic-link", async route => { await held; await route.fulfill({ contentType: "application/json", body: '{"requested":true}' }); });
    await tab.getByLabel("Email address").fill("synthetic-account@example.test"); await tab.getByTestId("entry-email-submit").click();
    await ui(handoff).toHaveAttribute("aria-disabled", "true"); await handoff.evaluate(node => (node as HTMLAnchorElement).click()); expect(new URL(tab.url()).pathname).toBe("/account");
  } finally { release(); }
  await ui(entryTask(tab, "sign-in", "code")).toBeVisible();
  await navigate(tab, "/sign-in?intent=foreign&token=synthetic"); await referrerPolicy(tab, "no-referrer");
  // Within the code's 5 minutes this device reopens on the code form (1.5); Use a different email returns to the choices.
  await ui(entryTask(tab, "sign-in", "code")).toBeVisible(); await tab.getByRole("button", { name: "Use a different email", exact: true }).click();
  await ui(tab.getByRole("link", { name: "Continue with Google", exact: true })).toHaveAttribute("href", "/sign-in"); expect(libraries).toBe(0);
  await tab.getByRole("link", { name: "Continue with Google", exact: true }).click(); await ui(tab.getByRole("button", { name: "Continue with Google", exact: true })).toBeEnabled(); await referrerPolicy(tab, "strict-origin-when-cross-origin");
  // Our own button (decision 8, N20): nothing from Google is loaded until it is pressed.
  expect(await tab.locator('script[src*="accounts.google.com"]').count()).toBe(0); expect(libraries).toBe(0); expect(new URL(tab.url()).search).toBe("");
});

it("passes only the fixed Account destination to Google's redirect and loads nothing from Google before Continue with Google", async () => {
  const tab = await page(); await installGoogleBoundary(tab); const asked: unknown[] = []; let libraries = 0;
  tab.on("request", request => { if (new URL(request.url()).origin === "https://accounts.google.com" && new URL(request.url()).pathname !== "/o/oauth2/v2/auth") libraries++; });
  await tab.route("**/api/auth/google/redirect", route => { asked.push(route.request().postDataJSON());
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ url: "https://accounts.google.com/o/oauth2/v2/auth?client_id=synthetic&state=synthetic" }) }); });
  await navigate(tab, "/sign-in?intent=account"); await ui(tab.getByRole("button", { name: "Continue with Google", exact: true })).toBeEnabled(); await referrerPolicy(tab, "strict-origin-when-cross-origin");
  expect(libraries).toBe(0);
  const leaving = tab.waitForRequest(request => request.url().startsWith("https://accounts.google.com/o/oauth2/v2/auth?"), { timeout: 30_000 });
  await safe(() => tab.getByRole("button", { name: "Continue with Google", exact: true }).click());
  await safe(() => leaving);
  expect(asked).toEqual([{ next: "account" }]); expect(libraries).toBe(0);
});

it("single-submits a real magic link, shows separate genuine roles without fake destinations, and signs out", async () => {
  const tab = await page(); await navigate(tab, "/sign-in");
  await ui(entryTask(tab, "sign-in", "address")).toBeVisible();
  await safe(() => tab.getByLabel("Email address").fill("pg-tutor@example.test"));
  let posts = 0, release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await tab.route("**/api/auth/sign-in/magic-link", async route => { posts++; const response = await route.fetch(); await gate; await route.fulfill({ response }); });
  try {
    await safe(() => tab.getByTestId("entry-email-submit").evaluate(node => { const button = node as HTMLButtonElement; button.click(); button.click(); }));
    await ui(tab.getByTestId("entry-email-submit")).toBeDisabled();
    await ui(tab.getByLabel("Email address")).toBeDisabled(); await ui.poll(() => posts).toBe(1);
  } finally { release(); }
  await ui(entryTask(tab, "sign-in", "code")).toBeVisible();
  const link = fixture.takeMail("pg-tutor@example.test"), token = new URLSearchParams(new URL(link).hash.slice(1)).get("token")!;
  await openAuthMail(tab, link); await navigate(tab, "/"); await ui(tab.locator('[data-door="beit-mitzvah"]:not([data-door-state="loading"])')).toBeVisible();
  // The front door is the highest role's door (a tutor who is also a parent); the roles themselves are on Account.
  await ui(tab.locator('[data-door="beit-mitzvah"]').getByTestId("door-action")).toHaveAttribute("href", "/mine");
  await clean(tab, [token, "pg-tutor@example.test"]);
  await navigate(tab, "/account");
  const roles = tab.getByTestId("account-roles");
  // Two genuine roles, each a link to its own workspace and nothing else.
  await ui(roles.getByRole("link").first()).toBeVisible();
  expect(await roles.getByRole("link").count()).toBe(2);
  // Both roles open My Readings (Area A); the role pages are reached from its rows.
  await roles.getByRole("link").first().click(); await ui.poll(() => new URL(tab.url()).pathname).toBe("/mine");
  await ui(tab.getByTestId("mine-interim-parent")).toBeVisible(); await ui(tab.getByTestId("mine-interim-tutor")).toBeVisible();
  await tab.locator('a[href="/workspace/parent"]').click(); await ui.poll(() => new URL(tab.url()).pathname).toBe("/workspace/parent");
  // The old role pills are gone; the workspace brand is an actual controlled Next router link.
  await tab.evaluate(() => { (window as Window & { __r01SpaDocument?: boolean }).__r01SpaDocument = true; });
  await tab.getByTestId("site-brand").click();
  await ui.poll(() => new URL(tab.url()).pathname).toBe("/"); await referrerPolicy(tab, "strict-origin-when-cross-origin");
  expect(await tab.evaluate(() => (window as Window & { __r01SpaDocument?: boolean }).__r01SpaDocument), "Workspace brand must preserve the hydrated document").toBe(true);
  await tab.goBack({ waitUntil: "domcontentloaded" }); await ui.poll(() => new URL(tab.url()).pathname).toBe("/workspace/parent"); await referrerPolicy(tab, "no-referrer");
  expect(await tab.evaluate(() => (window as Window & { __r01SpaDocument?: boolean }).__r01SpaDocument), "History back must preserve the same document").toBe(true);
  await tab.getByTestId("site-brand").click();
  await ui.poll(() => new URL(tab.url()).pathname).toBe("/"); await ui(tab.locator('[data-door="beit-mitzvah"][data-door-role="parent"]')).toBeVisible();
  await navigate(tab, "/account");
  await safe(() => tab.getByRole("button", { name: "Sign out", exact: true }).click());
  await ui(entryTask(tab, "sign-in", "address")).toBeVisible();
  expect((await api(tab, "/api/session")).status).toBe(401);
});

it("signs in with the typed code from the sign-in email, survives a relaunch, and ends a code after three wrong tries", async () => {
  const email = "pg-tutor@example.test", tab = await page(true); await navigate(tab, "/sign-in");
  const ask = async () => {
    await ui(entryTask(tab, "sign-in", "address")).toBeVisible();
    await safe(() => tab.getByLabel("Email address", { exact: true }).fill(email));
    await safe(() => tab.getByTestId("entry-email-submit").click());
    await ui(entryTask(tab, "sign-in", "code")).toBeVisible();
    return fixture.takeCode(email);
  };
  const type = async (value: string) => {
    const input = tab.getByLabel("Sign-in code", { exact: true });
    expect(await input.getAttribute("inputmode")).toBe("numeric");
    expect(await input.getAttribute("autocomplete")).toBe("one-time-code");
    await safe(() => input.fill(value));
    await safe(() => tab.getByTestId("entry-code-submit").click());
  };
  const first = await ask(), wrong = String((Number(first) + 1) % 1_000_000).padStart(6, "0");
  // An installed app relaunched from Mail reopens on the code form: only a timestamp is stored, never the code or address.
  await navigate(tab, "/sign-in");
  await ui(entryTask(tab, "sign-in", "code")).toBeVisible();
  await clean(tab, [first, email]);
  await type(wrong);
  // Deliberate wording test for the sign-in code: approved copy, change only with the copy.
  await ui(entryTask(tab, "sign-in", "code").getByRole("alert")).toHaveText("That code didn’t match. Check the email and try again.");
  await ui(tab.getByLabel("Sign-in code", { exact: true })).toHaveValue("");
  // A wrong try keeps the code form; the third ends the code and returns to the address form, with a message either way.
  await type(wrong);
  await ui(entryTask(tab, "sign-in", "code")).toBeVisible(); await ui(entryTask(tab, "sign-in").getByRole("alert")).toBeVisible();
  await type(wrong);
  await ui(entryTask(tab, "sign-in", "address")).toBeVisible(); await ui(entryTask(tab, "sign-in").getByRole("alert")).toBeVisible();
  await ui(entryTask(tab, "sign-in", "address")).toBeVisible();
  expect(await tab.evaluate(() => localStorage.getItem("crc.signin.code-requested-at"))).toBeNull();
  await clean(tab, [first, email]);
  const second = await ask();
  await type(second);
  await ui.poll(() => new URL(tab.url()).pathname).toBe("/mine"); await navigate(tab, "/");
  await ui(tab.locator('[data-door="beit-mitzvah"]:not([data-door-state="loading"])')).toBeVisible();
  await clean(tab, [second, email]);
  expect(await tab.evaluate(() => localStorage.getItem("crc.signin.code-requested-at"))).toBeNull();
  await navigate(tab, "/account");
  await safe(() => tab.getByRole("button", { name: "Sign out", exact: true }).click());
  await ui(entryTask(tab, "sign-in", "address")).toBeVisible();
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
    await ui(tab.getByTestId("auth-landing-continue")).toBeEnabled();
    expect(posts).toBe(0); expect((await api(tab, "/api/session")).status).toBe(401);
    await clean(tab, [token, email]); await capture(tab, "email-confirm");
    await safe(() => tab.getByTestId("auth-landing-continue").focus());
    await safe(() => tab.keyboard.press("Enter"));
    await ui.poll(() => new URL(tab.url()).pathname).toBe("/mine"); await navigate(tab, "/");
    await ui(tab.locator('[data-door="beit-mitzvah"]:not([data-door-state="loading"])')).toBeVisible();
    expect(posts === 1 && cleanRequests).toBe(true);
    await navigate(tab, link); await safe(() => tab.reload({ waitUntil: "domcontentloaded" }));
    await ui(tab.getByTestId("auth-landing-continue")).toBeDisabled();
    expect(posts).toBe(1); await clean(tab, [token]);
  }
});

it("keeps invitation landing nonaccepting and accepts one reviewed binding only, with invalid/replayed links denied", async () => {
  const admin = await page(), recipient = await page(true);
  await navigate(admin, "/sign-in"); await signIn(admin, "pg-admin@example.test");
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
  await ui(recipient.getByTestId("auth-landing-continue")).toBeEnabled();
  expect((await recipient.context().cookies()).some(cookie => cookie.name.includes("portal_pending_invitation"))).toBe(false);
  await clean(recipient, [token]);
  await safe(() => recipient.getByTestId("auth-landing-continue").click());
  await ui(entryTask(recipient, "sign-in", "address")).toBeVisible();
  await referrerPolicy(recipient, "no-referrer"); await ui(recipient.getByRole("link", { name: "Continue with Google", exact: true })).toHaveAttribute("href", "/sign-in");
  expect(accepts).toBe(0);
  expect(await recipient.getByTestId("invitation-accept").count()).toBe(0);
  await signIn(recipient, email, true);
  await capture(recipient, "invitation-review");
  const desktopReview = await recipient.context().newPage();
  try {
    await desktopReview.setViewportSize({ width: 1440, height: 900 }); await navigate(desktopReview, "/invitations/accept");
    await ui(entryTask(desktopReview, "invitation")).toBeVisible();
    await capture(desktopReview, "invitation-review");
  } finally { await desktopReview.close(); }
  expect((await api(recipient, "/api/session")).data.membershipAvailable).toBe(false);
  expect(accepts).toBe(0);
  // Leave an unaccepted review in browser history, log out in another tab,
  // then restore it. A stale private review must not remain visible on return.
  await navigate(recipient, "/");
  await ui(recipient.locator('[data-door="beit-mitzvah"]:not([data-door-state="loading"])')).toBeVisible();
  const logoutTab = await recipient.context().newPage();
  try {
    await navigate(logoutTab, "/");
    expect((await api(logoutTab, "/api/auth/sign-out", {})).status).toBe(200);
    await safe(() => recipient.goBack({ waitUntil: "domcontentloaded", timeout: 30_000 }));
    await ui(entryTask(recipient, "sign-in", "address")).toBeVisible();
    const restored = await recipient.evaluate(() => Boolean((window as Window & { __reviewHistoryRestored?: boolean }).__reviewHistoryRestored));
    console.info("History privacy probe used native BFCache:", restored);
    expect(await recipient.getByTestId("invitation-accept").count()).toBe(0);
    expect(await recipient.evaluate(label => !(document.body.textContent ?? "").includes(label), `${fixture.student.firstName} ${fixture.student.lastName}`)).toBe(true);
  } finally { await logoutTab.close(); }
  await signIn(recipient, email, true);
  try {
    await safe(() => recipient.getByTestId("invitation-accept").evaluate(node => { const button = node as HTMLButtonElement; button.click(); button.click(); }));
    await ui(recipient.getByTestId("invitation-accept")).toBeDisabled();
    await ui.poll(() => accepts).toBe(1); expect(bindingOnly).toBe(true);
  } finally { release(); }
  await ui(entryTask(recipient, "accepted")).toBeVisible();
  await clean(recipient, [token, email]);
  await safe(() => recipient.getByTestId("invitation-continue").click());
  // Continue lands on My Readings (Area A); the student's pages open from its interim row.
  await ui(recipient.getByTestId("mine-interim-student")).toBeVisible();
  await recipient.locator('a[href="/workspace/student"]').click();
  await ui(recipient.locator("[data-today]")).toBeVisible();
  expect(new URL(recipient.url()).pathname === "/workspace/student").toBe(true);
  expect(await recipient.getByTestId("entry-task").count()).toBe(0);
  await openAuthMail(recipient, link);
  await ui(entryTask(recipient, "invalid-invitation")).toBeVisible();
  expect((await navigate(recipient, "/invitations/open?token=invalid"))?.status()).toBe(400);
  const unknown = await page(); await navigate(unknown, "/invitations/accept");
  await ui(entryTask(unknown, "invalid-invitation")).toBeVisible();
  expect(accepts).toBe(1);
});

it("revalidates an uninvited real session after logout in another tab", async () => {
  const tab = await page(true); await navigate(tab, "/sign-in"); await signIn(tab, "ui-uninvited@example.test");
  expect(await tab.getByTestId("account-roles").count()).toBe(0);
  await ui(tab.locator('[data-request-state="requestable"]')).toBeVisible();
  const other = await tab.context().newPage(); await navigate(other, "/");
  expect((await api(other, "/api/auth/sign-out", {})).status).toBe(200);
  await safe(() => tab.evaluate(() => window.dispatchEvent(new Event("focus"))));
  await ui(tab.locator('[data-door="beit-mitzvah"]').getByRole("link", { name: "Sign in", exact: true })).toBeVisible();
  await clean(tab, ["ui-uninvited@example.test"]);
});

it("handles mocked setup/provider failures with retry, fixed diagnostics and accessible focus at both widths", async () => {
  for (const mobile of [false, true]) {
    const tab = await page(mobile); let unavailable = true;
    await tab.route("**/api/session", route => unavailable
      ? route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"PRIVATE_PROVIDER_SENTINEL"}' }) : route.fallback());
    await navigate(tab, "/"); await ui(entryTask(tab, "unavailable")).toBeVisible();
    expect(await tab.getByLabel("Email address").count()).toBe(0); await clean(tab, ["PRIVATE_PROVIDER_SENTINEL"]);
    unavailable = false; await safe(() => tab.getByRole("button", { name: "Try again", exact: true }).click());
    // The home's Beit Mitzvah door is a link to the sign-in page; the form and Google are on /sign-in.
    await ui(tab.locator('[data-door="beit-mitzvah"]').getByRole("link", { name: "Sign in", exact: true })).toBeVisible();
    await clean(tab, ["PRIVATE_PROVIDER_SENTINEL"]);
  }
});

it("the sign-in page offers our own Continue with Google, which asks the portal for Google's address, carries a return address, and goes there", async () => {
  const tab = await page(true); const asked: unknown[] = [];
  await tab.route("**/api/auth/google/redirect", route => { asked.push(route.request().postDataJSON());
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ url: "https://accounts.google.com/o/oauth2/v2/auth?client_id=synthetic&state=synthetic" }) }); });
  await navigate(tab, `/sign-in?return=${encodeURIComponent("/read?date=2026-10-31&lens=study")}`);
  const leaving = tab.waitForRequest(request => request.url().startsWith("https://accounts.google.com/o/oauth2/v2/auth?"), { timeout: 30_000 });
  await safe(() => tab.getByRole("button", { name: "Continue with Google", exact: true }).click());
  await safe(() => leaving);
  expect(asked).toEqual([{ return: "/read?date=2026-10-31&lens=study" }]);
});

describe("Connect Claude consent page on a phone", () => {
  const pending = "synthetic.pending-request_A1", phoneHelp = "On a phone, if Google won’t open inside Claude, use the ⋮ menu to open this page in Chrome (or Safari), then continue there.";
  const staff = { name: "Synthetic Tutor", google: true, role: "tutor", scopes: ["portal:read"], viewer: "synthetic-viewer" };
  async function consentRoutes(tab: Page, answers: { view?: () => Record<string, unknown>; approve?: Record<string, unknown>; deny?: Record<string, unknown> }) {
    const seen: { path: string; request: unknown }[] = [];
    for (const path of ["view", "approve", "deny"] as const) await tab.route(`**/api/oauth/consent/${path}`, route => {
      seen.push({ path, request: route.request().postDataJSON().request });
      const body = path === "view" ? (answers.view?.() ?? { clientName: "Claude", destination: "claude.ai", account: null }) : (answers[path] ?? { error: "unavailable" });
      return route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
    });
    return seen;
  }
  // The first visit compiles /connect in the isolated dev server; React dev effects may run twice.
  const connect = (tab: Page, state: "ready" | "expired" | "used") => ui(tab.locator(`[data-testid="connect-task"][data-connect-state="${state}"]`)).toBeVisible({ timeout: 60_000 });
  const views = (seen: { path: string; request: unknown }[]) => seen.filter(entry => entry.path === "view").map(entry => entry.request);

  // Deliberate wording test for the Connect Claude consent page: approved copy, change only with the copy.
  it("keeps the request across Try Google again and a reload, offers phone help not email, and forgets it on Cancel", async () => {
    const tab = await page(true), seen = await consentRoutes(tab, {});
    await navigate(tab, `/connect#request=${pending}`);
    await connect(tab, "ready");
    await ui(tab.getByText("Google sign-in didn’t open here.", { exact: true })).toBeVisible();
    await ui(tab.getByText(phoneHelp, { exact: true })).toBeVisible();
    await ui(tab.getByText(/within 15 minutes\.$/)).toBeVisible();
    await ui(tab.getByRole("button", { name: "Continue with Google in this window", exact: true })).toBeVisible();
    // "Open in Chrome" from a Custom Tab: another tab of the same browser, after Google failed here.
    const chrome = await tab.context().newPage(); await consentRoutes(chrome, {}); await navigate(chrome, "/connect"); await connect(chrome, "ready"); await chrome.close();
    expect(await tab.locator("main").textContent()).not.toMatch(/email/i);
    expect(await tab.getByLabel("Email address").count()).toBe(0);
    expect(new URL(tab.url()).hash).toBe("");
    await safe(() => tab.evaluate(() => { (window as Window & { __sameDocument?: boolean }).__sameDocument = true; }));
    await installGoogleBoundary(tab);
    await safe(() => tab.getByRole("button", { name: "Try Google again", exact: true }).click());
    await ui(tab.getByRole("button", { name: "Continue with Google", exact: true })).toBeVisible();
    expect(await tab.evaluate(() => (window as Window & { __sameDocument?: boolean }).__sameDocument === true)).toBe(true);
    // A reload (or "Open in Chrome", which shares this origin's storage) still finds the request.
    await safe(() => tab.reload({ waitUntil: "domcontentloaded" }));
    await connect(tab, "ready");
    expect(seen.every(entry => entry.path === "view" && entry.request === pending)).toBe(true);
    await safe(() => tab.getByRole("button", { name: "Cancel", exact: true }).click());
    // Scoped to the page: after the reload, Next's route announcer is also a role="alert" element.
    await ui(tab.locator("main").getByRole("alert")).toBeVisible();
    expect(seen.at(-1)).toEqual({ path: "deny", request: pending });
    const asked = seen.length;
    await navigate(tab, "/connect"); await connect(tab, "expired");
    expect(seen.length).toBe(asked);
  });

  // The GIS popup now lives only here (decision 8, N20: the sign-in pages use our own button on the redirect path).
  it("prepares the real browser challenge and submits GIS credentials only in a bounded body", async () => {
    const tab = await page(); await consentRoutes(tab, {}); await installGoogleBoundary(tab);
    let posts = 0, valid = false;
    await tab.route("**/api/auth/sign-in/social", async route => {
      posts++; const body = route.request().postDataJSON();
      valid = Object.keys(body).sort().join() === "challengeId,credential,csrfToken" && body.credential === syntheticGoogleCredential
        && /^[A-Za-z0-9_-]{43}$/.test(body.challengeId) && /^[A-Za-z0-9_-]{43}$/.test(body.csrfToken) && !new URL(route.request().url()).search;
      await route.fulfill({ status: 400, contentType: "application/json", body: '{"error":"authentication"}' });
    });
    await navigate(tab, `/connect#request=${pending}`); await connect(tab, "ready");
    await ui(tab.getByRole("button", { name: "Continue with Google", exact: true })).toBeVisible();
    expect(await tab.evaluate(() => /^[A-Za-z0-9_-]{43}$/.test((window as Window & { __syntheticGoogleNonce?: string }).__syntheticGoogleNonce ?? ""))).toBe(true);
    await safe(() => tab.getByRole("button", { name: "Continue with Google", exact: true }).click());
    await ui(tab.getByRole("button", { name: "Cancel Google sign-in", exact: true })).toBeVisible();
    await callback(tab);
    await ui(tab.getByTestId("google-sign-in-failed")).toBeVisible();
    expect(posts === 1 && valid).toBe(true);
    expect(new URL(tab.url()).pathname).toBe("/connect"); await clean(tab, [syntheticGoogleCredential]);
  });

  it("cancellation and a retried attempt discard late GIS callbacks without posting an old credential", async () => {
    const tab = await page(); await consentRoutes(tab, {}); await installGoogleBoundary(tab); let posts = 0, challenges = 0;
    tab.on("request", request => { if (new URL(request.url()).pathname === "/api/auth/google/challenge") challenges++; });
    await tab.route("**/api/auth/sign-in/social", async route => { posts++; await route.fulfill({ status: 400, contentType: "application/json", body: '{"error":"authentication"}' }); });
    await navigate(tab, `/connect#request=${pending}`); await connect(tab, "ready");
    await ui(tab.getByRole("button", { name: "Continue with Google", exact: true })).toBeVisible();
    await safe(() => tab.getByRole("button", { name: "Continue with Google", exact: true }).click());
    await safe(() => tab.getByRole("button", { name: "Cancel Google sign-in", exact: true }).click());
    await callback(tab); expect(posts).toBe(0);
    await safe(() => tab.evaluate(() => {
      const state = window as Window & { __syntheticGoogleCallback?: unknown; __oldSyntheticGoogleCallback?: unknown };
      state.__oldSyntheticGoogleCallback = state.__syntheticGoogleCallback;
    }));
    const before = challenges;
    await safe(() => tab.getByRole("button", { name: "Try Google again", exact: true }).click());
    await ui(tab.getByRole("button", { name: "Continue with Google", exact: true })).toBeVisible();
    expect(challenges).toBeGreaterThanOrEqual(before + 1);
    await callback(tab, true); expect(posts).toBe(0);
  });

  it("Continue with Google in this window keeps the request in this tab for the return from Google", async () => {
    const tab = await page(true), seen = await consentRoutes(tab, {}), asked: unknown[] = [];
    await tab.route("**/api/auth/google/redirect", route => { asked.push(route.request().postDataJSON());
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ url: "https://accounts.google.com/o/oauth2/v2/auth?client_id=synthetic&state=synthetic" }) }); });
    await navigate(tab, `/connect#request=${pending}`); await connect(tab, "ready");
    const leaving = tab.waitForRequest(request => request.url().startsWith("https://accounts.google.com/o/oauth2/v2/auth?"), { timeout: 30_000 }), errorPage = errorPageAfterLeaving(tab);
    await safe(() => tab.getByRole("button", { name: "Continue with Google in this window", exact: true }).click());
    await safe(() => leaving); await safe(() => errorPage);
    expect(asked).toEqual([{ next: "connect" }]);
    // Google returns to /connect in this same tab (the harness aborts the real trip).
    await navigate(tab, "/connect"); await connect(tab, "ready");
    expect(views(seen).at(-1)).toBe(pending);
    // A failed Google return lands back here with a plain error, the request recovered and the address bar clean.
    await navigate(tab, "/connect?google=failed"); await connect(tab, "ready");
    await ui(tab.getByTestId("connect-task").getByRole("alert")).toBeVisible();
    expect(new URL(tab.url()).search).toBe(""); expect(views(seen).at(-1)).toBe(pending);
  });

  it("says a request already allowed was used, from Allow or from the view, and forgets it", async () => {
    const tab = await page(true); let used = false;
    const seen = await consentRoutes(tab, { view: () => used ? { error: "used" } : { clientName: "Claude", destination: "claude.ai", account: staff }, approve: { error: "used" } });
    await navigate(tab, `/connect#request=${pending}`); await connect(tab, "ready");
    await safe(() => tab.getByRole("button", { name: "Allow", exact: true }).click());
    await connect(tab, "used");
    await ui(tab.getByRole("button", { name: "Allow", exact: true })).toHaveCount(0);
    // Forgotten: a later visit without a fragment asks the server nothing.
    const asked = views(seen).length;
    await navigate(tab, "/connect"); await connect(tab, "expired");
    expect(views(seen).length).toBe(asked);
    used = true; await navigate(tab, "about:blank"); await navigate(tab, `/connect#request=${pending}`);
    await connect(tab, "used");
  });

  it("forgets the stored request after Allow and after an expired answer, and a fresh fragment wins", async () => {
    const tab = await page(true); let expired = false;
    const seen = await consentRoutes(tab, { view: () => expired ? { error: "expired" } : { clientName: "Claude", destination: "claude.ai", account: staff },
      approve: { redirect: "https://claude.ai/api/mcp/auth_callback?code=synthetic&state=s1" } });
    await navigate(tab, `/connect#request=${pending}`); await connect(tab, "ready");
    // The redirect to claude.ai is aborted by this harness; the copy is dropped before it leaves.
    const leaving = tab.waitForRequest(request => new URL(request.url()).origin === "https://claude.ai", { timeout: 30_000 }), errorPage = errorPageAfterLeaving(tab);
    await safe(() => tab.getByRole("button", { name: "Allow", exact: true }).click());
    await safe(() => leaving); await safe(() => errorPage);
    expect(seen.some(entry => entry.path === "approve" && entry.request === pending)).toBe(true);
    const asked = views(seen).length;
    await navigate(tab, "/connect"); await connect(tab, "expired");
    expect(views(seen).length).toBe(asked);
    const other = "synthetic.other-request_B2";
    // A fragment-only change to the same URL would not reload the page; start a fresh document.
    await navigate(tab, "about:blank"); await navigate(tab, `/connect#request=${other}`); await connect(tab, "ready");
    expired = true; await navigate(tab, "/connect"); await connect(tab, "expired");
    expect([...new Set(views(seen))]).toEqual([pending, other]);
    const askedAfterExpiry = views(seen).length;
    expired = false; await navigate(tab, "/connect"); await connect(tab, "expired");
    expect(views(seen).length).toBe(askedAfterExpiry);
  });
});
