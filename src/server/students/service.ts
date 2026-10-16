import "server-only";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { createAccessService } from "../access/service";
import type { ActiveMode,Actor } from "../access/types";
import { AccessDenied,AccessUnavailable } from "../access/errors";
import { requireCookieMutation,type CookieMutationRequest } from "../http/mutations";
import * as data from "../data/roster";
import { TANAKH_VERSE_COUNTS } from "../../lib/readings/catalog";
import { parsePick,type Pick } from "../../lib/readings/leyning.mjs";
import { expandReadingRanges,type CeremonyDate,type VerseCounts } from "../../lib/readings/ranges";
import { proposeReading,ReadingUnavailable,type Calendar,type Snapshot } from "../../lib/readings/proposals";
import { createBindings,digest } from "./bindings";
import { identifier,parseStudentCsv,revision,studentInput,type StudentInput } from "./validation";
import { validatedSnapshot } from "./preparation";

type Mode={mode:ActiveMode};
type Kind="torah"|"haftarah";
type Basis="triennial"|"selection"|"full"|"custom";
type Preparation={kind:Kind;basis:Basis;ranges:string[];snapshot:Snapshot;sourceFetchedAt:number|null;sourceStatus:"available"|"unavailable";maftir:unknown};
const conflict=()=>({ok:false as const,code:"stale-revision" as const});
const object=(value:unknown):value is Record<string,unknown>=>!!value && typeof value==="object" && !Array.isArray(value);
function calendarCustoms(customs:unknown){
  if(!object(customs))throw new AccessDenied(403);
  const calendar:Calendar=customs.calendar==="diaspora" || (object(customs.calendar)&&customs.calendar.diaspora===true)?"diaspora"
    :customs.calendar==="israel" || (object(customs.calendar)&&customs.calendar.diaspora===false)?"israel":(()=>{throw new AccessDenied(403);})();
  if(customs.toConfirm!==undefined && (!Array.isArray(customs.toConfirm) || customs.toConfirm.length>20 || customs.toConfirm.some(x=>typeof x!=="string" || x.length>40)))throw new AccessDenied(403);
  let pick:string|undefined;
  if(customs.torah!==undefined){
    if(!object(customs.torah) || !["full","triennial","selection","weekly-selection"].includes(String(customs.torah.mode)))throw new AccessDenied(403);
    if(customs.torah.mode==="full" || customs.torah.mode==="triennial")pick=customs.torah.mode;
    else pick="explicit-selection-required";
  }
  return {calendar,pick};
}
const actorBinding=(actor:Actor)=>({tenantId:actor.tenantId,userId:actor.userId,authSessionId:actor.authSessionId,roleGrantId:actor.roleGrantId,mode:actor.mode});
const sameActor=(claim:Record<string,unknown>,actor:Actor)=>digest(claim.actor)===digest(actorBinding(actor));
const duplicateKey=(row:StudentInput)=>digest([row.firstName,row.lastName,row.ceremonyDate,row.parentEmail,row.ownEmail]);
const rosterState=(rows:{id:string;revision:number}[])=>digest(rows.map(row=>[row.id,row.revision]));
function duplicates(rows:StudentInput[],existing:StudentInput[],rowNumbers:number[]){
  const seen=new Set(existing.map(duplicateKey));const indices:number[]=[];
  rows.forEach((row,index)=>{const key=duplicateKey(row);if(seen.has(key))indices.push(rowNumbers[index]);seen.add(key);});return indices;
}

export function createStudentService<Q extends PgQueryResultHKT>(input:{
  access:ReturnType<typeof createAccessService<Q>>; signingSecret:string;
  loadReading:(date:string,calendar:Calendar)=>Promise<{snapshot:Snapshot;fetchedAt:number}>;
  verseCounts?:VerseCounts; now?:()=>number;
}){
  const now=input.now??Date.now,counts=input.verseCounts??TANAKH_VERSE_COUNTS;
  const bindings=createBindings(input.signingSecret,now);

  async function listRoster(request:CookieMutationRequest,selection:Mode){
    return input.access.withAdminCapability(request,{mode:selection.mode,capability:"manage-students"},async(tx,actor)=>{
      const rows=await data.roster(tx,actor.tenantId);
      if(rows.length>5000)throw new AccessDenied(403);
      return rows.map(({id,firstName,lastName,ceremonyDate,parentEmail,ownEmail,disabledAt,revision})=>({id,firstName,lastName,ceremonyDate,parentEmail,ownEmail,disabledAt,revision}));
    });
  }
  async function create(request:CookieMutationRequest,selection:Mode&{student:unknown}){
    const values=studentInput(selection.student);
    return input.access.withAdminCapability(request,{mode:selection.mode,capability:"manage-students"},async(tx,actor)=>{
      requireCookieMutation(request,actor.origin);
      const student=await data.insertStudent(tx,actor.tenantId,values);
      await data.audit(tx,actor,"student.create",student.id);
      return {id:student.id,revision:student.revision};
    });
  }
  async function edit(request:CookieMutationRequest,selection:Mode&{studentId:string;expectedRevision:number;student:unknown}){
    const id=identifier(selection.studentId),expected=revision(selection.expectedRevision),values=studentInput(selection.student);
    return input.access.withAdminCapability(request,{mode:selection.mode,capability:"manage-students"},async(tx,actor)=>{
      requireCookieMutation(request,actor.origin);
      const current=await data.editableStudent(tx,actor.tenantId,id);
      if(!current || current.disabledAt)throw new AccessDenied(404);
      if(current.revision!==expected)return conflict();
      const updated=await data.updateStudent(tx,actor.tenantId,id,expected,values);
      if(!updated)return conflict();
      const readingNeedsReview=current.ceremonyDate!==values.ceremonyDate;
      if(readingNeedsReview)await data.markReadingsForReview(tx,actor.tenantId,id);
      await data.audit(tx,actor,"student.update",id);
      return {ok:true as const,id,revision:updated.revision,readingNeedsReview};
    });
  }
  async function disable(request:CookieMutationRequest,selection:Mode&{studentId:string;expectedRevision:number}){
    const id=identifier(selection.studentId),expected=revision(selection.expectedRevision);
    return input.access.withAdminCapability(request,{mode:selection.mode,capability:"manage-students"},async(tx,actor)=>{
      requireCookieMutation(request,actor.origin);
      const current=await data.editableStudent(tx,actor.tenantId,id);
      if(!current || current.disabledAt)throw new AccessDenied(404);
      if(current.revision!==expected)return conflict();
      const updated=await data.updateStudent(tx,actor.tenantId,id,expected,{disabledAt:new Date(now())});
      if(!updated)return conflict();
      await data.audit(tx,actor,"student.update",id);
      return {ok:true as const,id,revision:updated.revision};
    });
  }
  async function previewImport(request:CookieMutationRequest,selection:Mode&{csv:string;allowDuplicates:boolean}){
    const parsed=parseStudentCsv(selection.csv);
    if(typeof selection.allowDuplicates!=="boolean")throw new AccessDenied(403);
    return input.access.withAdminCapability(request,{mode:selection.mode,capability:"manage-students"},async(tx,actor)=>{
      requireCookieMutation(request,actor.origin);
      const existing=await data.roster(tx,actor.tenantId);if(existing.length>5000)throw new AccessDenied(403);
      const duplicateRows=duplicates(parsed.rows,existing,parsed.rowNumbers);
      const canConfirm=parsed.issues.length===0 && (!duplicateRows.length || selection.allowDuplicates);
      const binding=canConfirm?bindings.sign({purpose:"student-import",actor:actorBinding(actor),input:digest(selection.csv),roster:rosterState(existing),allowDuplicates:selection.allowDuplicates}):null;
      return {validRows:parsed.rows.length,issues:parsed.issues,duplicateRows,requiresDuplicateConfirmation:duplicateRows.length>0,canConfirm,binding};
    });
  }
  async function confirmImport(request:CookieMutationRequest,selection:Mode&{csv:string;allowDuplicates:boolean;binding:string}){
    const parsed=parseStudentCsv(selection.csv),claim=bindings.verify(selection.binding,"student-import");
    if(parsed.issues.length || typeof selection.allowDuplicates!=="boolean")throw new AccessDenied(403);
    return input.access.withAdminCapability(request,{mode:selection.mode,capability:"manage-students"},async(tx,actor)=>{
      requireCookieMutation(request,actor.origin);
      if(!sameActor(claim,actor) || claim.input!==digest(selection.csv) || claim.allowDuplicates!==selection.allowDuplicates)throw new AccessDenied(403);
      const existing=await data.roster(tx,actor.tenantId);if(existing.length>5000)throw new AccessDenied(403);
      if(claim.roster!==rosterState(existing))return conflict();
      if(duplicates(parsed.rows,existing,parsed.rowNumbers).length && !selection.allowDuplicates)throw new AccessDenied(403);
      const ids:string[]=[];
      for(const values of parsed.rows){const student=await data.insertStudent(tx,actor.tenantId,values);await data.audit(tx,actor,"student.import",student.id);ids.push(student.id);}
      return {ok:true as const,ids};
    });
  }
  async function prepareReading(request:CookieMutationRequest,selection:Mode&{studentId:string;kind?:Kind;pick?:string;ranges?:string[]}){
    const id=identifier(selection.studentId),kind=selection.kind??"torah";
    if(kind!=="torah" && kind!=="haftarah")throw new AccessDenied(403);
    const baseline=await input.access.withStudentCapability(request,{mode:selection.mode,studentId:id,capability:"set-reading"},async(tx,actor,student)=>{
      requireCookieMutation(request,actor.origin);
      const customs=calendarCustoms(await data.customs(tx,actor.tenantId));
      const assignment=await data.currentAssignment(tx,actor.tenantId,id,kind);
      return {actor:actorBinding(actor),date:student.ceremonyDate,studentRevision:student.revision,assignmentRevision:assignment?.revision??0,customs};
    });
    // No network call or cache operation holds the authority transaction open.
    let loaded:{snapshot:Snapshot;fetchedAt:number|null;sourceStatus:"available"|"unavailable"};
    try{loaded={...await input.loadReading(baseline.date,baseline.customs.calendar),sourceStatus:"available"};}
    catch(error){
      if(error instanceof ReadingUnavailable && selection.ranges!==undefined){
        loaded={snapshot:{date:baseline.date as CeremonyDate,calendar:baseline.customs.calendar,reading:null,haftarah:null},fetchedAt:null,sourceStatus:"unavailable"};
      }else if(error instanceof ReadingUnavailable)throw error;
      else throw new AccessUnavailable();
    }
    if(loaded.sourceStatus==="available" && (typeof loaded.fetchedAt!=="number" || !Number.isFinite(loaded.fetchedAt) || loaded.fetchedAt>now() || now()-loaded.fetchedAt>86400000))throw new AccessDenied(403);
    const snapshot=validatedSnapshot(loaded.snapshot,baseline.date,baseline.customs.calendar,counts);
    const sourceReview={sourceFetchedAt:loaded.fetchedAt,sourceStatus:loaded.sourceStatus,warning:loaded.sourceStatus==="unavailable"?"calendar-source-unavailable" as const:null};
    const needsSelection=()=>({status:"needs-selection" as const,requiresConfirmation:true as const,snapshot,...sourceReview,toConfirm:["torah","entryCap","nusach"]});
    let ranges:string[],basis:Basis,maftir:unknown=null;
    if(selection.ranges!==undefined){
      ranges=selection.ranges;basis="custom";
      const special=kind==="torah"?snapshot.reading?.aliyot.find(row=>row.n==="M"):null;
      maftir=special?{ref:special.ref,...(special.reason?{reason:special.reason}:{})}:null;
    }
    else if(kind==="haftarah"){
      if(!snapshot.haftarah)return needsSelection();
      ranges=[snapshot.haftarah];basis="selection";
    }else{
      const pick=selection.pick??baseline.customs.pick;
      if(pick==="explicit-selection-required")return needsSelection();
      let canonicalPick:Pick|undefined;
      try{canonicalPick=pick===undefined?undefined:parsePick(pick);}catch{throw new AccessDenied(403);}
      let proposal:ReturnType<typeof proposeReading>;
      try{proposal=proposeReading(snapshot,counts,{pick:canonicalPick});}catch{throw new AccessDenied(403);}
      if(!proposal.selection)return needsSelection();
      ranges=[proposal.selection.ref];maftir=proposal.selection.maftir;
      basis=canonicalPick?.kind==="full"?"full":canonicalPick?.kind==="aliyah"?"selection":"triennial";
    }
    let verses:string[];try{verses=expandReadingRanges(ranges,kind,counts);}catch{throw new AccessDenied(403);}
    const preparation:Preparation={kind,basis,ranges,snapshot,sourceFetchedAt:loaded.fetchedAt,sourceStatus:loaded.sourceStatus,maftir};
    const binding=bindings.sign({purpose:"student-reading",actor:baseline.actor,studentId:id,studentRevision:baseline.studentRevision,assignmentRevision:baseline.assignmentRevision,date:baseline.date,calendar:baseline.customs.calendar,preparation});
    return {status:"prepared" as const,requiresConfirmation:true as const,binding,kind,basis,ranges,verseCount:verses.length,...sourceReview,maftir,toConfirm:["torah","entryCap","nusach"]};
  }
  async function confirmReading(request:CookieMutationRequest,selection:Mode&{studentId:string;binding:string}){
    const id=identifier(selection.studentId),claim=bindings.verify(selection.binding,"student-reading");
    if(claim.studentId!==id || !object(claim.preparation))throw new AccessDenied(403);
    const preparation=claim.preparation as unknown as Preparation;
    if(!["torah","haftarah"].includes(preparation.kind) || !["full","triennial","selection","custom"].includes(preparation.basis))throw new AccessDenied(403);
    let verses:string[];try{verses=expandReadingRanges(preparation.ranges,preparation.kind,counts);}catch{throw new AccessDenied(403);}
    return input.access.withStudentCapability(request,{mode:selection.mode,studentId:id,capability:"set-reading"},async(tx,actor,student)=>{
      requireCookieMutation(request,actor.origin);
      if(!sameActor(claim,actor))throw new AccessDenied(403);
      const currentCustoms=calendarCustoms(await data.customs(tx,actor.tenantId));
      if(claim.studentRevision!==student.revision || claim.date!==student.ceremonyDate || claim.calendar!==currentCustoms.calendar)return conflict();
      const current=await data.currentAssignment(tx,actor.tenantId,id,preparation.kind,true);
      if(claim.assignmentRevision!==(current?.revision??0))return conflict();
      const persisted=await data.persistAssignment(tx,actor,id,preparation.kind,current?.revision??0,{ref:preparation.ranges.join("; "),basis:preparation.basis,verses,
        snapshot:{confirmationDate:student.ceremonyDate,calendar:claim.calendar,ranges:preparation.ranges,source:preparation.snapshot,sourceFetchedAt:preparation.sourceFetchedAt,sourceStatus:preparation.sourceStatus,maftir:preparation.maftir,needsReview:false}});
      if(!persisted)return conflict();
      await data.audit(tx,actor,"reading.set",id,persisted.id);
      return {ok:true as const,assignmentId:persisted.id,revision:persisted.revision};
    });
  }
  return {listRoster,create,edit,disable,previewImport,confirmImport,prepareReading,confirmReading};
}
