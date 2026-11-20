// Assigned Practice (student phone walk, 2026-10-28): a student practicing alone on a phone opens the reading to the Hebrew, a tapped word opens a sheet
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
  fixture = await browserFixture({ referenceStudentRelease: true, studyLoad: async request => studyPage(request) });
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
  await fixture.ownerDb.insert(s.privatePronouns).values({ tenantId: "crc", studentId: fixture.student.id, pronouns: "they/them" });
  stop = await startBrowserServer(fixture.withRuntime); browser = await chromium.launch({ headless: true });
}, 120_000);
afterAll(async () => {
  await Promise.all(contexts.map(context => context.close().catch(() => {}))); await browser?.close().catch(() => {}); await stop?.().catch(() => {}); await fixture?.close().catch(() => {}); restore?.();
}, 120_000);

async function practiceReading(role: "student" | "tutor", width: number, height: number) {
  const context = await browser.newContext({ baseURL: BROWSER_ORIGIN, viewport: { width, height }, isMobile: true, hasTouch: true, serviceWorkers: "block", acceptDownloads: false }); contexts.push(context);
  await context.route("**/*", async route => { if (new URL(route.request().url()).origin === BROWSER_ORIGIN) await route.continue(); else await route.abort(); });
  const tab = await context.newPage(), requests: string[] = []; tab.on("request", request => requests.push(new URL(request.url()).pathname));
  await tab.goto("/", { waitUntil: "domcontentloaded" });
  const email = role === "student" ? "hf-student@example.test" : "pg-tutor@example.test";
  expect(await tab.evaluate(async (email) => (await fetch("/api/auth/sign-in/magic-link", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) })).status, email)).toBe(200);
  await openAuthMail(tab, fixture.takeMail(email));
  await tab.goto(role === "student" ? "/mine/reading" : `/workspace/tutor/${fixture.student.id}`, { waitUntil: "domcontentloaded" });
  await ui(tab.locator('[data-testid="study-verses"] [data-verse-ref="Genesis 1:1"]')).toBeVisible();
  return { tab, requests };
}

const surface = (tab: Page) => tab.locator("[data-assigned-practice]");

it("opens the tutor's existing aliyah without staff details and restores them on return", async () => {
  const { tab } = await practiceReading("tutor", 1440, 1000);
  await ui(tab.getByTestId("lesson-rail")).toBeVisible();
  await ui(tab.locator("[data-staff-nav]")).toBeVisible();
  await ui(tab.getByTestId("private-pronouns")).toContainText("they/them");
  await tab.locator(".reading-practice-action").click();
  await ui(surface(tab)).toBeVisible();
  await ui(tab.locator("dialog.lift")).toHaveCount(0);
  await ui(tab.getByTestId("lesson-rail")).toHaveCount(0);
  await ui(tab.locator("[data-staff-nav]")).toBeHidden();
  await ui(tab.getByTestId("private-pronouns")).toHaveCount(0);
  await ui(tab.getByTestId("pronouns-editor")).toHaveCount(0);
  await ui(tab.locator(".reading-other-assignments, .study-verse-bar, .guide-place")).toHaveCount(0);
  await ui(surface(tab).getByRole("button", { name: "Play from first verse", exact: true })).toBeVisible();
  await ui(surface(tab).getByRole("region", { name: "Reading playback", exact: true })).toBeVisible();
  await ui(surface(tab).getByTestId("practice-verse-controls")).toBeVisible();
  await tab.getByTestId("close-assigned-practice").click();
  await ui(surface(tab)).toHaveCount(0);
  await ui(tab.getByTestId("lesson-rail")).toBeVisible();
});

it("keeps the student's passage, progress and existing player through Practice and back", async () => {
  const { tab } = await practiceReading("student", 390, 844);
  await tab.locator('[data-verse-ref="Genesis 1:3"] button[data-verse-number]').click();
  await tab.getByTestId("study-verse-actions").getByRole("button").first().click();
  await ui(surface(tab)).toBeVisible();
  await ui(surface(tab).getByTestId("assigned-text")).toHaveAttribute("data-practice-ref", "Genesis 1:3");
  await ui(surface(tab).getByRole("group", { name: "How Genesis 1:3 is going", exact: true })).toBeVisible();
  await surface(tab).getByTestId("play-section-start").click();
  await ui(surface(tab).getByTestId("player-selection")).toHaveAttribute("data-selected-ref", "Genesis 1:1");
  await ui(surface(tab).getByRole("button", { name: "Repeat", exact: true })).toBeVisible();
  await ui(surface(tab).getByLabel("Speed", { exact: true })).toBeVisible();
  await tab.getByTestId("close-assigned-practice").click();
  await ui(surface(tab)).toHaveCount(0);
  await ui(tab.getByTestId("assigned-text")).toHaveAttribute("data-practice-ref", "Genesis 1:1");
  await ui(tab.getByTestId("player-selection")).toHaveAttribute("data-selected-ref", "Genesis 1:1");
  await ui(tab.getByTestId("reading-plan")).toBeAttached();
});

it("lets the linked learner edit optional pronouns privately from Account", async () => {
  const { tab } = await practiceReading("student", 390, 844);
  await tab.goto("/account", { waitUntil: "domcontentloaded" });
  const editor = tab.getByTestId("pronouns-editor");
  await ui(editor.getByLabel("Pronouns (optional)")).toHaveValue("they/them");
  await editor.getByLabel("Pronouns (optional)").fill("she/they");
  await editor.getByRole("button", { name: "Save pronouns", exact: true }).click();
  await ui(editor.getByRole("status")).toHaveText("Saved.");
  await tab.goto("/mine/reading#practice", { waitUntil: "domcontentloaded" });
  await ui(surface(tab)).toBeVisible();
  await ui(tab.getByTestId("private-pronouns")).toHaveCount(0);
  await ui(tab.getByTestId("pronouns-editor")).toHaveCount(0);
});
