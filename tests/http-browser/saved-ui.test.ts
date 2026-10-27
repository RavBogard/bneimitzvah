import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { expect as ui } from "@playwright/test";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { eq, inArray } from "drizzle-orm";
import { openMore } from "./more-sheet";
import { browserFixture } from "./fixture";
import { assertBrowserStartupAllowed, BROWSER_ORIGIN, startBrowserServer } from "./server";
import { installLoopbackFetchGuard } from "./egress";
import { entryTask, openAuthMail } from "./auth-navigation";
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
  // Saved readings are asked for only when the member asks; the account's preferences (release 1.7 M3b) are counted apart.
  const seen: string[] = [], prefs: string[] = [];
  await context.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.origin !== BROWSER_ORIGIN) return route.abort();
    if (url.pathname.startsWith("/api/saved/preferences")) prefs.push(`${route.request().method()} ${url.pathname}`);
    else if (url.pathname.startsWith("/api/saved/")) seen.push(`${route.request().method()} ${url.pathname}`);
    return route.continue();
  });
  return { tab: await context.newPage(), seen, prefs };
}
async function signIn(tab: Page, email: string) {
  await tab.goto("/sign-in", { waitUntil: "domcontentloaded" });
  await ui(entryTask(tab, "sign-in", "address")).toBeVisible();
  await tab.getByLabel("Email address", { exact: true }).fill(email);
  await tab.getByTestId("entry-email-submit").click();
  await ui(entryTask(tab, "sign-in", "code")).toBeVisible();
  await openAuthMail(tab, fixture.takeMail(email));
  await tab.goto("/", { waitUntil: "domcontentloaded" }); // a plain sign-in lands on My Readings now; these flows start at the front door
  await ui(tab.locator('[data-door="beit-mitzvah"]:not([data-door-state="loading"])')).toBeVisible();
}
const noHorizontalScroll = (tab: Page) => tab.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

it("a tutor-and-parent saves this week's Torah from /read and finds it under My readings; the reading itself never asks first", async () => {
  for (const width of [360, 1280]) {
    const { tab, seen, prefs } = await visitor(width);
    await tab.goto("/read", { waitUntil: "domcontentloaded" });
    await ui(tab.getByRole("heading", { level: 1, name: "Synthetic portion", exact: true })).toBeVisible();
    // Never signed in here: Save is Sign in to save from the start (F4, N20), and nothing was asked.
    await ui(tab.getByRole("link", { name: "Sign in to save", exact: true })).toBeVisible();
    await ui(tab.getByRole("button", { name: "Save to My Readings", exact: true })).toHaveCount(0);
    // Signed out in a browser that never signed in here, /read never asks about the account.
    expect(prefs).toEqual([]);
    await signIn(tab, "pg-tutor@example.test");
    // The front door, signed in with an account that keeps saved readings, asks for its preferences.
    await expect.poll(() => prefs.includes("GET /api/saved/preferences")).toBe(true);
    // Its answer marks this browser as signed in here (an opaque owner name, never an id or address).
    await expect.poll(() => tab.evaluate(() => { try { return JSON.parse(localStorage.getItem("crc-torah:preferences-sync/v1") ?? "null")?.active === true; } catch { return false; } }), { timeout: 15_000 }).toBe(true);
    prefs.length = 0;
    const mine = tab.locator("[data-my-readings]");
    seen.length = 0;
    await tab.goto("/read", { waitUntil: "domcontentloaded" });
    await ui(tab.getByRole("heading", { level: 1, name: "Synthetic portion", exact: true })).toBeVisible();
    await ui(tab.locator('[data-testid="study-verses"]')).toBeVisible();
    expect(seen).toEqual([]);
    // Having signed in here, /read asks for the account's preferences, and only that.
    await expect.poll(() => prefs).toEqual(["GET /api/saved/preferences"]);
    await tab.getByRole("button", { name: "Save to My Readings", exact: true }).click();
    const form = tab.getByRole("form", { name: "Add this reading" });
    await ui(form.getByLabel("Name")).toHaveValue("Synthetic portion · Torah");
    await form.getByLabel("Name").fill(`Creation at ${width}`);
    await form.getByRole("button", { name: "Add", exact: true }).click();
    await ui(tab.getByRole("status").filter({ hasText: "Saved to My Readings." })).toBeVisible();
    expect(seen).toEqual(["GET /api/saved/readings", "POST /api/saved/readings/create"]);
    expect(await noHorizontalScroll(tab)).toBe(true);
    await tab.getByRole("status").filter({ hasText: "Saved to My Readings." }).getByRole("link", { name: "My Readings", exact: true }).click();
    await ui(mine.getByRole("link", { name: new RegExp(`Creation at ${width}`) })).toBeVisible();
    await ui(mine.getByRole("link", { name: new RegExp(`Creation at ${width}`) })).toContainText("Genesis 1:1–6:8");
    expect(await noHorizontalScroll(tab)).toBe(true);
  }
  // Stored for that member only, in canonical form, with no audit row.
  const rows = await fixture.ownerDb.select().from(s.savedReading);
  expect(rows.map(row => [row.name, row.kind, row.ranges, row.verseCount]).sort()).toEqual([["Creation at 1280", "torah", "Genesis 1:1-6:8", 146], ["Creation at 360", "torah", "Genesis 1:1-6:8", 146]]);
  expect(new Set(rows.map(row => row.membershipId)).size).toBe(1);
  expect((await fixture.ownerDb.select().from(s.auditEvent).where(eq(s.auditEvent.targetType, "saved_reading"))).length).toBe(0);
}, 240_000);

it("Save, then sign in with the emailed code, comes back to the same reading with the same selection, offers Save, and saves those verses (N20)", async () => {
  const { tab, seen } = await visitor(390);
  await tab.goto("/read?lens=study", { waitUntil: "domcontentloaded" });
  await ui(tab.getByRole("heading", { level: 1, name: "Synthetic portion", exact: true })).toBeVisible();
  await (await openMore(tab)).getByRole("button", { name: "Choose verses", exact: true }).click();
  await tab.getByRole("button", { name: "Select Genesis 1:2", exact: true }).click();
  await tab.getByRole("button", { name: "Select Genesis 1:4", exact: true }).click({ modifiers: ["Shift"] });
  const bar = tab.locator("[data-choose-bar]"), line = bar.locator("[data-choose-line]");
  await ui(bar).toHaveAttribute("data-choose-count", "3"); await ui(line).toContainText("Genesis 1:2–4");
  await bar.getByRole("link", { name: "Sign in to save", exact: true }).click();
  await ui(entryTask(tab, "sign-in", "address")).toBeVisible();
  expect(new URL(tab.url()).pathname).toBe("/sign-in");
  // The real round trip: the return address is sealed with the address on this device, and the code's answer is that page.
  await tab.getByLabel("Email address", { exact: true }).fill("pg-tutor@example.test");
  await tab.getByTestId("entry-email-submit").click();
  await ui(entryTask(tab, "sign-in", "code")).toBeVisible();
  await tab.getByLabel("Sign-in code", { exact: true }).fill(fixture.takeCode("pg-tutor@example.test"));
  await tab.getByTestId("entry-code-submit").click();
  await ui(tab.getByRole("heading", { level: 1, name: "Synthetic portion", exact: true })).toBeVisible();
  await ui(bar).toHaveAttribute("data-choose-count", "3"); await ui(line).toContainText("Genesis 1:2–4");
  const form = tab.getByRole("form", { name: "Add this reading" });
  await ui(form.getByLabel("Name")).toHaveValue("Synthetic portion · Genesis 1:2–4");
  const url = new URL(tab.url());
  expect(url.pathname).toBe("/read"); expect(url.searchParams.get("lens")).toBe("study"); expect(url.searchParams.has("save") || url.searchParams.has("choose")).toBe(false);
  await form.getByRole("button", { name: "Add", exact: true }).click();
  await ui(tab.getByRole("status").filter({ hasText: "Saved to My Readings." })).toBeVisible();
  expect(seen).toContain("POST /api/saved/readings/create");
  const rows = await fixture.ownerDb.select().from(s.savedReading).where(eq(s.savedReading.name, "Synthetic portion · Genesis 1:2–4"));
  expect(rows.map(row => [row.kind, row.ranges, row.verseCount])).toEqual([["torah", "Genesis 1:2-4", 3]]);
  await fixture.ownerDb.delete(s.savedReading).where(inArray(s.savedReading.id, rows.map(row => row.id)));
}, 120_000);

it("an account without saved readings is pointed to /account, and its front door has no My readings", async () => {
  const { tab, seen, prefs } = await visitor(390);
  await signIn(tab, "saved-ui-recipient@example.test");
  await ui(tab.locator('[data-door="beit-mitzvah"]')).toBeVisible();
  await ui(tab.locator("[data-my-readings]")).toHaveCount(0);
  expect(seen).toEqual([]);
  // An account that keeps no saved readings keeps no preferences either: neither the front door nor /read asks.
  expect(prefs).toEqual([]);
  await tab.goto("/read", { waitUntil: "domcontentloaded" });
  await ui(tab.getByRole("heading", { level: 1, name: "Synthetic portion", exact: true })).toBeVisible();
  await tab.getByRole("button", { name: "Save to My Readings", exact: true }).click();
  await ui(tab.getByRole("link", { name: "Ask for an account to save readings", exact: true })).toHaveAttribute("href", "/account");
  await ui(tab.getByRole("form", { name: "Add this reading" })).toHaveCount(0);
  expect(prefs).toEqual([]);
}, 120_000);

it("the member opens the saved reading from My readings, marks a verse that stays marked after a reload, renames it and removes it", async () => {
  const { tab, seen } = await visitor(390);
  await signIn(tab, "pg-admin@example.test");
  await tab.goto("/read", { waitUntil: "domcontentloaded" });
  await ui(tab.locator('[data-testid="study-verses"]')).toBeVisible();
  await tab.getByRole("button", { name: "Save to My Readings", exact: true }).click();
  const form = tab.getByRole("form", { name: "Add this reading" });
  await form.getByLabel("Name").fill("Admin creation");
  await form.getByRole("button", { name: "Add", exact: true }).click();
  await tab.getByRole("link", { name: "Open", exact: true }).click();
  await ui(tab.getByRole("heading", { level: 1, name: "Admin creation", exact: true })).toBeVisible();
  const id = new URL(tab.url()).searchParams.get("saved")!;
  expect(id).toMatch(/^[0-9a-f-]{36}$/);
  // Lein: choose the second verse, mark it, and find the mark again after a reload.
  const word = tab.locator('[data-testid="study-verses"] [data-verse-ref="Genesis 1:2"] [data-word-index="0"]').first();
  await word.click();
  const marks = tab.getByRole("group", { name: "How Genesis 1:2 is going" });
  await ui(marks.getByRole("button", { name: "Still working", exact: true })).toHaveAttribute("aria-pressed", "false");
  await marks.getByRole("button", { name: "Still working", exact: true }).click();
  await ui(marks.getByRole("button", { name: "Still working", exact: true })).toHaveAttribute("aria-pressed", "true");
  await tab.reload({ waitUntil: "domcontentloaded" });
  await ui(tab.locator('[data-testid="study-verses"]')).toBeVisible();
  await tab.locator('[data-testid="study-verses"] [data-verse-ref="Genesis 1:2"] [data-word-index="0"]').first().click();
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
  await ui(tab.locator("[data-my-readings]")).toBeVisible();
  await ui(tab.locator("[data-my-readings]").getByText("Admin creation, renamed")).toHaveCount(0);
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
  await ui(tab.getByTestId("saved-reading-state")).toHaveAttribute("data-saved-state", "missing");
  await ui(tab.locator('[data-testid="study-verses"]')).toHaveCount(0);
  expect(await tab.content()).not.toContain(other.name);
}, 120_000);

it("on their own saved reading a member sees stored translation and note text read-only in Yours, stars a comment, and the drill reveals JPS only; no editor is offered, and no work is written or audited", async () => {
  const { tab, seen } = await visitor(390);
  await signIn(tab, "pg-admin@example.test");
  await tab.goto("/read", { waitUntil: "domcontentloaded" });
  await ui(tab.locator('[data-testid="study-verses"]')).toBeVisible();
  // A public reading never shows Yours or stars: it does not ask about the account.
  await ui(tab.locator("[data-yours-ref], [data-star]")).toHaveCount(0);
  await tab.getByRole("button", { name: "Save to My Readings", exact: true }).click();
  await tab.getByRole("form", { name: "Add this reading" }).getByLabel("Name").fill("Admin study");
  await tab.getByRole("form", { name: "Add this reading" }).getByRole("button", { name: "Add", exact: true }).click();
  await tab.getByRole("link", { name: "Open", exact: true }).click();
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
  const first = tab.locator('[data-yours-ref="Genesis 1:1"]');
  await ui(first.getByTestId("yours-toggle")).toHaveAttribute("aria-expanded", "false");
  await first.getByTestId("yours-toggle").click();
  await ui(first.getByText("Synthetic own words for the first verse.", { exact: true })).toBeVisible();
  await ui(first.getByText("Synthetic private note.", { exact: true })).toBeVisible();
  await ui(first.locator('[data-yours-stream="translation"]')).toBeVisible(); await ui(first.locator('[data-yours-stream="note"]')).toBeVisible();
  await ui(first.locator("textarea, form")).toHaveCount(0);
  await ui(first.getByRole("button", { name: "Save to My Readings", exact: true })).toHaveCount(0);
  // A star on the inline Rashi comment: pressed in place, and listed in Yours.
  const star = tab.locator('[data-commentary-ref="Genesis 1:1"] [data-star="rashi|Genesis 1:1|1"]');
  await ui(star).toHaveAttribute("aria-pressed", "false");
  await star.click();
  await ui(star).toHaveAttribute("aria-pressed", "true");
  await ui(first.getByTestId("yours-starred").getByText("SYNTHETIC LEMMA", { exact: false })).toBeVisible();
  expect(await noHorizontalScroll(tab)).toBe(true);
  for (const height of await tab.locator("[data-yours-ref] button, [data-star]").evaluateAll(nodes => nodes.filter(node => (node as HTMLElement).offsetParent).map(node => node.getBoundingClientRect().height)))
    expect(height).toBeGreaterThanOrEqual(44);
  // After a reload all of it is still there, for this member.
  await tab.reload({ waitUntil: "domcontentloaded" });
  await ui(tab.locator("[data-study-rows]")).toBeVisible();
  await ui(tab.locator('[data-commentary-ref="Genesis 1:1"] [data-star="rashi|Genesis 1:1|1"]').first()).toHaveAttribute("aria-pressed", "true");
  await tab.locator('[data-yours-ref="Genesis 1:1"]').getByTestId("yours-toggle").click();
  await ui(tab.locator('[data-yours-ref="Genesis 1:1"]').getByText("Synthetic own words for the first verse.", { exact: true })).toBeVisible();
  // Lein: the drill reveals JPS only, with no own translation and no way into Yours.
  await tab.getByRole("group", { name: "Reading lens", exact: true }).getByRole("button", { name: "Lein", exact: true }).click();
  await tab.locator('[data-testid="study-verses"] [data-verse-ref="Genesis 1:1"] [data-word-index="0"]').first().click();
  await tab.getByRole("button", { name: "Translate drill", exact: true }).click();
  const drill = tab.getByRole("region", { name: "Translate drill on Genesis 1:1", exact: true });
  await drill.getByRole("button", { name: "Reveal", exact: true }).click();
  await ui(drill.getByRole("heading", { name: "JPS", exact: true })).toBeVisible();
  await ui(drill.getByText(/My translation|Synthetic own words|Write one|Yours/)).toHaveCount(0);
  // Unstarring deletes the star (in Study, where the comment and its star are).
  await tab.getByRole("group", { name: "Reading lens", exact: true }).getByRole("button", { name: "Study", exact: true }).click();
  await ui(tab.locator("[data-study-rows]")).toBeVisible();
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
