import { parseCeremonyDate } from "../../lib/readings/ranges";
import { serviceSlot, type ServiceSlot } from "../../lib/readings/reading-date";
import { AccessDenied } from "../access/errors";

export type StudentInput={firstName:string;lastName:string;ceremonyDate:string;serviceSlot:ServiceSlot;studentKind:"child"|"adult";parentEmail:string|null;ownEmail:string|null;hebrewName?:string|null;secondParentEmail?:string|null;rehearsal1?:string|null;rehearsal2?:string|null};
const email=(value:unknown)=>{
  if(typeof value!=="string" || value.length>254 || /[\x00-\x1f\x7f-\x9f]/.test(value) || !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(value.trim()))throw new AccessDenied(403);
  return value.trim().toLowerCase();
};
const name=(value:unknown)=>{
  if(typeof value!=="string" || value.trim().length<1 || value.trim().length>100 || /[\x00-\x1f\x7f-\x9f<>]/.test(value))throw new AccessDenied(403);
  return value.trim();
};
function optionalText(value:unknown,max:number,multiline=false):string|null {
  if(value===undefined || value===null)return null;
  if(typeof value!=="string")throw new AccessDenied(403);
  const normalized=value.replace(/\r\n?/g,"\n"),text=normalized.trim();
  if(Buffer.byteLength(text,"utf8")>max || (multiline?/[\x00-\x09\x0b-\x1f\x7f-\x9f]/:/[\x00-\x1f\x7f-\x9f]/).test(normalized) || /[<>]/.test(text))throw new AccessDenied(403);
  return text || null;
}
// Omitted means unchanged; null clears. Dates are calendar dates like the ceremony date.
function optionalDate(value:unknown):string|null|undefined{
  if(value===undefined || value===null)return value;
  try{return parseCeremonyDate(value);}catch{throw new AccessDenied(403);}
}
/** Rehearsals are in order and on or before the ceremony; the database checks the same. */
export function rehearsalsFit(ceremonyDate:string,rehearsal1:string|null,rehearsal2:string|null){
  return (rehearsal1===null || rehearsal1<=ceremonyDate) && (rehearsal2===null || rehearsal2<=ceremonyDate) && (rehearsal1===null || rehearsal2===null || rehearsal1<=rehearsal2);
}
export function studentInput(value:unknown):StudentInput{
  if(!value || typeof value!=="object" || Array.isArray(value))throw new AccessDenied(403);
  const row=value as Record<string,unknown>;
  // Omitted kind is the existing child contract, never inferred from contacts.
  const studentKind=row.studentKind===undefined?"child":row.studentKind;
  if(studentKind!=="child" && studentKind!=="adult")throw new AccessDenied(403);
  const optionalEmail=(value:unknown)=>value===undefined || value===null || (typeof value==="string" && !value.trim())?null:email(value);
  const parentEmail=optionalEmail(row.parentEmail),ownEmail=optionalEmail(row.ownEmail);
  const secondParentEmail=row.secondParentEmail===undefined?undefined:optionalEmail(row.secondParentEmail);
  if((studentKind==="child" && parentEmail===null) || (studentKind==="adult" && ownEmail===null) || (ownEmail!==null && (ownEmail===parentEmail || ownEmail===secondParentEmail)))throw new AccessDenied(403);
  let slot:ServiceSlot;try{slot=serviceSlot(row.serviceSlot===undefined?"unknown":row.serviceSlot);}catch{throw new AccessDenied(403);}
  let ceremonyDate:string;
  try{ceremonyDate=parseCeremonyDate(row.ceremonyDate);}catch{throw new AccessDenied(403);}
  const rehearsal1=optionalDate(row.rehearsal1),rehearsal2=optionalDate(row.rehearsal2);
  if(!rehearsalsFit(ceremonyDate,rehearsal1??null,rehearsal2??null))throw new AccessDenied(403);
  return {firstName:name(row.firstName),lastName:name(row.lastName),ceremonyDate,serviceSlot:slot,studentKind,parentEmail,ownEmail,
    ...(row.hebrewName===undefined?{}:{hebrewName:optionalText(row.hebrewName,400)}),...(secondParentEmail===undefined?{}:{secondParentEmail}),
    ...(rehearsal1===undefined?{}:{rehearsal1}),...(rehearsal2===undefined?{}:{rehearsal2})};
}
export function revision(value:unknown):number{
  if(!Number.isSafeInteger(value) || Number(value)<1)throw new AccessDenied(403);
  return value as number;
}
export function identifier(value:unknown):string{
  if(typeof value!=="string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))throw new AccessDenied(404);
  return value;
}
