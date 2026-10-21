import "server-only";
import type { ActiveMode } from "../access/types";
import type { HttpRuntime } from "../runtime/composition";
import { closedObject, uniqueQuery } from "./query";
import { readJsonBody } from "./body";
import { requireCookieMutation } from "./mutations";
import { material } from "./service-learning";
import { errorResponse, HttpBoundaryError, privateJson, type JsonValue } from "./responses";

const route = (path: string) => /^\/api\/students\/([^/]+)\/my-service(?:\/(synchronize|assign|progress|request|respond|resource|material|separate|resolve-original))?$/.exec(path);
export function serviceEcosystemRouteMethods(path: string): readonly string[] | null { if(path==="/api/internal/service-ecosystem/drain")return ["GET"];const match = route(path); return match ? [match[2] ? "POST" : "GET"] : null; }
const text = (value: unknown, max = 4000) => { if (typeof value !== "string" || value.length > max) throw new HttpBoundaryError(); return value; };
const number = (value: unknown) => { if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > 2_147_483_646) throw new HttpBoundaryError(); return Number(value); };
export async function handleServiceEcosystemRequest(request: Request, runtime: HttpRuntime): Promise<Response | null> {
  if(new URL(request.url).pathname==="/api/internal/service-ecosystem/drain"){
    try{if(request.method!=="GET")throw new HttpBoundaryError(405);uniqueQuery(request.url,[]);return privateJson(await runtime.serviceScheduler.drain(request));}catch(error){return errorResponse(error);}
  }
  const match = route(new URL(request.url).pathname); if (!match) return null;
  try {
    const operation = match[2], expectedMethod = operation ? "POST" : "GET";
    if (request.method !== expectedMethod) { const response = errorResponse(new HttpBoundaryError(405)); response.headers.set("allow", expectedMethod); return response; }
    const query = uniqueQuery(request.url, operation ? [] : ["mode"]);
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(match[1])) throw new HttpBoundaryError();
    const keys = operation === "assign" ? ["rowId", "expectedRevision", "expectedStudentRevision", "sourceRevision", "leads", "directions", "privateFeedback"] : operation === "progress" ? ["rowId", "expectedRevision", "progress"]
      : operation === "request" ? ["rowId", "message"] : operation === "respond" ? ["requestId", "expectedRevision", "state", "response"] : operation === "resource" ? ["rowId", "resourceId"] : operation === "material" ? ["rowId"] : operation === "separate"||operation==="resolve-original" ? ["expectedCeremonyRevision"] : [];
    if (operation) requireCookieMutation(request, runtime.origin);
    const body = operation ? closedObject(await readJsonBody(request, "work"), ["mode", ...keys], operation === "synchronize" ? ["explicitSetlistId"] : operation === "assign" ? ["material"] : []) : { mode: query.get("mode") };
    if (!["student","parent","tutor","admin","child-practice"].includes(String(body.mode))) throw new HttpBoundaryError();
    if(body.mode!=="child-practice" && request.headers.has("X-Practice-Context"))throw new HttpBoundaryError();
    const selection = { studentId: match[1], mode: body.mode as ActiveMode|"child-practice" }, service = runtime.serviceEcosystem;
    let result;
    if (!operation) result = await service.view(request, selection);
    else if(operation === "separate")result=await service.separate(request,{...selection,expectedCeremonyRevision:number(body.expectedCeremonyRevision)});
    else if(operation === "resolve-original")result=await service.resolveOriginal(request,{...selection,expectedCeremonyRevision:number(body.expectedCeremonyRevision)});
    else if(operation === "material")return privateJson({material:material(await runtime.serviceLearning.ceremonyUnit(request,{...selection,rowId:text(body.rowId,128)}))});
    else if (operation === "synchronize") result = await service.synchronize(request, { ...selection, ...(body.explicitSetlistId === undefined ? {} : { explicitSetlistId: text(body.explicitSetlistId, 128) }) });
    else if (operation === "assign") {
      if (typeof body.leads !== "boolean") throw new HttpBoundaryError();
      const mapping=body.material===undefined?undefined:body.material===null?null:closedObject(body.material,["catalogId","catalogIdentity","unitId"]);
      result = await service.assign(request, { ...selection, rowId: text(body.rowId, 128), expectedRevision: number(body.expectedRevision), expectedStudentRevision:number(body.expectedStudentRevision),sourceRevision:text(body.sourceRevision,256),leads: body.leads, directions: text(body.directions), privateFeedback: text(body.privateFeedback),
        material:mapping?{catalogId:text(mapping.catalogId,36),catalogIdentity:text(mapping.catalogIdentity,64),unitId:text(mapping.unitId,128)}:mapping });
    }
    else if (operation === "progress") { if (!["not-started", "practicing", "ready"].includes(String(body.progress))) throw new HttpBoundaryError(); result = await service.progress(request, { ...selection, rowId: text(body.rowId, 128), expectedRevision: number(body.expectedRevision), progress: body.progress as "not-started" | "practicing" | "ready" }); }
    else if (operation === "request") result = await service.requestChange(request, { ...selection, rowId: text(body.rowId, 128), message: text(body.message, 2000) });
    else if (operation === "respond") { if (body.state !== "accepted" && body.state !== "declined") throw new HttpBoundaryError(); result = await service.respond(request, { ...selection, requestId: text(body.requestId, 36), expectedRevision: number(body.expectedRevision), state: body.state, response: text(body.response, 2000) }); }
    else result = await service.resource(request, { ...selection, rowId: text(body.rowId, 128), resourceId: text(body.resourceId, 128) });
    const output = JSON.parse(JSON.stringify(result)) as JsonValue;
    if (Buffer.byteLength(JSON.stringify(output)) > 256 * 1024) throw new Error("Service projection unavailable");
    return privateJson(output, "ok" in result && result.ok === false ? 409 : 200);
  } catch (error) { return errorResponse(error); }
}
