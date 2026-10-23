import { expect, test, type Page } from "@playwright/test";
import { syntheticCourseRoutes } from "./learn-synthetic";

// The built, unconfigured production server. Every public answer is a synthetic route fulfilment
// (invented syllables and a generated tone), so the course's own client code is what is under test.
const KEY = "crc-torah:learn-progress/v1";
const introDone = JSON.stringify({ schema: "learn-progress/v1", lessons: { "intro-phrases": { done: "2026-10-20T15:00:00.000Z" } }, cards: {} });
const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
const plays = (page: Page) => page.evaluate(() => (window as unknown as { learnPlays: string[] }).learnPlays.length);
async function seed(page: Page, value: string) { await page.addInitScript(([key, text]) => { if (!sessionStorage.getItem("seeded")) { localStorage.setItem(key, text); sessionStorage.setItem("seeded", "1"); } }, [KEY, value]); }

/** Answers whatever drill is on screen, rightly unless told otherwise. */
async function answer(page: Page, right: boolean) {
  const main = page.locator("main");
  const choice = main.locator(`button[class*=choice]${right ? "[data-right]" : ":not([data-right])"}`).first();
  if (await choice.count()) return choice.click();
  const end = main.locator("[data-end-unit]");
  if (await end.count()) { const unit = await end.getAttribute("data-end-unit"); return main.locator(`[data-end-unit] [data-unit="${right ? unit : "0"}"]`).click(); }
  const tap = main.locator("[data-target-phrase]");
  if (await tap.count()) { const target = await tap.getAttribute("data-target-phrase"); return main.locator(`[data-phrase-target="${right ? target : target === "0" ? "1" : "0"}"]`).click(); }
  for (let k = 0; k < 6; k++) {
    const tile = main.locator(`button[class*=tile][data-order="${k}"]:not([disabled])`).first();
    if (!(await tile.count())) break;
    await tile.click();
  }
}

test("a learner opens the course, hears a phrase, misses one item and gets it back, and finishes the lesson; progress survives a reload", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const routes = syntheticCourseRoutes(); await routes.install(page); await seed(page, introDone);
  const response = await page.goto("/learn");
  expect(response?.status()).toBe(200);
  expect(response?.headers()["x-robots-tag"]).toBe("noindex, nofollow");
  await expect(page).toHaveTitle("Learn to lein | CRC Torah");
  await expect(page.getByRole("heading", { level: 1, name: "Learn to lein" })).toBeVisible();
  await expect(page.getByText("About ten short phrases make up the whole tune.")).toBeVisible();
  const next = page.locator("[data-next]");
  await expect(next).toHaveAttribute("data-next", "torah-sof-pasuk");
  await expect(page.getByText("Can hear: 0 of 10 Torah phrases · 0 of 11 haftarah phrases")).toBeVisible();
  await expect(page.getByText("Progress is saved on this device. Sign in to keep it.")).toBeVisible();
  await next.getByRole("link", { name: "Start" }).click();
  await expect(page).toHaveURL(/\/learn\/torah-sof-pasuk$/);

  // Hear it: the family chip, the Hebrew phrase over its colour, and a human-recording cut that plays.
  await expect(page.locator("main[data-step=hear]")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator("main [data-family-chip=sof-pasuk]")).toBeVisible();
  const before = await plays(page);
  await page.getByRole("button", { name: "Hear it" }).click();
  await expect.poll(() => plays(page)).toBeGreaterThan(before);
  // The cut itself loaded, passed its checksum and decode, and is playing: the tile says so.
  await expect(page.locator("main button[data-state=playing]")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("The recording did not load. Try again.")).toHaveCount(0);
  const sizes = await page.evaluate(() => {
    const hebrew = [...document.querySelectorAll("main [lang=he]")].map(node => parseFloat(getComputedStyle(node).fontSize));
    const other = [...document.querySelectorAll("main h1, main h2, main p:not([lang]), main button")].map(node => parseFloat(getComputedStyle(node).fontSize));
    return { hebrew: Math.max(...hebrew), other: Math.max(...other) };
  });
  expect(sizes.hebrew, "the Hebrew is the largest text").toBeGreaterThan(sizes.other);
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByRole("heading", { name: "In verses" })).toBeVisible();
  await page.getByRole("button", { name: "Next", exact: true }).click();

  // Drills: the first item is answered wrong, comes back later, and is answered right.
  let missedPrompt = "", sawFeedback = false;
  for (let i = 0; i < 40; i++) {
    const step = await page.locator("main").getAttribute("data-step");
    if (step === "done") break;
    await expect(page.locator("main h2").first()).toBeVisible();
    const prompt = await page.locator("main h2").first().innerText();
    if (i === 0) {
      missedPrompt = prompt; await answer(page, false);
      if (prompt === "Which phrase is this?") { await expect(page.getByText(/^That one is .+\. Here is .+ for comparison\.$/)).toBeVisible(); sawFeedback = true; }
    } else await answer(page, true);
    const nextButton = page.getByRole("button", { name: "Next", exact: true });
    await expect(nextButton).toBeEnabled();
    if (i === 1 && testInfo.project.name === "phone") expect(await noHorizontalScroll(page)).toBe(true);
    await nextButton.click();
  }
  expect(missedPrompt).not.toBe("");
  if (missedPrompt === "Which phrase is this?") expect(sawFeedback).toBe(true);

  // Done: a plain fact, then this week's reading, then the next step.
  await expect(page.locator("main[data-step=done]")).toBeVisible();
  await expect(page.getByText("You can hear the end of a verse coming and know the mark that ends it.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "In this week's reading" })).toBeVisible();
  await expect(page.locator("main [class*=weekRows] li").first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Next: Etnachta")).toBeVisible();
  await expect(page.getByRole("link", { name: "Start next lesson" })).toHaveAttribute("href", "/learn/torah-etnachta");
  const stored = JSON.parse((await page.evaluate(key => localStorage.getItem(key), KEY))!);
  expect(Object.keys(stored.lessons).sort()).toEqual(["intro-phrases", "torah-sof-pasuk"]);
  expect(stored.cards["sof-pasuk:torah:name"].box).toBe(1);

  await page.getByRole("link", { name: "Back to the path" }).last().click();
  await expect(page).toHaveURL(/\/learn$/);
  await expect(page.locator("[data-next]")).toHaveAttribute("data-next", "torah-etnachta");
  await expect(page.getByText("Can hear: 1 of 10 Torah phrases · 0 of 11 haftarah phrases")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Can hear: 1 of 10 Torah phrases · 0 of 11 haftarah phrases")).toBeVisible();
  await expect(page.locator('a[href="/learn/torah-sof-pasuk"] [data-state=done]')).toBeVisible();
  // Nothing is due today; the review line appears only when a phrase is.
  await expect(page.getByRole("link", { name: /^Review:/ })).toHaveCount(0);
  expect(routes.seen.every(path => path.startsWith("/api/public/"))).toBe(true);
});

test("a corrupt saved value means a fresh start, never an error", async ({ page }) => {
  const routes = syntheticCourseRoutes(); await routes.install(page); await seed(page, "{not json");
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto("/learn");
  await expect(page.locator("[data-next]")).toHaveAttribute("data-next", "intro-phrases");
  await expect(page.getByText("Can hear: 0 of 10 Torah phrases · 0 of 11 haftarah phrases")).toBeVisible();
  await expect(page.getByText("Best after The two endings.")).toBeVisible();
  await page.goto("/learn/review");
  await expect(page.getByText("Nothing to review yet. Finish a lesson and its phrases come back here.")).toBeVisible();
  expect(errors).toEqual([]);
});

test("at 360px the home, a lesson and a drill fit with no sideways scroll and 56px targets", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "phone", "phone layout");
  const routes = syntheticCourseRoutes(); await routes.install(page); await seed(page, introDone);
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto("/learn");
  await expect(page.locator("[data-next]")).toBeVisible();
  expect(await noHorizontalScroll(page)).toBe(true);
  const start = await page.locator("[data-next]").getByRole("link", { name: "Start" }).boundingBox();
  expect(start!.height).toBeGreaterThanOrEqual(56);
  await page.goto("/learn/torah-etnachta");
  await expect(page.locator("main[data-step=hear]")).toBeVisible({ timeout: 20_000 });
  expect(await noHorizontalScroll(page)).toBe(true);
  for (let i = 0; i < 2; i++) await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.locator("main[data-step=drill]")).toBeVisible();
  expect(await noHorizontalScroll(page)).toBe(true);
  for (const box of await page.locator("main button[class*=choice], main button[class*=play]").evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().height))) expect(box).toBeGreaterThanOrEqual(56);
  await page.evaluate(async () => { await document.fonts.ready; });
  await page.screenshot({ path: testInfo.outputPath("learn-drill-360.png"), fullPage: true });
});

test("when the recordings do not answer, a lesson says so and offers Try again; nothing is marked done", async ({ page }) => {
  const routes = syntheticCourseRoutes(); await routes.install(page); await seed(page, introDone);
  await page.route("**/api/public/reference/short?*", route => route.fulfill({ status: 503, contentType: "application/json", body: "{}" }));
  await page.goto("/learn/torah-sof-pasuk");
  await expect(page.getByText("The recording did not load. Try again.")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Next", exact: true })).toHaveCount(0);
  const stored = JSON.parse((await page.evaluate(key => localStorage.getItem(key), KEY))!);
  expect(Object.keys(stored.lessons)).toEqual(["intro-phrases"]);
});
