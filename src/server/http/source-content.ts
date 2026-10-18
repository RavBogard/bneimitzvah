import "server-only";
import type { HttpRuntime } from "../runtime/composition";
import { selection } from "../study/source-assignments-validation";
import { editionIntent, textIntent } from "../study/source-content-validation";
import { uniqueQuery } from "./query";
import { errorResponse, HttpBoundaryError, privateHeaders, privateJson, type JsonValue } from "./responses";
const binding=["mode","kind","assignmentId","assignmentRevision"],common=["verseRef","sourceId","sourceScope","expectedSetVersion","sourceCatalogHash"];
function route(path:string){const found=/^\/api\/students\/([^/]+)\/source-(editions|text)$/.exec(path);return found?{studentId:found[1],text:found[2]==="text"}:null;}
export function sourceContentRouteMethods(path:string):readonly string[]|null{return route(path)?["GET"]:null;}
export async function handleSourceContentRequest(request:Request,runtime:HttpRuntime):Promise<Response|null>{
  const found=route(new URL(request.url).pathname);if(!found)return null;
  try{
    if(request.method!=="GET"){const response=errorResponse(new HttpBoundaryError(405));response.headers.set("allow","GET");return response;}
    if(request.body!==null||request.headers.has("transfer-encoding")||request.headers.has("content-length")&&request.headers.get("content-length")!=="0")throw new HttpBoundaryError();
    const keys=[...binding,...common,...(found.text?["editionCatalogHash","editionTitle","language"]:["editionOffset","editionCatalogHash"])],query=uniqueQuery(request.url,keys),revision=query.get("assignmentRevision");
    const number=(value:string|null)=>{if(value===null||!/^(?:0|[1-9][0-9]{0,9})$/.test(value))throw new HttpBoundaryError();return Number(value);};
    const selected=selection({studentId:found.studentId,...Object.fromEntries(binding.map(k=>[k,k==="assignmentRevision"?number(revision):query.get(k)]))});
    const value=Object.fromEntries([...query].filter(([k])=>!binding.includes(k)).map(([k,v])=>[k,k==="expectedSetVersion"||k==="editionOffset"?number(v):v]));
    const result=found.text?await runtime.sourceContent.text(request,selected,textIntent(value)):await runtime.sourceContent.editions(request,selected,editionIntent(value));
    if(result.ok)return privateJson(result as JsonValue);
    const status=result.error==="source-not-found"?404:result.error==="invalid-request"?400:result.error==="unavailable"?503:result.error==="unsupported-source"||result.error==="unsupported-edition"?422:409;
    const headers=privateHeaders();headers.set("content-type","application/json; charset=utf-8");return new Response(JSON.stringify(result),{status,headers});
  }catch(error){return errorResponse(error);}
}
