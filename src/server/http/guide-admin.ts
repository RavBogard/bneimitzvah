import "server-only";
import type { HttpRuntime } from "../runtime/composition";
import { readJsonBody } from "./body";
import { closedObject, uniqueQuery } from "./query";
import { errorResponse, HttpBoundaryError, privateJson, type JsonValue } from "./responses";

/**
 * The admin's Guides page (gap A6). Every route is admin only; the checks live in the service (guide-admin/service.ts):
 *
 *   GET  /api/admin/guides                              withAdminCapability "read-guides"
 *   GET  /api/admin/guides/text?kind=&readingKey=&version=   withAdminCapability "read-guides"
 *   POST /api/admin/guides/discussions/withdraw         same-origin cookie POST, then withAdminCapability "manage-defaults" (+ lockRabbi)
 *   POST /api/admin/guides/summaries/approve            same
 *   POST /api/admin/guides/summaries/withdraw           same
 *
 * A POST is refused before its body is read unless `authorize` passes (admin mode, a cookie POST from the tenant host's own origin);
 * the write itself runs the same authority again inside its own transaction.
 */
const routes = {
  "/api/admin/guides": ["GET"], "/api/admin/guides/text": ["GET"],
  "/api/admin/guides/discussions/withdraw": ["POST"], "/api/admin/guides/summaries/approve": ["POST"], "/api/admin/guides/summaries/withdraw": ["POST"],
} as const;
export function guideAdminRouteMethods(pathname: string): readonly string[] | null {
  return Object.hasOwn(routes, pathname) ? routes[pathname as keyof typeof routes] : null;
}
const VERSION = /^[1-9]\d{0,9}$/;
export async function handleGuideAdminRequest(request: Request, runtime: HttpRuntime): Promise<Response | null> {
  const pathname = new URL(request.url).pathname, methods = guideAdminRouteMethods(pathname); if (!methods) return null;
  try {
    let result: unknown;
    if (pathname === "/api/admin/guides") {
      uniqueQuery(request.url, []);
      result = { ok: true, ...await runtime.guideAdmin.overview(request) };
    } else if (pathname === "/api/admin/guides/text") {
      const query = uniqueQuery(request.url, ["kind", "readingKey", "version"]), version = query.get("version");
      if (version === null || !VERSION.test(version)) throw new HttpBoundaryError(404);
      result = { ok: true, guide: await runtime.guideAdmin.guideText(request, { kind: query.get("kind"), readingKey: query.get("readingKey"), version: Number(version) }) };
    } else {
      uniqueQuery(request.url, []);
      // Authority first, as guide sharing does: admin mode and a same-origin cookie POST against the host's own origin.
      await runtime.guideAdmin.authorize(request);
      if (pathname === "/api/admin/guides/discussions/withdraw") {
        const body = closedObject(await readJsonBody(request), ["slug", "revision"]);
        result = await runtime.guideAdmin.withdrawDiscussion(request, { slug: body.slug, revision: body.revision });
      } else {
        const body = closedObject(await readJsonBody(request), ["reading", "revision"]);
        result = pathname.endsWith("/approve") ? await runtime.guideAdmin.approvePortionSummary(request, { reading: body.reading, revision: body.revision })
          : await runtime.guideAdmin.withdrawPortionSummary(request, { reading: body.reading, revision: body.revision });
      }
    }
    if (Buffer.byteLength(JSON.stringify(result)) > 2 * 1024 * 1024) throw new Error("Guides unavailable");
    return privateJson(result as JsonValue, (result as { ok?: unknown }).ok === true ? 200 : 409);
  } catch (error) { return errorResponse(error); }
}
