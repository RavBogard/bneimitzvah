import { NextResponse, type NextRequest } from "next/server";
import { canonicalNavigation } from "./lib/navigation/canonical";
import { resolveIdentity } from "./lib/site/identity";

export function proxy(request: NextRequest) {
  // Siona Benjamin's floor (public/brand) is licensed to CRC alone: off CRC's origins its files answer 404, whatever the logo setting says.
  if (request.nextUrl.pathname.startsWith("/brand/") && !resolveIdentity().crc) return new NextResponse(null, { status: 404 });
  return canonicalNavigation(request, {
    PORTAL_ENVIRONMENT: process.env.PORTAL_ENVIRONMENT,
    PORTAL_DEPLOYMENT: process.env.PORTAL_DEPLOYMENT,
    BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
    CANONICAL_ORIGIN: process.env.CANONICAL_ORIGIN,
    ORIGIN_ALIASES: process.env.ORIGIN_ALIASES,
  }) ?? NextResponse.next();
}
