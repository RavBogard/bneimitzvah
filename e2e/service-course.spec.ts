import { expect, test, type Page } from "@playwright/test";

// The built, unconfigured production server, signed out, at 360 px. The service course (2.0 SC1) is reachable by its URL
// only: nothing in the navigation or the front door links to it yet, and it is noindex like the other learning pages.
// 2.0 SC3 adds Reading Hebrew (f1 to f6), Review and Quick ten, all from this browser's progress and the same synthetic text.
test.use({ viewport: { width: 360, height: 740 } });
const KEY = "crc-torah:service-progress/v1";
const MORNING = ["modeh-ani", "tallit", "mah-tovu", "hineih-mah-tov", "birchot-hashachar", "psukei-dzimrah", "chatzi-kaddish", "barchu", "yotzeir-or", "ahavah-rabbah", "shma", "vahavta", "mi-chamochah",
  "tfilah", "avot-vimahot", "gvurot", "kdushah", "vshamru", "avodah", "hodaah", "sim-shalom", "oseh-shalom", "torah-service", "torah-before", "torah-reading", "torah-after", "mi-shebeirach",
  "haftarah-before", "haftarah-reading", "haftarah-after", "commentary", "eitz-chayim", "aleinu", "mourners-kaddish", "adon-olam", "parents-blessing", "closing-blessing"];
const MOMENTS = new Set(["torah-service", "torah-reading", "haftarah-reading", "commentary", "parents-blessing"]);
const U1 = [["shma", 10], ["vahavta", 11], ["torah-before", 22], ["torah-after", 22], ["haftarah-before", 23], ["haftarah-after", 24]] as const;
// Prayers whose text the course does not show: P'sukei D'zimrah (no public unit) and the mixed Mi Shebeirach (A2 discrepancy 13).
const LINK_ONLY = new Set(["psukei-dzimrah", "mi-shebeirach"]);
/**
 * The unconfigured server has no stored public build, so the text route answers 503 there. Each test serves a synthetic build in its
 * place: invented Hebrew letter strings (never prayer text) with invented transliteration, enough words on every line for any key word.
 */
const ALEF = 0x05d0, NAME = String.fromCharCode(0x05d9, 0x05d9);
const word = (seed: number) => Array.from({ length: 3 }, (_, i) => String.fromCharCode(ALEF + ((seed * 7 + i * 5 + 3) % 22))).join("");
const syntheticLine = (line: number) => ({ he: Array.from({ length: 46 }, (_, w) => word(line * 50 + w)).join(" "), tr: Array.from({ length: 46 }, (_, w) => `syl${line}x${w}`).join(" "), en: `Synthetic English line ${line}.` });
const answer = (unit: string, lines: object[]) => ({ unit, volume: "shabbat-shacharit", credit: { title: "Shirei Tfilah", licence: "CC BY-NC-SA 4.0" }, lines });
const SHMA = [word(1), word(2), NAME, word(4), NAME, word(6)];
const shmaAnswer = (unit: string) => answer(unit, [{ he: SHMA.join(" "), tr: "Sh’ma Yisra’el, Adonai Eloheinu, Adonai echad.", en: "Synthetic first line." }, { he: [word(20), word(21), word(22)].join(" "), en: "Synthetic second line." }]);
/** A short line whose transliteration lines up word for word: what f6 reads. The real volume's first lines are short; the synthetic ones are long so every key word index exists. */
const shortLine = (unit: string) => ({ he: Array.from({ length: 5 }, (_, i) => word(unit.length * 3 + i)).join(" "), tr: Array.from({ length: 5 }, (_, i) => `short${unit.length}x${i}`).join(" "), en: "Synthetic short line." });
async function serveText(page: Page, status = 200, shortFirst = false) {
  const asked: string[] = [];
  await page.route("**/api/public/service-text?**", async route => {
    const unit = new URL(route.request().url()).searchParams.get("unit") ?? "";
    asked.push(new URL(route.request().url()).searchParams.get("build") === "edfef85" ? unit : "wrong-build");
    if (status !== 200) return route.fulfill({ status, contentType: "application/json", headers: { "cache-control": "no-store" }, body: JSON.stringify({ error: "unavailable" }) });
    const body = unit === "shma.the-shma@shabbat-shacharit" ? shmaAnswer(unit) : answer(unit, [...(shortFirst ? [shortLine(unit)] : []), ...Array.from({ length: 10 }, (_, i) => syntheticLine(i))]);
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
  return asked;
}
/** From the Read step to Done: Key words, then every Check item answered with its first choice until the Check ends. */
async function readToDone(page: Page) {
  const main = page.locator("main#lesson-main");
  await page.getByRole("button", { name: "Next" }).click();
  await expect(main.getByRole("heading", { level: 1, name: "Key words" })).toBeVisible();
  await page.getByRole("button", { name: "Next" }).click();
  for (let n = 0; n < 40 && await main.getByRole("heading", { level: 1, name: "Check" }).count(); n++) {
    await main.locator("ul button").first().click();
    await page.getByRole("button", { name: "Next" }).click();
  }
  await expect(main.getByText("Done", { exact: true })).toBeVisible();
}
test.beforeEach(async ({ page }) => { await serveText(page); });
const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
const inViewport = (page: Page, selector: string) => page.locator(selector).evaluate(element => { const box = element.getBoundingClientRect(); return box.top >= 0 && box.bottom <= innerHeight && box.left >= 0 && box.right <= innerWidth; });

test("MORNING is the 37 lessons of the plan", () => { expect(new Set(MORNING).size).toBe(37); });

test("the course home opens at 360 px: the next lesson, the links, every unit, and noindex", async ({ page }) => {
  const response = await page.goto("/learn/service");
  expect(response?.status()).toBe(200);
  expect(response?.headers()["x-robots-tag"]).toBe("noindex, nofollow");
  await expect(page).toHaveTitle("Learn the service | CRC Torah");
  await expect(page.getByRole("heading", { level: 1, name: "Learn the service" })).toBeVisible();
  await expect(page.getByText("Each prayer in the Shabbat morning service: what it is, how to read it, and where it is in the siddur.")).toBeVisible();
  const next = page.locator("[data-next]");
  await expect(next).toHaveAttribute("data-next", "shma");
  await expect(next.getByRole("heading", { level: 2, name: "Sh’ma" })).toBeVisible();
  await expect(next.getByText("about 5 minutes")).toBeVisible();
  await expect(page.getByText("Progress is saved on this device.")).toBeVisible();
  // CRC's Saturday evening and Havdalah are here now (2.0 SC7), so the "come next" line is gone and their two units list below.
  await expect(page.getByText("Saturday evening and Havdalah come next.")).toHaveCount(0);
  for (const title of ["Saturday evening: the Sh’ma and its blessings", "Havdalah"]) await expect(page.getByRole("heading", { level: 2, name: title, exact: true })).toBeVisible();
  const nav = page.getByRole("navigation", { name: "Course" });
  await expect(nav.getByRole("link", { name: "Learn to lein" })).toHaveAttribute("href", "/learn");
  await expect(nav.getByRole("link", { name: "About" })).toHaveAttribute("href", "/learn/service/about");
  for (const title of ["The parts every student leads", "Morning blessings", "The Sh’ma and its blessings", "The Amidah", "The Torah service", "Closing the service"]) await expect(page.getByRole("heading", { level: 2, name: title, exact: true })).toBeVisible();
  // Reading Hebrew sits at the top, optional: its unit, its six lessons and the quiet row that points to it until f1 is done (2.0 SC3).
  await expect(page.getByRole("heading", { level: 2, name: "Reading Hebrew" })).toBeVisible();
  await expect(page.getByRole("link", { name: "New to Hebrew letters? Start with Reading Hebrew." })).toHaveAttribute("href", "/learn/service/f1");
  await expect(page.locator("[data-unit='reading'] li")).toHaveText(["Letters, part one", "Letters, part two", "Vowels", "Dots that change a letter", "Reading words", "Reading lines"]);
  // Nothing is due and nothing is read yet: no Review row, no Quick ten row.
  await expect(page.locator("[data-row='review'], [data-row='quick-ten']")).toHaveCount(0);
  // Every row of every list is a link, never a bare span (DP-09): 37 morning lessons, the 6 of the strand and the 11 of the evening, 54 links.
  await expect(page.locator("ol li")).toHaveCount(54);
  await expect(page.locator("ol li > a[href^='/learn/service/']")).toHaveCount(54);
  expect(await noHorizontalScroll(page)).toBe(true);
});

test("nothing in the site links to the course yet: not the front door, the reading, the course of Learn to lein, or the offline page", async ({ page, request }) => {
  for (const path of ["/", "/read", "/learn", "/learn/about", "/trope-chart", "/offline", "/sign-in"]) {
    const response = await request.get(path);
    if (response.status() !== 200) continue;
    expect(await response.text(), path).not.toContain("/learn/service");
  }
  const sitemap = await request.get("/sitemap.xml"); expect((await sitemap.text()), "sitemap").not.toContain("/learn/service");
  const robots = await request.get("/robots.txt"); expect((await robots.text())).toContain("Disallow: /");
  await page.goto("/learn"); await expect(page.locator("a[href*='learn/service']")).toHaveCount(0);
});

test("every one of the 37 morning lessons opens at 360 px and runs to its Done screen with the siddur link on its own page", async ({ page }) => {
  test.setTimeout(240_000);
  for (const id of MORNING) {
    const response = await page.goto(`/learn/service/${id}`);
    expect(response?.status(), id).toBe(200);
    expect(response?.headers()["x-robots-tag"], id).toBe("noindex, nofollow");
    const main = page.locator("main#lesson-main");
    await expect(main.getByRole("heading", { level: 1, name: "About this prayer" }), id).toBeVisible();
    // The teaching, then the credit: Daniel's name alone.
    expect(await main.locator("[data-approved='2026-10-24'] p").count(), id).toBeGreaterThanOrEqual(2);
    await expect(main.locator("[data-approved] p").last(), id).toHaveText("Rabbi Daniel Bogard");
    if (MOMENTS.has(id)) await expect(main.getByText("This part of the service has no prayer text to read. It is here so you know what happens and when."), id).toBeVisible();
    expect(await noHorizontalScroll(page), `${id} about`).toBe(true);
    expect(await inViewport(page, "button.button-start"), `${id} next at the thumb`).toBe(true);
    const steps = MOMENTS.has(id) ? 3 : LINK_ONLY.has(id) ? 4 : 6;
    await expect(page.getByRole("list", { name: `Step 1 of ${steps}` }), id).toBeAttached();
    await page.getByRole("button", { name: "Next" }).click();
    await expect(main.getByRole("heading", { level: 1, name: "Where it is in the service" }), id).toBeVisible();
    await expect(main.locator("[aria-current='step']"), id).toHaveCount(1);
    await expect(main.getByText(/ (?:comes after .+ and before .+|opens the service|closes the service)\.$/), id).toBeVisible();
    expect(await noHorizontalScroll(page), `${id} where`).toBe(true);
    await page.getByRole("button", { name: "Next" }).click();
    if (LINK_ONLY.has(id)) {
      await expect(main.getByRole("heading", { level: 1, name: "Read it" }), id).toBeVisible();
      await expect(main.getByText("This prayer’s text is in the siddur."), id).toBeVisible();
      expect(await noHorizontalScroll(page), `${id} read`).toBe(true);
      await page.getByRole("button", { name: "Next" }).click();
    } else if (!MOMENTS.has(id)) {
      await expect(main.getByRole("heading", { level: 1, name: "Read it" }), id).toBeVisible();
      await expect(main.locator("ol li p[lang='he']").first(), id).toBeVisible();
      await expect(main.getByText("Text: Shirei Tfilah, CC BY-NC-SA 4.0."), id).toBeVisible();
      expect(await noHorizontalScroll(page), `${id} read`).toBe(true);
      await readToDone(page);
    }
    await expect(main.getByText("Done", { exact: true }), id).toBeVisible();
    await expect(main.locator("[data-siddur-page] a"), id).toHaveCount(1);
    expect(await noHorizontalScroll(page), `${id} done`).toBe(true);
  }
});

test("a moment lesson is marked done: Done opens it, the home shows it done, and a reload keeps it", async ({ page }) => {
  await page.goto("/learn/service/torah-reading");
  const main = page.locator("main#lesson-main");
  await expect(main.getByText("This part of the service has no prayer text to read.")).toBeVisible();
  await page.getByRole("button", { name: "Next" }).click();
  await expect(main.getByRole("heading", { name: "Where it is in the service" })).toBeVisible();
  expect(await page.evaluate(key => localStorage.getItem(key), KEY)).toBeNull();
  await page.getByRole("button", { name: "Next" }).click();
  await expect(main.getByText("You can say what happens at this point in the service.")).toBeVisible();
  const stored = JSON.parse((await page.evaluate(key => localStorage.getItem(key), KEY)) as string);
  expect(stored.schema).toBe("service-course-progress/v1"); expect(Object.keys(stored.lessons)).toEqual(["torah-reading"]); expect(stored.cards).toEqual({});
  // The next lesson is the one after it, not the first of the six.
  await expect(main.getByText("Next: Mi Shebeirach")).toBeVisible();
  await page.getByRole("link", { name: "Back to the course" }).last().click();
  await expect(page).toHaveURL(/\/learn\/service$/);
  const row = page.locator("[data-lesson='torah-reading']");
  await expect(row).toHaveAttribute("data-state", "done"); await expect(row).toContainText(", done");
  await expect(page.locator("[data-next]")).toHaveAttribute("data-next", "shma");
  await page.reload();
  await expect(page.locator("[data-lesson='torah-reading']")).toHaveAttribute("data-state", "done");
  // Learn to lein's own progress is untouched.
  expect(await page.evaluate(() => localStorage.getItem("crc-torah:learn-progress/v1"))).toBeNull();
});

test("the siddur link opens printed pages 10, 11, 22, 22, 23 and 24 for the six lessons every student leads", async ({ page }) => {
  for (const [id, printed] of U1) {
    await page.goto(`/learn/service/${id}`);
    for (let n = 0; n < 2; n++) await page.getByRole("button", { name: "Next" }).click();
    const main = page.locator("main#lesson-main");
    await expect(main.getByRole("heading", { level: 1, name: "Read it" })).toBeVisible();
    const href = `https://siddur.centralreform.org/?book=legacy-beit-mitzvah&p=${printed}`;
    const read = main.getByRole("link", { name: `Open in the siddur, page ${printed}` });
    await expect(read).toHaveAttribute("href", href); await expect(read).toHaveAttribute("target", "_blank"); await expect(read).toHaveAttribute("rel", "noopener noreferrer");
    await readToDone(page);
    const done = main.getByRole("link", { name: `Open in the siddur, page ${printed}` });
    await expect(done).toHaveAttribute("href", href); await expect(done).toHaveAttribute("referrerpolicy", "no-referrer");
    await expect(main.getByText(`In your siddur it is on page ${printed}.`)).toHaveCount(0);
  }
});

test("the Where step names the page and the neighbours, and the map opens the lesson's own section", async ({ page }) => {
  await page.goto("/learn/service/shma");
  await page.getByRole("button", { name: "Next" }).click();
  const main = page.locator("main#lesson-main");
  await expect(main.getByText("Sh’ma comes after Ahavah Rabbah and before V’ahavta.")).toBeVisible();
  await expect(main.getByText("Part of the Sh’ma and its blessings.")).toBeVisible();
  await expect(main.getByText("In your siddur it is on page 10.")).toBeVisible();
  await expect(main.locator("[aria-current='step']")).toHaveText("Sh’ma");
  await expect(main.locator("li[data-here] > ol > li")).toHaveText(["Bar’chu", "Yotzeir Or", "Ahavah Rabbah", "Sh’ma", "V’ahavta", "Mi Chamochah"]);
  await page.goto("/learn/service/modeh-ani"); await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByText("Modeh Ani opens the service.")).toBeVisible();
  await page.goto("/learn/service/closing-blessing"); await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByText("Closing blessing closes the service.")).toBeVisible();
});

test("About names the teacher and the text, and goes back to the course", async ({ page }) => {
  const response = await page.goto("/learn/service/about");
  expect(response?.status()).toBe(200); expect(response?.headers()["x-robots-tag"]).toBe("noindex, nofollow");
  await expect(page.getByRole("heading", { level: 1, name: "About this course" })).toBeVisible();
  await expect(page.getByText("The teaching on each prayer is by Rabbi Daniel Bogard.")).toBeVisible();
  await expect(page.getByText("Signed out, progress stays on this device.")).toBeVisible();
  expect(await noHorizontalScroll(page)).toBe(true);
  await page.getByRole("link", { name: "Back to the course" }).click();
  await expect(page).toHaveURL(/\/learn\/service$/);
});

// 2.0 SC7: the evening and Havdalah lessons read the CRC siddur's own text from /api/public/evening-text. The unconfigured server has no
// stored siddur book, so each test serves a synthetic one: invented letters, invented transliteration, an invented attribution.
const EVENING = [["maariv-aravim", 37], ["ahavat-olam", 38], ["hashkiveinu", 42], ["shalom-rav", 50], ["yayin", 60], ["bsamim", 60], ["eish", 61], ["havdalah", 61], ["eliyahu", 62], ["miryam", 62], ["shavua-tov", 62]] as const;
async function serveEvening(page: Page, status = 200) {
  const asked: string[] = [];
  await page.route("**/api/public/evening-text?**", async route => {
    const url = new URL(route.request().url()), unit = url.searchParams.get("unit") ?? "";
    asked.push(url.searchParams.get("build") === "781faabb7b21" && route.request().headers()["cookie"] === undefined ? unit : "wrong-request");
    if (status !== 200) return route.fulfill({ status, contentType: "application/json", headers: { "cache-control": "no-store" }, body: JSON.stringify({ error: status === 404 ? "not-found" : "unavailable" }) });
    const lines = Array.from({ length: 17 }, (_, i) => ({ he: syntheticLine(i).he, tr: syntheticLine(i).tr, ...(i === 16 ? { en: "Synthetic translation.\n~ Synthetic translator" } : {}) }));
    return route.fulfill({ status: 200, contentType: "application/json", headers: { "cache-control": "no-store" },
      body: JSON.stringify({ unit, volume: "legacy-beit-mitzvah", credit: { title: "Synthetic book", attribution: "Synthetic attribution for this congregation." }, lines }) });
  });
  return asked;
}

test("every evening and Havdalah lesson opens at 360 px, reads the siddur's text signed out, and runs to Done with its own evening page", async ({ page }) => {
  const asked = await serveEvening(page);
  for (const [id, pageNumber] of EVENING) {
    await page.goto(`/learn/service/${id}`);
    const main = page.locator("main#lesson-main");
    await expect(main.getByRole("heading", { level: 1, name: "About this prayer" })).toBeVisible();
    await expect(main.getByText("Rabbi Daniel Bogard", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Next" }).click();
    await expect(main.getByText(`In your siddur it is on page ${pageNumber}.`)).toBeVisible();
    await page.getByRole("button", { name: "Next" }).click();
    await expect(main.getByRole("heading", { level: 1, name: "Read it" })).toBeVisible();
    await expect(main.locator("ol li").first()).toBeVisible();
    await expect(main.getByText("Synthetic attribution for this congregation.")).toBeVisible();
    await expect(main.locator(`[data-siddur-page='${pageNumber}']`)).toBeVisible();
    expect(await noHorizontalScroll(page), id).toBe(true);
    await readToDone(page);
    await expect(main.getByRole("link", { name: `Open in the siddur, page ${pageNumber}` })).toBeVisible();
  }
  expect(new Set(asked).has("wrong-request")).toBe(false);
  expect(new Set(asked).size).toBe(11);
});

test("an evening lesson shows transliteration and the printed translation only on request, and its neighbours in the book's order", async ({ page }) => {
  await serveEvening(page);
  await page.goto("/learn/service/maariv-aravim");
  const main = page.locator("main#lesson-main");
  await page.getByRole("button", { name: "Next" }).click();
  await expect(main.getByText("Ma’ariv Aravim comes after Bar’chu and before Ahavat Olam.")).toBeVisible();
  await expect(main.getByText("Part of Saturday evening: the Sh’ma and its blessings.")).toBeVisible();
  await page.getByRole("button", { name: "Next" }).click();
  await expect(main.getByText(syntheticLine(0).tr)).toHaveCount(0);
  await main.getByRole("button", { name: "Show transliteration" }).click();
  await expect(main.getByText(syntheticLine(0).tr)).toBeVisible();
  await expect(main.getByText("~ Synthetic translator")).toHaveCount(0);
  await main.getByRole("button", { name: "Show English" }).click();
  await expect(main.getByText(/~ Synthetic translator/)).toBeVisible();
});

test("an evening lesson off the CRC site says the course is not offered here, and a failed text offers Try again", async ({ page }) => {
  await serveEvening(page, 404);
  await page.goto("/learn/service/yayin");
  for (let i = 0; i < 2; i++) await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByText("The service course isn’t available here yet.")).toBeVisible();
  await page.unroute("**/api/public/evening-text?**");
  await serveEvening(page, 503);
  await page.goto("/learn/service/yayin");
  for (let i = 0; i < 2; i++) await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByText("The prayer text did not load. Try again.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
});

test("the strand of letters is open and an unknown lesson is a plain 404, as in Learn to lein", async ({ page }) => {
  for (const id of ["f1", "f6"]) expect((await page.goto(`/learn/service/${id}`))?.status(), id).toBe(200);
  for (const id of ["nope", "evening", "f7"]) expect((await page.goto(`/learn/service/${id}`))?.status(), id).toBe(404);
});

test("keyboard: the skip link and the thumb button are reachable, and the focus moves to the lesson on Next", async ({ page }) => {
  await page.goto("/learn/service/shma");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to the lesson" })).toBeFocused();
  await page.getByRole("button", { name: "Next" }).focus(); await page.keyboard.press("Enter");
  await expect(page.locator("main#lesson-main")).toBeFocused();
  await expect(page.locator("main#lesson-main h1")).toHaveText("Where it is in the service");
});

test("the Sh’ma runs screen for screen as A8 has it: About, Where, Read with its toggles, Key words, Check and Done", async ({ page }) => {
  const asked = await serveText(page);
  await page.goto("/learn/service/shma");
  const main = page.locator("main#lesson-main");
  await expect(page.getByRole("list", { name: "Step 1 of 6" })).toBeAttached();
  await expect(main.getByRole("heading", { level: 1, name: "About this prayer" })).toBeVisible();
  await expect(main.getByText(/^The Sh’ma \(Deuteronomy 6:4\) is among the oldest fixed parts of Jewish prayer/)).toBeVisible();
  await page.getByRole("button", { name: "Next" }).click();
  await expect(main.getByText("Sh’ma comes after Ahavah Rabbah and before V’ahavta.")).toBeVisible();
  await page.getByRole("button", { name: "Next" }).click();
  // Read it: the lines right to left, the instruction, the toggles off, the credit, the note and the siddur link.
  await expect(main.getByRole("heading", { level: 1, name: "Read it" })).toBeVisible();
  await expect(main.getByText("Read each line aloud at your own pace. Tap a word to see what it means.")).toBeVisible();
  // Until f1 is done, a quiet link points to Reading Hebrew.
  await expect(main.getByRole("link", { name: "New to Hebrew letters? Start with Reading Hebrew." })).toHaveAttribute("href", "/learn/service/f1");
  const lines = main.locator("ol li p[lang='he']");
  await expect(lines).toHaveCount(2);
  await expect(lines.first()).toHaveAttribute("dir", "rtl");
  await expect(main.getByText("Sh’ma Yisra’el, Adonai Eloheinu, Adonai echad.")).toHaveCount(0);
  await main.getByRole("button", { name: "Show transliteration" }).click();
  await expect(main.getByText("Sh’ma Yisra’el, Adonai Eloheinu, Adonai echad.")).toBeVisible();
  await expect(main.getByRole("button", { name: "Hide transliteration" })).toHaveAttribute("aria-pressed", "true");
  await main.getByRole("button", { name: "Show English" }).click();
  await expect(main.getByText("Synthetic first line.")).toBeVisible();
  await expect(main.getByText("Text: Shirei Tfilah, CC BY-NC-SA 4.0.")).toBeVisible();
  await expect(main.getByText("Your siddur may print this prayer a little differently. Read it there too.")).toBeVisible();
  await expect(main.getByRole("link", { name: "Open in the siddur, page 10" })).toHaveAttribute("href", "https://siddur.centralreform.org/?book=legacy-beit-mitzvah&p=10");
  // The second line's words are not key words: plain text. The first line's key words open a card.
  await expect(lines.nth(1).locator("button")).toHaveCount(0);
  expect(await noHorizontalScroll(page)).toBe(true);
  await page.getByRole("button", { name: "Next" }).click();
  // Key words: five rows, the transliteration from the line, the course's glosses.
  await expect(main.getByRole("heading", { level: 1, name: "Key words" })).toBeVisible();
  await expect(main.getByText("A few words to know in this prayer. Tap one for more.")).toBeVisible();
  const rows = main.locator("ul li button");
  await expect(rows).toHaveCount(5);
  await expect(rows.nth(0)).toContainText("Sh’ma"); await expect(rows.nth(0)).toContainText("hear, listen");
  await expect(rows.nth(2)).toContainText("God’s name, said as Adonai");
  await expect(rows.nth(4)).toContainText("echad"); await expect(rows.nth(4)).toContainText("one");
  // The verse could not load on this server, so the card is the glossary card: the word, its gloss, its root, its line.
  await rows.nth(0).click();
  const card = page.locator("[data-gloss-card]");
  await expect(card).toBeVisible();
  await expect(card.getByText("hear, listen")).toBeVisible();
  await expect(card.getByText("sh-m-a")).toBeVisible();
  await expect(card.locator("mark")).toHaveText(SHMA[0]);
  await page.keyboard.press("Escape");
  await expect(card).toHaveCount(0);
  await expect(rows.nth(0)).toBeFocused();
  expect(await noHorizontalScroll(page)).toBe(true);
  await page.getByRole("button", { name: "Next" }).click();
  // Check: the instruction, then items; Next waits for an answer; nothing is counted.
  await expect(main.getByRole("heading", { level: 1, name: "Check" })).toBeVisible();
  await expect(main.getByText("A few questions on what you just read. Answer before you look.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Next" })).toBeDisabled();
  const seen = new Set<string>();
  for (let n = 0; n < 20 && await main.getByRole("heading", { level: 1, name: "Check" }).count(); n++) {
    const prompt = await main.locator("[data-check-kind]").textContent();
    seen.add(await main.locator("[data-check-kind]").getAttribute("data-check-kind") ?? "");
    expect(prompt).toMatch(/^(?:Which word says (?:Sh’ma|Yisra’el|Eloheinu|echad)\?|Which word means .+\?|What does this word mean\?)$/);
    expect(prompt).not.toMatch(/says Adonai/);
    await main.locator("ul button").first().click();
    await expect(main.getByText(/^(?:Yes\. .+ (?:is|means) .+\.|That one (?:is|means) .+\.)$/).first()).toBeVisible();
    await page.getByRole("button", { name: "Next" }).click();
  }
  expect(seen.has("says")).toBe(true);
  await expect(main.getByText(/\d+ (?:of|out of) \d+|score|correct/i)).toHaveCount(0);
  // Done: the A8 goal, the siddur link and the next lesson; the lesson is saved as done.
  await expect(main.getByText("Done", { exact: true })).toBeVisible();
  await expect(main.getByText("You can read the Sh’ma’s first line and say what its key words mean.")).toBeVisible();
  await expect(main.getByRole("link", { name: "Open in the siddur, page 10" })).toBeVisible();
  await expect(main.getByText("Next: V’ahavta")).toBeVisible();
  const stored = JSON.parse((await page.evaluate(key => localStorage.getItem(key), KEY)) as string);
  expect(Object.keys(stored.lessons)).toEqual(["shma"]);
  expect(asked).toEqual(["shma.the-shma@shabbat-shacharit"]);
});

test("a text that does not load says so, offers Try again and is never marked done; a rate limit says it is one", async ({ page }) => {
  await page.unrouteAll({ behavior: "ignoreErrors" });
  for (const [status, message] of [[503, "The prayer text did not load. Try again."], [429, "Too many requests from this connection. Try again in a minute."]] as const) {
    await page.unrouteAll({ behavior: "ignoreErrors" });
    await serveText(page, status);
    await page.goto("/learn/service/barchu");
    for (let n = 0; n < 2; n++) await page.getByRole("button", { name: "Next" }).click();
    const main = page.locator("main#lesson-main");
    await expect(main.getByRole("alert")).toContainText(message);
    await expect(page.getByRole("button", { name: "Next" })).toBeDisabled();
    await expect(main.getByRole("link", { name: "Open in the siddur, page 7" })).toBeVisible();
    expect(await page.evaluate(key => localStorage.getItem(key), KEY)).toBeNull();
    // Once the text answers, Try again shows it.
    await page.unrouteAll({ behavior: "ignoreErrors" }); await serveText(page);
    await main.getByRole("button", { name: "Try again" }).click();
    await expect(main.locator("ol li p[lang='he']").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Next" })).toBeEnabled();
    await page.evaluate(() => localStorage.clear());
  }
});

test("the Mi Shebeirach never asks for text: its Read step is the siddur link alone, and the route refuses it", async ({ page, request }) => {
  const asked = await serveText(page);
  await page.goto("/learn/service/mi-shebeirach");
  for (let n = 0; n < 2; n++) await page.getByRole("button", { name: "Next" }).click();
  const main = page.locator("main#lesson-main");
  await expect(main.getByText("This prayer’s text is in the siddur.")).toBeVisible();
  await expect(main.getByRole("link", { name: "Open in the siddur, page 23" })).toBeVisible();
  await expect(main.locator("p[lang='he']")).toHaveCount(0);
  expect(asked).toEqual([]);
  for (const unit of ["torah.mi-shebeirach-healing@shabbat-shacharit", "shma.the-shma@bm-shacharit", "shma.the-shma@legacy-beit-mitzvah"]) {
    const response = await request.get(`/api/public/service-text?unit=${encodeURIComponent(unit)}&build=edfef85`);
    expect(response.status(), unit).toBe(400);
  }
});

// ---- 2.0 SC3: Reading Hebrew, Review and Quick ten -------------------------------------------------------------------------------

/** Words that count right answers, a score, a tally or a streak: none may appear anywhere on a screen of the strand, Review or Quick ten. */
const COUNTING = /\b\d+ (?:of|out of) \d+\b|\bscore\b|\bcorrect\b|\bpoints?\b|\btally\b|\bstreak\b|\bperfect\b|\bwell done\b|\bgreat\b/i;
const stored = async (page: Page) => JSON.parse((await page.evaluate(key => localStorage.getItem(key), KEY)) as string);
/** Progress written into this browser, as the course keeps it: lessons done at an instant, cards in boxes with a due day. */
async function seedProgress(page: Page, lessons: string[], cards: Record<string, { box: number; due: string }> = {}) {
  await page.goto("/learn/service");
  await page.evaluate(([key, doc]) => localStorage.setItem(key, doc), [KEY, JSON.stringify({ schema: "service-course-progress/v1", lessons: Object.fromEntries(lessons.map(id => [id, { done: "2026-10-20T10:00:00.000Z" }])), cards })]);
  await page.reload();
}
/** One lesson of the strand from its Intro to its Done screen, answering every question with its first choice and reading every word and line. */
async function runStrandLesson(page: Page, id: string) {
  const main = page.locator("main#lesson-main");
  await page.goto(`/learn/service/${id}`);
  let steps = 0;
  for (; steps < 80; steps++) {
    await expect(main).toHaveAttribute("data-step", /^(?:intro|item|word|line|done)$/);
    const step = await main.getAttribute("data-step");
    expect(await main.evaluate(node => node.scrollWidth <= node.clientWidth + 1), `${id} ${step} no sideways scroll`).toBe(true);
    if (step === "done") break;
    if (step === "intro") await page.getByRole("button", { name: "Next" }).click();
    else if (step === "item") { await main.locator("ul button").first().click(); await expect(main.locator("[aria-live='polite']").first()).not.toBeEmpty(); await page.getByRole("button", { name: "Next" }).click(); }
    else if (step === "word") { await main.getByRole("button", { name: "Show transliteration" }).click(); await expect(main.locator("[data-translit]")).toBeVisible(); await page.getByRole("button", { name: "Next" }).click(); }
    else if (step === "line") {
      const reveal = main.getByRole("button", { name: "Show the next word" });
      while (await reveal.count()) await reveal.click();
      await expect(main.locator("[data-translit]")).not.toContainText("___");
      await main.getByRole("button", { name: "I read it" }).click();
    }
    await expect(main).toBeFocused();
  }
  expect(steps, `${id} reaches Done`).toBeLessThan(80);
  await expect(main.getByText("Done", { exact: true })).toBeVisible();
  return main;
}

test("the six fluency lessons run in order with no audio, each from its Intro to its Done, and nothing on screen counts right answers", async ({ page }) => {
  test.setTimeout(240_000);
  await page.unrouteAll({ behavior: "ignoreErrors" }); const asked = await serveText(page, 200, true);
  const requests: string[] = []; page.on("request", request => requests.push(new URL(request.url()).pathname));
  const goals: Record<string, string | null> = { f1: null, f2: "You can name every Hebrew letter, including the final forms.", f3: null, f4: null, f5: null, f6: "You can read a whole line of a prayer on your own." };
  const titles = ["Letters, part one", "Letters, part two", "Vowels", "Dots that change a letter", "Reading words", "Reading lines"];
  for (const [n, id] of ["f1", "f2", "f3", "f4", "f5", "f6"].entries()) {
    await page.goto(`/learn/service/${id}`);
    const main = page.locator("main#lesson-main");
    if (n < 4) {
      // The Intro first: the title, the lesson's own summary, and what the questions will name.
      await expect(main.getByRole("heading", { level: 1, name: titles[n] })).toBeVisible();
      await expect(main).toHaveAttribute("data-step", "intro");
      await expect(main.locator("ul li").first()).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${id} intro`).toBe(true);
    }
    const done = await runStrandLesson(page, id);
    if (goals[id]) await expect(done.getByText(goals[id]!)).toBeVisible();
    else await expect(done.locator("p").filter({ hasText: /^You can / })).toHaveCount(0);
    await expect(done.getByText(n < 5 ? `Next: ${titles[n + 1]}` : "Next: Sh’ma")).toBeVisible();
    expect(await page.locator("audio, video").count(), id).toBe(0);
    await expect(done.getByText(COUNTING), `${id} done`).toHaveCount(0);
    const progress = await stored(page);
    expect(Object.keys(progress.lessons)).toContain(id);
  }
  // In order, and nothing played: no recording, no audio file, no learner recording was ever asked for.
  expect(requests.filter(path => /\.(?:mp3|m4a|ogg|wav|webm)$|audio|recording/i.test(path))).toEqual([]);
  // f5 and f6 read the pinned public text: only the three units of their corpus, each under the pinned build.
  expect([...new Set(asked)].sort()).toEqual(["shma.barchu@shabbat-shacharit", "shma.the-shma@shabbat-shacharit", "torah.blessing-before-the-torah@shabbat-shacharit"]);
  const progress = await stored(page);
  expect(Object.keys(progress.lessons).sort()).toEqual(["f1", "f2", "f3", "f4", "f5", "f6"]);
  // f1 plants its letters, f2 the rest and the five finals, f3 its vowels; f4 to f6 plant none.
  expect(Object.keys(progress.cards).filter(id => id.startsWith("letter:"))).toHaveLength(27);
  expect(Object.keys(progress.cards).filter(id => id.startsWith("vowel:"))).toHaveLength(8);
  expect(Object.keys(progress.cards)).toHaveLength(35);
  // With f1 done the quiet link to Reading Hebrew is gone from a prayer's Read step and from the home.
  await page.goto("/learn/service"); await expect(page.getByText("New to Hebrew letters?")).toHaveCount(0);
});

test("Reading Hebrew asks a letter by sight, a vowel by sound and a dot pair by sound, with the approved wording and no same-or-different", async ({ page }) => {
  const main = page.locator("main#lesson-main");
  const prompts = new Set<string>(); const said = new Set<string>();
  for (const id of ["f1", "f2", "f3", "f4"]) {
    await page.goto(`/learn/service/${id}`);
    await page.getByRole("button", { name: "Next" }).click();
    for (let n = 0; n < 120 && await main.getAttribute("data-step") === "item"; n++) {
      prompts.add(((await main.locator("[data-check-kind]").textContent()) ?? "").replace(/Which one is .+\?/, "Which one is {name}?"));
      await main.locator("ul button").nth(n % 2).click();
      said.add(((await main.locator("[aria-live='polite']").first().textContent()) ?? "").replace(/\s+/g, " "));
      await page.getByRole("button", { name: "Next" }).click();
    }
  }
  expect([...prompts].sort()).toEqual(["Is this shin or sin?", "These two look alike. Which one is {name}?", "This letter comes only at the end of a word. Which letter is it?", "Which letter is this?",
    "Which sound does this make?", "With the dot or without it?"].sort());
  for (const line of said) { expect(line).not.toMatch(/\bsame\b|\bdifferent\b|!/i); expect(line).toMatch(/(?:^Yes\. .+ is .+\.|^That one is .+\.|sounds like “.+”\.|^The dot makes .+\. Without it, .+\.)/); }
});

test("a letter lesson shows its Intro with names, a vowel lesson shows each vowel with its sound, and a dot lesson shows each pair", async ({ page }) => {
  const main = page.locator("main#lesson-main");
  await page.goto("/learn/service/f1");
  await expect(main.getByText("The first eleven letters, and the ones that look alike.")).toBeVisible();
  await expect(main.locator("ul li")).toHaveCount(11);
  await expect(main.locator("ul li").nth(1)).toContainText("Bet/Vet");
  await page.goto("/learn/service/f2"); await expect(main.locator("ul li")).toHaveCount(16); await expect(main.getByText("Final Mem")).toBeVisible();
  await page.goto("/learn/service/f3");
  await expect(main.getByText("Chirik sounds like “ee”.")).toBeVisible();
  await expect(main.getByText("Kamatz sounds like “ah”.")).toBeVisible();
  await page.goto("/learn/service/f4");
  await expect(main.getByText("The dot makes b. Without it, v.")).toBeVisible();
  await expect(main.getByText("The dot makes p. Without it, f.")).toBeVisible();
  await expect(main.getByText("Shin", { exact: true })).toBeVisible(); await expect(main.getByText("Sin", { exact: true })).toBeVisible();
});

test("f6 brings a line marked Not yet back once, and keeps the answer nowhere", async ({ page }) => {
  await page.unrouteAll({ behavior: "ignoreErrors" }); await serveText(page, 200, true);
  await page.goto("/learn/service/f6");
  const main = page.locator("main#lesson-main");
  await expect(main).toHaveAttribute("data-step", "line");
  const first = await main.locator("[data-read-line]").textContent();
  await main.getByRole("button", { name: "Not yet" }).click();
  // Two questions on the line, then the next line, then (later) the same first line again, once.
  let seen = 0;
  for (let n = 0; n < 60 && await main.getAttribute("data-step") !== "done"; n++) {
    const step = await main.getAttribute("data-step");
    if (step === "line") { if ((await main.locator("[data-read-line]").textContent()) === first) seen++; await main.getByRole("button", { name: "I read it" }).click(); }
    else { await main.locator("ul button").first().click(); await page.getByRole("button", { name: "Next" }).click(); }
  }
  expect(seen).toBe(1);
  const progress = await stored(page);
  expect(JSON.stringify(progress)).not.toMatch(/notyet|readit|self/i);
  expect(Object.keys(progress)).toEqual(["schema", "lessons", "cards"]);
});

test("f5 and f6 say the text did not load, offer Try again and are never marked done", async ({ page }) => {
  await page.unrouteAll({ behavior: "ignoreErrors" }); await serveText(page, 503);
  await page.goto("/learn/service/f5");
  const main = page.locator("main#lesson-main");
  await expect(main.getByRole("alert")).toContainText("The prayer text did not load. Try again.");
  expect(await page.evaluate(key => localStorage.getItem(key), KEY)).toBeNull();
  await page.unrouteAll({ behavior: "ignoreErrors" }); await serveText(page);
  await main.getByRole("button", { name: "Try again" }).click();
  await expect(main).toHaveAttribute("data-step", "word");
  await expect(main.getByText("Read the word one syllable at a time. Then show the transliteration to check yourself.")).toBeVisible();
});

test("Quick ten opens only after three prayers with a Read step, or after f6, and its row is absent until then", async ({ page }) => {
  await page.goto("/learn/service/practice/quick-ten");
  await expect(page.getByText("Quick ten opens after three prayers you have read.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to the course" }).last()).toBeVisible();
  // Two prayers with a Read step, and two moments and a prayer with no text, are not enough.
  await seedProgress(page, ["shma", "vahavta", "torah-reading", "commentary", "psukei-dzimrah"]);
  await expect(page.locator("[data-row='quick-ten']")).toHaveCount(0);
  await page.goto("/learn/service/practice/quick-ten");
  await expect(page.getByText("Quick ten opens after three prayers you have read.")).toBeVisible();
  // The third prayer with a Read step opens it, and the home offers it.
  await seedProgress(page, ["shma", "vahavta", "barchu"]);
  await expect(page.locator("[data-row='quick-ten']")).toContainText("Quick ten: ten words from your prayers, about 2 minutes");
  await expect(page.locator("[data-row='quick-ten']")).toHaveAttribute("href", "/learn/service/practice/quick-ten");
  // f6 alone opens it too.
  await seedProgress(page, ["f6"]);
  await expect(page.locator("[data-row='quick-ten']")).toBeVisible();
});

test("Quick ten asks ten words by sound, shows each word in its line, follows on its own, ends on Done and moves the words' cards", async ({ page }) => {
  test.setTimeout(120_000);
  await seedProgress(page, ["shma", "vahavta", "barchu"], Object.fromEntries(["shma", "vahavta", "barchu"].map(id => [`word:${id}:read`, { box: 1, due: "2026-12-30" }])));
  await page.locator("[data-row='quick-ten']").click();
  const main = page.locator("main#lesson-main");
  await expect(page.getByRole("heading", { level: 1, name: "Quick ten" })).toBeVisible();
  let asked = 0;
  for (; asked < 30; asked++) {
    await expect.poll(async () => (await main.locator("ul button:not([disabled])").count()) > 0 || (await main.getByText(/^Done\./).count()) > 0, { timeout: 8000 }).toBe(true);
    if (await main.getByText(/^Done\./).count()) break;
    await expect(main.locator("[data-check-kind]")).toHaveText(/^Which says \S+\?$/);
    expect(await main.locator("ul button").count()).toBe(3);
    expect(await main.locator("ul button span[lang='he']").count()).toBe(3);
    await expect(main.getByRole("button", { name: "Next" })).toHaveCount(0);
    expect(await inViewport(page, "button:has-text('Stop here')")).toBe(true);
    await main.locator("ul button").nth(asked % 3).click();
    // The answer: what it says, and the word in its line, marked.
    await expect(main.locator("[aria-live='polite'] p").first()).toHaveText(/^(?:Yes\. .+ is .+\.|That one is .+\.)$/);
    await expect(main.locator("mark")).toHaveCount(1);
    await expect(main.getByText(COUNTING)).toHaveCount(0);
  }
  expect(asked).toBeGreaterThanOrEqual(10);
  await expect(main.getByText(/^Done\.(?: The ones you missed come back in review\.)?$/)).toBeVisible();
  await expect(main.getByText(COUNTING)).toHaveCount(0);
  const progress = await stored(page);
  expect(Object.keys(progress.lessons).sort()).toEqual(["barchu", "shma", "vahavta"]);
  // A card moves at most one box a run on a right answer and drops two on a miss: box 1 is 0, 1 or 2 afterwards, never more.
  for (const card of Object.values(progress.cards) as { box: number }[]) { expect(card.box).toBeGreaterThanOrEqual(0); expect(card.box).toBeLessThanOrEqual(2); }
  await page.getByRole("link", { name: "Back to the course" }).last().click();
  await expect(page).toHaveURL(/\/learn\/service$/);
});

test("Quick ten stops where the learner stops", async ({ page }) => {
  await seedProgress(page, ["f6"]);
  await page.goto("/learn/service/practice/quick-ten");
  const main = page.locator("main#lesson-main");
  await expect(main.locator("ul button").first()).toBeEnabled();
  await main.getByRole("button", { name: "Stop here" }).click();
  await expect(main.getByText(/^Done\./)).toBeVisible();
  await expect(main.getByText(COUNTING)).toHaveCount(0);
});

test("Review says nothing is due, then runs the due cards, letters and words together, and ends on Done", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/learn/service/review");
  await expect(page.getByText("Nothing to review today.")).toBeVisible();
  const due = "2026-10-01", cards: Record<string, { box: number; due: string }> = {};
  for (const id of ["alef", "bet", "gimel", "dalet", "hei", "vav", "zayin", "chet", "tet", "yod", "kaf"]) cards[`letter:${id}:name`] = { box: 1, due };
  cards["word:shma:read"] = { box: 2, due }; cards["word:shma:meaning"] = { box: 2, due };
  await seedProgress(page, ["f1", "shma"], cards);
  await expect(page.locator("[data-row='review']")).toContainText("Review: 13 words, about 2 minutes");
  await page.locator("[data-row='review']").click();
  const main = page.locator("main#lesson-main");
  await expect(page.getByRole("heading", { level: 1, name: "Review" })).toBeVisible();
  const kinds = new Set<string>();
  for (let n = 0; n < 40 && await main.getByText(/^Done\.$/).count() === 0; n++) {
    await expect(main.locator("[data-check-kind]")).toBeVisible();
    kinds.add(((await main.locator("[data-check-kind]").textContent()) ?? "").replace(/Which one is .+\?/, "Which one is {name}?").replace(/Which word (?:says|means) .+\?/, "Which word …?"));
    await main.locator("ul button").first().click();
    await expect(main.getByText(COUNTING)).toHaveCount(0);
    await page.getByRole("button", { name: "Next" }).click();
  }
  await expect(main.getByText("Done.", { exact: true })).toBeVisible();
  expect([...kinds].some(kind => kind === "Which letter is this?" || kind.startsWith("These two look alike"))).toBe(true);
  expect([...kinds].some(kind => kind === "Which word …?" || kind === "What does this word mean?")).toBe(true);
  const progress = await stored(page);
  expect(Object.keys(progress.cards)).toHaveLength(13);
  // Cards that came up have moved: a right answer lifts a card one box and puts it a few days out, a miss drops it two and asks it today.
  expect(Object.values(progress.cards).some(card => (card as { due: string }).due !== due)).toBe(true);
  expect(Object.keys(progress.lessons).sort()).toEqual(["f1", "shma"]);
});

test("the strand, Review and Quick ten open at 360 px with the thumb button in reach and no sideways scroll", async ({ page }) => {
  await seedProgress(page, ["f6", "shma", "vahavta", "barchu"], { "letter:alef:name": { box: 1, due: "2026-10-01" }, "letter:bet:name": { box: 1, due: "2026-10-01" }, "letter:gimel:name": { box: 1, due: "2026-10-01" } });
  for (const path of ["/learn/service/f1", "/learn/service/f3", "/learn/service/review", "/learn/service/practice/quick-ten"]) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(200);
    expect(response?.headers()["x-robots-tag"], path).toBe("noindex, nofollow");
    await expect(page.locator("main#lesson-main")).toBeVisible();
    expect(await noHorizontalScroll(page), path).toBe(true);
  }
  await page.goto("/learn/service/f1");
  expect(await inViewport(page, "button.button-start")).toBe(true);
});
