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
  await expect(next.getByText("about 3 minutes")).toBeVisible();
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
    const steps = MOMENTS.has(id) ? 3 : 4;
    await expect(page.getByRole("list", { name: `Step 1 of ${steps}` }), id).toBeAttached();
    await page.getByRole("button", { name: "Next" }).click();
    await expect(main.getByRole("heading", { level: 1, name: "Where it is in the service" }), id).toBeVisible();
    await expect(main.locator("[aria-current='step']"), id).toHaveCount(1);
    await expect(main.getByText(/ (?:comes after .+ and before .+|opens the service|closes the service)\.$/), id).toBeVisible();
    expect(await noHorizontalScroll(page), `${id} where`).toBe(true);
    await page.getByRole("button", { name: "Next" }).click();
    if (!MOMENTS.has(id)) {
      await expect(main.getByRole("heading", { level: 1, name: "Read it" }), id).toBeVisible();
      await expect(main.getByText("This prayer’s text is in the siddur."), id).toBeVisible();
      expect(await noHorizontalScroll(page), `${id} read`).toBe(true);
      await page.getByRole("button", { name: "Next" }).click();
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
    await page.getByRole("button", { name: "Next" }).click();
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
