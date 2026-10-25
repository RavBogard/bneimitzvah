import "server-only";
import type { HttpRuntime } from "../runtime/composition";
import { AccessDenied } from "../access/errors";
import { uniqueQuery } from "./query";
import { errorResponse, HttpBoundaryError, privateJson } from "./responses";

/**
 * GET /api/offline/packs (1.5 plan §3.10): the installed app asks which of this person's own readings it may keep.
 * Never under /api/public/ (that runtime has no session) and never cacheable: privateJson is `private, no-store`,
 * and the service worker does not handle this path. No query, no practice context. 401 signed out; the device
 * then drops every owner pack and keeps only the public ones.
 */
const PATH = "/api/offline/packs";
export function offlineRouteMethods(pathname: string): readonly string[] | null {
  return pathname === PATH ? ["GET"] : null;
}
export async function handleOfflineRequest(request: Request, runtime: HttpRuntime): Promise<Response | null> {
  if (new URL(request.url).pathname !== PATH) return null;
  try {
    if (request.method !== "GET") { const response = errorResponse(new HttpBoundaryError(405)); response.headers.set("allow", "GET"); return response; }
    uniqueQuery(request.url, []);
    if (request.headers.has("X-Practice-Context")) throw new AccessDenied(403);
    const value = await runtime.offline.packs(request);
    // `evening` (2.0 SC7): whether this signed-in person may keep the CRC siddur's evening lesson text (CRC members only).
    return privateJson({ owner: value.owner, packs: value.packs.map(pack => ({ kind: pack.kind, ref: pack.ref, name: pack.name })), evening: value.evening === true });
  } catch (error) { return errorResponse(error); }
}
