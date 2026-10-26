import { expect, test, type Page } from "@playwright/test";
import { commentaryCandidates, commentaryEditionUrl, parseCommentaryChapter } from "../src/lib/readings/commentary";
import { mockVayera, VAYERA_DATE } from "./aliyot-fixture";
import { closeMore, moreButton, moreSheet, openMore } from "./more-sheet";

// 1.9 N5 on the built, unconfigured production server: the public /read header and its More sheet.
// Synthetic data only (aliyot-fixture.ts): invented syllables and numbered English. The browser clock is pinned so 2026-10-31 is another week.
test.beforeEach(async ({ page }) => { await page.clock.setFixedTime(new Date("2026-10-21T15:00:00Z")); });
const week = `/read?date=${VAYERA_DATE}`;
const firstWord = (page: Page) => page.locator(".study-verses [data-verse-ref] [data-word-index], [data-study-rows] [data-verse-ref] [data-word-index]").first();

test("on a Pixel 7 the first Hebrew starts above y 320 on /read with the week's aliyot and haftarah, in Lein; Study is measured too", async ({ page }, info) => {
  test.skip(info.project.name !== "phone", "A phone-width check");
  await mockVayera(page, { mode: "ok" }, { haftarah: true });
  const measured: Record<string, number> = {};
  for (const lens of ["lein", "study"]) {
    await page.goto(`${week}${lens === "study" ? "&lens=study" : ""}`);
    await expect(page.getByRole("group", { name: "Reading text selection" })).toBeVisible();
    await expect(page.getByRole("tablist", { name: "Reading sections" })).toBeVisible();
    await expect(firstWord(page)).toBeVisible();
    measured[lens] = Math.round((await firstWord(page).boundingBox())!.y);
  }
  console.log("FIRST HEBREW y on a Pixel 7", JSON.stringify(measured));
  expect(measured.lein, "Lein").toBeLessThan(320);
  // Study carries the place row (the reference and the chapter jump) above its first verse, so it starts lower; it still opens in the top half of the screen.
  expect(measured.study, "Study").toBeLessThan(420);
});

test("the header is two lines: the date and kind of Shabbat, then the parashah with the week arrows and More; the rest is in More", async ({ page }) => {
  await mockVayera(page, { mode: "ok" }, { haftarah: true });
  await page.goto(week);
  const header = page.locator("header", { has: page.locator("#public-reading-title") }).first();
  await expect(page.getByRole("heading", { level: 1, name: "Vayera", exact: true })).toBeVisible();
  await expect(header.locator("p").first()).toHaveText(/^Shabbat · October 31$/i);
  for (const name of ["Previous week", "Next week", "More"]) await expect(header.getByRole("button", { name, exact: true })).toBeVisible();
  // None of the moved actions is on the page itself.
  for (const name of ["Find a date", "Choose a reading", "Choose verses", "Print", "Start reading", "Save", "Sign in to save"]) {
    await expect(page.locator("main").getByRole("button", { name, exact: true }).or(page.locator("main").getByRole("link", { name, exact: true })), name).toHaveCount(0);
  }
  await expect(page.getByLabel("Find a date", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Portion", { exact: true })).toHaveCount(0);
  const sheet = await openMore(page);
  await expect(sheet.getByRole("heading", { name: "More", exact: true })).toBeFocused();
  for (const name of ["Start reading", "Choose verses", "Choose a reading", "This week"]) await expect(sheet.getByRole("button", { name, exact: true }), name).toBeVisible();
  for (const name of ["Print", "Trope chart", "Torah blessings: siddur page 22 , opens in a new tab", "Haftarah blessings: siddur page 23, after Mi Shebeirach , opens in a new tab"]) await expect(sheet.getByRole("link", { name, exact: true }), name).toBeVisible();
  await expect(sheet.getByLabel("Find a date", { exact: true })).toBeVisible();
  await expect(sheet.getByLabel("Portion", { exact: true })).toBeVisible();
  await expect(sheet.getByRole("link", { name: "Sign in to save", exact: true })).toBeVisible();
  // The old date line (the long date and both ranges) is the sheet's first line.
  await expect(sheet.locator("[data-reading-ranges]")).toContainText("Saturday, October 31, 2026 · Torah Genesis 18:1–22:24 · Haftarah Isaiah 54:1–55:5");
});

test("every action in More is reachable by keyboard: Enter opens it, Tab walks its actions and wraps, Esc closes it and returns to More", async ({ page }) => {
  await mockVayera(page, { mode: "ok" }, { haftarah: true });
  await page.goto(week);
  await expect(firstWord(page)).toBeVisible();
  await moreButton(page).focus();
  await page.keyboard.press("Enter");
  await expect(moreSheet(page)).toBeVisible();
  // Sheet's title first, then each control in reading order, the close button last.
  const names: string[] = [];
  for (let press = 0; press < 20; press++) {
    await page.keyboard.press("Tab");
    const name = await page.evaluate(() => {
      const node = document.activeElement as HTMLElement | null;
      if (!node || !node.closest("dialog")) return "outside";
      return node.getAttribute("aria-label") ?? (node as HTMLInputElement).labels?.[0]?.textContent ?? node.textContent ?? "";
    });
    names.push(name.trim());
    if (names.filter(item => item === names[0]).length > 1) break;
  }
  expect(names).not.toContain("outside");
  for (const expected of ["Start reading", "Portion", "Choose verses", "Print", "Sign in to save", "Find a date", "This week", "Choose a reading", "Trope chart", "Close"])
    expect(names.some(item => item.startsWith(expected)), `${expected} in ${JSON.stringify(names)}`).toBe(true);
  expect(names.some(item => item.startsWith("Torah blessings")) && names.some(item => item.startsWith("Haftarah blessings"))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(moreSheet(page)).toBeHidden();
  await expect(moreButton(page)).toBeFocused();
  // And the screen reader's view: the dialog has its name, and More says it opens one.
  await expect(moreButton(page)).toHaveAttribute("aria-haspopup", "dialog");
});

test("from the top of the page the dock is reached in fourteen Tab presses, not sixteen or more, with More one stop among them", async ({ page }, info) => {
  test.skip(info.project.name !== "phone", "One device is enough.");
  await mockVayera(page, { mode: "ok" }, { haftarah: true });
  await page.goto(week);
  await expect(firstWord(page)).toBeVisible();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  // Entering through the header (not the skip link): the old header put fifteen stops before the dock.
  let dock = 0;
  const stops: string[] = [];
  for (let press = 1; press <= 20 && !dock; press++) {
    await page.keyboard.press("Tab");
    const at = await page.evaluate(() => { const node = document.activeElement as HTMLElement | null; return { dock: Boolean(node?.closest(".reading-toolbar")), name: (node?.getAttribute("aria-label") ?? node?.textContent ?? "").trim().slice(0, 30) }; });
    stops.push(at.name);
    if (at.dock) dock = press;
  }
  console.log("TAB PRESSES FROM THE TOP TO THE DOCK", dock, JSON.stringify(stops));
  expect(dock).toBeGreaterThan(0);
  // Skip link, the site bar (brand, Read, Learn and Sign in), the arrows, More, the four lens buttons and the first chip, then the dock:
  // thirteen stops before it (N4 counted fifteen). Read and Learn are the site menu Daniel asked for on every page (2026-10-26).
  expect(dock).toBeLessThanOrEqual(14);
});

test("Start reading in More closes the sheet and puts focus in the reading; Choose verses closes it and puts focus on the bar", async ({ page }) => {
  await mockVayera(page, { mode: "ok" });
  await page.goto(week);
  await expect(firstWord(page)).toBeVisible();
  await (await openMore(page)).getByRole("button", { name: "Start reading", exact: true }).click();
  await expect(moreSheet(page)).toBeHidden();
  await expect.poll(() => page.evaluate(() => Boolean(document.activeElement?.closest(".study-verses")))).toBe(true);
  await (await openMore(page)).getByRole("button", { name: "Choose verses", exact: true }).click();
  await expect(moreSheet(page)).toBeHidden();
  await expect(page.locator("[data-choose-bar]")).toBeFocused();
  // The bar is one row of buttons under the count: its height is a short bar's, and it covers no more than a sliver of a phone.
  const box = (await page.locator("[data-choose-bar]").boundingBox())!;
  expect(box.height).toBeLessThan(110);
  await page.locator("[data-choose-bar]").getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(moreButton(page)).toBeFocused();
});

test("choosing a portion in More closes the sheet and opens that aliyah; Find a date goes to that Shabbat and the sheet stays", async ({ page }) => {
  await mockVayera(page);
  await page.goto(week);
  await expect(firstWord(page)).toBeVisible();
  await (await openMore(page)).getByLabel("Portion", { exact: true }).selectOption("aliyah-3");
  await expect(moreSheet(page)).toBeHidden();
  await expect(page.getByRole("tab", { name: "Aliyah 3", exact: true })).toHaveAttribute("aria-selected", "true");
  const sheet = await openMore(page);
  await sheet.getByLabel("Find a date", { exact: true }).fill("2026-11-07");
  await expect(page.getByRole("heading", { level: 1, name: "Vayera", exact: true })).toBeVisible();
  await expect(page).toHaveURL(/date=2026-11-07/);
  await closeMore(page);
  await expect(page.locator("header p").first()).toHaveText(/^Shabbat · November 7$/i);
});

test("the week arrows move a Shabbat at a time", async ({ page }) => {
  await mockVayera(page);
  await page.goto(week);
  await expect(firstWord(page)).toBeVisible();
  await page.getByRole("button", { name: "Next week", exact: true }).click();
  await expect(page).toHaveURL(/date=2026-11-07/);
  await page.getByRole("button", { name: "Previous week", exact: true }).click();
  await page.getByRole("button", { name: "Previous week", exact: true }).click();
  // The clock is pinned to 2026-10-21, so October 24 is this week: plain /read, and the eyebrow says so.
  await expect(page).toHaveURL(/\/read$/);
  await expect(page.locator("header p").first()).toHaveText(/^This Shabbat · October 24$/i);
});

// ---- G17: commentary Hebrew scales with the size control ----
const word = ["אָבָ֑ג", "דֵּ֖ה", "וְזַ֥ח"];
const runs = (lead: string, rest: string) => [{ text: lead, bold: true }, { text: ` ${rest}` }];
async function withRashi(page: Page) {
  await mockVayera(page);
  await page.route("**/api/public/commentary?*", route => {
    const q = new URL(route.request().url()).searchParams, work = q.get("work")!, chapter = q.get("chapter")!;
    const parsed = parseCommentaryChapter(work, chapter), candidates = parsed ? commentaryCandidates(parsed) : null;
    const editions = parsed && candidates ? [candidates.he[0], candidates.en[0]].filter(Boolean).map(item => ({ language: item.language, title: item.title, license: item.license, credit: item.credit, url: commentaryEditionUrl(parsed, item) })) : [];
    // Verse 1 of Genesis 18: a comment in Hebrew only, so its Hebrew is on the page without a press.
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ work, chapter, verses: work === "rashi" && chapter === "Genesis 18" ? { "1": { comments: [{ hebrew: runs(word[0], word.join(" ")), english: null }] } } : {}, editions }) });
  });
}
test("commentary Hebrew grows with each size step", async ({ page }) => {
  await withRashi(page);
  await page.goto(`${week}&lens=study`);
  const comment = page.locator('[data-study-rows] [data-work="rashi"] p[lang="he"]').first();
  await expect(comment).toBeVisible();
  const sizeOf = () => comment.evaluate(node => parseFloat(getComputedStyle(node).fontSize));
  const sizes: Record<string, number> = {};
  for (const [id, label] of [["small", "Small"], ["standard", "Standard"], ["large", "Large"], ["huge", "Huge"]] as const) {
    await page.getByRole("button", { name: /^Text size/ }).click();
    await page.locator(`.toolbar-menu [data-size="${id}"]`).click();
    await expect(page.getByRole("button", { name: `Text size: ${label}`, exact: true })).toBeVisible();
    sizes[id] = await sizeOf();
  }
  console.log("COMMENTARY HEBREW px by size", JSON.stringify(sizes));
  expect(sizes.small).toBeLessThan(sizes.standard);
  expect(sizes.standard).toBeLessThan(sizes.large);
  expect(sizes.large).toBeLessThan(sizes.huge);
  expect(sizes.standard, "Standard keeps the size it had").toBeCloseTo(19, 0);
});
