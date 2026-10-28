import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Study as a study sheet (2026-10-28): a verse's notes (the guide's, its commentary, its sources and its actions) are in the rail beside the verses
 * once the verse is chosen, from 900px; narrower, they are in the verse's Notes sheet. These helpers do what a reader does at the page's width.
 */
export const studyRow = (page: Page, ref: string) => page.locator(`[data-study-rows] article[data-verse-ref="${ref}"]`);
export const studyRail = (page: Page) => page.locator("[data-study-rail]");
const notesSheet = (page: Page, ref?: string) => ref ? page.getByRole("dialog", { name: `On this verse · ${ref}`, exact: true }) : page.getByRole("dialog", { name: /^On this verse · / });

/** Closes a verse's Notes sheet if one is open (a phone or a tablet). */
export async function closeNotes(page: Page) {
  if (await notesSheet(page).count() === 0) return;
  await page.keyboard.press("Escape");
  await expect(notesSheet(page)).toHaveCount(0);
}

/** Where this verse's notes are: the rail with the verse chosen, or its open Notes sheet. */
export async function verseNotes(page: Page, ref: string): Promise<Locator> {
  if (await notesSheet(page, ref).count()) return notesSheet(page, ref);
  await expect(studyRow(page, ref)).toBeVisible();
  const rail = studyRail(page);
  if ((page.viewportSize()?.width ?? 0) >= 900) {
    if (await rail.getAttribute("data-rail-verse") !== ref) await studyRow(page, ref).locator("button[data-verse-number]").click();
    await expect(rail).toHaveAttribute("data-rail-verse", ref);
    return rail;
  }
  await closeNotes(page);
  await studyRow(page, ref).getByTestId("study-notes-open").click();
  await expect(notesSheet(page, ref)).toBeVisible();
  return notesSheet(page, ref);
}
