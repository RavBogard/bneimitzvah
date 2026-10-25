import { expect, test, type Page } from "@playwright/test";

// The built, unconfigured production server, signed out, at 360 px. The service course (2.0 SC1) is reachable by its URL
// only: nothing in the navigation or the front door links to it yet, and it is noindex like the other learning pages.
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
async function serveText(page: Page, status = 200) {
  const asked: string[] = [];
  await page.route("**/api/public/service-text?**", async route => {
    const unit = new URL(route.request().url()).searchParams.get("unit") ?? "";
    asked.push(new URL(route.request().url()).searchParams.get("build") === "edfef85" ? unit : "wrong-build");
    if (status !== 200) return route.fulfill({ status, contentType: "application/json", headers: { "cache-control": "no-store" }, body: JSON.stringify({ error: "unavailable" }) });
    const body = unit === "shma.the-shma@shabbat-shacharit" ? shmaAnswer(unit) : answer(unit, Array.from({ length: 10 }, (_, i) => syntheticLine(i)));
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
  await expect(page.getByText("Progress is saved on this device. Sign in to keep it.")).toBeVisible();
  await expect(page.getByText("Saturday evening and Havdalah come next.")).toBeVisible();
  const nav = page.getByRole("navigation", { name: "Course" });
  await expect(nav.getByRole("link", { name: "Learn to lein" })).toHaveAttribute("href", "/learn");
  await expect(nav.getByRole("link", { name: "About" })).toHaveAttribute("href", "/learn/service/about");
  for (const title of ["The parts every student leads", "Morning blessings", "The Sh’ma and its blessings", "The Amidah", "The Torah service", "Closing the service"]) await expect(page.getByRole("heading", { level: 2, name: title })).toBeVisible();
  // The strand of letters waits for its own slice: no unit, no row.
  await expect(page.getByText("Reading Hebrew")).toHaveCount(0);
  await expect(page.getByText("New to Hebrew letters?")).toHaveCount(0);
  // Every row of every list is a link, never a bare span (DP-09): 37 lessons, 37 links.
  await expect(page.locator("ol li")).toHaveCount(37);
  await expect(page.locator("ol li > a[href^='/learn/service/']")).toHaveCount(37);
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
  await expect(page.getByText("Nothing here records you. Progress stays on this device unless you sign in.")).toBeVisible();
  expect(await noHorizontalScroll(page)).toBe(true);
  await page.getByRole("link", { name: "Back to the course" }).click();
  await expect(page).toHaveURL(/\/learn\/service$/);
});

test("the strand of letters is closed and an unknown lesson is a plain 404, as in Learn to lein", async ({ page }) => {
  for (const id of ["f1", "f6", "nope", "evening"]) expect((await page.goto(`/learn/service/${id}`))?.status(), id).toBe(404);
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
