import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { browserFixture } from "./fixture";
import { BROWSER_ORIGIN, assertBrowserStartupAllowed, startBrowserServer } from "./server";
import { installLoopbackFetchGuard } from "./egress";

vi.mock("server-only", () => ({}));
type Fixture = Awaited<ReturnType<typeof browserFixture>>;
let fixture: Fixture, browser: Browser, stopServer: () => Promise<void>;
const contexts: BrowserContext[] = [];
let restoreFetch: (() => void) | undefined;

async function page() {
  const context = await browser.newContext({ baseURL: BROWSER_ORIGIN, serviceWorkers: "block", acceptDownloads: false, recordVideo: undefined });
  contexts.push(context);
  await context.route("**/*", async route => {
    try { if (new URL(route.request().url()).origin === BROWSER_ORIGIN) await route.continue(); else await route.abort(); }
    catch { await route.abort(); }
  });
  const tab = await context.newPage();
  try { await tab.goto("/", { waitUntil: "domcontentloaded", timeout: 30_000 }); }
  catch { throw new Error("Browser page startup failed; details withheld"); }
  return tab;
}

async function call(tab: Page, path: string, method = "GET", body?: unknown, practice?: string) {
  try {
    return await tab.evaluate(async ({ path, method, body, practice }) => {
      const headers: Record<string, string> = body === undefined ? {} : { "content-type": "application/json" };
      if (practice !== undefined) headers["X-Practice-Context"] = practice;
      const response = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store" });
      let data: Record<string, any> = {};
      if ((response.headers.get("content-type") ?? "").includes("application/json")) data = await response.json();
      return { status: response.status, data };
    }, { path, method, body, practice });
  } catch { throw new Error("Browser HTTP exchange failed; details withheld"); }
}

async function signIn(tab: Page, email: string) {
  const requested = await call(tab, "/api/auth/sign-in/magic-link", "POST", { email });
  expect(requested.status === 200).toBe(true);
  const link = fixture.takeMail(email);
  try { await tab.goto(link, { waitUntil: "domcontentloaded", timeout: 30_000 }); }
  catch { throw new Error("Magic-link browser navigation failed; details withheld"); }
  const session = await call(tab, "/api/session");
  expect(session.status === 200).toBe(true);
  return session.data;
}

beforeAll(async () => {
  try {
    assertBrowserStartupAllowed();
    restoreFetch = installLoopbackFetchGuard();
    fixture = await browserFixture();
    await fixture.practice(); // Second synthetic sibling under the same parent grant.
    stopServer = await startBrowserServer(fixture.withRuntime);
    browser = await chromium.launch({ headless: true });
  } catch {
    restoreFetch?.();
    await browser?.close().catch(() => undefined);
    await stopServer?.().catch(() => undefined);
    await fixture?.close().catch(() => undefined);
    throw new Error("Isolated browser harness startup failed; details withheld");
  }
}, 120_000);
afterAll(async () => {
  await Promise.all(contexts.map(context => context.close().catch(() => undefined)));
  await browser?.close().catch(() => undefined);
  await stopServer?.().catch(() => undefined);
  await fixture?.close().catch(() => undefined);
  restoreFetch?.();
}, 120_000);

describe("real browser, SDK cookies and restricted PostgreSQL", () => {
  it("signs in through HTTP, keeps child practice authority in each tab, and logs out", async () => {
    const admin = await page(), parent = await page();
    const adminSession = await signIn(admin, "pg-admin@example.test");
    expect(adminSession.roles.includes("admin")).toBe(true);
    const parentSession = await signIn(parent, "pg-tutor@example.test");
    expect(parentSession.roles.includes("tutor") && parentSession.roles.includes("parent")).toBe(true);
    expect((await call(admin, "/api/admin/students")).status === 200).toBe(true);
    expect((await call(parent, "/api/students?mode=tutor")).status === 200).toBe(true);
    expect((await call(parent, "/api/students?mode=parent")).status === 200).toBe(true);
    const siblings = (await call(parent, "/api/students?mode=parent")).data.students;
    expect(siblings.length === 2).toBe(true);
    const secondTab = await parent.context().newPage();
    try { await secondTab.goto("/", { waitUntil: "domcontentloaded" }); }
    catch { throw new Error("Second browser tab startup failed; details withheld"); }
    const first = await call(parent, "/api/practice/enter", "POST", { studentId: siblings[0].id });
    const second = await call(secondTab, "/api/practice/enter", "POST", { studentId: siblings[1].id });
    expect(first.status === 201 && second.status === 201 && first.data.handle !== second.data.handle).toBe(true);
    expect((await call(parent, `/api/practice/read?mode=child-practice&studentId=${siblings[0].id}`, "GET", undefined, first.data.handle)).status === 200).toBe(true);
    expect((await call(secondTab, `/api/practice/read?mode=child-practice&studentId=${siblings[1].id}`, "GET", undefined, second.data.handle)).status === 200).toBe(true);
    expect((await call(parent, `/api/practice/read?mode=child-practice&studentId=${siblings[1].id}`, "GET", undefined, first.data.handle)).status === 404).toBe(true);
    const switched = await call(parent, "/api/practice/switch", "POST", { studentId: siblings[1].id }, first.data.handle);
    expect(switched.status === 201).toBe(true);
    expect((await call(parent, `/api/practice/read?mode=child-practice&studentId=${siblings[0].id}`, "GET", undefined, first.data.handle)).status === 404).toBe(true);
    expect((await call(secondTab, `/api/practice/read?mode=child-practice&studentId=${siblings[1].id}`, "GET", undefined, second.data.handle)).status === 200).toBe(true);
    expect((await call(parent, `/api/students/${siblings[1].id}/reading?mode=tutor`, "GET", undefined, switched.data.handle)).status === 403).toBe(true);
    expect((await call(parent, "/api/auth/sign-out", "POST", {})).status === 200).toBe(true);
    expect((await call(parent, "/api/session")).status === 401).toBe(true);
  }, 120_000);

  it("requires recipient verification, preview and explicit one-time acceptance", async () => {
    const admin = await page(), recipient = await page();
    await signIn(admin, "pg-admin@example.test");
    const studentId = fixture.student.id;
    const invite = await call(admin, "/api/admin/invitations", "POST", { role: "student", email: "browser-learner@example.test", studentId });
    expect(invite.status === 201 && invite.data.delivery === "sent").toBe(true);
    const listed = await call(admin, "/api/admin/invitations");
    expect(listed.status === 200 && Array.isArray(listed.data.invitations) && listed.data.invitations.some(
      (row: { id?: unknown; status?: unknown; delivery?: { status?: unknown } }) => row.id === invite.data.inviteId && row.status === "pending" && row.delivery?.status === "sent",
    )).toBe(true);
    const invitationLink = fixture.takeMail("browser-learner@example.test");
    try { await recipient.goto(invitationLink, { waitUntil: "domcontentloaded" }); }
    catch { throw new Error("Invitation browser navigation failed; details withheld"); }
    expect((await call(recipient, `/api/students/${studentId}?mode=student`)).status === 401).toBe(true);
    await signIn(recipient, "browser-learner@example.test");
    const preview = await call(recipient, "/api/invitations/pending");
    expect(preview.status === 200 && preview.data.requiresConfirmation === true).toBe(true);
    expect((await call(recipient, `/api/students/${studentId}?mode=student`)).status === 403).toBe(true);
    const accepted = await call(recipient, "/api/invitations/accept", "POST", { reviewBinding: preview.data.reviewBinding });
    expect(accepted.status === 200).toBe(true);
    expect((await call(recipient, "/api/invitations/accept", "POST", { reviewBinding: preview.data.reviewBinding })).status === 404).toBe(true);
    expect((await call(recipient, `/api/students/${studentId}?mode=student`)).status === 200).toBe(true);
    const session = await call(recipient, "/api/session");
    expect(session.status === 200 && session.data.roles.includes("student")).toBe(true);
  }, 120_000);
});
