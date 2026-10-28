import { expect as ui, type Locator, type Page } from "@playwright/test";

/**
 * The workspace's verse tools (1.9 N4): one Sheet for the selected verse, opened from the bar under the passage (or, in Study, from the verse's own
 * "Verse tools" action). A verse is selected by tapping its number, one of its words, or Up close; the first verse is selected until then.
 * These helpers do what a reader does, so a test names the verse it wants and does not care which controls got it there.
 */
export const toolsSheet = (tab: Page, ref: string) => tab.getByRole("dialog", { name: `Verse tools · ${ref}`, exact: true });
export const toolsBar = (tab: Page) => tab.getByTestId("study-verse-bar");

/** Makes this verse the selected one: a tap on its first word (which plays or opens the word tools, never the sheet). Nothing to do when it already is. */
export async function selectVerse(tab: Page, ref: string) {
  if (await toolsBar(tab).getAttribute("data-selected-verse") === ref) return;
  await tab.locator(`[data-testid="study-verses"] [data-verse-ref="${ref}"] [data-word-index]`).first().click();
  await ui(toolsBar(tab)).toHaveAttribute("data-selected-verse", ref);
}

/**
 * A verse's mark (its "Got it" or "Still working", the tutor's assessment). Staff and parents read it in the bar under the passage; a student's page
 * (Hebrew first, 2026-10-28) has no bar, so the verse's own sheet is opened from its number and the mark is read there (the sheet stays open).
 */
export async function markOf(tab: Page, ref: string): Promise<Locator> {
  if (await studentPage(tab)) return (await openVerseTools(tab, ref)).getByTestId("verse-mark");
  await selectVerse(tab, ref); return toolsBar(tab).getByTestId("verse-mark");
}

/** A student's reading: its verse numbers open the verse's sheet. */
const verseNumber = (tab: Page, ref: string) => tab.locator(`[data-testid="study-verses"] [data-verse-ref="${ref}"] button[data-verse-number][aria-haspopup="dialog"]`);
async function studentPage(tab: Page) {
  // Decided once the reading's controls are on the page (after a reload the dock or the bar may not be drawn yet).
  await tab.locator('[data-testid="dock-up-close"], [data-testid="study-verse-bar"]').first().waitFor();
  return await tab.getByTestId("dock-up-close").count() > 0;
}

/** Opens Up close at this verse: from the bar under the passage, or on a student's page from the verse's sheet. */
export async function upClose(tab: Page, ref: string) {
  if (await studentPage(tab)) await (await openVerseTools(tab, ref)).getByRole("button", { name: `View ${ref} up close`, exact: true }).click();
  else await tab.getByRole("button", { name: `View ${ref} up close`, exact: true }).click();
  await ui(tab.locator("dialog.lift")).toBeVisible();
}

/** Switches the reading to Study. There a verse's number selects it and the bar under the passage opens its tools without a sound (in Lein a verse number or a word plays the verse). */
export async function inStudy(tab: Page) {
  if (await tab.getByRole("dialog", { name: /^Verse tools · / }).count()) await closeVerseTools(tab);
  await tab.getByRole("button", { name: "Study", exact: true }).click();
  await ui(tab.locator("[data-study-rows]")).toBeVisible();
}

/** Opens this verse's tools and returns the verse's block inside the sheet. A sheet already open for the verse is reused. */
export async function openVerseTools(tab: Page, ref: string): Promise<Locator> {
  const sheet = toolsSheet(tab, ref);
  if (await sheet.count() === 0) {
    // Another verse's sheet is modal: it is closed first, as a reader would.
    if (await tab.getByRole("dialog", { name: /^Verse tools · / }).count()) await closeVerseTools(tab);
    const own = await studyVerseTools(tab, ref);
    if (own) await own.click();
    else if (await verseNumber(tab, ref).count()) await verseNumber(tab, ref).click();
    else { await selectVerse(tab, ref); await toolsBar(tab).getByRole("button", { name: /^Verse tools/ }).click(); }
    await ui(sheet).toBeVisible();
  }
  return sheet.locator(`[data-testid="study-verse-detail"][data-verse-ref="${ref}"]`);
}

/** The first verse's "Your translation & notes" disclosure, with the sheet opened for it. The locator is lazy: it needs the sheet open whenever it is used. */
export async function workPanel(tab: Page): Promise<Locator> { return (await openVerseTools(tab, "Genesis 1:1")).getByTestId("verse-work"); }

/** Closes whatever verse-tools sheet is open, with Esc (which asks the departure guard first, as leaving the page would). */
export async function closeVerseTools(tab: Page) {
  await tab.keyboard.press("Escape");
  await ui(tab.getByRole("dialog", { name: /^Verse tools · / })).toHaveCount(0);
}

/** In Study, the verse's tools button (the bar under the passage): choosing the verse's number selects it; there is no Notes sheet or rail action any more (Study v6, 2026-10-28). Null outside Study. */
async function studyVerseTools(tab: Page, ref: string): Promise<Locator | null> {
  if (!await tab.locator("[data-study-rows]").count()) return null;
  await tab.locator(`[data-study-rows] article[data-verse-ref="${ref}"] button[data-verse-number]`).click();
  await ui(toolsBar(tab)).toHaveAttribute("data-selected-verse", ref);
  return toolsBar(tab).getByRole("button", { name: /^Verse tools/ });
}
