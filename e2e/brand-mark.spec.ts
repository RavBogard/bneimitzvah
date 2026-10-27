import { expect, test, type Page } from "@playwright/test";

// Siona Benjamin's CRC floor is the brand mark (DESIGN.md, Brand mark) on the built, unconfigured production server: the 28px disc in the
// site bar, the retired icon URLs, and the bar holding one line from 320px with the Beta chip hiding only where it no longer fits.
// Measured in Chromium: disc, name, Beta, Read, Learn and the icon-only account control need 368px; Beta shows from 375px up.
const BETA_BREAKPOINT = 375;

test("the brand link holds the disc with an empty alt and keeps the name CRC Torah, in the site and the minimal bar", async ({ page }) => {
  for (const path of ["/read", "/sign-in"]) {
    await page.goto(path);
    const brand = page.locator("[data-site-bar] a.portal-brand");
    await expect(brand, path).toHaveAccessibleName("CRC Torah");
    const disc = brand.locator("img");
    await expect(disc, path).toHaveAttribute("alt", "");
    await expect(disc, path).toHaveAttribute("width", "28");
    await expect(disc, path).toHaveAttribute("height", "28");
    await expect.poll(() => disc.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0), { message: path }).toBe(true);
    const box = (await disc.boundingBox())!;
    expect([Math.round(box.width), Math.round(box.height)], path).toEqual([28, 28]);
  }
  await page.goto("/");
  await expect(page.locator("[data-site-bar]").first().locator("a.portal-brand img")).toHaveCount(1);
});

// installable.spec.ts covers /favicon.ico, the Apple icon and the manifest icons; this covers the header disc files and the retired URLs.
test("the header disc files answer 200 as webp, and the old generated icon URLs redirect to the new files", async ({ request }) => {
  const favicon = await request.get("/favicon.ico");
  expect(favicon.headers()["content-type"]).toMatch(/^image\/(?:x-icon|vnd\.microsoft\.icon)/);
  for (const [path, type] of [["/brand/mural-64.webp", /^image\/webp/], ["/brand/mural-128.webp", /^image\/webp/], ["/apple-touch-icon.png", /^image\/png/], ["/icons/icon-192.png", /^image\/png/],
    ["/icons/icon-512.png", /^image\/png/], ["/icons/maskable-512.png", /^image\/png/], ["/icons/apple-180.png", /^image\/png/], ["/icons/favicon-48.png", /^image\/png/]] as const) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(200);
    expect(response.headers()["content-type"], path).toMatch(type);
  }
});

/** Where the pieces of the bar sit, measured in the browser (the 16px gutter is the page's own side padding). */
async function barState(page: Page) {
  return page.evaluate(() => {
    const bar = document.querySelector<HTMLElement>("[data-site-bar]")!, width = document.documentElement.clientWidth;
    const shown = (selector: string) => [...bar.querySelectorAll<HTMLElement>(selector)].filter(element => getComputedStyle(element).display !== "none");
    const parts = [...shown("a.portal-brand"), ...shown(".site-beta"), ...shown(".site-bar-link")], rects = parts.map(element => element.getBoundingClientRect());
    const beta = shown(".site-beta")[0], links = shown(".site-bar-link"), last = links[links.length - 1];
    const nameEnd = (beta ?? shown("a.portal-brand")[0]).getBoundingClientRect().right;
    return { overflow: document.documentElement.scrollWidth - width, lines: new Set(rects.map(rect => Math.round(rect.top + rect.height / 2))).size, gap: links[0].getBoundingClientRect().left - nameEnd,
      textRight: last.getBoundingClientRect().right - parseFloat(getComputedStyle(last).paddingRight), limit: width - 16, betaShown: Boolean(beta) };
  });
}

test("from 320px the bar is one line with the disc and the name always shown; the Beta chip shows from its breakpoint up", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "Sets its own widths");
  for (const width of [320, 340, 360, BETA_BREAKPOINT - 1, BETA_BREAKPOINT, 400, 430, 479, 480, 559, 560, 600, 1024]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/read");
    const state = await barState(page);
    expect(state.overflow, `${width}px overflow`).toBeLessThanOrEqual(0);
    expect(state.lines, `${width}px one line`).toBe(1);
    expect(state.gap, `${width}px the name and Read do not touch`).toBeGreaterThanOrEqual(7.5);
    expect(state.textRight, `${width}px right padding`).toBeLessThanOrEqual(state.limit + 0.5);
    expect(state.betaShown, `${width}px Beta`).toBe(width >= BETA_BREAKPOINT);
    await expect(page.locator("[data-site-bar] a.portal-brand img")).toBeVisible();
  }
});
