import "server-only";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { createAccessService } from "../access/service";
import type { ActiveMode,Actor,StudentActor } from "../access/types";
import { AccessDenied,AccessUnavailable } from "../access/errors";
import { requireCookieMutation,type CookieMutationRequest } from "../http/mutations";
import * as data from "../data/roster";
import { TANAKH_VERSE_COUNTS } from "../../lib/readings/catalog";
import { parsePick,type Pick } from "../../lib/readings/leyning.mjs";
import { expandReadingRanges,type CeremonyDate,type VerseCounts } from "../../lib/readings/ranges";
import { proposeReading,ReadingUnavailable,type Calendar,type Snapshot } from "../../lib/readings/proposals";
import { createBindings,digest } from "./bindings";
import { identifier,parseStudentCsv,revision,studentInput,type StudentInput,type CsvParse } from "./validation";
import { readingDate } from "../../lib/readings/reading-date";
import { validatedSnapshot } from "./preparation";
import { aliyahStarts } from "../../lib/readings/aliyah-starts";
import { readingView } from "../portal/service";
import { markForReview as markServicePlanForReview } from "../service-learning/data";
import { scheduleCeremony } from "../service-ecosystem/scheduling";

type Mode={mode:ActiveMode};
type Kind="torah"|"haftarah";
type Basis="triennial"|"selection"|"full"|"custom";
type Preparation={cutsVersion:1;kind:Kind;basis:Basis;ranges:string[];aliyahStarts:string[]|null} & (
  {preparationMode:"replace";snapshot:Snapshot;sourceFetchedAt:number|null;sourceStatus:"available"|"unavailable"|"not-requested";maftir:unknown}
  | {preparationMode:"current-assignment";snapshotDigest:string;refDigest:string});
const conflict=()=>({ok:false as const,code:"stale-revision" as const});
const assertSessionLive=(expiresAt:number)=>{if(expiresAt<=Date.now())throw new AccessDenied(401);};
const object=(value:unknown):value is Record<string,unknown>=>!!value && typeof value==="object" && !Array.isArray(value);
export function calendarCustoms(customs:unknown){
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
export const actorBinding=(actor:Actor&{relationshipId?:StudentActor["relationshipId"];relationshipRevision?:StudentActor["relationshipRevision"]})=>({origin:actor.origin,membershipId:actor.membershipId,authorityRevision:actor.authorityRevision,roleGrantRevision:actor.roleGrantRevision,...("relationshipId" in actor?{relationshipId:actor.relationshipId,relationshipRevision:actor.relationshipRevision}:{}),tenantId:actor.tenantId,userId:actor.userId,authSessionId:actor.authSessionId,roleGrantId:actor.roleGrantId,mode:actor.mode});
const sameActor=(claim:Record<string,unknown>,actor:Actor)=>digest(claim.actor)===digest(actorBinding(actor));
const duplicateKey=(row:StudentInput)=>digest([row.firstName,row.lastName,row.ceremonyDate,row.studentKind,row.parentEmail,row.ownEmail]);
const rosterState=(rows:{id:string;revision:number}[])=>digest(rows.map(row=>[row.id,row.revision]));
function duplicates(rows:StudentInput[],existing:StudentInput[],rowNumbers:number[]){
  const seen=new Set(existing.map(duplicateKey));const indices:number[]=[];
  rows.forEach((row,index)=>{const key=duplicateKey(row);if(seen.has(key))indices.push(rowNumbers[index]);seen.add(key);});return indices;
}
const normalizedTutorName=(value:string)=>value.normalize("NFKC").trim().replace(/\s+/g," ").toLowerCase();
function matchedImport(parsed:CsvParse,tutors:Awaited<ReturnType<typeof data.importTutors>>){
  const names=new Set(parsed.rows.map(row=>row.importMetadata?.tutorName).filter((name):name is string=>!!name).map(normalizedTutorName));
  const relevant=tutors.filter(tutor=>names.has(normalizedTutorName(tutor.name)));
  const tutorMatches:{row:number;status:"matched"|"unmatched"|"ambiguous"}[]=[],missingSecondParentRows:number[]=[];
  const rows=parsed.rows.map((row,index)=>{
    const metadata=row.importMetadata;if(!metadata)return row;
    if(!metadata.parent2Name || !row.secondParentEmail)missingSecondParentRows.push(parsed.rowNumbers[index]);
    if(!metadata.tutorName)return row;
    const matches=relevant.filter(tutor=>normalizedTutorName(tutor.name)===normalizedTutorName(metadata.tutorName!));
    const tutorMatch=matches.length===1?{status:"matched" as const,grantId:matches[0].grantId}:{status:matches.length?"ambiguous" as const:"unmatched" as const};
    tutorMatches.push({row:parsed.rowNumbers[index],status:tutorMatch.status});
    return {...row,importMetadata:{...metadata,tutorMatch}};
  });
  return {rows,tutorMatches,missingSecondParentRows,tutorSnapshot:digest(relevant)};
}

export function createStudentService<Q extends PgQueryResultHKT>(input:{
  access:ReturnType<typeof createAccessService<Q>>; signingSecret:string;
  loadReading:(date:string,calendar:Calendar)=>Promise<{snapshot:Snapshot;fetchedAt:number}>;
  verseCounts?:VerseCounts; now?:()=>number;
  afterSchedule?:(request:CookieMutationRequest,selection:{mode:ActiveMode;studentId:string})=>Promise<unknown>;
  dispatchScheduled?:()=>void|Promise<void>;
}){
  const now=input.now??Date.now,counts=input.verseCounts??TANAKH_VERSE_COUNTS;
  const bindings=createBindings(input.signingSecret,now);
  const afterSchedule=async(request:CookieMutationRequest,mode:ActiveMode,ids:string[])=>{
    if(input.dispatchScheduled){try{await input.dispatchScheduled();}catch{/* The durable queue survives an unavailable dispatcher. */}return;}
    // Intake is already committed. Remote failure cannot undo roster work.
    for(const studentId of ids)try{await input.afterSchedule?.(request,{mode,studentId});}catch{/* Durable pending work remains retryable. */}
  };

  async function listRoster(request:CookieMutationRequest,selection:Mode){
    return input.access.withAdminCapability(request,{mode:selection.mode,capability:"manage-students"},async(tx,actor)=>{
      const rows=await data.roster(tx,actor.tenantId);
      if(rows.length>5000)throw new AccessDenied(403);
      return rows.map(({id,firstName,lastName,ceremonyDate,serviceSlot,studentKind,parentEmail,ownEmail,hebrewName,secondParentEmail,importMetadata,disabledAt,revision})=>({id,firstName,lastName,ceremonyDate,serviceSlot,studentKind,parentEmail,ownEmail,hebrewName,secondParentEmail,importMetadata,disabledAt,revision}));
    });
  }
  async function create(request:CookieMutationRequest,selection:Mode&{student:unknown}){
    const values=studentInput(selection.student);
    const result=await input.access.withAdminCapability(request,{mode:selection.mode,capability:"manage-students"},async(tx,actor)=>{
      requireCookieMutation(request,actor.origin);
      const student=await data.insertStudent(tx,actor.tenantId,values);
      await scheduleCeremony(tx,actor.tenantId,student,now());
      await data.audit(tx,actor,"student.create",student.id);
      return {id:student.id,revision:student.revision};
    });
    await afterSchedule(request,selection.mode,[result.id]);return result;
  }
  async function edit(request:CookieMutationRequest,selection:Mode&{studentId:string;expectedRevision:number;student:unknown}){
    const id=identifier(selection.studentId),expected=revision(selection.expectedRevision),values=studentInput(selection.student);
    const result=await input.access.withAdminCapability(request,{mode:selection.mode,capability:"manage-students"},async(tx,actor)=>{
      requireCookieMutation(request,actor.origin);
      const current=await data.editableStudent(tx,actor.tenantId,id);
      if(!current || current.disabledAt)throw new AccessDenied(404);
      if(current.revision!==expected)return conflict();
      if(values.ownEmail!==null && values.ownEmail===(values.secondParentEmail===undefined?current.secondParentEmail:values.secondParentEmail))throw new AccessDenied(403);
      const updated=await data.updateStudent(tx,actor.tenantId,id,expected,values);
      if(!updated)return conflict();
      const readingNeedsReview=current.ceremonyDate!==values.ceremonyDate || current.serviceSlot!==values.serviceSlot;
      if(readingNeedsReview){await data.markReadingsForReview(tx,actor.tenantId,id);await markServicePlanForReview(tx,actor.tenantId,id);await scheduleCeremony(tx,actor.tenantId,updated,now());}
      await data.audit(tx,actor,"student.update",id);
      return {ok:true as const,id,revision:updated.revision,readingNeedsReview};
    });
    if(result.ok)await afterSchedule(request,selection.mode,[id]);return result;
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
      assertSessionLive(actor.authSessionExpiresAt);
      const tutors=parsed.rows.some(row=>row.importMetadata?.tutorName)?await data.importTutors(tx,actor.tenantId):[];if(tutors.length>5000)throw new AccessDenied(403);
      assertSessionLive(actor.authSessionExpiresAt);
      const matched=matchedImport(parsed,tutors);
      const duplicateRows=duplicates(parsed.rows,existing,parsed.rowNumbers);
      const canConfirm=parsed.issues.length===0 && (!duplicateRows.length || selection.allowDuplicates);
      const binding=canConfirm?bindings.sign({purpose:"student-import",actor:actorBinding(actor),input:digest(selection.csv),roster:rosterState(existing),tutors:matched.tutorSnapshot,allowDuplicates:selection.allowDuplicates}):null;
      return {validRows:parsed.rows.length,issues:parsed.issues,duplicateRows,requiresDuplicateConfirmation:duplicateRows.length>0,canConfirm,binding,
        tutorMatches:matched.tutorMatches,missingSecondParentRows:matched.missingSecondParentRows,tutorAssignmentsPending:true as const};
    });
  }
  async function confirmImport(request:CookieMutationRequest,selection:Mode&{csv:string;allowDuplicates:boolean;binding:string}){
    const parsed=parseStudentCsv(selection.csv),claim=bindings.verify(selection.binding,"student-import");
    if(parsed.issues.length || typeof selection.allowDuplicates!=="boolean")throw new AccessDenied(403);
    const result=await input.access.withAdminCapability(request,{mode:selection.mode,capability:"manage-students"},async(tx,actor)=>{
      requireCookieMutation(request,actor.origin);
      if(!sameActor(claim,actor) || claim.input!==digest(selection.csv) || claim.allowDuplicates!==selection.allowDuplicates)throw new AccessDenied(403);
      const existing=await data.roster(tx,actor.tenantId);if(existing.length>5000)throw new AccessDenied(403);
      assertSessionLive(actor.authSessionExpiresAt);
      if(claim.roster!==rosterState(existing))return conflict();
      const tutors=parsed.rows.some(row=>row.importMetadata?.tutorName)?await data.importTutors(tx,actor.tenantId):[];if(tutors.length>5000)throw new AccessDenied(403);
      assertSessionLive(actor.authSessionExpiresAt);
      const matched=matchedImport(parsed,tutors);
      if(claim.tutors!==matched.tutorSnapshot)return conflict();
      if(duplicates(parsed.rows,existing,parsed.rowNumbers).length && !selection.allowDuplicates)throw new AccessDenied(403);
      const ids:string[]=[];
      for(const values of matched.rows){assertSessionLive(actor.authSessionExpiresAt);const student=await data.insertStudent(tx,actor.tenantId,values);await scheduleCeremony(tx,actor.tenantId,student,now());await data.audit(tx,actor,"student.import",student.id);ids.push(student.id);}
      assertSessionLive(actor.authSessionExpiresAt);
      return {ok:true as const,ids};
    });
    if(result.ok)await afterSchedule(request,selection.mode,result.ids);return result;
  }
  async function prepareReading(request:CookieMutationRequest,selection:Mode&{studentId:string;kind?:Kind;pick?:string;ranges?:string[];aliyahStarts?:string[];preparationMode?:"current-assignment";expectedAssignmentRevision?:number}){
    const id=identifier(selection.studentId),kind=selection.kind??"torah";
    if(kind!=="torah" && kind!=="haftarah")throw new AccessDenied(403);
    if(selection.aliyahStarts!==undefined && (kind!=="torah" || !Array.isArray(selection.aliyahStarts)))throw new AccessDenied(403);
    const currentOnly=selection.preparationMode==="current-assignment";
    if(selection.preparationMode!==undefined && !currentOnly || currentOnly && (kind!=="torah" || selection.ranges!==undefined || selection.pick!==undefined)
      || !currentOnly && selection.expectedAssignmentRevision!==undefined)throw new AccessDenied(403);
    if(currentOnly)revision(selection.expectedAssignmentRevision);
    if(selection.ranges!==undefined)try{expandReadingRanges(selection.ranges,kind,counts);}catch{throw new AccessDenied(403);}
    const baseline=await input.access.withStudentCapability(request,{mode:selection.mode,studentId:id,capability:"set-reading"},async(tx,actor,student)=>{
      requireCookieMutation(request,actor.origin);
      const customs=calendarCustoms(await data.customs(tx,actor.tenantId));
      const assignment=await data.currentAssignment(tx,actor.tenantId,id,kind,currentOnly?"share":false);
      const current=await data.studentReadingContext(tx,actor.tenantId,id);
      if(!current)throw new AccessDenied(404);
      const storedVerses=currentOnly && assignment?await data.assignmentVerses(tx,actor.tenantId,id,assignment.id):null;
      assertSessionLive(actor.authSessionExpiresAt);
      return {actor:actorBinding(actor),sessionExpiresAt:actor.authSessionExpiresAt,date:student.ceremonyDate,serviceSlot:current.serviceSlot,...readingDate(student.ceremonyDate,current.serviceSlot),studentRevision:student.revision,assignmentRevision:assignment?.revision??0,assignment,storedVerses,customs};
    });
    const resolveCuts=(verses:string[])=>{try{return aliyahStarts(kind,selection.aliyahStarts===undefined?(baseline.assignment?.aliyahStarts??null):selection.aliyahStarts,verses);}catch{throw new AccessDenied(403);}};
    if(currentOnly){
      const current=baseline.assignment;if(!current || current.status!=="confirmed" || !baseline.storedVerses)throw new AccessDenied(404);
      if(current.revision!==selection.expectedAssignmentRevision)return {status:"stale" as const,...conflict()};
      const ranges=current.ref.split(/;\s*/),verses=expandReadingRanges(ranges,kind,counts),cuts=resolveCuts(verses);
      if(verses.length!==baseline.storedVerses.length || verses.some((ref,i)=>ref!==baseline.storedVerses![i]))throw new AccessUnavailable();
      const view=readingView({...current,snapshot:current.proposalSnapshot,verses:baseline.storedVerses},baseline.date);
      const preparation:Preparation={cutsVersion:1,preparationMode:"current-assignment",kind,basis:current.basis,ranges,aliyahStarts:cuts,snapshotDigest:digest(current.proposalSnapshot),refDigest:digest(current.ref)};
      assertSessionLive(baseline.sessionExpiresAt);
      const binding=bindings.sign({purpose:"student-reading",actor:baseline.actor,studentId:id,studentRevision:baseline.studentRevision,assignmentId:current.id,assignmentRevision:current.revision,date:baseline.date,serviceSlot:baseline.serviceSlot,readingDate:baseline.readingDate,calendar:baseline.customs.calendar,preparation});
      assertSessionLive(baseline.sessionExpiresAt);
      return {status:"prepared" as const,requiresConfirmation:true as const,binding,kind,basis:current.basis,ranges,verseCount:verses.length,aliyahStarts:cuts,preparationMode:"current-assignment" as const,
        ceremonyDate:baseline.date,serviceSlot:baseline.serviceSlot,readingDate:baseline.readingDate,manualFallback:baseline.manualFallback,sourceFetchedAt:null,sourceStatus:"preserved" as const,warning:null,maftir:null,
        preserved:{confirmationDate:view.confirmationDate,needsReview:view.needsReview,source:view.source},toConfirm:["torah","entryCap","nusach"]};
    }
    // No network call or cache operation holds the authority transaction open.
    let loaded:{snapshot:Snapshot;fetchedAt:number|null;sourceStatus:"available"|"unavailable"|"not-requested"};
    const emptySnapshot:Snapshot={date:(baseline.readingDate??baseline.date) as CeremonyDate,calendar:baseline.customs.calendar,reading:null,haftarah:null,classification:"missing"};
    if(baseline.readingDate===null)loaded={snapshot:emptySnapshot,fetchedAt:null,sourceStatus:"not-requested"};
    else try{loaded={...await input.loadReading(baseline.readingDate,baseline.customs.calendar),sourceStatus:"available"};}
    catch(error){
      if(error instanceof ReadingUnavailable)loaded={snapshot:emptySnapshot,fetchedAt:null,sourceStatus:"unavailable"};
      else throw new AccessUnavailable();
    }
    if(loaded.sourceStatus==="available" && (typeof loaded.fetchedAt!=="number" || !Number.isFinite(loaded.fetchedAt) || loaded.fetchedAt>now() || now()-loaded.fetchedAt>86400000))throw new AccessDenied(403);
    const snapshot=validatedSnapshot(loaded.snapshot,baseline.readingDate??baseline.date,baseline.customs.calendar,counts);
    assertSessionLive(baseline.sessionExpiresAt);
    const manualFallback=baseline.manualFallback??(loaded.sourceStatus==="unavailable"?"calendar-source-unavailable":snapshot.classification==="regular"?null:snapshot.classification??"nonregular");
    const context={ceremonyDate:baseline.date,serviceSlot:baseline.serviceSlot,readingDate:baseline.readingDate,manualFallback};
    const sourceReview={...context,sourceFetchedAt:loaded.fetchedAt,sourceStatus:loaded.sourceStatus,warning:loaded.sourceStatus==="unavailable"?"calendar-source-unavailable" as const:null};
    const needsSelection=()=>({status:"needs-selection" as const,requiresConfirmation:true as const,snapshot,...sourceReview,toConfirm:["torah","entryCap","nusach"]});
    let ranges:string[],basis:Basis,maftir:unknown=null;
    if(selection.ranges!==undefined){
      ranges=selection.ranges;basis="custom";
      const special=kind==="torah"?snapshot.reading?.aliyot.find(row=>row.n==="M"):null;
      maftir=special?{ref:special.ref,...(special.reason?{reason:special.reason}:{})}:null;
    }
    else if(manualFallback!==null)return needsSelection();
    else if(kind==="haftarah"){
      if(selection.pick!=="calendar-haftarah" || !snapshot.haftarah)return needsSelection();
      ranges=[snapshot.haftarah];basis="selection";
    }else{
      const pick=selection.pick;
      if(pick===undefined || pick==="explicit-selection-required")return needsSelection();
      let canonicalPick:Pick|undefined;
      try{canonicalPick=pick===undefined?undefined:parsePick(pick);}catch{throw new AccessDenied(403);}
      let proposal:ReturnType<typeof proposeReading>;
      try{proposal=proposeReading(snapshot,counts,{pick:canonicalPick});}catch{throw new AccessDenied(403);}
      if(!proposal.selection)return needsSelection();
      ranges=[proposal.selection.ref];maftir=proposal.selection.maftir;
      basis=canonicalPick?.kind==="full"?"full":canonicalPick?.kind==="aliyah"?"selection":"triennial";
    }
    let verses:string[];try{verses=expandReadingRanges(ranges,kind,counts);}catch{throw new AccessDenied(403);}
    const cuts=resolveCuts(verses),preparation:Preparation={cutsVersion:1,preparationMode:"replace",kind,basis,ranges,aliyahStarts:cuts,snapshot,sourceFetchedAt:loaded.fetchedAt,sourceStatus:loaded.sourceStatus,maftir};
    const binding=bindings.sign({purpose:"student-reading",actor:baseline.actor,studentId:id,studentRevision:baseline.studentRevision,assignmentId:baseline.assignment?.id??null,assignmentRevision:baseline.assignmentRevision,date:baseline.date,serviceSlot:baseline.serviceSlot,readingDate:baseline.readingDate,manualFallback,calendar:baseline.customs.calendar,preparation});
    return {status:"prepared" as const,requiresConfirmation:true as const,binding,kind,basis,ranges,verseCount:verses.length,...sourceReview,maftir,aliyahStarts:cuts,preparationMode:"replace" as const,preserved:null,toConfirm:["torah","entryCap","nusach"]};
  }
  async function confirmReading(request:CookieMutationRequest,selection:Mode&{studentId:string;binding:string}){
    const id=identifier(selection.studentId),claim=bindings.verify(selection.binding,"student-reading");
    if(claim.studentId!==id || !object(claim.preparation))throw new AccessDenied(403);
    const preparation=claim.preparation as unknown as Preparation;
    if(preparation.cutsVersion!==1 || !["replace","current-assignment"].includes(preparation.preparationMode) || !["torah","haftarah"].includes(preparation.kind) || !["full","triennial","selection","custom"].includes(preparation.basis))throw new AccessDenied(403);
    let verses:string[],cuts:string[]|null;try{verses=expandReadingRanges(preparation.ranges,preparation.kind,counts);cuts=aliyahStarts(preparation.kind,preparation.aliyahStarts,verses);}catch{throw new AccessDenied(403);}
    return input.access.withStudentCapability(request,{mode:selection.mode,studentId:id,capability:"set-reading"},async(tx,actor,student)=>{
      requireCookieMutation(request,actor.origin);
      if(!sameActor(claim,actor))throw new AccessDenied(403);
      const currentCustoms=calendarCustoms(await data.customs(tx,actor.tenantId));
      const currentStudent=await data.studentReadingContext(tx,actor.tenantId,id);
      if(!currentStudent)throw new AccessDenied(404);
      const derived=readingDate(student.ceremonyDate,currentStudent.serviceSlot);
      if(claim.serviceSlot!==currentStudent.serviceSlot || claim.readingDate!==derived.readingDate)return conflict();
      if(claim.studentRevision!==student.revision || claim.date!==student.ceremonyDate || claim.calendar!==currentCustoms.calendar)return conflict();
      const current=await data.currentAssignment(tx,actor.tenantId,id,preparation.kind,true);
      const assertLive=()=>{assertSessionLive(actor.authSessionExpiresAt);if(digest(bindings.verify(selection.binding,"student-reading"))!==digest(claim))throw new AccessDenied(403);};
      // Acquiring authority/assignment locks may outlast the review. Recheck the
      // original authenticated envelope with a fresh clock before any write.
      assertLive();
      if(claim.assignmentId!==(current?.id??null) || claim.assignmentRevision!==(current?.revision??0))return conflict();
      if(preparation.preparationMode==="current-assignment"){
        if(preparation.kind!=="torah" || !current || current.status!=="confirmed" || current.basis!==preparation.basis || preparation.refDigest!==digest(current.ref) || current.ref.split(/;\s*/).join("; ")!==preparation.ranges.join("; ") || preparation.snapshotDigest!==digest(current.proposalSnapshot))return conflict();
        const stored=await data.assignmentVerses(tx,actor.tenantId,id,current.id);
        if(stored.length!==verses.length || stored.some((ref,i)=>ref!==verses[i]))return conflict();
        assertLive();
        const persisted=await data.persistCuts(tx,actor,id,current.id,current.revision,cuts);if(!persisted)return conflict();
        await data.audit(tx,actor,"reading.set",id,persisted.id);assertLive();return {ok:true as const,assignmentId:persisted.id,revision:persisted.revision};
      }
      const persisted=await data.persistAssignment(tx,actor,id,preparation.kind,current?.revision??0,{ref:preparation.ranges.join("; "),basis:preparation.basis,verses,aliyahStarts:cuts,
        snapshot:{slotProvenance:1,serviceSlot:currentStudent.serviceSlot,readingDate:derived.readingDate,manualFallback:claim.manualFallback,confirmationDate:student.ceremonyDate,calendar:claim.calendar,ranges:preparation.ranges,source:preparation.snapshot,sourceFetchedAt:preparation.sourceFetchedAt,sourceStatus:preparation.sourceStatus,maftir:preparation.maftir,needsReview:false}});
      if(!persisted)return conflict();
      await data.audit(tx,actor,"reading.set",id,persisted.id);
      assertLive();
      return {ok:true as const,assignmentId:persisted.id,revision:persisted.revision};
    });
  }
  return {listRoster,create,edit,disable,previewImport,confirmImport,prepareReading,confirmReading};
}
