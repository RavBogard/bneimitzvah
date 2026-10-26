import { expect as ui } from "@playwright/test";
import type { Page } from "playwright";

/** The public reader's More sheet (1.9 N5): Start reading, Choose verses, Save, Choose a reading and the rest are in it. Opens it (and leaves it open if it is). */
export async function openMore(tab: Page) {
  const sheet = tab.getByRole("dialog", { name: "More", exact: true });
  if (!(await sheet.isVisible())) await tab.locator("[data-more-button]").click();
  await ui(sheet).toBeVisible();
  return sheet;
}
