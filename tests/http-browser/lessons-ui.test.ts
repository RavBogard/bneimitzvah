import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { expect as ui } from "@playwright/test";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { isolatedEnv } from "../helpers/isolatedEnv.mjs";
import { browserFixture } from "./fixture";
import { BROWSER_ORIGIN, assertBrowserStartupAllowed, startBrowserServer } from "./server";
import { installLoopbackFetchGuard } from "./egress";
import { openAuthMail } from "./auth-navigation";
import * as s from "../../src/server/db/index";
vi.mock("server-only", () => ({}));

let fixture: Awaited<ReturnType<typeof browserFixture>>, browser: Browser, stop: (() => Promise<void>) | undefined, restore: (() => void) | undefined;
let isolation: Awaited<ReturnType<typeof isolatedEnv>> | undefined;
const contexts: BrowserContext[] = [], cookies = new Map<string, Awaited<ReturnType<BrowserContext["cookies"]>>>();
const safe = async <T>(action: () => Promise<T>): Promise<T> => { try { return await action(); } catch { throw new Error("Lesson UI browser operation failed; private details withheld"); } };
async function api(tab: Page, path: string, body?: unknown) {
  return safe(() => tab.evaluate(async ({ path, body }) => { const response = await fetch(path, { method: body === undefined ? "GET" : "POST", cache: "no-store", headers: body === undefined ? {} : { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: response.status, data: await response.json() }; }, { path, body }));
}
async function page(role: "tutor" | "student", mobile = false) {
  const context = await browser.newContext({ baseURL: BROWSER_ORIGIN, serviceWorkers: "block", acceptDownloads: false, viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 } }); contexts.push(context);
  await context.route("**/*", async route => { try { if (new URL(route.request().url()).origin === BROWSER_ORIGIN) await route.continue(); else await route.abort(); } catch { await route.abort(); } });
  const saved = cookies.get(role); if (saved) await context.addCookies(saved);
  const tab = await context.newPage(); await safe(() => tab.goto("/", { waitUntil: "domcontentloaded" }));
  if (!saved) {
    const email = role === "tutor" ? "pg-tutor@example.test" : "pg-lesson-student@example.test";
    expect((await api(tab, "/api/auth/sign-in/magic-link", { email })).status).toBe(200);
    await openAuthMail(tab, fixture.takeMail(email)); cookies.set(role, await context.cookies());
  }
  return tab;
}
/** The tutor account also holds the fixture's parent role, so one sign-in covers both views. */
async function workspace(tab: Page, role: "tutor" | "student" | "parent") {
  await safe(() => tab.goto(`/workspace/${role}`, { waitUntil: "domcontentloaded" }));
  if (role !== "student") await safe(() => tab.getByLabel(role === "parent" ? "Child" : "Student", { exact: true }).locator(`[data-student-id="${fixture.student.id}"]`).click());
  await ui(tab.locator(".reading-hero")).toBeVisible();
}
const lessons = (tab: Page) => tab.locator(".lesson-log");
const sheet = (tab: Page) => tab.locator("dialog.lesson-sheet");
const entry = (tab: Page, text: string) => lessons(tab).locator(".lesson-entry").filter({ hasText: text });
const editButton = (tab: Page, text: string) => entry(tab, text).getByRole("button", { name: /^Edit lesson from / });
async function lessonTab(tab: Page) {
  await safe(() => tab.getByRole("tab", { name: "Lessons", exact: true }).click());
  await ui(lessons(tab).getByRole("button", { name: "Add lesson note", exact: true })).toBeEnabled();
}
async function write(tab: Page, text: string, date?: string) {
  if (date) await safe(() => sheet(tab).getByLabel("Lesson date", { exact: true }).fill(date));
  await safe(() => sheet(tab).getByLabel("What you worked on", { exact: true }).fill(text));
}
const save = (tab: Page) => safe(() => sheet(tab).getByRole("button", { name: "Save lesson", exact: true }).click());
type Entry = { entryId: string; lessonDate: string; summary: string; version: number; canEdit: boolean; canDelete: boolean };
async function stored(tab: Page, mode = "tutor") {
  const result = await api(tab, `/api/students/${fixture.student.id}/lesson-log?mode=${mode}`); expect(result.status).toBe(200);
  return result.data.entries as Entry[];
}
async function capture(tab: Page, name: string) {
  if (process.env.CI) return;
  const folder = join(process.cwd(), ".impeccable", "review"); await mkdir(folder, { recursive: true });
  await safe(() => tab.evaluate(async () => { await document.fonts.ready; await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); }));
  expect(await tab.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await safe(() => tab.screenshot({ path: join(folder, `lessons-${name}.png`) }));
}
const today = () => { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`; };

beforeAll(async () => {
  try {
    assertBrowserStartupAllowed(); restore = installLoopbackFetchGuard();
    fixture = await browserFixture();
    const learner = await fixture.signIn("pg-lesson-student"), [member] = await fixture.ownerDb.insert(s.membership).values({ tenantId: "crc", userId: learner.id }).returning();
    const [grant] = await fixture.ownerDb.insert(s.roleGrant).values({ tenantId: "crc", membershipId: member.id, role: "student" }).returning();
    await fixture.ownerDb.insert(s.studentIdentity).values({ tenantId: "crc", studentId: fixture.student.id, roleGrantId: grant.id });
    stop = await startBrowserServer(fixture.withRuntime); isolation = await isolatedEnv(); browser = await chromium.launch({ headless: true, env: isolation.env });
  } catch { await browser?.close().catch(() => undefined); await isolation?.cleanup(); await stop?.().catch(() => undefined); await fixture?.close().catch(() => undefined); restore?.(); throw new Error("Lesson UI setup failed; private details withheld"); }
}, 120_000);
afterAll(async () => { await Promise.all(contexts.map(context => context.close().catch(() => undefined))); await browser?.close().catch(() => undefined); await isolation?.cleanup(); await stop?.().catch(() => undefined); await fixture?.close().catch(() => undefined); restore?.(); }, 120_000);

it("lets a tutor add, edit and delete lessons, keeps an unsaved note, shows a change made elsewhere instead of overwriting it, and gives the family a read-only list", async () => {
  const tutor = await page("tutor"); await workspace(tutor, "tutor"); await lessonTab(tutor);
  await ui(lessons(tutor).getByText("No lessons yet", { exact: true })).toBeVisible();

  // Add: today's date is filled in, and the tutor is told the family reads this.
  await safe(() => lessons(tutor).getByRole("button", { name: "Add lesson note", exact: true }).click());
  await ui(sheet(tutor).getByRole("heading", { name: "Add lesson note", exact: true })).toBeVisible();
  await ui(sheet(tutor).getByLabel("Lesson date", { exact: true })).toHaveValue(today());
  await ui(sheet(tutor).getByText("The student and their family can read this.", { exact: true })).toBeVisible();
  await ui(sheet(tutor).getByLabel("What you worked on", { exact: true })).toBeFocused();
  await write(tutor, "Synthetic lesson: chanted the first verse.\nNext time: verse two.");
  await capture(tutor, "tutor-sheet-desktop");
  await save(tutor);
  await ui(sheet(tutor)).toBeHidden();
  await ui(lessons(tutor).locator(".lesson-log-notice[role=status]")).toHaveText("Lesson added.");
  await ui(entry(tutor, "Synthetic lesson: chanted the first verse.")).toBeVisible();
  let rows = await stored(tutor);
  expect(rows.map(row => [row.lessonDate, row.summary, row.version, row.canEdit, row.canDelete])).toEqual([[today(), "Synthetic lesson: chanted the first verse.\nNext time: verse two.", 1, true, true]]);

  // An unsaved note asks before it is thrown away.
  await safe(() => lessons(tutor).getByRole("button", { name: "Add lesson note", exact: true }).click());
  await write(tutor, "Synthetic unsaved note.");
  await safe(() => sheet(tutor).getByRole("button", { name: "Close lesson note", exact: true }).click());
  const prompt = tutor.locator("dialog.work-departure").filter({ hasText: "Keep this lesson note?" });
  await ui(prompt).toBeVisible();
  await safe(() => prompt.getByRole("button", { name: "Keep writing", exact: true }).click());
  await ui(sheet(tutor).getByLabel("What you worked on", { exact: true })).toHaveValue("Synthetic unsaved note.");
  // Escape twice (the second can close a dialog without a cancel event) still returns to the note.
  await safe(() => tutor.keyboard.press("Escape")); await ui(prompt).toBeVisible();
  await safe(() => tutor.keyboard.press("Escape")); await ui(prompt).toBeHidden();
  await ui(sheet(tutor).getByLabel("What you worked on", { exact: true })).toHaveValue("Synthetic unsaved note.");
  // A routine access check (window focus) keeps the note.
  await safe(() => tutor.evaluate(() => window.dispatchEvent(new Event("focus"))));
  await ui(lessons(tutor).locator(".lesson-entry")).toHaveCount(1);
  await ui(sheet(tutor).getByLabel("What you worked on", { exact: true })).toHaveValue("Synthetic unsaved note.");
  await ui(sheet(tutor).getByLabel("What you worked on", { exact: true })).toBeEnabled();
  await safe(() => sheet(tutor).getByRole("button", { name: "Close lesson note", exact: true }).click());
  await safe(() => prompt.getByRole("button", { name: "Discard note", exact: true }).click());
  await ui(sheet(tutor)).toBeHidden();
  expect((await stored(tutor)).length).toBe(1);

  // Edit.
  await ui(editButton(tutor, "Synthetic lesson")).toHaveAccessibleName(/^Edit lesson from \w{3}, \w{3} \d+: Synthetic lesson: chanted the first vers$/);
  await safe(() => editButton(tutor, "Synthetic lesson").click());
  await ui(sheet(tutor).getByRole("heading", { name: "Edit lesson note", exact: true })).toBeVisible();
  await write(tutor, "Synthetic lesson: chanted verses one and two.");
  await save(tutor);
  await ui(lessons(tutor).locator(".lesson-log-notice[role=status]")).toHaveText("Lesson updated.");
  rows = await stored(tutor); expect(rows.map(row => [row.summary, row.version])).toEqual([["Synthetic lesson: chanted verses one and two.", 2]]);

  // A change made elsewhere while the sheet is open is shown, not overwritten.
  await safe(() => editButton(tutor, "Synthetic lesson").click());
  const elsewhere = await api(tutor, `/api/students/${fixture.student.id}/lesson-log/${rows[0].entryId}/edit`, { mode: "tutor", expectedVersion: 2, lessonDate: rows[0].lessonDate, summary: "Synthetic change from another tab." });
  expect(elsewhere.status).toBe(200);
  await write(tutor, "Synthetic lesson: all three verses.");
  await save(tutor);
  await ui(sheet(tutor).getByRole("status")).toHaveText("This lesson was changed somewhere else. Its latest version is shown below. Save to replace it with your text.");
  await ui(sheet(tutor).locator(".lesson-latest")).toContainText("Synthetic change from another tab.");
  await ui(sheet(tutor).getByLabel("What you worked on", { exact: true })).toHaveValue("Synthetic lesson: all three verses.");
  rows = await stored(tutor); expect(rows.map(row => [row.summary, row.version])).toEqual([["Synthetic change from another tab.", 3]]);
  await capture(tutor, "tutor-conflict-desktop");
  await save(tutor);
  await ui(lessons(tutor).locator(".lesson-log-notice[role=status]")).toHaveText("Lesson updated.");
  rows = await stored(tutor); expect(rows.map(row => [row.summary, row.version])).toEqual([["Synthetic lesson: all three verses.", 4]]);

  // A second, earlier lesson, then deleting it after confirming.
  await safe(() => lessons(tutor).getByRole("button", { name: "Add lesson note", exact: true }).click());
  await write(tutor, "Synthetic earlier lesson to delete.", "2026-09-03");
  await save(tutor);
  await ui(lessons(tutor).locator(".lesson-entry")).toHaveCount(2);
  await ui(lessons(tutor).locator(".lesson-entry").nth(1)).toContainText("Synthetic earlier lesson to delete.");
  await capture(tutor, "tutor-list-desktop");
  await safe(() => editButton(tutor, "Synthetic earlier lesson to delete.").click());
  await safe(() => sheet(tutor).getByRole("button", { name: "Delete lesson", exact: true }).click());
  await ui(sheet(tutor).getByRole("button", { name: "Keep it", exact: true })).toBeFocused();
  await ui(sheet(tutor).getByRole("group", { name: "Delete this lesson note? It can’t be brought back." })).toBeVisible();
  await safe(() => sheet(tutor).getByRole("button", { name: "Delete", exact: true }).click());
  await ui(lessons(tutor).locator(".lesson-log-notice[role=status]")).toHaveText("Lesson deleted.");
  await ui(lessons(tutor).locator(".lesson-entry")).toHaveCount(1);
  rows = await stored(tutor); expect(rows.map(row => row.summary)).toEqual(["Synthetic lesson: all three verses."]);

  // The family reads the same list, with nothing to change.
  const parent = await page("tutor", true); await workspace(parent, "parent");
  await ui(lessons(parent).getByRole("heading", { name: "Lesson notes", exact: true })).toBeVisible();
  await ui(entry(parent, "Synthetic lesson: all three verses.")).toBeVisible();
  expect(await lessons(parent).getByRole("button").count()).toBe(0);
  const parentRows = await stored(parent, "parent"); expect(parentRows.map(row => [row.canEdit, row.canDelete])).toEqual([[false, false]]);
  const student = await page("student", true); await workspace(student, "student");
  await ui(entry(student, "Synthetic lesson: all three verses.")).toBeVisible();
  expect(await lessons(student).getByRole("button").count()).toBe(0);
  await safe(() => lessons(student).scrollIntoViewIfNeeded());
  await capture(student, "student-mobile");
}, 180_000);

it("checks what really saved when a save's answer is lost, so retrying never adds a lesson twice", async () => {
  const tutor = await page("tutor"); await workspace(tutor, "tutor"); await lessonTab(tutor);
  const before = (await stored(tutor)).length;

  // The request never reaches the server: nothing is listed, so the tutor is asked to save again.
  await tutor.route("**/lesson-log", async route => { if (route.request().method() === "POST") await route.abort(); else await route.continue(); });
  await safe(() => lessons(tutor).getByRole("button", { name: "Add lesson note", exact: true }).click());
  await write(tutor, "Synthetic lesson with a lost answer.");
  await save(tutor);
  await ui(sheet(tutor).getByRole("status")).toHaveText("That lesson may not have saved. Save again; it won’t be added twice.");
  expect((await stored(tutor)).length).toBe(before);

  // The request reaches the server but its answer is lost: the list shows it saved, once.
  await tutor.unroute("**/lesson-log");
  await tutor.route("**/lesson-log", async route => { if (route.request().method() === "POST") { await route.fetch(); await route.abort(); } else await route.continue(); });
  await save(tutor);
  await ui(lessons(tutor).locator(".lesson-log-notice[role=status]")).toHaveText("Lesson added.");
  await tutor.unroute("**/lesson-log");
  const rows = await stored(tutor);
  expect(rows.filter(row => row.summary === "Synthetic lesson with a lost answer.").map(row => row.version)).toEqual([1]);
  expect(rows.length).toBe(before + 1);
}, 120_000);
