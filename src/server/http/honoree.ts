import "server-only";
import type { HttpRuntime } from "../runtime/composition";
import { intent, selection, bounded } from "../honoree/validation";
import { closedObject, uniqueQuery } from "./query";
import { readJsonBody } from "./body";
import { requireCookieMutation } from "./mutations";
import { errorResponse, HttpBoundaryError, privateJson, type JsonValue } from "./responses";
// Prepared boundary only. No dispatcher entry/landing until independent review.
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
      return privateJson(bounded(await runtime.honoree.read(request, body.token)) as unknown as JsonValue);
    }
    requireCookieMutation(request, runtime.origin);
    const body = closedObject(await readJsonBody(request, "honoree"), ["mode", "operation", "mutationId", "expectedVersion", "contextHash", "startVerse", "linkId"]);
    const selected = selection({ mode: body.mode, studentId: match![1] }), write = intent({ operation: body.operation, mutationId: body.mutationId, expectedVersion: body.expectedVersion, contextHash: body.contextHash, startVerse: body.startVerse, linkId: body.linkId });
    const result = match![2] ? await runtime.honoree.receipt(request, selected, write) : await runtime.honoree.mutate(request, selected, write);
    return privateJson(bounded(result) as JsonValue, result.ok ? 200 : 409);
  } catch (error) { return errorResponse(guest ? new HttpBoundaryError(404) : error); }
}
