import { expect, test, type Page } from "@playwright/test";
import { sourceSefariaUrl } from "../src/lib/readings/shelf";
import { studyRangePlan } from "../src/components/portal/workspace/study/api";
import { studyEditions } from "../src/components/portal/workspace/study/credits";
import { FULL, mockVayera, VAYERA, VAYERA_DATE, verseOf, versesOf } from "./aliyot-fixture";

// Release 1.9 N7 exit tests on the built, unconfigured production server: Vayera's portion summary (approved only, with its credit), its outline going to each
// aliyah, and the Sources column (a laptop) or button (a phone). Every answer is a synthetic route fulfilment: invented summary lines, invented sources
// and syllables for the verses; no verse, translation or real summary anywhere.
test.beforeEach(async ({ page }) => { await page.clock.setFixedTime(new Date("2026-10-21T15:00:00Z")); });
const week = `/read?date=${VAYERA_DATE}&lens=study`;
const CREDIT = "Rabbi Daniel Bogard";
const summary = (approved: boolean) => ({ reading: "vayera", summary: approved ? {
  reading: "vayera", revision: 1, credit: CREDIT, approvedAt: "2026-10-24T12:00:00.000Z",
  summary: "A synthetic overview of a made-up portion, in two plain sentences. **A made-up emphasis.**\n\nA second made-up paragraph.",
  outline: [1, 2, 3, 4, 5, 6, 7].map(aliyah => ({ aliyah, line: `Synthetic outline line for aliyah ${aliyah}` })) } : null });
const HE = "Synthetic Hebrew Edition";
const discussions = (q: URLSearchParams) => ({ ref: q.get("ref"), kind: q.get("kind"), productName: "Synthetic Portal", complete: true, truncated: false,
  discussions: [{ slug: "synthetic-question", title: "A synthetic question", kind: "torah", revision: 1, updatedAt: "2026-10-24T00:00:00.000Z", anchors: ["Genesis 18:2", "Genesis 19:22"],
    sources: [["Synthetic Midrash 1:1", "Genesis 18:2"], ["Synthetic Midrash 2:2", "Genesis 19:22"]].map(([ref, anchorRef], at) => ({ position: at + 1, ref, anchorRef, kind: "translation",
      credit: "Claude translation for Synthetic Portal", translation: { body: `Synthetic translated line ${at + 1}.`, originalEdition: HE }, sefariaUrl: sourceSefariaUrl(ref, { language: "he", title: HE }),
      details: { selectedBy: "Selected by Rabbi Synthetic" }, text: null })) }] });
/** The Vayera fixture plus this milestone's two answers (a route registered later wins over the fixture's). */
async function mock(page: Page, options: { summary?: "approved" | "draft" | "failed"; discussions?: boolean; aliyot?: "ok" | "none" } = {}) {
  await mockVayera(page, { mode: options.aliyot ?? "ok" });
  const asked: string[] = [];
  await page.route("**/api/public/portion-summary*", route => {
    asked.push(new URL(route.request().url()).search);
    if (options.summary === "failed") return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "unavailable" }) });
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(summary(options.summary !== "draft")) });
  });
  if (options.discussions !== false) await page.route("**/api/public/discussions*", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(discussions(new URL(route.request().url()).searchParams)) }));
  return asked;
}
// Study v6 (2026-10-28): the approved summary is shown in the About card (same card as the guide's overview), never as a block of its own.
const block = (page: Page) => page.locator('[data-study-about="summary"]');
const tab = (page: Page, name: string) => page.getByRole("tablist", { name: "Reading sections" }).getByRole("tab", { name, exact: true });
const firstVerse = (page: Page) => page.locator("[data-study-rows] [data-verse-ref]").first();
const wide = (page: Page) => (page.viewportSize()?.width ?? 0) >= 1180;

test("Vayera with an approved summary shows it in the About card atop Study, with the stamped credit and Read more", async ({ page }) => {
  const asked = await mock(page);
  await page.goto(week);
  await expect(firstVerse(page)).toBeVisible();
  await expect(block(page)).toBeVisible();
  await expect(block(page).getByRole("heading", { name: "About this portion" })).toBeVisible();
  await expect(block(page).getByText("A synthetic overview of a made-up portion, in two plain sentences.")).toBeVisible();
  await expect(block(page).locator("strong", { hasText: "A made-up emphasis." })).toBeVisible();
  await expect(block(page).locator("[data-portion-summary-credit]")).toHaveText(CREDIT);
  await expect(block(page).getByRole("button", { name: "Read more" })).toBeVisible();
  // No outline and no old block: the card is the one overview.
  await expect(page.locator("[data-portion-summary], [data-portion-outline]")).toHaveCount(0);
  // Atop Study: above the first verse; the page asked for the parashah's summary by its slug, and only once.
  const above = (await block(page).boundingBox())!.y < (await firstVerse(page).boundingBox())!.y;
  expect(above).toBe(true);
  expect(asked).toEqual(["?reading=vayera"]);
  // Lein is for chanting: the summary is Study's.
  await page.goto(`/read?date=${VAYERA_DATE}`);
  await expect(page.locator(".study-verses [data-verse-ref]").first()).toBeVisible();
  await expect(block(page)).toHaveCount(0);
});

test("a parashah with no approved summary (a draft is never served) shows no card, no heading and no placeholder", async ({ page }) => {
  for (const options of [{ summary: "draft" }, { summary: "failed" }] as const) {
    await page.unrouteAll({ behavior: "ignoreErrors" });
    await mock(page, options);
    await page.goto(week);
    await expect(firstVerse(page)).toBeVisible();
    await expect(page.getByText("About this portion")).toHaveCount(0);
    await expect(page.locator("[data-study-about], [data-portion-summary-credit]")).toHaveCount(0);
  }
});

test("the sources close the page, at every width, and open at their verse; there is no Sources button in the tool row", async ({ page }) => {
  await mock(page);
  await page.goto(week);
  await expect(firstVerse(page)).toBeVisible();
  await expect(page.locator("[data-sources-open], [data-sources-column]")).toHaveCount(0);
  await expect(page.getByTestId("study-toolbar").getByRole("button", { name: /Sources/ })).toHaveCount(0);
  const list = page.locator("[data-sources-rail]");
  await list.scrollIntoViewIfNeeded();
  await expect(list.getByRole("heading", { name: "Sources", exact: true })).toBeVisible();
  // After the last verse, not beside or among them.
  const last = (await page.locator("[data-study-rows] article[data-verse-ref]").last().boundingBox())!, listBox = (await list.boundingBox())!;
  expect(listBox.y).toBeGreaterThanOrEqual(last.y + last.height - 1);
  await expect(list.getByText("A synthetic question")).toBeVisible();
  const entry = list.getByRole("button", { name: "Synthetic Midrash 2:2" });
  expect((await entry.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await entry.click();
  const panel = page.getByRole("dialog", { name: "Sources on this verse · Genesis 19:22" });
  await expect(panel).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await expect(panel.getByText("Claude translation for Synthetic Portal")).toBeVisible();
  await panel.getByRole("button", { name: "Back to this verse" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator('[data-study-rows] [data-verse-ref="Genesis 19:22"]')).toBeFocused();
  // Esc from a source returns to the entry that opened it.
  const other = list.getByRole("button", { name: "Synthetic Midrash 1:1" });
  await other.click();
  await page.keyboard.press("Escape");
  await expect(other).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("on a laptop the notes column stands to the right of the verses and the Hebrew keeps its size", async ({ page }) => {
  test.skip(!wide(page), "a laptop-width project");
  await mock(page);
  await page.goto(week);
  await expect(firstVerse(page)).toBeVisible();
  const size = () => page.locator("[data-study-rows] [data-word-index]").first().evaluate(node => parseFloat(getComputedStyle(node).fontSize));
  // The Hebrew is the size setting's own (Standard is 2rem).
  expect(await size()).toBe(32);
  // Beside, not over: where the reading has entries the column starts to the right of every verse's right edge, and the verses are still wide enough to read.
  const column = page.locator("[data-study-rail]");
  if (await column.count()) {
    const columnBox = (await column.boundingBox())!;
    for (const row of await page.locator("[data-study-rows] article[data-verse-ref]").all()) {
      const verse = (await row.boundingBox())!;
      expect(verse.x + verse.width).toBeLessThanOrEqual(columnBox.x + 1);
      expect(verse.width).toBeGreaterThan(320);
    }
  }
  // The same without any discussions.
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await mock(page, { discussions: false });
  await page.goto(week);
  await expect(firstVerse(page)).toBeVisible();
  await expect(page.locator("[data-sources-rail]")).toHaveCount(0);
  expect(await size()).toBe(32);
});

// A signed-in student's own Study: the same block, over the confirmed reading (synthetic session, student, reading and text pages).
const SID = "11111111-1111-4111-8111-111111111111", TID = "33333333-3333-4333-8333-333333333333", binding = "A".repeat(43);
const STARTS = ["Genesis 18:15", "Genesis 19:1", "Genesis 19:21", "Genesis 21:5", "Genesis 21:22", "Genesis 22:1"];
const SOURCE = { status: "available", fetchedAt: 0, date: "2026-10-31", calendar: "diaspora", attribution: { name: "Hebcal", url: "https://www.hebcal.com/" } };
const reply = (body: unknown, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });
async function workspace(page: Page, options: { starts?: string[] | null; summary?: "approved" | "draft" } = {}) {
  const ranges = [VAYERA], list = versesOf(VAYERA), student = { id: SID, firstName: "Noa", lastName: "Synthetic", ceremonyDate: "2026-12-12", revision: 1, rehearsal1: "2026-10-17", rehearsal2: "2026-11-07" };
  await page.route("**/api/**", route => route.fulfill(reply({}, 503)));
  await page.route("**/api/session", route => route.fulfill(reply({ membershipAvailable: true, roles: ["student"], saved: true, approver: false, sessionBinding: binding })));
  await page.route("**/api/students?*", route => route.fulfill(reply({ students: [student] })));
  const readings = [{ id: TID, status: "confirmed", kind: "torah", basis: "triennial", revision: 1, ranges, verses: list, confirmationDate: null, needsReview: false, source: SOURCE,
    aliyahStarts: options.starts === undefined ? STARTS : options.starts, readingKey: "vayera" }];
  await page.route("**/api/students/*/reading?*", route => route.fulfill(reply({ student, mode: "student", context: null, readings, referenceListeningEnabled: false })));
  await page.route("**/api/students/*/study-text?*", route => {
    const q = new URL(route.request().url()).searchParams, offset = Number(q.get("offset") ?? "0"), plan = studyRangePlan(ranges, "torah", offset);
    return route.fulfill(reply({ studentId: SID, studentRevision: 1, mode: "student", context: null, assignment: { id: TID, revision: 1, kind: "torah", needsReview: false }, offset, nextOffset: plan.nextOffset, totalVerses: list.length,
      translation: { key: "jps2023", status: "available" }, verses: plan.refs.map(ref => verseOf(ref, list.indexOf(ref))),
      chapters: plan.chapters.map(chapter => ({ ref: chapter.ref, sefariaUrl: chapter.url, fetchedAt: 0, hash: "c".repeat(64), editions: [studyEditions.mam, studyEditions.jps2023] })) }));
  });
  await page.route("**/api/public/portion-summary*", route => route.fulfill(reply(summary(options.summary !== "draft"))));
  await page.route("**/api/public/discussions*", route => route.fulfill(reply(discussions(new URL(route.request().url()).searchParams))));
}
test.describe("a student's own Study", () => {
  test.use({ timezoneId: "America/Chicago" });
  test("with no guide overview the About card shows the approved summary with its credit, and the sources close the page", async ({ page }) => {
    await workspace(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/workspace/student?tab=reading");
    await page.getByRole("group", { name: "Reading lens" }).getByRole("button", { name: "Study", exact: true }).click();
    await expect(block(page)).toBeVisible();
    await expect(block(page).locator("[data-portion-summary-credit]")).toHaveText(CREDIT);
    await expect(block(page).getByRole("heading", { name: "About this portion" })).toBeVisible();
    await expect(page.locator("[data-study-about]")).toHaveCount(1);
    await expect(page.locator("[data-sources-rail]")).toBeVisible();
  });
  test("a draft shows no card at all", async ({ page }) => {
    await workspace(page, { summary: "draft" });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/workspace/student?tab=reading");
    await page.getByRole("group", { name: "Reading lens" }).getByRole("button", { name: "Study", exact: true }).click();
    await expect(page.locator("[data-study-rows] [data-verse-ref]").first()).toBeVisible();
    await expect(page.locator("[data-study-about]")).toHaveCount(0);
  });
});
