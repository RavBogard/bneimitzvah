import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { expect as ui } from "@playwright/test";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { browserFixture } from "./fixture";
import { BROWSER_ORIGIN, assertBrowserStartupAllowed, startBrowserServer } from "./server";
import { installLoopbackFetchGuard } from "./egress";
import { syntheticUiStudyPage } from "../helpers/study-ui";
import { expandReadingRanges } from "../../src/lib/readings/ranges";
import { TANAKH_VERSE_COUNTS } from "../../src/lib/readings/catalog";
import { StudyUnavailable } from "../../src/server/study/types";
import * as s from "../../src/server/db/index";
vi.mock("server-only", () => ({}));

let fixture: Awaited<ReturnType<typeof browserFixture>>, browser: Browser, stop: (() => Promise<void>) | undefined, restore: (() => void) | undefined;
let sibling: { id: string }, adminTab: Page, calls = 0, unavailable = false;
let english: "available" | "partial" | "unavailable" = "partial";
const contexts: BrowserContext[] = [], modes = new Set<string>();
async function safe<T>(action: () => Promise<T>): Promise<T> { try { return await action(); } catch { throw new Error("Study UI browser operation failed; private details withheld"); } }
async function navigate(tab: Page, path: string) { await safe(() => tab.goto(path, { waitUntil: "domcontentloaded", timeout: 30_000 })); }
async function api(tab: Page, path: string, body?: unknown) {
  return safe(() => tab.evaluate(async ({ path, body }) => {
    const response = await fetch(path, { method: body === undefined ? "GET" : "POST", body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store", headers: body === undefined ? {} : { "content-type": "application/json" } });
    return { status: response.status, data: await response.json() };
  }, { path, body }));
}
async function page(who: "admin" | "tutor" | "student", mobile = false) {
  const context = await browser.newContext({ baseURL: BROWSER_ORIGIN, serviceWorkers: "block", acceptDownloads: false, viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 } }); contexts.push(context);
  await context.route("**/*", async route => { try {
    const url = new URL(route.request().url()); if (url.origin !== BROWSER_ORIGIN) { await route.abort(); return; }
    if (url.pathname.endsWith("/study-text")) modes.add(url.searchParams.get("mode") ?? ""); await route.continue();
  } catch { await route.abort(); } });
  const tab = await context.newPage(); await navigate(tab, "/"); const email = who === "student" ? "pg-study-student@example.test" : who === "admin" ? "pg-admin@example.test" : "pg-tutor@example.test";
  expect((await api(tab, "/api/auth/sign-in/magic-link", { email })).status === 200).toBe(true); await navigate(tab, fixture.takeMail(email)); return tab;
}
async function click(tab: Page, name: string) { await safe(() => tab.getByRole("button", { name, exact: true }).click()); }
async function loaded(tab: Page, ref: string) { await ui(tab.locator(".study-verses").getByRole("heading", { name: ref, level: 4, exact: true })).toBeVisible(); }
async function capture(tab: Page, name: string) {
  if (process.env.CI) return;
  await ui(tab.locator("#workspace-main").getByRole("heading", { name: "Checking your access", level: 1, exact: true })).toBeHidden();
  await ui(tab.locator(".study-hebrew").first()).toBeVisible(); expect(await tab.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const directory = join(process.cwd(), ".impeccable", "review"); await mkdir(directory, { recursive: true });
  await safe(() => tab.screenshot({ path: join(directory, `${name}.png`), fullPage: true }));
}
beforeAll(async () => {
  try {
    assertBrowserStartupAllowed(); restore = installLoopbackFetchGuard();
    fixture = await browserFixture({ studyLoad: async request => { calls++; if (unavailable) throw new StudyUnavailable("upstream"); return syntheticUiStudyPage(request, english); } });
    sibling = (await fixture.practice()).sibling;
    const learner = await fixture.signIn("pg-study-student");
    const [member] = await fixture.ownerDb.insert(s.membership).values({ tenantId: "crc", userId: learner.id }).returning();
    const [grant] = await fixture.ownerDb.insert(s.roleGrant).values({ tenantId: "crc", membershipId: member.id, role: "student" }).returning();
    await fixture.ownerDb.insert(s.studentIdentity).values({ tenantId: "crc", studentId: fixture.student.id, roleGrantId: grant.id });
    const [adminMember] = await fixture.ownerDb.select().from(s.membership).where(eq(s.membership.userId, fixture.admin.id));
    for (const [studentId, kind, ranges] of [[fixture.student.id, "torah", ["Genesis 1:1-3"]], [fixture.student.id, "haftarah", ["Isaiah 1:1-2"]], [sibling.id, "torah", ["Genesis 2:1-2"]]] as const) {
      const [assignment] = await fixture.ownerDb.insert(s.assignment).values({ tenantId: "crc", studentId, kind, basis: "custom", ref: ranges.join("; "), status: "confirmed", setByMembershipId: adminMember.id, proposalSnapshot: { ranges: [...ranges], confirmationDate: "2027-01-02", needsReview: true } }).returning();
      await fixture.ownerDb.insert(s.assignmentVerse).values(expandReadingRanges(ranges, kind, TANAKH_VERSE_COUNTS).map((verseRef, index) => ({ tenantId: "crc", studentId, assignmentId: assignment.id, ordinal: index + 1, verseRef })));
    }
    stop = await startBrowserServer(fixture.withRuntime); browser = await chromium.launch({ headless: true });
  } catch { await browser?.close().catch(() => undefined); await stop?.().catch(() => undefined); await fixture?.close().catch(() => undefined); restore?.(); throw new Error("Study UI setup failed; private details withheld"); }
}, 120_000);
afterAll(async () => { await Promise.all(contexts.map(context => context.close().catch(() => undefined))); await browser?.close().catch(() => undefined); await stop?.().catch(() => undefined); await fixture?.close().catch(() => undefined); restore?.(); }, 120_000);

it("shows escaped structured Hebrew, qere/ketiv, paragraph and partial-English credits in all base modes without duplicate initial loads", async () => {
  adminTab = await page("admin"); const before = calls; await navigate(adminTab, `/workspace/admin/students/${fixture.student.id}/reading`); await loaded(adminTab, "Genesis 1:1"); expect(calls - before).toBe(1);
  await ui(adminTab.locator(".reading-review").first()).toContainText("Needs review");
  await ui(adminTab.locator(".assigned-study").getByText("Closed paragraph (setumah) after this verse.", { exact: true }).first()).toBeVisible();
  expect(await adminTab.locator(".study-hebrew").first().getAttribute("lang") === "he" && await adminTab.locator(".study-hebrew").first().getAttribute("dir") === "rtl").toBe(true);
  expect(await adminTab.locator(".study-english img").count()).toBe(0);
  await ui(adminTab.getByText("English reference unavailable for this verse.", { exact: true })).toBeVisible();
  await safe(() => adminTab.getByText("Text sources, licenses and changes", { exact: true }).click());
  await ui(adminTab.getByRole("link", { name: "CC-BY-SA-4.0", exact: true })).toBeVisible(); await ui(adminTab.getByRole("link", { name: "CC-BY-NC-4.0", exact: true })).toBeVisible();
  expect(await adminTab.locator(".study-credits a").evaluateAll(links => links.every(link => (link as HTMLAnchorElement).protocol === "https:" && /^(www\.sefaria\.org|he\.wikisource\.org|jps\.org|creativecommons\.org)$/.test((link as HTMLAnchorElement).hostname) && link.getAttribute("rel")?.includes("noopener")))).toBe(true);
  await capture(adminTab, "study-admin-partial-desktop");
  const tutor = await page("tutor"); await navigate(tutor, "/workspace/tutor"); await safe(() => tutor.getByLabel("Student", { exact: true }).selectOption(fixture.student.id)); await loaded(tutor, "Genesis 1:1");
  await safe(() => tutor.getByRole("link", { name: "Parent", exact: true }).click()); await safe(() => tutor.getByLabel("Child", { exact: true }).selectOption(fixture.student.id)); await loaded(tutor, "Genesis 1:1");
  expect(await tutor.getByRole("heading", { name: "Set the assigned reading", exact: true }).count()).toBe(0);
  const learner = await page("student", true); await navigate(learner, "/workspace/student"); await loaded(learner, "Genesis 1:1"); expect(await learner.getByLabel("Student", { exact: true }).count()).toBe(0);
  await safe(() => learner.evaluate(() => scrollTo(0, 0)));
  expect(await learner.locator(".study-hebrew > span").first().evaluate(span => {
    const range = document.createRange(); range.selectNodeContents(span); const bounds = range.getBoundingClientRect();
    return scrollY === 0 && bounds.top >= 0 && bounds.bottom <= innerHeight;
  })).toBe(true);
  await capture(learner, "study-student-partial-mobile");
  await click(learner, "Haftarah text"); await loaded(learner, "Isaiah 1:1"); expect(await learner.locator(".study-verses").getByRole("heading", { name: "Genesis 1:1", exact: true }).count()).toBe(0);
  await ui(learner.locator(".reading-current-assignment").getByRole("heading", { name: "Haftarah", level: 3, exact: true })).toBeVisible();
  await ui(learner.locator(".reading-current-assignment").getByText("Isaiah 1:1-2", { exact: true })).toBeVisible();
});

it("discards held old-child text after a switch, keeps another tab independent, and clears text after relationship revocation", async () => {
  const tab = await page("tutor", true); await navigate(tab, "/workspace/parent"); await safe(() => tab.getByLabel("Child", { exact: true }).selectOption(fixture.student.id)); await click(tab, "Enter child practice"); await loaded(tab, "Genesis 1:1");
  const other = await tab.context().newPage(); await navigate(other, "/workspace/parent"); await safe(() => other.getByLabel("Child", { exact: true }).selectOption(fixture.student.id)); await click(other, "Enter child practice"); await loaded(other, "Genesis 1:1");
  const pattern = new RegExp(`/api/students/${fixture.student.id}/study-text\\?`); let release!: () => void, held = false; const gate = new Promise<void>(resolve => { release = resolve; });
  await tab.route(pattern, async route => { const response = await route.fetch(); held = true; await gate; await route.fulfill({ response }).catch(() => undefined); });
  await click(tab, "Refresh reading"); await ui.poll(() => held).toBe(true);
  try { await click(tab, "Switch practice to Synthetic Sibling"); await loaded(tab, "Genesis 2:1"); } finally { release(); }
  await tab.unroute(pattern); expect(await tab.locator(".study-verses").getByRole("heading", { name: "Genesis 1:1", exact: true }).count()).toBe(0);
  await capture(tab, "study-child-sibling-mobile");
  const relationships = await api(adminTab, `/api/admin/students/${sibling.id}/relationships`);
  const guardian = relationships.data.guardians[0]; expect(Boolean(guardian)).toBe(true);
  expect((await api(adminTab, `/api/admin/students/${sibling.id}/relationships/guardians/${guardian.id}/revoke`, { expectedState: "active" })).status === 200).toBe(true);
  await click(tab, "Refresh reading"); await ui(tab.getByLabel("Child", { exact: true })).toBeVisible(); expect(await tab.locator(".study-verses").count()).toBe(0);
  await safe(() => other.evaluate(() => window.dispatchEvent(new Event("focus")))); await loaded(other, "Genesis 1:1");
  expect(modes.size === 5 && [...modes].every(mode => ["student", "parent", "tutor", "admin", "child-practice"].includes(mode))).toBe(true);
});

it("preserves staff drafts, explicit paging and same-session text revalidation while rejecting stale responses and clearing on expired session", async () => {
  const tab = await page("admin"); await navigate(tab, `/workspace/admin/students/${fixture.student.id}/reading`); await loaded(tab, "Genesis 1:1");
  await safe(() => tab.getByLabel("Selection method", { exact: true }).selectOption("custom")); await safe(() => tab.getByLabel("Custom verse ranges", { exact: true }).fill("Genesis 1:4-5"));
  unavailable = true; await click(tab, "Refresh reading"); await ui(tab.getByRole("heading", { name: "Text unavailable", level: 4, exact: true })).toBeVisible();
  await ui(tab.getByLabel("Custom verse ranges", { exact: true })).toHaveValue("Genesis 1:4-5"); expect(await tab.locator(".study-hebrew").count()).toBe(0);
  unavailable = false; english = "unavailable"; await click(tab, "Reload assigned text"); await loaded(tab, "Genesis 1:1"); await capture(tab, "study-english-unavailable-desktop"); english = "partial";
  const prepared = await api(tab, `/api/students/${fixture.student.id}/reading/prepare`, { mode: "admin", ranges: ["Genesis 1:1-4:24"] }); expect(prepared.status === 200 && prepared.data.status === "prepared").toBe(true);
  expect((await api(tab, `/api/students/${fixture.student.id}/reading/confirm`, { mode: "admin", binding: prepared.data.binding })).status === 200).toBe(true);
  await click(tab, "Refresh reading"); await ui(tab.locator(".study-verses > li")).toHaveCount(100);
  const beforeNext = calls; await click(tab, "Next text page"); await ui(tab.locator(".study-verses > li")).toHaveCount(4); expect(calls - beforeNext).toBe(1);
  let release!: () => void, held = false; const gate = new Promise<void>(resolve => { release = resolve; });
  await tab.route("**/study-text?**", async route => { const response = await route.fetch(); held = true; await gate; await route.fulfill({ response }).catch(() => undefined); });
  try {
    await safe(() => tab.evaluate(() => window.dispatchEvent(new Event("focus")))); await ui.poll(() => held).toBe(true);
    await ui(tab.locator("#workspace-main").getByRole("heading", { name: "Checking your access", level: 1, exact: true })).toBeVisible(); await ui(tab.locator(".study-verses")).toBeHidden();
  } finally { release(); }
  await ui(tab.locator(".study-verses")).toBeVisible(); await ui(tab.locator(".study-verses > li")).toHaveCount(4); await tab.unroute("**/study-text?**");
  await ui(tab.getByLabel("Custom verse ranges", { exact: true })).toHaveValue("Genesis 1:4-5");
  const replacement = await api(tab, `/api/students/${fixture.student.id}/reading/prepare`, { mode: "admin", ranges: ["Genesis 2:1-2"] });
  expect(replacement.status === 200 && replacement.data.status === "prepared").toBe(true);
  expect((await api(tab, `/api/students/${fixture.student.id}/reading/confirm`, { mode: "admin", binding: replacement.data.binding })).status === 200).toBe(true);
  await click(tab, "Previous text page"); await ui(tab.getByRole("heading", { name: "Assignment changed", level: 4, exact: true })).toBeVisible();
  expect(await tab.locator(".study-hebrew").count()).toBe(0);
  await click(tab, "Refresh reading and text"); await loaded(tab, "Genesis 2:1"); await ui(tab.locator(".study-verses > li")).toHaveCount(2);
  await ui(tab.getByRole("button", { name: "Previous text page", exact: true })).toBeDisabled();
  await ui(tab.getByLabel("Custom verse ranges", { exact: true })).toHaveValue("Genesis 1:4-5");
  await fixture.ownerDb.update(s.session).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(s.session.userId, fixture.admin.id));
  await safe(() => tab.evaluate(() => window.dispatchEvent(new Event("focus")))); await ui(tab.getByRole("heading", { name: "Sign in to continue", level: 1, exact: true })).toBeVisible(); expect(await tab.locator(".study-hebrew").count()).toBe(0);
});
