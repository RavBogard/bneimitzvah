import { expect, test, type Page, type Route } from "@playwright/test";
import { studyRangePlan } from "../src/components/portal/workspace/study/api";
import { studyEditions } from "../src/components/portal/workspace/study/credits";
import { TANAKH_VERSE_COUNTS } from "../src/lib/readings/catalog";
import { expandReadingRanges } from "../src/lib/readings/ranges";

// Release 1.7 Choose verses, Change verses and Whole portion in the built, unconfigured production server. The session, readings and saved-readings
// answers are synthetic route fulfilments, so the page's own client code is under test. Vayeilech (a short parashah) stands in; invented names only.
const PORTION = "Deuteronomy 31:1-30";
const json = (route: Route, status: number, body: unknown) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
const syllables = ["אָבָ֑ג", "דֵּ֖ה", "וְזַ֥ח"];
const verseOf = (ref: string) => { const text = `${syllables.join(" ")}׃`; return { ref, english: `Synthetic translation ${ref}`, hebrew: { text, readingText: text, paragraphAfter: null, segments: [{ kind: "text", text }] } }; };
const verses = (ref: string) => expandReadingRanges(ref.split("; "), "torah", TANAKH_VERSE_COUNTS);
const base = { id: "00000000-0000-4000-8000-000000000042", name: "Synthetic selection", date: null as string | null, kind: "torah", ranges: "Deuteronomy 31:1-3; Deuteronomy 31:8-9", verseCount: 5, revision: 1,
  createdAt: "2026-10-22T00:00:00.000Z", updatedAt: "2026-10-22T00:00:00.000Z" };
const readingOf = (ranges: string, revision: number) => ({ ...base, ranges, verseCount: verses(ranges).length, revision });

/** The open routes for any ref of the Torah, from its own verses (one text page: at most 30 here). */
async function openRoutes(page: Page) {
  await page.route("**/api/public/**", route => {
    const url = new URL(route.request().url()), q = url.searchParams, ref = q.get("ref");
    if (!ref || q.get("kind") !== "torah") return json(route, 503, { error: "unavailable" });
    const list = verses(ref);
    if (url.pathname === "/api/public/reading")
      return json(route, 200, { ref, kind: "torah", passage: { kind: "torah", ranges: ref.split("; "), verseCount: list.length, pages: [{ offset: 0, first: list[0], last: list.at(-1) }] }, listening: { pocketTorah: false } });
    if (url.pathname === "/api/public/text")
      return json(route, 200, { kind: "torah", ref, offset: 0, nextOffset: null, totalVerses: list.length, translation: { key: "jps2023", status: "available" }, verses: list.map(verseOf),
        chapters: studyRangePlan(ref.split("; "), "torah", 0).chapters.map(chapter => ({ ref: chapter.ref, sefariaUrl: chapter.url, fetchedAt: 0, hash: "c".repeat(64), editions: [studyEditions.mam, studyEditions.jps2023] })) });
    return json(route, 503, { error: "unavailable" });
  });
}
const pageOf = (reading: typeof base) => { const list = verses(reading.ranges).slice(0, 10);
  return { ok: true, reading, offset: 0, totalVerses: reading.verseCount, nextOffset: reading.verseCount > 10 ? 10 : null, verses: list.map(ref => ({ ref, translation: null, note: null, mark: null })) }; };
const bar = (page: Page) => page.locator("[data-choose-bar]");
const line = (page: Page) => bar(page).locator("[data-choose-line]");
const verse = (page: Page, number: number) => page.getByRole("button", { name: `Select Deuteronomy 31:${number}`, exact: true });

async function minSize(page: Page, locators: ReturnType<Page["getByRole"]>[]) {
  for (const locator of locators) { const box = await locator.first().boundingBox(); expect(box && box.height >= 44 && box.width >= 44, "at least 44px").toBe(true); }
}

test("choose verses from the text, separated groups with the live count, then save the selection as a new reading", async ({ page }) => {
  // This browser was seen signed in, so Save asks when pressed (N20); signed out from the start it is Sign in to save (sign-in-return.spec.ts).
  await page.addInitScript(() => { try { localStorage.setItem("crc-torah:signed-in/v1", "1"); } catch { /* none */ } });
  await openRoutes(page);
  const posted: unknown[] = [];
  await page.route("**/api/saved/readings", route => json(route, 200, { ok: true, readings: [] }));
  await page.route("**/api/saved/readings/create", route => { posted.push(route.request().postDataJSON()); return json(route, 200, { ok: true, reading: base }); });
  await page.goto(`/read?ref=${encodeURIComponent(PORTION)}&kind=torah`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("button", { name: "Choose verses", exact: true })).toBeVisible();
  // Not choosing: a word still plays in Lein, and nothing offers a selection.
  await expect(bar(page)).toHaveCount(0);
  await expect(page.locator(".study-verses [data-word-index][role=\"button\"]").first()).toBeVisible();
  // The hero Save (whole passage) is there until choosing starts.
  const anySave = page.getByRole("button", { name: "Save", exact: true });
  await expect(anySave).toHaveCount(1);
  await expect(bar(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Choose verses", exact: true }).click();
  await expect(bar(page)).toBeFocused();
  await expect(anySave).toHaveCount(0);
  await expect(line(page)).toHaveText("Tap verse numbers to choose them.");
  // Words are not buttons while choosing, so a tap on one does nothing.
  await expect(page.locator(".study-verses [data-word-index][role=\"button\"]")).toHaveCount(0);
  await verse(page, 1).click();
  await expect(verse(page, 1)).toHaveAttribute("aria-pressed", "true");
  await expect(line(page)).toHaveText("1 verse: Deuteronomy 31:1");
  // Only the bar's Save shows while choosing.
  await expect(anySave).toHaveCount(1);
  await expect(bar(page).getByRole("button", { name: "Save", exact: true })).toHaveCount(1);
  // Shift-click takes in everything from the last verse chosen; Select range does the same without a keyboard.
  await verse(page, 3).click({ modifiers: ["Shift"] });
  await expect(line(page)).toHaveText("3 verses: Deuteronomy 31:1–3");
  await verse(page, 8).click();
  await page.getByRole("button", { name: "Select range", exact: true }).click();
  await expect(page.getByRole("button", { name: "Select range", exact: true })).toHaveAttribute("aria-pressed", "true");
  await verse(page, 9).click();
  await expect(line(page)).toHaveText("5 verses: Deuteronomy 31:1–3; 31:8–9");
  await expect(page.getByRole("button", { name: "Select range", exact: true })).toHaveAttribute("aria-pressed", "false");
  // The keyboard operates it, and the state is a check as well as a colour.
  await verse(page, 12).focus();
  await page.keyboard.press("Enter");
  await expect(verse(page, 12)).toHaveAttribute("aria-pressed", "true");
  await expect(verse(page, 12).locator("[data-verse-check]")).toHaveCount(1);
  await page.keyboard.press("Space");
  await expect(verse(page, 12)).toHaveAttribute("aria-pressed", "false");
  await expect(verse(page, 12).locator("[data-verse-check]")).toHaveCount(0);
  await expect(line(page)).toHaveText("5 verses: Deuteronomy 31:1–3; 31:8–9");
  expect(await noHorizontalScroll(page)).toBe(true);
  await minSize(page, [verse(page, 1), bar(page).getByRole("button", { name: "Save", exact: true }), bar(page).getByRole("button", { name: "Cancel", exact: true })]);
  // Save is the existing save flow, with these groups.
  await bar(page).getByRole("button", { name: "Save", exact: true }).click();
  const form = page.getByRole("form", { name: "Save this reading" });
  await expect(form.getByLabel("Name")).toHaveValue("Deuteronomy 31:1–30 · Deuteronomy 31:1–3; 31:8–9");
  await form.getByRole("button", { name: "Save reading", exact: true }).click();
  await expect(page.getByRole("link", { name: "Open your reading", exact: true })).toHaveAttribute("href", `/read?saved=${base.id}`);
  expect(posted).toEqual([{ name: "Deuteronomy 31:1–30 · Deuteronomy 31:1–3; 31:8–9", date: null, kind: "torah", ranges: "Deuteronomy 31:1-3; Deuteronomy 31:8-9" }]);
  // Done leaves choosing, and the words are exactly as they were.
  await bar(page).getByRole("button", { name: "Done", exact: true }).click();
  await expect(bar(page)).toHaveCount(0);
  await expect(anySave).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Choose verses", exact: true })).toBeFocused();
  await expect(page.locator(".study-verses [data-word-index][role=\"button\"]").first()).toBeVisible();
});

test("a verse chosen in Study shows the check, leaves the word card shut, and Cancel restores it", async ({ page }) => {
  await openRoutes(page);
  await page.goto(`/read?ref=${encodeURIComponent(PORTION)}&kind=torah&lens=study`);
  await page.getByRole("button", { name: "Choose verses", exact: true }).click();
  await verse(page, 2).click();
  await expect(page.locator("[data-study-rows] [data-verse-ref=\"Deuteronomy 31:2\"]")).toHaveAttribute("data-verse-picked", "true");
  await expect(page.locator("[data-study-rows] [data-word-index][role=\"button\"]")).toHaveCount(0);
  await bar(page).getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(bar(page)).toHaveCount(0);
  const word = page.locator("[data-study-rows] [data-verse-ref=\"Deuteronomy 31:2\"] [data-word-index][role=\"button\"]").first();
  await word.click();
  await expect(page.getByRole("dialog", { name: "Word in Deuteronomy 31:2" })).toBeVisible();
});

test("Change verses on a saved reading starts in the whole portion with its verses selected, refuses kindly, keeps the choice, and saves with the revision", async ({ page }) => {
  for (const width of [360, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.unrouteAll({ behavior: "ignoreErrors" });
    await openRoutes(page);
    let reading = readingOf(base.ranges, 1);
    const updates: Record<string, unknown>[] = [];
    let answer: { status: number; body: unknown } | null = null;
    await page.route("**/api/saved/reading?*", route => json(route, 200, pageOf(reading)));
    await page.route("**/api/session", route => json(route, 401, { error: "authentication-required" }));
    await page.route("**/api/saved/stars", route => json(route, 200, { ok: true, stars: [] }));
    await page.route("**/api/saved/readings/update", route => {
      const body = route.request().postDataJSON(); updates.push(body);
      if (answer) return json(route, answer.status, answer.body);
      reading = readingOf(body.ranges, reading.revision + 1); return json(route, 200, { ok: true, reading });
    });
    await page.goto(`/read?saved=${base.id}`);
    await expect(page.getByRole("heading", { level: 1, name: "Synthetic selection", exact: true })).toBeVisible();
    await expect(page.getByText("Torah Deuteronomy 31:1–3; Deuteronomy 31:8–9")).toBeVisible();
    await expect(page.locator(".study-verses [data-verse-ref]")).toHaveCount(5);
    await page.getByRole("button", { name: "Change verses", exact: true }).click();
    // The whole portion, with the reading's verses selected.
    await expect(page.locator(".study-verses [data-verse-ref]")).toHaveCount(30);
    await expect(line(page)).toHaveText("5 verses: Deuteronomy 31:1–3; 31:8–9");
    await expect(verse(page, 1)).toHaveAttribute("aria-pressed", "true");
    await expect(verse(page, 4)).toHaveAttribute("aria-pressed", "false");
    await minSize(page, [verse(page, 4), bar(page).getByRole("button", { name: "Save", exact: true })]);
    expect(await noHorizontalScroll(page)).toBe(true);
    // A refusal shows its message and leaves the choice exactly as it was.
    await verse(page, 10).click();
    await expect(line(page)).toHaveText("6 verses: Deuteronomy 31:1–3; 31:8–10");
    answer = { status: 409, body: { ok: false, code: "conflict", current: readingOf(base.ranges, 5) } };
    await bar(page).getByRole("button", { name: "Save", exact: true }).click();
    await expect(bar(page).getByRole("alert")).toContainText("This reading was changed somewhere else. Your verses are still chosen. Save again to keep them.");
    await expect(line(page)).toHaveText("6 verses: Deuteronomy 31:1–3; 31:8–10");
    expect(updates.at(-1)).toEqual({ id: base.id, revision: 1, name: "Synthetic selection", date: null, ranges: "Deuteronomy 31:1-3; Deuteronomy 31:8-10" });
    if (width === 360 && test.info().project.name === "phone") await page.screenshot({ path: test.info().outputPath("change-verses-360.png"), fullPage: false });
    // Saving again uses the revision the server holds now.
    answer = null; reading = readingOf(base.ranges, 5);
    await bar(page).getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();
    expect(updates.at(-1)).toEqual({ id: base.id, revision: 5, name: "Synthetic selection", date: null, ranges: "Deuteronomy 31:1-3; Deuteronomy 31:8-10" });
    await expect(bar(page)).toHaveCount(0);
    await expect(page.getByText("Torah Deuteronomy 31:1–3; Deuteronomy 31:8–10")).toBeVisible();
    await expect(page.locator(".study-verses [data-verse-ref]")).toHaveCount(6);
  }
});

test("Whole portion marks the selection and Back to selection returns to it; Cancel in Change verses goes back too", async ({ page }) => {
  await openRoutes(page);
  const reading = readingOf(base.ranges, 1);
  await page.route("**/api/saved/reading?*", route => json(route, 200, pageOf(reading)));
  await page.route("**/api/session", route => json(route, 401, { error: "authentication-required" }));
  await page.route("**/api/saved/stars", route => json(route, 200, { ok: true, stars: [] }));
  await page.goto(`/read?saved=${base.id}&lens=study`);
  await expect(page.locator("[data-study-rows] [data-verse-ref]")).toHaveCount(5);
  // The reader's place: the verse at the top of the screen is the verse the whole portion opens at, and the way back opens at it too.
  await page.setViewportSize({ width: 1280, height: 420 });
  await page.locator("[data-study-rows] [data-verse-ref=\"Deuteronomy 31:9\"]").evaluate(element => element.scrollIntoView({ block: "start" }));
  await expect(page.locator("[data-reading-place]")).not.toContainText("Deuteronomy 31:1");
  const here = (await page.locator("[data-reading-place]").innerText()).trim();
  expect(here).toMatch(/^Deuteronomy 31:(8|9)$/);
  await page.getByRole("button", { name: "Whole portion", exact: true }).click();
  await expect(page.locator("[data-study-rows] [data-verse-ref]")).toHaveCount(30);
  await expect(page.locator("[data-study-rows] [data-verse-marked]")).toHaveCount(5);
  await expect(page.locator("[data-study-rows] [data-verse-ref=\"Deuteronomy 31:4\"]")).not.toHaveAttribute("data-verse-marked", "true");
  await expect(page.locator(`[data-study-rows] [data-verse-ref="${here}"]`)).toBeInViewport();
  await expect(page).toHaveURL(new RegExp(`/read\\?saved=${base.id}&lens=study$`));
  await page.getByRole("button", { name: "Back to selection", exact: true }).click();
  await expect(page.locator("[data-study-rows] [data-verse-ref]")).toHaveCount(5);
  await expect(page.locator(`[data-study-rows] [data-verse-ref="${here}"]`)).toBeInViewport();
  // Change verses, then Cancel: back at the selection, nothing sent.
  const sent: string[] = [];
  page.on("request", request => { if (request.url().includes("/api/saved/readings/update")) sent.push(request.url()); });
  await page.getByRole("button", { name: "Change verses", exact: true }).click();
  await expect(page.locator("[data-study-rows] [data-verse-ref]")).toHaveCount(30);
  await verse(page, 20).click();
  await bar(page).getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.locator("[data-study-rows] [data-verse-ref]")).toHaveCount(5);
  expect(sent).toEqual([]);
});

test("a selection opens inside its whole portion with the verses marked, and the way back opens the selection", async ({ page }) => {
  await openRoutes(page);
  await page.goto(`/read?ref=${encodeURIComponent("Deuteronomy 31:5-8")}&kind=torah`);
  await page.getByRole("link", { name: "Whole portion", exact: true }).click();
  await expect(page).toHaveURL(/mark=Deuteronomy\+31%3A5-8/);
  await expect(page.locator(".study-verses [data-verse-ref]")).toHaveCount(30);
  await expect(page.locator(".study-verses [data-verse-marked]")).toHaveCount(4);
  // Choosing from here starts with the marked verses.
  await page.getByRole("button", { name: "Choose verses", exact: true }).click();
  await expect(line(page)).toHaveText("4 verses: Deuteronomy 31:5–8");
  await bar(page).getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("link", { name: "Back to selection", exact: true }).click();
  await expect(page.locator(".study-verses [data-verse-ref]")).toHaveCount(4);
});
