import "server-only";
import type { HttpRuntime } from "../runtime/composition";
import { readJsonBody } from "./body";
import { closedObject, uniqueQuery } from "./query";
import { errorResponse, HttpBoundaryError, privateHeaders, privateJson, type JsonValue } from "./responses";

// The admin's guide sharing page: one GET downloads the reviewed guides as a file; two POSTs take a file back, one to preview and one to import.
// Admin mode only (the service's capability check), cookie session, same-origin posts; the file is parsed strictly before anything else runs.
const routes = { "/api/admin/guide-share/export": ["GET"], "/api/admin/guide-share/preview": ["POST"], "/api/admin/guide-share/import": ["POST"] } as const;
export function guideShareRouteMethods(pathname: string): readonly string[] | null {
  return Object.hasOwn(routes, pathname) ? routes[pathname as keyof typeof routes] : null;
}
export async function handleGuideShareRequest(request: Request, runtime: HttpRuntime): Promise<Response | null> {
  const pathname = new URL(request.url).pathname, methods = guideShareRouteMethods(pathname); if (!methods) return null;
  try {
    if (!methods.includes(request.method)) { const response = errorResponse(new HttpBoundaryError(405)); response.headers.set("allow", methods.join(", ")); return response; }
    uniqueQuery(request.url, []);
    if (request.method === "GET") {
      const file = await runtime.guideShare.exportFile(request as never);
      const headers = privateHeaders();
      headers.set("content-type", "application/json; charset=utf-8");
      headers.set("content-disposition", 'attachment; filename="guide-export.json"');
      return new Response(JSON.stringify(file), { status: 200, headers });
    }
    // Authority first (admin, same-origin), so nobody else gets a multi-megabyte body read or parsed.
    await runtime.guideShare.authorize(request);
    const body = closedObject(await readJsonBody(request, "guideShare"), ["file"]);
    const result = pathname.endsWith("/preview") ? await runtime.guideShare.preview(request, body.file) : await runtime.guideShare.importFile(request, body.file);
    return privateJson(result as unknown as JsonValue, result.ok ? 200 : 400);
  } catch (error) { return errorResponse(error); }
}
