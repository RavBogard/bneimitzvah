import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { join } from "node:path";
import { syntheticCourseRoutes } from "./learn-synthetic";
import { answerRight } from "./learn-drill";

// 1.6: Same sign, different place; Which half of the verse; Quick ten. The built, unconfigured production server, with
// every public answer a synthetic route fulfilment (invented syllables, lessons.json's own words, a generated tone).
const KEY = "crc-torah:learn-progress/v1";
const day = "2026-10-20T15:00:00.000Z";
const progress = (lessons: string[], cards: Record<string, { box: number; due: string }> = {}) =>
  JSON.stringify({ schema: "learn-progress/v1", lessons: Object.fromEntries(lessons.map(id => [id, { done: day }])), cards });
const introDone = progress(["intro-phrases"]);
const plays = (page: Page) => page.evaluate(() => (window as unknown as { learnPlays: string[] }).learnPlays.length);
const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
async function seed(page: Page, value: string) { await page.addInitScript(([key, text]) => { if (!sessionStorage.getItem("seeded")) { localStorage.setItem(key, text); sessionStorage.setItem("seeded", "1"); } }, [KEY, value]); }
/** Phone screenshots at 390 px, desktop at its own size; the tablet project takes none. */
async function shot(page: Page, testInfo: TestInfo, name: string) {
  if (testInfo.project.name === "tablet") return;
  await page.evaluate(async () => { await document.fonts.ready; });
  const dir = process.env.LEARN16_SHOTS;
  await page.screenshot({ path: dir ? join(dir, `${name}-${testInfo.project.name}.png`) : testInfo.outputPath(`${name}.png`), fullPage: true });
}
async function phoneWidth(page: Page, testInfo: TestInfo) { if (testInfo.project.name === "phone") await page.setViewportSize({ width: 390, height: 844 }); }
/** Enter explicit optional exercises through examples/models, then answer until the target heading. */
async function drillUntil(page: Page, heading: RegExp) {
  await page.getByRole("button", { name: "Examples", exact: true }).click();
  await expect(page.getByRole("heading", { name: "In verses" })).toBeVisible();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Models for optional recognition", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Start optional questions", exact: true }).click();
  for (let i = 0; i < 30; i++) {
    await expect(page.locator("main h2").first()).toBeVisible();
    if (heading.test(await page.locator("main h2").first().innerText())) return i;
    await answerRight(page);
    const next = page.getByRole("button", { name: "Next", exact: true });
    await expect(next).toBeEnabled(); await next.click();
  }
  throw new Error("never reached");
}

test("same sign, different place: the tap answers and plays nothing, then the tell, the mark names, the word card and the two words", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const routes = syntheticCourseRoutes(); await routes.install(page); await seed(page, introDone); await phoneWidth(page, testInfo);
  await page.goto("/learn/torah-azla");
  await expect(page.locator("main[data-step=hear]")).toBeVisible({ timeout: 20_000 });
  // Eight right in a row lets the lesson's other drills go, but never its look-alikes.
  const reached = await drillUntil(page, /^Which one is (?:pashta|kadma|azla)\?$/);
  expect(reached).toBeLessThanOrEqual(8);
  await expect(page.getByText("Some marks look alike. Where they sit tells you which one it is.")).toBeVisible();
  await expect(page.locator("main button[data-look]")).toHaveCount(2);
  for (const box of await page.locator("main button[data-look]").evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().height))) expect(box).toBeGreaterThanOrEqual(56);
  if (testInfo.project.name === "phone") expect(await noHorizontalScroll(page)).toBe(true);
  await shot(page, testInfo, "look-alikes-question");
  const before = await plays(page);
  await answerRight(page);
  expect(await plays(page), "the tap is the answer and plays nothing").toBe(before);
  await expect(page.getByRole("status").filter({ hasText: /^(?:Pashta|Two pashtas|Kadma|Azla)/ })).toBeVisible();
  await expect(page.locator("main [data-look][data-state=right]")).toHaveCount(1);
  await expect(page.locator("main [data-look] [class*=lookMark]").first()).toHaveText(/^(?:pashta|kadma|azla)$/);
  // Once answered, a word opens its card, never trope.
  await page.locator("main [data-look] [data-word-card]").first().click();
  await expect(page.getByRole("dialog")).toContainText(/Synthetic gloss for word \d+/);
  await page.keyboard.press("Escape");
  expect(await plays(page)).toBe(before);
  await page.locator("main [data-answer]").getByRole("button", { name: "Hear it" }).click();
  await expect.poll(() => plays(page)).toBeGreaterThan(before);
  await shot(page, testInfo, "look-alikes-answered");
  // The rest of the lesson finishes; look-alikes move no review card.
  for (let i = 0; i < 20 && await page.locator("main").getAttribute("data-step") !== "done"; i++) {
    const next = page.getByRole("button", { name: "Next", exact: true });
    if (await next.isDisabled()) await answerRight(page);
    await next.click();
  }
  await expect(page.locator("main[data-step=done]")).toBeVisible();
  const stored = JSON.parse((await page.evaluate(key => localStorage.getItem(key), KEY))!);
  expect(Object.keys(stored.cards).sort()).toEqual(["azla:torah:find", "azla:torah:name"]);
});

test("azla or geresh shows each word with the word before it, and is reading only", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const routes = syntheticCourseRoutes(); await routes.install(page); await seed(page, introDone); await phoneWidth(page, testInfo);
  await page.goto("/learn/haftarah-azla");
  await expect(page.locator("main[data-step=hear]")).toBeVisible({ timeout: 20_000 });
  await drillUntil(page, /^Which one is (?:azla|geresh|pashta|kadma)\?$/);
  for (let i = 0; i < 3; i++) {
    const prompt = await page.locator("main h2").first().innerText();
    if (/^Which one is (?:azla|geresh)\?$/.test(prompt)) {
      // The word before, muted, beside each word; nothing plays before the answer.
      await expect(page.locator("main button[data-look] [class*=contextWord]")).toHaveCount(2);
      await expect(page.locator("main [data-look] ~ * button[class*=play], main [class*=playRow]")).toHaveCount(0);
      await shot(page, testInfo, "azla-geresh-question");
      break;
    }
    await answerRight(page); await page.getByRole("button", { name: "Next", exact: true }).click();
  }
});

test("which half of the verse: the verse plays from its start up to the phrase, nothing marks the phrase until the answer, then it is underlined and its half takes its tint", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const routes = syntheticCourseRoutes(); await routes.install(page); await seed(page, introDone); await phoneWidth(page, testInfo);
  await page.goto("/learn/haftarah-zakef");
  await expect(page.locator("main[data-step=hear]")).toBeVisible({ timeout: 20_000 });
  const before = await plays(page);
  await drillUntil(page, /^The verse plays up to one phrase\. Is that phrase before the rest, or after it\?$/);
  await expect.poll(() => plays(page)).toBeGreaterThan(before);
  // Hide until answered (Daniel, 2026-10-23): no underline, no half, nothing in the verse's accessible text that names the phrase.
  await expect(page.locator("main [data-rest-unit] [class*=underlined]")).toHaveCount(0);
  await expect(page.locator("main [data-half]")).toHaveCount(0);
  await expect(page.locator("main [data-rest-unit] [aria-label], main [data-rest-unit] [role=button]")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Before the rest" })).toBeVisible();
  await expect(page.getByRole("button", { name: "After the rest" })).toBeVisible();
  if (testInfo.project.name === "phone") expect(await noHorizontalScroll(page)).toBe(true);
  await shot(page, testInfo, "which-half-question");
  await page.locator("main button[class*=choice]:not([data-right])").click();
  const half = await page.locator("main [data-half]").getAttribute("data-half");
  await expect(page.locator("main [data-rest-unit] [class*=underlined]").first()).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: half === "before" ? "Before the rest: this phrase is in the first half." : "After the rest: this phrase is in the second half, on the way to the ending." })).toBeVisible();
  await expect(page.locator("main [data-rest-unit] [class*=halfTint]").first()).toBeVisible();
  await expect(page.locator("main [data-rest-unit] [data-family=etnachta]").first()).toBeVisible();
  await shot(page, testInfo, "which-half-answered");
});

test("Quick ten opens after three phrases, runs one phrase after another with no Next button, and Stop here ends it", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const routes = syntheticCourseRoutes(); await routes.install(page);
  const lessons = ["intro-phrases", "torah-sof-pasuk", "torah-etnachta", "torah-zakef"], due = { box: 1, due: "2099-01-01" };
  await seed(page, progress(lessons, { "sof-pasuk:torah:name": due, "etnachta:torah:name": due, "zakef:torah:name": due, "zakef:torah:find": due }));
  await phoneWidth(page, testInfo);
  await page.goto("/learn");
  const row = page.getByRole("link", { name: "Quick ten: ten phrases, one after another, about 2 minutes" });
  await expect(row).toHaveAttribute("href", "/learn/practice/quick-ten-torah");
  await shot(page, testInfo, "quick-ten-home");
  await row.click();
  await expect(page).toHaveURL(/\/learn\/practice\/quick-ten-torah$/);
  await expect(page).toHaveTitle("Quick ten | Learn to lein | CRC Torah");
  await expect(page.getByRole("heading", { name: "Which phrase is this?" })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: "Next", exact: true })).toHaveCount(0);
  await expect(page.locator("main button[class*=choice]")).toHaveCount(3);
  // T3 P4-3: a position under the bar, never a score.
  await expect(page.locator("[data-quick-ten-position]")).toHaveText("Phrase 1 of 10");
  if (testInfo.project.name === "phone") expect(await noHorizontalScroll(page)).toBe(true);
  await shot(page, testInfo, "quick-ten-question");
  // A miss, then the next phrase follows on its own once the comparison has played and the verse has shown.
  await page.locator("main button[class*=choice]:not([data-right])").first().click();
  await expect(page.locator("main [data-answer]")).toBeVisible();
  await shot(page, testInfo, "quick-ten-answered");
  await expect(page.locator("main button[class*=choice]:not([disabled])").first()).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("[data-quick-ten-position]")).toHaveText("Phrase 2 of 10");
  await page.locator("main button[class*=choice][data-right]").first().click();
  await expect(page.locator("main button[class*=choice]:not([disabled])").first()).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("[data-quick-ten-position]")).toHaveText("Phrase 3 of 10");
  await page.getByRole("button", { name: "Stop here" }).click();
  await expect(page.getByText("Done. The ones you missed come back in review.")).toBeVisible();
  await shot(page, testInfo, "quick-ten-done");
  const stored = JSON.parse((await page.evaluate(key => localStorage.getItem(key), KEY))!);
  // The miss dropped its name card and brought it back today; Quick ten records no lesson.
  expect(Object.values(stored.cards as Record<string, { box: number; due: string }>).some(card => card.box === 0)).toBe(true);
  expect(Object.keys(stored.lessons).sort()).toEqual([...lessons].sort());
  expect(routes.seen.every(path => path.startsWith("/api/public/"))).toBe(true);
});

test("before three phrases, Quick ten says when it opens and the home shows no row", async ({ page }) => {
  const routes = syntheticCourseRoutes(); await routes.install(page); await seed(page, introDone);
  await page.goto("/learn");
  await expect(page.locator("[data-next]")).toBeVisible();
  await expect(page.locator("[data-practice]")).toHaveCount(0);
  await page.goto("/learn/practice/quick-ten-torah");
  await expect(page.getByText("Quick ten opens after three phrases.")).toBeVisible();
  expect((await page.goto("/learn/practice/not-a-run"))?.status()).toBe(404);
});
