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

/** The selected verse's mark (its "Got it" or "Still working", the tutor's assessment): in the bar under the passage. */
export async function markOf(tab: Page, ref: string): Promise<Locator> { await selectVerse(tab, ref); return toolsBar(tab).getByTestId("verse-mark"); }

/** Switches the reading to Study. There each verse has its own "Verse tools" action, which selects it and opens its sheet without a sound (in Lein a verse number or a word plays the verse). */
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
    const own = tab.locator(`[data-study-rows] [data-verse-ref="${ref}"]`).getByRole("button", { name: "Verse tools", exact: true });
    if (await own.count()) await own.click();
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
