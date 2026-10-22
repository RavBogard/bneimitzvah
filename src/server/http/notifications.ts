import "server-only";
import type { HttpRuntime } from "../runtime/composition";
import { readFormBody, readJsonBody } from "./body";
import { requireCookieMutation } from "./mutations";
import { closedObject, uniqueQuery } from "./query";
import { errorResponse, HttpBoundaryError, privateHeaders, privateJson, type JsonValue } from "./responses";

// Members change their own email choices; mail providers and the unsubscribe page post one-click
// unsubscribes; Vercel Cron drives the morning run.
const routes = { "/api/notifications/preferences": ["GET", "POST"], "/api/notifications/unsubscribe": ["GET", "POST"], "/api/internal/notifications/run": ["GET"] } as const;
export function notificationsRouteMethods(pathname: string): readonly string[] | null {
  return Object.hasOwn(routes, pathname) ? routes[pathname as keyof typeof routes] : null;
}
export async function handleNotificationsRequest(request: Request, runtime: HttpRuntime): Promise<Response | null> {
  const pathname = new URL(request.url).pathname, methods = notificationsRouteMethods(pathname); if (!methods) return null;
  try {
    if (!methods.includes(request.method)) { const response = errorResponse(new HttpBoundaryError(405)); response.headers.set("allow", methods.join(", ")); return response; }
    if (pathname === "/api/internal/notifications/run") {
      uniqueQuery(request.url, []);
      const resolved = await runtime.resolveHost(request);
      return privateJson(await runtime.notifications.cron(request, resolved));
    }
    if (pathname === "/api/notifications/unsubscribe") {
      const query = uniqueQuery(request.url, ["t"]);
      if (request.method === "GET") {
        const token = query.get("t");
        if (!runtime.notifications.validToken(token)) throw new HttpBoundaryError(404);
        // A mail client that opens the header link gets the confirmation page; the capability moves
        // into the fragment there, and nothing changes until that page posts.
        const headers = privateHeaders(); headers.set("location", `/unsubscribe#t=${token}`);
        return new Response(null, { status: 303, headers });
      }
      // RFC 8058 one-click: the provider's POST carries no cookie or origin; the signed token is the
      // only authority, and it can only turn one kind off for one member.
      const size = request.headers.get("content-length");
      if (size !== null && (!/^\d{1,4}$/.test(size) || Number(size) > 1024)) throw new HttpBoundaryError(413);
      let token: string | null;
      if (query.has("t")) token = query.get("t"); // The List-Unsubscribe header link, which RFC 8058 fixes as a URL; its body is not needed.
      else {
        // The unsubscribe page sends the token in the body, so it never reaches a request log.
        const form = await readFormBody(request), keys = [...form.keys()];
        if (keys.length !== 2 || form.getAll("t").length !== 1 || form.getAll("List-Unsubscribe").length !== 1 || form.get("List-Unsubscribe") !== "One-Click") throw new HttpBoundaryError(400);
        token = form.get("t");
      }
      if (!runtime.notifications.validToken(token)) throw new HttpBoundaryError(404);
      const resolved = await runtime.resolveHost(request);
      return privateJson(await runtime.notifications.unsubscribe(resolved, token));
    }
    uniqueQuery(request.url, []);
    if (request.method === "GET") return privateJson({ ok: true, view: await runtime.notificationPreferences.view(request) as unknown as JsonValue });
    requireCookieMutation(request, runtime.origin);
    const body = closedObject(await readJsonBody(request), ["kind", "enabled"], ["weekday"]);
    return privateJson({ ok: true, view: await runtime.notificationPreferences.save(request, { kind: body.kind, enabled: body.enabled, weekday: body.weekday }) as unknown as JsonValue });
  } catch (error) { return errorResponse(error); }
}
