import "server-only";
import { AccessDenied } from "../access/errors";
import type { AccessRequest } from "../access/types";

export type CookieMutationRequest = AccessRequest & Readonly<{ method: string }>;

// The origin argument must come from exact host resolution, never a body field
// or the Origin header itself. Token-authenticated MCP needs its own contract.
export function requireCookieMutation(request: AccessRequest & { method?: string }, resolvedOrigin: string) {
  if (request.method !== "POST" || request.headers.get("origin") !== resolvedOrigin) throw new AccessDenied(403);
  const site = request.headers.get("sec-fetch-site");
  if (site !== null && site !== "same-origin") throw new AccessDenied(403);
}
