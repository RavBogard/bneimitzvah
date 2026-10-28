import { expect, test, type Page } from "@playwright/test";
import { syntheticCourseRoutes } from "./learn-synthetic";

const current = (page: Page) => page.locator("[data-preparation-stage]");
const at = (page: Page, stage: string) => expect(current(page)).toHaveAttribute("data-preparation-stage", stage);
const plays = (page: Page) => page.evaluate(() => (window as unknown as { learnPlays: string[] }).learnPlays.length);
test.beforeEach(async ({ page }) => { await syntheticCourseRoutes().install(page); });

test("a model outlines its actual sounding word; an independent attempt stops the recording and clears the outline", async ({ page }) => {
  await page.goto("/learn/torah-first-verse"); await at(page, "model");
  expect(await plays(page)).toBe(0);
  const familyBackgrounds = await page.locator("[data-preparation-stage] [data-unit]").evaluateAll(nodes =>
    Object.fromEntries(nodes.map(node => [node.getAttribute("data-unit"), getComputedStyle(node).backgroundColor])));
  await page.getByRole("button", { name: "Hear the whole verse", exact: true }).click();
  const marker = page.locator("[data-playback-active]");
  await expect(marker).toHaveCount(1);
  const first = await marker.getAttribute("data-unit");
  const css = await marker.evaluate(node => { const s = getComputedStyle(node); return { outline: s.outlineStyle, width: s.outlineWidth, background: s.backgroundColor }; });
  expect(css.outline).toBe("solid"); expect(css.width).toBe("2px"); expect(css.background).toBe(familyBackgrounds[first!]);
  await expect.poll(async () => marker.count().then(async n => n ? marker.getAttribute("data-unit") : first)).not.toBe(first);
  await page.getByRole("button", { name: "Go straight to a whole-verse attempt" }).click();
  await at(page, "whole-attempt"); await expect(marker).toHaveCount(0);
  const before = await plays(page); await page.waitForTimeout(700); expect(await plays(page)).toBe(before);
  await expect(page.getByRole("button", { name: /^Hear / })).toHaveCount(0);
  await page.getByRole("button", { name: "Compare the whole verse" }).click();
  await at(page, "whole-check"); expect(await plays(page)).toBe(before);
  await expect(page.getByRole("button", { name: "Hear the whole verse", exact: true })).toBeVisible();
});

test("a learner can repair a word or an uncertain tune, join parts, return later and keep existing progress", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("crc-torah:learn-progress/v1", JSON.stringify({ schema: "learn-progress/v1", lessons: { "torah-etnachta": { done: "2026-10-20T15:00:00.000Z" } }, cards: {} })));
  await page.goto("/learn/torah-first-verse"); await at(page, "model");
  await page.getByRole("button", { name: "Prepare the first part" }).click(); await at(page, "words");
  await page.getByRole("button", { name: "Hear and echo", exact: true }).click(); await at(page, "echo");
  await page.getByRole("button", { name: "Try without the recording", exact: true }).click(); await at(page, "attempt");
  expect(await plays(page)).toBe(0);
  await page.getByRole("button", { name: "Compare with the model", exact: true }).click();
  await page.getByRole("button", { name: "Work on a word", exact: true }).click(); await at(page, "word-repair");
  await page.locator("[data-unit][data-tap=answer]").first().click();
  await expect(page.getByRole("button", { name: "Hear this word", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Return to the whole phrase", exact: true }).click(); await at(page, "echo");
  await page.getByRole("button", { name: "Try without the recording", exact: true }).click();
  await page.getByRole("button", { name: "Compare with the model", exact: true }).click();
  await page.getByRole("button", { name: "I'm not sure", exact: true }).click(); await at(page, "unsure");
  await expect(page.getByRole("button", { name: "Hear the first word", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Return to the whole phrase", exact: true }).click();
  // Each actual phrase is prepared before the complete adjacent phrases are joined.
  for (let n = 0; n < 12; n++) {
    await page.getByRole("button", { name: "Try without the recording", exact: true }).click();
    await page.getByRole("button", { name: "Compare with the model", exact: true }).click();
    const next = page.getByRole("button", { name: "Prepare the next part", exact: true });
    if (!await next.count()) { await page.getByRole("button", { name: "Connect the parts", exact: true }).click(); break; }
    await next.click(); await page.getByRole("button", { name: "Hear and echo", exact: true }).click();
  }
  await at(page, "join-model");
  await page.getByRole("button", { name: "Try the join without the recording", exact: true }).click(); await at(page, "join-attempt");
  expect(await plays(page)).toBe(0);
  await page.getByRole("button", { name: "Compare the join", exact: true }).click(); await at(page, "join-check");
  await page.getByRole("button", { name: "Return later", exact: true }).click(); await at(page, "summary");
  await expect(page.getByText("Return later: try the part you prepared before replay.", { exact: false })).toBeVisible();
  await expect(page.getByText("You've practiced preparing a verse", { exact: false })).toHaveCount(0); // Daniel, answer 1: our ending only, gated
  await expect(page.getByText("You can lein this verse.", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Try this verse before replay", exact: true }).click(); await at(page, "whole-attempt");
  expect(await plays(page)).toBe(0);
  await page.getByRole("button", { name: "Return later", exact: true }).click();
  await page.getByRole("button", { name: "Finish practice", exact: true }).click();
  await expect(page.locator("main")).toHaveAttribute("data-step", "done");
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("crc-torah:learn-progress/v1")!));
  expect(saved.schema).toBe("learn-progress/v1"); expect(saved.lessons["torah-etnachta"]).toBeDefined(); expect(saved.lessons["torah-first-verse"]).toBeDefined();
});

test("whole-verse uncertainty can select any word or explicitly choose a part for tune repair", async ({ page }) => {
  await page.goto("/learn/torah-first-verse"); await at(page, "model");
  await page.getByRole("button", { name: "Go straight to a whole-verse attempt" }).click();
  await page.getByRole("button", { name: "Compare the whole verse", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Choose a part to practice", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Work on a word", exact: true }).click();
  const words = page.locator("[data-unit][data-tap=answer]"), count = await words.count();
  expect(count).toBeGreaterThan(2);
  const last = await words.last().getAttribute("data-unit"); await words.last().click();
  await expect(page.getByRole("button", { name: "Hear this word", exact: true })).toBeVisible();
  expect(await words.count()).toBeLessThan(count);
  await expect(words.last()).toHaveAttribute("data-unit", last!);
  await page.getByRole("button", { name: "Return to the whole phrase", exact: true }).click();
  await page.getByRole("button", { name: "Return later", exact: true }).click();
  await page.getByRole("button", { name: "Try this verse before replay", exact: true }).click();
  await page.getByRole("button", { name: "Compare the whole verse", exact: true }).click();
  await page.getByRole("button", { name: "Work on the tune", exact: true }).click(); await at(page, "choose-part");
  expect(await plays(page)).toBe(0);
  await page.getByRole("combobox", { name: "Choose a part to practice", exact: true }).selectOption("0"); await at(page, "tune-repair");
  await expect(page.getByRole("button", { name: "Hear the ending", exact: true })).toBeVisible();
});

test("a shorter stage reveals its focused prompt below the sticky bar after a low-page action", async ({ page }) => {
  await page.goto("/learn/torah-first-verse"); await at(page, "model");
  await page.getByText("Choose a part or use less help", { exact: true }).click();
  const lowerAction = page.getByRole("button", { name: "Find a starting point after a stumble", exact: true });
  await lowerAction.scrollIntoViewIfNeeded();
  await lowerAction.click(); await at(page, "recover");
  const prompt = current(page).getByRole("heading", { level: 2 });
  await expect(prompt).toBeFocused();
  await expect.poll(() => prompt.evaluate(node => {
    const rect = node.getBoundingClientRect(), bar = node.closest("main")?.previousElementSibling?.getBoundingClientRect();
    return rect.top >= (bar?.bottom ?? 0) + 8 && rect.bottom <= innerHeight;
  })).toBe(true);
});


test("the first-verse result is only a temporary explicit learner comparison", async ({ page }) => {
  await page.goto("/learn/torah-first-verse"); await at(page, "model");
  const result = page.getByText("You can lein this verse.", { exact: true });
  await expect(result).toHaveCount(0);
  await page.getByRole("button", { name: "Go straight to a whole-verse attempt" }).click();
  await page.getByRole("button", { name: "Compare the whole verse", exact: true }).click();
  await expect(result).toHaveCount(0);
  await page.getByRole("button", { name: "Not yet", exact: true }).click(); await at(page, "choose-part");
  await expect(result).toHaveCount(0);
  await page.getByRole("combobox", { name: "Choose a part to practice", exact: true }).selectOption("0"); await at(page, "words");
  await page.getByRole("button", { name: "Return later", exact: true }).click(); await at(page, "summary");
  await expect(result).toHaveCount(0);
  await page.getByRole("button", { name: "Try this verse before replay", exact: true }).click();
  await page.getByRole("button", { name: "Compare the whole verse", exact: true }).click();
  await page.getByRole("button", { name: "Same as the reader", exact: true }).click(); await at(page, "summary");
  await expect(result).toBeVisible();
  await expect(page.getByText("Based on your comparison with the reader.", { exact: false })).toHaveCount(0); // the approved line stands alone
  expect(await plays(page)).toBe(0);
  await page.getByRole("button", { name: "Finish practice", exact: true }).click();
  await expect(page.locator("main")).toHaveAttribute("data-step", "done"); await expect(result).toHaveCount(0);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("crc-torah:learn-progress/v1")!));
  expect(Object.keys(saved).sort()).toEqual(["cards", "lessons", "schema"]);
  expect(Object.keys(saved.lessons["torah-first-verse"])).toEqual(["done"]);
  expect(JSON.stringify(saved)).not.toMatch(/selfComparison|accuracy|same-as|certif/i);
});
