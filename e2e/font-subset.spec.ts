import { expect, test } from "@playwright/test";

// 1.8.2 P5: the interface face is the Latin WOFF2 subset of Bricolage Grotesque. On the built, unconfigured production server this
// checks, from 320 to 1440 px, that the browser loaded that file (and not the full TTF), that the face reports loaded, and that
// the rendered interface text is painted in it: Chromium's platform-font report for each text element lists the font that really
// drew the glyphs, so a character the subset dropped would show up here as a system fallback.
const WIDTHS = [320, 390, 768, 1024, 1440];
const PAGES = ["/", "/read", "/design-system"];
const FACE = "Bricolage Grotesque";

test.describe("Bricolage Grotesque subset", () => {
  for (const path of PAGES) {
    test(`${path} paints its interface text in the loaded subset at 320-1440 px`, async ({ page }, info) => {
      test.skip(info.project.name !== "desktop", "viewport widths are set by the test itself");
      const requested: string[] = [];
      page.on("request", request => { if (request.url().includes("/fonts/bricolage-grotesque/")) requested.push(new URL(request.url()).pathname); });
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("DOM.enable"); await cdp.send("CSS.enable");

      for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(path);
        await page.evaluate(() => document.fonts.load(`600 16px "Bricolage Grotesque"`));
        await page.evaluate(() => document.fonts.ready);
        const face = await page.evaluate(name => [...document.fonts].filter(font => font.family.replaceAll('"', "") === name).map(font => ({ status: font.status, weight: font.weight })), FACE);
        expect(face.length).toBe(1);
        expect(face[0].status).toBe("loaded");
        expect(face[0].weight).toBe("400 800");
        expect(await page.evaluate(name => document.fonts.check(`16px "${name}"`), FACE)).toBe(true);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);

        const { root } = await cdp.send("DOM.getDocument", { depth: 0 });
        const { nodeIds } = await cdp.send("DOM.querySelectorAll", { nodeId: root.nodeId, selector: "body h1, body h2, body h3, body p, body a, body button, body label, body li, body span" });
        const painted = new Map<string, number>();
        let sampled = 0;
        for (const nodeId of nodeIds.slice(0, 120)) {
          const handle = await cdp.send("DOM.resolveNode", { nodeId });
          const info = await cdp.send("Runtime.callFunctionOn", {
            objectId: handle.object.objectId!,
            functionDeclaration: `function () { const own = [...this.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join("").trim();
              return JSON.stringify({ own, hebrew: /[\\u0590-\\u05ff]/.test(own), visible: this.getClientRects().length > 0, family: getComputedStyle(this).fontFamily }); }`,
            returnByValue: true,
          });
          const node = JSON.parse(info.result.value as string) as { own: string; hebrew: boolean; visible: boolean; family: string };
          if (!node.own || node.hebrew || !node.visible || !node.family.startsWith(`"${FACE}"`)) continue;
          sampled += 1;
          const { fonts } = await cdp.send("CSS.getPlatformFontsForNode", { nodeId });
          for (const font of fonts) painted.set(font.familyName, (painted.get(font.familyName) ?? 0) + font.glyphCount);
        }
        expect(sampled, `${path} at ${width}px has Bricolage text to sample`).toBeGreaterThan(0);
        // The platform name is the name table family of the file ("Bricolage Grotesque 96pt ExtraBold"), not the CSS family.
        expect([...painted.keys()].filter(name => !name.startsWith(FACE)), `system fonts that painted Bricolage text on ${path} at ${width}px`).toEqual([]);
        expect(painted.size, `Bricolage painted something on ${path} at ${width}px`).toBeGreaterThan(0);
      }
      expect(requested.length).toBeGreaterThan(0);
      expect([...new Set(requested)]).toEqual(["/fonts/bricolage-grotesque/BricolageGrotesque-latin.woff2"]);
    });
  }
});
