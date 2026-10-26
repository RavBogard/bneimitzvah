import { expect, test } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { currentSiteLink, SiteBarView } from "../../src/components/site/site-bar";
import { SiteFooter } from "../../src/components/site/site-footer";

const bar = (props: Partial<Parameters<typeof SiteBarView>[0]> = {}) => renderToStaticMarkup(createElement(SiteBarView, { signedIn: false, pathname: "/", ...props }));
const links = (markup: string) => [...markup.matchAll(/<a\b[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/g)].map(match => [match[1], match[2].replace(/<[^>]+>/g, "")] as const);

test("site mode: the brand, the Beta mark, Read, Learn and Sign in, with Sign in going to /sign-in", () => {
  const markup = bar();
  expect(markup.match(/data-beta-mark/g)).toHaveLength(1);
  expect(markup).toContain('data-site-bar="site"');
  expect(links(markup)).toEqual([["/", "CRC Torah"], ["/read", "Read"], ["/learn", "Learn"], ["/sign-in", "Sign in"]]);
  expect(markup).not.toContain("Account");
});

test("the brand link carries Siona Benjamin's disc at 28px with an empty alt, before the name, in both modes, and is still named CRC Torah", () => {
  for (const mode of ["site", "minimal"] as const) {
    const markup = bar({ mode });
    const brand = /<a class="portal-brand"[^>]*>(.*?)<\/a>/s.exec(markup)![1];
    expect(brand, mode).toMatch(/^<img [^>]*src="\/brand\/mural-64\.webp"[^>]*srcSet="\/brand\/mural-64\.webp 1x, \/brand\/mural-128\.webp 2x"[^>]*\/>CRC Torah$/);
    expect(brand, mode).toContain('alt=""');
    expect(brand, mode).toContain('width="28"');
    expect(brand, mode).toContain('height="28"');
    expect(links(markup)[0], mode).toEqual(["/", "CRC Torah"]);
  }
});

test("minimal mode: the brand and Beta only, no links beside the brand", () => {
  const markup = bar({ mode: "minimal" });
  expect(markup).toContain('data-site-bar="minimal"');
  expect(markup).not.toContain("<nav");
  expect(links(markup)).toEqual([["/", "CRC Torah"]]);
  expect(markup.match(/data-beta-mark/g)).toHaveLength(1);
});

test("signed in, the right side is the account control, named Account, in the same reserved slot Sign in uses", () => {
  const slot = (markup: string) => /<span class="site-bar-end"[^>]*>(.*?)<\/span><\/nav>/s.exec(markup);
  const signedIn = bar({ signedIn: true }), signedOut = bar();
  expect(links(signedIn)).toEqual([["/", "CRC Torah"], ["/read", "Read"], ["/learn", "Learn"], ["/account", "Account"]]);
  expect(signedIn).toMatch(/<svg[^>]*aria-hidden="true"/);
  expect(signedIn).not.toContain("Sign in");
  // Both states live inside the one slot that holds the width; under 480px the label is visually hidden, never removed.
  expect(slot(signedIn)?.[1]).toContain("site-bar-account-text");
  expect(slot(signedOut)?.[1]).toContain("/sign-in");
  const css = readFileSync(join(process.cwd(), "src", "app", "globals.css"), "utf8");
  expect(css).toMatch(/\.site-bar-end \{[^}]*min-width: 7\.5rem/);
  expect(css).toMatch(/@media \(max-width: 479\.98px\)[^@]*\.site-bar-account-text \{ position: absolute/);
  // Beta hides below the width where disc, name, Beta, Read, Learn and the icon-only account fit on one line (368px measured; 375px set).
  expect(css).toMatch(/@media \(max-width: 374\.98px\) \{ \.site-bar \.site-beta \{ display: none; \} \}/);
  expect(css).not.toMatch(/\.site-bar \.portal-brand[^}]*display: none|\.site-bar-mark[^}]*display: none/);
  expect(css).toMatch(/\.site-bar \{ flex-wrap: nowrap/);
});

test("the current link: Read on /read*, Learn on /learn* and the trope chart, Account on /account, nothing elsewhere", () => {
  const cases: [string, string | null][] = [["/read", "read"], ["/read/print", "read"], ["/learn", "learn"], ["/learn/review", "learn"], ["/trope-chart", "learn"], ["/account", "account"],
    ["/", null], ["/sign-in", null], ["/workspace/student", null], ["/reading-list", null], ["/learned", null]];
  for (const [path, expected] of cases) expect(currentSiteLink(path), path).toBe(expected);
  expect(currentSiteLink(null)).toBeNull();
  const markup = bar({ signedIn: true, pathname: "/learn/review" });
  expect(markup.match(/aria-current="page"/g)).toHaveLength(1);
  expect(markup).toMatch(/aria-current="page"[^>]*>(?:<[^>]+>)*Learn</);
  expect(bar({ pathname: "/" })).not.toContain("aria-current");
  expect(readFileSync(join(process.cwd(), "src", "app", "globals.css"), "utf8")).toMatch(/\[aria-current="page"\] \.site-bar-text \{ text-decoration: underline; text-decoration-thickness: 2px; text-underline-offset: 4px/);
});

test("the bar's wording is the approved wording and nothing else", () => {
  expect(links(bar({ signedIn: true })).map(([, text]) => text)).toEqual(["CRC Torah", "Read", "Learn", "Account"]);
  expect(links(bar()).map(([, text]) => text)).toEqual(["CRC Torah", "Read", "Learn", "Sign in"]);
  expect(renderToStaticMarkup(createElement(SiteFooter))).toBe('<footer class="site-footer"><p>Central Reform Congregation · Your account and reading stay private.</p><p>A project of <a href="https://danielbogard.com" target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">Rabbi Daniel Bogard</a></p></footer>');
});

const sourceFiles = (dir: string): string[] => readdirSync(dir).flatMap(name => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? sourceFiles(path) : path.endsWith(".tsx") ? [path] : [];
});

test("no page draws its own header row or footer: the site bar and the one site footer are the only ones", () => {
  for (const path of sourceFiles("src")) {
    if (path.endsWith("site-bar.tsx") || path.endsWith("site-footer.tsx")) continue;
    const text = readFileSync(path, "utf8");
    expect(text, path).not.toMatch(/className="portal-brand"|className=\{?["`][^"`]*portal-header|portal-footer|site-credit|app-bar-account|app-bar-learn/);
  }
});
