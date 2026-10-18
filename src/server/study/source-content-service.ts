import "server-only";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { createAccessService } from "../access/service";
import type { createPracticeService } from "../practice/service";
import { AccessDenied } from "../access/errors";
import * as assignments from "../data/source-assignments";
import { createCurrentVerseContext, snapshotCurrentVerseRequest, type CurrentVerseRequest } from "./current-verse-context";
import { selection as validateSelection, type SourceAssignmentSelection } from "./source-assignments-validation";
import * as validate from "./source-content-validation";
import { projectRelatedCatalog } from "./sources/discovery";
import { projectEditionCatalog, editionPage, selectEdition, type EditionPage } from "./sources/editions";
import { parseSourceContent, supportedEdition, sourceLeaf, SourceContentUnsupported, SourceContentUnavailable, SOURCE_CONTENT_LIMITS as L, MOTHER_TONGUES, type ContentSelection, type SourceText } from "./sources/content";
import type { RelatedSourceCatalog, RelatedSourceMetadata, SourceEditionCatalog } from "./sources/metadata";
export type SourceContentError="source-not-found"|"invalid-request"|"stale-revision"|"source-set-changed"|"source-catalog-changed"|"edition-catalog-changed"|"unsupported-source"|"unsupported-edition"|"unavailable";
const failure=(error:SourceContentError)=>Object.freeze({ok:false as const,error});
type PublicOutcome={status:"ready";source:RelatedSourceMetadata;editions:EditionPage}|{status:"ready";source:RelatedSourceMetadata;text:SourceText}|{status:"missing"}|{status:"error";error:SourceContentError};
/** Bounded provider cancellation never becomes the caller/final authority signal. */
async function publicPhase<T>(caller:AbortSignal|undefined,action:(call:<V>(load:(signal:AbortSignal)=>Promise<V>)=>Promise<V>)=>Promise<T>):Promise<T>{
  const phase=new AbortController(),end=performance.now()+L.totalMs;
  const stop=()=>phase.abort();caller?.addEventListener("abort",stop,{once:true});if(caller?.aborted)stop();
  const timer=setTimeout(stop,L.totalMs);
  const call=async<V>(load:(signal:AbortSignal)=>Promise<V>):Promise<V>=>{
    const controller=new AbortController(),abort=()=>controller.abort();phase.signal.addEventListener("abort",abort,{once:true});
    let rejectWait:()=>void=()=>{};const rejected=new Promise<never>((_,reject)=>{rejectWait=()=>reject(new SourceContentUnavailable());});
    const onAbort=()=>rejectWait();controller.signal.addEventListener("abort",onAbort,{once:true});
    const callStart=performance.now(),callEnd=Math.min(callStart+L.callMs,end),remaining=callEnd-callStart,callTimer=setTimeout(abort,Math.max(1,remaining));
    try{if(phase.signal.aborted||remaining<=0){abort();throw new SourceContentUnavailable();}
      const result=await Promise.race([Promise.resolve().then(()=>load(controller.signal)),rejected]);
      if(controller.signal.aborted||phase.signal.aborted||performance.now()>=callEnd)throw new SourceContentUnavailable();return result;
    }finally{clearTimeout(callTimer);controller.abort();controller.signal.removeEventListener("abort",onAbort);phase.signal.removeEventListener("abort",abort);}
  };
  try{const result=await action(call);if(phase.signal.aborted||performance.now()>=end)throw new SourceContentUnavailable();return result;}finally{clearTimeout(timer);phase.abort();caller?.removeEventListener("abort",stop);}
}
export function createSourceContentService<Q extends PgQueryResultHKT>(input:{access:ReturnType<typeof createAccessService<Q>>;practice:ReturnType<typeof createPracticeService<Q>>;
  related:(ref:string,signal:AbortSignal)=>Promise<RelatedSourceCatalog>;editions:(work:string,signal:AbortSignal)=>Promise<SourceEditionCatalog>;content:(selection:ContentSelection,signal:AbortSignal)=>Promise<unknown>}){
  const authorized=createCurrentVerseContext(input);
  async function read(original:CurrentVerseRequest,supplied:SourceAssignmentSelection,suppliedIntent:validate.EditionIntent|validate.TextIntent,text:boolean){
    const request=snapshotCurrentVerseRequest(original),selection=validateSelection(supplied),intent=text?validate.textIntent(suppliedIntent):validate.editionIntent(suppliedIntent);
    const first=await authorized(request,selection,intent.verseRef,async(tx,actor,captured)=>{
      let source:RelatedSourceMetadata|undefined,headBinding:string|null=null;
      if(intent.sourceScope==="assigned"){
        const head=await assignments.latest(tx,actor,selection,intent.verseRef);
        if(!head||head.version!==intent.expectedSetVersion)return {tag:"error" as const,error:"source-set-changed" as const};
        const citations=assignments.citations(head);source=citations.find(row=>row.id===intent.sourceId);
        if(!source)return {tag:"error" as const,error:"source-not-found" as const};
        headBinding=JSON.stringify([head.id,head.version,citations]);
      }
      return {tag:"captured" as const,binding:captured.binding,envelope:captured.envelope,source,headBinding};
    });
    if("ok"in first)return failure("stale-revision");if(first.tag==="error")return failure(first.error);
    let outcome:PublicOutcome;
    try{outcome=await publicPhase(request.signal,async call=>{
      const projected:PublicOutcome=await (async ():Promise<PublicOutcome>=>{
      let source=first.source;
      if(intent.sourceScope==="related"){
        const catalog=projectRelatedCatalog(await call(signal=>input.related(intent.verseRef,signal)),intent.verseRef);
        if(catalog.catalogHash!==intent.sourceCatalogHash)return {status:"error",error:"source-catalog-changed"};
        source=catalog.entries.find(row=>row.id===intent.sourceId);if(!source)return {status:"missing"};
      }
      if(!source)throw new SourceContentUnavailable();
      const catalog=projectEditionCatalog(await call(signal=>input.editions(source.indexTitle,signal)),source.indexTitle);
      if(intent.editionCatalogHash!==undefined&&catalog.editionCatalogHash!==intent.editionCatalogHash)return {status:"error",error:"edition-catalog-changed"};
      if(!text){try{return {status:"ready",source,editions:editionPage(catalog,(intent as validate.EditionIntent).editionOffset)};}catch{return {status:"error",error:"invalid-request"};}}
      const selected=intent as validate.TextIntent;sourceLeaf(source);
      const edition=selectEdition(catalog,selected.language,selected.editionTitle);if(!edition)throw new SourceContentUnsupported("edition");supportedEdition(edition,selected.language);
      const raw=await call(signal=>input.content(Object.freeze({ref:source.ref,indexTitle:source.indexTitle,editionTitle:edition.versionTitle,language:edition.language,actualLanguage:selected.language,motherTongue:MOTHER_TONGUES[selected.language]}),signal));
      const content=parseSourceContent(raw,{source,edition,language:selected.language});return {status:"ready",source,text:content};
      })();
      if(projected.status==="ready"){const result={ok:true,...first.envelope,source:projected.source,...(intent.sourceScope==="assigned"?{expectedSetVersion:intent.expectedSetVersion}:{sourceCatalogHash:intent.sourceCatalogHash}),...("text"in projected?{text:projected.text}:{editions:projected.editions})};if(Buffer.byteLength(JSON.stringify(result))>L.responseBytes)return {status:"error",error:"unavailable"};}
      return projected;
    });}catch(error){outcome={status:"error",error:error instanceof SourceContentUnsupported?error.profile==="source"?"unsupported-source":"unsupported-edition":"unavailable"};}
    return authorized(request,selection,intent.verseRef,async(tx,actor,captured)=>{
      if(captured.binding!==first.binding)return failure("stale-revision");
      if(intent.sourceScope==="assigned"){
        const head=await assignments.latest(tx,actor,selection,intent.verseRef);
        if(!head||JSON.stringify([head.id,head.version,assignments.citations(head)])!==first.headBinding)return failure("source-set-changed");
      }
      if(outcome.status==="missing")return failure("source-not-found");
      if(outcome.status==="error")return failure(outcome.error);
      const result=Object.freeze({ok:true as const,...captured.envelope,source:outcome.source,...(intent.sourceScope==="assigned"?{expectedSetVersion:intent.expectedSetVersion}:{sourceCatalogHash:intent.sourceCatalogHash}),...("text"in outcome?{text:outcome.text}:{editions:outcome.editions})});
      captured.live();return result;
    }).then(result=>"ok"in result&&!result.ok&&"code"in result?failure("stale-revision"):result);
  }
  return Object.freeze({editions:(request:CurrentVerseRequest,selection:SourceAssignmentSelection,intent:validate.EditionIntent)=>read(request,selection,intent,false),text:(request:CurrentVerseRequest,selection:SourceAssignmentSelection,intent:validate.TextIntent)=>read(request,selection,intent,true)});
}
