import { expect, type Locator, type Page } from "@playwright/test";

// The public reader's Change sheet (B6, the 1.9 N5 More sheet regrouped): Find a reading, then Portion, Choose verses and Go to verse, then Start reading, Print, Save, the Trope chart and the siddur blessings.
export const moreButton = (page: Page) => page.locator("[data-more-button]");
export const moreSheet = (page: Page): Locator => page.getByRole("dialog", { name: "Change reading", exact: true });
/** Opens Change and returns its dialog. */
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
