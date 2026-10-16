import { expect, test } from "@playwright/test";

const fontPath = "/fonts/noto-serif-hebrew/NotoSerifHebrew.ttf";
const proof = "בָ֑ בָ֙ בָ֮ בָֽ׃";

test("public chart covers the catalog with the local Hebrew font and printable layouts", async ({ page }, testInfo) => {
  const origins = new Set<string>();
  page.on("request", request => { if (request.url().startsWith("http")) origins.add(new URL(request.url()).origin); });
  expect((await page.goto("/trope-chart"))?.status()).toBe(200);
  await expect(page).toHaveTitle("Trope chart | CRC B'nei Mitzvah");
  await expect(page.getByRole("heading", { level: 1, name: "Trope chart", exact: true })).toBeVisible();
  await expect(page.locator("[data-chart-family]")).toHaveCount(11);
  await expect(page.locator("[data-chart-accent]")).toHaveCount(30);
  await expect(page.getByRole("button", { name: "Print chart", exact: true })).toBeEnabled();
  const marks = await page.locator("[data-chart-accent]").evaluateAll(nodes => nodes.map(node => ({
    codepoint: node.getAttribute("data-chart-accent"), sample: node.querySelector('[lang="he"]')?.textContent,
  })));
  expect(new Set(marks.map(mark => mark.codepoint)).size).toBe(30);
  for (const mark of marks) {
    expect(mark.sample).toBe(`בָ${String.fromCodePoint(parseInt(mark.codepoint!, 16))}`);
    expect(mark.sample).toBe(mark.sample?.normalize("NFC"));
  }
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("DOM.enable");
  await cdp.send("CSS.enable");
  const dom = await cdp.send("DOM.getDocument");
  const { nodeId } = await cdp.send("DOM.querySelector", { nodeId: dom.root.nodeId, selector: '[data-chart-accent="0591"] [lang="he"]' });
  const { fonts } = await cdp.send("CSS.getPlatformFontsForNode", { nodeId });
  expect(fonts.some(font => font.isCustomFont && font.familyName === "Noto Serif Hebrew" && font.glyphCount > 0)).toBe(true);
  expect(fonts.every(font => font.isCustomFont)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Print chart", exact: true }).focus();
  await expect(page.getByRole("button", { name: "Print chart", exact: true })).toBeFocused();
  await page.evaluate(async () => { await document.fonts.ready; scrollTo(0, 0); await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); });
  if (testInfo.project.name !== "tablet") await page.screenshot({ path: testInfo.outputPath(`trope-chart-${testInfo.project.name}.png`), fullPage: true });
  if (testInfo.project.name === "phone") {
    const normalSize = await page.locator("html").evaluate(node => parseFloat(getComputedStyle(node).fontSize));
    await page.locator("html").evaluate((node, size) => { node.style.fontSize = `${size * 2}px`; }, normalSize);
    await page.evaluate(async () => { await document.fonts.ready; scrollTo(0, 0); await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); });
    expect(await page.locator("html").evaluate(node => parseFloat(getComputedStyle(node).fontSize))).toBe(normalSize * 2);
    await expect(page.locator("[data-chart-accent]")).toHaveCount(30);
    await expect(page.locator("[data-chart-family]")).toHaveCount(11);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    for (const mark of await page.locator('[data-chart-accent] [lang="he"]').all()) await expect(mark).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("trope-chart-phone-200-percent.png"), fullPage: true });
  }
  if (testInfo.project.name === "desktop") {
    await page.emulateMedia({ media: "print" });
    await expect(page.getByRole("button", { name: "Print chart", exact: true })).toBeHidden();
    await page.pdf({ path: testInfo.outputPath("trope-chart-letter.pdf"), format: "Letter", printBackground: true });
    await page.pdf({ path: testInfo.outputPath("trope-chart-a4.pdf"), format: "A4", printBackground: true });
    await page.pdf({ path: testInfo.outputPath("trope-chart-letter-no-background.pdf"), format: "Letter", printBackground: false });
    await testInfo.attach("print-geometry", { body: JSON.stringify(await page.evaluate(() => ({ width: innerWidth, height: document.documentElement.scrollHeight, fontReady: document.fonts.status }))), contentType: "application/json" });
  }
  expect([...origins]).toEqual(["http://127.0.0.1:3100"]);
});

test("printing waits for a successful Hebrew font load and rechecks before invoking print", async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route(`**${fontPath}`, async route => { await held; await route.continue(); });
  await page.addInitScript(() => { (window as unknown as Window & { chartPrintCalls: number }).chartPrintCalls = 0; window.print = () => { (window as unknown as Window & { chartPrintCalls: number }).chartPrintCalls++; }; });
  await page.goto("/trope-chart", { waitUntil: "domcontentloaded" });
  const print = page.getByRole("button", { name: "Print chart", exact: true });
  await expect(page.locator("[data-chart-font-state]")).toHaveAttribute("data-chart-font-state", "loading");
  await expect(print).toBeDisabled();
  expect(await page.evaluate(() => (window as unknown as Window & { chartPrintCalls: number }).chartPrintCalls)).toBe(0);
  release();
  await expect(print).toBeEnabled();
  expect(await page.evaluate(text => document.fonts.check('400 32px "CRC Noto Serif Hebrew"', text), proof)).toBe(true);
  await print.click();
  await expect.poll(() => page.evaluate(() => (window as unknown as Window & { chartPrintCalls: number }).chartPrintCalls)).toBe(1);
});

test("failed local font keeps printing unavailable and offers explicit reload", async ({ page }) => {
  await page.route(`**${fontPath}`, route => route.abort());
  await page.goto("/trope-chart");
  await expect(page.locator("[data-chart-font-state]")).toHaveAttribute("data-chart-font-state", "error");
  await expect(page.getByRole("button", { name: "Print chart", exact: true })).toBeDisabled();
  await expect(page.getByRole("status")).toHaveText("The Hebrew font could not be loaded. Reload the chart before printing.");
  await page.getByRole("button", { name: "Reload chart", exact: true }).focus();
  await expect(page.getByRole("button", { name: "Reload chart", exact: true })).toBeFocused();
});
