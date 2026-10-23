import { expect, test, type Page } from "@playwright/test";
import { commentaryCandidates, commentaryEditionUrl, parseCommentaryChapter } from "../src/lib/readings/commentary";
import { thisShabbat } from "../src/lib/readings/public-shabbat";
import { studyEditions } from "../src/components/portal/workspace/study/credits";

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

test("/read opens in Lein; the switch opens Study verse rows with Rashi inline, drops the tikkun and is remembered in this browser", async ({ page }) => {
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
  await expect(page.getByRole("button", { name: /^Works/ })).toBeVisible();
  // English starts on in Study; Rashi sits under the verse it explains, English-led, the quoted words in bold Hebrew.
  const first = rows(page).nth(0);
  await expect(first.getByText("Synthetic translation Genesis 1:1")).toBeVisible();
  await expect(first.getByRole("heading", { name: "Rashi", exact: true })).toBeVisible();
  await expect(first.getByText("SYNTHETIC LEMMA ONE — synthetic comment one.")).toBeVisible();
  await expect(first.locator("bdi[lang=he]").first()).toHaveText("דֵּה וְזַח");
  // Verse 2 has no comment and shows no filler.
  await expect(rows(page).nth(1).getByRole("heading", { name: "Rashi" })).toHaveCount(0);
  // Hebrew shows Rashi's own words in place.
  await first.getByRole("button", { name: "Hebrew", exact: true }).first().click();
  await expect(first.getByText("חִי כָּל", { exact: false }).first()).toBeVisible();
  // Credit at the work's foot: edition, licence, via Sefaria, linked.
  await expect(page.getByText(/via Sefaria \(public domain\)/).first()).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Study", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(rows(page)).toHaveCount(3);
});

test("/read?lens=study opens Study directly; pointing at a comment underlines only the words it quotes, and an unmatched quote links nothing", async ({ page }) => {
  await mock(page);
  await page.goto("/read?lens=study");
  await expect(rows(page)).toHaveCount(3);
  const first = rows(page).nth(0), linked = first.locator('[data-linked="true"]');
  await expect(linked).toHaveCount(0);
  const entry = first.locator('[data-linkable="true"]');
  await expect(entry).toHaveCount(1); // the second comment's quote is not in the verse: no link
  await entry.hover();
  await expect(linked).toHaveCount(2);
  expect(await linked.evaluateAll(nodes => nodes.map(node => (node as HTMLElement).dataset.wordIndex))).toEqual(["1", "2"]);
  expect(await linked.first().evaluate(node => getComputedStyle(node).textDecorationLine)).toContain("underline");
  await page.mouse.move(0, 0);
  await expect(linked).toHaveCount(0);
  // Keyboard: focusing the quoted words underlines them too, with a visible focus ring.
  const quote = first.getByRole("button", { name: /show in the verse/ });
  await quote.focus();
  await expect(linked).toHaveCount(2);
  expect(await quote.evaluate(node => getComputedStyle(node).outlineStyle)).not.toBe("none");
  // Tapping pins it; tapping again lets it go.
  await quote.click();
  await expect(quote).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("heading", { level: 1 }).click();
  await expect(linked).toHaveCount(2);
  await quote.click();
  await expect(quote).toHaveAttribute("aria-pressed", "false");
  // A long comment shows three lines, then More.
  const long = rows(page).nth(2);
  const more = long.getByRole("button", { name: "More", exact: true });
  await expect(more).toBeVisible();
  await more.click();
  await expect(long.getByRole("button", { name: "Less", exact: true })).toHaveAttribute("aria-expanded", "true");
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
  // Rashi and the Women's Commentary are both on, so each says so on its own line.
  const status = page.getByRole("status"), line = (text: string) => status.locator("p", { hasText: text });
  await expect(line("Rashi isn’t available right now.")).toBeVisible();
  await expect(line("Women’s Commentary isn’t available right now.")).toBeVisible();
  server.recover();
  await line("Rashi isn’t available right now.").getByRole("button", { name: "Try again", exact: true }).click();
  await line("Women’s Commentary isn’t available right now.").getByRole("button", { name: "Try again", exact: true }).click();
  await expect(status).toHaveCount(0);
  await expect(rows(page).nth(0).getByText("SYNTHETIC LEMMA ONE — synthetic comment one.")).toBeVisible();
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

test("Study opens with Rashi and the Women's Commentary on the Torah; Works can turn the Women's Commentary off and it is remembered; on the haftarah it is simply not offered", async ({ page }) => {
  const server = await mock(page);
  await page.goto("/read?lens=study");
  await expect(rows(page)).toHaveCount(3);
  await expect(page.getByRole("button", { name: "Works: Rashi, Women’s Commentary" })).toBeVisible();
  await expect(rows(page).nth(1).getByRole("heading", { name: "Women’s Commentary", exact: true })).toBeVisible();
  await expect(rows(page).nth(1).getByText("synthetic paragraph")).toBeVisible();
  expect(server.calls.some(call => call.startsWith("/api/public/commentary?work=womens"))).toBe(true);
  // On the haftarah Rashi on the Prophets shows; the Women's Commentary is not offered: no request, no line, no panel.
  await page.getByRole("button", { name: "Haftarah", exact: true }).click();
  await expect(rows(page)).toHaveCount(2);
  await expect(rows(page).nth(0).getByText("Synthetic prophet comment")).toBeVisible();
  await expect(page.getByText("The Women’s Commentary covers the Torah only.")).toHaveCount(0);
  expect(server.calls.some(call => call === "/api/public/commentary?work=womens&chapter=Isaiah+54")).toBe(false);
  // A viewer can turn it off, and that choice is remembered in this browser like any other.
  await page.getByRole("button", { name: "Torah", exact: true }).click();
  await expect(rows(page)).toHaveCount(3);
  await page.getByRole("button", { name: /^Works/ }).click();
  await page.getByRole("group", { name: "Commentaries under each verse" }).locator('[data-work="womens"]').click();
  await page.keyboard.press("Escape");
  await expect(rows(page).nth(1).getByRole("heading", { name: "Women’s Commentary" })).toHaveCount(0);
  await page.reload();
  await expect(rows(page)).toHaveCount(3);
  await expect(page.getByRole("button", { name: "Works: Rashi", exact: true })).toBeVisible();
});

test("at 360px every Study row fits with no horizontal scroll, the toolbar is one row of at most five, and controls are 44px", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await mock(page);
  await page.goto("/read?lens=study");
  await expect(rows(page)).toHaveCount(3);
  await expect(rows(page).nth(0).getByText("SYNTHETIC LEMMA ONE — synthetic comment one.")).toBeVisible();
  expect(await noHorizontalScroll(page)).toBe(true);
  const items = page.locator(".reading-toolbar .toolbar-item");
  expect(await items.count()).toBeLessThanOrEqual(5);
  const tops = await items.evaluateAll(nodes => nodes.map(node => Math.round(node.getBoundingClientRect().top)));
  expect(new Set(tops).size).toBe(1);
  for (const control of [page.getByRole("button", { name: "Lein", exact: true }), page.getByRole("button", { name: "Study", exact: true }),
    rows(page).nth(0).getByRole("button", { name: "Hebrew", exact: true }).first(), rows(page).nth(2).getByRole("button", { name: "More", exact: true })]) {
    const box = await control.boundingBox();
    expect(box && box.height >= 44, "control is at least 44px tall").toBe(true);
  }
  await page.getByRole("button", { name: "Haftarah", exact: true }).click();
  await expect(rows(page)).toHaveCount(2);
  expect(await noHorizontalScroll(page)).toBe(true);
});
