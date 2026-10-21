import "server-only";
import type { ReferenceReviewService } from "../reference-review/service";
import { ReviewInvalid } from "../reference-review/batch-contract";
import { readJsonBody } from "./body";
import { HttpBoundaryError, errorResponse, privateHeaders, privateJson, type JsonValue } from "./responses";
import { uniqueQuery } from "./query";
import { AccessDenied } from "../access/errors";
import { reviewResultBarrier } from "../reference-review/response-barrier";

type FinalCheck = { sessionExpiresAt: number; batchExpiresAt?: number; list?: () => Response };
const responseChecks = new WeakMap<Response, FinalCheck>();
function bindResponse(response: Response, result: object, list?: () => Response) {
  const barrier = reviewResultBarrier(result);
  if (!barrier) throw new HttpBoundaryError(404);
  responseChecks.set(response, { ...barrier, list }); return response;
}
/** Dispatcher calls this synchronously AFTER runtime cleanup. No new I/O/auth
 * pool, private marker or header. An already committed decision is not undone. */
export function finishReferenceReviewResponse(request: Request, response: Response): Response {
  const check = responseChecks.get(response); if (!check) return response;
  const status = request.signal.aborted ? 404 : check.sessionExpiresAt <= Date.now() ? 401 : check.batchExpiresAt !== undefined && check.batchExpiresAt <= Date.now() ? 404 : null;
  if (status !== null) { try { void response.body?.cancel().catch(() => {}); } catch {} return errorResponse(new AccessDenied(status)); }
  return check.list ? check.list() : response;
}

function route(path: string) {
  if (path === "/api/reference-review/batches") return { kind: "list" as const };
  const match = /^\/api\/reference-review\/batches\/([a-f0-9-]{36})(?:\/(media|decisions)\/(fj_[a-f0-9]{20})|\/(revoke))?$/.exec(path);
  return match ? { kind: match[2] === "media" ? "media" as const : match[2] === "decisions" ? "decide" as const : match[4] === "revoke" ? "revoke" as const : "detail" as const, id: match[1], assetKey: match[3] } : null;
}
export function referenceReviewRouteMethods(path: string): readonly string[] | null {
  const found = route(path); return found ? [found.kind === "decide" || found.kind === "revoke" ? "POST" : "GET"] : null;
}
export async function handleReferenceReviewRequest(request: Request, service: ReferenceReviewService): Promise<Response | null> {
  const found = route(new URL(request.url).pathname); if (!found) return null;
  try {
    const methods = referenceReviewRouteMethods(new URL(request.url).pathname)!;
    if (!methods.includes(request.method)) { const response = errorResponse(new HttpBoundaryError(405)); response.headers.set("allow", methods.join(", ")); return response; }
    uniqueQuery(request.url, []);
    if (request.headers.has("range") || request.headers.has("if-range")) throw new HttpBoundaryError();
    if (request.method === "GET" && (request.headers.has("transfer-encoding") || request.headers.has("content-length") && request.headers.get("content-length") !== "0")) throw new HttpBoundaryError();
    if (found.kind === "media") {
      const result = await service.media(request, found.id!, found.assetKey!);
      const headers = privateHeaders(); headers.set("content-type", "audio/mpeg"); headers.set("content-length", String(result.bytes.byteLength)); headers.set("vercel-cdn-cache-control", "no-store");
      return bindResponse(new Response(result.bytes, { headers }), result);
    }
    const result = found.kind === "list" ? await service.list(request) : found.kind === "detail" ? await service.detail(request, found.id!) : found.kind === "decide"
      ? await service.decide(request, found.id!, found.assetKey!, await readJsonBody(request, "honoree"))
      : await service.revoke(request, found.id!, await readJsonBody(request, "honoree"));
    const response = privateJson(result as unknown as JsonValue, result.ok ? 200 : 409);
    return bindResponse(response, result, found.kind === "list" && "batches" in result ? () => privateJson({ ok: true, batches: result.batches.filter(batch => Date.parse(batch.expiresAt) > Date.now()) } as unknown as JsonValue) : undefined);
  } catch (error) { return errorResponse(error instanceof ReviewInvalid ? new HttpBoundaryError() : error); }
}
