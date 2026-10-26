import { expect, type Locator, type Page } from "@playwright/test";

// The public reader's More sheet (1.9 N5): where Start reading, the Portion control, Choose verses, Print, Save, Find a date, Choose a reading, the Trope chart and the siddur blessings are.
export const moreButton = (page: Page) => page.locator("[data-more-button]");
export const moreSheet = (page: Page): Locator => page.getByRole("dialog", { name: "More", exact: true });
/** Opens More and returns its dialog. */
export async function openMore(page: Page): Promise<Locator> {
  await moreButton(page).click();
  const sheet = moreSheet(page);
  await expect(sheet).toBeVisible();
  return sheet;
}
export async function closeMore(page: Page) {
  await moreSheet(page).getByRole("button", { name: "Close", exact: true }).click();
  await expect(moreSheet(page)).toBeHidden();
}
