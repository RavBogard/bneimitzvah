import "server-only";
import { readJsonBody } from "./body";
import { PAGE_VIEW_ROUTE } from "../../lib/site/page-view-route";
import { normalizePublicPagePath } from "../../lib/site/page-views";

/**
 * The public page-view beacon (release 1.5, cookieless analytics; Daniel: "path and day only"). The public layouts post
 * `{ "page": location.pathname + location.search }` here once per page; the route turns it into one allow-listed path and
 * adds one to that path's count for today (UTC) in the congregation the host names.
 *
 * Every answer is the same empty 204, whatever happened, so the route tells a caller nothing and the page never waits on it.
 * It never reads or sets a cookie (a request carrying one, or Authorization, is dropped unread), never reads the IP, user
 * agent or referrer, and never logs. Abuse limits: POST only, no query, a 1 KiB JSON body, same-origin only (Origin must be
 * the page's own; Sec-Fetch-Site, when sent, must say same-origin), and the allow-list, checked before any database opens,
 * so a request can raise a count but never add a path. The firewall's /api/public/ rate limit covers this route too.
 */
export const isPageViewPath = (pathname: string) => pathname === PAGE_VIEW_ROUTE;

/** The counter's own runtime (runtime/public-composition.ts): the host check and one upsert, and nothing else. */
export type PageViewRuntime = Readonly<{
  /** Exact host to tenant; refuses anything that is not the public tenant on the canonical origin. */
  resolveTenant(request: Request): Promise<void>;
  /** One view of an allow-listed path on a UTC day (src/server/data/page-views.ts). Only after resolveTenant. */
  countPageView(path: string, day: string): Promise<void>;
}>;
export type PageViewScope = (action: (runtime: PageViewRuntime) => Promise<Response>) => Promise<Response>;

const done = () => new Response(null, { status: 204, headers: { "cache-control": "no-store", "vercel-cdn-cache-control": "no-store",
  "x-robots-tag": "noindex, nofollow", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" } });

/** The UTC calendar day of `at`, as YYYY-MM-DD. */
export const utcDay = (at: Date) => at.toISOString().slice(0, 10);

export async function handlePageViewRequest(request: Request, withViews: PageViewScope, now: () => Date = () => new Date()): Promise<Response> {
  try {
    if (request.method !== "POST" || request.url.length > 2048) return done();
    const url = new URL(request.url);
    if (url.search || url.hash || url.username || url.password || !isPageViewPath(url.pathname)) return done();
    const headers = request.headers, site = headers.get("sec-fetch-site");
    if (headers.get("origin") !== url.origin || site !== null && site !== "same-origin" || headers.has("cookie") || headers.has("authorization")) return done();
    const body = await readJsonBody(request, "view", 2000);
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 1 || !Object.hasOwn(body, "page")) return done();
    const path = normalizePublicPagePath((body as { page: unknown }).page);
    if (path === null) return done();
    const day = utcDay(now());
    return await withViews(async runtime => {
      try {
        await runtime.resolveTenant(request);
        await runtime.countPageView(path, day);
      } catch { /* Nothing about a failure leaves this route. */ }
      return done();
    });
  } catch { return done(); }
}
