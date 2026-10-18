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
vi.mock("server-only", () => ({}));

let fixture: Awaited<ReturnType<typeof browserFixture>>, browser: Browser, stop: (() => Promise<void>) | undefined, restore: (() => void) | undefined, failDelivery = false;
const contexts: BrowserContext[] = [];
async function safe<T>(action: () => Promise<T>): Promise<T> { try { return await action(); } catch { throw new Error("Invitation management browser operation failed; private details withheld"); } }
async function navigate(tab: Page, path: string) { await safe(() => tab.goto(path, { waitUntil: "domcontentloaded", timeout: 30_000 })); }
async function api(tab: Page, path: string, body?: unknown) {
  return safe(() => tab.evaluate(async ({ path, body }) => {
    const response = await fetch(path, { method: body === undefined ? "GET" : "POST", body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store", headers: body === undefined ? {} : { "content-type": "application/json" } });
    return { status: response.status, data: await response.json() };
  }, { path, body }));
}
async function page(role: "admin" | "tutor", mobile = false) {
  const context = await browser.newContext({ baseURL: BROWSER_ORIGIN, serviceWorkers: "block", acceptDownloads: false, viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 } }); contexts.push(context);
  await context.route("**/*", async route => { try { if (new URL(route.request().url()).origin === BROWSER_ORIGIN) await route.continue(); else await route.abort(); } catch { await route.abort(); } });
  const tab = await context.newPage(); await navigate(tab, "/"); const email = role === "admin" ? "pg-admin@example.test" : "pg-tutor@example.test";
  expect((await api(tab, "/api/auth/sign-in/magic-link", { email })).status === 200).toBe(true); await openAuthMail(tab, fixture.takeMail(email)); return tab;
}
const main = (tab: Page) => tab.locator("#workspace-main");
const record = (tab: Page, id: string) => tab.locator(`article[aria-labelledby="invite-${id}"]`);
const status = (tab: Page, id: string) => record(tab, id).locator(".invite-status");
const failedMail = "The email failed to send. Nothing is resent automatically; use Send again if you want to try once more.";
async function click(tab: Page, name: string) { await safe(() => tab.getByRole("button", { name, exact: true }).click()); }
async function fill(tab: Page, email: string, role = "parent") {
  await safe(() => tab.getByRole("radio", { name: role[0].toUpperCase() + role.slice(1), exact: true }).check()); await safe(() => tab.getByLabel("Recipient email", { exact: true }).fill(email));
  if (role !== "tutor") await safe(() => tab.getByLabel("Student to link", { exact: true }).selectOption(fixture.student.id));
}
async function capture(tab: Page, name: string) {
  if (process.env.CI) return;
  await ui(main(tab).getByRole("heading", { name: "Checking your access", level: 1, exact: true })).toBeHidden();
  await ui(tab.getByRole("heading", { name: "Invitations", level: 1, exact: true })).toBeVisible();
  await ui(tab.getByText("Checking current invitation records…", { exact: true })).toBeHidden();
  if (name.includes("review")) await ui(tab.getByRole("button", { name: "Send invitation", exact: true })).toBeEnabled();
  if (name.includes("failed")) await ui(tab.getByText(failedMail, { exact: true })).toBeVisible();
  if (name.includes("unknown")) await ui(main(tab).getByRole("alert")).toContainText("couldn’t confirm whether this went through");
  expect(await tab.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const directory = join(process.cwd(), ".impeccable", "review"); await mkdir(directory, { recursive: true });
  await safe(() => tab.screenshot({ path: join(directory, `${name}.png`), fullPage: true }));
}
async function focusChecked(tab: Page) {
  let release!: () => void, held = false, delivered = 0; const gate = new Promise<void>(resolve => { release = resolve; });
  const email = tab.getByLabel("Recipient email", { exact: true }), draft = await email.inputValue();
  await tab.route("**/api/session", async route => { const response = await route.fetch(); held = true; await gate; await route.fulfill({ response }); delivered++; });
  try { await safe(() => tab.evaluate(() => window.dispatchEvent(new Event("focus")))); await ui.poll(() => held).toBe(true); await ui(main(tab).getByRole("heading", { name: "Checking your access", level: 1, exact: true })).toBeHidden(); await ui(email).toHaveValue(draft); }
  finally { release(); }
  await ui.poll(() => delivered).toBeGreaterThanOrEqual(2); await tab.unroute("**/api/session");
}
beforeAll(async () => {
  try { assertBrowserStartupAllowed(); restore = installLoopbackFetchGuard(); fixture = await browserFixture({ failInvitationDelivery: () => failDelivery }); stop = await startBrowserServer(fixture.withRuntime); browser = await chromium.launch({ headless: true }); }
  catch { await browser?.close().catch(() => undefined); await stop?.().catch(() => undefined); await fixture?.close().catch(() => undefined); restore?.(); throw new Error("Invitation management setup failed; private details withheld"); }
}, 120_000);
afterAll(async () => { await Promise.all(contexts.map(context => context.close().catch(() => undefined))); await browser?.close().catch(() => undefined); await stop?.().catch(() => undefined); await fixture?.close().catch(() => undefined); restore?.(); }, 120_000);

it("reviews a parent invitation before sending, then separately reviews reissue and exact revocation with authoritative lifecycle updates", async () => {
  const tab = await page("admin"); await navigate(tab, "/workspace/admin/students"); await safe(() => tab.getByRole("navigation", { name: "Admin", exact: true }).getByRole("link", { name: "Invitations", exact: true }).click());
  await fill(tab, "synthetic-managed-parent@example.test"); await click(tab, "Review invitation");
  expect((await api(tab, "/api/admin/invitations")).data.invitations.length === 0).toBe(true); await capture(tab, "invitation-review-desktop");
  let writes = 0;
  await tab.route(`${BROWSER_ORIGIN}/api/admin/invitations`, async route => { if (route.request().method() === "POST") writes++; const response = await route.fetch(); await route.fulfill({ response }); });
  await safe(() => tab.getByRole("button", { name: "Send invitation", exact: true }).evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); }));
  await ui(tab.getByRole("status", { name: "Latest invitation action", exact: true })).toContainText("The email went to the mail service.");
  await ui(tab.getByRole("dialog")).toBeHidden();
  await ui(tab.getByText("Checking current invitation records…", { exact: true })).toBeHidden(); expect(writes).toBe(1);
  const first = (await api(tab, "/api/admin/invitations")).data.invitations[0];
  expect(first.role === "parent" && first.status === "pending" && first.delivery.status === "sent").toBe(true);
  await ui(status(tab, first.id)).toHaveText("Not accepted yet"); await capture(tab, "invitation-list-desktop");
  await safe(() => record(tab, first.id).getByRole("button", { name: /^Send again to / }).click());
  await ui(tab.getByRole("dialog").getByRole("heading", { name: "Send this invitation again?", exact: true })).toBeFocused();
  await click(tab, "Cancel"); await ui(tab.getByRole("dialog")).toBeHidden(); await ui(record(tab, first.id).getByRole("button", { name: /^Send again to / })).toBeFocused(); expect((await api(tab, "/api/admin/invitations")).data.invitations.length === 1).toBe(true);
  await safe(() => record(tab, first.id).getByRole("button", { name: /^Send again to / }).click()); await click(tab, "Send new invitation");
  await ui(status(tab, first.id)).toHaveText("Revoked");
  const rows = (await api(tab, "/api/admin/invitations")).data.invitations;
  const replacement = rows.find((row: { id: string }) => row.id !== first.id); expect(Boolean(replacement && replacement.status === "pending" && replacement.delivery.status === "sent")).toBe(true);
  await safe(() => record(tab, replacement.id).getByRole("button", { name: /^Revoke invitation to / }).click()); await click(tab, "Revoke invitation"); await ui(status(tab, replacement.id)).toHaveText("Revoked");
  expect(await tab.evaluate(() => !/\/invitations\/open\?token=/.test(document.body.textContent ?? "") && !/token=/.test(location.href))).toBe(true);
});

it("separates failed delivery from pending lifecycle and preserves unknown reissue outcomes without automatic retry", async () => {
  const tab = await page("admin", true); await navigate(tab, "/workspace/admin/invitations"); failDelivery = true;
  const longRecipient = `synthetic${"x".repeat(54)}@example.test`;
  const created = await api(tab, "/api/admin/students", { student: { firstName: `Synthetic${"N".repeat(90)}`, lastName: `Unbroken${"S".repeat(88)}`, ceremonyDate: "2027-01-02", parentEmail: longRecipient } });
  expect(created.status === 201).toBe(true);
  await click(tab, "Reload invitations"); await fill(tab, longRecipient);
  await safe(() => tab.getByLabel("Student to link", { exact: true }).selectOption(created.data.id)); await click(tab, "Review invitation");
  expect(await tab.locator(".invitation-action-review").evaluate(panel => {
    const values = [...panel.querySelectorAll("dd bdi")];
    return values.length === 2 && values.every(value => {
      const cell = value.parentElement!, range = document.createRange(); range.selectNodeContents(value);
      const bounds = cell.getBoundingClientRect(), rects = [...range.getClientRects()];
      return new Set(rects.map(rect => Math.round(rect.top))).size > 1 && cell.scrollWidth <= cell.clientWidth + 1
        && rects.every(rect => rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1);
    });
  })).toBe(true);
  await capture(tab, "invitation-review-mobile"); await click(tab, "Send invitation");
  await ui(tab.getByText(failedMail, { exact: true })).toBeVisible();
  await ui(tab.getByText("Checking current invitation records…", { exact: true })).toBeHidden();
  const failed = (await api(tab, "/api/admin/invitations")).data.invitations.find((row: { recipientEmail: string }) => row.recipientEmail === longRecipient); expect(failed.status === "pending" && failed.delivery.status === "failed").toBe(true);
  await ui(status(tab, failed.id)).toHaveText("Not accepted yet"); await ui(record(tab, failed.id).getByText("Email failed", { exact: true })).toBeVisible(); await capture(tab, "invitation-failed-mobile"); failDelivery = false;
  let reissues = 0;
  await tab.route(`**/api/admin/invitations/${failed.id}/reissue`, async route => { reissues++; const response = await route.fetch(); await response.dispose(); await route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"unavailable"}' }); });
  await safe(() => record(tab, failed.id).getByRole("button", { name: /^Send again to / }).click()); await click(tab, "Send new invitation");
  await ui(main(tab).getByRole("alert")).toContainText("couldn’t confirm whether this went through"); await capture(tab, "invitation-unknown-mobile");
  expect(reissues).toBe(1); await focusChecked(tab); expect(reissues).toBe(1); await ui(tab.getByRole("button", { name: "Review invitation", exact: true })).toBeDisabled();
  await click(tab, "Reload invitations"); await ui(status(tab, failed.id)).toHaveText("Revoked"); expect(reissues).toBe(1);
  await ui(tab.getByRole("status", { name: "Latest invitation action", exact: true })).toContainText("We couldn’t confirm whether the last action went through.");
});

it("retains same-session drafts, invalidates changed student targets, requires fresh admin writes and discards drafts for a different session", async () => {
  const tab = await page("admin"); await navigate(tab, "/workspace/admin/invitations"); await fill(tab, "synthetic-retained-draft@example.test"); await focusChecked(tab);
  await ui(tab.getByLabel("Recipient email", { exact: true })).toHaveValue("synthetic-retained-draft@example.test"); await click(tab, "Review invitation");
  const [student] = await fixture.ownerDb.select().from(s.student).where(eq(s.student.id, fixture.student.id));
  await fixture.ownerDb.update(s.student).set({ revision: student.revision + 1, ceremonyDate: "2027-01-09" }).where(eq(s.student.id, student.id));
  let targetPosts = 0; await tab.route("**/api/admin/invitations", async route => { if (route.request().method() === "POST") targetPosts++; await route.continue(); });
  await focusChecked(tab); await ui(tab.getByRole("button", { name: "Send invitation", exact: true })).toBeEnabled();
  await click(tab, "Send invitation"); await ui(main(tab).getByRole("alert")).toContainText("changed since you reviewed this"); expect(targetPosts).toBe(0); await tab.unroute("**/api/admin/invitations");
  expect(await tab.getByRole("button", { name: "Send invitation", exact: true }).count()).toBe(0);
  await click(tab, "Reload invitations"); await click(tab, "Review invitation");
  await fixture.ownerDb.update(s.session).set({ createdAt: new Date(Date.now() - 60 * 60_000) }).where(eq(s.session.userId, fixture.admin.id));
  await click(tab, "Send invitation"); await ui(main(tab).getByRole("alert")).toContainText("sign in again");
  await ui(tab.getByRole("link", { name: "Check account and sign in again", exact: true })).toBeVisible();
  const tutor = await page("tutor"); await navigate(tutor, "/workspace/admin/invitations"); await ui(tutor.getByRole("heading", { name: "Role unavailable", exact: true })).toBeVisible();
  expect(await tutor.getByLabel("Recipient email", { exact: true }).count()).toBe(0);
  expect((await api(tutor, "/api/admin/invitations", { role: "tutor", email: "synthetic-denied@example.test" })).status === 403).toBe(true);
  const fresh = await page("admin"); await tab.context().addCookies(await fresh.context().cookies()); await focusChecked(tab);
  await ui(tab.getByLabel("Recipient email", { exact: true })).toHaveValue("");
  expect(await tab.evaluate(() => !JSON.stringify({ local: { ...localStorage }, tab: { ...sessionStorage } }).includes("synthetic-retained-draft"))).toBe(true);
});
