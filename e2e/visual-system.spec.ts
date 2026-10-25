import { expect, test, type Page } from "@playwright/test";

// 1.9 N9: the visual system foundation, measured in the browser on the built, unconfigured production server.
// /design-system is the component page (fixture words only; a 404 anywhere but this server). Axe is not a dependency, so the
// checks axe would make are made directly, as P1 did: roles and names from the accessibility tree, contrast from computed
// colours, target size from boxes, and the Sheet's focus trap and focus return by pressing the keys.
const PATH = "/design-system";
async function open(page: Page, options: { dark?: boolean; reduced?: boolean; forced?: boolean } = {}) {
  await page.emulateMedia({ colorScheme: options.dark ? "dark" : "light", reducedMotion: options.reduced ? "reduce" : "no-preference", forcedColors: options.forced ? "active" : "none" });
  await page.goto(PATH);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Component page");
}
const active = (page: Page) => page.evaluate(() => { const node = document.activeElement as HTMLElement | null; return node ? { id: node.id, tag: node.tagName, text: (node.textContent ?? "").trim().slice(0, 40), inDialog: Boolean(node.closest("dialog")) } : null; });

/** Every visible text element's colour against the colour it is really painted on, as the browser computed them. */
async function contrastFailures(page: Page) {
  return page.evaluate(() => {
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d", { willReadFrequently: true })!;
    const rgba = (css: string) => { context.clearRect(0, 0, 1, 1); context.fillStyle = "#000"; context.fillStyle = css; context.fillRect(0, 0, 1, 1); const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data; return { r, g, b, a: a / 255 }; };
    const over = (top: ReturnType<typeof rgba>, base: ReturnType<typeof rgba>) => ({ r: top.r * top.a + base.r * (1 - top.a), g: top.g * top.a + base.g * (1 - top.a), b: top.b * top.a + base.b * (1 - top.a), a: 1 });
    const background = (node: Element | null): ReturnType<typeof rgba> => {
      if (!node) return rgba(getComputedStyle(document.documentElement).backgroundColor === "rgba(0, 0, 0, 0)" ? "#fff" : getComputedStyle(document.documentElement).backgroundColor);
      const own = rgba(getComputedStyle(node).backgroundColor);
      return own.a >= 1 ? own : over(own, background(node.parentElement));
    };
    const channel = (v: number) => { const u = v / 255; return u <= 0.03928 ? u / 12.92 : ((u + 0.055) / 1.055) ** 2.4; };
    const lum = (c: { r: number; g: number; b: number }) => 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
    const failures: string[] = [];
    for (const node of document.body.querySelectorAll("*")) {
      const own = [...node.childNodes].some(child => child.nodeType === 3 && (child.textContent ?? "").trim());
      if (!own || node.getClientRects().length === 0 || node.closest(".sr-only, [aria-hidden='true'], dialog:not([open])")) continue;
      if ((node as HTMLButtonElement).disabled || node.closest("button:disabled, [aria-disabled='true']")) continue;
      const style = getComputedStyle(node), bg = background(node), fg = over(rgba(style.color), bg);
      const hi = Math.max(lum(fg), lum(bg)), lo = Math.min(lum(fg), lum(bg)), ratio = (hi + 0.05) / (lo + 0.05);
      const size = parseFloat(style.fontSize), large = size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700);
      if (ratio < (large ? 3 : 4.5)) failures.push(`${(node.textContent ?? "").trim().slice(0, 30)} ${ratio.toFixed(2)}`);
    }
    return failures;
  });
}

for (const dark of [false, true]) {
  test.describe(dark ? "dark mode" : "light mode", () => {
    test("every visible word is readable (4.5:1, 3:1 for large text), with every sheet open too", async ({ page }) => {
      await open(page, { dark });
      expect(await contrastFailures(page)).toEqual([]);
      await page.getByRole("button", { name: "Open sheet" }).click();
      await expect(page.getByRole("dialog", { name: "Fixture sheet" })).toBeVisible();
      expect(await contrastFailures(page)).toEqual([]);
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "Remove primary" }).click();
      await expect(page.getByRole("dialog", { name: "Remove this item?" })).toBeVisible();
      expect(await contrastFailures(page)).toEqual([]);
    });

    test("every control draws the one focus ring (3px solid, 4px away): deep lake in light, marigold in dark", async ({ page }) => {
      await open(page, { dark });
      const ring = dark ? "rgb(247, 181, 0)" : "rgb(21, 70, 128)";
      const names = ["Header action", "Primary action", "Secondary action", "Quiet action", "Link as button", "Remove primary", "Remove secondary", "Remove quiet", "Open sheet", "Empty action"];
      for (const name of names) {
        await page.getByRole("button", { name }).or(page.getByRole("link", { name })).first().focus();
        await page.keyboard.press("Shift+Tab"); await page.keyboard.press("Tab"); // a keyboard arrival, so :focus-visible applies
        const style = await page.evaluate(() => { const s = getComputedStyle(document.activeElement!); return { width: s.outlineWidth, style: s.outlineStyle, color: s.outlineColor, offset: s.outlineOffset }; });
        expect(style, name).toEqual({ width: "3px", style: "solid", color: ring, offset: "4px" });
      }
      // A list row link and the segmented control wear the same ring.
      await page.getByRole("link", { name: /^Link row/ }).focus();
      await page.keyboard.press("Shift+Tab"); await page.keyboard.press("Tab");
      expect(await page.evaluate(() => { const s = getComputedStyle(document.activeElement!); return `${s.outlineWidth} ${s.outlineStyle} ${s.outlineColor} ${s.outlineOffset}`; })).toBe(`3px solid ${ring} 4px`);
      await page.getByRole("radio", { name: "First" }).focus();
      await page.keyboard.press("Shift+Tab"); await page.keyboard.press("Tab");
      expect(await page.getByRole("radio", { name: "First" }).evaluate(input => { const s = getComputedStyle(input.closest("label")!); return `${s.outlineWidth} ${s.outlineStyle} ${s.outlineColor} ${s.outlineOffset}`; })).toBe(`3px solid ${ring} 4px`);
    });
  });
}

test.describe("roles, names and structure (what axe would check)", () => {
  test("every control has a name, there is one h1 and no skipped heading level, and the landmarks are in place", async ({ page }) => {
    await open(page);
    const tree = await page.locator("body").ariaSnapshot();
    // A role the page uses for a control, with no name after it, is an unnamed control.
    expect(tree.split("\n").filter(line => /^\s*- (button|link|radio|textbox|radiogroup|dialog)(\s+\[[^\]]*\])*:?\s*$/.test(line))).toEqual([]);
    const outline = await page.evaluate(() => [...document.querySelectorAll("h1, h2, h3, h4, h5, h6")].map(node => Number(node.tagName[1])));
    expect(outline.filter(level => level === 1)).toHaveLength(1);
    outline.reduce((previous, level) => { expect(level - previous, "a heading level was skipped").toBeLessThanOrEqual(1); return level; }, 0);
    await expect(page.getByRole("main")).toHaveCount(1);
    await expect(page.getByRole("radiogroup", { name: "Fixture choice" })).toBeVisible();
    await expect(page.getByRole("list", { name: "Fixture rows" })).toBeVisible();
    // Names that mean the row: a row link reads its title, line and word together; its chevron is hidden.
    await expect(page.getByRole("link", { name: "Link row A second line Open" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Button row Presses the header action Needs you" })).toBeVisible();
    expect(await page.evaluate(() => { const ids = [...document.querySelectorAll("[id]")].map(node => node.id); return ids.length - new Set(ids).size; })).toBe(0);
    expect(await page.evaluate(() => document.querySelectorAll("li:not(ul > li)").length)).toBe(0);
  });

  test("a chip is always a word, and a tone is never colour alone", async ({ page }) => {
    await open(page);
    const chips = await page.locator("[data-tone]").evaluateAll(nodes => nodes.map(node => ({ tone: node.getAttribute("data-tone"), text: (node.textContent ?? "").trim() })));
    expect(chips.length).toBeGreaterThanOrEqual(8);
    for (const chip of chips) expect(chip.text.length, chip.tone ?? "").toBeGreaterThan(2);
  });
});

for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
  test.describe(`${viewport.width}px wide`, () => {
    test.use({ viewport });
    test("controls are at least 44 by 44 and nothing scrolls sideways", async ({ page }) => {
      await open(page);
      await page.getByRole("button", { name: "Open sheet" }).click();
      const small = await page.evaluate(() => {
        const found: string[] = [];
        for (const node of document.querySelectorAll<HTMLElement>("button, a[href], input, [role='button'], summary")) {
          if (node.getClientRects().length === 0 || (node as HTMLButtonElement).disabled || node.closest("p, .site-credit")) continue; // inline links inside a sentence are exempt (WCAG 2.5.8)
          const box = node.getBoundingClientRect();
          if (box.width < 44 - 0.5 || box.height < 44 - 0.5) found.push(`${(node.textContent || node.getAttribute("aria-label") || node.id).trim().slice(0, 30)} ${Math.round(box.width)}x${Math.round(box.height)}`);
        }
        return found;
      });
      expect(small).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    });

    test("the sheet rises from the bottom edge, at the phone's full width and at most 40rem wide on a laptop", async ({ page }) => {
      await open(page, { reduced: true });
      await page.getByRole("button", { name: "Open sheet" }).click();
      const dialog = page.getByRole("dialog", { name: "Fixture sheet" });
      await expect(dialog).toBeVisible();
      const box = (await dialog.boundingBox())!;
      expect(Math.round(box.y + box.height)).toBe(viewport.height);
      expect(Math.round(box.width)).toBe(Math.min(640, viewport.width));
      expect(box.height).toBeLessThanOrEqual(viewport.height * 0.9 + 1);
      expect(await page.evaluate(() => getComputedStyle(document.documentElement).overflow)).toBe("hidden");
      await page.keyboard.press("Escape");
      expect(await page.evaluate(() => getComputedStyle(document.documentElement).overflow)).toBe("visible");
    });
  });
}

test.describe("the type scale as rendered", () => {
  test.use({ viewport: { width: 1280, height: 800 } });
  test("six steps, three weights: 26 at 750 for the one h1, 17 body, 15 meta, 13 chips, 600 buttons", async ({ page }) => {
    await open(page);
    const font = (selector: string) => page.locator(selector).first().evaluate(node => { const s = getComputedStyle(node); return `${s.fontSize}/${s.fontWeight}`; });
    expect(await font("h1")).toBe("26px/750");
    expect(await font("main > section > p#confirmed")).toBe("17px/400");
    expect(await page.getByRole("button", { name: "Primary action" }).evaluate(node => { const s = getComputedStyle(node); return `${s.fontSize}/${s.fontWeight}`; })).toBe("17px/600");
    expect(await page.getByRole("link", { name: /^Link row/ }).locator("span").nth(2).evaluate(node => getComputedStyle(node).fontSize)).toBe("15px");
    expect(await page.locator("[data-tone='done']").first().evaluate(node => { const s = getComputedStyle(node); return `${s.fontSize}/${s.fontWeight}`; })).toBe("13px/600");
    expect(await page.evaluate(() => getComputedStyle(document.body).fontSize)).toBe("17px");
    await page.getByRole("button", { name: "Open sheet" }).click();
    expect(await page.getByRole("heading", { name: "Fixture sheet" }).evaluate(node => { const s = getComputedStyle(node); return `${s.fontSize}/${s.fontWeight}`; })).toBe("19px/750");
    // The radii: control 12, object 16 (list group), sheet 22 on its top corners, pill on chips and segments.
    await page.keyboard.press("Escape");
    expect(await page.getByRole("button", { name: "Primary action" }).evaluate(node => getComputedStyle(node).borderTopLeftRadius)).toBe("12px");
    expect(await page.getByRole("list", { name: "Fixture rows" }).evaluate(node => getComputedStyle(node).borderTopLeftRadius)).toBe("16px");
    expect(await page.locator("[data-tone='info']").first().evaluate(node => getComputedStyle(node).borderTopLeftRadius)).toBe("999px");
    await page.getByRole("button", { name: "Open sheet" }).click();
    expect(await page.getByRole("dialog", { name: "Fixture sheet" }).evaluate(node => { const s = getComputedStyle(node); return `${s.borderTopLeftRadius} ${s.borderBottomLeftRadius}`; })).toBe("22px 0px");
  });
});

test.describe("the Sheet", () => {
  test("opens with the heading focused and keeps focus inside, wrapping Tab in both directions", async ({ page }) => {
    await open(page);
    await page.getByRole("button", { name: "Open sheet" }).click();
    const dialog = page.getByRole("dialog", { name: "Fixture sheet" });
    await expect(dialog).toBeVisible();
    expect(await active(page)).toMatchObject({ tag: "H2", text: "Fixture sheet", inDialog: true });
    const stops = ["Close fixture sheet", "Fixture field", "Fixture link", "Cancel sheet", "Save sheet"];
    const seen: string[] = [];
    // Two full laps and a few more: focus must never leave the dialog, and the order must repeat.
    for (let press = 0; press < stops.length * 2 + 2; press++) {
      await page.keyboard.press("Tab");
      const now = await active(page);
      expect(now?.inDialog, `Tab ${press + 1} left the sheet (on ${now?.tag} ${now?.text})`).toBe(true);
      seen.push(await page.evaluate(() => { const node = document.activeElement as HTMLElement; return node.getAttribute("aria-label") ?? (node.id === "sheet-field" ? "Fixture field" : (node.textContent ?? "").trim()); }));
    }
    expect(seen.slice(0, stops.length)).toEqual(stops);
    expect(seen.slice(stops.length, stops.length * 2)).toEqual(stops);
    // Backwards from the first stop goes to the last; backwards from the heading does too.
    await page.getByRole("button", { name: "Close fixture sheet" }).focus();
    await page.keyboard.press("Shift+Tab");
    expect((await active(page))?.text).toBe("Save sheet");
    await page.getByRole("heading", { name: "Fixture sheet" }).focus();
    await page.keyboard.press("Shift+Tab");
    expect((await active(page))?.text).toBe("Save sheet");
    await page.keyboard.press("Tab");
    expect((await active(page))?.inDialog).toBe(true);
  });

  test("the page behind is inert while it is open", async ({ page }) => {
    await open(page);
    await page.getByRole("button", { name: "Open sheet" }).click();
    await expect(page.getByRole("dialog", { name: "Fixture sheet" })).toBeVisible();
    expect(await page.evaluate(() => document.querySelector("dialog[open]")!.matches(":modal"))).toBe(true);
    // A click on a control behind the sheet never reaches it: the trial click times out waiting for it to receive events.
    await expect(page.getByRole("button", { name: "Primary action" }).click({ trial: true, timeout: 1500 })).rejects.toThrow();
  });

  test("Escape, the close button, the backdrop and a swipe down each close it and return focus to the button that opened it", async ({ page }) => {
    await open(page, { reduced: true });
    const opener = page.getByRole("button", { name: "Open sheet" }), dialog = page.getByRole("dialog", { name: "Fixture sheet" });
    for (const how of ["escape", "close", "cancel", "backdrop", "swipe"] as const) {
      await opener.focus();
      await page.keyboard.press("Enter");
      await expect(dialog).toBeVisible();
      if (how === "escape") await page.keyboard.press("Escape");
      if (how === "close") await page.getByRole("button", { name: "Close fixture sheet" }).click();
      if (how === "cancel") await page.getByRole("button", { name: "Cancel sheet" }).click();
      if (how === "backdrop") await page.mouse.click(4, 4);
      if (how === "swipe") {
        const header = (await page.getByRole("heading", { name: "Fixture sheet" }).boundingBox())!;
        await page.mouse.move(header.x + header.width / 2, header.y + 4);
        await page.mouse.down();
        for (let step = 1; step <= 10; step++) await page.mouse.move(header.x + header.width / 2, header.y + 4 + step * 24);
        await page.mouse.up();
      }
      await expect(dialog, how).toBeHidden();
      expect(await active(page), how).toMatchObject({ id: "open-sheet" });
    }
  });

  test("a short swipe springs back and leaves it open", async ({ page }) => {
    await open(page, { reduced: true });
    await page.getByRole("button", { name: "Open sheet" }).click();
    const dialog = page.getByRole("dialog", { name: "Fixture sheet" }), header = (await page.getByRole("heading", { name: "Fixture sheet" }).boundingBox())!;
    await page.mouse.move(header.x + header.width / 2, header.y + 4);
    await page.mouse.down();
    await page.mouse.move(header.x + header.width / 2, header.y + 4 + 30, { steps: 1 });
    await page.waitForTimeout(400); // slow, so it is not a fling
    await page.mouse.up();
    await expect(dialog).toBeVisible();
    expect(await dialog.evaluate(node => (node as HTMLElement).style.getPropertyValue("--sheet-drag"))).toBe("");
  });

  test("focus returns to an element the owner names, even when it was not a button", async ({ page }) => {
    await open(page);
    const word = page.locator("#word-target");
    await word.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Word sheet" });
    await expect(dialog).toBeVisible();
    expect((await active(page))?.text).toBe("Word sheet");
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    expect(await active(page)).toMatchObject({ id: "word-target" });
    await page.keyboard.press("Enter");
    await page.getByRole("button", { name: "Done with word" }).click();
    await expect(dialog).toBeHidden();
    expect(await active(page)).toMatchObject({ id: "word-target" });
  });

  test("under reduced motion it appears without the rise", async ({ page }) => {
    await open(page, { reduced: true });
    await page.getByRole("button", { name: "Open sheet" }).click();
    expect(await page.getByRole("dialog", { name: "Fixture sheet" }).evaluate(node => getComputedStyle(node).animationName)).toBe("none");
    await page.keyboard.press("Escape");
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.getByRole("button", { name: "Open sheet" }).click();
    expect(await page.getByRole("dialog", { name: "Fixture sheet" }).evaluate(node => getComputedStyle(node).animationName)).not.toBe("none");
  });
});

test.describe("destructive Button", () => {
  test("opens a confirm sheet, focuses the safe choice, and acts only on the confirm action", async ({ page }) => {
    await open(page);
    const status = page.locator("#confirmed"), remove = page.getByRole("button", { name: "Remove primary" }), dialog = page.getByRole("dialog", { name: "Remove this item?" });
    await expect(remove).toHaveAttribute("aria-haspopup", "dialog");
    await remove.focus();
    await page.keyboard.press("Enter");
    await expect(dialog).toBeVisible();
    await expect(status).toContainText("Confirmed 0");
    expect((await active(page))?.text).toBe("Keep item"); // the safe choice has focus, so a stray Enter cannot confirm
    await page.keyboard.press("Enter");
    await expect(dialog).toBeHidden();
    await expect(status).toContainText("Confirmed 0");
    expect(await active(page)).toMatchObject({ text: "Remove primary" });
    // Escape cancels too.
    await remove.click();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(status).toContainText("Confirmed 0");
    // Only the confirm action acts.
    await remove.click();
    await page.getByRole("button", { name: "Remove item" }).click();
    await expect(dialog).toBeHidden();
    await expect(status).toContainText("Confirmed 1");
    expect(await active(page)).toMatchObject({ text: "Remove primary" });
    // The danger button is the danger fill with white type, and its word says what it does.
    await remove.click();
    const fill = await page.getByRole("button", { name: "Remove item" }).evaluate(node => { const s = getComputedStyle(node); return { bg: s.backgroundColor, color: s.color }; });
    expect(fill).toEqual({ bg: "rgb(180, 35, 24)", color: "rgb(255, 255, 255)" });
    await page.keyboard.press("Escape");
  });

  test("the confirm sheet cannot be dismissed, or cancelled, while the action is running", async ({ page }) => {
    await open(page);
    const dialog = page.getByRole("dialog", { name: "Remove the third item?" });
    await page.getByRole("button", { name: "Remove quiet" }).click();
    await expect(dialog).toBeVisible();
    await page.getByRole("button", { name: "Remove third" }).click();
    await expect(page.getByRole("button", { name: "Remove third" })).toHaveAttribute("aria-busy", "true");
    await expect(page.getByRole("button", { name: "Keep third" })).toBeDisabled();
    await page.keyboard.press("Escape");
    await page.mouse.click(4, 4);
    await expect(dialog).toBeVisible();
    await expect(dialog).toBeHidden();
    await expect(page.locator("#confirmed")).toContainText("Confirmed 1");
    expect(await active(page)).toMatchObject({ text: "Remove quiet" });
  });
});

test.describe("Segmented and the other small parts", () => {
  test("arrow keys move and choose; the selected segment is a lake pill with white type", async ({ page }) => {
    await open(page, { reduced: true });
    await page.getByRole("radio", { name: "First" }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.locator("#choice")).toHaveText("Chosen two.");
    await expect(page.getByRole("radio", { name: "Second" })).toBeChecked();
    const selected = await page.getByRole("radio", { name: "Second" }).evaluate(input => { const s = getComputedStyle(input.closest("label")!); return { bg: s.backgroundColor, color: s.color }; });
    expect(selected).toEqual({ bg: "rgb(29, 91, 166)", color: "rgb(255, 255, 255)" });
    await page.getByText("Third", { exact: true }).click();
    await expect(page.locator("#choice")).toHaveText("Chosen three.");
  });

  test("forced colours keep an edge on buttons and chips and a Highlight on the selected segment", async ({ page }) => {
    await open(page, { forced: true });
    expect(await page.getByRole("button", { name: "Primary action" }).evaluate(node => getComputedStyle(node).borderTopWidth)).toBe("1px");
    expect(await page.locator("[data-tone='done']").first().evaluate(node => getComputedStyle(node).borderTopWidth)).toBe("1px");
    const selected = await page.getByRole("radio", { name: "First" }).evaluate(input => getComputedStyle(input.closest("label")!).backgroundColor);
    const highlight = await page.evaluate(() => { const probe = document.createElement("div"); probe.style.backgroundColor = "Highlight"; document.body.append(probe); const color = getComputedStyle(probe).backgroundColor; probe.remove(); return color; });
    expect(selected).toBe(highlight);
  });

  test("the empty state is words and one action, and drew nothing", async ({ page }) => {
    await open(page);
    const empty = page.locator("section", { has: page.getByRole("heading", { name: "Nothing here yet" }) }).last();
    await expect(empty.getByRole("button", { name: "Empty action" })).toBeVisible();
    expect(await empty.locator("img, svg, canvas, picture").count()).toBe(0);
  });
});

test.describe("student pages keep their look: only the body size changed", () => {
  test.use({ viewport: { width: 1280, height: 800 } });
  for (const path of ["/", "/learn", "/trope-chart", "/offline"]) {
    test(`${path} has the 17px body, and no heading moves with it`, async ({ page }) => {
      await page.goto(path);
      await page.waitForLoadState("load");
      expect(await page.evaluate(() => getComputedStyle(document.body).fontSize)).toBe("17px");
      // Headings are set in rem or clamp, so the body size must not move them. Put the body back to 16px and compare.
      const sizes = () => page.evaluate(() => [...document.querySelectorAll("h1, h2, h3")].map(node => getComputedStyle(node).fontSize));
      const now = await sizes();
      await page.addStyleTag({ content: "body { font-size: 1rem !important; }" });
      expect(await sizes()).toEqual(now);
    });
  }
});
