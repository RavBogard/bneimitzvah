import { expect, test, type Page } from "@playwright/test";
import { FULL, longestEvent, mockVayera, TRIENNIAL, VAYERA_DATE, versesOf, VAYERA } from "./aliyot-fixture";

// Release 1.9 N3 exit tests on the built, unconfigured production server: Vayera's aliyot in Lein and Study, one aliyah to a page, the picker and
// `&pick=` carried to Print and Save, the festival Saturday with no aliyot, Choose verses' second tap and its Print, and the speed of the lens switch.
// Every reading and calendar answer is a synthetic route fulfilment with invented syllables, so the page's own client code is under test.
// The browser clock is pinned so 2026-10-31 is another week, never "this week" (which the address leaves out).
test.beforeEach(async ({ page }) => { await page.clock.setFixedTime(new Date("2026-10-21T15:00:00Z")); });
const week = `/read?date=${VAYERA_DATE}`;
const all = versesOf(VAYERA);
const sectionVerses = (ref: string) => versesOf(ref);
const tabs = (page: Page) => page.getByRole("tablist", { name: "Reading sections" });
const tab = (page: Page, name: string) => tabs(page).getByRole("tab", { name, exact: true });
const refs = (page: Page, study: boolean) => page.locator(study ? "[data-study-rows] [data-verse-ref]" : ".study-verses [data-verse-ref]").evaluateAll(rows => rows.map(row => (row as HTMLElement).dataset.verseRef!));
const reading = (page: Page, study: boolean) => expect(page.locator(study ? "[data-study-rows] [data-verse-ref]" : ".study-verses [data-verse-ref]").first()).toBeVisible();
const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

for (const study of [false, true]) {
  test(`Vayera shows Aliyah 1 to 7 and Maftir in ${study ? "Study" : "Lein"}, one aliyah to a page, and a page never ends inside one`, async ({ page }) => {
    await mockVayera(page);
    await page.goto(`${week}${study ? "&lens=study" : ""}`);
    await reading(page, study);
    await expect(tabs(page).getByRole("tab")).toHaveText(["Aliyah 1", "Aliyah 2", "Aliyah 3", "Aliyah 4", "Aliyah 5", "Aliyah 6", "Aliyah 7", "Maftir"]);
    await expect(tab(page, "Aliyah 1")).toHaveAttribute("aria-selected", "true");
    // The label above the first verse, in print's words, in this lens too.
    await expect(page.locator(".assigned-study .student-aliyah").first()).toHaveText("Aliyah 1");
    // Every page is one section, whole: first and last verse are the section's, and "Next section" leads to the next, until the Maftir.
    for (const [at, [n, ref]] of FULL.entries()) {
      const label = n === "M" ? "Maftir" : `Aliyah ${n}`;
      await expect(tab(page, label)).toHaveAttribute("aria-selected", "true");
      const expected = sectionVerses(ref);
      await expect.poll(() => refs(page, study), { message: label }).toEqual(expected);
      if (n === "7") await expect(page.locator(".assigned-study .student-aliyah")).toHaveText(["Aliyah 7", "Maftir"]);
      if (at < FULL.length - 1) {
        // The next section's first verse is previewed faintly, to the eye only.
        const preview = page.locator("[data-next-section] p");
        await expect(preview).toHaveAttribute("aria-hidden", "true");
        expect((await preview.textContent())?.length).toBeGreaterThan(10);
        await page.getByRole("button", { name: "Next section", exact: true }).click();
      } else await expect(page.getByRole("button", { name: "Next section", exact: true })).toHaveCount(0);
    }
    // The address names the section the reader is on, and a reload opens it.
    expect(new URL(page.url()).searchParams.get("pick")).toBe("maftir");
    await page.reload();
    await reading(page, study);
    await expect(tab(page, "Maftir")).toHaveAttribute("aria-selected", "true");
    await expect.poll(() => refs(page, study)).toEqual(sectionVerses("Genesis 22:20-24"));
    expect(await noHorizontalScroll(page)).toBe(true);
  });
}

test("&pick=aliyah-4 opens aliyah 4 and survives Print and Save", async ({ page }) => {
  await mockVayera(page);
  await page.goto(`${week}&pick=aliyah-4`);
  await reading(page, false);
  await expect(tab(page, "Aliyah 4")).toHaveAttribute("aria-selected", "true");
  await expect.poll(() => refs(page, false)).toEqual(sectionVerses("Genesis 19:21-21:4"));
  await expect(page.getByLabel("Portion", { exact: true })).toHaveValue("aliyah-4");
  // Study keeps the pick too.
  await page.getByRole("button", { name: "Study", exact: true }).click();
  await expect(page.locator("[data-study-rows] [data-verse-ref]").first()).toBeVisible();
  await expect.poll(() => refs(page, true)).toEqual(sectionVerses("Genesis 19:21-21:4"));
  expect(new URL(page.url()).searchParams.get("pick")).toBe("aliyah-4");
  expect(new URL(page.url()).searchParams.get("lens")).toBe("study");
  // Save, signed out: the way back from sign-in is this reading, this aliyah.
  const save = page.getByRole("link", { name: "Sign in to save", exact: true });
  await save.hover();
  const back = new URL(decodeURIComponent(new URL((await save.getAttribute("href"))!, page.url()).searchParams.get("return")!), page.url());
  expect(back.pathname).toBe("/read");
  expect(back.searchParams.get("pick")).toBe("aliyah-4");
  expect(back.searchParams.get("date")).toBe(VAYERA_DATE);
  // Print: the same pick; the sheet holds aliyah 4 and nothing else (read from its DOM; nothing is printed).
  const print = await page.getByRole("link", { name: "Print", exact: true }).getAttribute("href");
  expect(print).toBe(`/print?date=${VAYERA_DATE}&pick=aliyah-4`);
  await page.goto(print!);
  await expect(page.locator("[data-print-sheet-document] tr[data-verse-ref]").first()).toBeVisible();
  const printed = await page.locator("[data-print-sheet-document] tr[data-verse-ref]").evaluateAll(rows => rows.map(row => (row as HTMLElement).dataset.verseRef!));
  expect(printed).toEqual(sectionVerses("Genesis 19:21-21:4"));
  await expect(page.getByLabel("Portion", { exact: true })).toHaveValue("aliyah-4");
});

test("the Portion picker offers Full, the triennial year, each aliyah and the Maftir, and each opens its own reading", async ({ page }) => {
  const mocked = await mockVayera(page);
  await page.goto(week);
  await reading(page, false);
  const picker = page.getByLabel("Portion", { exact: true });
  await expect(picker.locator("option")).toHaveText(["Full calendar portion", "Triennial portion (year 2)", "Aliyah 1", "Aliyah 2", "Aliyah 3", "Aliyah 4", "Aliyah 5", "Aliyah 6", "Aliyah 7", "Maftir"]);
  await expect(picker).toHaveValue("full");
  await picker.selectOption("aliyah-6");
  await expect(tab(page, "Aliyah 6")).toHaveAttribute("aria-selected", "true");
  await expect.poll(() => refs(page, false)).toEqual(sectionVerses("Genesis 21:22-34"));
  // Full goes back to the whole portion from its start; it is the same pages, so the address drops the pick.
  await picker.selectOption("full");
  await expect.poll(() => refs(page, false)).toEqual(sectionVerses("Genesis 18:1-14"));
  expect(new URL(page.url()).searchParams.has("pick")).toBe(false);
  // The triennial reading is its own passage, read in its own sections.
  await picker.selectOption("triennial");
  await expect(tabs(page).getByRole("tab")).toHaveText(["Aliyah 1", "Aliyah 2", "Aliyah 3", "Aliyah 4", "Aliyah 5", "Aliyah 6", "Aliyah 7", "Maftir"]);
  await expect(tab(page, "Aliyah 5")).toBeVisible();
  expect(new URL(page.url()).searchParams.get("pick")).toBe("triennial");
  expect(mocked.calls.some(call => call.startsWith("/api/public/reading?ref="))).toBe(true);
  await tab(page, "Aliyah 5").click();
  await expect(tab(page, "Aliyah 5")).toHaveAttribute("aria-selected", "true");
  await expect.poll(() => refs(page, false)).toEqual(sectionVerses(TRIENNIAL[4][1]));
  // Still the triennial pick (a section of it is not a pick of its own).
  expect(new URL(page.url()).searchParams.get("pick")).toBe("triennial");
});

test("the section tabs are one tab stop and the arrow keys move among them", async ({ page }) => {
  await mockVayera(page);
  await page.goto(week);
  await reading(page, false);
  await tab(page, "Aliyah 1").focus();
  await page.keyboard.press("ArrowRight");
  await expect(tab(page, "Aliyah 2")).toBeFocused();
  await expect(tab(page, "Aliyah 2")).toHaveAttribute("aria-selected", "true");
  await expect.poll(() => refs(page, false)).toEqual(sectionVerses("Genesis 18:15-33"));
  await page.keyboard.press("End");
  await expect(tab(page, "Maftir")).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Home");
  await expect(tab(page, "Aliyah 1")).toHaveAttribute("aria-selected", "true");
  await expect(tabs(page).locator('[role="tab"][tabindex="0"]')).toHaveCount(1);
  // The row scrolls sideways where the chips do not fit; the page does not.
  expect(await noHorizontalScroll(page)).toBe(true);
});

for (const mode of ["none", "fail"] as const) {
  test(`with no aliyah breakdown (${mode === "none" ? "a festival Saturday" : "the calendar did not answer"}) the reading is Full only, paged as before`, async ({ page }) => {
    await mockVayera(page, { mode });
    await page.goto(`${week}&pick=aliyah-4`);
    await reading(page, false);
    await expect(tabs(page)).toHaveCount(0);
    await expect(page.getByLabel("Portion", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Next section", exact: true })).toHaveCount(0);
    // The server's own pages: 100 verses, then the rest.
    await expect(page.getByText(`Verses 1–100 of ${all.length}`, { exact: true })).toBeVisible();
    expect((await refs(page, false)).length).toBe(100);
    await page.getByRole("button", { name: "Next text page", exact: true }).click();
    await expect(page.getByText(`Verses 101–${all.length} of ${all.length}`, { exact: true })).toBeVisible();
    // The pick it cannot honour is not kept in the address, and Print says Full.
    expect(new URL(page.url()).searchParams.has("pick")).toBe(mode === "fail" ? true : false);
    expect(await page.getByRole("link", { name: "Print", exact: true }).getAttribute("href")).toBe(`/print?date=${VAYERA_DATE}`);
  });
}

test("a second tap after one verse makes the range, the empty bar says how to choose, and /print prints those verses only", async ({ page }) => {
  await mockVayera(page);
  await page.goto(`${week}&pick=aliyah-1`);
  await reading(page, false);
  await page.getByRole("button", { name: "Choose verses", exact: true }).click();
  const bar = page.locator("[data-choose-bar]"), line = bar.locator("[data-choose-line]");
  await expect(line).toHaveText("Tap verse numbers to choose them.");
  await page.getByRole("button", { name: "Select Genesis 18:1", exact: true }).click();
  await expect(line).toHaveText("1 verse: Genesis 18:1");
  await page.getByRole("button", { name: "Select Genesis 18:10", exact: true }).click();
  await expect(line).toHaveText("10 verses: Genesis 18:1–10");
  // The sheet for exactly those verses.
  const print = bar.getByRole("link", { name: "Print", exact: true });
  expect(await print.getAttribute("href")).toBe("/print?ref=Genesis+18%3A1-10&kind=torah");
  await print.click();
  await expect(page.locator("[data-print-sheet-document] tr[data-verse-ref]").first()).toBeVisible();
  const printed = await page.locator("[data-print-sheet-document] tr[data-verse-ref]").evaluateAll(rows => rows.map(row => (row as HTMLElement).dataset.verseRef!));
  expect(printed).toEqual(all.slice(0, 10));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Genesis 18:1–10");
});

test("Study's DOM is a section, not a hundred verses, and the lens switches in under 500 ms at 4x CPU", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "measured once, on the desktop project");
  test.setTimeout(120_000);
  await mockVayera(page);
  // Before this change Study on Vayera drew its first 100 verses: 5,299 nodes in the document, 5,137 in the reading (the same synthetic verses, measured on main).
  const BEFORE = { document: 5299, reading: 5137 };
  await page.goto(`${week}&lens=study`);
  const sizes: { section: string; verses: number; document: number; reading: number }[] = [];
  for (const [n] of FULL) {
    const name = n === "M" ? "Maftir" : `Aliyah ${n}`;
    await tab(page, name).click();
    await expect(tab(page, name)).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("[data-study-rows] [data-verse-ref]").first()).toBeVisible();
    sizes.push({ section: name, ...await page.evaluate(() => ({ verses: document.querySelectorAll("[data-study-rows] [data-verse-ref]").length, document: document.querySelectorAll("*").length, reading: document.querySelector(".assigned-study")!.querySelectorAll("*").length })) });
  }
  console.log("STUDY DOM", JSON.stringify(sizes), "BEFORE", JSON.stringify(BEFORE));
  info.annotations.push({ type: "study-dom", description: JSON.stringify({ before: BEFORE, after: sizes }) });
  // The first aliyah, the page Study opens on, is at least five times smaller; no section is as large as the old page.
  expect(sizes[0].reading * 5).toBeLessThanOrEqual(BEFORE.reading);
  for (const row of sizes) expect(row.reading * 2, row.section).toBeLessThanOrEqual(BEFORE.reading);
  // The longest event while Lein and Study are switched, at 4x CPU, on the largest aliyah (the fourth).
  await tab(page, "Aliyah 4").click();
  await expect(page.locator("[data-study-rows] [data-verse-ref]").first()).toBeVisible();
  const longest: number[] = [];
  for (const to of ["Lein", "Study", "Lein", "Study"] as const) {
    const result = await longestEvent(page, 4, async () => { await page.getByRole("button", { name: to, exact: true }).click(); });
    await expect(page.getByRole("button", { name: to, exact: true })).toHaveAttribute("aria-pressed", "true");
    longest.push(Math.round(result.longest));
  }
  const colors = await longestEvent(page, 4, async () => { await page.getByRole("button", { name: "Colors", exact: true }).click(); });
  console.log("LENS SWITCH longest event (ms) at 4x CPU", JSON.stringify(longest), "colors", Math.round(colors.longest));
  info.annotations.push({ type: "lens-switch-ms", description: JSON.stringify({ longest, colors: Math.round(colors.longest) }) });
  expect(Math.max(...longest)).toBeLessThan(500);
  // The passage is not mounted again by a lens change: the same verse element stays in the document across the switch back to Lein.
  await page.getByRole("button", { name: "Lein", exact: true }).click();
  await expect(page.locator(".study-verses [data-verse-ref]").first()).toBeVisible();
  const player = await page.evaluate(() => { const section = document.querySelector(".assigned-study"); (window as unknown as { __same: Element | null }).__same = section; return Boolean(section); });
  expect(player).toBe(true);
  await page.getByRole("button", { name: "Study", exact: true }).click();
  await expect(page.locator("[data-study-rows] [data-verse-ref]").first()).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __same: Element | null }).__same === document.querySelector(".assigned-study"))).toBe(true);
});
