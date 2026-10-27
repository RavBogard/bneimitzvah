import { expect, test, type Page } from "@playwright/test";
import { syntheticCourseRoutes } from "./learn-synthetic";

const stage = (page: Page, value: string) => expect(page.locator("[data-passage-stage]")).toHaveAttribute("data-passage-stage", value);
const plays = (page: Page) => page.evaluate(() => (window as unknown as { learnPlays: string[] }).learnPlays.length);
const readableScore = async (page: Page) => {
  const sizes = await page.locator("[data-passage-stage] p[lang=he]").evaluateAll(nodes => ({
    hebrew: nodes.map(node => parseFloat(getComputedStyle(node).fontSize)), body: parseFloat(getComputedStyle(document.body).fontSize),
  }));
  expect(sizes.hebrew.length).toBeGreaterThan(0);
  for (const size of sizes.hebrew) { expect(size).toBeGreaterThanOrEqual(32); expect(size).toBeGreaterThan(sizes.body); }
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
};
test.beforeEach(async ({ page }) => { await syntheticCourseRoutes().install(page); });

test("optional starting suggestions follow the main next action and support keyboard melody changes", async ({ page }, testInfo) => {
  await page.goto("/learn");
  const picker = page.getByText("Choose a starting point", { exact: true });
  await expect(page.getByRole("link", { name: "New to chanting: hear the first phrase", exact: true })).not.toBeVisible();
  const start = page.getByRole("link", { name: "Start", exact: true });
  await expect(start).toBeVisible();
  expect((await start.boundingBox())!.y).toBeLessThan((await picker.boundingBox())!.y);
  await page.screenshot({ path: testInfo.outputPath("learning-start-closed.png"), fullPage: true });
  await picker.focus(); await page.keyboard.press("Enter");
  const melody = page.getByRole("combobox", { name: "Choose a melody", exact: true });
  await expect(melody).toBeVisible();
  await melody.selectOption("haftarah");
  await expect(page.getByRole("link", { name: "New to chanting: hear the first phrase", exact: true })).toHaveAttribute("href", "/learn/haftarah-sof-pasuk");
  await expect(page.getByRole("link", { name: "Learned some by ear: prepare a short passage", exact: true })).toHaveAttribute("href", "/learn/prepare?kind=haftarah");
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  await page.screenshot({ path: testInfo.outputPath("learning-start-open.png"), fullPage: true });
});

test("a signed-out visitor chooses contiguous verses, practices their boundary and attempts without sounding reference", async ({ page }) => {
  await page.goto("/learn/prepare?ref=Genesis+12%3A1-3&kind=torah");
  await stage(page, "choose");
  await expect(page.getByRole("combobox", { name: "Start at", exact: true })).toHaveValue("0");
  await expect(page.getByRole("combobox", { name: "Through", exact: true })).toHaveValue("1");
  await page.getByRole("button", { name: "Prepare this section", exact: true }).click();
  await stage(page, "preview");
  await readableScore(page);
  await page.getByRole("button", { name: "Hear the section's verse models", exact: true }).click();
  await expect.poll(() => plays(page)).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Try the whole section without the recording", exact: true }).click();
  await stage(page, "attempt");
  await expect(page.locator("[data-playback-active]")).toHaveCount(0);
  const count = await plays(page); await page.waitForTimeout(650); expect(await plays(page)).toBe(count);
  await expect(page.getByRole("button", { name: /^Hear / })).toHaveCount(0);
  await page.getByRole("button", { name: "Compare after my attempt", exact: true }).click();
  await stage(page, "compare");
  expect(await plays(page)).toBe(count);
  await page.getByRole("button", { name: "Boundary: Genesis 12:1 → Genesis 12:2", exact: true }).click();
  await stage(page, "boundary");
  await readableScore(page);
  await expect(page.getByRole("heading", { name: "Connect two verses", exact: true })).toBeFocused();
  const skip = page.getByRole("link", { name: "Skip to passage preparation", exact: true });
  expect(await skip.evaluate(node => node.getBoundingClientRect().bottom)).toBeLessThanOrEqual(0);
  await expect(page.getByText("These are separate verse models", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Try this boundary without the recording", exact: true }).click();
  await stage(page, "boundary-attempt");
  await expect(page.getByRole("button", { name: /^Hear / })).toHaveCount(0);
  await page.getByRole("button", { name: "Compare this boundary", exact: true }).click();
  await page.getByRole("button", { name: "Revisit the new verse's opening", exact: true }).click();
  await stage(page, "verse");
  await expect(page.locator("[data-preparation-stage]")).toHaveAttribute("data-preparation-stage", "model");
});

test("comparison offers exact verse repair, recovery and an honest public return link plus new-passage transfer", async ({ page }) => {
  await page.goto("/learn/prepare?ref=Genesis+12%3A1-4&kind=torah");
  await page.getByRole("button", { name: "Prepare this section", exact: true }).click();
  await page.getByRole("button", { name: "Try the whole section without the recording", exact: true }).click();
  await page.getByRole("button", { name: "Compare after my attempt", exact: true }).click();
  await page.getByRole("button", { name: "Revisit Genesis 12:2", exact: true }).click();
  await stage(page, "verse");
  await page.getByRole("button", { name: "Try the whole section without the recording", exact: true }).click();
  await page.getByRole("button", { name: "Compare after my attempt", exact: true }).click();
  await page.getByRole("button", { name: "Practise finding my place", exact: true }).click();
  await stage(page, "recover");
  await page.getByRole("combobox", { name: "Restart at", exact: true }).selectOption("1");
  await expect(page.locator("[data-passage-stage=recover] p[lang=he]")).toHaveCount(1);
  await page.getByRole("button", { name: "Try the section again", exact: true }).click();
  expect(await plays(page)).toBe(0);
  await page.getByRole("button", { name: "Compare after my attempt", exact: true }).click();
  await page.getByRole("button", { name: "Choose a return point", exact: true }).click();
  await stage(page, "summary");
  const link = page.getByRole("link", { name: "Return later to Genesis 12:1-2", exact: true });
  const target = new URL((await link.getAttribute("href"))!, "https://example.test");
  expect(target.searchParams.get("ref")).toBe("Genesis 12:1-2");
  await expect(page.getByText("This link reopens the public text. It doesn't save your practice step.", { exact: true })).toBeVisible();
  await page.getByText("Use fewer cues or try Tikkun", { exact: true }).click();
  const lein = new URL((await page.getByRole("link", { name: "Open this exact section in Lein / Tikkun" }).getAttribute("href"))!, "https://example.test");
  expect(lein.searchParams.get("ref")).toBe("Genesis 12:1-2");
  await page.getByRole("button", { name: "Prepare another passage", exact: true }).click();
  await stage(page, "choose");
  await expect(page.getByRole("combobox", { name: "Start at", exact: true })).toHaveValue("2");
  await expect(page.getByRole("combobox", { name: "Through", exact: true })).toHaveValue("3");
});

test("invalid refs and absent haftarah have a useful reading or retry route", async ({ page }) => {
  await page.goto("/learn/prepare?ref=Genesis+1%3A999&kind=torah");
  await expect(page.getByText("This reference cannot be opened.", { exact: false })).toBeVisible();
  await expect(page.getByRole("link", { name: "Choose a reading", exact: true })).toHaveAttribute("href", "/readings?for=prepare");
  await page.goto("/learn/prepare?kind=haftarah");
  await expect(page.getByText("No haftarah passage is available for these weeks.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again", exact: true })).toBeVisible();
  await expect(page.locator("[data-passage-stage]")).toHaveCount(0);
});

test("an excerpt in haftarah stays usable without completing Torah; phone layout and keyboard selection remain usable", async ({ page }) => {
  await page.goto("/learn/prepare?ref=Isaiah+40%3A1-3&kind=haftarah");
  await stage(page, "choose");
  await page.getByRole("combobox", { name: "Through", exact: true }).focus();
  await page.keyboard.press("End");
  await page.getByRole("button", { name: "Prepare this section", exact: true }).focus();
  await expect(page.getByRole("button", { name: "Prepare this section", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await stage(page, "preview");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
  await page.getByRole("button", { name: "Prepare Isaiah 40:2", exact: true }).click();
  await stage(page, "verse");
  await expect(page.locator("[data-preparation-stage]")).toHaveAttribute("data-preparation-stage", "model");
});

test("a passage whose models fail keeps the requested public reading and never reports a listening success", async ({ page }) => {
  await page.route("**/api/public/reference/short?**", route => route.fulfill({ status: 503, contentType: "application/json", body: "{}" }));
  await page.goto("/learn/prepare?ref=Genesis+12%3A1-3&kind=torah");
  await expect(page.getByText("A practice recording isn't available for this passage yet.", { exact: false })).toBeVisible();
  const href = await page.getByRole("link", { name: "Read this passage in Lein", exact: true }).getAttribute("href");
  expect(new URL(href!, "https://example.test").searchParams.get("ref")).toBe("Genesis 12:1-3");
  await expect(page.getByRole("button", { name: "Prepare this section", exact: true })).toHaveCount(0);
  expect(await plays(page)).toBe(0);
});
