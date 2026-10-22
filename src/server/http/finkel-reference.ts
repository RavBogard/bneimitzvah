import "server-only";
import type { FinkelReferenceService } from "../reference-audio/finkel-service";
import { FinkelUnavailable } from "../reference-audio/finkel-manifest";
import type { ActiveMode } from "../access/types";
import { AccessDenied } from "../access/errors";
import { HttpBoundaryError, errorResponse, privateHeaders, privateJson, type JsonValue } from "./responses";
import { uniqueQuery } from "./query";

/** Cantor Finkel's clips: an authorized list and authorized whole-file bytes.
 * Both are private and no-store; no URL here names a provider or a store. */
function route(path: string) {
  if (path === "/api/reference-audio/finkel/clips") return { kind: "clips" as const };
  const media = /^\/api\/reference-audio\/finkel\/media\/([a-f0-9]{64})\.mp3$/.exec(path);
  return media ? { kind: "media" as const, sha256: media[1] } : null;
}
export function finkelReferenceRouteMethods(path: string): readonly string[] | null { return route(path) ? ["GET"] : null; }
function mode(value: string | null): ActiveMode {
  if (value !== "student" && value !== "parent" && value !== "tutor" && value !== "admin") throw new HttpBoundaryError();
  return value;
}
export async function handleFinkelReferenceRequest(request: Request, service: FinkelReferenceService | undefined): Promise<Response | null> {
  const found = route(new URL(request.url).pathname); if (!found) return null;
  try {
    if (request.method !== "GET") { const response = errorResponse(new HttpBoundaryError(405)); response.headers.set("allow", "GET"); return response; }
    if (request.headers.has("range") || request.headers.has("if-range") || request.headers.has("transfer-encoding")
      || request.headers.has("content-length") && request.headers.get("content-length") !== "0") throw new HttpBoundaryError();
    if (!service) throw new AccessDenied(404);
    if (found.kind === "media") {
      const query = uniqueQuery(request.url, ["mode"]);
      const result = await service.media(request, { mode: mode(query.get("mode")), sha256: found.sha256 });
      if (result.sessionExpiresAt <= Date.now() || request.signal.aborted) throw new AccessDenied(401);
      const headers = privateHeaders(); headers.set("content-type", "audio/mpeg"); headers.set("content-length", String(result.bytes.byteLength));
      headers.set("vercel-cdn-cache-control", "no-store"); headers.set("accept-ranges", "none");
      return new Response(result.bytes, { status: 200, headers });
    }
    const query = uniqueQuery(request.url, ["mode", "from", "to"]), from = query.get("from"), to = query.get("to");
    if ((from === null) !== (to === null)) throw new HttpBoundaryError();
    const result = await service.clips(request, { mode: mode(query.get("mode")), ...(from !== null && to !== null ? { from, to } : {}) });
    if (result.sessionExpiresAt <= Date.now() || request.signal.aborted) throw new AccessDenied(401);
    return privateJson({ schema: result.schema, source: result.source, pin: result.pin,
      clips: result.clips.map(clip => ({ asset: clip.asset, kind: clip.kind, mode: clip.mode, verses: [...clip.verses], sha256: clip.sha256,
        bytes: clip.bytes, durationSeconds: clip.durationSeconds, preferred: clip.preferred })) } as JsonValue);
  } catch (error) { return errorResponse(error instanceof FinkelUnavailable ? new Error("Finkel reference unavailable") : error); }
}
