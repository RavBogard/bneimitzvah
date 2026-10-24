import { expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { createHttpDispatcher } from "../../src/server/http/dispatch";
import { publicReadingRouteMethods } from "../../src/server/http/public-reading";
import { isPageViewPath } from "../../src/server/http/page-views";

/**
 * 2.0 F1, the second check: nothing private, signed-in, tenant-specific or no-store gains a public cache header.
 *
 * The public text, commentary and word routes ask the browser and the CDN to keep their answers, because the platform
 * firewall counts every request that reaches the edge (src/server/http/public-reading.ts, KEPT). That is only safe for
 * routes whose answer is the same for every caller. Two guards keep it so:
 *   1. a source scan: a public cache directive may appear only in the files below, each a deliberately public surface;
 *   2. every other API path in the source, run through the real dispatcher, answers without one, and is not on the public allowlist.
 */
const ROOT = join(__dirname, "..", "..");
const walk = (dir: string): string[] => readdirSync(dir).flatMap(name => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? walk(path) : /\.(?:ts|tsx|js|mjs)$/.test(name) ? [path] : [];
});
const rel = (path: string) => relative(ROOT, path).replaceAll("\\", "/");
/** A directive that lets a shared cache or a browser keep a response for anyone. */
const PUBLIC_DIRECTIVE = /\bs-maxage\b|\bpublic\s*,\s*(?:max-age|s-maxage|immutable)/;

/** The only places allowed to say it, and why each is the same for every caller. */
const PUBLIC_SURFACES: Readonly<Record<string, string>> = {
  "src/server/http/public-reading.ts": "the /api/public/ allowlist: GET only, no cookie or Authorization read, CRC host only, the same answer for everyone",
  "src/server/reference-audio/public-short.ts": "content-addressed PocketTorah clips under /reference-audio/short-v1",
  "src/server/http/mcp.ts": "OAuth discovery metadata (publicMetadata): the same document for everyone, no data",
  "src/app/sw.js/route.ts": "the service worker file",
  "src/lib/offline/icon.tsx": "the installable app's icons",
};

test("a public cache directive appears only in the deliberately public surfaces", () => {
  const found = new Set<string>();
  for (const file of [...walk(join(ROOT, "src")), join(ROOT, "next.config.ts")]) {
    const text = readFileSync(file, "utf8");
    if (PUBLIC_DIRECTIVE.test(text)) found.add(rel(file));
  }
  expect([...found].sort()).toEqual(Object.keys(PUBLIC_SURFACES).sort());
  // vercel.json holds crons only: no headers block that could mark a private route cacheable.
  expect(JSON.parse(readFileSync(join(ROOT, "vercel.json"), "utf8")).headers).toBeUndefined();
});

/** Every /api/ path literal outside the public namespace, found in the server's route files. */
function privatePaths(): string[] {
  const paths = new Set<string>();
  for (const file of walk(join(ROOT, "src", "server", "http"))) {
    for (const match of readFileSync(file, "utf8").matchAll(/["'`](\/api\/[A-Za-z0-9_\-/]+)["'`]/g)) paths.add(match[1].replace(/\/$/, ""));
  }
  return [...paths].filter(path => !path.startsWith("/api/public") && path !== "/api").sort();
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
      const label = `${method} ${path} -> ${response.status}`;
      for (const header of ["cache-control", "vercel-cdn-cache-control", "cdn-cache-control", "surrogate-control"]) expect(response.headers.get(header) ?? "", `${label} ${header}`).not.toMatch(PUBLIC_DIRECTIVE);
      expect(response.headers.get("cache-control") ?? "", label).not.toMatch(/\bpublic\b/);
    }
  }
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
