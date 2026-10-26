import { expect, test } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BetaMark } from "../../src/components/site/beta-mark";
import { FrontDoor } from "../../src/components/portal/front-door/front-door";

const sourceFiles = (dir: string): string[] => readdirSync(dir).flatMap(name => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? sourceFiles(path) : path.endsWith(".tsx") ? [path] : [];
});

test("the Beta mark is plain text, not a link or a button, and says only Beta", () => {
  const markup = renderToStaticMarkup(createElement(BetaMark));
  expect(markup).toMatch(/^<span [^>]*data-beta-mark[^>]*>Beta<\/span>$/);
  expect(markup).not.toMatch(/<a\b|<button\b|role=|aria-/);
});

test("every site header that names the site carries one Beta mark beside the name", () => {
  const withBrand = sourceFiles("src").filter(path => /className="portal-brand"/.test(readFileSync(path, "utf8")));
  expect(withBrand.length).toBeGreaterThanOrEqual(10);
  for (const path of withBrand) {
    const text = readFileSync(path, "utf8");
    expect(text.match(/className="portal-brand"/g), path).toHaveLength(1);
    expect(text, path).toMatch(/className="portal-brand-group"><(?:a|Link) className="portal-brand"[^\n]*?<\/(?:a|Link)><BetaMark \/><\/div>/);
  }
});

test("the front door header shows the mark once", () => {
  const markup = renderToStaticMarkup(createElement(FrontDoor, { account: null, onSignIn: () => undefined, children: null }));
  expect(markup.match(/data-beta-mark/g)).toHaveLength(1);
});
