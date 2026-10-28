// Hebrew first (student phone walk, 2026-10-28): a student practising alone on a phone opens the reading to the Hebrew, a tapped word opens a sheet
// without moving the page, Up close opens at the first verse not yet Got it, and Listen is present but disabled, asking for no audio, while it is not released (G3).
// Synthetic people and invented words only; no corpus, real media or external requests.
import { beforeAll, afterAll, it, expect, vi } from "vitest";
import { expect as ui } from "@playwright/test";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { eq } from "drizzle-orm";
import { browserFixture } from "./fixture";
import { assertBrowserStartupAllowed, BROWSER_ORIGIN, startBrowserServer } from "./server";
import { installLoopbackFetchGuard } from "./egress";
import { openAuthMail } from "./auth-navigation";
import { syntheticUiStudyPage } from "../helpers/study-ui";
import { normalizeHebrew } from "../../src/server/study/normalize";
import type { StudyRequest } from "../../src/server/study/types";
import * as s from "../../src/server/db/index";
vi.mock("server-only", () => ({}));

// Invented pointed words, a dozen to a verse, so ten verses run well past one phone screen.
const WORDS = ["בָּ֑ג", "דָּ֖ג", "זָ֣ח", "גַּ֥ם", "דָּ֔ל", "חָ֗ג", "בָּ֤ד", "זָ֨ג"];
const studyPage = (request: StudyRequest) => {
  const page = syntheticUiStudyPage(request, "available");
  return { ...page, verses: page.verses.map((verse, index) => ({ ...verse, hebrew: normalizeHebrew(`${Array.from({ length: 12 }, (_, i) => WORDS[(index + i) % WORDS.length]).join(" ")}׃`) })) };
};
let fixture: Awaited<ReturnType<typeof browserFixture>>, browser: Browser, stop: (() => Promise<void>) | undefined, restore: (() => void) | undefined;
const contexts: BrowserContext[] = [];

beforeAll(async () => {
  assertBrowserStartupAllowed(); restore = installLoopbackFetchGuard();
  fixture = await browserFixture({ studyLoad: async request => studyPage(request) });
  const learner = await fixture.signIn("hf-student"), [membership] = await fixture.ownerDb.insert(s.membership).values({ tenantId: "crc", userId: learner.id }).returning();
  const [grant] = await fixture.ownerDb.insert(s.roleGrant).values({ tenantId: "crc", membershipId: membership.id, role: "student" }).returning();
  await fixture.ownerDb.insert(s.studentIdentity).values({ tenantId: "crc", studentId: fixture.student.id, roleGrantId: grant.id });
  await fixture.ownerDb.update(s.student).set({ rehearsal1: "2026-12-19", rehearsal2: "2026-12-26", serviceSlot: "morning" }).where(eq(s.student.id, fixture.student.id));
  const [member] = await fixture.ownerDb.select().from(s.membership).where(eq(s.membership.userId, fixture.admin.id));
  for (const [kind, book, count] of [["torah", "Genesis", 10], ["haftarah", "Isaiah", 9]] as const) {
    const [assignment] = await fixture.ownerDb.insert(s.assignment).values({ tenantId: "crc", studentId: fixture.student.id, kind, basis: "custom", ref: `${book} 1:1-${count}`, status: "confirmed", setByMembershipId: member.id,
      proposalSnapshot: { ranges: [`${book} 1:1-${count}`], confirmationDate: "2027-01-02", needsReview: false } }).returning();
    await fixture.ownerDb.insert(s.assignmentVerse).values(Array.from({ length: count }, (_, i) => ({ tenantId: "crc", studentId: fixture.student.id, assignmentId: assignment.id, ordinal: i + 1, verseRef: `${book} 1:${i + 1}` })));
  }
  stop = await startBrowserServer(fixture.withRuntime); browser = await chromium.launch({ headless: true });
}, 120_000);
afterAll(async () => {
  await Promise.all(contexts.map(context => context.close().catch(() => {}))); await browser?.close().catch(() => {}); await stop?.().catch(() => {}); await fixture?.close().catch(() => {}); restore?.();
}, 120_000);

async function studentReading(width: number, height: number) {
  const context = await browser.newContext({ baseURL: BROWSER_ORIGIN, viewport: { width, height }, isMobile: true, hasTouch: true, serviceWorkers: "block", acceptDownloads: false }); contexts.push(context);
  await context.route("**/*", async route => { if (new URL(route.request().url()).origin === BROWSER_ORIGIN) await route.continue(); else await route.abort(); });
  const tab = await context.newPage(), requests: string[] = []; tab.on("request", request => requests.push(new URL(request.url()).pathname));
  await tab.goto("/", { waitUntil: "domcontentloaded" });
  expect(await tab.evaluate(async () => (await fetch("/api/auth/sign-in/magic-link", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "hf-student@example.test" }) })).status)).toBe(200);
  await openAuthMail(tab, fixture.takeMail("hf-student@example.test"));
  await tab.goto("/mine/reading", { waitUntil: "domcontentloaded" });
  await ui(tab.locator('[data-testid="study-verses"] [data-verse-ref="Genesis 1:1"]')).toBeVisible();
  return { tab, requests };
}
const firstWord = (tab: Page) => tab.locator('[data-testid="study-verses"] [data-word-index]').first();
const dock = (tab: Page) => tab.getByRole("navigation", { name: "Reading tools", exact: true });

it("opens a student's reading on a phone with the first Hebrew line in the first screen, the plan folded at the foot", async () => {
  const { tab } = await studentReading(390, 844);
  const top = await firstWord(tab).evaluate(node => node.getBoundingClientRect().top);
  expect(await tab.evaluate(() => scrollY)).toBe(0);
  expect(top).toBeLessThan(844 / 2); // the top half: under the title and the reading switch, nothing else
  await ui(tab.getByRole("button", { name: "Torah text", exact: true })).toHaveAttribute("aria-pressed", "true");
  await ui(tab.locator(".hero-reading-summaries")).toHaveCount(0); await ui(tab.getByTestId("hero-rehearsals")).toBeHidden();
  const plan = tab.getByTestId("reading-plan"); await ui(plan).not.toHaveAttribute("open");
  await plan.locator("> summary").click(); await ui(plan.getByTestId("hero-rehearsals")).toBeVisible();
  expect(await tab.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

it("opens a tapped word's tools in a sheet without moving the page, and gives focus back to the word", async () => {
  const { tab } = await studentReading(390, 844);
  await tab.evaluate(() => scrollTo(0, 200)); await ui.poll(() => tab.evaluate(() => scrollY)).toBe(200);
  const word = tab.locator('[data-testid="study-verses"] [data-verse-ref="Genesis 1:3"] [data-word-index="1"]').first();
  await word.click();
  const sheet = tab.getByRole("dialog", { name: "Word tools", exact: true });
  await ui(sheet).toBeVisible(); await ui(sheet.getByTestId("word-tools-place")).toHaveAttribute("data-word-ref", "Genesis 1:3");
  expect(await tab.evaluate(() => scrollY)).toBe(200);
  await tab.keyboard.press("Escape"); await ui(sheet).toHaveCount(0);
  expect(await tab.evaluate(() => scrollY)).toBe(200);
  await ui(word).toBeFocused();
});

it("opens Up close at the first verse not yet Got it, and a verse number opens that verse's sheet with its check", async () => {
  const { tab } = await studentReading(390, 844);
  const upClose = dock(tab).getByTestId("dock-up-close"), lift = tab.locator("dialog.lift");
  await ui(upClose).toBeEnabled(); await upClose.click();
  await ui(lift.getByTestId("lift-count")).toHaveAttribute("data-lift-verse", "1");
  await lift.getByRole("group", { name: "How Genesis 1:1 is going" }).getByRole("button", { name: "Got it" }).click();
  await ui(lift.getByRole("group", { name: "How Genesis 1:1 is going" }).getByRole("button", { name: "Got it" })).toHaveAttribute("aria-pressed", "true");
  await lift.getByRole("button", { name: "Close practice view", exact: true }).click(); await ui(lift).toHaveCount(0);
  await ui(tab.locator('[data-verse-ref="Genesis 1:1"] [data-testid="verse-got-it"]')).toBeVisible();
  await upClose.click(); await ui(lift.getByTestId("lift-count")).toHaveAttribute("data-lift-verse", "2");
  await lift.getByRole("button", { name: "Close practice view", exact: true }).click(); await ui(lift).toHaveCount(0);
  // The verse's actions are in its sheet, opened from its number; nothing about it waits after the last verse.
  await ui(tab.getByTestId("study-verse-bar")).toHaveCount(0);
  await tab.locator('[data-verse-ref="Genesis 1:1"] button[data-verse-number]').click();
  const sheet = tab.getByRole("dialog", { name: "Verse tools · Genesis 1:1", exact: true });
  await ui(sheet.getByTestId("verse-mark")).toHaveAttribute("data-state", "got-it");
  await sheet.getByTestId("study-verse-actions").getByRole("button").first().click();
  await ui(lift.getByTestId("lift-count")).toHaveAttribute("data-lift-verse", "1");
});

it("keeps Listen in the dock, disabled while listening is not released, and asks for no audio when it is tapped", async () => {
  const { tab, requests } = await studentReading(320, 700);
  const listen = dock(tab).getByTestId("dock-listen");
  await ui(listen).toBeVisible(); await ui(listen).toHaveAttribute("aria-disabled", "true");
  const before = requests.length; await listen.click({ force: true }); // aria-disabled on purpose: it stays focusable and its tap shows why
  await ui(tab.getByTestId("dock-listen-reason")).toBeVisible();
  await tab.waitForTimeout(500);
  expect(requests.slice(before).filter(path => /reference|audio|media|\.(mp3|m4a|opus|ogg|wav)$/i.test(path))).toEqual([]);
  expect(await tab.locator("audio").count()).toBe(0);
  const box = await listen.boundingBox(); expect(box!.height).toBeGreaterThanOrEqual(44); expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(await tab.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
