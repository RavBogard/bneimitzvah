// Invented words/source rows only. No corpus, real media or external requests.
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
import { TANAKH_VERSE_COUNTS } from "../../src/lib/readings/catalog";
import { parseTahot, parseTbesh } from "../../src/server/study/lexical/step";
import type { StudyRequest } from "../../src/server/study/types";
import * as s from "../../src/server/db/index";
vi.mock("server-only", () => ({}));

// Genesis 1:1-4:26 is 106 verses: two text pages. B (H0001) appears in 1:1, 2:3 and 4:24 only.
const refs = [1, 2, 3, 4].flatMap(chapter => Array.from({ length: TANAKH_VERSE_COUNTS.Genesis[chapter - 1] }, (_, i) => `Genesis ${chapter}:${i + 1}`));
const pattern = (ref: string) => ref === "Genesis 1:1" || ref === "Genesis 4:24" ? "BD" : ref === "Genesis 2:3" ? "DB" : "ZD";
const rendered: Record<string, [string, string]> = { B: ["בָּ֑ג", "בָּ֖ג"], D: ["דָּ֑ג", "דָּ֖ג"], Z: ["זָ֑ח", "זָ֖ח"] };
const plain: Record<string, string> = { B: "בָּג", D: "דָּג", Z: "זָח" }, lemma: Record<string, string> = { B: "H0001", D: "H0002", Z: "H0003" };
function studyPage(request: StudyRequest) {
  const page = syntheticUiStudyPage(request);
  return { ...page, verses: page.verses.map(verse => ({ ...verse, hebrew: normalizeHebrew(`${[...pattern(verse.ref)].map((w, i) => rendered[w][i]).join(" ")}׃`) })) };
}
const book = parseTahot(refs.flatMap(ref => { const [, c, v] = /^Genesis ([0-9]+):([0-9]+)$/.exec(ref)!;
  return [...pattern(ref)].map((w, i) => `Gen.${c}.${v}#${i + 1}=L\t${plain[w]}\tDISCARDED\tSynthetic ${w} occurrence\t{${lemma[w]}}\tHNcmsa\t`); }).join("\n"), "Gen");
const lexicon = parseTbesh(["B", "D", "Z"].map(w => `${lemma[w]}#1\t${lemma[w]}\t${lemma[w]}\t${plain[w]}\tDISCARDED\tHNcmsa\tSynthetic ${w} sense\tDISCARDED`).join("\n"));
let fixture: Awaited<ReturnType<typeof browserFixture>>, browser: Browser, stop: (() => Promise<void>) | undefined, restore: (() => void) | undefined;
const contexts: BrowserContext[] = [];
async function api(tab: Page, path: string, body: unknown) {
  return tab.evaluate(async ({ path, body }) => (await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).status, { path, body });
}

beforeAll(async () => {
  assertBrowserStartupAllowed(); restore = installLoopbackFetchGuard();
  fixture = await browserFixture({ studyLoad: async request => studyPage(request), wordDetailsSource: { book: async () => book, lexicon: async () => lexicon } });
  const learner = await fixture.signIn("pg-student"), [membership] = await fixture.ownerDb.insert(s.membership).values({ tenantId: "crc", userId: learner.id }).returning();
  const [grant] = await fixture.ownerDb.insert(s.roleGrant).values({ tenantId: "crc", membershipId: membership.id, role: "student" }).returning();
  await fixture.ownerDb.insert(s.studentIdentity).values({ tenantId: "crc", studentId: fixture.student.id, roleGrantId: grant.id });
  const [member] = await fixture.ownerDb.select().from(s.membership).where(eq(s.membership.userId, fixture.admin.id));
  const [assignment] = await fixture.ownerDb.insert(s.assignment).values({ tenantId: "crc", studentId: fixture.student.id, kind: "torah", basis: "custom", ref: "Genesis 1:1-4:26", status: "confirmed", setByMembershipId: member.id, proposalSnapshot: { confirmationDate: "2027-01-02", needsReview: false } }).returning();
  await fixture.ownerDb.insert(s.assignmentVerse).values(refs.map((verseRef, i) => ({ tenantId: "crc", studentId: fixture.student.id, assignmentId: assignment.id, ordinal: i + 1, verseRef })));
  stop = await startBrowserServer(fixture.withRuntime); browser = await chromium.launch({ headless: true });
}, 120_000);
afterAll(async () => {
  await Promise.all(contexts.map(context => context.close().catch(() => {}))); await browser?.close().catch(() => {}); await stop?.().catch(() => {}); await fixture?.close().catch(() => {}); restore?.();
}, 120_000);

it("a student on a phone taps a word and goes to its other places in the reading, on this text page and the next", async () => {
  const context = await browser.newContext({ baseURL: BROWSER_ORIGIN, viewport: { width: 390, height: 844 }, serviceWorkers: "block", acceptDownloads: false }); contexts.push(context);
  await context.route("**/*", async route => { if (new URL(route.request().url()).origin === BROWSER_ORIGIN) await route.continue(); else await route.abort(); });
  const tab = await context.newPage(); await tab.goto("/", { waitUntil: "domcontentloaded" });
  expect(await api(tab, "/api/auth/sign-in/magic-link", { email: "pg-student@example.test" })).toBe(200); await openAuthMail(tab, fixture.takeMail("pg-student@example.test"));
  await tab.goto("/workspace/student", { waitUntil: "domcontentloaded" });
  await ui(tab.locator(".study-verses").getByRole("heading", { name: "Genesis 1:1", exact: true })).toBeVisible();
  const tools = tab.getByRole("region", { name: "Word tools", exact: true }), elsewhere = tools.getByRole("region", { name: "This word elsewhere", exact: true });
  await tab.locator('.study-verses [data-verse-ref="Genesis 1:1"] [data-word-index="0"]').first().click();
  await tools.getByRole("button", { name: "Word tools", exact: true }).click();
  await ui(tools).toContainText("Genesis 1:1 · Word 1 of 2"); await ui(tools.getByText("Synthetic B sense", { exact: true })).toBeVisible();
  await ui(elsewhere).toContainText("It appears 2 more times in your reading.");
  await ui(elsewhere.locator("mark")).toHaveText(["בָּ֖ג", "בָּ֑ג"]); await ui(elsewhere.getByRole("button", { name: "More places", exact: true })).toHaveCount(0);
  expect(await elsewhere.evaluate(node => /[A-Za-z]/.test([...node.querySelectorAll('[lang="he"]')].map(n => n.textContent).join("")))).toBe(false);
  // Same text page: the sheet moves to that word and takes focus.
  await elsewhere.getByRole("button", { name: "Go to Genesis 2:3, word 2", exact: true }).click();
  await ui(tools).toContainText("Genesis 2:3 · Word 2 of 2"); await ui(tools.getByRole("heading", { level: 4 })).toBeFocused();
  await ui(elsewhere).toContainText("It appears 2 more times in your reading."); await ui(elsewhere.getByRole("button", { name: "Go to Genesis 1:1, word 1", exact: true })).toBeVisible();
  // Another text page: the page loads and the sheet opens on that word.
  await elsewhere.getByRole("button", { name: "Go to Genesis 4:24, word 1", exact: true }).click();
  await ui(tab.locator(".study-verses").getByRole("heading", { name: "Genesis 4:24", exact: true })).toBeVisible();
  await ui(tools.getByRole("button", { name: "Word tools", exact: true })).toHaveAttribute("aria-expanded", "true");
  await ui(tools).toContainText("Genesis 4:24 · Word 1 of 2"); await ui(tools.getByRole("heading", { level: 4 })).toBeFocused();
  await ui(elsewhere.getByRole("button", { name: "Go to Genesis 1:1, word 1", exact: true })).toBeVisible();
  expect(await tab.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

it("staff switching tabs after a cross-page jump does not reopen the sheet on the old place", async () => {
  const context = await browser.newContext({ baseURL: BROWSER_ORIGIN, viewport: { width: 1440, height: 1000 }, serviceWorkers: "block", acceptDownloads: false }); contexts.push(context);
  await context.route("**/*", async route => { if (new URL(route.request().url()).origin === BROWSER_ORIGIN) await route.continue(); else await route.abort(); });
  const tab = await context.newPage(); await tab.goto("/", { waitUntil: "domcontentloaded" });
  expect(await api(tab, "/api/auth/sign-in/magic-link", { email: "pg-admin@example.test" })).toBe(200); await openAuthMail(tab, fixture.takeMail("pg-admin@example.test"));
  await tab.goto(`/workspace/admin/students/${fixture.student.id}/reading`, { waitUntil: "domcontentloaded" });
  await ui(tab.locator(".study-verses").getByRole("heading", { name: "Genesis 1:1", exact: true })).toBeVisible();
  const tools = tab.getByRole("region", { name: "Word tools", exact: true }), disclosure = tools.getByRole("button", { name: "Word tools", exact: true });
  await disclosure.click(); await ui(tools).toContainText("Genesis 1:1 · Word 1 of 2");
  await tools.getByRole("button", { name: "Go to Genesis 4:24, word 1", exact: true }).click(); await ui(tools).toContainText("Genesis 4:24 · Word 1 of 2");
  await ui(tools.getByText("Synthetic B sense", { exact: true })).toBeVisible(); await ui(tools.getByText("Solid underline: primary stress.", { exact: true })).toBeVisible();
  let details = 0; tab.on("request", request => { if (new URL(request.url()).pathname.endsWith("/study-word-details")) details++; });
  await tab.getByRole("tab", { name: "Lessons", exact: true }).click(); await ui(tools).toHaveCount(0);
  await tab.getByRole("tab", { name: "Reading", exact: true }).click();
  await ui(disclosure).toHaveAttribute("aria-expanded", "false"); await ui(tools).not.toContainText("Genesis 4:24 · Word 1 of 2"); expect(details).toBe(0);
  // Going back to the first page from the second is the same explicit jump.
  await tab.locator('.study-verses [data-verse-ref="Genesis 4:24"] [data-word-index="0"]').first().click(); await disclosure.click();
  await ui(tools).toContainText("Genesis 4:24 · Word 1 of 2"); await tools.getByRole("button", { name: "Go to Genesis 1:1, word 1", exact: true }).click();
  await ui(tools).toContainText("Genesis 1:1 · Word 1 of 2"); await ui(tab.locator(".study-verses").getByRole("heading", { name: "Genesis 1:1", exact: true })).toBeVisible();
});
