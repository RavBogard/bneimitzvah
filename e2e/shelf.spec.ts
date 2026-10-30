import { expect, test, type Page } from "@playwright/test";
import { studyEditions } from "../src/components/portal/workspace/study/credits";
import { shelfSefariaUrl, sourceSefariaUrl } from "../src/lib/readings/shelf";
import { creditLine, licenseLabel } from "../src/lib/readings/edition-credit";
import { parseCommentaryChapter, commentaryCandidates, commentaryEditionUrl } from "../src/lib/readings/commentary";
import { closeNotes, verseNotes } from "./study-sheet";

// More on this verse on the built, unconfigured production server. Every answer is a synthetic route
// fulfilment: invented titles, citations and syllables, numbered English only.
const word = ["אָבָ֑ג", "דֵּ֖ה", "וְזַ֥ח"];
const verseOf = (ref: string) => { const text = `${word.join(" ")}׃`; return { ref, english: `Synthetic translation ${ref}`, hebrew: { text, readingText: text, paragraphAfter: null, segments: [{ kind: "text", text }] } }; };
const refs = ["Genesis 1:1", "Genesis 1:2", "Genesis 1:3"];
const work = (title: string, category: string, items: { ref: string; segments: number }[], extra: Record<string, unknown> = {}) =>
  ({ title, heTitle: null, dates: null, category, curated: false, items, more: 0, ...extra });
const shelfFor = (verse: string) => ({ verse, sefariaUrl: shelfSefariaUrl(verse), groups: [
  { key: "commentary", label: "Commentary", count: 4, works: [work("Rashi", "Commentary", [{ ref: `Rashi on ${verse}:1`, segments: 1 }], { curated: true }),
    work("Ramban", "Commentary", [{ ref: `Ramban on ${verse}`, segments: 3 }], { curated: true, heTitle: "רמב״ן", dates: [1246, 1270] })] },
  { key: "midrash", label: "Midrash", count: 2, works: [work("Synthetic Midrash", "Midrash", [{ ref: "Synthetic Midrash 1:1", segments: 1 }, { ref: "Synthetic Midrash Missing 2:1", segments: 1 }], { more: 4 })] },
  { key: "halakhah", label: "Halakhah", count: 1, works: [work("Synthetic Code", "Halakhah", [{ ref: "Synthetic Code 1:1", segments: 1 }])] },
  { key: "talmud", label: "Talmud", count: 1, works: [work("Synthetic Tractate", "Talmud", [{ ref: "Synthetic Tractate 2a:1", segments: 1 }])] },
  { key: "targum", label: "Targum", count: 1, works: [work("Onkelos Genesis", "Targum", [{ ref: `Onkelos ${verse}`, segments: 1 }])] },
  { key: "other", label: "Everything else", count: 2, works: [work("Synthetic Chasidut", "Chasidut", [{ ref: "Synthetic Chasidut 1", segments: 1 }]), work("Synthetic Kabbalah", "Kabbalah", [{ ref: "Synthetic Kabbalah 2", segments: 1 }])] },
] });
const edition = (ref: string, language: "he" | "en", title: string, license: string) => ({ language, title, license, licenseLabel: licenseLabel(license), credit: creditLine(title, license), url: sourceSefariaUrl(ref, { language, title }) });
async function mock(page: Page, options: { shelf?: "ok" | "fail"; source?: "ok" | "fail" } = {}) {
  let shelfFails = options.shelf === "fail", sourceFails = options.source === "fail";
  await page.route("**/api/public/**", route => {
    const url = new URL(route.request().url()), q = url.searchParams;
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (url.pathname === "/api/public/reading") return json({ date: q.get("date"), parashah: "Synthetic", fetchedAt: 0, listening: { pocketTorah: false },
      torah: { kind: "torah", ranges: ["Genesis 1:1-3"], verseCount: 3, pages: [{ offset: 0, first: "Genesis 1:1", last: "Genesis 1:3" }] }, haftarah: null });
    if (url.pathname === "/api/public/text") return json({ kind: "torah", date: q.get("date"), offset: 0, nextOffset: null, totalVerses: 3, translation: { key: "jps2023", status: "available" },
      verses: refs.map(verseOf), chapters: [{ ref: "Genesis 1", sefariaUrl: "https://www.sefaria.org/Genesis.1", fetchedAt: 0, hash: "c".repeat(64), editions: [studyEditions.mam, studyEditions.jps2023] }] });
    if (url.pathname === "/api/public/related") return shelfFails ? json({ error: "unavailable" }, 503) : json({ ...shelfFor(q.get("verse")!), productName: "Synthetic Portal" });
    if (url.pathname === "/api/public/source") {
      const ref = q.get("ref")!;
      if (ref.includes("Missing")) return json({ error: "not-found" }, 404);
      if (sourceFails) return json({ error: "unavailable" }, 503);
      return json({ ref, sefariaUrl: sourceSefariaUrl(ref), segments: [{ hebrew: [{ text: "אָב גַּד" }], english: [{ text: `Synthetic comment one of ${ref}.` }] }, { hebrew: [{ text: "הוּ זַח" }], english: null }],
        editions: [edition(ref, "he", "Synthetic Hebrew Edition", "Public Domain"), edition(ref, "en", "Synthetic English Edition", "")] });
    }
    // A verse has a notes card (and so "Everything on this verse") only where something speaks on it, so Rashi speaks on all three verses (Study v6).
    if (url.pathname === "/api/public/commentary") {
      const work = q.get("work")!, chapter = q.get("chapter")!, parsed = parseCommentaryChapter(work, chapter), c = parsed ? commentaryCandidates(parsed) : null;
      const editions = parsed && c ? [c.he[0], c.en[0]].filter(Boolean).map(item => ({ language: item.language, title: item.title, license: item.license, credit: item.credit, url: commentaryEditionUrl(parsed, item) })) : [];
      return json({ work, chapter, verses: work === "rashi" ? Object.fromEntries(["1", "2", "3"].map(n => [n, { comments: [{ hebrew: null, english: [{ text: `Synthetic comment ${n}` }] }] }])) : {}, editions });
    }
    return json({ error: "unavailable" }, 503);
  });
  return { recoverShelf() { shelfFails = false; }, recoverSource() { sourceFails = false; } };
}
const row = (page: Page, ref: string) => page.locator(`[data-study-rows] article[data-verse-ref="${ref}"]`);
/** A verse's More on this verse: with its notes (the rail beside the verses, or its Notes sheet on a phone; Study as a study sheet, 2026-10-28). */
const more = async (page: Page, ref: string) => (await verseNotes(page, ref)).getByRole("button", { name: "Everything on this verse", exact: true });
const panel = (page: Page) => page.locator("[data-verse-panel]");
const pills = (page: Page) => panel(page).getByRole("group", { name: "Kinds of texts" });

test("More on this verse: kinds of texts as wrapping pills, curated works, a citation that opens in place with its credit, and Esc", async ({ page }) => {
  await mock(page);
  await page.goto("/read?lens=study");
  const button = await more(page, "Genesis 1:2");
  await button.scrollIntoViewIfNeeded();
  expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  const scrolled = await page.evaluate(() => scrollY);
  await button.click();
  await expect(page.getByRole("dialog", { name: "More on Genesis 1:2" }).getByRole("heading", { name: "More on Genesis 1:2" })).toBeFocused();
  expect(await page.evaluate(() => scrollY)).toBe(scrolled);
  // Rashi is already inline (Study's default Works), so the shelf leaves it out.
  await expect(pills(page).getByRole("button")).toHaveText(["Commentary 1", "Midrash 1", "Halakhah 1", "Talmud 1", "Targum 1", "Everything else 2"]);
  await expect(panel(page).getByText("Rashi", { exact: true })).toHaveCount(0);
  await expect(panel(page).getByText("Composed 1246–1270")).toBeVisible();
  for (const box of await pills(page).getByRole("button").evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().height))) expect(box).toBeGreaterThanOrEqual(43.99);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  // A citation opens its text in place: three comments as one, then the credit, linked.
  const ramban = panel(page).getByRole("button", { name: "Ramban on Genesis 1:2 · 3 comments", exact: true });
  await ramban.click();
  await expect(ramban).toHaveAttribute("aria-expanded", "true");
  await expect(panel(page).getByText("Synthetic comment one of Ramban on Genesis 1:2.")).toBeVisible();
  await expect(panel(page).getByRole("link", { name: "Synthetic Hebrew Edition, via Sefaria (public domain)" })).toBeVisible();
  await expect(panel(page).getByRole("link", { name: "Synthetic English Edition, via Sefaria (licence not stated)" })).toBeVisible();
  await expect(panel(page).getByRole("link", { name: "Ramban on Genesis 1:2 on Sefaria" })).toHaveAttribute("href", sourceSefariaUrl("Ramban on Genesis 1:2"));
  // Hebrew in place; a segment with Hebrew only leads in Hebrew.
  await panel(page).getByRole("button", { name: "Hebrew", exact: true }).first().click();
  await expect(panel(page).locator('[lang="he"][dir="rtl"]').filter({ hasText: "אָב גַּד" })).toBeVisible();
  await expect(panel(page).locator('p[lang="he"]').filter({ hasText: "הוּ זַח" })).toBeVisible();
  // Another kind; a text the page cannot show offers Sefaria instead.
  await pills(page).getByRole("button", { name: /^Midrash/ }).click();
  await panel(page).getByRole("button", { name: "Synthetic Midrash Missing 2:1", exact: true }).click();
  await expect(panel(page).getByRole("link", { name: "Open on Sefaria", exact: true })).toHaveAttribute("href", sourceSefariaUrl("Synthetic Midrash Missing 2:1"));
  await expect(panel(page).getByText("4 more on Sefaria")).toBeVisible();
  // Everything else is headed by category.
  await pills(page).getByRole("button", { name: /^Everything else/ }).click();
  await expect(panel(page).getByRole("heading", { name: "Chasidut" })).toBeVisible();
  await expect(panel(page).getByRole("heading", { name: "Kabbalah" })).toBeVisible();
  await expect(panel(page).getByRole("link", { name: "All related texts on Sefaria" })).toHaveAttribute("href", shelfSefariaUrl("Genesis 1:2"));
  // The CC BY note of changes, naming the congregation's product as the related route gives it.
  await expect(panel(page).getByText("Selected and ordered by Synthetic Portal", { exact: true })).toBeVisible();
  // Esc (focus in the panel) closes it and gives focus back.
  await panel(page).getByRole("link", { name: "All related texts on Sefaria" }).focus();
  await page.keyboard.press("Escape");
  await expect(panel(page)).toHaveCount(0);
  await expect(button).toBeFocused();
});

test("failures are one quiet line with Try again, for the shelf and for one text", async ({ page }) => {
  const sefaria = await mock(page, { shelf: "fail", source: "fail" });
  await page.goto("/read?lens=study");
  await (await more(page, "Genesis 1:1")).click();
  await expect(panel(page).getByText("More on this verse isn’t available right now.")).toBeVisible();
  sefaria.recoverShelf();
  await panel(page).getByRole("button", { name: "Try again", exact: true }).click();
  await panel(page).getByRole("button", { name: "Ramban on Genesis 1:1 · 3 comments", exact: true }).click();
  await expect(panel(page).getByText("This text isn’t available right now.")).toBeVisible();
  sefaria.recoverSource();
  await panel(page).getByRole("button", { name: "Try again", exact: true }).click();
  await expect(panel(page).getByText("Synthetic comment one of Ramban on Genesis 1:1.")).toBeVisible();
  await expect(row(page, "Genesis 1:2")).toBeVisible();
});

test("with reduced motion the panel opens at once, and Lein offers no shelf", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await mock(page);
  await page.goto("/read?lens=study");
  await (await more(page, "Genesis 1:3")).click();
  await expect(panel(page)).toBeVisible();
  // The sheet's rise snaps: no animation at all.
  expect(await page.getByRole("dialog", { name: "More on Genesis 1:3" }).evaluate(node => getComputedStyle(node).animationName)).toBe("none");
  await page.keyboard.press("Escape");
  await closeNotes(page);
  await page.getByRole("button", { name: "Lein", exact: true }).click();
  await expect(page.getByRole("button", { name: "Everything on this verse", exact: true })).toHaveCount(0);
  await expect(panel(page)).toHaveCount(0);
});

test("an opened Targum or Talmud text is marked Aramaic; a midrash stays Hebrew", async ({ page }) => {
  await mock(page);
  await page.goto("/read?lens=study");
  await (await more(page, "Genesis 1:1")).click();
  await pills(page).getByRole("button", { name: /^Talmud/ }).click();
  await panel(page).getByRole("button", { name: "Synthetic Tractate 2a:1", exact: true }).click();
  await expect(panel(page).locator('p[lang="arc"][dir="rtl"]').filter({ hasText: "הוּ זַח" })).toBeVisible();
  await pills(page).getByRole("button", { name: /^Targum/ }).click();
  await panel(page).getByRole("button", { name: "Onkelos Genesis 1:1", exact: true }).click();
  await expect(panel(page).locator('p[lang="arc"]').first()).toBeVisible();
  await pills(page).getByRole("button", { name: /^Midrash/ }).click();
  await panel(page).getByRole("button", { name: "Synthetic Midrash 1:1", exact: true }).click();
  await expect(panel(page).locator('p[lang="he"][dir="rtl"]').filter({ hasText: "הוּ זַח" })).toBeVisible();
  await expect(panel(page).locator('[lang="arc"]')).toHaveCount(0);
});

test("a text opened in More on this verse names its English, leads with it, credits it first, and its Hebrew follows the size control (N5)", async ({ page }) => {
  await mock(page);
  await page.goto("/read?lens=study");
  await (await more(page, "Genesis 1:2")).click();
  await panel(page).getByRole("button", { name: "Ramban on Genesis 1:2 · 3 comments", exact: true }).click();
  // The segment with English leads in English under an "English" tag; the segment with Hebrew only has no tag.
  await expect(panel(page).getByText("English", { exact: true })).toHaveCount(1);
  const credits = (await panel(page).locator("p", { hasText: "Synthetic English Edition" }).first().textContent())!;
  expect(credits.indexOf("English:"), credits).toBeLessThan(credits.indexOf("Hebrew:"));
  // The Hebrew behind its button grows with the size control: the Sheet carries the same four steps as the page.
  const sizeOf = async (id: string) => {
    await page.keyboard.press("Escape");
    await closeNotes(page);
    await page.getByRole("button", { name: /^Text size/ }).click();
    await page.locator(`.toolbar-menu [data-size="${id}"]`).click();
    await (await more(page, "Genesis 1:2")).click();
    const ramban = panel(page).getByRole("button", { name: "Ramban on Genesis 1:2 · 3 comments", exact: true });
    if ((await ramban.getAttribute("aria-expanded")) !== "true") await ramban.click();
    const hebrew = panel(page).locator('p[lang="he"]').filter({ hasText: "הוּ זַח" });
    return hebrew.evaluate(node => parseFloat(getComputedStyle(node).fontSize));
  };
  const small = await sizeOf("small"), huge = await sizeOf("huge");
  expect(huge).toBeGreaterThan(small * 1.5);
});
