import { expect, test, type Page } from "@playwright/test";
import { expandReadingRanges } from "../src/lib/readings/ranges";
import { TANAKH_VERSE_COUNTS } from "../src/lib/readings/catalog";
import { studyRangePlan } from "../src/components/portal/workspace/study/api";
import { studyEditions } from "../src/components/portal/workspace/study/credits";
import { moreSheet, openMore } from "./more-sheet";

// Release 1.8.2 P2 on the built, unconfigured production server: the signed-out reader's layout. Every reading and text answer is a
// synthetic route fulfilment (invented syllables, numbered English) that arrives after a short delay, as a real network would,
// so the page's own loading states are what is measured.
const word = ["אָבָ֑ג", "דֵּ֖ה", "וְזַ֥ח"];
const verseOf = (ref: string) => { const text = `${word.join(" ")}׃`; return { ref, english: `Synthetic translation ${ref}`, hebrew: { text, readingText: text, paragraphAfter: null, segments: [{ kind: "text", text }] } }; };
function passageOf(ranges: string[], kind: "torah" | "haftarah") {
  const count = expandReadingRanges(ranges, kind, TANAKH_VERSE_COUNTS).length, pages: { offset: number; first: string; last: string }[] = [];
  for (let offset: number | null = 0; offset !== null;) { const plan = studyRangePlan(ranges, kind, offset); pages.push({ offset, first: plan.refs[0], last: plan.refs.at(-1)! }); offset = plan.nextOffset; }
  return { kind, ranges, verseCount: count, pages };
}
// A whole parashah is more than one text page (a page is 100 verses), as a real week is.
const week = { torah: ["Genesis 1:1-6:8"], haftarah: ["Isaiah 42:5-43:10"] };
const LATENCY = 120;
// The week's calendar divisions, for the pages that show the chips (the Torah's aliyot, 1.9 N3): inside the synthetic week, with the maftir repeating the seventh.
const ALIYOT = [["1", "Genesis 1:1-2:3"], ["2", "Genesis 2:4-19"], ["3", "Genesis 2:20-3:21"], ["4", "Genesis 3:22-4:18"], ["5", "Genesis 4:19-5:24"], ["6", "Genesis 5:25-6:4"], ["7", "Genesis 6:5-8"], ["M", "Genesis 6:5-8"]];
async function mock(page: Page, latency = LATENCY, aliyot = false) {
  await page.route("**/api/public/**", async route => {
    const url = new URL(route.request().url()), q = url.searchParams;
    await new Promise(resolve => setTimeout(resolve, latency));
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) }).catch(() => {});
    if (url.pathname === "/api/public/aliyot") return aliyot ? json({ date: q.get("date"), parashah: "Synthetic", full: ALIYOT.map(([n, ref]) => ({ n, ref })), triennial: null }) : json({ error: "unavailable" }, 503);
    const kind = q.get("kind") as "torah" | "haftarah", ranges = q.has("ref") ? q.get("ref")!.split("; ") : week[kind];
    if (url.pathname === "/api/public/reading") {
      if (q.has("date")) return json({ date: q.get("date"), parashah: "Synthetic", fetchedAt: 0, listening: { pocketTorah: false }, torah: passageOf(week.torah, "torah"), haftarah: passageOf(week.haftarah, "haftarah") });
      return json({ ref: q.get("ref"), kind, passage: passageOf(ranges, kind), listening: { pocketTorah: false } });
    }
    if (url.pathname === "/api/public/text") {
      const offset = Number(q.get("offset")), plan = studyRangePlan(ranges, kind, offset), total = expandReadingRanges(ranges, kind, TANAKH_VERSE_COUNTS).length;
      return json({ kind, ...(q.has("ref") ? { ref: q.get("ref") } : { date: q.get("date") }), offset, nextOffset: plan.nextOffset, totalVerses: total, translation: { key: "jps2023", status: "available" },
        verses: plan.refs.map(verseOf), chapters: plan.chapters.map(chapter => ({ ref: chapter.ref, sefariaUrl: chapter.url, fetchedAt: 0, hash: "c".repeat(64), editions: [studyEditions.mam, studyEditions.jps2023] })) });
    }
    return json({ error: "unavailable" }, 503);
  });
}

type Shift = { value: number; time: number; nodes: string[] };
/** Records every layout shift not caused by a recent input, from before the page's own scripts run. */
async function watchShifts(page: Page) {
  await page.addInitScript(() => {
    const seen: { value: number; time: number; nodes: string[] }[] = [];
    (window as unknown as { __shifts: typeof seen }).__shifts = seen;
    const name = (node: Element | null) => node ? `${node.tagName.toLowerCase()}.${String(node.getAttribute("class") ?? "").split(" ")[0]}` : "gone";
    try {
      new PerformanceObserver(list => {
        for (const entry of list.getEntries() as unknown as { value: number; startTime: number; hadRecentInput: boolean; sources: { node: Element | null }[] }[])
          if (!entry.hadRecentInput) seen.push({ value: entry.value, time: entry.startTime, nodes: entry.sources.map(source => name(source.node)) });
      }).observe({ type: "layout-shift", buffered: true });
    } catch { /* No layout-shift entries here. */ }
  });
}
/** Core Web Vitals' CLS: the worst window of shifts, each within 1 s of the last and the window within 5 s. */
function cls(shifts: readonly Shift[]): number {
  let worst = 0, total = 0, start = -Infinity, last = -Infinity;
  for (const shift of shifts) {
    if (shift.time - last > 1000 || shift.time - start > 5000) { total = 0; start = shift.time; }
    total += shift.value; last = shift.time; worst = Math.max(worst, total);
  }
  return worst;
}
async function measure(page: Page, address: string, aliyot = false) {
  test.setTimeout(90_000); // Four times slower CPU, on a busy machine.
  const client = await page.context().newCDPSession(page);
  await client.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await watchShifts(page);
  await mock(page, LATENCY, aliyot);
  await page.goto(address);
  await expect(page.locator(".study-verses [data-verse-ref]").first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Save this reading", exact: true })).toBeAttached({ timeout: 30_000 });
  await page.waitForTimeout(2000);
  const shifts = await page.evaluate(() => (window as unknown as { __shifts: Shift[] }).__shifts);
  await client.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  return { shifts, value: cls(shifts) };
}

test("/ (the home) does not jump while the week and the calendar arrive (CLS at most 0.07 at 4x CPU)", async ({ page }) => {
  test.setTimeout(90_000);
  const client = await page.context().newCDPSession(page);
  await client.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await watchShifts(page);
  await mock(page);
  await page.route("**/api/session", route => route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: "unauthenticated" }) }));
  await page.route("**/api/public/calendar", async route => {
    await new Promise(resolve => setTimeout(resolve, LATENCY));
    const rows = Array.from({ length: 66 }, (_, i) => ({ date: new Date(Date.UTC(2026, 9, 24 + 7 * i)).toISOString().slice(0, 10), name: "Synthetic", kind: "regular" }));
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ today: rows[0].date, rows }) }).catch(() => {});
  });
  await page.goto("/");
  await expect(page.locator("[data-chip-date]").first()).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(2000);
  const shifts = await page.evaluate(() => (window as unknown as { __shifts: Shift[] }).__shifts);
  await client.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  expect(cls(shifts), JSON.stringify(shifts)).toBeLessThanOrEqual(0.07);
});

test("/read in Lein does not jump while the week, the reading and the text arrive (CLS below 0.1 at 4x CPU)", async ({ page }) => {
  const { shifts, value } = await measure(page, "/read");
  expect(value, JSON.stringify(shifts)).toBeLessThan(0.1);
});

test("/read in Study does not jump while the week, the reading and the text arrive (CLS below 0.1 at 4x CPU)", async ({ page }) => {
  const { shifts, value } = await measure(page, "/read?lens=study");
  expect(value, JSON.stringify(shifts)).toBeLessThan(0.1);
});

// With the week's aliyot (the chips) the header, the lenses, the chips and the text come in two steps, and none of them moves what is on screen.
for (const [name, address] of [["Lein", "/read"], ["Study", "/read?lens=study"]]) {
  test(`/read with the aliyah chips in ${name} does not jump while the week, the aliyot, the reading and the text arrive (CLS below 0.1 at 4x CPU)`, async ({ page }) => {
    const { shifts, value } = await measure(page, address, true);
    await expect(page.getByRole("tablist", { name: "Reading sections" })).toBeVisible();
    console.log(`CLS with chips in ${name}:`, value.toFixed(4));
    expect(value, JSON.stringify(shifts)).toBeLessThan(0.1);
  });
}

test("at a 200% root font on a Pixel 7 the reading, its Find a reading field and the Readings index are no wider than the screen", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "phone", "A phone-width check");
  await mock(page);
  await page.goto("/read");
  await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
  await expect(page.locator(".study-verses [data-verse-ref]").first()).toBeVisible();
  // The screen is the configured device width: on a phone the browser widens its own layout viewport to fit overflowing content, so innerWidth would agree with the overflow.
  const screen = testInfo.project.use.viewport!.width, fits = () => page.evaluate(() => ({ scroll: document.documentElement.scrollWidth })).then(size => ({ ...size, view: screen }));
  let size = await fits(); expect(size.scroll, "the header and Lein").toBeLessThanOrEqual(size.view);
  for (const name of ["Change", "Previous week", "Next week"]) {
    const control = await page.getByRole("button", { name, exact: true }).boundingBox();
    expect(control && control.x >= 0 && control.x + control.width <= size.view, `${name} is inside the screen`).toBe(true);
  }
  await page.getByRole("button", { name: "Study", exact: true }).click();
  await expect(page.locator("[data-study-rows]")).toBeVisible();
  size = await fits(); expect(size.scroll, "Study").toBeLessThanOrEqual(size.view);
  // Find a reading and the way to the index are in the Change sheet.
  const sheet = await openMore(page), field = sheet.getByRole("combobox", { name: "Find a reading", exact: true });
  await expect(field).toBeVisible();
  const box = await field.boundingBox();
  expect(box && box.x >= 0 && box.x + box.width <= (await fits()).view, "the Find a reading field is inside the screen").toBe(true);
  await sheet.getByRole("link", { name: "Every parashah, holiday and passage", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Readings", exact: true })).toBeVisible();
  await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
  size = await fits(); expect(size.scroll, "the Readings index").toBeLessThanOrEqual(size.view);
});

const active = (page: Page) => page.evaluate(() => {
  const node = document.activeElement as HTMLElement | null;
  return { tag: node?.tagName ?? null, id: node?.id ?? null, reading: Boolean(node?.closest(".study-verses")), verse: node?.closest("[data-verse-ref]")?.getAttribute("data-verse-ref") ?? null };
});

test("Start reading moves focus into the reading, in Lein and in Study", async ({ page }) => {
  await mock(page);
  await page.goto("/read");
  // Start reading is first in the More sheet; it closes the sheet and then puts focus in the reading, so the sheet's own return of focus does not win.
  await openMore(page);
  const start = page.getByRole("button", { name: "Start reading", exact: true });
  await expect(start).toBeEnabled();
  await start.click();
  await expect(moreSheet(page)).toBeHidden();
  await expect.poll(() => active(page).then(state => state.reading)).toBe(true);
  expect(await page.evaluate(() => document.activeElement?.getAttribute("aria-label"))).toBe("Hebrew reading");
  await page.getByRole("button", { name: "Study", exact: true }).click();
  await expect(page.locator("[data-study-rows]")).toBeVisible();
  await openMore(page);
  await page.getByRole("button", { name: "Start reading", exact: true }).click();
  await expect.poll(() => active(page).then(state => state.reading)).toBe(true);
  expect(await page.evaluate(() => document.activeElement?.getAttribute("aria-label"))).toBe("Hebrew reading, verse by verse");
});

test("the next text page puts focus at the start of the new text, and Previous returns to the start of the first", async ({ page }) => {
  await mock(page);
  await page.goto("/read");
  await expect(page.getByText("Verses 1–100 of 146")).toBeVisible();
  await page.getByRole("button", { name: "Next text page", exact: true }).click();
  await expect(page.getByText("Verses 101–146 of 146")).toBeVisible();
  await expect.poll(() => active(page).then(state => state.reading)).toBe(true);
  await expect(page.locator(".study-verses [data-verse-ref]").first()).toBeInViewport();
  await page.getByRole("button", { name: "Previous text page", exact: true }).click();
  await expect(page.getByText("Verses 1–100 of 146")).toBeVisible();
  await expect.poll(() => active(page).then(state => state.reading)).toBe(true);
});

test("choosing a reading from the Readings index lands focus on the new reading's heading", async ({ page }) => {
  // Slow answers: this week is still loading when the reading is chosen, and the page being left must not spend the focus the next page is owed.
  await mock(page, 600);
  // The next page is slow to arrive, so this one is still running when its week answers.
  await page.route("**/read?reading=*", async route => { await new Promise(resolve => setTimeout(resolve, 1500)); await route.continue(); });
  await page.goto("/readings");
  await page.locator("summary", { hasText: "Genesis" }).click();
  await page.getByRole("link", { name: "Noach", exact: true }).click();
  await expect(page).toHaveURL(/\/read\?reading=noach/);
  await expect(page.getByRole("heading", { level: 1, name: "Noach", exact: true })).toBeVisible();
  await expect.poll(() => active(page).then(state => state.id)).toBe("public-reading-title");
  // A plain visit starts nowhere in particular: nothing grabs focus.
  await page.goto("/read");
  await openMore(page);
  await expect(page.getByRole("button", { name: "Start reading", exact: true })).toBeEnabled();
  expect((await active(page)).id).not.toBe("public-reading-title");
});

test("the haftarah blessings link says where on page 23 the blessing is", async ({ page }) => {
  await mock(page);
  await page.goto("/read");
  await openMore(page);
  await expect(page.getByRole("link", { name: "Haftarah blessings: siddur page 23, after Mi Shebeirach" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Torah blessings: siddur page 22" })).toBeVisible();
});

test("/sign-in and /trope-chart wear the same blue bar as /read, and the chart's bar offers Sign in when signed out (F-SITE 19)", async ({ page }) => {
  await page.route("**/api/session", route => route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: "unauthorized" }) }));
  for (const address of ["/trope-chart", "/sign-in"]) {
    await page.goto(address);
    const bar = page.locator("header.portal-header.app-bar");
    await expect(bar, address).toHaveCount(1);
    const color = await bar.evaluate(node => getComputedStyle(node).backgroundColor);
    expect(color, address).not.toBe("rgba(0, 0, 0, 0)");
  }
  await page.goto("/trope-chart");
  await expect(page.locator("header.app-bar").getByRole("link", { name: "Sign in", exact: true })).toHaveAttribute("href", "/sign-in");
});
