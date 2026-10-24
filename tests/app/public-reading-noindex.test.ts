import { expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("../../src/server/public-site/names", () => ({ readPublicProductName: async () => "CRC Torah" }));
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import nextConfig from "../../next.config";
import robots from "../../src/app/robots";
import { metadata as rootMetadata } from "../../src/app/layout";
import ReadPage, { generateMetadata as readGenerateMetadata } from "../../src/app/read/page";
import { PortalEntry } from "../../src/components/portal/entry";

test("while indexing is off every route says noindex: header, robots meta (root and public reading) and robots.txt", async () => {
  const rules = await nextConfig.headers!();
  const all = rules.find(rule => rule.source === "/:path*");
  expect(all?.headers).toEqual([{ key: "X-Robots-Tag", value: "noindex, nofollow" }]);
  expect(robots()).toEqual({ rules: { userAgent: "*", disallow: "/" } });
  expect(rootMetadata.robots).toEqual({ index: false, follow: false });
  const readMetadata = await readGenerateMetadata();
  expect(readMetadata.title).toBe("This week’s reading | CRC Torah");
  expect(readMetadata.robots).toMatchObject({ index: false, follow: false, googleBot: { index: false, follow: false } });
  expect(readMetadata.referrer).toBe("no-referrer");
});

test("the public reading shell keeps Sign in prominent, names no person and shows no alpha or beta label", async () => {
  const markup = renderToStaticMarkup(await ReadPage());
  expect(markup).toContain('href="/sign-in"');
  expect(markup).toContain("Loading the reading");
  expect(markup).not.toMatch(/\balpha\b|\bbeta\b/i);
  const entry = renderToStaticMarkup(createElement(PortalEntry, {}));
  expect(entry).toContain('href="/read"');
  expect(entry).toContain("Read this week’s Torah and haftarah");
  expect(renderToStaticMarkup(createElement(PortalEntry, { invitation: true }))).not.toContain('href="/read"');
});
