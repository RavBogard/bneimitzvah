import { expect, test, type Page } from "@playwright/test";
import { commentaryCandidates, commentaryEditionUrl, parseCommentaryChapter } from "../src/lib/readings/commentary";
import { thisShabbat } from "../src/lib/readings/public-shabbat";
import { studyEditions } from "../src/components/portal/workspace/study/credits";
import { closeNotes, verseNotes } from "./study-sheet";

// The built, unconfigured production server. Every reading and commentary answer is a synthetic
// route fulfilment: invented syllables and numbered English only, never a verse, a translation or a
// commentary's words. The page's own client code is what is under test.
const word = ["אָבָ֑ג", "דֵּ֖ה", "וְזַ֥ח", "טִֽים", "כָּ֔ךְ", "לֻ֣ם"];
const hebrewOf = (n: number) => `${word.slice(0, 3 + n).join(" ")}׃`;
const verseOf = (ref: string, n: number) => {
  const text = hebrewOf(n);
  return { ref, english: `Synthetic translation ${ref}`, hebrew: { text, readingText: text, paragraphAfter: null, segments: [{ kind: "text", text }] } };
};
const passages = {
  torah: { kind: "torah", ranges: ["Genesis 1:1-3"], verseCount: 3, pages: [{ offset: 0, first: "Genesis 1:1", last: "Genesis 1:3" }], refs: ["Genesis 1:1", "Genesis 1:2", "Genesis 1:3"], chapter: "Genesis 1" },
  haftarah: { kind: "haftarah", ranges: ["Isaiah 54:1-2"], verseCount: 2, pages: [{ offset: 0, first: "Isaiah 54:1", last: "Isaiah 54:2" }], refs: ["Isaiah 54:1", "Isaiah 54:2"], chapter: "Isaiah 54" },
} as const;
const editionsFor = (work: string, chapterName: string) => {
  const chapter = parseCommentaryChapter(work, chapterName)!, candidates = commentaryCandidates(chapter);
  return [candidates.he[0], candidates.en[0]].filter(Boolean).map(candidate => ({ language: candidate.language, title: candidate.title, license: candidate.license,
    credit: candidate.credit, url: commentaryEditionUrl(chapter, candidate) }));
};
const runs = (lead: string | null, rest: string) => lead ? [{ text: lead, bold: true }, { text: ` ${rest}` }] : [{ text: rest }];
// Verse 1: two comments, the first quoting words that occur once (a link), the second quoting words found nowhere.
// Verse 2: nothing. Verse 3: one long comment.
const rashiVerses = {
  "1": { comments: [{ hebrew: runs("דֵּה וְזַח.", "חִי כָּל"), english: [{ text: "SYNTHETIC LEMMA ONE — synthetic comment one." }] },
    { hebrew: runs("קֹרֶשׁ.", "חִי"), english: [{ text: "SYNTHETIC LEMMA TWO — synthetic comment two." }] }] },
  "3": { comments: [{ hebrew: runs("טִים.", "חִי"), english: [{ text: Array.from({ length: 40 }, (_, i) => `synthetic clause ${i + 1}`).join(", ") }] }] },
};
type Mocks = { commentary?: "ok" | "fail" };
async function mock(page: Page, options: Mocks = {}) {
  const calls: string[] = [];
  let failing = options.commentary === "fail";
  await page.route("**/api/public/**", route => {
    const url = new URL(route.request().url()), q = url.searchParams;
    calls.push(url.pathname + url.search);
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (url.pathname === "/api/public/reading") {
      const strip = ({ refs: _r, chapter: _c, ...rest }: (typeof passages)[keyof typeof passages]) => rest;
      return json({ date: q.get("date"), parashah: "Synthetic", fetchedAt: 0, listening: { pocketTorah: false }, torah: strip(passages.torah), haftarah: strip(passages.haftarah) });
    }
    if (url.pathname === "/api/public/text") {
      const passage = passages[q.get("kind") as "torah" | "haftarah"], [book, number] = [passage.chapter.slice(0, passage.chapter.lastIndexOf(" ")), passage.chapter.slice(passage.chapter.lastIndexOf(" ") + 1)];
      return json({ kind: passage.kind, date: q.get("date"), offset: 0, nextOffset: null, totalVerses: passage.verseCount, translation: { key: "jps2023", status: "available" },
        verses: passage.refs.map((ref, index) => verseOf(ref, index)),
        chapters: [{ ref: passage.chapter, sefariaUrl: `https://www.sefaria.org/${encodeURIComponent(book)}.${number}`, fetchedAt: 0, hash: "c".repeat(64), editions: [studyEditions.mam, studyEditions.jps2023] }] });
    }
    if (url.pathname === "/api/public/commentary") {
      if (failing) return json({ error: "unavailable" }, 503);
      const work = q.get("work")!, chapter = q.get("chapter")!;
      const verses = work === "rashi" ? chapter === "Genesis 1" ? rashiVerses : { "1": { comments: [{ hebrew: runs("אָבָג.", "חִי"), english: [{ text: "Synthetic prophet comment" }] }] } }
        : { "2": { comments: [{ hebrew: null, english: [{ text: "Synthetic heading", italic: true }, { text: " synthetic paragraph" }] }] } };
      return json({ work, chapter, verses, editions: editionsFor(work, chapter) });
    }
    return json({ error: "not-found" }, 404);
  });
  return { calls, recover() { failing = false; } };
}
const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
const rows = (page: Page) => page.locator("[data-study-rows] article[data-verse-ref]");

test("/read opens in Lein; the switch opens Study verse rows with Rashi on the chosen verse, drops the tikkun and is remembered in this browser", async ({ page }) => {
  await mock(page);
  await page.goto("/read");
  const lein = page.getByRole("button", { name: "Lein", exact: true }), study = page.getByRole("button", { name: "Study", exact: true });
  await expect(lein).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".study-verses")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Tikkun/ })).toBeVisible();
  await expect(page.locator("[data-study-rows]")).toHaveCount(0);
  await study.click();
  await expect(study).toHaveAttribute("aria-pressed", "true");
  await expect(page).toHaveURL(/\/read\?lens=study$/);
  await expect(rows(page)).toHaveCount(3);
  await expect(page.getByRole("button", { name: /^Tikkun/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Commentaries/ })).toBeVisible();
  // English starts on in Study, in the verse's row; Rashi is with the verse's notes (the column, or inline on a phone), English-led, the quoted words in Hebrew in its header.
  await expect(rows(page).nth(0).getByText("Synthetic translation Genesis 1:1")).toBeVisible();
  const first = await verseNotes(page, "Genesis 1:1");
  await expect(first.locator('[data-note-work="rashi"]').first()).toBeVisible();
  await expect(first.getByText("SYNTHETIC LEMMA ONE — synthetic comment one.")).toBeVisible();
  await expect(first.locator("bdi[lang=he]").first()).toHaveText("דֵּה וְזַח");
  // Rashi's own Hebrew words are with it (on a phone, behind More).
  const moreHebrew = first.getByRole("button", { name: "More", exact: true }).first();
  if (await moreHebrew.count()) await moreHebrew.click();
  await expect(first.getByText("חִי כָּל", { exact: false }).first()).toBeVisible();
  // Verse 2 has no comment, so it has no line in the column and no inline notes.
  await expect((await verseNotes(page, "Genesis 1:2")).locator('[data-note-work="rashi"]')).toHaveCount(0);
  // Credit at the work's foot: edition, licence, via Sefaria, linked.
  await expect(page.getByText(/Metsudah Publications, 2009, via Sefaria \(CC BY\)/).first()).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Study", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(rows(page)).toHaveCount(3);
});

test("Study plays nothing and colours nothing: plain Hebrew, no Colors, Hear verse or listen bar, a row and its notes column on a wide screen and inline notes on a phone; Lein keeps them", async ({ page }) => {
  await mock(page);
  await page.goto("/read?lens=study");
  await expect(rows(page)).toHaveCount(3);
  await expect(page.locator("[data-study-rows] [data-family]")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Colors", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Hear/ })).toHaveCount(0);
  await expect(page.getByTestId("player-selection")).toHaveCount(0);
  await expect(page.getByTestId("study-toolbar")).toBeVisible();
  const wide = (page.viewportSize()?.width ?? 0) >= 900;
  await expect(page.locator("[data-study-rail]")).toHaveCount(wide ? 1 : 0);
  await expect(rows(page).nth(0).locator("[data-inline-notes]")).toHaveCount(wide ? 0 : 1);
  if (wide) {
    // The column lists only the verses that have entries (verses 1 and 3), exactly one open; the verse with entries has dots under its number and the other none.
    await expect(page.locator("[data-study-rail] [data-rail-item]")).toHaveCount(2);
    await expect(page.locator("[data-study-rail] [data-open]")).toHaveCount(1);
    await expect(rows(page).nth(0).locator("[data-note-dots]")).toBeVisible();
    await expect(rows(page).nth(1).locator("[data-note-dots]")).toHaveCount(0);
    // English, then the number, then the Hebrew, along one row.
    const box = async (selector: string) => (await rows(page).nth(0).locator(selector).first().boundingBox())!;
    const english = await box("[data-english-ref]"), number = await box("button[data-verse-number]"), hebrew = await box(".study-hebrew");
    expect(english.x).toBeLessThan(number.x); expect(number.x).toBeLessThan(hebrew.x);
  } else {
    // Hebrew first, the English beneath it.
    const hebrew = (await rows(page).nth(0).locator(".study-hebrew").boundingBox())!, english = (await rows(page).nth(0).locator("[data-english-ref]").boundingBox())!;
    expect(hebrew.y).toBeLessThan(english.y);
    expect((await rows(page).nth(0).getByRole("button", { name: "Copy", exact: true }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  // Lein restores Colors as it was left.
  await page.getByRole("button", { name: "Lein", exact: true }).click();
  await expect(page.getByRole("button", { name: "Colors", exact: true })).toHaveAttribute("aria-pressed", "true");
});

test("/read?lens=study opens Study directly; a commentary whose quoted words are in the verse once has a letter on the word and on its note, and an unmatched quote has none", async ({ page }) => {
  await mock(page);
  await page.goto("/read?lens=study");
  await expect(rows(page)).toHaveCount(3);
  const first = await verseNotes(page, "Genesis 1:1");
  await expect(rows(page).nth(0).locator(".study-lemma-letter")).toHaveText("a");
  await expect(first.locator("[data-lemma-letter]")).toHaveCount(1); // the second comment's quote is not in the verse: no letter
  await expect(first.locator('[data-lemma-letter="a"]')).toHaveText("a");
  // A long comment shows its first lines, then More.
  const long = await verseNotes(page, "Genesis 1:3");
  const more = long.getByRole("button", { name: "More", exact: true });
  await expect(more).toBeVisible();
  await more.click();
  await expect(long.getByRole("button", { name: "Show less", exact: true })).toHaveAttribute("aria-expanded", "true");
});

test("Lein stays quiet: the selected verse's tools gain Rashi (n), closed, opening in place, and absent where Rashi is silent", async ({ page }) => {
  await mock(page);
  await page.goto("/read");
  await expect(page.locator(".study-verses")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Rashi/ })).toHaveCount(0);
  await page.locator('[data-hebrew-ref="Genesis 1:1"] [data-word-index="0"]').click();
  const rashi = page.getByRole("button", { name: "Rashi (2)", exact: true });
  await expect(rashi).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByText("SYNTHETIC LEMMA ONE")).toHaveCount(0);
  await rashi.click();
  await expect(rashi).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("heading", { name: "Rashi on Genesis 1:1" })).toBeVisible();
  await expect(page.getByText("SYNTHETIC LEMMA ONE — synthetic comment one.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Rashi on Genesis 1:1 on Sefaria" })).toHaveAttribute("href", "https://www.sefaria.org/Rashi_on_Genesis.1.1");
  // The comment-to-word link works in the continuous passage too.
  await page.locator('[data-verse-rashi] [data-linkable="true"]').hover();
  await expect(page.locator('[data-hebrew-ref="Genesis 1:1"] [data-linked="true"]')).toHaveCount(2);
  // Verse 2: Rashi is silent, so there is no Rashi control at all.
  await page.locator('[data-hebrew-ref="Genesis 1:2"] [data-word-index="0"]').click();
  await expect(page.getByRole("button", { name: /^Rashi/ })).toHaveCount(0);
});

test("a commentary failure is a quiet line with Try again and never holds back the Hebrew", async ({ page }) => {
  const server = await mock(page, { commentary: "fail" });
  await page.goto("/read?lens=study");
  await expect(rows(page)).toHaveCount(3);
  await expect(rows(page).nth(0).locator(".study-hebrew")).toBeVisible();
  // Rashi, the default, says so on its own line.
  const status = page.getByRole("status"), line = (text: string) => status.locator("p", { hasText: text });
  await expect(line("Rashi isn’t available right now.")).toBeVisible();
  server.recover();
  await line("Rashi isn’t available right now.").getByRole("button", { name: "Try again", exact: true }).click();
  await expect(status).toHaveCount(0);
  await expect((await verseNotes(page, "Genesis 1:1")).getByText("SYNTHETIC LEMMA ONE — synthetic comment one.")).toBeVisible();
});

test("in Lein a commentary outage shows nothing under the selected verse, and Up close reads with its spaces", async ({ page }) => {
  await mock(page, { commentary: "fail" });
  await page.goto("/read");
  await page.locator('[data-hebrew-ref="Genesis 1:1"] [data-word-index="0"]').click();
  const up = page.getByRole("button", { name: "View Genesis 1:1 up close", exact: true });
  await expect(up).toBeVisible();
  expect(await up.evaluate(node => (node as HTMLElement).innerText.trim())).toBe("View Genesis 1:1 up close"); // as laid out: no line breaks or lost spaces between the parts
  await page.waitForTimeout(300); // let the failed commentary settle
  await expect(page.getByRole("button", { name: /^Rashi/ })).toHaveCount(0);
  await expect(page.getByText("Rashi isn’t available right now.")).toHaveCount(0);
});

test("Study opens with Rashi on the Torah; Commentaries can add the Women's Commentary in its own colour and it is remembered; on the haftarah Rashi on the Prophets shows", async ({ page }) => {
  const server = await mock(page);
  await page.goto("/read?lens=study");
  await expect(rows(page)).toHaveCount(3);
  await expect(page.getByRole("button", { name: "Commentaries: Rashi", exact: true })).toBeVisible();
  // The Women's Commentary is not on: no request, and verse 2 (where only it speaks) has no entries.
  expect(server.calls.some(call => call.startsWith("/api/public/commentary?work=womens"))).toBe(false);
  await page.getByRole("button", { name: /^Commentaries/ }).click();
  await page.getByRole("group", { name: "Commentaries under each verse" }).locator('[data-work="womens"]').click();
  await page.keyboard.press("Escape");
  const second = await verseNotes(page, "Genesis 1:2");
  await expect(second.locator('[data-note-work="womens"][data-note-kind="modern"]')).toBeVisible();
  await expect(second.getByText("synthetic paragraph")).toBeVisible();
  expect(server.calls.some(call => call.startsWith("/api/public/commentary?work=womens"))).toBe(true);
  // On the haftarah Rashi on the Prophets shows.
  await page.getByRole("tab", { name: /^Haftarah/ }).click();
  await expect(rows(page)).toHaveCount(2);
  await expect((await verseNotes(page, "Isaiah 54:1")).getByText("Synthetic prophet comment")).toBeVisible();
  // The choice is remembered in this browser like any other.
  await page.getByRole("tab", { name: /^Torah/ }).click();
  await expect(rows(page)).toHaveCount(3);
  await page.reload();
  await expect(rows(page)).toHaveCount(3);
  await expect(page.getByRole("button", { name: "Commentaries: Rashi, Women’s Commentary", exact: true })).toBeVisible();
});

test("at 360px every Study row fits with no horizontal scroll, the toolbar is one row of at most five, and controls are 44px", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await mock(page);
  await page.goto("/read?lens=study");
  await expect(rows(page)).toHaveCount(3);
  expect(await noHorizontalScroll(page)).toBe(true);
  const items = page.locator(".study-toolbar .study-tool");
  expect(await items.count()).toBeLessThanOrEqual(5);
  const tops = await items.evaluateAll(nodes => nodes.map(node => Math.round(node.getBoundingClientRect().top)));
  expect(new Set(tops).size).toBe(1);
  for (const control of [page.getByRole("button", { name: "Lein", exact: true }), page.getByRole("button", { name: "Study", exact: true }), ...await items.all(), rows(page).nth(0).getByRole("button", { name: "Copy", exact: true })]) {
    const box = await control.boundingBox();
    expect(box && box.height >= 44, "control is at least 44px tall").toBe(true);
  }
  for (const [ref, name] of [["Genesis 1:1", "More"], ["Genesis 1:3", "More"]] as const) {
    const notes = await verseNotes(page, ref);
    if (ref === "Genesis 1:1") await expect(notes.getByText("SYNTHETIC LEMMA ONE — synthetic comment one.")).toBeVisible();
    const box = await notes.getByRole("button", { name, exact: true }).first().boundingBox();
    expect(box && box.height >= 44, "control is at least 44px tall").toBe(true);
  }
  await closeNotes(page);
  await page.getByRole("tab", { name: /^Haftarah/ }).click();
  await expect(rows(page)).toHaveCount(2);
  expect(await noHorizontalScroll(page)).toBe(true);
});
