import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Button, ButtonLink, Chip, EmptyState, List, ListRow, PageHeader, Segmented, Sheet } from "../../src/components/ui";
import { Gallery } from "../../src/app/design-system/gallery";

// 1.9 N9: the visual system foundation. Static checks on the tokens and the components' markup; the browser-measured checks
// (focus trap, focus return, contrast as rendered, target size) are in e2e/visual-system.spec.ts.
const css = readFileSync("src/app/globals.css", "utf8"), module = readFileSync("src/components/ui/ui.module.css", "utf8");
const h = createElement;
const html = (node: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(node);

// The :root block and the dark-scheme :root block, as variable maps.
function variables(block: string) { return new Map([...block.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(match => [match[1], match[2].trim()] as const)); }
const rootBlock = css.match(/:root\s*\{([\s\S]*?)\n\}/)![1], darkBlock = css.match(/@media \(prefers-color-scheme: dark\)\s*\{\s*:root\s*\{([\s\S]*?)\n  \}/)![1];
const light = variables(rootBlock), dark = new Map([...light, ...variables(darkBlock)]);
function resolve(map: Map<string, string>, name: string): string {
  const value = map.get(name);
  if (value === undefined) throw new Error(`no token ${name}`);
  const ref = value.match(/^var\((--[\w-]+)\)$/);
  return ref ? resolve(map, ref[1]) : value;
}
const channel = (value: number) => { const unit = value / 255; return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4; };
function luminance(hex: string) {
  const full = hex.length === 4 ? `#${[...hex.slice(1)].map(c => c + c).join("")}` : hex, n = parseInt(full.slice(1), 16);
  return 0.2126 * channel(n >> 16) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}
function contrast(a: string, b: string) { const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (high + 0.05) / (low + 0.05); }

describe("the tokens", () => {
  it("has the six type steps at 40, 26, 19, 17, 15 and 13 pixels, and a 17 pixel body", () => {
    const px = (name: string) => parseFloat(resolve(light, name)) * 16;
    expect(["--text-display", "--text-title", "--text-heading", "--text-body", "--text-callout", "--text-caption"].map(px)).toEqual([40, 26, 19, 17, 15, 13]);
    expect(css).toMatch(/\nbody \{[^}]*font-size: var\(--text-body\)/);
  });
  it("has three weights, 400, 600 and 750, and a radius for each object", () => {
    expect(["--weight-regular", "--weight-semibold", "--weight-strong"].map(name => resolve(light, name))).toEqual(["400", "600", "750"]);
    expect(["--radius-control", "--radius-object", "--radius-sheet", "--radius-dock", "--radius-pill"].map(name => resolve(light, name))).toEqual(["12px", "16px", "22px", "22px", "999px"]);
  });
  it("has one focus ring, and the global rule is the only place it is drawn", () => {
    expect(resolve(light, "--focus-ring")).toBe("3px solid var(--color-focus)");
    expect(css).toMatch(/:focus-visible \{ outline: var\(--focus-ring\); outline-offset: var\(--focus-offset\); \}/);
    expect(resolve(light, "--color-focus")).toBe("#154680");
    expect(resolve(dark, "--color-focus")).toBe("#f7b500");
    // The component styles never draw their own ring: every outline there is the token.
    for (const [, value] of module.matchAll(/outline:\s*([^;}]+)[;}]/g)) expect(["none", "var(--focus-ring)"]).toContain(value.trim());
    for (const [, value] of module.matchAll(/outline-offset:\s*([^;}]+)[;}]/g)) expect(value.trim()).toBe("var(--focus-offset)");
  });
  it("has the four staff tones and keeps each readable (4.5:1) as text on the surface and the canvas, in both themes", () => {
    for (const [theme, map] of [["light", light], ["dark", dark]] as const) {
      for (const tone of ["--done-ink", "--info-ink", "--danger-ink"]) {
        for (const ground of ["--color-surface", "--color-canvas"]) expect(contrast(resolve(map, tone), resolve(map, ground)), `${theme} ${tone} on ${ground}`).toBeGreaterThanOrEqual(4.5);
      }
      // Attention is a marigold fill behind ink (marigold is never text), and a danger fill carries white type.
      expect(contrast(resolve(map, "--attention-ink"), resolve(map, "--attention-fill")), `${theme} attention`).toBeGreaterThanOrEqual(4.5);
      expect(contrast("#ffffff", resolve(map, "--danger-fill")), `${theme} danger fill`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(resolve(map, "--danger-fill"), resolve(map, "--color-canvas")), `${theme} danger fill edge`).toBeGreaterThanOrEqual(3);
      expect(contrast("#ffffff", resolve(map, "--color-action-fill")), `${theme} primary`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(resolve(map, "--color-ink"), resolve(map, "--color-surface")), `${theme} ink`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(resolve(map, "--color-muted"), resolve(map, "--color-surface")), `${theme} muted`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(resolve(map, "--color-focus"), resolve(map, "--color-canvas")), `${theme} ring`).toBeGreaterThanOrEqual(3);
    }
  });
});

describe("the component styles", () => {
  it("spend the tokens: no literal size, weight, radius or colour of their own", () => {
    expect(module).not.toMatch(/font-size:\s*(?!var\()[\d.]+(px|rem|em)/);
    expect(module).not.toMatch(/font-weight:\s*\d/);
    expect(module).not.toMatch(/border-radius:\s*[\d.]+px/);
    // The only literal colours are white on a fill, black in the danger hover mix, the backdrop and the forced-colours system names.
    const colours = [...module.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map(match => match[0].toLowerCase());
    expect(new Set(colours)).toEqual(new Set(["#fff", "#000"]));
  });
  it("is flat: no blur or offset shadow and no gradient", () => {
    for (const [, value] of module.matchAll(/box-shadow:\s*([^;]+);/g)) expect(value.trim()).toMatch(/^(none|inset 0 0 0 1px var\(--[\w-]+\))$/);
    expect(module).not.toMatch(/gradient|blur\(|drop-shadow|text-shadow/);
  });
  it("keeps every control at least 44 pixels tall, and snaps its motion under reduced motion", () => {
    const heights = (selector: string) => { const rule = module.match(new RegExp(`\\n${selector.replace(".", "\\.")} \\{([^}]*)\\}`))?.[1] ?? ""; return parseFloat(rule.match(/min-height:\s*(\d+)px/)?.[1] ?? "0"); };
    for (const control of [".button", ".quiet", ".close", ".row", ".segment"]) {
      const own = module.match(new RegExp(`\\n\\${control} \\{([^}]*)\\}`))?.[1] ?? "";
      const tall = /min-height:\s*(\d+)px/.exec(own), fixed = /height:\s*(\d+)px/.exec(own);
      expect(Number(tall?.[1] ?? fixed?.[1] ?? 0), control).toBeGreaterThanOrEqual(44);
    }
    expect(heights(".button")).toBeGreaterThanOrEqual(44);
    expect(module).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*\.sheet\[open\] \{ animation: none; \}/);
    expect(module).toMatch(/@media \(forced-colors: active\)/);
  });
});

describe("the components, as markup", () => {
  it("Button is a real button of type button, in three variants, and a link variant is a real link", () => {
    for (const variant of ["primary", "secondary", "quiet"] as const) expect(html(h(Button, { variant }, "Label"))).toMatch(/^<button type="button" class="[^"]*">Label<\/button>$/);
    expect(html(h(Button, { type: "submit" }, "Send"))).toContain('type="submit"');
    expect(html(h(ButtonLink, { href: "/somewhere", variant: "primary" }, "Go"))).toMatch(/^<a class="[^"]*" href="\/somewhere">Go<\/a>$/);
  });
  it("a destructive Button announces a dialog and keeps its confirm words out of the page until it is asked", () => {
    const markup = html(h(Button, { destructive: true, confirm: { title: "Remove it?", confirmLabel: "Remove", cancelLabel: "Keep", onConfirm: () => {} } }, "Remove thing"));
    expect(markup).toContain('aria-haspopup="dialog"');
    expect(markup).toContain(">Remove thing</button>");
    expect(markup).toMatch(/<dialog [^>]*aria-labelledby="[^"]+"/);
    expect(markup).not.toMatch(/<dialog[^>]* open/);
    expect(markup).not.toContain(">Remove</button>");
  });
  it("Sheet is a labelled dialog whose heading names it, with an optional close button that has a name", () => {
    const closed = html(h(Sheet, { open: false, onClose: () => {}, title: "Sheet title", closeLabel: "Close it", children: "Paragraph words" }));
    const labelled = closed.match(/aria-labelledby="([^"]+)"/)![1];
    expect(closed).toContain(`<h2 id="${labelled}"`);
    expect(closed).toContain('aria-label="Close it"');
    expect(closed).toContain('aria-hidden="true"');
    expect(closed).not.toContain("Paragraph words");
    expect(html(h(Sheet, { open: false, onClose: () => {}, title: "No close button", children: "Body" }))).not.toContain("<button");
  });
  it("ListRow is a link, a button or plain text, and its decoration is hidden from assistive technology", () => {
    const rows = html(h(List, { label: "Rows", children: [
      h(ListRow, { key: 1, title: "Link", meta: "m", href: "/x", trailing: h(Chip, { tone: "info", children: "Open" }) }),
      h(ListRow, { key: 2, title: "Button", onClick: () => {} }),
      h(ListRow, { key: 3, title: "Plain" })] }));
    expect(rows).toMatch(/^<ul class="[^"]*" aria-label="Rows">/);
    expect(rows).toMatch(/<li class="[^"]*"><a class="[^"]*" href="\/x"/);
    expect(rows).toMatch(/<li class="[^"]*"><button type="button" class="[^"]*"><span/);
    expect(rows).toMatch(/<li class="[^"]*"><div class="[^"]*"><span/);
    expect(rows.match(/<svg[^>]*aria-hidden="true"/g)).toHaveLength(2);
  });
  it("PageHeader has exactly one h1; EmptyState takes the level the page needs", () => {
    const header = html(h(PageHeader, { title: "Students", description: "All of them", actions: h(Button, { variant: "primary" }, "Add") }));
    expect(header.match(/<h1/g)).toHaveLength(1);
    expect(header).toContain(">Students</h1>");
    for (const level of [2, 3, 4] as const) expect(html(h(EmptyState, { title: "Nothing", level }))).toContain(`<h${level} `);
    expect(html(h(EmptyState, { title: "Nothing" }))).toContain("<h2 ");
  });
  it("Segmented is a named radio group with one checked radio", () => {
    const markup = html(h(Segmented, { label: "Reading", options: [{ value: "a", label: "A" }, { value: "b", label: "B" }], value: "b", onChange: () => {} }));
    expect(markup).toContain('role="radiogroup" aria-label="Reading"');
    expect(markup.match(/type="radio"/g)).toHaveLength(2);
    expect(markup.match(/checked=""/g)).toHaveLength(1);
    expect(markup).toMatch(/<input type="radio"[^>]*value="b"[^>]*checked=""|<input type="radio"[^>]*checked=""[^>]*value="b"/);
  });
  it("Chip prints its word for every tone, and carries the tone as data", () => {
    for (const tone of ["neutral", "attention", "done", "info", "danger"] as const) expect(html(h(Chip, { tone, children: `Word ${tone}` }))).toMatch(new RegExp(`data-tone="${tone}">Word ${tone}</span>$`));
  });
});

describe("the component page", () => {
  const markup = html(h(Gallery));
  const text = markup.replace(/<[^>]+>/g, " ");
  it("has one h1, a main landmark and no emoji, exclamation mark or tally", () => {
    expect(markup.match(/<h1/g)).toHaveLength(1);
    expect(markup).toContain("<main");
    expect(text).not.toMatch(/!/);
    expect(markup).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B50}]/u);
  });
  it("is a 404 unless the browser tests switch it on", () => {
    const source = readFileSync("src/app/design-system/page.tsx", "utf8");
    expect(source).toContain('process.env.CRC_COMPONENT_PAGE !== "1") notFound()');
    expect(source).toContain('export const dynamic = "force-dynamic"');
    expect(readFileSync("tests/helpers/builtE2eServer.mjs", "utf8")).toContain('CRC_COMPONENT_PAGE: "1"');
  });
});
