import "server-only";
import type { HttpRuntime } from "../runtime/composition";
import { requireCookieMutation } from "./mutations";
import { uniqueQuery } from "./query";
import { HttpBoundaryError, privateJson } from "./responses";

const methods: Record<string, readonly string[]> = { "/api/internal/roster-sheet/sync": ["GET"], "/api/admin/roster-sheet/sync": ["POST"] };
export function rosterSheetRouteMethods(pathname: string): readonly string[] | null {
  return Object.hasOwn(methods, pathname) ? methods[pathname] : null;
}
// Only called after dispatcher resolves the actual exact incoming host.
export async function handleRosterSheetRequest(request: Request, runtime: HttpRuntime): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (!Object.hasOwn(methods, path)) return null;
  if (!methods[path].includes(request.method)) throw new HttpBoundaryError(405);
  uniqueQuery(request.url, []);
  const resolved = await runtime.resolveHost(request);
  if (path === "/api/internal/roster-sheet/sync") return privateJson(await runtime.rosterSheet.cron(request, resolved));
  requireCookieMutation(request, resolved.origin);
  return privateJson(await runtime.rosterSheet.now(request));
}
