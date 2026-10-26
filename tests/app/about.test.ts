import { expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import AboutPage from "../../src/app/about/page";
import { SiteFooter } from "../../src/components/site/site-footer";
import { INDEXABLE_PATHS } from "../../src/lib/site/indexing";
import { sitemapPaths } from "../../src/lib/site/sitemap";
import { REFERENCE_ATTRIBUTION } from "../../src/lib/reference-audio/contract";
import { studyEditions } from "../../src/components/portal/workspace/study/credits";
import { PLAN } from "../../src/lib/offline/copy";

const page = renderToStaticMarkup(createElement(AboutPage));
const text = page.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");

test("About is a reading page in site mode with its sections in order", () => {
  expect(page).toContain('data-site-bar="site"');
  expect(page.match(/<h1\b/g)).toHaveLength(1);
  const order = ["What CRC Torah is", "Who it is for", "Where the texts come from", "What the site records about you", "Installing it on a phone", "Central Reform Congregation</h2>"].map(heading => page.indexOf(heading));
  expect(order.every(index => index > -1)).toBe(true);
  expect([...order].sort((a, b) => a - b)).toEqual(order);
});

test("it says what the site is in three sentences and links the three doors", () => {
  const section = page.slice(page.indexOf('aria-labelledby="about-what"'), page.indexOf('aria-labelledby="about-who"')).replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'");
  expect(section.match(/[.!?](\s|$)/g)).toHaveLength(3);
  for (const [href, name] of [["/read", "This week's reading"], ["/learn", "Learn to lein"], ["/sign-in", "Beit Mitzvah"]]) expect(page).toContain(`<a href="${href}">${name.replace(/'/g, "&#x27;")}</a>`);
});

test("every credit is one the repository already records, and the privacy and install lines are the existing words", () => {
  for (const edition of [studyEditions.mam, studyEditions.jps2023]) for (const part of [edition.versionTitle, edition.creator, edition.license, edition.changes]) expect(text).toContain(part);
  for (const part of [REFERENCE_ATTRIBUTION.title, REFERENCE_ATTRIBUTION.creator, REFERENCE_ATTRIBUTION.license, REFERENCE_ATTRIBUTION.changes]) expect(text).toContain(part);
  for (const name of ["Taamey Frank CLM", "Stam Ashkenaz CLM", "Noto Serif Hebrew", "Bricolage Grotesque"]) expect(text).toContain(name);
  const mark = "The CRC Torah mark is Siona Benjamin's floor at Central Reform Congregation, used with the congregation's permission.";
  expect(text).toContain(mark);
  expect(text.indexOf(mark)).toBeLessThan(text.indexOf("Hebrew: Miqra according to the Masorah"));
  expect(page).not.toMatch(/<img|<picture|background-image/);
  expect(text).toContain("Your account and reading stay private.");
  for (const line of [PLAN.installHint("CRC Torah"), PLAN.iphoneSteps, PLAN.ipadSteps, PLAN.androidMenu]) expect(text).toContain(line);
  expect(page).toContain('href="https://www.centralreform.org/"');
});

test("plain prose: no exclamation points, emoji or curly apostrophes of our own, and no licensed text", () => {
  expect(text).not.toMatch(/!/);
  expect(text).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
  expect(text).not.toMatch(/In the beginning|Genesis \d/);
});

test("the footer links About after the congregation, and About is indexed and in the sitemap", () => {
  expect(renderToStaticMarkup(createElement(SiteFooter))).toContain("Central Reform Congregation · <a href=\"/about\">About</a>");
  expect(INDEXABLE_PATHS).toContain("/about");
  expect(sitemapPaths()).toContain("/about");
});
