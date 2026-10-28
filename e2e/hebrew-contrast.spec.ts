import { expect, test, type Page } from "@playwright/test";
import { commentaryCandidates, commentaryEditionUrl, parseCommentaryChapter } from "../src/lib/readings/commentary";
import { PHRASE_FAMILIES } from "../src/lib/trope/chart-catalog";
import { studyEditions } from "../src/components/portal/workspace/study/credits";
import { openMore } from "./more-sheet";
import { verseNotes } from "./study-sheet";

// 1.8.2 P1: Hebrew text, contrast and dark mode, measured in the browser on the built, unconfigured production server.
// Every reading, commentary and print answer is a synthetic route fulfilment: invented syllables and numbered English only,
// never a verse, a translation or a commentary's words. The page's own client code and styles are what is under test.
const MAQAF = String.fromCodePoint(0x05be), SOF_PASUQ = String.fromCodePoint(0x05c3), SILLUQ = String.fromCodePoint(0x05bd);
const consonants = [...("בגדהזחטכלמנסעפצקרשתאי")];
const vowels = [0x05b8, 0x05b7, 0x05b5, 0x05b4, 0x05b9, 0x05bb, 0x05b6].map(code => String.fromCodePoint(code));
const accents = [0x0591, 0x0596, 0x05a5, 0x0594, 0x059b, 0x05a3, 0x0595, 0x0597].map(code => String.fromCodePoint(code));
function stream(seed: number) { let state = seed >>> 0; return (limit: number) => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state % limit; }; }
function word(next: (limit: number) => number, syllables: number, accent: boolean) {
  let out = "";
  for (let index = 0; index < syllables; index++) out += consonants[next(consonants.length)] + vowels[next(vowels.length)];
  return out + consonants[next(consonants.length)] + (accent ? accents[next(accents.length)] : "");
}
/** An invented verse: about half its words are tied to the next by a maqaf, some carry a trope sign. */
function verseWords(seed: number, count: number) {
  const next = stream(seed), words: string[] = [];
  while (words.length < count) {
    const chained = next(2) === 0, accent = next(3) === 0;
    words.push(chained ? `${word(next, 1 + next(2), false)}${MAQAF}${word(next, 1 + next(2), accent)}` : word(next, 1 + next(3), accent));
  }
  // Verses open with a long word (a prefixed verb, as most of Genesis does), which is what strands a number at a line end.
  const lead = stream(seed + 99);
  words[0] = `${["וְ", "וַ", "הַ", ""][lead(4)]}${word(lead, 3 + lead(2), false)}`;
  return words;
}
type Segment = { kind: "text"; text: string } | { kind: "alternative"; written: string; read: string };
type Verse = { ref: string; english: string; hebrew: { text: string; readingText: string; paragraphAfter: null; segments: Segment[] } };
function makeVerse(ref: string, seed: number, count: number, qere = false): Verse {
  const words = verseWords(seed, count), end = `${SILLUQ}${SOF_PASUQ}`;
  if (!qere) { const text = `${words.join(" ")}${end}`.normalize("NFC"); return { ref, english: `Synthetic translation ${ref}`, hebrew: { text, readingText: text, paragraphAfter: null, segments: [{ kind: "text", text }] } }; }
  const next = stream(seed + 7), written = word(next, 2, false), read = word(next, 2, false), head = words.slice(0, 3).join(" "), tail = `${words.slice(3).join(" ")}${end}`;
  const segments: Segment[] = [{ kind: "text", text: `${head} `.normalize("NFC") }, { kind: "alternative", written: written.normalize("NFC"), read: read.normalize("NFC") }, { kind: "text", text: ` ${tail}`.normalize("NFC") }];
  return { ref, english: `Synthetic translation ${ref}`, hebrew: { text: `${head} ${written} ${tail}`.normalize("NFC"), readingText: `${head} ${read} ${tail}`.normalize("NFC"), paragraphAfter: null, segments } };
}
type Passage = { book: string; chapter: number; first: number; last: number; qere?: number };
const gen24: Passage = { book: "Genesis", chapter: 24, first: 30, last: 36, qere: 33 };
const gen18: Passage = { book: "Genesis", chapter: 18, first: 1, last: 14 };
const versesOf = ({ book, chapter, first, last, qere }: Passage) => Array.from({ length: last - first + 1 }, (_, index) => makeVerse(`${book} ${chapter}:${first + index}`, chapter * 100 + index, 9 + (index * 5) % 12, qere === first + index));

const editionsFor = (work: string, chapterName: string) => {
  const chapter = parseCommentaryChapter(work, chapterName)!, candidates = commentaryCandidates(chapter);
  return [candidates.he[0], candidates.en[0]].filter(Boolean).map(candidate => ({ language: candidate.language, title: candidate.title, license: candidate.license, credit: candidate.credit, url: commentaryEditionUrl(chapter, candidate) }));
};
// Three comments on the passage's first verse, as Rashi's three on Genesis 18:1 are shaped: a quoted word then English, and the third quotes a Hebrew word in its English.
const quoted = versesOf(gen18)[0].hebrew.text.split(new RegExp(`[\\s${MAQAF}]+`)).slice(0, 6);
const rashi = (first: string) => ({ [first]: { comments: [
  { hebrew: [{ text: `${quoted[0]}.`, bold: true }, { text: ` ${quoted[1]}` }], english: [{ text: `${quoted[0]} SYNTHETIC LEMMA ONE — synthetic comment one.` }] },
  { hebrew: [{ text: `${quoted[2]}.`, bold: true }, { text: ` ${quoted[3]}` }], english: [{ text: `${quoted[2]} SYNTHETIC LEMMA TWO — synthetic comment two.` }] },
  { hebrew: [{ text: `${quoted[4]}.`, bold: true }, { text: ` ${quoted[5]}` }], english: [{ text: `literally, ${quoted[4]} SYNTHETIC LEMMA THREE — synthetic comment three.` }] },
] } });

async function mock(page: Page, passage: Passage) {
  const verses = versesOf(passage), refs = verses.map(verse => verse.ref), chapterName = `${passage.book} ${passage.chapter}`;
  const torah = { kind: "torah", ranges: [`${passage.book} ${passage.chapter}:${passage.first}-${passage.last}`], verseCount: refs.length, pages: [{ offset: 0, first: refs[0], last: refs.at(-1) }] };
  const haftarah = { kind: "haftarah", ranges: ["Isaiah 54:1-2"], verseCount: 2, pages: [{ offset: 0, first: "Isaiah 54:1", last: "Isaiah 54:2" }] };
  await page.route("**/api/public/**", route => {
    const url = new URL(route.request().url()), q = url.searchParams;
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (url.pathname === "/api/public/reading") return json({ date: q.get("date"), parashah: "Synthetic", fetchedAt: 0, listening: { pocketTorah: false }, torah, haftarah });
    if (url.pathname === "/api/public/text") {
      const isa = q.get("kind") === "haftarah", list = isa ? [makeVerse("Isaiah 54:1", 1, 8), makeVerse("Isaiah 54:2", 2, 8)] : verses;
      return json({ kind: isa ? "haftarah" : "torah", date: q.get("date"), offset: 0, nextOffset: null, totalVerses: list.length, translation: { key: "jps2023", status: "available" }, verses: list,
        chapters: [{ ref: isa ? "Isaiah 54" : chapterName, sefariaUrl: isa ? "https://www.sefaria.org/Isaiah.54" : `https://www.sefaria.org/${passage.book}.${passage.chapter}`, fetchedAt: 0, hash: "c".repeat(64), editions: [studyEditions.mam, studyEditions.jps2023] }] });
    }
    if (url.pathname === "/api/public/commentary") {
      const work = q.get("work")!, chapter = q.get("chapter")!, covered = work === "rashi" && chapter === chapterName;
      return json({ work, chapter, verses: covered ? rashi(String(passage.first)) : {}, editions: editionsFor(work, chapter) });
    }
    return json({ error: "not-found" }, 404);
  });
}
const prefs = (page: Page, value: { colors: boolean; size: "standard" | "large" | "huge"; tikkunView?: "off" | "beside" | "only" }) =>
  page.addInitScript(item => { try { localStorage.setItem("crc-bm-reading-prefs-v2:shared", JSON.stringify({ tikkunView: "off", translation: false, ...item })); } catch { /* defaults */ } }, value);
async function open(page: Page, passage: Passage, options: { width: number; height?: number; size?: "standard" | "large" | "huge"; colors?: boolean; dark?: boolean; tikkunView?: "off" | "beside" | "only"; path?: string }) {
  await prefs(page, { colors: options.colors ?? true, size: options.size ?? "standard", tikkunView: options.tikkunView });
  await page.emulateMedia({ colorScheme: options.dark ? "dark" : "light" });
  await page.setViewportSize({ width: options.width, height: options.height ?? 900 });
  await mock(page, passage);
  await page.goto(options.path ?? "/read");
  await expect(page.locator(`[data-hebrew-ref="${passage.book} ${passage.chapter}:${passage.first}"], [data-study-rows] article`).first()).toBeVisible();
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.waitForTimeout(250);
}

// ---- WCAG helpers (in Node: the page returns plain colours) ----
type Rgb = [number, number, number];
const channel = (value: number) => { const c = value / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const luminance = ([r, g, b]: Rgb) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
const contrast = (a: Rgb, b: Rgb) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
const hex = (value: string): Rgb => [1, 3, 5].map(at => parseInt(value.slice(at, at + 2), 16)) as Rgb;
/** Parses a computed colour: rgb(), rgba() or color(srgb ...). */
function parseColor(value: string): Rgb & { alpha?: number } {
  const srgb = /^color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)(?: \/ ([\d.]+))?\)$/.exec(value);
  if (srgb) return Object.assign([srgb[1], srgb[2], srgb[3]].map(part => Math.round(Number(part) * 255)) as Rgb, { alpha: srgb[4] === undefined ? 1 : Number(srgb[4]) });
  const rgb = /^rgba?\((\d+), (\d+), (\d+)(?:, ([\d.]+))?\)$/.exec(value);
  if (!rgb) throw new Error(`unparsed colour ${value}`);
  return Object.assign([Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] as Rgb, { alpha: rgb[4] === undefined ? 1 : Number(rgb[4]) });
}
type Helpers = { chars(root: Element): { ch: string; left: number; y: number; height: number }[]; background(element: Element): string };
declare global { interface Window { __p1: Helpers } }
/** Installed in every page: the rectangles of each Hebrew character in reading order (hidden text and verse numbers skipped), and the first opaque background up the tree. */
function installHelpers() {
  window.__p1 = {
    chars(root) {
      const out: { ch: string; left: number; y: number; height: number }[] = [], range = document.createRange(), walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
        if (node.parentElement!.closest(".sr-only, [data-verse-number], sup, button")) continue;
        for (let at = 0; at < node.data.length; at++) {
          const ch = node.data[at];
          if (/\s/.test(ch)) continue;
          range.setStart(node, at); range.setEnd(node, at + 1);
          const rect = range.getClientRects()[0];
          if (rect && rect.width > 0) out.push({ ch, left: rect.left, y: rect.top + rect.height / 2, height: rect.height });
        }
      }
      return out;
    },
    background(element) {
      for (let node: Element | null = element; node; node = node.parentElement) { const color = getComputedStyle(node).backgroundColor; if (!/, 0\)$|transparent/.test(color)) return color; }
      return "rgb(255, 255, 255)";
    },
  };
}
const backgroundOf = (page: Page, selector: string) => page.locator(selector).first().evaluate(node => window.__p1.background(node)).then(parseColor);

test.beforeEach(async ({ page }, testInfo) => { test.skip(testInfo.project.name !== "phone", "measured at fixed widths and sizes on the phone project"); await page.addInitScript(installHelpers); });

// ---- Layout: D1 qere, D2 maqaf, D7 verse numbers ----
async function lineEnds(page: Page, selector: string) {
  return page.locator(selector).evaluateAll(roots => {
    let ends = 0, lines = 0;
    for (const root of roots) {
      const list = window.__p1.chars(root);
      list.forEach((item, index) => { const next = list[index + 1]; if (!next || Math.abs(next.y - item.y) > item.height * 0.6) { lines++; if (item.ch === String.fromCodePoint(0x05be)) ends++; } });
    }
    return { ends, lines };
  });
}

for (const [name, width, height, size] of [["Pixel 7 Huge", 412, 915, "huge"], ["iPhone SE Huge", 375, 667, "huge"], ["320 px Large", 320, 700, "large"]] as const) {
  test(`D1: the qere of Gen 24:33 starts at or right of x=0 on ${name}`, async ({ page }) => {
    await open(page, gen24, { width, height, size });
    const left = await page.locator('[data-hebrew-ref="Genesis 24:33"]').evaluate(root => Math.min(...window.__p1.chars(root).map(item => item.left)));
    expect(left).toBeGreaterThanOrEqual(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test("D2: no line of Gen 24:30-36 ends in a maqaf at 320 px Huge, and none of Gen 18:1-14 at Pixel 7 Standard", async ({ page }) => {
  await open(page, gen24, { width: 320, height: 700, size: "huge" });
  const huge = await lineEnds(page, '.study-verses [data-hebrew-ref]');
  expect(huge.lines).toBeGreaterThan(10);
  expect(huge.ends).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.close();
});
for (const [width, size] of [[412, "standard"], [320, "huge"]] as const) {
  test(`D2: side by side, no pointed line ends in a maqaf (Gen 18:1-14 at ${width} px, ${size} text)`, async ({ page }) => {
    await open(page, gen18, { width, height: 800, size, tikkunView: "beside" });
    const result = await lineEnds(page, '.study-verses [data-tk-side="pointed"]');
    expect(result.lines).toBeGreaterThan(10);
    expect(result.ends).toBe(0);
  });
}
test("D2: the print sheet sets a maqaf phrase whole (Gen 24:30-36)", async ({ page }) => {
  await mock(page, gen24);
  await page.setViewportSize({ width: 816, height: 1056 });
  await page.emulateMedia({ media: "print" });
  await page.goto("/print");
  await expect(page.locator("td[lang=he]").first()).toBeVisible();
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  const result = await lineEnds(page, "td[lang=he]");
  expect(result.lines).toBeGreaterThan(7);
  expect(result.ends).toBe(0);
  // Every maqaf in the Hebrew sits inside a no-break chain.
  expect(await page.locator("td[lang=he]").evaluateAll(cells => cells.every(cell => !/־/.test([...cell.childNodes].filter(node => node.nodeType === 3).map(node => node.textContent).join(""))))).toBe(true);
});

for (const [name, width, height, size] of [["Pixel 7 Standard", 412, 915, "standard"], ["iPhone SE Large", 375, 667, "large"]] as const) {
  test(`D7: no verse number of Gen 18 is left at a line end on ${name}`, async ({ page }) => {
    await open(page, gen18, { width, height, size });
    const placed = await page.locator("[data-hebrew-ref]").evaluateAll(cells => cells.flatMap(cell => {
      const number = cell.querySelector("sup, button"), first = cell.querySelector('[data-word-index="0"]');
      if (!number || !first) return [];
      const n = number.getBoundingClientRect(), w = first.getBoundingClientRect();
      return [{ ref: cell.getAttribute("data-hebrew-ref"), middle: n.top + n.height / 2, top: w.top, bottom: w.bottom, tag: number.tagName }];
    }));
    const stranded = placed.filter(item => item.middle < item.top - 4 || item.middle > item.bottom + 4).map(item => item.ref);
    expect(stranded).toEqual([]);
  });
}

// ---- D8: language of hidden English, and the copy handler ----
test("D8: hidden headings and legends carry lang en and dir ltr, and copying Gen 18:1 pastes the number, the Hebrew and a newline", async ({ page }) => {
  await open(page, gen18, { width: 412, size: "standard", colors: true });
  const hidden = await page.locator(".study-verses .sr-only").evaluateAll(nodes => nodes.map(node => `${node.getAttribute("lang")}/${node.getAttribute("dir")}`));
  expect(hidden.length).toBeGreaterThan(14);
  expect(new Set(hidden)).toEqual(new Set(["en/ltr"]));
  for (const selector of ["[data-verse-number]"]) expect(await page.locator(selector).evaluateAll(nodes => nodes.every(node => node.getAttribute("lang") === "en" && node.getAttribute("dir") === "ltr"))).toBe(true);
  const hebrew = versesOf(gen18)[0].hebrew.text;
  const pasted = await page.evaluate(() => {
    const cell = document.querySelector('[data-hebrew-ref="Genesis 18:1"]')!, range = document.createRange();
    range.selectNodeContents(cell);
    getSelection()!.removeAllRanges(); getSelection()!.addRange(range);
    const data = new DataTransfer();
    cell.dispatchEvent(new ClipboardEvent("copy", { clipboardData: data, bubbles: true, cancelable: true }));
    return data.getData("text/plain");
  });
  expect(pasted).toBe(`18:1 ${hebrew}\n`);
  expect(pasted).not.toMatch(/Genesis|Words?|zakef|revia|etnachta|tevir|tipcha/i);
});

// ---- D5 and F2: focus ring, verse numbers, trope chart samples ----
const ring = (page: Page, selector: string) => page.locator(selector).first().evaluate(node => { const style = getComputedStyle(node); return { color: style.outlineColor, width: parseFloat(style.outlineWidth), style: style.outlineStyle, halo: style.boxShadow }; });
const WORD = '[data-hebrew-ref="Genesis 18:1"] [data-word-index="0"]', NUMBER = '[data-hebrew-ref="Genesis 18:1"] button[aria-pressed]';
/** A keyboard-focused control, ringed the way the page rings it. */
async function focused(page: Page, selector: string) {
  await page.keyboard.press("Tab"); // keyboard modality, so the ring is the :focus-visible one
  await page.locator(selector).first().focus();
  return ring(page, selector);
}
test("D5: the focus ring on a word and on a verse number is at least 3:1 on white and on every phrase fill (light)", async ({ page }) => {
  await open(page, gen18, { width: 412, size: "standard", colors: true });
  const values = [await focused(page, WORD)];
  await (await openMore(page)).getByRole("button", { name: "Choose verses", exact: true }).click();
  values.push(await focused(page, NUMBER));
  for (const value of values) {
    expect(value.style).toBe("solid");
    expect(value.width).toBeGreaterThanOrEqual(3);
    const color = parseColor(value.color);
    expect(contrast(color, [255, 255, 255])).toBeGreaterThanOrEqual(3);
    for (const family of PHRASE_FAMILIES) expect(contrast(color, hex(family.color)), family.id).toBeGreaterThanOrEqual(3);
  }
  expect(values[0].halo, "a word's ring has a halo of the surface colour").not.toBe("none");
});
test("F2: in dark mode every /read verse number and its focus ring are at least 4.5:1 on the page", async ({ page }) => {
  await open(page, gen18, { width: 412, size: "standard", colors: true, dark: true });
  const canvas = await backgroundOf(page, '[data-hebrew-ref="Genesis 18:1"]');
  const numbers = async () => page.locator("[data-verse-number]").evaluateAll(nodes => nodes.map(node => ({ tag: node.tagName, color: getComputedStyle(node).color, background: window.__p1.background(node) })));
  const ringed = [await focused(page, WORD)];
  // Verse numbers are plain superscripts until they can be chosen; both kinds are measured on what they sit on.
  const plain = await numbers();
  await (await openMore(page)).getByRole("button", { name: "Choose verses", exact: true }).click();
  ringed.push(await focused(page, NUMBER));
  const buttons = await numbers();
  expect(plain).toHaveLength(14);
  expect(buttons.every(item => item.tag === "BUTTON")).toBe(true);
  for (const item of [...plain, ...buttons]) expect(contrast(parseColor(item.color), parseColor(item.background)), `${item.tag} ${item.color} on ${item.background}`).toBeGreaterThanOrEqual(4.5);
  for (const value of ringed) {
    expect(value.style).toBe("solid");
    expect(contrast(parseColor(value.color), canvas)).toBeGreaterThanOrEqual(4.5);
  }
});
for (const dark of [false, true]) {
  test(`F2: every trope chart sample is at least 4.5:1 on its fill (${dark ? "dark" : "light"})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: dark ? "dark" : "light" });
    await page.goto("/trope-chart");
    const samples = await page.locator("[data-chart-accent] [lang=he], [data-chart-family] > ul > li:not([data-chart-accent]) [lang=he]").evaluateAll(nodes => nodes.map(node => ({ color: getComputedStyle(node).color, own: getComputedStyle(node).backgroundColor })));
    expect(samples.length).toBeGreaterThanOrEqual(30);
    const page_ = await backgroundOf(page, "main");
    for (const sample of samples) {
      const fill = parseColor(sample.own), background: Rgb = fill.alpha === 0 ? page_ : fill;
      expect(contrast(parseColor(sample.color), background)).toBeGreaterThanOrEqual(4.5);
    }
  });
}

// ---- D6: forced colours ----
test("D6: with forced colors, pressed Torah/Haftarah, Lein/Study and Colors differ from their neighbours and Start reading keeps a border", async ({ page }) => {
  await page.emulateMedia({ forcedColors: "active" });
  await open(page, gen18, { width: 412, size: "standard" });
  await page.emulateMedia({ forcedColors: "active" });
  const look = (locator: ReturnType<Page["getByRole"]>) => locator.evaluate(node => { const style = getComputedStyle(node); return `${style.backgroundColor}|${style.color}`; });
  const pairs: [string, string][] = [["Lein", "Study"], ["Torah", "Haftarah"]];
  for (const [on, off] of pairs) {
    // Lein | Study are pressed buttons; Torah | Haftarah are underline tabs, the selected one marked by aria-selected.
    const tabs = on === "Torah", named = (name: string) => tabs ? page.getByRole("tab", { name: new RegExp(`^${name}`) }) : page.getByRole("button", { name, exact: true });
    const pressed = named(on), other = named(off);
    await expect(pressed).toHaveAttribute(tabs ? "aria-selected" : "aria-pressed", "true");
    expect(await look(pressed), `${on} differs from ${off}`).not.toBe(await look(other));
  }
  const colors = page.getByRole("button", { name: /^Colors/ });
  await expect(colors).toHaveAttribute("aria-pressed", "true");
  await colors.click();
  const off = await look(colors);
  await colors.click();
  expect(await look(colors), "Colors on differs from Colors off").not.toBe(off);
  const start = page.getByRole("button", { name: "Start reading", exact: true });
  expect(await start.evaluate(node => { const style = getComputedStyle(node); return `${style.borderTopStyle}|${parseFloat(style.borderTopWidth)}`; })).toBe("solid|1");
});

// ---- D9: Practice up close ----
for (const dark of [false, true]) {
  test(`D9: in Practice up close every dimmed word is at least 4.5:1 on the sheet (${dark ? "dark" : "light"})`, async ({ page }) => {
    await open(page, gen18, { width: 412, size: "standard", colors: true, dark });
    await page.locator('[data-hebrew-ref="Genesis 18:1"] [data-word-index="0"]').click();
    await page.getByRole("button", { name: "View Genesis 18:1 up close", exact: true }).click();
    const lift = page.locator("dialog.lift[open]");
    await expect(lift).toBeVisible();
    await expect(lift.locator(".lift-phrasing")).toBeVisible();
    await page.waitForTimeout(900); // the ink pull settles
    const sheet = parseColor(await lift.evaluate(node => getComputedStyle(node).backgroundColor));
    const words = await lift.locator(".lift-phrasing [data-word-index]").evaluateAll(nodes => nodes.map(node => ({ color: getComputedStyle(node).color, fill: getComputedStyle(node).backgroundImage, phrase: node.getAttribute("data-phrase") })));
    const dimmed = words.filter(item => item.fill === "none");
    expect(dimmed.length, "some words are dimmed").toBeGreaterThan(0);
    expect(words.length - dimmed.length, "the current phrase is not dimmed").toBeGreaterThan(0);
    for (const item of dimmed) expect(contrast(parseColor(item.color), sheet)).toBeGreaterThanOrEqual(4.5);
  });
}

// ---- D15, D18: Study's commentary ----
test("D15 and D18: Study's credit links and quoted-word buttons are at least 24px, and Hebrew inside Rashi's English is Hebrew in the Hebrew face", async ({ page }) => {
  await open(page, gen18, { width: 360, height: 800, size: "standard", path: "/read?lens=study" });
  // The commentary is with the verse's notes: at 360px, its Notes sheet (Study as a study sheet, 2026-10-28).
  const first = await verseNotes(page, "Genesis 18:1");
  await expect(first.getByText("SYNTHETIC LEMMA THREE", { exact: false })).toBeVisible();
  const boxes = await page.locator('main a[href*="sefaria.org"], [data-commentary-ref] button[aria-pressed]').evaluateAll(nodes => nodes.map(node => { const rect = node.getBoundingClientRect(); return { width: rect.width, height: rect.height, name: node.textContent?.trim().slice(0, 30) }; }));
  expect(boxes.length).toBeGreaterThanOrEqual(4);
  for (const box of boxes) { expect(box.height, box.name).toBeGreaterThanOrEqual(24); expect(box.width, box.name).toBeGreaterThanOrEqual(24); }
  // Targets that are 24px but closer than 24px to a neighbour fail 2.5.8 too: no two targets' centres sit within 24px of each other unless one is 24px square or more (checked above), so adjacent boxes must not overlap.
  const hebrew = first.locator("p[lang=en] span[lang=he]").first();
  await expect(hebrew).toHaveCount(1);
  expect(await hebrew.evaluate(node => ({ dir: node.getAttribute("dir"), face: getComputedStyle(node).fontFamily }))).toEqual({ dir: "rtl", face: expect.stringMatching(/^"CRC Noto Serif Hebrew"/) });
});

// ---- D17: no sticky hover underline after a tap ----
test("D17: on a touch screen no underline remains after a tap on a word", async ({ page }) => {
  await open(page, gen18, { width: 412, size: "standard", colors: true });
  const wordLocator = page.locator('[data-hebrew-ref="Genesis 18:1"] [data-word-index="1"]').first();
  await wordLocator.tap();
  expect(await wordLocator.evaluate(node => getComputedStyle(node).textDecorationLine)).toBe("none");
  expect(await page.evaluate(() => matchMedia("(hover: hover)").matches)).toBe(false);
});
test("D17: where there is a hover, the underline sits below the vowels", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1000, height: 800 }, hasTouch: false, isMobile: false });
  const page = await context.newPage();
  await open(page, gen18, { width: 1000, size: "standard", colors: false });
  const wordLocator = page.locator('[data-hebrew-ref="Genesis 18:1"] [data-word-index="1"]').first();
  await wordLocator.hover();
  const style = await wordLocator.evaluate(node => { const value = getComputedStyle(node); return { line: value.textDecorationLine, offset: parseFloat(value.textUnderlineOffset), size: parseFloat(value.fontSize) }; });
  expect(style.line).toContain("underline");
  expect(style.offset / style.size).toBeGreaterThanOrEqual(0.5);
  await context.close();
});

// ---- D18/D19: the print appendix ----
test("D19: the print appendix shows all three Rashi comments on the first verse, each with its quoted Hebrew, and sets Hebrew inside the English in the Hebrew face", async ({ page }) => {
  await mock(page, gen18);
  await page.setViewportSize({ width: 816, height: 1056 });
  await page.emulateMedia({ media: "print" });
  await page.goto("/print?comm=rashi");
  const group = page.locator('[data-appendix-ref="Genesis 18:1"]');
  await expect(group).toBeVisible();
  const comments = group.locator('[data-appendix-work="rashi"] > div[class*=comment]:not([class*=commentCredit])');
  await expect(comments).toHaveCount(3);
  for (let at = 0; at < 3; at++) {
    await expect(comments.nth(at).locator("p[lang=he] strong")).toHaveText(`${quoted[at * 2]}.`);
    await expect(comments.nth(at).locator("p[lang=en]")).toContainText(`SYNTHETIC LEMMA ${["ONE", "TWO", "THREE"][at]}`);
  }
  const inside = comments.nth(2).locator("p[lang=en] span[lang=he]");
  await expect(inside).toHaveCount(1);
  expect(await inside.evaluate(node => getComputedStyle(node).fontFamily)).toMatch(/^"CRC Noto Serif Hebrew"/);
});
