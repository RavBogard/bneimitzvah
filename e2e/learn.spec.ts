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
  const look = main.locator("[data-look-answer]");
  if (await look.count()) { const target = await look.getAttribute("data-look-answer"); return main.locator(`button[data-look="${right ? target : target === "0" ? "1" : "0"}"]`).click(); }
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

async function hearAnchor(page: Page, family: string) {
  const row = page.locator("[data-sound-anchors] li").filter({ has: page.locator(`[data-family-chip="${family}"]`) });
  const model = row.getByRole("button", { name: /^Hear / });
  await model.click(); await expect(model).toHaveAttribute("data-state", "playing");
  await expect(model).toHaveAttribute("data-state", "idle", { timeout: 10_000 });
}

test("a learner opens the course, hears a phrase, misses one item and gets it back, and finishes the lesson; progress survives a reload", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const routes = syntheticCourseRoutes(); await routes.install(page); await seed(page, introDone);
  const response = await page.goto("/learn");
  expect(response?.status()).toBe(200);
  expect(response?.headers()["x-robots-tag"]).toBe("noindex, nofollow");
  await expect(page).toHaveTitle("Learn to lein | CRC Torah");
  await expect(page.getByRole("heading", { level: 1, name: "Learn to lein" })).toBeVisible();
  await expect(page.getByText("Hear a phrase, chant it yourself, then connect it to a reading. Return to words, sounds and joins whenever you need help.", { exact: true })).toBeVisible();
  const next = page.locator("[data-next]");
  await expect(next).toHaveAttribute("data-next", "torah-sof-pasuk");
  await expect(page.getByText("Can hear: 0 of 10 Torah phrases · 0 of 11 haftarah phrases")).toBeVisible();
  await expect(page.getByText("Progress is saved on this device. Sign in to keep it.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in", exact: true })).toHaveAttribute("href", "/sign-in");
  // Every lesson on both paths is a link (the order is advice), while Next still recommends one.
  await expect(page.locator('section[aria-labelledby="path-torah"] ol a')).toHaveCount(12);
  await expect(page.locator('section[aria-labelledby="path-haftarah"] ol a')).toHaveCount(12);
  await expect(page.locator("[data-next]")).toHaveCount(1);
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
  await expect(page.locator("[data-sound-stage=model]")).toBeVisible();
  await page.getByRole("button", { name: "Examples", exact: true }).click();
  await expect(page.getByRole("heading", { name: "In verses" })).toBeVisible();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await hearAnchor(page, "etnachta");
  await page.getByRole("button", { name: "Start optional questions", exact: true }).click();

  // Drills: the first item is answered wrong, comes back later, and is answered right.
  let missedPrompt = "", sawFeedback = false;
  for (let i = 0; i < 40; i++) {
    const step = await page.locator("main").getAttribute("data-step");
    if (step === "done") break;
    await expect(page.locator("main h2").first()).toBeVisible();
    const prompt = await page.locator("main h2").first().innerText();
    if (i === 0) {
      missedPrompt = prompt; await answer(page, false);
      if (prompt === "Which phrase is this?") { await expect(page.getByText(/^That one is .+\. Here is .+ for comparison\.$/)).toBeVisible(); sawFeedback = true;
        // G19: the wrong choice is an x on a muted fill, not the heavier outline; the right one keeps the colour and the check.
        const wrong = page.locator("main button[data-state=chosen]");
        await expect(wrong).toHaveCount(1); await expect(wrong.locator("svg:not([class*=contour])")).toHaveCount(1); // the x, beside the family's contour mark
        await expect.poll(() => wrong.evaluate(node => getComputedStyle(node).boxShadow)).toBe("none");
        await expect(page.locator("main button[data-state=right]")).toHaveCount(1);
      }
    } else await answer(page, true);
    const nextButton = page.getByRole("button", { name: "Next", exact: true });
    await expect(nextButton).toBeEnabled();
    if (i === 1 && testInfo.project.name === "phone") expect(await noHorizontalScroll(page)).toBe(true);
    if (i === 2) {
      // Once answered, the verse's words open their cards; a tapped word plays nothing. The reveal hands focus to Next first.
      await expect(nextButton).toBeFocused();
      const word = page.locator("main [data-word-card]").first(), heard = await plays(page);
      await word.focus(); await page.keyboard.press("Enter");
      await expect(page.getByRole("dialog")).toContainText(/Synthetic gloss for word \d+/);
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(word).toBeFocused();
      expect(await plays(page)).toBe(heard);
    }
    await nextButton.click();
  }
  expect(missedPrompt).not.toBe("");
  if (missedPrompt === "Which phrase is this?") expect(sawFeedback).toBe(true);

  // Done: a plain fact, then this week's reading, then the next step.
  await expect(page.locator("main[data-step=done]")).toBeVisible();
  await expect(page.getByText("Return to this phrase whenever you need it. You can keep practising or use it in a reading.")).toBeVisible();
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

test("a new learner's first lesson is Hear it, a phrase to try, In verses, Done: sounds before recognition, and each half's control plays its own cut", async ({ page }) => {
  test.setTimeout(120_000);
  const routes = syntheticCourseRoutes(); await routes.install(page);
  await page.goto("/learn");
  await expect(page.locator("[data-next]")).toHaveAttribute("data-next", "intro-phrases");
  await page.locator("[data-next]").getByRole("link", { name: "Start" }).click();
  await expect(page).toHaveURL(/\/learn\/intro-phrases$/);
  await expect(page.locator("main[data-step=hear]")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("list", { name: "Step 1 of 4" })).toBeAttached();
  // Hear it: each half of Genesis 1:1 has its own control, named Hear {family}, and plays a cut shorter than the whole verse.
  const blobSize = (src: string) => page.evaluate(async url => (await (await fetch(url)).blob()).size, src);
  const lastPlayed = () => page.evaluate(() => { const list = (window as unknown as { learnPlays: string[] }).learnPlays; return list[list.length - 1]; });
  const sizes: Record<string, number> = {};
  for (const name of ["Hear etnachta", "Hear sof pasuk", "Hear it"]) {
    const before = await plays(page);
    const control = page.getByRole("button", { name, exact: true });
    await control.click();
    await expect.poll(() => plays(page)).toBeGreaterThan(before);
    // Read the clip only once it is the one sounding: the silent unlock clip before it is released as soon as the cut attaches.
    await expect(control).toHaveAttribute("data-state", "playing", { timeout: 10_000 });
    sizes[name] = await blobSize((await lastPlayed())!);
    await page.getByRole("button", { name, exact: true }).click(); // a second press stops it
  }
  expect(sizes["Hear etnachta"]).toBeGreaterThan(0);
  expect(sizes["Hear sof pasuk"]).toBeGreaterThan(0);
  expect(sizes["Hear etnachta"]).toBeLessThan(sizes["Hear it"]);
  expect(sizes["Hear sof pasuk"]).toBeLessThan(sizes["Hear it"]);
  await expect(page.getByText("The recording did not load. Try again.")).toHaveCount(0);
  await page.getByRole("button", { name: "Next", exact: true }).click();
  // The sound step: one real engine phrase to echo and try, then on to the examples.
  await expect(page.locator("main[data-step=sound]")).toBeVisible();
  await page.getByRole("button", { name: "Examples", exact: true }).click();
  // In verses: every whole-verse example offers both halves.
  await expect(page.getByRole("heading", { name: "In verses" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Hear etnachta", exact: true })).toHaveCount(4);
  await expect(page.getByRole("button", { name: "Hear sof pasuk", exact: true })).toHaveCount(4);
  const before = await plays(page);
  await page.getByRole("button", { name: "Hear sof pasuk", exact: true }).first().click();
  await expect.poll(() => plays(page)).toBeGreaterThan(before);
  await page.getByRole("button", { name: "Next", exact: true }).click();
  // No question stands between the sounds and Done: no same or different, no which half.
  await expect(page.locator("main[data-step=done]")).toBeVisible();
  await expect(page.getByText("Same tune or different?")).toHaveCount(0);
  await expect(page.getByText("Return to this phrase whenever you need it.", { exact: false })).toBeVisible();
  const stored = JSON.parse((await page.evaluate(key => localStorage.getItem(key), KEY))!);
  expect(Object.keys(stored.lessons)).toEqual(["intro-phrases"]);
  expect(stored.cards).toEqual({});
});

test("tapping a word opens its card, never trope; Escape, Close and a tap outside close it and focus goes back to the word", async ({ page }, testInfo) => {
  const routes = syntheticCourseRoutes(); await routes.install(page); await seed(page, introDone);
  await page.goto("/learn/torah-etnachta");
  await expect(page.locator("main[data-step=hear]")).toBeVisible({ timeout: 20_000 });
  const words = page.locator("main [data-word-card]");
  await expect(words.first()).toBeVisible();
  const word = words.nth(1), text = (await word.innerText()).trim(), before = await plays(page);
  await word.click();
  const card = page.getByRole("dialog");
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute("data-layout", testInfo.project.name === "phone" ? "sheet" : "panel");
  const heading = card.getByRole("heading", { level: 4 });
  await expect(heading).toBeFocused();
  await expect(heading).toHaveAttribute("lang", "he");
  await expect(heading).toHaveText(text);
  await expect(card).toContainText("Meaning in this verse");
  await expect(card).toContainText(/Synthetic gloss for word \d+/);
  await expect(card).toContainText("Syllables and stress aren\u2019t available for this word.");
  expect(await plays(page), "a tapped word plays nothing").toBe(before);
  expect(routes.seen.some(path => path.startsWith("/api/public/word-details?"))).toBe(true);
  const close = card.getByRole("button", { name: "Close" });
  expect((await close.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  if (testInfo.project.name === "phone") expect(await noHorizontalScroll(page)).toBe(true);
  await page.keyboard.press("Escape");
  await expect(card).toHaveCount(0);
  await expect(word).toBeFocused();
  // Keyboard: Enter opens it; Close closes it.
  await page.keyboard.press("Enter");
  await expect(card).toBeVisible();
  await close.click();
  await expect(card).toHaveCount(0);
  await expect(word).toBeFocused();
  // A tap outside closes it.
  await word.click();
  await expect(card).toBeVisible();
  const size = page.viewportSize()!; await page.mouse.click(size.width - 4, Math.round(size.height / 2));
  await expect(card).toHaveCount(0);
  await expect(word).toBeFocused();
  expect(await plays(page)).toBe(before);
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
  await page.getByRole("button", { name: "Try the sound", exact: true }).click();
  await page.getByRole("button", { name: "Try this familiar phrase directly", exact: true }).click();
  await page.getByRole("button", { name: "Compare with the reader", exact: true }).click();
  await page.getByRole("button", { name: "Optional recognition practice", exact: true }).click();
  await hearAnchor(page, "sof-pasuk");
  await page.getByRole("button", { name: "Start optional questions", exact: true }).click();
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

test("signed in, the browser's progress is merged into the account on first sign-in and the device-only note goes away", async ({ page }) => {
  const routes = syntheticCourseRoutes(); await routes.install(page); await seed(page, introDone);
  const owner = "c".repeat(32), posts: { path: string; body: unknown }[] = [];
  let stored: unknown = null, version = 0;
  await page.route("**/api/learn/progress**", async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (request.method() === "POST") {
      const body = request.postDataJSON() as { progress: unknown }; posts.push({ path, body });
      expect(request.headers()["content-type"]).toContain("application/json");
      stored = body.progress; version++;
    }
    return route.fulfill({ status: 200, contentType: "application/json", headers: { "cache-control": "private, no-store" },
      body: JSON.stringify({ ok: true, owner, progress: stored, version, until: null }) });
  });
  await page.goto("/learn");
  await expect(page.locator("[data-next]")).toHaveAttribute("data-next", "torah-sof-pasuk");
  await expect.poll(() => posts.length).toBe(1);
  expect(posts[0].path).toBe("/api/learn/progress/merge");
  expect(posts[0].body).toEqual({ progress: JSON.parse(introDone) });
  await expect(page.getByText("Progress is saved on this device. Sign in to keep it.")).toHaveCount(0);
  const marker = JSON.parse((await page.evaluate(() => localStorage.getItem("crc-torah:learn-sync/v1")))!);
  expect(marker).toEqual({ owner, version: 1, dirty: false });
  // The next page load finds the same account and version: nothing is sent.
  await page.reload();
  await expect(page.locator("[data-next]")).toBeVisible();
  await page.waitForTimeout(500);
  expect(posts).toHaveLength(1);
});
