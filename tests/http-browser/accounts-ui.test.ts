import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { expect as ui } from "@playwright/test";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { openMore } from "./more-sheet";
import { browserFixture } from "./fixture";
import { assertBrowserStartupAllowed, BROWSER_ORIGIN, startBrowserServer } from "./server";
import { installLoopbackFetchGuard } from "./egress";
import { openAuthMail } from "./auth-navigation";
import { rateLimit } from "../../src/server/db/auth-schema";
import * as s from "../../src/server/db/index";
import { syntheticUiStudyPage } from "../helpers/study-ui";
vi.mock("server-only", () => ({}));

// Release 1.4 accounts on the real isolated server: a person asks, an admin approves on /workspace/accounts, and the
// new member saves a reading. The server's mail sender only answers "skipped"; nothing is sent. Synthetic people only.
let fixture: Awaited<ReturnType<typeof browserFixture>>, browser: Browser, stop: (() => Promise<void>) | undefined, restore: (() => void) | undefined;
const contexts: BrowserContext[] = [];
beforeAll(async () => {
  assertBrowserStartupAllowed(); restore = installLoopbackFetchGuard();
  fixture = await browserFixture({ studyLoad: async request => syntheticUiStudyPage(request) });
  stop = await startBrowserServer(fixture.withRuntime, fixture.withPublicRuntime);
  browser = await chromium.launch({ headless: true });
}, 120_000);
beforeEach(async () => { await fixture.ownerDb.delete(rateLimit); });
afterAll(async () => {
  for (const context of contexts.splice(0)) await context.close().catch(() => undefined);
  await browser?.close().catch(() => undefined); await stop?.().catch(() => undefined); await fixture?.close().catch(() => undefined); restore?.();
}, 120_000);

async function tab(width: number) {
  const context = await browser.newContext({ baseURL: BROWSER_ORIGIN, viewport: { width, height: 900 }, serviceWorkers: "block", acceptDownloads: false }); contexts.push(context);
  await context.route("**/*", route => new URL(route.request().url()).origin === BROWSER_ORIGIN ? route.continue() : route.abort());
  return context.newPage();
}
async function signIn(page: Page, email: string) {
  await page.goto("/sign-in", { waitUntil: "domcontentloaded" });
  await ui(page.getByRole("heading", { name: "Sign in", exact: true })).toBeVisible();
  await page.getByLabel("Email address", { exact: true }).fill(email);
  await page.getByRole("button", { name: "Email me a sign-in link", exact: true }).click();
  await ui(page.getByRole("heading", { name: "Check your email", exact: true })).toBeVisible();
  await openAuthMail(page, fixture.takeMail(email));
  // A plain sign-in now lands on My Readings (Area A); these flows start from the front door.
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await ui(page.locator('[data-door="beit-mitzvah"]:not([data-door-state="loading"])')).toBeVisible();
}
const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
async function controlsAtLeast44(page: Page, scope: string) {
  for (const height of await page.locator(`${scope} button, ${scope} select, ${scope} a.roster-action`).evaluateAll(nodes => nodes.filter(node => (node as HTMLElement).offsetParent).map(node => node.getBoundingClientRect().height)))
    expect(height).toBeGreaterThanOrEqual(44);
}

it("a person asks, an admin sees the count and approves, and the new member saves a reading; a declined request sends nothing", async () => {
  const asker = await tab(360);
  await signIn(asker, "ui-asker@example.test");
  await ui(asker.getByRole("heading", { name: "Ask to be linked", exact: true })).toBeVisible();
  await asker.getByLabel("Your name").fill("Synthetic Asker");
  await asker.getByLabel("Who you are (the student’s name and ceremony date, or whose parent you are)").fill("Shabbat readings");
  await asker.getByRole("button", { name: "Send request", exact: true }).click();
  await ui(asker.getByText("You’ll get one email when it’s been linked.", { exact: true })).toBeVisible();
  expect(await noHorizontalScroll(asker)).toBe(true);
  // The request's email was not sent from this test server, and is recorded as skipped.
  await ui.poll(async () => (await fixture.ownerDb.select().from(s.accountRequest))[0]?.notifyStatus).toBe("skipped");

  for (const width of [360, 1280]) {
    const admin = await tab(width);
    await signIn(admin, "pg-admin@example.test");
    await admin.goto("/workspace/admin/students?tab=students", { waitUntil: "domcontentloaded" });
    const line = admin.getByRole("link", { name: "1 link request waiting · Review", exact: true });
    await ui(line).toBeVisible();
    await line.click();
    await ui(admin.getByRole("heading", { level: 1, name: "Members", exact: true })).toBeVisible();
    const queue = admin.getByRole("region", { name: "Link requests" });
    await ui(queue.getByRole("heading", { name: "Synthetic Asker", exact: true })).toBeVisible();
    await ui(queue.getByText("ui-asker@example.test")).toBeVisible();
    await ui(queue.getByText("Shabbat readings", { exact: true })).toBeVisible();
    // Daniel's approved help line (F1): accounts are for anyone in good faith, and no line says members only.
    await ui(queue.getByText("Anyone who asks in good faith can have an account, member or not. Decline only spam or abuse.", { exact: true })).toBeVisible();
    expect(await admin.locator(".accounts-workspace").innerText()).not.toMatch(/members only|only members/i);
    await ui(admin.getByRole("region", { name: "Approvers" }).getByText("Admins approve requests.", { exact: false })).toBeVisible();
    expect(await noHorizontalScroll(admin)).toBe(true);
    await controlsAtLeast44(admin, ".accounts-workspace");
    if (width === 1280) {
      // Plan D6: the approver may link the account to a student record, or approve without linking; this one is a staff account.
      await ui(queue.getByRole("combobox", { name: "Student for: Synthetic Asker", exact: true })).toBeVisible();
      await ui(queue.getByRole("button", { name: "Approve and link: Synthetic Asker", exact: true })).toBeDisabled();
      await queue.getByRole("button", { name: "Approve without linking: Synthetic Asker", exact: true }).click();
      await ui(admin.getByRole("status").filter({ hasText: "Synthetic Asker now has an account." })).toBeVisible();
      await ui(admin.getByRole("region", { name: "Members" }).getByRole("heading", { name: "Synthetic Asker", exact: true })).toBeVisible();
      await ui(queue.getByText("No link requests are waiting.", { exact: true })).toBeVisible();
    }
  }
  // The new member: nothing left to ask for, and saving a reading works (it did before the approval too: the shelf is everyone's).
  await asker.goto("/", { waitUntil: "domcontentloaded" });
  await ui(asker.locator('[data-door="beit-mitzvah"]:not([data-door-state="loading"])')).toBeVisible();
  await ui(asker.getByRole("heading", { name: "Ask to be linked", exact: true })).toHaveCount(0);
  await ui(asker.getByRole("heading", { name: "Your account can save readings", exact: true })).toHaveCount(0);
  await asker.goto("/read", { waitUntil: "domcontentloaded" });
  await asker.getByRole("button", { name: "Save to My Readings", exact: true }).click();
  await asker.getByRole("form", { name: "Add this reading" }).getByRole("button", { name: "Add", exact: true }).click();
  await ui(asker.getByRole("status").filter({ hasText: "Saved to My Readings." })).toBeVisible();
  const [member] = await fixture.ownerDb.select().from(s.tenantMember);
  expect(member).toMatchObject({ displayName: "Synthetic Asker", welcomeStatus: "skipped" });

  // Decline: the request goes, nothing is sent, and the person may ask again.
  const second = await tab(390);
  await signIn(second, "ui-declined@example.test");
  await second.getByLabel("Your name").fill("Synthetic Declined");
  await second.getByRole("button", { name: "Send request", exact: true }).click();
  await ui(second.getByText("You’ll get one email when it’s been linked.", { exact: true })).toBeVisible();
  const admin = await tab(1280);
  await signIn(admin, "pg-admin@example.test");
  await admin.goto("/workspace/accounts", { waitUntil: "domcontentloaded" });
  await admin.getByRole("button", { name: "Decline: Synthetic Declined", exact: true }).click();
  await ui(admin.getByText("Decline removes this request and sends nothing.", { exact: true })).toBeVisible();
  await admin.getByRole("button", { name: "Decline request: Synthetic Declined", exact: true }).click();
  await ui(admin.getByRole("status").filter({ hasText: "Request declined. Nothing was sent." })).toBeVisible();
  await second.reload({ waitUntil: "domcontentloaded" });
  await ui(second.getByRole("heading", { name: "Ask to be linked", exact: true })).toBeVisible();
  expect((await fixture.ownerDb.select().from(s.accountRequest)).length).toBe(0);
}, 300_000);

it("an admin designates a tutor, who then sees and approves requests from the tutor home; removing them ends it", async () => {
  const admin = await tab(1280);
  await signIn(admin, "pg-admin@example.test");
  await admin.goto("/workspace/accounts", { waitUntil: "domcontentloaded" });
  const approvers = admin.getByRole("region", { name: "Approvers" });
  await ui(approvers.getByText("No tutor approves requests yet.", { exact: true })).toBeVisible();
  await approvers.getByRole("button", { name: "Add", exact: true }).click();
  await ui(admin.getByRole("status").filter({ hasText: "Approver added." })).toBeVisible();
  await ui(approvers.getByRole("button", { name: /^Remove approver: / })).toBeVisible();

  const asker = await tab(390);
  await signIn(asker, "ui-tutor-asker@example.test");
  await asker.getByLabel("Your name").fill("Asks a Tutor");
  await asker.getByRole("button", { name: "Send request", exact: true }).click();
  await ui(asker.getByText("You’ll get one email when it’s been linked.", { exact: true })).toBeVisible();

  const tutor = await tab(360);
  await signIn(tutor, "pg-tutor@example.test");
  await tutor.goto("/workspace/tutor", { waitUntil: "domcontentloaded" });
  await tutor.getByRole("link", { name: "1 link request waiting · Review", exact: true }).click();
  await ui(tutor.getByRole("heading", { level: 1, name: "Link requests", exact: true })).toBeVisible();
  await ui(tutor.getByRole("region", { name: "Members" })).toHaveCount(0);
  await ui(tutor.getByRole("region", { name: "Approvers" })).toHaveCount(0);
  // The tutor may link only their own student (the select lists that one) or approve without linking; this is a staff account.
  await ui(tutor.getByRole("combobox", { name: "Student for: Asks a Tutor", exact: true })).toBeVisible();
  await tutor.getByRole("button", { name: "Approve without linking: Asks a Tutor", exact: true }).click();
  await ui(tutor.getByRole("status").filter({ hasText: "Asks a Tutor now has an account." })).toBeVisible();
  expect(await noHorizontalScroll(tutor)).toBe(true);

  await admin.reload({ waitUntil: "domcontentloaded" });
  await approvers.getByRole("button", { name: /^Remove approver: / }).click();
  await ui(admin.getByRole("status").filter({ hasText: "no longer approves account requests." })).toBeVisible();
  await tutor.reload({ waitUntil: "domcontentloaded" });
  await ui(tutor.getByRole("heading", { level: 1, name: "Role unavailable", exact: true })).toBeVisible();
}, 300_000);
