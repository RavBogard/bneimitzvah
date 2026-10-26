import { expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { createHttpDispatcher } from "../../src/server/http/dispatch";
import { publicReadingRouteMethods } from "../../src/server/http/public-reading";
import { isPageViewPath } from "../../src/server/http/page-views";
import { portalRoutesFixture } from "./portal-routes-fixture";

/**
 * 2.0 F1, the second check: nothing private, signed-in, tenant-specific or no-store gains a public cache header.
 *
 * The public text, commentary and word routes ask the browser and the CDN to keep their answers, because the platform
 * firewall counts every request that reaches the edge (src/server/http/public-reading.ts, KEPT). That is only safe for
 * routes whose answer is the same for every caller. Guards that keep it so:
 *   1. a source scan: a positive caching directive may appear only in the files below, each a deliberately public surface,
 *      and no other file may set a cache header or opt a page into Next's static caching at all without being listed here;
 *   2. every other API path in the source, run through the real dispatcher (runtime down, and the real portal runtime
 *      signed in and signed out), answers without one, and is not on the public allowlist.
 */
const ROOT = join(__dirname, "..", "..");
const walk = (dir: string): string[] => readdirSync(dir).flatMap(name => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? walk(path) : /\.(?:ts|tsx|js|mjs|cjs|mts)$/.test(name) ? [path] : [];
});
const rel = (path: string) => relative(ROOT, path).replaceAll("\\", "/");
const source = () => [...walk(join(ROOT, "src")), ...["next.config.ts", "next.config.js", "next.config.mjs"].map(name => join(ROOT, name)).filter(path => { try { return statSync(path).isFile(); } catch { return false; } })];
/**
 * A directive that lets a shared cache or a browser keep a response for anyone: any s-maxage or stale-while-revalidate, a max-age
 * above zero (a digit, or an interpolated number), or `public` beside max-age or immutable in one string, in either order, any case.
 */
const POSITIVE = /s-maxage|stale-while-revalidate|max-age\s*=\s*(?:[1-9]|\$\{)|["'`][^"'`\n]*\bpublic\b[^"'`\n]*(?:max-age|immutable)|["'`][^"'`\n]*(?:max-age|immutable)[^"'`\n]*\bpublic\b/i;
/** Cookie lines carry a Max-Age too (a session or a binding cookie): not a cache directive, and never on a response a cache may keep. */
const isCookieLine = (line: string) => /HttpOnly|SameSite|;\s*Path=/i.test(line);
const positiveLines = (text: string) => text.split(/\r?\n/).filter(line => !isCookieLine(line) && POSITIVE.test(line));
const MENTIONS_CACHE_HEADER = /cache-control|surrogate-control/i;
/** Next's own static caching, which emits s-maxage without the string appearing in source. */
const STATIC_CACHING = /export\s+const\s+revalidate\b|dynamic\s*=\s*["']force-static|generateStaticParams|["']use cache["']|\brevalidate\s*:/;

/** The only places allowed to say it, and why each is the same for every caller. */
const PUBLIC_SURFACES: Readonly<Record<string, string>> = {
  "src/server/http/public-reading.ts": "the /api/public/ allowlist: GET only, no cookie or Authorization read, CRC host only, the same answer for everyone",
  "src/server/reference-audio/public-short.ts": "content-addressed PocketTorah clips under /reference-audio/short-v1",
  "src/server/http/mcp.ts": "OAuth discovery metadata only (publicMetadata): the same document for everyone, no data; the token, consent and MCP routes in the same file stay private",
  "src/app/sw.js/route.ts": "the service worker file",
};
/** Files that name a cache header only to forbid caching (privateHeaders, no-store); a positive directive here still fails the first test. */
const NO_STORE_ONLY = new Set(["src/server/http/responses.ts", "src/server/http/page-views.ts", "src/server/http/reference-review.ts", "src/lib/navigation/canonical.ts"]);
/** Static public pages (the signed-out reader, print sheet, Learn course and trope chart, and their share images): no cookie, no session, built once. */
const STATIC_PUBLIC = (file: string) => ["about", "learn", "read", "print", "trope-chart"].some(dir => file.startsWith(`src/app/${dir}/`)) || /^src\/app\/sw\.js\//.test(file);

test("a positive cache directive appears only in the deliberately public surfaces, and in mcp.ts only on the discovery metadata", () => {
  const positive = new Set<string>(), named = new Set<string>(), staticCached = new Set<string>();
  for (const file of source()) {
    const text = readFileSync(file, "utf8"), name = rel(file);
    if (positiveLines(text).length) positive.add(name);
    if (MENTIONS_CACHE_HEADER.test(text)) named.add(name);
    if (STATIC_CACHING.test(text)) staticCached.add(name);
  }
  expect([...positive].sort()).toEqual(Object.keys(PUBLIC_SURFACES).sort());
  // A new file that sets a cache header at all, or opts a page into static caching, is reviewed here, not waved through.
  expect([...named].filter(name => !(name in PUBLIC_SURFACES) && !NO_STORE_ONLY.has(name) && !STATIC_PUBLIC(name))).toEqual([]);
  expect([...staticCached].filter(name => !STATIC_PUBLIC(name))).toEqual([]);
  // mcp.ts also serves the token, registration, revocation, consent and MCP routes: only the metadata helper may carry a directive.
  const lines = positiveLines(readFileSync(join(ROOT, "src/server/http/mcp.ts"), "utf8"));
  expect(lines.length).toBe(1);
  expect(lines[0]).toContain("publicMetadata");
  // vercel.json holds crons only: no headers or routes block that could mark a private route cacheable.
  const vercel = JSON.parse(readFileSync(join(ROOT, "vercel.json"), "utf8"));
  expect(vercel.headers).toBeUndefined(); expect(vercel.routes).toBeUndefined(); expect(vercel.rewrites).toBeUndefined();
});

test("the scan's pattern catches the ways a private route could be marked public", () => {
  for (const bad of ["max-age=300, public", "Public, Max-Age=1", "`public, max-age=${n}`", "'immutable, public'", "stale-while-revalidate=5", "s-maxage=1", "max-age = 60"]) expect(POSITIVE.test(bad), bad).toBe(true);
  for (const fine of ["private, no-store", "no-store", "max-age=0", "public, tenant, review"]) expect(POSITIVE.test(fine), fine).toBe(false);
});

/** Every /api/ path literal outside the public namespace, found in the server's route files. */
function privatePaths(): string[] {
  const paths = new Set<string>();
  for (const file of walk(join(ROOT, "src", "server", "http"))) {
    for (const match of readFileSync(file, "utf8").matchAll(/["'`](\/api\/[A-Za-z0-9_\-/]+)["'`]/g)) paths.add(match[1].replace(/\/$/, ""));
  }
  return [...paths].filter(path => !path.startsWith("/api/public") && path !== "/api").sort();
}
const HEADERS = ["cache-control", "vercel-cdn-cache-control", "cdn-cache-control", "surrogate-control"];
function expectNotShared(response: Response, label: string) {
  for (const header of HEADERS) expect(response.headers.get(header) ?? "", `${label} ${header}`).not.toMatch(POSITIVE);
  expect(response.headers.get("cache-control") ?? "", label).not.toMatch(/\bpublic\b/i);
}

test("no private API path is on the public allowlist, and every one answers without a public cache directive", async () => {
  const paths = privatePaths();
  // The scan must really find the private surface (students, admin, auth, MCP, saved, progress, offline...), not an empty list.
  expect(paths.length).toBeGreaterThan(40);
  for (const needle of ["/api/auth", "/api/admin", "/api/saved", "/api/learn/progress", "/api/oauth/token"]) expect(paths.some(path => path.startsWith(needle)), needle).toBe(true);
  // The runtime is down: every handler that reaches it fails closed, and every one that does not answers on its own.
  const dispatch = createHttpDispatcher(async () => { throw new Error("synthetic runtime failure"); }, async () => { throw new Error("synthetic public failure"); }, async () => { throw new Error("synthetic view failure"); });
  for (const path of paths) {
    expect(publicReadingRouteMethods(path), path).toBeNull();
    expect(isPageViewPath(path), path).toBe(false);
    for (const method of ["GET", "POST", "DELETE"]) {
      const response = await dispatch(new Request(`https://beitmitzvah.centralreform.org${path}`, { method, ...(method === "POST" ? { body: "{}", headers: { "content-type": "application/json" } } : {}) }));
      expectNotShared(response, `${method} ${path} -> ${response.status}`);
    }
  }
});

test("with the real portal runtime, signed in and signed out, the private routes that answer carry no public cache directive", async () => {
  const f = await portalRoutesFixture();
  try {
    const dispatch = createHttpDispatcher(async action => action(f.runtime));
    let answered = 0;
    for (const path of privatePaths()) {
      for (const who of ["multi", "anonymous"] as const) {
        const response = await dispatch(f.request(path, { who }));
        if (response.status === 200) answered++;
        expectNotShared(response, `GET ${path} as ${who} -> ${response.status}`);
        await response.body?.cancel().catch(() => {});
      }
    }
    // Real handlers ran and returned data (an admin list, a member's own layers), not only refusals.
    expect(answered).toBeGreaterThan(3);
  } finally { await f.client.close(); }
});

test("on the public side, only a GET that succeeded may be kept; every refusal and every other method is no-store", async () => {
  const dispatch = createHttpDispatcher(async () => { throw new Error("x"); }, async () => { throw new Error("synthetic public failure"); }, async () => { throw new Error("x"); });
  const origin = "https://beitmitzvah.centralreform.org";
  const noStore = (response: Response, label: string) => {
    expect(response.headers.get("cache-control"), label).toBe("no-store");
    expect(response.headers.get("vercel-cdn-cache-control"), label).toBe("no-store");
  };
  // The runtime is down: the answer is a 503 that nobody may keep.
  noStore(await dispatch(new Request(`${origin}/api/public/text?ref=Genesis+1%3A1&kind=torah&offset=0`)), "runtime down");
  noStore(await dispatch(new Request(`${origin}/api/public/commentary?work=rashi&chapter=Genesis+12`)), "commentary, runtime down");
  // A path that is not on the allowlist, a body-bearing method and a header that would make an answer personal: never kept.
  noStore(await dispatch(new Request(`${origin}/api/public/not-a-route`)), "unknown");
  noStore(await dispatch(new Request(`${origin}/api/public/text?ref=Genesis+1%3A1&kind=torah&offset=0`, { method: "POST", body: "{}" })), "POST");
  noStore(await dispatch(new Request(`${origin}/api/public/text?ref=Genesis+1%3A1&kind=torah&offset=0`, { headers: { authorization: "Bearer synthetic" } })), "Authorization");
  noStore(await dispatch(new Request(`${origin}/api/public/text?ref=Genesis+1%3A1&kind=torah&offset=0&extra=1`)), "extra query");
});
