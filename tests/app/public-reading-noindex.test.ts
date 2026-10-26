import { expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("../../src/server/public-site/names", () => ({ readPublicProductName: async () => "CRC Torah" }));
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import nextConfig from "../../next.config";
import robots from "../../src/app/robots";
import { noindexHeaderRule } from "../../src/lib/site/indexing";
import { metadata as rootMetadata } from "../../src/app/layout";
import ReadPage, { generateMetadata as readGenerateMetadata } from "../../src/app/read/page";
import { PortalEntry } from "../../src/components/portal/entry";

test("with indexing on (Daniel, 2026-10-26) the public reading is indexable while the header rule, root meta and robots.txt keep everything else noindex", async () => {
  const rules = await nextConfig.headers!();
  expect(rules.find(rule => rule.source === "/:path*")).toBeUndefined();
  const rule = rules.find(item => item.headers.some(header => header.key === "X-Robots-Tag"));
  expect(rule?.headers).toEqual([{ key: "X-Robots-Tag", value: "noindex, nofollow" }]);
  expect(rule?.source).toBe(noindexHeaderRule(true).source);
  expect(robots().rules).toEqual({ userAgent: "*", allow: ["/read", "/learn", "/trope-chart", "/about"], disallow: "/" });
  expect(rootMetadata.robots).toEqual({ index: false, follow: false });
  const readMetadata = await readGenerateMetadata();
  expect(readMetadata.title).toBe("This week’s reading | CRC Torah");
  expect(readMetadata.robots).toEqual({ index: true, follow: true });
  expect(readMetadata.referrer).toBe("no-referrer");
});

test("the public reading shell keeps Sign in prominent, names no person and carries exactly one Beta label in the header", async () => {
  const markup = renderToStaticMarkup(await ReadPage());
  expect(markup).toContain('href="/sign-in"');
  expect(markup).toContain("Loading the reading");
  expect(markup.match(/data-beta-mark/g)).toHaveLength(1);
  expect(markup).not.toMatch(/\balpha\b/i);
  const entry = renderToStaticMarkup(createElement(PortalEntry, {}));
  // /sign-in is the only form, and it no longer carries a button to the reader (the site bar has Read).
  expect(entry).toContain('href="/read"');
  expect(entry).not.toContain("Read this week’s Torah and haftarah");
  expect(renderToStaticMarkup(createElement(PortalEntry, { invitation: true }))).not.toContain('href="/read"');
});
