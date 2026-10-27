import { expect, test, type Page } from "@playwright/test";
import { expandReadingRanges } from "../src/lib/readings/ranges";
import { TANAKH_VERSE_COUNTS } from "../src/lib/readings/catalog";
import { studyRangePlan } from "../src/components/portal/workspace/study/api";
import { closeMore, openMore } from "./more-sheet";
import { studyEditions } from "../src/components/portal/workspace/study/credits";

// "Any reading" on the built, unconfigured production server. Every reading and text answer is a synthetic
// route fulfilment built from the request's own ref: invented syllables and numbered English only.
const word = ["אָבָ֑ג", "דֵּ֖ה", "וְזַ֥ח"];
const verseOf = (ref: string) => { const text = `${word.join(" ")}׃`; return { ref, english: `Synthetic translation ${ref}`, hebrew: { text, readingText: text, paragraphAfter: null, segments: [{ kind: "text", text }] } }; };
function passageOf(ranges: string[], kind: "torah" | "haftarah") {
  const count = expandReadingRanges(ranges, kind, TANAKH_VERSE_COUNTS).length, pages: { offset: number; first: string; last: string }[] = [];
  for (let offset: number | null = 0; offset !== null;) { const plan = studyRangePlan(ranges, kind, offset); pages.push({ offset, first: plan.refs[0], last: plan.refs.at(-1)! }); offset = plan.nextOffset; }
  return { kind, ranges, verseCount: count, pages };
}
const week = { torah: ["Genesis 1:1-3"], haftarah: ["Isaiah 54:1-2"] };
async function mock(page: Page) {
  const calls: string[] = [];
  await page.route("**/api/public/**", route => {
    const url = new URL(route.request().url()), q = url.searchParams;
    calls.push(url.pathname + url.search);
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    const kind = q.get("kind") as "torah" | "haftarah", ranges = q.has("ref") ? q.get("ref")!.split("; ") : week[kind];
    if (url.pathname === "/api/public/reading") {
      if (q.has("date")) return json({ date: q.get("date"), parashah: "Synthetic", fetchedAt: 0, listening: { pocketTorah: false }, torah: passageOf(week.torah, "torah"), haftarah: passageOf(week.haftarah, "haftarah") });
      return json({ ref: q.get("ref"), kind, passage: passageOf(ranges, kind), listening: { pocketTorah: true } });
    }
    if (url.pathname === "/api/public/text") {
      const offset = Number(q.get("offset")), plan = studyRangePlan(ranges, kind, offset), total = expandReadingRanges(ranges, kind, TANAKH_VERSE_COUNTS).length;
      return json({ kind, ...(q.has("ref") ? { ref: q.get("ref") } : { date: q.get("date") }), offset, nextOffset: plan.nextOffset, totalVerses: total, translation: { key: "jps2023", status: "available" },
        verses: plan.refs.map(verseOf), chapters: plan.chapters.map(chapter => ({ ref: chapter.ref, sefariaUrl: chapter.url, fetchedAt: 0, hash: "c".repeat(64), editions: [studyEditions.mam, studyEditions.jps2023] })) });
    }
    return json({ error: "unavailable" }, 503);
  });
  return calls;
}
const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
const passageButton = (page: Page, name: string) => page.getByRole("group", { name: "Reading text selection" }).getByRole("button", { name, exact: true });
const verse = (page: Page, ref: string) => page.locator(`.study-verses [data-verse-ref="${ref}"]`).first();

test("the Readings index opens a parashah, a holiday and a custom passage of the Prophets, each at an address that reloads to the same reading", async ({ page }) => {
  const calls = await mock(page);
  await page.goto("/read");
  await expect(page.getByRole("heading", { level: 1, name: "Synthetic", exact: true })).toBeVisible();
  await expect(page).toHaveTitle("This week’s reading | CRC Torah");
  await expect(page.getByRole("button", { name: "Previous week", exact: true })).toBeVisible();
  // Choose a reading is a link in the More sheet to /readings (B5); B6 replaces it with Find a reading.
  await openMore(page);
  await page.getByRole("link", { name: "Choose a reading", exact: true }).click();
  await expect(page).toHaveURL(/\/readings$/);
  await expect(page.getByRole("heading", { level: 1, name: "Readings", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Hebcal", exact: true })).toHaveAttribute("href", "https://www.hebcal.com/");
  await expect(page.getByRole("link", { name: "CC BY 4.0", exact: true })).toBeVisible();
  expect(await noHorizontalScroll(page)).toBe(true);
  // Every row is at least 44px tall.
  for (const box of await page.locator("main a[href^='/read?reading=']").evaluateAll(nodes => nodes.filter(node => (node as HTMLElement).offsetParent).map(node => node.getBoundingClientRect().height))) expect(box).toBeGreaterThanOrEqual(44);
  await page.locator("summary", { hasText: "Genesis" }).click();
  await page.getByRole("link", { name: "Noach", exact: true }).click();
  await expect(page).toHaveURL(/\/read\?reading=noach$/);
  await expect(page.getByRole("heading", { level: 1, name: "Noach", exact: true })).toBeVisible();
  await expect(page).toHaveTitle("Noach | CRC Torah");
  await expect(page.getByText("Parashah", { exact: true }).first()).toBeVisible();
  await expect(verse(page, "Genesis 6:9")).toBeVisible();
  await expect(passageButton(page, "Torah")).toHaveAttribute("aria-pressed", "true");
  await openMore(page);
  await expect(page.getByRole("button", { name: "This week", exact: true })).toBeVisible();
  await closeMore(page);
  await expect(page.getByRole("button", { name: "Previous week", exact: true })).toHaveCount(0);
  await passageButton(page, "Haftarah").click();
  await expect(verse(page, "Isaiah 54:1")).toBeVisible();
  await expect(page).toHaveTitle("Noach | CRC Torah"); // the address changed; the title stays
  await expect(page).toHaveURL(/\/read\?reading=noach&passage=2$/);
  await page.reload();
  await expect(passageButton(page, "Haftarah")).toHaveAttribute("aria-pressed", "true");
  expect(calls).toContain("/api/public/reading?ref=Genesis+6%3A9-11%3A32&kind=torah");
  // A festival that crosses books: its passages in Hebcal's order, each its own button.
  await page.goto("/readings");
  await page.getByRole("link", { name: "Simchat Torah", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Simchat Torah", exact: true })).toBeVisible();
  for (const name of ["Torah", "Torah 2", "Maftir", "Haftarah"]) await expect(passageButton(page, name)).toBeVisible();
  await passageButton(page, "Torah 2").click();
  await expect(verse(page, "Genesis 1:1")).toBeVisible();
  await expect(page).toHaveURL(/\/read\?reading=simchat-torah&passage=2$/);
  // Any passage of the Prophets.
  await page.goto("/readings");
  const custom = page.getByRole("region", { name: "Any verses", exact: true });
  await custom.getByRole("group", { name: "Kind of passage" }).getByRole("button", { name: "Prophets", exact: true }).click();
  await custom.getByLabel("Book", { exact: true }).selectOption("Jonah");
  await custom.getByLabel("End verse", { exact: true }).selectOption("5");
  await custom.getByRole("button", { name: "Open", exact: true }).click();
  await expect(page).toHaveURL(/\/read\?ref=Jonah\+1%3A1-5&kind=haftarah$/);
  await expect(page.getByRole("heading", { level: 1, name: "Jonah 1:1–5", exact: true })).toBeVisible();
  await expect(page).toHaveTitle("Jonah 1:1–5 | CRC Torah");
  await expect(page.getByText("Any reading", { exact: true })).toBeVisible();
  await expect(verse(page, "Jonah 1:5")).toBeVisible();
  expect(await noHorizontalScroll(page)).toBe(true);
});

test("a deep link opens its verse selected in the player, on the right text page, and the first other choice lets it go", async ({ page }) => {
  await mock(page);
  const refs = expandReadingRanges(["Genesis 1:1-6:8"], "torah", TANAKH_VERSE_COUNTS);
  await page.goto("/read?ref=Genesis+1%3A1-6%3A8&kind=torah&verse=120");
  await expect(page.getByText("Verses 101–146 of 146", { exact: true })).toBeVisible();
  await expect(page).toHaveTitle("Genesis 1:1–6:8 | CRC Torah");
  const player = page.getByRole("region", { name: "Reading playback", exact: true });
  await expect(player.getByText(`${refs[119]} · Whole verse`, { exact: true })).toBeVisible();
  await expect(player.getByRole("button", { name: "Play", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: `View ${refs[119]} up close`, exact: true })).toBeVisible();
  await expect(page).toHaveURL(/verse=120$/);
  await page.locator(`.study-verses [data-hebrew-ref="${refs[100]}"] [data-word-index="0"]`).click();
  await expect(player.getByText(`${refs[100]} · Whole verse`, { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/read\?ref=Genesis\+1%3A1-6%3A8&kind=torah$/);
});

test("Study works in a named reading, and an address that names nothing links to the Readings index", async ({ page }) => {
  await mock(page);
  await page.goto("/read?reading=noach&lens=study");
  await expect(page.getByRole("button", { name: "Study", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("[data-study-rows] article[data-verse-ref]").first()).toBeVisible();
  await page.getByRole("button", { name: "Lein", exact: true }).click();
  await expect(page).toHaveURL(/\/read\?reading=noach$/);
  for (const address of ["/read?ref=Psalms+1%3A1-6&kind=haftarah", "/read?reading=no-such-reading", "/read?ref=Genesis+12%3A1-12%3A20&kind=torah"]) {
    await page.goto(address);
    await expect(page.getByRole("heading", { level: 1, name: "Reading unavailable", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "That reading isn’t available", exact: true })).toBeVisible();
    await expect(page).toHaveTitle("Reading unavailable | CRC Torah");
    await expect(page.getByRole("link", { name: "Every parashah, holiday and passage", exact: true })).toHaveAttribute("href", "/readings");
  }
});
