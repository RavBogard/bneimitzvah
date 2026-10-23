import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { expect as ui } from "@playwright/test";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { eq } from "drizzle-orm";
import { browserFixture } from "./fixture";
import { assertBrowserStartupAllowed, BROWSER_ORIGIN, startBrowserServer } from "./server";
import { installLoopbackFetchGuard } from "./egress";
import { openAuthMail } from "./auth-navigation";
import { rateLimit } from "../../src/server/db/auth-schema";
import * as s from "../../src/server/db/index";
import { syntheticUiStudyPage } from "../helpers/study-ui";
vi.mock("server-only", () => ({}));

// Release 1.4 saved readings end to end: the real dispatcher, cookie session, Origin check and
// owner-only database, driven from the signed-out reading and the front door. Synthetic people only.
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

async function visitor(width: number) {
  const context = await browser.newContext({ baseURL: BROWSER_ORIGIN, viewport: { width, height: 900 }, serviceWorkers: "block", acceptDownloads: false }); contexts.push(context);
  const seen: string[] = [];
  await context.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.origin !== BROWSER_ORIGIN) return route.abort();
    if (url.pathname.startsWith("/api/saved/")) seen.push(`${route.request().method()} ${url.pathname}`);
    return route.continue();
  });
  return { tab: await context.newPage(), seen };
}
async function signIn(tab: Page, email: string) {
  await tab.goto("/", { waitUntil: "domcontentloaded" });
  await ui(tab.getByRole("heading", { name: "Sign in", exact: true })).toBeVisible();
  await tab.getByLabel("Email address", { exact: true }).fill(email);
  await tab.getByRole("button", { name: "Email me a sign-in link", exact: true }).click();
  await ui(tab.getByRole("heading", { name: "Check your email", exact: true })).toBeVisible();
  await openAuthMail(tab, fixture.takeMail(email));
  await ui(tab.getByRole("heading", { name: "You’re signed in", exact: true })).toBeVisible();
}
const noHorizontalScroll = (tab: Page) => tab.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

it("a tutor-and-parent saves this week's Torah from /read and finds it under My readings; the reading itself never asks first", async () => {
  for (const width of [360, 1280]) {
    const { tab, seen } = await visitor(width);
    await tab.goto("/read", { waitUntil: "domcontentloaded" });
    await ui(tab.getByRole("heading", { level: 1, name: "Synthetic portion", exact: true })).toBeVisible();
    await tab.getByRole("button", { name: "Save", exact: true }).click();
    await ui(tab.getByRole("link", { name: "Sign in to save readings", exact: true })).toBeVisible();
    await signIn(tab, "pg-tutor@example.test");
    const mine = tab.getByRole("region", { name: "My readings" });
    if (width === 360) await ui(mine.getByText("Save a reading from This week to see it here.", { exact: true })).toBeVisible();
    seen.length = 0;
    await tab.goto("/read", { waitUntil: "domcontentloaded" });
    await ui(tab.getByRole("heading", { level: 1, name: "Synthetic portion", exact: true })).toBeVisible();
    await ui(tab.locator(".study-verses")).toBeVisible();
    expect(seen).toEqual([]);
    await tab.getByRole("button", { name: "Save", exact: true }).click();
    const form = tab.getByRole("form", { name: "Save this reading" });
    await ui(form.getByLabel("Name")).toHaveValue("Synthetic portion · Torah");
    await form.getByLabel("Name").fill(`Creation at ${width}`);
    await form.getByRole("button", { name: "Save reading", exact: true }).click();
    await ui(tab.getByRole("status").filter({ hasText: "Saved to My readings." })).toBeVisible();
    expect(seen).toEqual(["GET /api/saved/readings", "POST /api/saved/readings/create"]);
    expect(await noHorizontalScroll(tab)).toBe(true);
    await tab.getByRole("link", { name: "My readings", exact: true }).click();
    await ui(mine.getByRole("link", { name: new RegExp(`Creation at ${width}`) })).toBeVisible();
    await ui(mine.getByText("Torah Genesis 1:1–6:8").first()).toBeVisible();
    expect(await noHorizontalScroll(tab)).toBe(true);
  }
  // Stored for that member only, in canonical form, with no audit row.
  const rows = await fixture.ownerDb.select().from(s.savedReading);
  expect(rows.map(row => [row.name, row.kind, row.ranges, row.verseCount]).sort()).toEqual([["Creation at 1280", "torah", "Genesis 1:1-6:8", 146], ["Creation at 360", "torah", "Genesis 1:1-6:8", 146]]);
  expect(new Set(rows.map(row => row.membershipId)).size).toBe(1);
  expect((await fixture.ownerDb.select().from(s.auditEvent).where(eq(s.auditEvent.targetType, "saved_reading"))).length).toBe(0);
}, 240_000);

it("an account without saved readings is pointed to /account, and its front door has no My readings", async () => {
  const { tab, seen } = await visitor(390);
  await signIn(tab, "saved-ui-recipient@example.test");
  await ui(tab.getByRole("heading", { level: 2, name: "Beit Mitzvah", exact: true })).toBeVisible();
  await ui(tab.locator("[data-my-readings]")).toHaveCount(0);
  expect(seen).toEqual([]);
  await tab.goto("/read", { waitUntil: "domcontentloaded" });
  await ui(tab.getByRole("heading", { level: 1, name: "Synthetic portion", exact: true })).toBeVisible();
  await tab.getByRole("button", { name: "Save", exact: true }).click();
  await ui(tab.getByRole("link", { name: "Ask for an account to save readings", exact: true })).toHaveAttribute("href", "/account");
  await ui(tab.getByRole("form", { name: "Save this reading" })).toHaveCount(0);
}, 120_000);

it("the member opens the saved reading from My readings, marks a verse that stays marked after a reload, renames it and removes it", async () => {
  const { tab, seen } = await visitor(390);
  await signIn(tab, "pg-admin@example.test");
  await tab.goto("/read", { waitUntil: "domcontentloaded" });
  await ui(tab.locator(".study-verses")).toBeVisible();
  await tab.getByRole("button", { name: "Save", exact: true }).click();
  const form = tab.getByRole("form", { name: "Save this reading" });
  await form.getByLabel("Name").fill("Admin creation");
  await form.getByRole("button", { name: "Save reading", exact: true }).click();
  await tab.getByRole("link", { name: "Open your reading", exact: true }).click();
  await ui(tab.getByRole("heading", { level: 1, name: "Admin creation", exact: true })).toBeVisible();
  const id = new URL(tab.url()).searchParams.get("saved")!;
  expect(id).toMatch(/^[0-9a-f-]{36}$/);
  // Lein: choose the second verse, mark it, and find the mark again after a reload.
  const word = tab.locator('.study-verses [data-verse-ref="Genesis 1:2"] [data-word-index="0"]').first();
  await word.click();
  const marks = tab.getByRole("group", { name: "How Genesis 1:2 is going" });
  await ui(marks.getByRole("button", { name: "Still working", exact: true })).toHaveAttribute("aria-pressed", "false");
  await marks.getByRole("button", { name: "Still working", exact: true }).click();
  await ui(marks.getByRole("button", { name: "Still working", exact: true })).toHaveAttribute("aria-pressed", "true");
  await tab.reload({ waitUntil: "domcontentloaded" });
  await ui(tab.locator(".study-verses")).toBeVisible();
  await tab.locator('.study-verses [data-verse-ref="Genesis 1:2"] [data-word-index="0"]').first().click();
  await ui(tab.getByRole("group", { name: "How Genesis 1:2 is going" }).getByRole("button", { name: "Still working", exact: true })).toHaveAttribute("aria-pressed", "true");
  // Rename, then remove: the marks go with it.
  await tab.getByRole("button", { name: "Edit", exact: true }).click();
  await tab.getByRole("form", { name: "Edit this reading" }).getByLabel("Name").fill("Admin creation, renamed");
  await tab.getByRole("button", { name: "Save changes", exact: true }).click();
  await ui(tab.getByRole("heading", { level: 1, name: "Admin creation, renamed", exact: true })).toBeVisible();
  expect(await noHorizontalScroll(tab)).toBe(true);
  await tab.getByRole("button", { name: "Edit", exact: true }).click();
  await tab.getByRole("button", { name: "Remove reading", exact: true }).click();
  await tab.getByRole("button", { name: "Remove", exact: true }).click();
  await ui(tab.getByRole("region", { name: "My readings" })).toBeVisible();
  await ui(tab.getByRole("region", { name: "My readings" }).getByText("Admin creation, renamed")).toHaveCount(0);
  expect((await fixture.ownerDb.select().from(s.savedReading).where(eq(s.savedReading.id, id))).length).toBe(0);
  expect((await fixture.ownerDb.select().from(s.savedVerseMark).where(eq(s.savedVerseMark.savedReadingId, id))).length).toBe(0);
  // The member's saved-layer writes were exactly these four, and none of them reached the audit log.
  expect(seen.filter(row => row.startsWith("POST")).sort()).toEqual(["POST /api/saved/mark", "POST /api/saved/readings/create", "POST /api/saved/readings/remove", "POST /api/saved/readings/update"]);
  expect((await fixture.ownerDb.select().from(s.auditEvent).where(eq(s.auditEvent.targetType, "saved_reading"))).length).toBe(0);
}, 240_000);

it("another member's saved reading id opens nothing", async () => {
  // Its own row: a reading the tutor-and-parent keeps, which the admin then tries to open by id.
  const [tutor] = await fixture.ownerDb.select().from(s.membership).where(eq(s.membership.userId, fixture.tutor.id));
  const [other] = await fixture.ownerDb.insert(s.savedReading).values({ tenantId: "crc", membershipId: tutor.id, userId: fixture.tutor.id, name: "Tutor private reading",
    kind: "torah", ranges: "Genesis 1:1-3", verseCount: 3 }).returning();
  const { tab } = await visitor(390);
  await signIn(tab, "pg-admin@example.test");
  await tab.goto(`/read?saved=${other.id}`, { waitUntil: "domcontentloaded" });
  await ui(tab.getByRole("heading", { level: 2, name: "This reading isn’t in your saved readings", exact: true })).toBeVisible();
  await ui(tab.locator(".study-verses")).toHaveCount(0);
  expect(await tab.content()).not.toContain(other.name);
}, 120_000);
