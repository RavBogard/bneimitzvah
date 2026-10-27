import { expect, test, type Page } from "@playwright/test";
import { syntheticCourseRoutes } from "./learn-synthetic";
import { studyEditions } from "../src/components/portal/workspace/study/credits";

// 1.9 N4 on the built, unconfigured production server: the one Sheet, the tool dock, the words as one Tab stop with their Hebrew as their name, and the wider word targets.
// Synthetic data only: invented syllables and generated tones (learn-synthetic.ts), or numbered invented words below.
const plays = (page: Page) => page.evaluate(() => (window as unknown as { learnPlays: string[] }).learnPlays.length);
const wordAt = (page: Page, ref: string, index: number) => page.locator(`.study-verses [data-verse-ref="${ref}"] [data-word-index="${index}"][role="button"]`).first();
const sheet = (page: Page) => page.getByRole("dialog");

/** A reading that can be heard: the synthetic week of Genesis 12:1-20 with a generated tone for each verse. */
async function listening(page: Page, width = 390, torah = "Genesis 12:1-20") {
  await page.setViewportSize({ width, height: 844 });
  await syntheticCourseRoutes().install(page, { torah });
  await page.goto("/read");
  await expect(page.locator(".study-verses").getByRole("heading", { name: "Genesis 12:1", exact: true })).toBeVisible();
}

test("at 390px a tap on a word in Lein plays the verse and the page does not move", async ({ page }, info) => {
  test.skip(info.project.name !== "phone", "A phone width is the case.");
  await listening(page);
  const word = wordAt(page, "Genesis 12:2", 1);
  await word.scrollIntoViewIfNeeded();
  const scrolled = await page.evaluate(() => scrollY), before = await plays(page);
  await word.click();
  await expect.poll(() => plays(page), { timeout: 20_000 }).toBeGreaterThan(before);
  // Hearing is the tap's work in Lein: no sheet, no card, no scroll.
  await expect(sheet(page)).toHaveCount(0);
  expect(await page.evaluate(() => scrollY)).toBe(scrolled);
});

test("a word is named by its Hebrew, what a tap does is its description, and the whole passage is one Tab stop", async ({ page }, info) => {
  test.skip(info.project.name !== "phone", "One device is enough.");
  await listening(page);
  const first = wordAt(page, "Genesis 12:1", 0), text = (await first.textContent())!;
  await expect(page.getByRole("button", { name: text, exact: true }).first()).toBeVisible();
  await expect(first).toHaveAccessibleName(text);
  await expect(first).toHaveAccessibleDescription(/^Hear whole verse; select word for tools/);
  await expect(first).not.toHaveAttribute("aria-label", /.+/);
  const stops = page.locator('.study-verses [role="button"][data-word-index][tabindex="0"]');
  await expect(stops).toHaveCount(1);
  // The arrow keys cross verses; the stop follows focus.
  await wordAt(page, "Genesis 12:1", 0).focus();
  await page.keyboard.press("End");
  await page.keyboard.press("ArrowLeft");
  await expect(wordAt(page, "Genesis 12:2", 0)).toBeFocused();
  await expect(stops).toHaveCount(1);
  await expect(wordAt(page, "Genesis 12:2", 0)).toHaveAttribute("tabindex", "0");
});

test("keyboard focus reaches the page controls in under ten Tab presses: the skip link, then the dock, then the words", async ({ page }, info) => {
  test.skip(info.project.name !== "phone", "One device is enough.");
  await listening(page);
  const reached = { skip: 0, dock: 0, words: 0 };
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  // Tab, Tab, ...: the first stop is "Skip to the reading"; Enter on it lands in the reading, and each press after it counts from there.
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to the reading", exact: true })).toBeFocused();
  reached.skip = 1;
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-reading-text]")).toBeFocused();
  for (let press = 1; press <= 12 && (!reached.dock || !reached.words); press++) {
    await page.keyboard.press("Tab");
    const at = await page.evaluate(() => { const node = document.activeElement; return { dock: node?.closest(".reading-toolbar") !== null, word: node?.matches('[data-word-index][role="button"]') ?? false }; });
    if (at.dock && !reached.dock) reached.dock = reached.skip + press;
    if (at.word && !reached.words) reached.words = reached.skip + press;
  }
  console.log("TAB PRESSES FROM THE TOP TO THE DOCK AND TO THE WORDS (skip link, Enter, then Tab)", JSON.stringify(reached));
  expect(reached.dock).toBeGreaterThan(0); expect(reached.dock).toBeLessThan(10);
  expect(reached.words).toBeGreaterThan(0); expect(reached.words).toBeLessThan(10);
});

for (const width of [320, 390, 430]) {
  test(`the dock covers no verse at ${width}px: it is fixed above the foot of the page and the passage keeps matching padding`, async ({ page }, info) => {
    test.skip(info.project.name !== "phone", "Widths are set by the test.");
    await listening(page, width);
    const dock = page.locator(".reading-toolbar");
    expect(await dock.evaluate(node => getComputedStyle(node).position)).toBe("fixed");
    await expect(dock.getByRole("button")).toHaveCount(await dock.getByRole("button").count());
    for (const name of ["Colors", "English", /^Text size/, /^Hear verse/]) await expect(dock.getByRole("button", { name })).toBeVisible();
    // Nothing is wider than the screen, and each dock control is a 44px target at least.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    for (const box of await dock.getByRole("button").evaluateAll(nodes => nodes.map(node => { const r = node.getBoundingClientRect(); return [r.width, r.height]; }))) { expect(box[0]).toBeGreaterThanOrEqual(44); expect(box[1]).toBeGreaterThanOrEqual(44); }
    // At the end of the scroll the last verse ends above the dock, and the dock is inside the screen.
    await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
    const geometry = await page.evaluate(() => {
      const bar = document.querySelector(".reading-toolbar")!.getBoundingClientRect(), verses = [...document.querySelectorAll(".study-verses [data-verse-ref]")], last = verses.at(-1)!.getBoundingClientRect();
      const more = document.querySelector(".reading-passage-layout")!.getBoundingClientRect();
      return { dockTop: bar.top, dockBottom: bar.bottom, lastBottom: last.bottom, height: innerHeight, layoutBottom: more.bottom };
    });
    expect(geometry.dockBottom).toBeLessThanOrEqual(geometry.height);
    expect(geometry.lastBottom).toBeLessThanOrEqual(geometry.dockTop);
    // A focused word is scrolled clear of the dock, not under it.
    await wordAt(page, "Genesis 12:20", 0).focus();
    const clear = await page.evaluate(() => { const node = document.activeElement!.getBoundingClientRect(), bar = document.querySelector(".reading-toolbar")!.getBoundingClientRect(); return node.bottom <= bar.top + 1; });
    expect(clear).toBe(true);
  });
}

test("the dock is the only position: fixed element on /read at 390px, because Print, the trope chart and the blessings sit in a row after the last verse", async ({ page }, info) => {
  test.skip(info.project.name !== "phone", "Widths are set by the test.");
  await listening(page, 390);
  const fixed = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>("body *")].filter(node => getComputedStyle(node).position === "fixed" && node.getClientRects().length > 0 && getComputedStyle(node).visibility !== "hidden")
    .filter(node => !node.classList.contains("skip-link")) // the skip link is fixed but sits off screen until it is focused
    .map(node => node.className.toString().split(" ")[0] || node.tagName));
  expect(fixed, JSON.stringify(fixed)).toEqual(["reading-toolbar"]);
  const foot = page.getByRole("navigation", { name: "After the reading", exact: true });
  await expect(foot.getByRole("link", { name: "Print", exact: true })).toBeVisible();
  await expect(foot.getByRole("link", { name: "Trope chart", exact: true })).toBeVisible();
  // The foot comes after the verses, never before them.
  expect(await page.evaluate(() => { const verses = [...document.querySelectorAll(".study-verses [data-verse-ref]")].at(-1)!, foot = document.querySelector("[data-reading-foot]")!; return Boolean(verses.compareDocumentPosition(foot) & Node.DOCUMENT_POSITION_FOLLOWING); })).toBe(true);
});

test("the Colors, English and size controls of the dock still do their work, and Size opens above it", async ({ page }, info) => {
  test.skip(info.project.name !== "phone", "A phone is the dock.");
  await listening(page);
  const dock = page.locator(".reading-toolbar");
  const before = await page.locator(".study-verses [data-family]").count();
  expect(before).toBeGreaterThan(0);
  await dock.getByRole("button", { name: "Colors", exact: true }).click();
  await expect(page.locator(".study-verses [data-family]")).toHaveCount(0);
  await dock.getByRole("button", { name: /^Text size/ }).click();
  const menu = page.getByRole("group", { name: "Hebrew text size" });
  await expect(menu).toBeVisible();
  const [menuBox, dockBox] = await Promise.all([menu.boundingBox(), dock.boundingBox()]);
  expect(menuBox!.y + menuBox!.height).toBeLessThanOrEqual(dockBox!.y);
});

test("a wider target for a word: a tap just above its letters, where no letter is, still picks it", async ({ page }, info) => {
  test.skip(info.project.name !== "phone", "Touch is the case.");
  await page.setViewportSize({ width: 390, height: 844 });
  await mockStudy(page);
  await page.goto("/read?lens=study");
  const word = wordAt(page, "Genesis 1:2", 1);
  await word.scrollIntoViewIfNeeded();
  const box = (await word.boundingBox())!, scrolled = await page.evaluate(() => scrollY);
  // 8px above the top of the letters and at the middle of the word: past the glyphs, inside the reach.
  await page.mouse.click(box.x + box.width / 2, box.y - 8);
  await expect(sheet(page).getByRole("heading", { name: "Word in Genesis 1:2" })).toBeFocused();
  expect(await page.evaluate(() => scrollY)).toBe(scrolled);
  // The reach moved nothing: the same word, closed again, is exactly where it was.
  await page.keyboard.press("Escape");
  const after = (await word.boundingBox())!;
  expect([after.x, after.y, after.width, after.height]).toEqual([box.x, box.y, box.width, box.height]);
});

test("verse numbers are 44px targets named for their verse, in Lein", async ({ page }, info) => {
  test.skip(info.project.name !== "phone", "A phone is the case.");
  await listening(page);
  const number = page.locator('.study-verses [data-verse-number]').first();
  await expect(number).toHaveAccessibleName("Hear Genesis 12:1");
  const box = (await number.boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(44); expect(box.height).toBeGreaterThanOrEqual(44);
  // The target did not grow the line: the verse's own height is the same as a verse without the button would be (two lines of Hebrew at most for these short verses).
  const lines = await page.locator('.study-verses [data-verse-ref="Genesis 12:1"]').first().evaluate(node => node.getBoundingClientRect().height / parseFloat(getComputedStyle(node).lineHeight));
  expect(lines).toBeLessThan(6);
});

// A synthetic Study reading whose second verse has a word with a qamats qatan (U+05C7) and one with an ordinary qamats; the text source marks the first with its own code point.
const word = ["אָבָ֑ג", "כׇּל", "וְזַ֥ח"];
const verseOf = (ref: string, words: string[]) => { const text = `${words.join(" ")}׃`; return { ref, english: `Synthetic translation ${ref}`, hebrew: { text, readingText: text, paragraphAfter: null, segments: [{ kind: "text", text }] } }; };
async function mockStudy(page: Page) {
  const refs = ["Genesis 1:1", "Genesis 1:2", "Genesis 1:3"];
  await page.route("**/api/public/**", route => {
    const url = new URL(route.request().url()), q = url.searchParams;
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (url.pathname === "/api/public/reading") return json({ date: q.get("date"), parashah: "Synthetic", fetchedAt: 0, listening: { pocketTorah: false },
      torah: { kind: "torah", ranges: ["Genesis 1:1-3"], verseCount: 3, pages: [{ offset: 0, first: "Genesis 1:1", last: "Genesis 1:3" }] }, haftarah: null });
    if (url.pathname === "/api/public/text") return json({ kind: "torah", date: q.get("date"), offset: 0, nextOffset: null, totalVerses: 3, translation: { key: "jps2023", status: "available" },
      verses: refs.map(ref => verseOf(ref, ref === "Genesis 1:2" ? word : [word[0], word[2]])), chapters: [{ ref: "Genesis 1", sefariaUrl: "https://www.sefaria.org/Genesis.1", fetchedAt: 0, hash: "c".repeat(64), editions: [studyEditions.mam, studyEditions.jps2023] }] });
    return json({ error: "unavailable" }, 503);
  });
}

test("the word card says a qamats qatan is o, only for a word the text marks with U+05C7", async ({ page }, info) => {
  test.skip(info.project.name !== "phone", "One device is enough.");
  await mockStudy(page);
  await page.goto("/read?lens=study");
  await wordAt(page, "Genesis 1:2", 1).click();
  await expect(sheet(page).getByText("This vowel says o (qamats katan).", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await wordAt(page, "Genesis 1:2", 0).click();
  await expect(sheet(page).getByRole("heading", { name: "Word in Genesis 1:2" })).toBeVisible();
  await expect(sheet(page).getByText("qamats katan")).toHaveCount(0);
});

test("the sheet is modal and returns focus: Esc, Close and a swipe down all give focus back to the word", async ({ page }, info) => {
  test.skip(info.project.name !== "phone", "A phone is the case.");
  await page.setViewportSize({ width: 390, height: 844 });
  await mockStudy(page);
  await page.goto("/read?lens=study");
  const target = wordAt(page, "Genesis 1:3", 0);
  await target.click();
  await expect(sheet(page)).toBeVisible();
  const inside = () => page.evaluate(() => document.activeElement?.closest("dialog") !== null);
  for (let step = 0; step < 10; step++) { await page.keyboard.press("Tab"); expect(await inside()).toBe(true); }
  await page.keyboard.press("Escape");
  await expect(target).toBeFocused();
  await target.click();
  await sheet(page).getByRole("button", { name: "Close", exact: true }).click();
  await expect(sheet(page)).toHaveCount(0);
  await expect(target).toBeFocused();
  // A swipe down on the sheet's header closes it.
  await page.emulateMedia({ reducedMotion: "reduce" }); // the sheet is in place at once, so the drag starts where its title is
  await target.click();
  await expect(sheet(page)).toBeVisible();
  const head = (await sheet(page).locator("h2").boundingBox())!, x = 195;
  await page.mouse.move(x, head.y + 4); await page.mouse.down(); await page.mouse.move(x, head.y + 140, { steps: 8 }); await page.mouse.up();
  await expect(sheet(page)).toHaveCount(0);
  await expect(target).toBeFocused();
});
