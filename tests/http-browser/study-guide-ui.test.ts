import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { expect as ui } from "@playwright/test";
import { chromium, type Browser, type BrowserContext, type Page, type Route } from "playwright";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { browserFixture } from "./fixture";
import { assertBrowserStartupAllowed, BROWSER_ORIGIN, startBrowserServer } from "./server";
import { installLoopbackFetchGuard } from "./egress";
import { closeVerseTools, openVerseTools } from "./verse-tools";
import { openAuthMail } from "./auth-navigation";
import { syntheticUiStudyPage } from "../helpers/study-ui";
import { guide, note, source, theme } from "../helpers/study-guide-fixture";
import * as s from "../../src/server/db/index";
import type { GuideBody } from "../../src/server/study-guides/validation";
vi.mock("server-only", () => ({}));

let fixture: Awaited<ReturnType<typeof browserFixture>>, browser: Browser, stop: (() => Promise<void>) | undefined, restore: (() => void) | undefined;
let actor: { actorUserId: string; actorMembershipId: string; roleGrantId: string }, assignmentId = "", version = 0;
const contexts: BrowserContext[] = [], cookies = new Map<string, Awaited<ReturnType<BrowserContext["cookies"]>>>();
const bereshit = { date: "2027-01-02", calendar: "diaspora", classification: "regular", haftarah: "Isaiah 42:5-43:10",
  reading: { parashah: "Bereshit", type: "shabbat", summary: "", source: "Hebcal", triennial: null, aliyot: [{ n: 1, ref: "Genesis 1:1-2:3" }] } };
const body = guide({ overview: "An invented overview: the world begins with *words*, and the word for light is אור.", themes: [
  theme("light", { title: "Light first", intro: "Invented: why light comes before the sun.", notes: [note("Genesis 1:3", { body: "Invented note on the first spoken word.", sources: [source("invented-a"), source("invented-b", false)] })] }),
  theme("beginnings", { title: "How beginnings work", intro: "Invented: what it means to start.", notes: [note("Genesis 1:1"), note("Genesis 2:1")] }),
] });

async function seed(next: GuideBody, extra: { reviewed?: boolean; origin?: "claude" | "rabbi"; hold?: boolean } = {}) {
  version++;
  await fixture.ownerDb.insert(s.studyGuide).values({ tenantId: "crc", kind: "torah", readingKey: "bereshit", version, baseVersion: version - 1, previousVersion: version === 1 ? null : version - 1,
    origin: extra.origin ?? "claude", reviewed: extra.reviewed ?? false, hold: extra.hold ?? false, body: next, ...actor, role: "admin", mode: "admin", channel: "mcp", mutationId: randomUUID(), requestDigest: "a".repeat(64) });
}
async function page(who: "student" | "parent" | "tutor" | "admin", mobile = false) {
  const context = await browser.newContext({ baseURL: BROWSER_ORIGIN, serviceWorkers: "block", acceptDownloads: false, viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 } }); contexts.push(context);
  await context.route("**/*", async (route: Route) => { if (new URL(route.request().url()).origin === BROWSER_ORIGIN) await route.continue().catch(() => undefined); else await route.abort(); });
  const account = who === "tutor" ? "parent" : who, saved = cookies.get(account); if (saved) await context.addCookies(saved);
  const tab = await context.newPage(); await tab.goto("/", { waitUntil: "domcontentloaded" });
  if (!saved) {
    const email = who === "student" ? "pg-guide-student@example.test" : who === "admin" ? "pg-admin@example.test" : "pg-tutor@example.test";
    expect(await tab.evaluate(async email => (await fetch("/api/auth/sign-in/magic-link", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) })).status, email)).toBe(200);
    await openAuthMail(tab, fixture.takeMail(email)); cookies.set(account, await context.cookies());
  }
  if (who === "student") await tab.goto("/workspace/student?tab=reading", { waitUntil: "domcontentloaded" });
  else if (who === "tutor") await tab.goto(`/workspace/tutor/${fixture.student.id}`, { waitUntil: "domcontentloaded" });
  else if (who === "admin") await tab.goto(`/workspace/admin/students/${fixture.student.id}/reading`, { waitUntil: "domcontentloaded" });
  else { await tab.goto("/workspace/parent", { waitUntil: "domcontentloaded" }); await tab.getByLabel("Child", { exact: true }).locator(`[data-student-id="${fixture.student.id}"]`).click(); }
  await ui(tab.locator(".study-verses").getByRole("heading", { name: "Genesis 1:1", level: 4, exact: true })).toBeVisible();
  return tab;
}
const card = (tab: Page) => tab.getByRole("region", { name: "About this portion", exact: true });
// Each verse's notes are in its own verse tools (one Sheet for the selected verse, 1.9 N4), so a verse is opened to be looked at.
const verse = (tab: Page, ref: string) => openVerseTools(tab, ref);

beforeAll(async () => {
  assertBrowserStartupAllowed(); restore = installLoopbackFetchGuard();
  fixture = await browserFixture({ studyLoad: async request => syntheticUiStudyPage(request) });
  const learner = await fixture.signIn("pg-guide-student"), [member] = await fixture.ownerDb.insert(s.membership).values({ tenantId: "crc", userId: learner.id }).returning();
  const [grant] = await fixture.ownerDb.insert(s.roleGrant).values({ tenantId: "crc", membershipId: member.id, role: "student" }).returning();
  await fixture.ownerDb.insert(s.studentIdentity).values({ tenantId: "crc", studentId: fixture.student.id, roleGrantId: grant.id });
  const [admin] = await fixture.ownerDb.select().from(s.membership).where(eq(s.membership.userId, fixture.admin.id));
  const [adminGrant] = await fixture.ownerDb.select().from(s.roleGrant).where(and(eq(s.roleGrant.membershipId, admin.id), eq(s.roleGrant.role, "admin")));
  actor = { actorUserId: fixture.admin.id, actorMembershipId: admin.id, roleGrantId: adminGrant.id };
  const [assignment] = await fixture.ownerDb.insert(s.assignment).values({ tenantId: "crc", studentId: fixture.student.id, kind: "torah", basis: "custom", ref: "Genesis 1:1-3", status: "confirmed", setByMembershipId: admin.id,
    proposalSnapshot: { slotProvenance: 1, confirmationDate: "2027-01-02", needsReview: false, source: bereshit } }).returning();
  assignmentId = assignment.id;
  await fixture.ownerDb.insert(s.assignmentVerse).values([1, 2, 3].map(verse => ({ tenantId: "crc", studentId: fixture.student.id, assignmentId: assignment.id, ordinal: verse, verseRef: `Genesis 1:${verse}` })));
  await seed(body);
  stop = await startBrowserServer(fixture.withRuntime); browser = await chromium.launch({ headless: true });
}, 120_000);
afterEach(async () => { for (const value of contexts.splice(0)) { await value.unrouteAll({ behavior: "wait" }); await value.close(); } });
afterAll(async () => { await browser?.close().catch(() => undefined); await stop?.().catch(() => undefined); await fixture?.close().catch(() => undefined); restore?.(); });

it("student sees the overview card with the Claude label, and each note only under its own verse", async () => {
  const tab = await page("student");
  await ui(card(tab)).toBeVisible();
  await ui(card(tab).getByText("Written by Claude for CRC · not yet reviewed by the rabbi", { exact: true })).toBeVisible();
  const credit = tab.locator("footer.site-footer");
  await ui(credit).toContainText("A project of Rabbi Daniel Bogard");
  await ui(credit.getByRole("link", { name: "Rabbi Daniel Bogard", exact: true })).toHaveAttribute("href", "https://danielbogard.com");
  await ui(card(tab).locator("bdi[lang=he]")).toHaveText("אור");
  // "Genesis 2:1" is outside the assigned verses; its theme still shows because Genesis 1:1 remains.
  await ui(card(tab).locator("li")).toHaveCount(2);
  const notes = async (ref: string) => (await verse(tab, ref)).getByRole("region", { name: `Study notes for ${ref}`, exact: true });
  const third = await notes("Genesis 1:3");
  await ui(third.getByText("Invented note on the first spoken word.", { exact: true })).toBeVisible();
  await ui(third.getByRole("link", { name: /On Sefaria/ })).toHaveCount(2);
  await ui(third.getByRole("link", { name: /On Sefaria/ }).first()).toHaveAttribute("href", "https://www.sefaria.org/Invented_Commentary_on_Exodus_40%3A34%3A1");
  await ui(await notes("Genesis 1:1")).toBeVisible();
  await ui(await notes("Genesis 1:2")).toHaveCount(0);
  await closeVerseTools(tab);
});

it("Your translation & notes sits under More at the bottom of each verse card, after Sources", async () => {
  const tab = await page("student");
  const detail = await verse(tab, "Genesis 1:3"), more = detail.locator(".verse-work summary");
  await ui(more).toHaveText(/^More · Your translation & notes/);
  const order = await detail.evaluate(node => [...node.children].map(child => child.matches("[data-guide-notes]") ? "notes" : child.matches(".verse-work") ? "more" : child.querySelector?.('[aria-label^="Sources for"]') || child.getAttribute("aria-label")?.startsWith("Sources for") ? "sources" : null).filter(Boolean));
  expect(order.indexOf("notes")).toBeLessThan(order.indexOf("more"));
  expect(order.at(-1)).toBe("more");
});

it("tick toggles and persists across reload", async () => {
  const tab = await page("student");
  const button = card(tab).getByRole("button", { name: "I read this: Light first", exact: true });
  await button.click();
  await ui(card(tab).getByRole("button", { name: "I read this: Light first", exact: true })).toHaveAttribute("aria-pressed", "true");
  await tab.reload({ waitUntil: "domcontentloaded" });
  await ui(card(tab).getByRole("button", { name: "I read this: Light first", exact: true })).toHaveAttribute("aria-pressed", "true");
  const rows = await fixture.ownerDb.select().from(s.studyThemeRead).where(eq(s.studyThemeRead.studentId, fixture.student.id));
  expect(rows.map(r => [r.themeId, r.state, r.version])).toEqual([["light", "read", 1]]);
});

it("walk opens on the first theme, Next advances through its verses then the next theme, and close returns to the last verse", async () => {
  const tab = await page("student");
  await card(tab).getByRole("button", { name: "Study the themes", exact: true }).click();
  const walk = tab.locator("dialog.guide-walk"), heading = walk.locator(".lift-ref");
  await ui(walk).toBeVisible(); await ui(heading).toHaveText("Light first");
  await walk.getByRole("button", { name: "Next", exact: true }).click();
  await ui(heading).toHaveText("Genesis 1:3");
  await ui(walk.locator(".lift-hebrew")).toBeVisible();
  await ui(walk.getByText("Invented note on the first spoken word.", { exact: true })).toBeVisible();
  await walk.getByRole("button", { name: "Next", exact: true }).click();
  await ui(heading).toHaveText("How beginnings work");
  await walk.getByRole("button", { name: "Next", exact: true }).click();
  await ui(heading).toHaveText("Genesis 1:1");
  await ui(walk.getByRole("button", { name: "Next", exact: true })).toHaveCount(0);
  await walk.getByRole("button", { name: "Done", exact: true }).click();
  await ui(walk).toHaveCount(0);
  // The notes are in the verse tools sheet now, which is not open, so the walk gives focus back to the button that opened it.
  await ui(card(tab).getByRole("button", { name: "Study the themes", exact: true })).toBeFocused();
});

it("parent sees the card and the tick state but no tick button", async () => {
  const tab = await page("parent");
  await ui(card(tab)).toBeVisible();
  await ui(card(tab).getByRole("button", { name: /I read this/ })).toHaveCount(0);
  await ui(card(tab).locator("li").filter({ hasText: "Light first" })).toContainText("Read");
  await ui(card(tab).locator("li").filter({ hasText: "How beginnings work" })).toContainText("Not read yet");
});

it("walk is absent when the guide has no themes", async () => {
  await seed(guide({ overview: "An invented overview with no themes yet.", themes: [] }));
  const tab = await page("student");
  await ui(card(tab).getByText("An invented overview with no themes yet.", { exact: true })).toBeVisible();
  await ui(card(tab).getByRole("button", { name: "Study the themes", exact: true })).toHaveCount(0);
});

it("reviewed guide shows Reviewed by Rabbi Daniel when the tenant name is set, and fits a phone", async () => {
  await fixture.ownerDb.update(s.tenant).set({ customs: { credits: { rabbiDisplayName: "Rabbi Daniel" } } }).where(eq(s.tenant.id, "crc"));
  await seed(body, { reviewed: true, origin: "rabbi" });
  const tab = await page("student", true);
  // On a phone the guide starts closed so the Hebrew stays in the first screen.
  await ui(card(tab).getByText("Reviewed by Rabbi Daniel", { exact: true })).toBeHidden();
  const hebrewTop = await tab.locator(".assigned-study .study-hebrew").first().evaluate(node => { scrollTo(0, 0); return node.getBoundingClientRect().top; });
  expect(hebrewTop).toBeLessThan(844 - 48);
  await card(tab).getByText("About this portion", { exact: true }).click();
  await ui(card(tab).getByText("Reviewed by Rabbi Daniel", { exact: true })).toBeVisible();
  expect(await tab.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

const englishToggle = (tab: Page) => tab.getByRole("navigation", { name: "Reading tools", exact: true }).getByRole("button", { name: "English", exact: true });
const boxes = (tab: Page, ref: string) => tab.locator(`.assigned-study .study-verses [data-verse-ref="${ref}"]`).evaluate(node => {
  const he = node.querySelector("[data-hebrew-ref]")!.getBoundingClientRect(), en = node.querySelector("[data-english-ref]")!.getBoundingClientRect();
  return { he: { left: he.left, right: he.right, top: he.top, bottom: he.bottom }, en: { left: en.left, right: en.right, top: en.top } };
});

it("at 1440 a learner sees English beside each verse by default, aligned with that verse", async () => {
  const tab = await page("student");
  await ui(englishToggle(tab)).toHaveAttribute("aria-pressed", "true");
  for (const ref of ["Genesis 1:1", "Genesis 1:3"]) {
    const box = await boxes(tab, ref);
    expect(box.en.left).toBeGreaterThanOrEqual(box.he.right - 1);
    expect(Math.abs(box.en.top - box.he.top)).toBeLessThan(48);
  }
});

it("at 390 English is off by default and interleaves under its verse when turned on", async () => {
  const tab = await page("student", true);
  await ui(englishToggle(tab)).toHaveAttribute("aria-pressed", "false");
  await englishToggle(tab).click();
  const box = await boxes(tab, "Genesis 1:1");
  expect(box.en.top).toBeGreaterThanOrEqual(box.he.bottom - 2);
  expect(await tab.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

it("the English preference persists across reload", async () => {
  const tab = await page("student");
  await englishToggle(tab).click();
  await ui(englishToggle(tab)).toHaveAttribute("aria-pressed", "false");
  await tab.reload({ waitUntil: "domcontentloaded" });
  await ui(tab.locator(".study-verses").getByRole("heading", { name: "Genesis 1:1", level: 4, exact: true })).toBeVisible();
  await ui(englishToggle(tab)).toHaveAttribute("aria-pressed", "false");
  await ui(tab.locator(".assigned-study .study-verses [data-english-ref]")).toHaveCount(0);
});

it("tutor sees which themes the student has read, without a tick button", async () => {
  const tab = await page("tutor");
  await ui(card(tab).locator("li").filter({ hasText: "Light first" })).toContainText("Read");
  await ui(card(tab).getByRole("button", { name: /I read this/ })).toHaveCount(0);
});

it("admin sees the status line and a newer draft waiting, while students keep the reviewed version", async () => {
  await seed(guide({ overview: "A held invented revision.", themes: [] }), { hold: true });
  const tab = await page("admin");
  const status = tab.locator("[data-guide-status]");
  await ui(status).toContainText("Study guide: Reviewed · 2 themes · updated");
  await ui(status).toContainText("newer draft waiting");
  await ui(status).toContainText("edit in Cowork");
  // The card below the status line is the student preview: the reviewed version, not the held one.
  await ui(card(tab).getByText("Reviewed by Rabbi Daniel", { exact: true })).toBeVisible();
  await ui(card(tab).getByText("A held invented revision.", { exact: true })).toHaveCount(0);
});

it("no guide chrome when readingKey is null", async () => {
  await fixture.ownerDb.update(s.assignment).set({ proposalSnapshot: { slotProvenance: 1, confirmationDate: "2027-01-02", needsReview: false } }).where(eq(s.assignment.id, assignmentId));
  const tab = await page("student");
  await ui(tab.locator("[data-guide-kind]")).toHaveCount(0);
  await ui(tab.locator("[data-guide-notes]")).toHaveCount(0);
  await ui(tab.getByText(/study guide/i)).toHaveCount(0);
});
