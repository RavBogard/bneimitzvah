import { NextResponse, type NextRequest } from "next/server";
import { canonicalNavigation } from "./lib/navigation/canonical";

export function proxy(request: NextRequest) {
  return canonicalNavigation(request, {
    PORTAL_ENVIRONMENT: process.env.PORTAL_ENVIRONMENT,
    PORTAL_DEPLOYMENT: process.env.PORTAL_DEPLOYMENT,
    BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
  }) ?? NextResponse.next();
}
