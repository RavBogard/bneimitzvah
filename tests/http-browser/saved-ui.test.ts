import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { expect as ui } from "@playwright/test";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { eq, inArray } from "drizzle-orm";
import { browserFixture } from "./fixture";
import { assertBrowserStartupAllowed, BROWSER_ORIGIN, startBrowserServer } from "./server";
import { installLoopbackFetchGuard } from "./egress";
import { openAuthMail } from "./auth-navigation";
import { rateLimit } from "../../src/server/db/auth-schema";
import * as s from "../../src/server/db/index";
import { syntheticUiStudyPage } from "../helpers/study-ui";
import { createSefariaCommentaryReader } from "../../src/server/study/commentary";
import { syntheticCommentaryFetch } from "../helpers/commentary";
vi.mock("server-only", () => ({}));

// Release 1.4 saved readings end to end: the real dispatcher, cookie session, Origin check and
// owner-only database, driven from the signed-out reading and the front door. Synthetic people only.
let fixture: Awaited<ReturnType<typeof browserFixture>>, browser: Browser, stop: (() => Promise<void>) | undefined, restore: (() => void) | undefined;
const contexts: BrowserContext[] = [];
beforeAll(async () => {
  assertBrowserStartupAllowed(); restore = installLoopbackFetchGuard();
  fixture = await browserFixture({ studyLoad: async request => syntheticUiStudyPage(request), commentaryLoad: createSefariaCommentaryReader({ fetch: syntheticCommentaryFetch() as typeof globalThis.fetch }) });
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

it("on their own saved reading a member sees stored translation and note text read-only in Yours, stars a comment, and the drill reveals JPS only; no editor is offered, and no work is written or audited", async () => {
  const { tab, seen } = await visitor(390);
  await signIn(tab, "pg-admin@example.test");
  await tab.goto("/read", { waitUntil: "domcontentloaded" });
  await ui(tab.locator(".study-verses")).toBeVisible();
  // A public reading never shows Yours or stars: it does not ask about the account.
  await ui(tab.locator("[data-yours-ref], [data-star]")).toHaveCount(0);
  await tab.getByRole("button", { name: "Save", exact: true }).click();
  await tab.getByRole("form", { name: "Save this reading" }).getByLabel("Name").fill("Admin study");
  await tab.getByRole("form", { name: "Save this reading" }).getByRole("button", { name: "Save reading", exact: true }).click();
  await tab.getByRole("link", { name: "Open your reading", exact: true }).click();
  await ui(tab.getByRole("heading", { level: 1, name: "Admin study", exact: true })).toBeVisible();
  const id = new URL(tab.url()).searchParams.get("saved")!;
  // Text stored before 1.7 removed the editors: written straight to the owner's rows, as the retired editors once did.
  const [saved] = await fixture.ownerDb.select().from(s.savedReading).where(eq(s.savedReading.id, id));
  await fixture.ownerDb.insert(s.savedVerseWork).values([
    { tenantId: "crc", membershipId: saved.membershipId, savedReadingId: id, verseRef: "Genesis 1:1", stream: "translation", text: "Synthetic own words for the first verse.", version: 1 },
    { tenantId: "crc", membershipId: saved.membershipId, savedReadingId: id, verseRef: "Genesis 1:1", stream: "note", text: "Synthetic private note.", version: 1 },
  ]);
  await tab.reload({ waitUntil: "domcontentloaded" });
  await tab.getByRole("group", { name: "Reading lens", exact: true }).getByRole("button", { name: "Study", exact: true }).click();
  const first = tab.getByRole("region", { name: "Yours on Genesis 1:1", exact: true });
  await ui(first.getByRole("button", { name: "Yours", exact: true })).toHaveAttribute("aria-expanded", "false");
  await first.getByRole("button", { name: "Yours", exact: true }).click();
  await ui(first.getByText("Synthetic own words for the first verse.", { exact: true })).toBeVisible();
  await ui(first.getByText("Synthetic private note.", { exact: true })).toBeVisible();
  await ui(first.getByText("My translation", { exact: true })).toBeVisible(); await ui(first.getByText("My notes", { exact: true })).toBeVisible();
  await ui(first.locator("textarea, form")).toHaveCount(0);
  await ui(first.getByRole("button", { name: "Save", exact: true })).toHaveCount(0);
  // A star on the inline Rashi comment: pressed in place, and listed in Yours.
  const star = tab.locator('[data-commentary-ref="Genesis 1:1"] [data-star="rashi|Genesis 1:1|1"]');
  await ui(star).toHaveAttribute("aria-label", "Star comment");
  await star.click();
  await ui(star).toHaveAttribute("aria-pressed", "true"); await ui(star).toHaveAttribute("aria-label", "Starred");
  await ui(first.getByRole("region", { name: "Starred comments on Genesis 1:1", exact: true }).getByText("SYNTHETIC LEMMA", { exact: false })).toBeVisible();
  expect(await noHorizontalScroll(tab)).toBe(true);
  for (const height of await tab.locator("[data-yours-ref] button, [data-star]").evaluateAll(nodes => nodes.filter(node => (node as HTMLElement).offsetParent).map(node => node.getBoundingClientRect().height)))
    expect(height).toBeGreaterThanOrEqual(44);
  // After a reload all of it is still there, for this member.
  await tab.reload({ waitUntil: "domcontentloaded" });
  await ui(tab.locator("[data-study-rows]")).toBeVisible();
  await ui(tab.locator('[data-commentary-ref="Genesis 1:1"] [data-star="rashi|Genesis 1:1|1"]').first()).toHaveAttribute("aria-pressed", "true");
  await tab.getByRole("region", { name: "Yours on Genesis 1:1", exact: true }).getByRole("button", { name: "Yours", exact: true }).click();
  await ui(tab.getByRole("region", { name: "Yours on Genesis 1:1", exact: true }).getByText("Synthetic own words for the first verse.", { exact: true })).toBeVisible();
  // Lein: the drill reveals JPS only, with no own translation and no way into Yours.
  await tab.getByRole("group", { name: "Reading lens", exact: true }).getByRole("button", { name: "Lein", exact: true }).click();
  await tab.locator('.study-verses [data-verse-ref="Genesis 1:1"] [data-word-index="0"]').first().click();
  await tab.getByRole("button", { name: "Translate drill", exact: true }).click();
  const drill = tab.getByRole("region", { name: "Translate drill on Genesis 1:1", exact: true });
  await drill.getByRole("button", { name: "Reveal", exact: true }).click();
  await ui(drill.getByRole("heading", { name: "JPS", exact: true })).toBeVisible();
  await ui(drill.getByText(/My translation|Synthetic own words|Write one|Yours/)).toHaveCount(0);
  // Unstarring deletes the star.
  await tab.locator('[data-commentary-ref="Genesis 1:1"] [data-star="rashi|Genesis 1:1|1"]').first().click();
  await ui(tab.locator('[data-commentary-ref="Genesis 1:1"] [data-star="rashi|Genesis 1:1|1"]').first()).toHaveAttribute("aria-pressed", "false");
  // Nothing was written or audited by the page: the two stored rows are untouched, and only the star was posted.
  const work = await fixture.ownerDb.select().from(s.savedVerseWork).where(eq(s.savedVerseWork.savedReadingId, id));
  expect(work.map(row => [row.verseRef, row.stream, row.text, row.version]).sort()).toEqual([["Genesis 1:1", "note", "Synthetic private note.", 1], ["Genesis 1:1", "translation", "Synthetic own words for the first verse.", 1]]);
  expect(work.every(row => row.membershipId === saved.membershipId)).toBe(true);
  expect((await fixture.ownerDb.select().from(s.starredComment).where(eq(s.starredComment.membershipId, saved.membershipId))).length).toBe(0);
  expect((await fixture.ownerDb.select().from(s.auditEvent).where(inArray(s.auditEvent.targetType, ["saved_reading", "saved_verse_work", "starred_comment"]))).length).toBe(0);
  expect(seen.filter(row => row.startsWith("POST")).sort()).toEqual(["POST /api/saved/readings/create", "POST /api/saved/star", "POST /api/saved/star"]);
}, 240_000);
