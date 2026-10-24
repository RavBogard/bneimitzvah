import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
// Next compiles header sources with its own copy of path-to-regexp, which ships no types.
// @ts-expect-error TS7016
import { pathToRegexp } from "next/dist/compiled/path-to-regexp";
import nextConfig from "../../next.config";
import robots from "../../src/app/robots";
import sitemap from "../../src/app/sitemap";
import { INDEXABLE_PATHS, noindexHeaderRule, NOINDEX_META, PUBLIC_INDEXING, publicRobots, robotsTxt } from "../../src/lib/site/indexing";
import { sitemapEntries, sitemapPaths } from "../../src/lib/site/sitemap";
import { CANONICAL_ORIGINS } from "../../src/lib/navigation/canonical";
import { namedReading } from "../../src/lib/readings/named-readings";
import { FALLBACK_PRODUCT_NAME, pageTitle } from "../../src/lib/site/product-name";
import { forgetPublicProductName, readPublicProductName } from "../../src/server/public-site/names";
import type { PublicRuntimeScope } from "../../src/server/http/public-reading";

afterEach(() => { forgetPublicProductName(); vi.doUnmock("../../src/server/public-site/names"); vi.doUnmock("../../src/lib/site/indexing"); vi.resetModules(); });

const ORIGIN = CANONICAL_ORIGINS[1];
const THE_THREE = ["/read", "/learn", "/trope-chart"];

test("the indexing switch ships off and names exactly the three public routes", () => {
  expect(PUBLIC_INDEXING).toBe(false);
  expect([...INDEXABLE_PATHS]).toEqual(THE_THREE);
});

test("off is the behaviour before this change, exactly: header on every path, meta, robots.txt without a sitemap", async () => {
  expect(noindexHeaderRule()).toEqual({ source: "/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] });
  expect(await nextConfig.headers!()).toContainEqual(noindexHeaderRule(false));
  expect(publicRobots()).toEqual({ index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } });
  expect(robotsTxt(ORIGIN, false)).toEqual({ rules: { userAgent: "*", disallow: "/" } });
  expect(robots()).toEqual({ rules: { userAgent: "*", disallow: "/" } });
});

test("on indexes only the three routes: the header skips exactly them, robots.txt allows them and names the sitemap", () => {
  const rule = noindexHeaderRule(true), match = pathToRegexp(rule.source);
  expect(rule.headers).toEqual([{ key: "X-Robots-Tag", value: "noindex, nofollow" }]);
  for (const path of [...THE_THREE, "/read/", "/learn/", "/trope-chart/"]) expect(match.test(path), path).toBe(false);
  for (const path of ["/", "/sign-in", "/account", "/workspace", "/workspace/students", "/connect", "/learn/about", "/learn/review", "/learn/noach", "/read/x", "/api/public/reading", "/api/auth/session", "/honoree/x", "/invitations/open", "/sitemap.xml", "/reading"]) expect(match.test(path), path).toBe(true);
  expect(publicRobots(true)).toEqual({ index: true, follow: true });
  expect(robotsTxt(ORIGIN, true)).toEqual({ rules: { userAgent: "*", allow: THE_THREE, disallow: "/" }, sitemap: `${ORIGIN}/sitemap.xml` });
  expect(robotsTxt(null, true).sitemap).toBeUndefined();
});

test("with the switch on, only /read, /learn and /trope-chart are indexable; learn lessons, about and review, and the root stay noindex", async () => {
  vi.resetModules();
  vi.doMock("../../src/server/public-site/names", () => ({ readPublicProductName: async () => "CRC Torah" }));
  vi.doMock("../../src/lib/site/indexing", async importOriginal => {
    const original = await importOriginal<typeof import("../../src/lib/site/indexing")>();
    return { ...original, publicRobots: () => original.publicRobots(true) };
  });
  const read = await import("../../src/app/read/page"), learn = await import("../../src/app/learn/page"), chart = await import("../../src/app/trope-chart/page");
  for (const page of [read, learn, chart]) expect((await page.generateMetadata()).robots).toEqual({ index: true, follow: true });
  const about = await import("../../src/app/learn/about/page"), review = await import("../../src/app/learn/review/page"), lesson = await import("../../src/app/learn/[lesson]/page");
  expect((await about.generateMetadata()).robots).toEqual(NOINDEX_META);
  expect((await review.generateMetadata()).robots).toEqual(NOINDEX_META);
  expect((await lesson.generateMetadata({ params: Promise.resolve({ lesson: "no-such-lesson" }) })).robots).toEqual(NOINDEX_META);
  expect((await import("../../src/app/layout")).metadata.robots).toEqual({ index: false, follow: false });
  expect((await import("../../src/app/connect/page")).metadata.robots).toEqual({ index: false, follow: false });
});

test("every public page title ends with the product name read through the reader, not a literal", async () => {
  vi.resetModules();
  vi.doMock("../../src/server/public-site/names", () => ({ readPublicProductName: async () => "Test Torah" }));
  const titles = [
    (await (await import("../../src/app/read/page")).generateMetadata()).title,
    (await (await import("../../src/app/learn/page")).generateMetadata()).title,
    (await (await import("../../src/app/trope-chart/page")).generateMetadata()).title,
    (await (await import("../../src/app/learn/about/page")).generateMetadata()).title,
    (await (await import("../../src/app/learn/review/page")).generateMetadata()).title,
  ];
  expect(titles).toEqual(["This week’s reading | Test Torah", "Learn to lein | Test Torah", "Trope chart | Test Torah", "About | Learn to lein | Test Torah", "Review | Learn to lein | Test Torah"]);
  const { COURSE } = await import("../../src/lib/learn/course");
  const lesson = COURSE.lessons[0];
  const meta = await (await import("../../src/app/learn/[lesson]/page")).generateMetadata({ params: Promise.resolve({ lesson: lesson.id }) });
  expect(meta.title).toBe(`${lesson.title} | Learn to lein | Test Torah`);
  expect(pageTitle("P", "A", "B")).toBe("A | B | P");
});

test("the product name comes from the public runtime, falls back without it, and a failure is not remembered", async () => {
  const asking: string[] = [];
  const scope = (name: string | (() => never)): PublicRuntimeScope => async action => {
    await action({ productName: async () => { asking.push("ask"); return typeof name === "string" ? name : name(); } } as never);
    return new Response(null);
  };
  expect(await readPublicProductName(scope(() => { throw new Error("database unavailable"); }))).toBe(FALLBACK_PRODUCT_NAME);
  expect(await readPublicProductName(scope("Cantor Torah"))).toBe("Cantor Torah");
  expect(await readPublicProductName(scope("Not asked again"))).toBe("Cantor Torah");
  expect(asking).toHaveLength(2);
});

test("the sitemap lists the three routes and the weekly parashot on the canonical origin, and nothing signed-in", () => {
  const paths = sitemapPaths();
  expect(paths.slice(0, 3)).toEqual(THE_THREE);
  expect(new Set(paths).size).toBe(paths.length);
  const readings = paths.slice(3);
  expect(readings.length).toBeGreaterThanOrEqual(50);
  for (const path of readings) {
    const slug = new URLSearchParams(path.split("?")[1]).get("reading")!;
    expect(path).toBe(`/read?reading=${encodeURIComponent(slug)}`);
    expect(namedReading(slug)?.group).toBe("parashah");
  }
  for (const path of paths) expect(path).not.toMatch(/saved=|workspace|account|sign-in|api\/|connect|honoree|invitations/);
  const entries = sitemapEntries(ORIGIN);
  expect(entries.every(entry => entry.url.startsWith(`${ORIGIN}/`))).toBe(true);
  expect(entries).toHaveLength(paths.length);
  expect(sitemapEntries(null)).toEqual([]);
});

test("the sitemap route resolves the canonical origin from BETTER_AUTH_URL and is empty outside production", () => {
  const keep = { ...process.env };
  try {
    Object.assign(process.env, { PORTAL_ENVIRONMENT: "production", PORTAL_DEPLOYMENT: "production", BETTER_AUTH_URL: CANONICAL_ORIGINS[0] });
    expect(sitemap()[0]).toMatchObject({ url: `${CANONICAL_ORIGINS[0]}/read` });
    expect(robots()).toEqual({ rules: { userAgent: "*", disallow: "/" } });
    process.env.PORTAL_DEPLOYMENT = "preview";
    expect(sitemap()).toEqual([]);
  } finally { for (const key of ["PORTAL_ENVIRONMENT", "PORTAL_DEPLOYMENT", "BETTER_AUTH_URL"]) { if (keep[key] === undefined) delete process.env[key]; else process.env[key] = keep[key]; } }
});

test("the share card is a 1200 by 630 png for each public page, with and without a Hebrew title", async () => {
  const { renderShareCard } = await import("../../src/server/public-site/share-card");
  for (const title of ["This week’s reading", "Trope chart", "פרשת נח"]) {
    const response = await renderShareCard(title, "CRC Torah");
    expect(response.headers.get("content-type")).toBe("image/png");
    const bytes = Buffer.from(await response.arrayBuffer());
    expect([...bytes.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual([1200, 630]);
  }
});
