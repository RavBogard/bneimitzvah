import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Study as a study desk (v6, 2026-10-28): from 900px a verse's notes are in the notes column beside the text, one verse open at a time (the first verse with
 * entries at the reading line); the column lists only verses that have entries. Narrower, a verse's notes are inline under its English, with no sheet.
 * These helpers do what a reader does at the page's width.
 */
export const studyRow = (page: Page, ref: string) => page.locator(`[data-study-rows] article[data-verse-ref="${ref}"]`);
export const studyRail = (page: Page) => page.locator("[data-study-rail]");
const wide = (page: Page) => (page.viewportSize()?.width ?? 0) >= 900;

/** Kept for the specs' shape: there is no Notes sheet any more, so there is nothing to close. */
export async function closeNotes(_page: Page) { /* Nothing opens over the text: the notes are in the column or inline. */ }

/**
 * Where this verse's notes are: its open card in the column (opened by choosing its folded line), or its inline notes under the English on a phone. A verse with
 * no entries has none, and the locator returned matches nothing, so a spec can assert that.
 */
export async function verseNotes(page: Page, ref: string): Promise<Locator> {
  await expect(studyRow(page, ref)).toBeVisible();
  if (!wide(page)) {
    const inline = studyRow(page, ref).locator("[data-inline-notes]");
    await inline.first().waitFor({ timeout: 3000 }).catch(() => undefined);
    return inline;
  }
  const item = studyRail(page).locator(`[data-rail-item="${ref}"]`);
  await item.first().waitFor({ timeout: 3000 }).catch(() => undefined);
  if (await item.count() === 0) return item;
  if (await studyRail(page).getAttribute("data-rail-verse") !== ref) await item.locator("[data-rail-head]").click();
  await expect(studyRail(page)).toHaveAttribute("data-rail-verse", ref);
  // The fold opens over about half a second: the card is there to use once it has.
  await expect(item.locator("[data-study-notes]")).toBeVisible();
  return item;
}
