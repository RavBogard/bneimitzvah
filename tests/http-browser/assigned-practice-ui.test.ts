// Assigned Practice (student phone walk, 2026-10-28): a student practicing alone on a phone opens the reading to the Hebrew, a tapped word opens a sheet
// without moving the page, Up close opens at the first verse not yet Got it, and Listen is present but disabled, asking for no audio, while it is not released (G3).
// Synthetic people and invented words only; no corpus, real media or external requests.
import { beforeAll, afterAll, it, expect, vi } from "vitest";
import { expect as ui } from "@playwright/test";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { browserFixture } from "./fixture";
import { assertBrowserStartupAllowed, BROWSER_ORIGIN, startBrowserServer } from "./server";
import { installLoopbackFetchGuard } from "./egress";
import { openAuthMail } from "./auth-navigation";
import { syntheticUiStudyPage } from "../helpers/study-ui";
import { normalizeHebrew } from "../../src/server/study/normalize";
import type { StudyRequest } from "../../src/server/study/types";
import * as s from "../../src/server/db/index";
import { manage, openVerseEditor } from "./reading-nav";
vi.mock("server-only", () => ({}));

// Invented pointed words, a dozen to a verse, so ten verses run well past one phone screen.
const WORDS = ["בָּ֑ג", "דָּ֖ג", "זָ֣ח", "גַּ֥ם", "דָּ֔ל", "חָ֗ג", "בָּ֤ד", "זָ֨ג"];
const studyPage = (request: StudyRequest) => {
  const page = syntheticUiStudyPage(request, "available");
  return { ...page, verses: page.verses.map((verse, index) => ({ ...verse, hebrew: normalizeHebrew(`${Array.from({ length: 12 }, (_, i) => WORDS[(index + i) % WORDS.length]).join(" ")}׃`) })) };
};
let fixture: Awaited<ReturnType<typeof browserFixture>>, browser: Browser, stop: (() => Promise<void>) | undefined, restore: (() => void) | undefined;
let anotherStudentId: string;
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
    const ranges = kind === "torah" ? ["Genesis 1:1", "Genesis 1:3-10"] : ["Isaiah 1:1-9"];
    const verses = Array.from({ length: count }, (_, index) => index + 1).filter(verse => kind !== "torah" || verse !== 2);
    const [assignment] = await fixture.ownerDb.insert(s.assignment).values({ tenantId: "crc", studentId: fixture.student.id, kind, basis: "custom",
      ref: ranges.join("; "), aliyahStarts: kind === "torah" ? ["Genesis 1:4"] : null, status: "confirmed", setByMembershipId: member.id,
      proposalSnapshot: { ranges, confirmationDate: "2027-01-02", needsReview: false } }).returning();
    await fixture.ownerDb.insert(s.assignmentVerse).values(verses.map((verse, index) => ({ tenantId: "crc", studentId: fixture.student.id, assignmentId: assignment.id, ordinal: index + 1, verseRef: book + " 1:" + verse })));
  }
  await fixture.ownerDb.insert(s.privatePronouns).values({ tenantId: "crc", studentId: fixture.student.id, pronouns: "they/them" });
  const [tutor] = await fixture.ownerDb.select().from(s.membership).where(eq(s.membership.userId, fixture.tutor.id));
  await fixture.ownerDb.insert(s.lessonLog).values({ tenantId: "crc", studentId: fixture.student.id, entryId: randomUUID(), creatorMembershipId: tutor.id,
    creatorUserId: fixture.tutor.id, lessonDate: "2026-11-18", summary: "Synthetic tutor lesson for the shared reading.", beforeNext: "Synthetic next practice.", version: 1, deleted: false });
  anotherStudentId = (await fixture.practice()).sibling.id;
  await fixture.ownerDb.insert(s.tutorStudent).values({ tenantId: "crc", studentId: anotherStudentId, tutorGrantId: fixture.tutorGrant.id });
  stop = await startBrowserServer(fixture.withRuntime); browser = await chromium.launch({ headless: true });
}, 120_000);
afterAll(async () => {
  await Promise.all(contexts.map(context => context.close().catch(() => {}))); await browser?.close().catch(() => {}); await stop?.().catch(() => {}); await fixture?.close().catch(() => {}); restore?.();
}, 120_000);

async function practiceReading(role: "student" | "tutor", width: number, height: number) {
  const context = await browser.newContext({ baseURL: BROWSER_ORIGIN, viewport: { width, height }, isMobile: width < 640, hasTouch: width < 640, serviceWorkers: "block", acceptDownloads: false }); contexts.push(context);
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

for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
it(`starts with a closed tutor sidebar and returns from Practice and the editor at ${viewport.width}px`, async () => {
  const { tab } = await practiceReading("tutor", viewport.width, viewport.height);
  const rail = tab.getByTestId("lesson-rail"), disclosure = rail.getByTestId("lesson-rail-toggle");
  const history = rail.getByRole("heading", { name: "Lessons", exact: true });
  const note = rail.getByText("Synthetic tutor lesson for the shared reading.", { exact: true });
  const upcoming = rail.getByText("Synthetic next practice.", { exact: false });
  const assertRight = async (button: import("playwright").Locator, bar: import("playwright").Locator) => {
    await ui(button).toBeInViewport();
    const close = (await button.boundingBox())!, frame = (await bar.boundingBox())!;
    expect(frame.x + frame.width - close.x - close.width).toBeLessThanOrEqual(16);
    expect(close.y - frame.y).toBeLessThanOrEqual(16);
    expect(close.width).toBeGreaterThanOrEqual(44);
  };
  await ui(rail).toBeVisible();
  await ui(disclosure).toHaveText("Lesson and practice");
  await ui(rail).not.toHaveAttribute("open", "");
  await ui(history).toBeHidden();
  await ui(note).toBeHidden();
  await ui(upcoming).toBeHidden();
  const readingColumn = tab.getByTestId("staff-layout").locator(".staff-main");
  const collapsedWidth = (await readingColumn.boundingBox())!.width;
  await disclosure.focus();
  await tab.keyboard.press("Enter");
  await ui(history).toBeVisible();
  await ui(note).toBeVisible();
  await ui(upcoming.first()).toBeVisible();
  await ui(rail.locator(".lesson-log")).toHaveCount(1);
  if (viewport.width >= 1200) expect((await readingColumn.boundingBox())!.width).toBeLessThan(collapsedWidth);
  await ui(tab.locator("[data-staff-nav]")).toBeVisible();
  await ui(tab.getByTestId("private-pronouns")).toContainText("they/them");
  const enter = tab.locator(".reading-practice-action");
  await enter.click();
  await ui(surface(tab)).toBeVisible();
  await ui(tab.locator("dialog.lift")).toHaveCount(0);
  await ui(tab.getByTestId("lesson-rail")).toHaveCount(0);
  await ui(tab.locator("[data-staff-nav]")).toBeHidden();
  await ui(tab.getByTestId("private-pronouns")).toHaveCount(0);
  await ui(tab.getByTestId("pronouns-editor")).toHaveCount(0);
  await ui(tab.locator(".reading-other-assignments, .study-verse-bar, .guide-place")).toHaveCount(0);
  await ui(surface(tab).getByRole("button", { name: "Play aliyah", exact: true })).toBeVisible();
  await ui(surface(tab).getByRole("region", { name: "Reading playback", exact: true })).toBeVisible();
  await ui(surface(tab).getByTestId("practice-verse-controls")).toBeVisible();
  const close = tab.getByTestId("close-assigned-practice");
  await assertRight(close, surface(tab).locator("header").first());
  await ui(close).toBeFocused();
  if (viewport.width < 640) await close.click(); else await tab.keyboard.press("Escape");
  await ui(surface(tab)).toHaveCount(0);
  const returned = tab.locator(":focus");
  await ui(returned).toBeInViewport();
  expect(await returned.evaluate(node => node.matches(".reading-practice-action") || !!node.closest('[data-verse-ref="Genesis 1:1"]'))).toBe(true);
  await ui(rail).not.toHaveAttribute("open", "");
  await ui(note).toBeHidden();
  if (viewport.width < 640) {
    await tab.getByRole("link", { name: "Lesson and practice", exact: true }).click();
    await ui(disclosure).toBeFocused();
  }
  else await disclosure.click();
  await ui(note).toBeVisible();

  const manage = tab.getByRole("button", { name: "Manage reading", exact: true });
  await openVerseEditor(tab);
  const editor = tab.getByRole("dialog", { name: "Set the assigned reading" });
  const editorClose = editor.getByRole("button", { name: "Close verse editor" });
  await assertRight(editorClose, editor.locator(".sheet-bar"));
  if (viewport.width < 640) await tab.keyboard.press("Escape"); else await editorClose.click();
  await ui(editor).toBeHidden();
  await ui(manage).toBeFocused();
  await tab.goto(`/workspace/tutor/${fixture.student.id}`);
  await ui(disclosure).toBeVisible();
  await ui(rail).not.toHaveAttribute("open", "");
  await ui(note).toBeHidden();
  if (viewport.width >= 1200) {
    await manage(tab, "Add lesson note");
    const add = tab.getByRole("dialog", { name: "Add lesson note" });
    await ui(add).toBeVisible();
    await tab.keyboard.press("Escape");
    await ui(add).toBeHidden();
    await ui(note).toBeVisible();
    const nav = tab.locator("[data-staff-nav]");
    await nav.getByText("My Students", { exact: true }).click();
    await nav.locator(`a[href="/workspace/tutor/${anotherStudentId}"]`).click();
    await tab.waitForURL(url => url.pathname === `/workspace/tutor/${anotherStudentId}`);
    await ui(disclosure).toBeVisible();
    await ui(rail).not.toHaveAttribute("open", "");
    await ui(note).toHaveCount(0);
    await tab.goto(`/workspace/tutor/${fixture.student.id}#lessons`);
    await ui(history).toBeFocused();
    await ui(note).toBeVisible();
  }
});
}

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

it("plays the assigned aliyah in order, pauses and resumes, and stops at its recorded boundary on a phone", async () => {
  const { tab } = await practiceReading("student", 390, 844);
  const played: string[] = [];
  const frames = 8000 * 4;
  const wave = Buffer.alloc(44 + 2 * frames);
  wave.write("RIFF"); wave.writeUInt32LE(wave.length - 8, 4); wave.write("WAVEfmt ", 8);
  wave.writeUInt32LE(16, 16); wave.writeUInt16LE(1, 20); wave.writeUInt16LE(1, 22);
  wave.writeUInt32LE(8000, 24); wave.writeUInt32LE(16000, 28); wave.writeUInt16LE(2, 32);
  wave.writeUInt16LE(16, 34); wave.write("data", 36); wave.writeUInt32LE(2 * frames, 40);
  await tab.route("**/api/shermet-audio/catalog", route => route.fulfill({ json: { refs: ["Genesis 1:1", "Genesis 1:3", "Genesis 1:4", "Isaiah 1:1", "Isaiah 1:2"] } }));
  let missing = false;
  await tab.route("**/api/shermet-audio?*", route => {
    const ref = new URL(route.request().url()).searchParams.get("ref")!;
    if (missing && ref === "Genesis 1:3") return route.fulfill({ status: 404 });
    played.push(ref);
    return route.fulfill({ contentType: "audio/wav", body: wave });
  });
  // This tab is already on /mine/reading. The hash-based Practice entry
  // is read once at document startup.
  await tab.goto("about:blank");
  await tab.goto("/mine/reading#practice");
  const practice = surface(tab), parts = practice.getByRole("tablist", { name: "Reading sections" });
  await ui(practice).toBeVisible();
  const start = practice.getByTestId("play-section-start");
  const stop = practice.getByRole("button", { name: "Stop aliyah", exact: true });
  const transport = practice.getByRole("group", { name: "Verse playback", exact: true });
  const pause = transport.getByRole("button", { name: "Pause", exact: true });
  await parts.getByRole("tab", { name: "Aliyah 2", exact: true }).click();
  await ui(practice.getByTestId("assigned-text")).toHaveAttribute("data-practice-ref", "Genesis 1:4");
  await parts.getByRole("tab", { name: "Aliyah 1", exact: true }).click();
  await ui(practice.getByTestId("assigned-text")).toHaveAttribute("data-practice-ref", "Genesis 1:1");
  expect(played).toEqual([]);
  await start.click();
  await ui(pause).toBeVisible();
  await ui(transport.getByRole("button", { name: "Repeat", exact: true })).toBeDisabled();
  await pause.click();
  expect([...new Set(played)]).toEqual(["Genesis 1:1"]);
  await transport.getByRole("button", { name: "Play", exact: true }).click();
  await ui(pause).toBeVisible();
  await ui(practice.getByTestId("player-selection")).toHaveAttribute("data-selected-ref", "Genesis 1:3", { timeout: 15_000 });
  await ui(pause).toBeVisible();
  await ui(stop).toHaveCount(0, { timeout: 15_000 });
  await ui(practice.getByText("Aliyah finished.", { exact: true })).toBeVisible();
  expect([...new Set(played)]).toEqual(["Genesis 1:1", "Genesis 1:3"]);
  await start.click();
  await ui(pause).toBeVisible();
  await stop.click();
  await ui(start).toBeVisible();
  await ui(pause).toHaveCount(0);

  missing = true;
  await start.click();
  await ui(pause).toBeVisible();
  await ui(practice.getByText(/Playback stopped/)).toBeVisible({ timeout: 15_000 });
  await ui(stop).toHaveCount(0);
  await ui(practice.getByText("Aliyah finished.", { exact: true })).toHaveCount(0);
  await ui(practice.getByTestId("player-selection")).toHaveAttribute("data-selected-ref", "Genesis 1:3");

  await practice.getByRole("button", { name: "Haftarah text", exact: true }).click();
  await ui(start).toHaveText("Play from first verse");
  await start.click();
  await ui(pause).toBeVisible();
  await ui(transport.getByRole("button", { name: "Repeat", exact: true })).toBeEnabled();
  await ui(pause).toHaveCount(0, { timeout: 15_000 });
  await ui(practice.getByTestId("player-selection")).toHaveAttribute("data-selected-ref", "Isaiah 1:1");
  expect(played).not.toContain("Isaiah 1:2");
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
