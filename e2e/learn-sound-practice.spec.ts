import { expect, test, type Page } from "@playwright/test";
import { syntheticCourseRoutes } from "./learn-synthetic";

const plays = (page: Page) => page.evaluate(() => (window as unknown as { learnPlays: string[] }).learnPlays.length);
const stage = (page: Page, name: string) => expect(page.locator("[data-sound-stage]")).toHaveAttribute("data-sound-stage", name);
test.beforeEach(async ({ page }) => { await syntheticCourseRoutes().install(page); });

test("a sound lesson teaches echo and independent production, permits specific repair, and finishes without a quiz quota", async ({ page }) => {
  await page.goto("/learn/torah-etnachta");
  await page.getByRole("button", { name: "Try the sound", exact: true }).click(); await stage(page, "model");
  expect(await plays(page)).toBe(0);
  await page.getByRole("button", { name: "Hear this phrase", exact: true }).click();
  await expect(page.locator("[data-playback-active]")).toHaveCount(1);
  await page.getByRole("button", { name: "Echo after the model stops", exact: true }).click(); await stage(page, "echo");
  await expect(page.locator("[data-playback-active]")).toHaveCount(0);
  const heard = await plays(page); await page.waitForTimeout(400); expect(await plays(page)).toBe(heard);
  await page.getByRole("button", { name: "Try from the text", exact: true }).click(); await stage(page, "attempt");
  await page.waitForTimeout(400); expect(await plays(page)).toBe(heard);
  await page.getByRole("button", { name: "Compare with the reader", exact: true }).click(); await stage(page, "compare");
  await page.getByRole("button", { name: "Work on a word", exact: true }).click(); await stage(page, "word");
  await page.locator("[data-sound-stage] [data-tap=answer]").first().click();
  await expect(page.getByRole("button", { name: "Hear this word", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Return to the whole phrase", exact: true }).click(); await stage(page, "model");
  await page.getByRole("button", { name: "Try this familiar phrase directly", exact: true }).click();
  await page.getByRole("button", { name: "Compare with the reader", exact: true }).click();
  await page.getByRole("button", { name: "I’m not sure", exact: true }).click(); await stage(page, "unsure");
  await expect(page.getByRole("button", { name: "Hear the first word", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Finish this practice", exact: true }).click();
  await expect(page.locator("main")).toHaveAttribute("data-step", "done");
  await expect(page.getByText("Return to this phrase whenever you need it.", { exact: false })).toBeVisible();
  await expect(page.getByText("You can lein this verse.", { exact: true })).toHaveCount(0);
});

test("orientation has a real engine phrase and no opening recognition, endpoint or halves examination", async ({ page }) => {
  await page.goto("/learn/intro-phrases");
  await page.getByRole("button", { name: "Next", exact: true }).click(); await stage(page, "model");
  expect(await page.locator("[data-sound-stage] [data-unit]").count()).toBeGreaterThan(0);
  await expect(page.getByRole("button", { name: "Optional recognition practice", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Examples", exact: true }).click();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.locator("main")).toHaveAttribute("data-step", "done");
  await expect(page.getByRole("heading", { name: /Same tune|Tap the word|before the rest/ })).toHaveCount(0);
});

test("new recognition alternatives are explicitly modeled before scored familiar-anchor questions", async ({ page }) => {
  await page.goto("/learn/torah-sof-pasuk");
  await page.getByRole("button", { name: "Try the sound", exact: true }).click();
  await page.getByRole("button", { name: "Try this familiar phrase directly", exact: true }).click();
  await page.getByRole("button", { name: "Compare with the reader", exact: true }).click();
  await page.getByRole("button", { name: "Optional recognition practice", exact: true }).click();
  const anchor = page.locator("[data-sound-anchors] li").filter({ has: page.locator("[data-family-chip=etnachta]") });
  await expect(anchor).toContainText("Hear this model before its questions");
  const visibleModels = await page.locator("[data-sound-anchors] [data-unit]").allTextContents();
  const play = anchor.getByRole("button", { name: /^Hear / }); await play.click();
  await expect(play).toHaveAttribute("data-state", "playing"); await expect(play).toHaveAttribute("data-state", "idle", { timeout: 10_000 });
  await expect(anchor).toContainText("Available in practice");
  await page.getByRole("button", { name: "Start optional questions", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Which phrase is this?", exact: true })).toBeVisible();
  await expect(page.locator("main button[class*=choice]")).toHaveCount(2);
  await expect(page.getByRole("heading", { name: "Same tune or different?", exact: true })).toHaveCount(0);
  expect(visibleModels.length).toBeGreaterThan(1);
  await page.getByRole("button", { name: "Finish without more questions", exact: true }).click();
  await expect(page.locator("main")).toHaveAttribute("data-step", "done");
});

test("a comparison model failure cannot produce a positive first-verse result until its successful retry", async ({ page }) => {
  let unavailable = true;
  await page.route("**/reference-audio/short-v1/*", route => unavailable ? route.abort() : route.fallback());
  await page.goto("/learn/torah-first-verse");
  await page.getByRole("button", { name: "Go straight to a whole-verse attempt", exact: true }).click();
  await page.getByRole("button", { name: "Compare the whole verse", exact: true }).click();
  await page.getByRole("button", { name: "Hear the whole verse", exact: true }).click();
  await expect(page.getByText("The recording did not load. Try again.", { exact: true })).toBeVisible();
  const positive = page.getByRole("button", { name: "Same as the reader", exact: true }); await expect(positive).toBeDisabled();
  await page.getByRole("combobox", { name: "Model speed", exact: true }).selectOption("0.75"); await expect(positive).toBeDisabled();
  await page.getByRole("button", { name: "Return later", exact: true }).click();
  await expect(page.getByText("You can lein this verse.", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Try this verse before replay", exact: true }).click();
  await page.getByRole("button", { name: "Compare the whole verse", exact: true }).click(); await expect(positive).toBeDisabled();
  unavailable = false;
  const model = page.getByRole("button", { name: "Hear the whole verse", exact: true }); await model.click();
  await expect(model).toHaveAttribute("data-state", "playing"); await expect(model).toHaveAttribute("data-state", "idle", { timeout: 15_000 });
  await expect(positive).toBeEnabled(); await positive.click();
  await expect(page.getByText("You can lein this verse.", { exact: true })).toBeVisible();
});
