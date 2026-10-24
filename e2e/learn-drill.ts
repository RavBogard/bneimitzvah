import { expect, type Page } from "@playwright/test";

/** Answers whatever drill is on screen, rightly (the patterns e2e/learn.spec.ts uses). */
export async function answerRight(page: Page) {
  const main = page.locator("main");
  const choice = main.locator("button[class*=choice][data-right]").first();
  if (await choice.count()) return choice.click();
  const look = main.locator("[data-look-answer]");
  if (await look.count()) { const answer = await look.getAttribute("data-look-answer"); return main.locator(`button[data-look="${answer}"]`).click(); }
  const end = main.locator("[data-end-unit]");
  if (await end.count()) { const unit = await end.getAttribute("data-end-unit"); return main.locator(`[data-end-unit] [data-unit="${unit}"]`).click(); }
  const tap = main.locator("[data-target-phrase]");
  if (await tap.count()) { const target = await tap.getAttribute("data-target-phrase"); return main.locator(`[data-phrase-target="${target}"]`).click(); }
  for (let k = 0; k < 6; k++) {
    const tile = main.locator(`button[class*=tile][data-order="${k}"]:not([disabled])`).first();
    if (!(await tile.count())) break;
    await tile.click();
  }
}

/** From the lesson's Hear step to Done, answering every drill rightly. */
export async function finishLesson(page: Page) {
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByRole("heading", { name: "In verses" })).toBeVisible();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  for (let i = 0; i < 40; i++) {
    if (await page.locator("main").getAttribute("data-step") === "done") break;
    await expect(page.locator("main h2").first()).toBeVisible();
    await answerRight(page);
    const next = page.getByRole("button", { name: "Next", exact: true });
    await expect(next).toBeEnabled();
    await next.click();
  }
  await expect(page.locator("main[data-step=done]")).toBeVisible();
}
