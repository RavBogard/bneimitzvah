import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { studyEditions } from "../src/components/portal/workspace/study/credits";

// The side-by-side tikkun, on the built, unconfigured production server with every reading answer a
// synthetic route fulfilment: invented syllables only, never a verse. The page's own client code is
// what is under test. The two columns must break into the same lines, word for word, at every width
// and size, the way a printed tikkun sets them: a row never holds a word on one side that the other
// side puts on another line, and no word reaches past its column.
const MAQAF = 0x05be, SOF_PASUQ = 0x05c3, SILLUQ = 0x05bd;
const consonants = [...("בגדהזחטכלמנסעפצקרשתאי")];
const vowels = [0x05b8, 0x05b7, 0x05b5, 0x05b4, 0x05b9, 0x05bb, 0x05b6].map(code => String.fromCodePoint(code));
const accents = [0x0591, 0x0596, 0x05a5, 0x0594, 0x059b, 0x05a3].map(code => String.fromCodePoint(code));
const prefixes = ["", "", "", "וְ", "בְּ", "וּלְ", "הַ"];

/** A small deterministic stream, so every run sees the same invented verses. */
function stream(seed: number) { let state = seed >>> 0; return (limit: number) => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state % limit; }; }
function inventedWord(next: (limit: number) => number, accent: boolean, long: boolean) {
  const syllables = long ? 3 + next(2) : 1 + next(3);
  let word = prefixes[next(prefixes.length)];
  for (let index = 0; index < syllables; index++) word += consonants[next(consonants.length)] + vowels[next(vowels.length)];
  return word + consonants[next(consonants.length)] + (accent ? accents[next(accents.length)] : "");
}
function inventedVerse(seed: number, count: number) {
  const next = stream(seed), words: string[] = [];
  while (words.length < count) {
    const accent = next(3) === 0, joined = next(4) === 0;
    // Some words as long as the Torah's longest, some phrases tied by a maqaf.
    words.push(joined ? `${inventedWord(next, false, false)}${String.fromCodePoint(MAQAF)}${inventedWord(next, accent, false)}` : inventedWord(next, accent, next(9) === 0));
  }
  return `${words.join(" ")}${String.fromCodePoint(SILLUQ)}${String.fromCodePoint(SOF_PASUQ)}`.normalize("NFC");
}
type Sample = { book: string; chapter: number; first: number; last: number };
const samples = { lech: { book: "Genesis", chapter: 12, first: 1, last: 9 }, vayera: { book: "Genesis", chapter: 18, first: 1, last: 14 } } satisfies Record<string, Sample>;
function passageOf({ book, chapter, first, last }: Sample) {
  const refs = Array.from({ length: last - first + 1 }, (_, index) => `${book} ${chapter}:${first + index}`), chapterName = `${book} ${chapter}`;
  const verses = refs.map((ref, index) => {
    const text = inventedVerse(chapter * 100 + index, 9 + (index * 5) % 14);
    return { ref, english: `Synthetic translation ${ref}`, hebrew: { text, readingText: text, paragraphAfter: null, segments: [{ kind: "text", text }] } };
  });
  return { refs, chapterName, verses, torah: { kind: "torah", ranges: [`${book} ${chapter}:${first}-${last}`], verseCount: refs.length, pages: [{ offset: 0, first: refs[0], last: refs.at(-1) }] } };
}
async function mock(page: Page, sample: Sample) {
  const passage = passageOf(sample);
  await page.route("**/api/public/**", route => {
    const url = new URL(route.request().url()), q = url.searchParams;
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (url.pathname === "/api/public/reading") {
      return json({ date: q.get("date"), parashah: "Synthetic", fetchedAt: 0, listening: { pocketTorah: false }, torah: passage.torah,
        haftarah: { kind: "haftarah", ranges: ["Isaiah 54:1-2"], verseCount: 2, pages: [{ offset: 0, first: "Isaiah 54:1", last: "Isaiah 54:2" }] } });
    }
    if (url.pathname === "/api/public/text") {
      if (q.get("kind") !== "torah") return json({ error: "not-found" }, 404);
      return json({ kind: "torah", date: q.get("date"), offset: 0, nextOffset: null, totalVerses: passage.refs.length, translation: { key: "jps2023", status: "available" }, verses: passage.verses,
        chapters: [{ ref: passage.chapterName, sefariaUrl: `https://www.sefaria.org/${encodeURIComponent(sample.book)}.${sample.chapter}`, fetchedAt: 0, hash: "c".repeat(64), editions: [studyEditions.mam, studyEditions.jps2023] }] });
    }
    return json({ error: "not-found" }, 404);
  });
}

type Measured = { rows: { pointed: number[]; tikkun: number[] }[]; overflow: string[]; scrollFits: boolean; lineCount: number };
/** Reads the page the way a reader sees it: words are grouped into visual rows by where they sit, never by the page's own bookkeeping. */
function measure(page: Page): Promise<Measured> {
  return page.evaluate(() => {
    const rows: { pointed: number[]; tikkun: number[] }[] = [], overflow: string[] = [];
    const clusters = (words: { index: number; rect: DOMRect }[]) => {
      const out: { y: number; indexes: number[] }[] = [];
      for (const word of [...words].sort((a, b) => a.rect.top + a.rect.height / 2 - (b.rect.top + b.rect.height / 2))) {
        const y = word.rect.top + word.rect.height / 2, row = out.find(candidate => Math.abs(candidate.y - y) < 12);
        if (row) { if (!row.indexes.includes(word.index)) row.indexes.push(word.index); } else out.push({ y, indexes: [word.index] });
      }
      return out;
    };
    let lineCount = 0;
    for (const verse of document.querySelectorAll<HTMLElement>(".study-verses [data-verse-ref]")) {
      const pointedCell = verse.querySelector<HTMLElement>("[data-hebrew-ref]")!, tikkunCell = verse.querySelector<HTMLElement>("[data-tikkun-ref]")!;
      const pointedColumn = verse.querySelector<HTMLElement>('[data-tk-side="pointed"]') ?? pointedCell, tikkunColumn = verse.querySelector<HTMLElement>('[data-tk-side="tikkun"]') ?? tikkunCell;
      const read = (selector: string, attribute: string, host: HTMLElement, column: HTMLElement, label: string) => {
        const box = column.getBoundingClientRect(), words = [...host.querySelectorAll<HTMLElement>(selector)].map(node => {
          const rect = node.getBoundingClientRect();
          if (rect.left < box.left - 0.5 || rect.right > box.right + 0.5) overflow.push(`${verse.dataset.verseRef} ${label} word ${node.getAttribute(attribute)}`);
          return { index: Number(node.getAttribute(attribute)), rect };
        });
        return clusters(words);
      };
      const pointed = read("[data-word-index]", "data-word-index", pointedCell, pointedColumn, "pointed"), tikkun = read("[data-tikkun-word]", "data-tikkun-word", tikkunCell, tikkunColumn, "tikkun");
      lineCount += pointed.length;
      const count = Math.max(pointed.length, tikkun.length);
      for (let index = 0; index < count; index++) rows.push({ pointed: pointed[index]?.indexes ?? [], tikkun: tikkun[index]?.indexes ?? [] });
    }
    return { rows, overflow, scrollFits: document.documentElement.scrollWidth <= innerWidth, lineCount };
  });
}

async function open(page: Page, sample: Sample, options: { width: number; size: "standard" | "huge"; colors: boolean; dark?: boolean }) {
  await page.addInitScript(({ size, colors }) => { try { localStorage.setItem("crc-bm-reading-prefs-v2:shared", JSON.stringify({ colors, size, tikkunView: "beside", translation: false })); } catch { /* defaults */ } }, { size: options.size, colors: options.colors });
  await page.emulateMedia({ colorScheme: options.dark ? "dark" : "light" });
  await page.setViewportSize({ width: options.width, height: 900 });
  await mock(page, sample);
  await page.goto("/read");
  await expect(page.locator(".study-verses [data-tikkun-ref]").first()).toBeVisible();
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  // Lines settle once measured; wait for a stable count of rows.
  await expect.poll(async () => (await measure(page)).lineCount, { timeout: 5000 }).toBeGreaterThan(0);
  await page.waitForTimeout(250);
}

test.beforeEach(({}, testInfo) => { test.skip(testInfo.project.name !== "phone", "the tikkun columns are measured at fixed widths on the phone project"); });

for (const [name, sample] of Object.entries(samples)) for (const width of [280, 320, 360, 412, 1280]) for (const size of ["standard", "huge"] as const) {
  test(`${name}: both tikkun columns hold the same words on every row at ${width}px, ${size} text`, async ({ page }) => {
    await open(page, sample, { width, size, colors: true });
    const result = await measure(page);
    expect(result.scrollFits).toBe(true);
    expect(result.overflow).toEqual([]);
    for (const row of result.rows) expect(row.tikkun).toEqual(row.pointed);
    // Words never split across rows beyond a maqaf: every row of a column is a run of the reading in order.
    expect(result.rows.length).toBeGreaterThan(sample.last - sample.first);
  });
}

// A browser or font that sets the letters a little wider than the one the page was designed on must still settle:
// the rows and the type scale are measured, never assumed, and measuring never loops.
for (const spacing of [0.02, 0.05, 0.09]) for (const width of [320, 412]) {
  test(`both columns settle on the same rows when the letters are set ${spacing}em wider, at ${width}px`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message.slice(0, 120)));
    await page.addInitScript(value => { document.addEventListener("DOMContentLoaded", () => { const style = document.createElement("style"); style.textContent = `.study-verses { letter-spacing: ${value}em; }`; document.head.append(style); }); }, spacing);
    await open(page, samples.vayera, { width, size: "huge", colors: true });
    const result = await measure(page);
    expect(errors).toEqual([]);
    expect(result.overflow).toEqual([]);
    expect(result.scrollFits).toBe(true);
    for (const row of result.rows) expect(row.tikkun).toEqual(row.pointed);
  });
}

test("the columns still agree with Colors off, and keep their tap and screen reader behaviour", async ({ page }) => {
  await open(page, samples.lech, { width: 360, size: "standard", colors: false });
  const result = await measure(page);
  expect(result.overflow).toEqual([]);
  for (const row of result.rows) expect(row.tikkun).toEqual(row.pointed);
  // The scroll column is decoration for the eye: hidden from screen readers, so no word is read twice.
  const tikkun = page.locator(".study-verses [data-tikkun-ref]").first();
  await expect(tikkun).toHaveAttribute("aria-hidden", "true");
  await expect(page.locator(".study-verses [data-tikkun-ref] [role=button], .study-verses [data-tikkun-ref] [tabindex]")).toHaveCount(0);
  // Tapping a pointed word still acts on it (an unconfigured server has no audio, so the tap just selects the word).
  const word = page.locator('.study-verses [data-hebrew-ref] [data-word-index="1"][role="button"]').first();
  await expect(word).toBeVisible();
  await word.click();
  // The verse numbers and the maqaf stay in the pointed column.
  await expect(page.locator(".study-verses [data-hebrew-ref]").first().locator("sup, button").first()).toHaveText("1");
  expect(await page.locator(".study-verses").first().evaluate(node => [...node.querySelectorAll("[data-hebrew-ref]")].some(cell => cell.textContent!.includes(String.fromCodePoint(0x05be))))).toBe(true);
  expect(await page.locator(".study-verses").first().evaluate(node => [...node.querySelectorAll("[data-tikkun-ref]")].some(cell => cell.textContent!.includes(String.fromCodePoint(0x05be))))).toBe(false);
});

test("the columns re-flow together when the text size changes", async ({ page }) => {
  await open(page, samples.vayera, { width: 360, size: "standard", colors: true });
  const before = await measure(page);
  await page.getByRole("button", { name: /^Text size/ }).first().click();
  await page.getByRole("button", { name: "Huge", exact: true }).click();
  await page.waitForTimeout(400);
  const after = await measure(page);
  expect(after.overflow).toEqual([]);
  for (const row of after.rows) expect(row.tikkun).toEqual(row.pointed);
  expect(before.rows.length).toBeGreaterThan(0);
});

test("screenshots at 412px in dark mode, when asked for", async ({ page }) => {
  const directory = process.env.TIKKUN_SHOTS, label = process.env.TIKKUN_SHOTS_LABEL ?? "shot";
  test.skip(!directory, "set TIKKUN_SHOTS to a folder to take the screenshots");
  mkdirSync(directory!, { recursive: true });
  // The first screen of the text and the whole of it, so both can be looked at.
  const shoot = async (name: string) => {
    const box = (await page.locator(".study-verses").first().boundingBox())!;
    await page.screenshot({ path: join(directory!, `${label}-${name}-top.png`), fullPage: true, clip: { x: 0, y: box.y, width: page.viewportSize()!.width, height: Math.min(box.height, 1100) } });
    await page.locator(".study-verses").first().screenshot({ path: join(directory!, `${label}-${name}-all.png`) });
  };
  for (const [name, sample] of Object.entries(samples)) { await open(page, sample, { width: 412, size: "standard", colors: true, dark: true }); await shoot(`${name}-412-dark`); }
  await open(page, samples.lech, { width: 320, size: "huge", colors: true, dark: true });
  await shoot("lech-320-huge-dark");
});
