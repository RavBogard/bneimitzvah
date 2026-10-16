// Navigation policy only: this module grants no session, tenant or API authority.
export const CANONICAL_ORIGIN = "https://beitmitzvah.centralreform.org";
export const CANONICAL_DESTINATION = `${CANONICAL_ORIGIN}/#home`;
const aliases = new Set([
  "barmitzvah.centralreform.org", "batmitzvah.centralreform.org",
  "bnaimitzvah.centralreform.org", "bneimitzvah.centralreform.org", "bneimitzvah.vercel.app",
]);
const canonicalHost = new URL(CANONICAL_ORIGIN).host;
type Environment = Readonly<Record<string, string | undefined>>;
export function canonicalNavigationEnabled(env: Environment) {
  return env.PORTAL_ENVIRONMENT === "production" && env.PORTAL_DEPLOYMENT === "production" && env.BETTER_AUTH_URL === CANONICAL_ORIGIN;
}
const privateHeaders = { "cache-control": "private, no-store", "referrer-policy": "no-referrer" };
const denied = () => new Response(null, { status: 404, headers: privateHeaders });

export function canonicalNavigation(request: Pick<Request, "url" | "headers" | "method">, env: Environment): Response | null {
  if (!canonicalNavigationEnabled(env)) return null;
  // The wire Host identifies only a known navigation alias. Next may reconstruct
  // Request.url using an internal listening address; never promote Host to auth.
  const host = request.headers.get("host");
  if (!host || !aliases.has(host)) return null;
  let url: URL;
  try { url = new URL(request.url); } catch { return denied(); }
  if ((url.hostname === canonicalHost || aliases.has(url.hostname)) && url.host !== host) return denied();
  const forwardedHost = request.headers.get("x-forwarded-host");
  const proto = request.headers.get("x-forwarded-proto"), port = request.headers.get("x-forwarded-port");
  if ((forwardedHost !== null && forwardedHost !== host) || (proto !== null && proto !== "https") || (port !== null && port !== "443")) return denied();
  const origin = request.headers.get("origin");
  if (origin !== null && origin !== `https://${host}`) return denied();
  if (!["GET", "HEAD"].includes(request.method) || /^\/api(?:\/|$)/i.test(url.pathname)) return denied();
  // A fixed nonempty harmless fragment replaces any incoming browser fragment.
  // Next's redirect parse/format pipeline strips a literal empty '#'.
  // Never reuse incoming path/query/fragment or query-preserving redirects.
  return new Response(null, { status: 303, headers: { ...privateHeaders, location: CANONICAL_DESTINATION } });
}
