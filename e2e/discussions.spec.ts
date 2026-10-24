import { expect, test, type Page } from "@playwright/test";
import { studyEditions } from "../src/components/portal/workspace/study/credits";
import { sourceSefariaUrl } from "../src/lib/readings/shelf";
import { creditLine, licenseLabel } from "../src/lib/readings/edition-credit";

// Curated discussions in the reader on the built, unconfigured production server. Every answer is a synthetic route
// fulfilment: invented titles, citations and editions, numbered English only; the curator's name is invented too.
const word = ["אָבָ֑ג", "דֵּ֖ה", "וְזַ֥ח"];
const verseOf = (ref: string) => { const text = `${word.join(" ")}׃`; return { ref, english: `Synthetic translation ${ref}`, hebrew: { text, readingText: text, paragraphAfter: null, segments: [{ kind: "text", text }] } }; };
const refs = ["Genesis 1:1", "Genesis 1:2", "Genesis 1:3"];
const EN = "Synthetic English Edition", HE = "Synthetic Hebrew Edition", PRODUCT = "Synthetic Portal";
const edition = (ref: string, language: "he" | "en", title: string, license: string) => ({ language, title, license, licenseLabel: licenseLabel(license), credit: creditLine(title, license), url: sourceSefariaUrl(ref, { language, title }) });
const details = { selectedBy: "Selected by Rabbi Synthetic" };
const sources = (withText: boolean) => {
  const one = "Synthetic Mishnah 1:1", two = "Synthetic Midrash 2:2";
  return [
    { position: 1, ref: one, anchorRef: "Genesis 1:2", kind: "edition", edition: EN, credit: withText ? creditLine(EN, "CC-BY") : null, license: withText ? "CC-BY" : null, licenseLabel: withText ? "CC BY" : null,
      sefariaUrl: sourceSefariaUrl(one, { language: "en", title: EN }), details, text: withText ? { segments: [{ hebrew: [{ text: "אָב גַּד" }], english: [{ text: "Synthetic first source." }] }], editions: [edition(one, "he", HE, "Public Domain"), edition(one, "en", EN, "CC-BY")] } : null },
    { position: 2, ref: two, anchorRef: "Genesis 1:3", kind: "translation", credit: `Claude translation for ${PRODUCT}`, translation: { body: "Synthetic **translated** line.", originalEdition: HE },
      sefariaUrl: sourceSefariaUrl(two, { language: "he", title: HE }), details, text: withText ? { segments: [{ hebrew: [{ text: "הוּ זַח" }], english: null }], editions: [edition(two, "he", HE, "Public Domain")] } : null },
  ];
};
const answer = (q: URLSearchParams, options: { none?: boolean; withText?: boolean }) => ({ ref: q.get("ref"), kind: q.get("kind"), productName: options.none ? null : PRODUCT, complete: options.withText !== false,
  discussions: options.none ? [] : [{ slug: "synthetic-question", title: "A synthetic question", kind: "torah", revision: 1, updatedAt: "2026-10-24T00:00:00.000Z", anchors: ["Genesis 1:2", "Genesis 1:3"], sources: sources(options.withText !== false) }] });
async function mock(page: Page, options: { none?: boolean; withText?: boolean } = {}) {
  await page.route("**/api/public/**", route => {
    const url = new URL(route.request().url()), q = url.searchParams;
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (url.pathname === "/api/public/reading") return json(q.get("ref") ? { ref: q.get("ref"), kind: q.get("kind"), listening: { pocketTorah: false },
      passage: { kind: "torah", ranges: ["Genesis 1:1-3"], verseCount: 3, pages: [{ offset: 0, first: "Genesis 1:1", last: "Genesis 1:3" }] } }
      : { date: q.get("date"), parashah: "Synthetic", fetchedAt: 0, listening: { pocketTorah: false },
        torah: { kind: "torah", ranges: ["Genesis 1:1-3"], verseCount: 3, pages: [{ offset: 0, first: "Genesis 1:1", last: "Genesis 1:3" }] }, haftarah: null });
    if (url.pathname === "/api/public/text") return json({ kind: "torah", ...(q.get("ref") ? { ref: q.get("ref") } : { date: q.get("date") }), offset: 0, nextOffset: null, totalVerses: 3, translation: { key: "jps2023", status: "available" },
      verses: refs.map(verseOf), chapters: [{ ref: "Genesis 1", sefariaUrl: "https://www.sefaria.org/Genesis.1", fetchedAt: 0, hash: "c".repeat(64), editions: [studyEditions.mam, studyEditions.jps2023] }] });
    if (url.pathname === "/api/public/discussions") return json(answer(q, options));
    return json({ error: "unavailable" }, 503);
  });
}
const row = (page: Page, ref: string) => page.locator(`[data-study-rows] article[data-verse-ref="${ref}"]`);
const marker = (page: Page, ref: string) => row(page, ref).getByRole("button", { name: "Sources on this verse", exact: true });
const panel = (page: Page) => page.locator("[data-verse-panel]");
const list = (page: Page) => page.locator("[data-discussion-list]");
const reduced = async (page: Page) => page.emulateMedia({ reducedMotion: "reduce" });

test("the marker is on the anchor verses only; opening it shows the sources with their credits, 'Selected by' apart, and Esc returns focus", async ({ page }) => {
  await mock(page);
  await page.goto("/read?lens=study");
  await expect(marker(page, "Genesis 1:2")).toBeVisible();
  await expect(marker(page, "Genesis 1:3")).toBeVisible();
  await expect(marker(page, "Genesis 1:1")).toHaveCount(0);
  const button = marker(page, "Genesis 1:2");
  await button.scrollIntoViewIfNeeded();
  expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  const before = (await row(page, "Genesis 1:2").boundingBox())!.y;
  await button.click();
  await expect(panel(page).getByRole("heading", { name: "Sources on this verse · Genesis 1:2" })).toBeFocused();
  await expect(panel(page).getByText("A synthetic question")).toBeVisible();
  await expect(panel(page).getByText("Synthetic first source.")).toBeVisible();
  await expect(panel(page).getByRole("link", { name: `${EN}, via Sefaria (CC BY)` })).toBeVisible();
  await expect(panel(page).locator("[data-source-detail]")).toHaveText("Selected by Rabbi Synthetic");
  await expect(panel(page).locator("[data-discussion-credit]")).not.toContainText("Rabbi Synthetic");
  await expect(panel(page).getByRole("link", { name: /on Sefaria$/ })).toHaveAttribute("href", sourceSefariaUrl("Synthetic Mishnah 1:1", { language: "en", title: EN }));
  // The reader's place holds while the panel opens.
  expect(Math.abs((await row(page, "Genesis 1:2").boundingBox())!.y - before)).toBeLessThan(2);
  // This is a verse panel: the one a source from the list opens too, so Back to this verse is not offered from the marker.
  await expect(panel(page).getByRole("button", { name: "Back to this verse" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(panel(page)).toHaveCount(0);
  await expect(button).toBeFocused();
});

test("the list is headed 'Sources for this reading'; a source opens at its verse with a Claude translation credited by the product name, and Back to this verse", async ({ page }) => {
  await reduced(page);
  await mock(page);
  await page.goto("/read?lens=study");
  await expect(list(page).getByRole("heading", { name: "Sources for this reading" })).toBeVisible();
  await expect(list(page).getByText("A synthetic question")).toBeVisible();
  const second = list(page).getByRole("button", { name: "Synthetic Midrash 2:2" });
  expect((await second.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await second.click();
  await expect(panel(page)).toHaveAttribute("data-verse-panel", "Genesis 1:3");
  await expect(panel(page).getByText(`Claude translation for ${PRODUCT}`)).toBeVisible();
  await expect(panel(page).locator("strong", { hasText: "translated" })).toBeVisible();
  await expect(panel(page).locator("[data-source-detail]")).toHaveText("Selected by Rabbi Synthetic");
  await panel(page).getByRole("button", { name: "Back to this verse" }).click();
  await expect(panel(page)).toHaveCount(0);
  await expect(row(page, "Genesis 1:3")).toBeFocused();
  // Esc from the list's own opener hands focus back to it.
  await second.click();
  await expect(panel(page)).toHaveAttribute("data-verse-panel", "Genesis 1:3");
  await page.keyboard.press("Escape");
  await expect(second).toBeFocused();
});

test("a source Sefaria could not give shows its credit and its link and no text, never an error page", async ({ page }) => {
  await mock(page, { withText: false });
  await page.goto("/read?lens=study");
  await marker(page, "Genesis 1:3").click();
  await expect(panel(page).getByText(`Claude translation for ${PRODUCT}`)).toBeVisible();
  await expect(panel(page).getByRole("link", { name: /on Sefaria$/ })).toBeVisible();
  await expect(panel(page).getByText("Synthetic translated")).toHaveCount(0);
  await expect(panel(page).getByText(/isn’t available|something went wrong|error/i)).toHaveCount(0);
  await page.keyboard.press("Escape");
  await marker(page, "Genesis 1:2").click();
  await expect(panel(page).getByText(EN, { exact: true })).toBeVisible();
  await expect(panel(page).getByText("Synthetic first source.")).toHaveCount(0);
});

test("a reading with no discussions shows no heading and no marker, in Study and in Lein", async ({ page }) => {
  await mock(page, { none: true });
  await page.goto("/read?lens=study");
  await expect(row(page, "Genesis 1:2")).toBeVisible();
  await expect(page.getByText("Sources for this reading")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Sources on this verse" })).toHaveCount(0);
  await page.goto("/read");
  await expect(page.getByText("Sources for this reading")).toHaveCount(0);
});

test("Lein is for chanting: no list and no marker even where discussions exist", async ({ page }) => {
  await mock(page);
  await page.goto("/read");
  await expect(page.locator("[data-verse-ref]").first()).toBeVisible();
  await expect(page.getByText("Sources for this reading")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Sources on this verse" })).toHaveCount(0);
});

test("the print sheet offers the discussions where there are any and prints them in the appendix with their credits, off by default", async ({ page }) => {
  await mock(page);
  await page.goto("/print?ref=Genesis+1%3A1-3&kind=torah");
  const choice = page.getByRole("checkbox", { name: "Sources for this reading" });
  await expect(choice).toBeVisible();
  await expect(choice).not.toBeChecked();
  await expect(page.locator("[data-print-appendix]")).toHaveCount(0);
  await choice.check();
  const appendix = page.locator("[data-print-appendix]");
  await expect(appendix.getByText("A synthetic question: Synthetic Mishnah 1:1")).toBeVisible();
  await expect(appendix.getByText(`${EN}, via Sefaria (CC BY)`)).toBeVisible();
  await expect(appendix.getByText(`Claude translation for ${PRODUCT}`)).toBeVisible();
  await expect(appendix.getByText("Selected by")).toHaveCount(0);
  await expect(page).toHaveURL(/disc=on/);
});
