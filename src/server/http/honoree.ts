import "server-only";
import type { HttpRuntime } from "../runtime/composition";
import { intent, selection, bounded } from "../honoree/validation";
import { closedObject, uniqueQuery } from "./query";
import { readJsonBody } from "./body";
import { requireCookieMutation } from "./mutations";
import { errorResponse, HttpBoundaryError, privateJson, type JsonValue } from "./responses";
const guestExpiry = new WeakMap<Response, number>();
/** Final synchronous fence after scoped runtime cleanup; never parse a body or
 * take a second reading. Metadata belongs only to our successful response. */
export function finishHonoreeGuestResponse(request: Request, response: Response, started: number): Response {
  const denied = () => errorResponse(new HttpBoundaryError(404));
  const expiresAt = guestExpiry.get(response), value = response.headers.get("X-Honoree-Remaining-Ms");
  if (response.status !== 200 || request.signal.aborted || expiresAt === undefined || !value || !/^[1-9][0-9]*$/.test(value)) return denied();
  const supplied = Number(value), elapsed = performance.now() - started;
  const remaining = Math.floor(Math.min(supplied - elapsed, expiresAt - Date.now()));
  if (!Number.isSafeInteger(supplied) || supplied > 90 * 86400000 || !Number.isFinite(elapsed) || elapsed < 0 || !Number.isSafeInteger(remaining) || remaining <= 0) return denied();
  response.headers.set("X-Honoree-Remaining-Ms", String(remaining));
  return response;
}
// Only the exact guest path is dispatched. Authenticated adapters remain prepared.
export async function handleHonoreeRequest(request: Request, runtime: Pick<HttpRuntime, "honoree" | "origin">): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  const guest = path === "/api/honoree/read", match = /^\/api\/students\/([^/]+)\/honoree-links(?:\/(receipt))?$/.exec(path);
  if (!guest && !match) return null;
  try {
    uniqueQuery(request.url, []);
    if (request.method !== "POST") throw new HttpBoundaryError(405);
    if (guest) {
      if (request.headers.get("origin") !== runtime.origin || request.headers.has("cookie") || request.headers.has("authorization") || request.headers.has("X-Practice-Context")) throw 0;
      const body = closedObject(await readJsonBody(request, "honoree"), ["token"]);
      const { dto, remainingMs } = await runtime.honoree.readForTransport(request, body.token);
      if (request.signal.aborted || !Number.isSafeInteger(remainingMs) || remainingMs <= 0 || remainingMs > 90 * 86400000) throw 0;
      const response = privateJson(bounded(dto) as unknown as JsonValue);
      if (response.status !== 200) throw 0;
      response.headers.set("X-Honoree-Remaining-Ms", String(remainingMs));
      guestExpiry.set(response, Date.parse(dto.expiresAt));
      return response;
    }
    requireCookieMutation(request, runtime.origin);
    const body = closedObject(await readJsonBody(request, "honoree"), ["mode", "operation", "mutationId", "expectedVersion", "contextHash", "startVerse", "linkId"]);
    const selected = selection({ mode: body.mode, studentId: match![1] }), write = intent({ operation: body.operation, mutationId: body.mutationId, expectedVersion: body.expectedVersion, contextHash: body.contextHash, startVerse: body.startVerse, linkId: body.linkId });
    const result = match![2] ? await runtime.honoree.receipt(request, selected, write) : await runtime.honoree.mutate(request, selected, write);
    return privateJson(bounded(result) as JsonValue, result.ok ? 200 : 409);
  } catch (error) { return errorResponse(guest ? new HttpBoundaryError(404) : error); }
}
