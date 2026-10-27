import { expect as ui } from "@playwright/test";
import type { Page } from "playwright";

/** The public reader's Change sheet (B6): Find a reading, Choose verses, Start reading, Save and the rest are in it. Opens it (and leaves it open if it is). */
export async function openMore(tab: Page) {
  const sheet = tab.getByRole("dialog", { name: "Change reading", exact: true });
  if (!(await sheet.isVisible())) await tab.locator("[data-more-button]").click();
  await ui(sheet).toBeVisible();
  return sheet;
}
