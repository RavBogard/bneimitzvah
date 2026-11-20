import "server-only";
import type { HttpRuntime } from "../runtime/composition";
import { parsePronounSubject } from "../pronouns/service";
import { readJsonBody } from "./body";
import { uniqueQuery } from "./query";
import { errorResponse, privateJson, type JsonValue } from "./responses";

export const pronounsRouteMethods = (path: string): readonly string[] | null => path === "/api/profile/pronouns" ? ["GET", "POST"] : null;
export async function handlePronounsRequest(request: Request, runtime: HttpRuntime): Promise<Response | null> {
  if (!pronounsRouteMethods(new URL(request.url).pathname)) return null;
  try {
    const query = uniqueQuery(request.url, request.method === "GET" ? ["type", "membershipId", "studentId", "mode"] : []);
    const result = request.method === "GET" ? await runtime.pronouns.read(request, parsePronounSubject(Object.fromEntries(query))) : await runtime.pronouns.write(request, await readJsonBody(request));
    return privateJson(result as unknown as JsonValue, result.ok ? 200 : 409);
  } catch (error) { return errorResponse(error); }
}
