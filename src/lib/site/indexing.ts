/**
 * The one switch for search indexing (Daniel, 2026-10-23, F2): until the v1.5.0 tag every page, header and
 * robots.txt says noindex. At v1.5.0 this single constant becomes `true`; then exactly the three public routes
 * below become indexable and everything else (signed-in pages, workspaces, the API, learn lessons and review,
 * the front door) stays noindex. robots.ts, next.config.ts headers and each page's robots meta all read it here.
 * Dependency-free so next.config.ts can import it.
 */
export const PUBLIC_INDEXING = false;

export const INDEXABLE_PATHS = Object.freeze(["/read", "/learn", "/trope-chart"] as const);
export type IndexablePath = (typeof INDEXABLE_PATHS)[number];

/** The robots meta of a page that is never for search engines (and of every public page while indexing is off). */
export const NOINDEX_META = Object.freeze({ index: false, follow: false, nocache: true, googleBot: Object.freeze({ index: false, follow: false }) });
export const INDEXABLE_META = Object.freeze({ index: true, follow: true });

/** Robots meta for one of the three public routes: indexable only when the switch is on. */
export function publicRobots(indexing: boolean = PUBLIC_INDEXING) {
  return indexing ? INDEXABLE_META : NOINDEX_META;
}

/**
 * The X-Robots-Tag rule next.config.ts sends on pages. Off: every path, as before. On: every path except exactly
 * the three public routes (a trailing slash allowed; /learn/about, /learn/review and lessons keep the header).
 */
export function noindexHeaderRule(indexing: boolean = PUBLIC_INDEXING) {
  const source = indexing ? `/((?!(?:${INDEXABLE_PATHS.map(path => path.slice(1)).join("|")})/?$).*)` : "/:path*";
  return { source, headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] };
}

type RobotsTxt = { rules: { userAgent: string; allow?: string[]; disallow: string }; sitemap?: string };
/** /robots.txt. Off: Disallow: / alone. On: the three routes allowed, the rest disallowed, and the sitemap named when the canonical origin is known. */
export function robotsTxt(origin: string | null, indexing: boolean = PUBLIC_INDEXING): RobotsTxt {
  if (!indexing) return { rules: { userAgent: "*", disallow: "/" } };
  const rules = { userAgent: "*", allow: [...INDEXABLE_PATHS], disallow: "/" };
  return origin ? { rules, sitemap: `${origin}/sitemap.xml` } : { rules };
}
