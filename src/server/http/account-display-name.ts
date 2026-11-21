import "server-only";
import type { HttpRuntime } from "../runtime/composition";
import { displayNameTargets } from "../account-display-name/service";
import { readJsonBody } from "./body";
import { uniqueQuery } from "./query";
import { errorResponse, privateJson } from "./responses";

export const accountDisplayNameRouteMethods = (path: string): readonly string[] | null => path === "/api/profile/name" ? ["GET", "POST"] : null;

export async function handleAccountDisplayNameRequest(request: Request, runtime: HttpRuntime): Promise<Response | null> {
  if (!accountDisplayNameRouteMethods(new URL(request.url).pathname)) return null;
  try {
    const query = uniqueQuery(request.url, request.method === "GET" ? displayNameTargets : []);
    const result = request.method === "GET"
      ? await runtime.accountDisplayName.read(request, Object.fromEntries(query))
      : await runtime.accountDisplayName.write(request, await readJsonBody(request, "view"));
    return privateJson(result, result.ok ? 200 : 409);
  } catch (error) {
    return errorResponse(error);
  }
}
