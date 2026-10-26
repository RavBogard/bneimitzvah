import { expect, test } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BetaMark } from "../../src/components/site/beta-mark";
import { FrontDoor } from "../../src/components/portal/front-door/front-door";
import { SiteBarView } from "../../src/components/site/site-bar";

const sourceFiles = (dir: string): string[] => readdirSync(dir).flatMap(name => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? sourceFiles(path) : path.endsWith(".tsx") ? [path] : [];
});

test("the Beta mark is plain text, not a link or a button, and says only Beta", () => {
  const markup = renderToStaticMarkup(createElement(BetaMark));
  expect(markup).toMatch(/^<span [^>]*data-beta-mark[^>]*>Beta<\/span>$/);
  expect(markup).not.toMatch(/<a\b|<button\b|role=|aria-/);
});

test("the site bar is the only header that names the site, and every mode carries one Beta mark beside the name", () => {
  const withBrand = sourceFiles("src").filter(path => /className="portal-brand"/.test(readFileSync(path, "utf8")));
  expect(withBrand.map(path => path.replace(/\\/g, "/"))).toEqual(["src/components/site/site-bar.tsx"]);
  expect(readFileSync(withBrand[0], "utf8")).toMatch(/className="portal-brand-group"><a className="portal-brand"[^\n]*?<\/a><BetaMark \/><\/div>/);
  for (const mode of ["site", "minimal"] as const) {
    const markup = renderToStaticMarkup(createElement(SiteBarView, { mode, signedIn: false, pathname: "/" }));
    expect(markup.match(/data-beta-mark/g), mode).toHaveLength(1);
  }
});

test("the front door header shows the mark once", () => {
  const markup = renderToStaticMarkup(createElement(FrontDoor, { account: null, children: null }));
  expect(markup.match(/data-beta-mark/g)).toHaveLength(1);
});
