import { expect, test, type Page } from "@playwright/test";
import { studyEditions } from "../src/components/portal/workspace/study/credits";
import { sefariaEditionUrl } from "../src/lib/readings/compare";
import { creditLine, licenseLabel } from "../src/lib/readings/edition-credit";
import { closeNotes, verseNotes } from "./study-sheet";

// Compare on the built, unconfigured production server. Every reading, text and translations answer is a
// synthetic route fulfilment: invented syllables, numbered English and invented edition titles only.
const word = ["אָבָ֑ג", "דֵּ֖ה", "וְזַ֥ח"];
const verseOf = (ref: string) => { const text = `${word.join(" ")}׃`; return { ref, english: `Synthetic translation ${ref}`, hebrew: { text, readingText: text, paragraphAfter: null, segments: [{ kind: "text", text }] } }; };
const refs = ["Genesis 1:1", "Genesis 1:2", "Genesis 1:3"];
const edition = (ref: string, language: "he" | "en", title: string, license: string, text: string) =>
  ({ title, license, licenseLabel: licenseLabel(license), credit: creditLine(title, license), url: sefariaEditionUrl(ref, language, title), runs: [{ text }] });
async function mock(page: Page, options: { translations?: "ok" | "fail" } = {}) {
  let failing = options.translations === "fail";
  const calls: string[] = [];
  await page.route("**/api/public/**", route => {
    const url = new URL(route.request().url()), q = url.searchParams; calls.push(url.pathname + url.search);
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (url.pathname === "/api/public/reading") return json({ date: q.get("date"), parashah: "Synthetic", fetchedAt: 0, listening: { pocketTorah: false },
      torah: { kind: "torah", ranges: ["Genesis 1:1-3"], verseCount: 3, pages: [{ offset: 0, first: "Genesis 1:1", last: "Genesis 1:3" }] }, haftarah: null });
    if (url.pathname === "/api/public/text") return json({ kind: "torah", date: q.get("date"), offset: 0, nextOffset: null, totalVerses: 3, translation: { key: "jps2023", status: "available" },
      verses: refs.map(verseOf), chapters: [{ ref: "Genesis 1", sefariaUrl: "https://www.sefaria.org/Genesis.1", fetchedAt: 0, hash: "c".repeat(64), editions: [studyEditions.mam, studyEditions.jps2023] }] });
    if (url.pathname === "/api/public/translations") {
      if (failing) return json({ error: "unavailable" }, 503);
      const ref = q.get("verse")!, targum = `Onkelos ${ref}`;
      return json({ verse: ref, translations: [edition(ref, "en", "Synthetic Edition One", "CC-BY", `Synthetic rendering one of ${ref}.`),
        edition(ref, "en", "Synthetic Edition Two", "Copyright: Synthetic Press", `Synthetic rendering two of ${ref}.`)],
        targum: { work: "Onkelos", aramaic: edition(targum, "he", "Synthetic Aramaic", "Public Domain", "אָבָג דֵּה"), english: edition(targum, "en", "Synthetic Targum English", "", "Synthetic targum rendering.") } });
    }
    return json({ error: "unavailable" }, 503);
  });
  return { calls, recover() { failing = false; } };
}
const row = (page: Page, ref: string) => page.locator(`[data-study-rows] article[data-verse-ref="${ref}"]`);
/** A verse's Compare: with its notes (the rail beside the verses, or its Notes sheet on a phone; Study as a study sheet, 2026-10-28). */
const compare = async (page: Page, ref: string) => (await verseNotes(page, ref)).getByRole("button", { name: "Compare", exact: true });
const compareSheets = (page: Page) => page.getByRole("dialog", { name: /^Compare / });
const panel = (page: Page) => page.locator("[data-verse-panel]");

test("Compare opens one sheet for the verse: every other translation credited as Sefaria states it, then the Targum, and Esc gives focus back", async ({ page }) => {
  const sefaria = await mock(page);
  await page.goto("/read?lens=study");
  await expect(row(page, "Genesis 1:1")).toBeVisible();
  expect(sefaria.calls.some(call => call.startsWith("/api/public/translations"))).toBe(false); // only when opened
  const button = await compare(page, "Genesis 1:2");
  expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await button.scrollIntoViewIfNeeded();
  const scrolled = await page.evaluate(() => scrollY);
  await button.click();
  // One Sheet (1.9 N4): modal, named for the verse, opening on its title, and the page behind it does not move.
  const sheet = page.getByRole("dialog", { name: "Compare Genesis 1:2" });
  await expect(sheet.getByRole("heading", { name: "Compare Genesis 1:2" })).toBeFocused();
  expect(await page.evaluate(() => scrollY)).toBe(scrolled);
  await expect(panel(page).getByText("Synthetic rendering one of Genesis 1:2.")).toBeVisible();
  await expect(panel(page).getByRole("link", { name: "Synthetic Edition Two, via Sefaria (Copyright: Synthetic Press)" })).toHaveAttribute("href", sefariaEditionUrl("Genesis 1:2", "en", "Synthetic Edition Two"));
  await expect(panel(page).getByRole("heading", { name: "Onkelos" })).toBeVisible();
  await expect(panel(page).locator('[lang="arc"][dir="rtl"]')).toHaveText("אָבָג דֵּה");
  await expect(panel(page).getByRole("link", { name: "Synthetic Targum English, via Sefaria (licence not stated)" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.keyboard.press("Escape");
  await expect(compareSheets(page)).toHaveCount(0);
  await expect(button).toBeFocused();
  // Another verse's Compare opens its own sheet; Close does the same as Esc.
  const third = await compare(page, "Genesis 1:3");
  await third.click();
  await expect(page.getByRole("dialog", { name: "Compare Genesis 1:3" }).getByRole("heading", { name: "Compare Genesis 1:3" })).toBeFocused();
  await page.getByRole("dialog", { name: "Compare Genesis 1:3" }).getByRole("button", { name: "Close", exact: true }).click();
  await expect(compareSheets(page)).toHaveCount(0);
  await expect(third).toBeFocused();
  // Lein has no Compare.
  await closeNotes(page);
  await page.getByRole("button", { name: "Lein", exact: true }).click();
  await expect(page.getByRole("button", { name: "Compare", exact: true })).toHaveCount(0);
});

test("a failed Compare is one quiet line with Try again, and the reading is untouched", async ({ page }) => {
  const sefaria = await mock(page, { translations: "fail" });
  await page.goto("/read?lens=study");
  await (await compare(page, "Genesis 1:1")).click();
  await expect(panel(page).getByText("Translations aren’t available right now.")).toBeVisible();
  await expect(row(page, "Genesis 1:2")).toBeVisible();
  sefaria.recover();
  await panel(page).getByRole("button", { name: "Try again", exact: true }).click();
  await expect(panel(page).getByText("Synthetic rendering one of Genesis 1:1.")).toBeVisible();
});

test("the Compare sheet is modal: Tab never leaves it, and a tap outside closes it and gives focus back", async ({ page }) => {
  await mock(page);
  await page.goto("/read?lens=study");
  const button = await compare(page, "Genesis 1:1");
  await button.click();
  const sheet = page.getByRole("dialog", { name: "Compare Genesis 1:1" });
  await expect(sheet.getByText("Synthetic rendering one of Genesis 1:1.")).toBeVisible();
  const inside = () => page.evaluate(() => document.activeElement?.closest("dialog") !== null);
  for (let step = 0; step < 12; step++) { await page.keyboard.press("Tab"); expect(await inside()).toBe(true); }
  for (let step = 0; step < 12; step++) { await page.keyboard.press("Shift+Tab"); expect(await inside()).toBe(true); }
  // A tap on the backdrop (the top of the screen, above the sheet) closes it.
  await page.mouse.click(4, 4);
  await expect(compareSheets(page)).toHaveCount(0);
  await expect(button).toBeFocused();
});
