import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // Let the alias gate drop path/query before any cross-origin navigation.
  // Pinned Next still normalizes repeated slashes before proxy on the same host.
  skipTrailingSlashRedirect: true,
  // Auth/invitation query strings must not enter framework request logs.
  // Fetch URL logging remains disabled (no fetches logging configuration).
  logging: { incomingRequests: false },
  // No portal page is ever framed (an overlaid click on the Claude consent page, among others).
  async headers() {
    // Pages only: API, discovery and the reviewed landing handlers (honoree, e-mail and invitation
    // links) set their own exact CSP and frame headers.
    // Until beta (Daniel, 2026-10-22) nothing is indexed: this header, the root layout's robots
    // meta and /robots.txt all say so. The public reading API sets the header itself as well.
    return [{ source: "/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] },
      { source: "/((?!api/|\\.well-known/|honoree|auth/email|invitations/open).*)", headers: [{ key: "X-Frame-Options", value: "DENY" }] },
      { source: "/connect{/}?", headers: [{ key: "Content-Security-Policy", value: "frame-ancestors 'none'" }] }];
  },
};

export default nextConfig;
