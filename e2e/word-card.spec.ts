import { expect, test, type Page } from "@playwright/test";
import { studyEditions } from "../src/components/portal/workspace/study/credits";

// The Study word card (in the one Sheet, 1.9 N4) on the built, unconfigured production server. Every reading and text answer is a synthetic route
// fulfilment (invented syllables, numbered English); word aids and details answer 503, so the card shows its quiet fallback.
const word = ["אָבָ֑ג", "דֵּ֖ה", "וְזַ֥ח"];
const verseOf = (ref: string, count = 1) => { const text = `${Array.from({ length: count }, () => word.join(" ")).join(" ")}׃`; return { ref, english: `Synthetic translation ${ref}`, hebrew: { text, readingText: text, paragraphAfter: null, segments: [{ kind: "text", text }] } }; };
const refs = ["Genesis 1:1", "Genesis 1:2", "Genesis 1:3"];
async function mock(page: Page, longVerse = 1) {
  await page.route("**/api/public/**", route => {
    const url = new URL(route.request().url()), q = url.searchParams;
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (url.pathname === "/api/public/reading") return json({ date: q.get("date"), parashah: "Synthetic", fetchedAt: 0, listening: { pocketTorah: false },
      torah: { kind: "torah", ranges: ["Genesis 1:1-3"], verseCount: 3, pages: [{ offset: 0, first: "Genesis 1:1", last: "Genesis 1:3" }] }, haftarah: null });
    if (url.pathname === "/api/public/text") return json({ kind: "torah", date: q.get("date"), offset: 0, nextOffset: null, totalVerses: 3, translation: { key: "jps2023", status: "available" },
      verses: refs.map(ref => verseOf(ref, ref === "Genesis 1:2" ? longVerse : 1)), chapters: [{ ref: "Genesis 1", sefariaUrl: "https://www.sefaria.org/Genesis.1", fetchedAt: 0, hash: "c".repeat(64), editions: [studyEditions.mam, studyEditions.jps2023] }] });
    return json({ error: "unavailable" }, 503);
  });
}
const row = (page: Page, ref: string) => page.locator(`[data-study-rows] article[data-verse-ref="${ref}"]`);
const wordAt = (page: Page, ref: string, index: number) => row(page, ref).locator(`[role="button"][data-word-index="${index}"]`);
const card = (page: Page) => page.getByRole("dialog");

test("in Study a tap opens the word card in the sheet without moving the page, Next word moves it, and Esc gives focus back to the word", async ({ page }) => {
  await mock(page);
  await page.goto("/read?lens=study");
  await expect(row(page, "Genesis 1:1")).toBeVisible();
  await expect(page.locator("[data-reading-place]")).toContainText("Genesis 1:1");
  await wordAt(page, "Genesis 1:1", 0).scrollIntoViewIfNeeded();
  const scrolled = await page.evaluate(() => scrollY);
  await wordAt(page, "Genesis 1:1", 0).click();
  await expect(card(page).getByRole("heading", { name: "Word in Genesis 1:1" })).toBeFocused();
  expect(await page.evaluate(() => scrollY)).toBe(scrolled);
  await expect(card(page).getByText("Word 1 of 3", { exact: true })).toBeVisible();
  await expect(card(page).getByRole("button", { name: "Previous word", exact: true })).toBeDisabled();
  await card(page).getByRole("button", { name: "Next word", exact: true }).click();
  await expect(card(page).getByText("Word 2 of 3", { exact: true })).toBeVisible();
  await expect(card(page)).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(card(page)).toHaveCount(0);
  await expect(wordAt(page, "Genesis 1:1", 1)).toBeFocused();
});

test("the passage is one Tab stop, and the arrow keys move between its words right to left and on into the next verse", async ({ page }) => {
  await mock(page);
  await page.goto("/read?lens=study");
  await expect(row(page, "Genesis 1:2")).toBeVisible();
  const stops = page.locator('[data-study-rows] [role="button"][data-word-index][tabindex="0"]');
  await expect(stops).toHaveCount(1);
  await expect(wordAt(page, "Genesis 1:1", 0)).toHaveAttribute("tabindex", "0");
  await wordAt(page, "Genesis 1:2", 0).focus();
  await expect(stops).toHaveCount(1);
  await expect(wordAt(page, "Genesis 1:2", 0)).toHaveAttribute("tabindex", "0");
  await page.keyboard.press("ArrowLeft");
  await expect(wordAt(page, "Genesis 1:2", 1)).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(wordAt(page, "Genesis 1:2", 0)).toBeFocused();
  await page.keyboard.press("End");
  await expect(wordAt(page, "Genesis 1:2", 2)).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(wordAt(page, "Genesis 1:3", 0)).toBeFocused();
  await expect(stops).toHaveCount(1);
  await page.keyboard.press("Enter");
  await expect(card(page).getByRole("heading", { name: "Word in Genesis 1:3" })).toBeFocused();
});

test("in Lein a tap on a word opens no word card", async ({ page }) => {
  await mock(page);
  await page.goto("/read");
  await page.locator('.study-verses [data-verse-ref="Genesis 1:1"] [data-word-index="0"]').first().click();
  await expect(card(page)).toHaveCount(0);
});

test("on a phone the word card is in view even when the tapped word sits at the bottom of the screen, and the page stays where it was", async ({ page }, info) => {
  test.skip(info.project.name !== "phone", "A phone's sheet covers the lower part of the screen.");
  await mock(page);
  await page.goto("/read?lens=study");
  await expect(row(page, "Genesis 1:2")).toBeVisible();
  const target = wordAt(page, "Genesis 1:2", 0);
  await target.evaluate(element => element.scrollIntoView({ block: "end" }));
  const scrolled = await page.evaluate(() => scrollY);
  await target.click();
  const heading = card(page).getByRole("heading", { name: "Word in Genesis 1:2" });
  await expect(heading).toBeFocused();
  await expect(heading).toBeInViewport({ ratio: 1 });
  expect(await page.evaluate(() => scrollY)).toBe(scrolled);
});

test("in Lein on a phone a tap on a word opens its card and brings it into view", async ({ page }, info) => {
  test.skip(info.project.name !== "phone", "The card sits under the whole passage, out of sight, only on narrow screens.");
  await mock(page);
  await page.goto("/read");
  const target = page.locator('.study-verses [data-verse-ref="Genesis 1:2"] [data-word-index="0"]').first();
  await expect(target).toBeVisible();
  await target.evaluate(element => element.scrollIntoView({ block: "start" }));
  await target.click();
  const tools = page.getByRole("region", { name: "Word tools", exact: true });
  await expect(tools.getByRole("button", { name: "Word tools", exact: true })).toHaveAttribute("aria-expanded", "true");
  await expect(tools.getByRole("heading", { level: 4 })).toBeInViewport({ ratio: 1 });
});

test("on a small phone Practice up close sets a long verse so all of it shows on the stage", async ({ page }, info) => {
  test.skip(info.project.name !== "phone", "The long-verse cut-off is a small-phone problem.");
  await page.setViewportSize({ width: 375, height: 667 });
  await mock(page, 9);
  await page.goto("/read");
  await page.locator('.study-verses [data-verse-ref="Genesis 1:2"] [data-word-index="0"]').first().click();
  await page.getByRole("button", { name: /^View Genesis 1:2 up close$/ }).click();
  const stage = page.locator(".lift-stage");
  await expect(stage).toBeVisible();
  // The verse itself ends inside the stage (the notes under it may scroll).
  const overflow = await stage.evaluate(node => node.querySelector(".lift-hebrew")!.getBoundingClientRect().bottom - node.getBoundingClientRect().bottom);
  expect(overflow).toBeLessThanOrEqual(0);
});
