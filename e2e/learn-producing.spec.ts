import { expect, test, type Page } from "@playwright/test";
import { syntheticCourseRoutes } from "./learn-synthetic";

// N18, producing the chant. The built production server, every public answer a synthetic route fulfilment.
const KEY = "crc-torah:learn-progress/v1";
const day = "2026-10-20T15:00:00.000Z";
const progress = (lessons: string[], cards: Record<string, { box: number; due: string }> = {}) =>
  JSON.stringify({ schema: "learn-progress/v1", lessons: Object.fromEntries(lessons.map(id => [id, { done: day }])), cards });
// The player first plays a tiny silent clip to unlock audio, then the reader's clip. Only the reader's clips count as plays here.
const plays = (page: Page) => page.evaluate(() => (window as unknown as { readerPlays: number }).readerPlays);
async function seed(page: Page, value: string) { await page.addInitScript(([key, text]) => { if (!sessionStorage.getItem("seeded")) { localStorage.setItem(key, text); sessionStorage.setItem("seeded", "1"); } }, [KEY, value]); }
const reviewing = (card: string, box: number) => progress(["torah-etnachta", "torah-zakef"], { [card]: { box, due: "2026-10-20" } });
test.beforeEach(async ({ page }) => {
  await syntheticCourseRoutes().install(page);
  await page.addInitScript(() => {
    const target = window as unknown as { readerPlays: number }, sizes = new Map<string, number>(), make = URL.createObjectURL.bind(URL), play = HTMLMediaElement.prototype.play;
    target.readerPlays = 0;
    URL.createObjectURL = (object: Blob | MediaSource) => { const url = make(object); if (object instanceof Blob) sizes.set(url, object.size); return url; };
    HTMLMediaElement.prototype.play = function () { if ((sizes.get(this.src) ?? 0) > 1000) target.readerPlays++; return play.call(this); };
  });
});

test("Hear it plays once when a question opens, and again only when it is tapped", async ({ page }) => {
  await seed(page, progress(["intro-phrases"]));
  await page.goto("/learn/torah-sof-pasuk");
  await page.getByRole("button", { name: "Try the sound", exact: true }).click();
  await page.getByRole("button", { name: "Try this familiar phrase directly", exact: true }).click();
  await page.getByRole("button", { name: "Compare with the reader", exact: true }).click();
  await page.getByRole("button", { name: "Optional recognition practice", exact: true }).click();
  const model = page.locator("[data-sound-anchors] li").filter({ has: page.locator("[data-family-chip=etnachta]") }).getByRole("button", { name: /^Hear / });
  await model.click(); await expect(model).toHaveAttribute("data-state", "idle", { timeout: 10_000 });
  const before = await plays(page);
  await page.getByRole("button", { name: "Start optional questions", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Which phrase is this?", exact: true })).toBeVisible();
  await expect.poll(() => plays(page)).toBe(before + 1);
  await page.waitForTimeout(800);
  expect(await plays(page)).toBe(before + 1); // one play call on open: the tile replays on a tap, nothing else does
  const tile = page.getByRole("main").getByRole("button", { name: "Hear it", exact: true });
  await expect(tile).toHaveAttribute("data-state", "idle", { timeout: 10_000 });
  await tile.click();
  await expect.poll(() => plays(page)).toBe(before + 2);
});

test("a zakef ending question makes no sound before an answer, underlines the closing word after it, and then offers the phrase", async ({ page }) => {
  await seed(page, reviewing("zakef:torah:end", 0));
  await page.goto("/learn/review");
  await expect(page.getByRole("heading", { name: "Tap the word where the phrase ends.", exact: true })).toBeVisible({ timeout: 20_000 });
  expect(await plays(page)).toBe(0);
  await page.waitForTimeout(800);
  expect(await plays(page)).toBe(0);
  const main = page.locator("main");
  await expect(main.getByRole("button", { name: "Hear it", exact: true })).toHaveCount(0);
  const unit = await main.locator("[data-end-unit]").getAttribute("data-end-unit");
  await expect(main.locator(`[data-end-unit] [data-unit="${unit}"]`)).not.toHaveClass(/underlined/);
  await main.locator(`[data-end-unit] [data-unit="${unit}"]`).click();
  await expect(main.locator(`[data-end-unit] [data-unit="${unit}"]`)).toHaveClass(/underlined/);
  expect(await plays(page)).toBe(0);
  const tile = main.getByRole("button", { name: "Hear it", exact: true });
  await expect(tile).toBeVisible();
  await tile.click();
  await expect.poll(() => plays(page)).toBe(1);
});

test("a box 3 ending card from before zakef is asked with no recording first", async ({ page }) => {
  await seed(page, reviewing("etnachta:torah:end", 3));
  await page.goto("/learn/review");
  await expect(page.getByRole("heading", { name: "Tap the word where the phrase ends.", exact: true })).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(800);
  expect(await plays(page)).toBe(0);
  await expect(page.locator("main").getByRole("button", { name: "Hear it", exact: true })).toHaveCount(0);
});

test("a box 2 ending card from before zakef still plays its phrase on open", async ({ page }) => {
  await seed(page, reviewing("etnachta:torah:end", 2));
  await page.goto("/learn/review");
  await expect(page.getByRole("heading", { name: "Tap the word where the phrase ends.", exact: true })).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => plays(page)).toBe(1);
  await expect(page.locator("main").getByRole("button", { name: "Hear it", exact: true })).toBeVisible();
});

test("a box 3 naming card from zakef on is read first: text, no recording, then the pick plays the phrase", async ({ page }) => {
  await seed(page, reviewing("zakef:torah:name", 3));
  await page.goto("/learn/review");
  await expect(page.getByRole("heading", { name: "Read it, then pick the tune", exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Sing it (in your head or out loud), then check.", { exact: true })).toBeVisible();
  await page.waitForTimeout(800);
  expect(await plays(page)).toBe(0);
  const main = page.locator("main");
  await expect(main.getByRole("button", { name: "Hear it", exact: true })).toHaveCount(0);
  expect(await main.locator("[data-unit]").count()).toBeGreaterThan(1);
  await main.locator("button[class*=choice]:not([data-right])").first().click();
  await expect(main.locator("[data-read-result]")).toHaveText("Not quite");
  await expect(main.getByRole("link", { name: /^More about / })).toBeVisible();
  await expect.poll(() => plays(page)).toBeGreaterThan(0);
});

test("a box 2 naming card still plays the phrase on open, with the ordinary prompt", async ({ page }) => {
  await seed(page, reviewing("zakef:torah:name", 2));
  await page.goto("/learn/review");
  await expect(page.getByRole("heading", { name: "Which phrase is this?", exact: true })).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => plays(page)).toBe(1);
});

test("the first-verse path shows Your turn before it can say You can lein this verse, and says it only after Same as the reader", async ({ page }) => {
  await seed(page, progress(["torah-etnachta"]));
  const verdict = page.getByText("You can lein this verse.", { exact: true }), stage = page.locator("[data-preparation-stage]");
  const turn = page.getByText("Chant it without the recording. Then hear the reader.", { exact: true });
  await page.goto("/learn/torah-first-verse");
  await expect(stage).toHaveAttribute("data-preparation-stage", "model");
  await page.getByRole("button", { name: "Prepare the first part", exact: true }).click();
  await page.getByRole("button", { name: "Hear and echo", exact: true }).click();
  await expect(verdict).toHaveCount(0);
  await page.getByRole("button", { name: "Try without the recording", exact: true }).click();
  await expect(stage).toHaveAttribute("data-preparation-stage", "attempt");
  await expect(stage.getByRole("heading", { name: "Your turn", exact: true })).toBeVisible();
  await expect(turn).toBeVisible();
  await expect(verdict).toHaveCount(0);
  expect(await plays(page)).toBe(0);
  for (let n = 0; n < 12; n++) {
    await page.getByRole("button", { name: "Compare with the model", exact: true }).click();
    await expect(verdict).toHaveCount(0);
    const next = page.getByRole("button", { name: "Prepare the next part", exact: true });
    if (!await next.count()) { await page.getByRole("button", { name: "Connect the parts", exact: true }).click(); break; }
    await next.click(); await page.getByRole("button", { name: "Hear and echo", exact: true }).click();
    await page.getByRole("button", { name: "Try without the recording", exact: true }).click();
  }
  for (let n = 0; n < 12; n++) {
    await page.getByRole("button", { name: "Try the join without the recording", exact: true }).click();
    await page.getByRole("button", { name: "Compare the join", exact: true }).click();
    await expect(verdict).toHaveCount(0);
    const more = page.getByRole("button", { name: "Connect the next parts", exact: true });
    if (!await more.count()) break;
    await more.click();
  }
  await page.getByRole("button", { name: "Try the whole verse", exact: true }).click();
  await expect(stage).toHaveAttribute("data-preparation-stage", "whole-attempt");
  await expect(stage.getByRole("heading", { name: "Your turn", exact: true })).toBeVisible();
  await expect(verdict).toHaveCount(0);
  await page.getByRole("button", { name: "Compare the whole verse", exact: true }).click();
  await expect(stage).toHaveAttribute("data-preparation-stage", "whole-check");
  await expect(verdict).toHaveCount(0);
  await page.getByRole("button", { name: "Same as the reader", exact: true }).click();
  await expect(stage).toHaveAttribute("data-preparation-stage", "summary");
  await expect(verdict).toBeVisible();
});
