import type { NextConfig } from "next";
import { noindexHeaderRule } from "./src/lib/site/indexing";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // Let the alias gate drop path/query before any cross-origin navigation.
  // Pinned Next still normalizes repeated slashes before proxy on the same host.
  skipTrailingSlashRedirect: true,
  // The installable app's rollback flag (1.5 A1): "false" stops the page registering a worker or packing,
  // and makes /sw.js the tombstone that removes an installed worker and its caches.
  env: { PORTAL_OFFLINE_ENABLED: process.env.PORTAL_OFFLINE_ENABLED ?? "" },
  // /sw.js is prerendered from this file; traced too, so a runtime render could never serve a 500 instead of the worker.
  outputFileTracingIncludes: { "/sw.js": ["./src/offline/service-worker.js"] },
  // Auth/invitation query strings must not enter framework request logs.
  // Fetch URL logging remains disabled (no fetches logging configuration).
  logging: { incomingRequests: false },
  // No portal page is ever framed (an overlaid click on the Claude consent page, among others).
  async headers() {
    // Pages only: API, discovery and the reviewed landing handlers (honoree, e-mail and invitation
    // links) set their own exact CSP and frame headers.
    // PUBLIC_INDEXING is on (src/lib/site/indexing.ts; Daniel, 2026-10-26): only /read, /learn and /trope-chart lose this header; the root layout's
    // robots meta and /robots.txt keep everything else noindex.
    // The public reading API sets the header itself as well.
    return [noindexHeaderRule(),
      { source: "/((?!api/|\\.well-known/|honoree|auth/email|invitations/open).*)", headers: [{ key: "X-Frame-Options", value: "DENY" }] },
      { source: "/connect{/}?", headers: [{ key: "Content-Security-Policy", value: "frame-ancestors 'none'" }] }];
  },
};

export default nextConfig;
