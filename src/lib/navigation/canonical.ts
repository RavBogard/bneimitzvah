// Navigation policy only: this module grants no session, tenant or API authority.
// Exactly two hard-coded CRC origins can be canonical. Production configuration
// (BETTER_AUTH_URL) selects one; the other becomes a navigation alias like the
// rest. Navigation can never point anywhere but one of these two origins.
export const CANONICAL_ORIGINS = Object.freeze(["https://beitmitzvah.centralreform.org", "https://torah.centralreform.org"] as const);
export type CanonicalOrigin = (typeof CANONICAL_ORIGINS)[number];
const aliases: ReadonlySet<string> = new Set([
  "barmitzvah.centralreform.org", "batmitzvah.centralreform.org",
  "bnaimitzvah.centralreform.org", "bneimitzvah.centralreform.org", "bneimitzvah.vercel.app",
  // Whichever canonical is not selected is an alias; the selected one is excluded per request.
  ...CANONICAL_ORIGINS.map(origin => new URL(origin).host),
]);
type Environment = Readonly<Record<string, string | undefined>>;
// Exact string match against the hard-coded list: a trailing slash, other case
// or any other value selects nothing, and navigation stays inert.
export function selectedCanonicalOrigin(env: Environment): CanonicalOrigin | null {
  const value = env.BETTER_AUTH_URL;
  if (env.PORTAL_ENVIRONMENT !== "production" || env.PORTAL_DEPLOYMENT !== "production" || typeof value !== "string") return null;
  return CANONICAL_ORIGINS.find(origin => origin === value) ?? null;
}
export function canonicalNavigationEnabled(env: Environment) {
  return selectedCanonicalOrigin(env) !== null;
}
const privateHeaders = { "cache-control": "private, no-store", "referrer-policy": "no-referrer" };
const denied = () => new Response(null, { status: 404, headers: privateHeaders });

export function canonicalNavigation(request: Pick<Request, "url" | "headers" | "method">, env: Environment): Response | null {
  const origin = selectedCanonicalOrigin(env);
  if (origin === null) return null;
  const canonicalHost = new URL(origin).host;
  // The wire Host identifies only a known navigation alias. Next may reconstruct
  // Request.url using an internal listening address; never promote Host to auth.
  // The selected canonical's own host is never an alias (it would redirect to itself).
  const host = request.headers.get("host");
  if (!host || host === canonicalHost || !aliases.has(host)) return null;
  let url: URL;
  try { url = new URL(request.url); } catch { return denied(); }
  if ((url.hostname === canonicalHost || aliases.has(url.hostname)) && url.host !== host) return denied();
  const forwardedHost = request.headers.get("x-forwarded-host");
  const proto = request.headers.get("x-forwarded-proto"), port = request.headers.get("x-forwarded-port");
  if ((forwardedHost !== null && forwardedHost !== host) || (proto !== null && proto !== "https") || (port !== null && port !== "443")) return denied();
  const requestOrigin = request.headers.get("origin");
  if (requestOrigin !== null && requestOrigin !== `https://${host}`) return denied();
  if (!["GET", "HEAD"].includes(request.method) || /^\/api(?:\/|$)/i.test(url.pathname)) return denied();
  // A fixed nonempty harmless fragment replaces any incoming browser fragment.
  // Next's redirect parse/format pipeline strips a literal empty '#'.
  // Never reuse incoming path/query/fragment or query-preserving redirects.
  return new Response(null, { status: 303, headers: { ...privateHeaders, location: `${origin}/#home` } });
}
