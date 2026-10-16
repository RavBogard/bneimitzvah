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
};

export default nextConfig;
