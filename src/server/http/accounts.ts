import "server-only";
import type { HttpRuntime } from "../runtime/composition";
import { readJsonBody } from "./body";
import { requireCookieMutation } from "./mutations";
import { uniqueQuery } from "./query";
import { errorResponse, HttpBoundaryError, privateJson, type JsonValue } from "./responses";
import { mode as approverMode } from "../accounts/validation";

/**
 * Release 1.4 accounts (plan section 2b). /api/account/request is the signed-in person's own; /api/accounts/* is
 * for approvers (admins, and tutors an admin designated) and, for members and approvers, admins only. Never under
 * /api/public/, and every response is private and no-store.
 */
const routes = {
  "/api/account/request": ["GET", "POST"],
  "/api/accounts/summary": ["GET"], "/api/accounts/requests": ["GET"], "/api/accounts/requests/approve": ["POST"], "/api/accounts/requests/decline": ["POST"],
  "/api/accounts/members": ["GET"], "/api/accounts/members/end": ["POST"],
  "/api/accounts/approvers": ["GET"], "/api/accounts/approvers/add": ["POST"], "/api/accounts/approvers/remove": ["POST"],
} as const;
type Path = keyof typeof routes;
export function accountsRouteMethods(pathname: string): readonly string[] | null {
  return Object.hasOwn(routes, pathname) ? routes[pathname as Path] : null;
}
const statusOf = (result: { ok: boolean; code?: string }) => result.ok ? 200 : result.code === "rate-limited" || result.code === "busy" ? 429 : 409;

export async function handleAccountsRequest(request: Request, runtime: HttpRuntime): Promise<Response | null> {
  const pathname = new URL(request.url).pathname, methods = accountsRouteMethods(pathname);
  if (!methods) return null;
  try {
    if (!methods.includes(request.method)) { const response = errorResponse(new HttpBoundaryError(405)); response.headers.set("allow", methods.join(", ")); return response; }
    const path = pathname as Path, accounts = runtime.accounts;
    let result: { ok: boolean; code?: string };
    if (request.method === "GET") {
      if (path === "/api/accounts/summary" || path === "/api/accounts/requests") {
        const query = uniqueQuery(request.url, ["mode"]), mode = approverMode(query.get("mode"));
        result = path === "/api/accounts/summary" ? await accounts.summary(request, mode) : await accounts.requests(request, mode);
      } else {
        uniqueQuery(request.url, []);
        result = path === "/api/account/request" ? await accounts.requestState(request) : path === "/api/accounts/members" ? await accounts.members(request) : await accounts.approvers(request);
      }
    } else {
      uniqueQuery(request.url, []);
      requireCookieMutation(request, runtime.origin);
      const body = await readJsonBody(request);
      result = path === "/api/account/request" ? await accounts.request(request, body)
        : path === "/api/accounts/requests/approve" ? await accounts.approve(request, body)
        : path === "/api/accounts/requests/decline" ? await accounts.decline(request, body)
        : path === "/api/accounts/members/end" ? await accounts.endMember(request, body)
        : path === "/api/accounts/approvers/add" ? await accounts.addApprover(request, body)
        : await accounts.removeApprover(request, body);
    }
    return privateJson(result as unknown as JsonValue, statusOf(result));
  } catch (error) { return errorResponse(error); }
}
