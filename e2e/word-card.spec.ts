import { expect, test, type Page } from "@playwright/test";
import { studyEditions } from "../src/components/portal/workspace/study/credits";

// The Study word card on the built, unconfigured production server. Every reading and text answer is a synthetic route
// fulfilment (invented syllables, numbered English); word aids and details answer 503, so the card shows its quiet fallback.
const word = ["אָבָ֑ג", "דֵּ֖ה", "וְזַ֥ח"];
const verseOf = (ref: string) => { const text = `${word.join(" ")}׃`; return { ref, english: `Synthetic translation ${ref}`, hebrew: { text, readingText: text, paragraphAfter: null, segments: [{ kind: "text", text }] } }; };
const refs = ["Genesis 1:1", "Genesis 1:2", "Genesis 1:3"];
async function mock(page: Page) {
  await page.route("**/api/public/**", route => {
    const url = new URL(route.request().url()), q = url.searchParams;
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (url.pathname === "/api/public/reading") return json({ date: q.get("date"), parashah: "Synthetic", fetchedAt: 0, listening: { pocketTorah: false },
      torah: { kind: "torah", ranges: ["Genesis 1:1-3"], verseCount: 3, pages: [{ offset: 0, first: "Genesis 1:1", last: "Genesis 1:3" }] }, haftarah: null });
    if (url.pathname === "/api/public/text") return json({ kind: "torah", date: q.get("date"), offset: 0, nextOffset: null, totalVerses: 3, translation: { key: "jps2023", status: "available" },
      verses: refs.map(verseOf), chapters: [{ ref: "Genesis 1", sefariaUrl: "https://www.sefaria.org/Genesis.1", fetchedAt: 0, hash: "c".repeat(64), editions: [studyEditions.mam, studyEditions.jps2023] }] });
    return json({ error: "unavailable" }, 503);
  });
}
const row = (page: Page, ref: string) => page.locator(`[data-study-rows] article[data-verse-ref="${ref}"]`);
const wordAt = (page: Page, ref: string, index: number) => row(page, ref).locator(`[role="button"][data-word-index="${index}"]`);
const card = (page: Page) => page.locator("[data-verse-panel]");

test("in Study a tap opens the word card beside the verse, Next word moves it, and Esc gives focus back to the word", async ({ page }) => {
  await mock(page);
  await page.goto("/read?lens=study");
  await expect(row(page, "Genesis 1:1")).toBeVisible();
  await expect(page.locator("[data-reading-place]")).toContainText("Genesis 1:1");
  await wordAt(page, "Genesis 1:1", 0).click();
  await expect(card(page).getByRole("heading", { name: "Word in Genesis 1:1" })).toBeFocused();
  await expect(card(page).getByText("Word 1 of 3", { exact: true })).toBeVisible();
  await expect(card(page).getByRole("button", { name: "Previous word", exact: true })).toBeDisabled();
  await card(page).getByRole("button", { name: "Next word", exact: true }).click();
  await expect(card(page).getByText("Word 2 of 3", { exact: true })).toBeVisible();
  await expect(card(page)).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(card(page)).toHaveCount(0);
  await expect(wordAt(page, "Genesis 1:1", 1)).toBeFocused();
});

test("each verse is one Tab stop, and the arrow keys move between its words right to left", async ({ page }) => {
  await mock(page);
  await page.goto("/read?lens=study");
  await expect(row(page, "Genesis 1:2")).toBeVisible();
  await expect(row(page, "Genesis 1:2").locator('[role="button"][data-word-index][tabindex="0"]')).toHaveCount(1);
  await wordAt(page, "Genesis 1:2", 0).focus();
  await page.keyboard.press("ArrowLeft");
  await expect(wordAt(page, "Genesis 1:2", 1)).toBeFocused();
  await expect(row(page, "Genesis 1:2").locator('[role="button"][data-word-index][tabindex="0"]')).toHaveCount(1);
  await page.keyboard.press("ArrowRight");
  await expect(wordAt(page, "Genesis 1:2", 0)).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(card(page).getByRole("heading", { name: "Word in Genesis 1:2" })).toBeFocused();
});

test("in Lein a tap on a word opens no word card", async ({ page }) => {
  await mock(page);
  await page.goto("/read");
  await page.locator('.study-verses [data-verse-ref="Genesis 1:1"] [data-word-index="0"]').first().click();
  await expect(card(page)).toHaveCount(0);
});
