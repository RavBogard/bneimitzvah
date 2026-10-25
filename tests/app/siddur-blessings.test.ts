import { expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { SiddurBlessings } from "../../src/components/portal/public-reading/siddur-blessings";
import { DEFAULT_SIDDUR_URL } from "../../src/server/settings/validation";
import { blessingsLinks, HAFTARAH_BLESSINGS_PAGES, SIDDUR_BOOK, TORAH_BLESSINGS_PAGE } from "../../src/lib/siddur/pages";

// Page numbers and links only; no siddur text.
const origin = new URL(DEFAULT_SIDDUR_URL).origin;
const render = (props: { torah: boolean; haftarah: boolean; siddurUrl?: string }) => renderToStaticMarkup(createElement(SiddurBlessings, props));

it("keeps the book slug and blessing pages in one place", () => {
  expect([SIDDUR_BOOK, TORAH_BLESSINGS_PAGE, HAFTARAH_BLESSINGS_PAGES.first, HAFTARAH_BLESSINGS_PAGES.last]).toEqual(["legacy-beit-mitzvah", 22, 23, 24]);
  expect(blessingsLinks(DEFAULT_SIDDUR_URL)).toEqual({ torah: `${origin}/?book=legacy-beit-mitzvah&p=22`, haftarah: `${origin}/?book=legacy-beit-mitzvah&p=23` });
  expect(blessingsLinks("https://example.org/")).toEqual({ torah: null, haftarah: null });
});

it("shows the Torah and haftarah blessings lines with the approved wording for CRC, each linking to its first page", () => {
  const html = render({ torah: true, haftarah: true });
  expect(html).toContain(`href="${origin}/?book=legacy-beit-mitzvah&amp;p=22"`);
  expect(html).toContain(">Torah blessings: siddur page 22</a>");
  expect(html).toContain(`href="${origin}/?book=legacy-beit-mitzvah&amp;p=23"`);
  expect(html).toContain(">Haftarah blessings: siddur pages 23–24</a>");
  expect(html.match(/target="_blank"/g)).toHaveLength(2);
  expect(html.match(/rel="noopener noreferrer"/g)).toHaveLength(2);
  expect(html).not.toContain("!");
});

it("shows only the line for a reading the week has", () => {
  expect(render({ torah: true, haftarah: false })).not.toContain("Haftarah blessings");
  expect(render({ torah: false, haftarah: true })).not.toContain("Torah blessings");
  expect(render({ torah: false, haftarah: false })).toBe("");
});

it("shows nothing when the siddur address is not the recognised reader", () => {
  for (const siddurUrl of ["https://example.org/", "https://siddur.example.com/", "http://not-the-reader.test/", "not a url", ""]) expect(render({ torah: true, haftarah: true, siddurUrl })).toBe("");
});

it("keeps the siddur address out of src except in the settings validation", () => {
  const host = new URL(DEFAULT_SIDDUR_URL).hostname, found: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name), info = statSync(path);
      if (info.isDirectory()) walk(path);
      else if (/\.(ts|tsx|css|json|mjs)$/.test(name) && readFileSync(path, "utf8").includes(host)) found.push(relative("src", path).split(sep).join("/"));
    }
  };
  walk("src");
  expect(found).toEqual(["server/settings/validation.ts"]);
});

it("lays the two links out as a flex row, with no separator text between them", () => {
  const html = render({ torah: true, haftarah: true });
  expect(html).toContain('class="field-help siddur-blessings"');
  expect(html).not.toContain("·");
  expect(html).toMatch(/<\/a><a /);
});
