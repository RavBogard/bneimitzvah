import { parseCeremonyDate } from "../../lib/readings/ranges";
import { serviceSlot, type ServiceSlot } from "../../lib/readings/reading-date";
import { AccessDenied } from "../access/errors";
import type { StudentImportMetadata } from "../db/tenant-schema";

export type StudentInput={firstName:string;lastName:string;ceremonyDate:string;serviceSlot:ServiceSlot;studentKind:"child"|"adult";parentEmail:string|null;ownEmail:string|null;hebrewName?:string|null;secondParentEmail?:string|null};
export type ImportedStudentInput=StudentInput&{importMetadata?:StudentImportMetadata};
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
  return {firstName:name(row.firstName),lastName:name(row.lastName),ceremonyDate,serviceSlot:slot,studentKind,parentEmail,ownEmail,
    ...(row.hebrewName===undefined?{}:{hebrewName:optionalText(row.hebrewName,400)}),...(secondParentEmail===undefined?{}:{secondParentEmail})};
}
export function revision(value:unknown):number{
  if(!Number.isSafeInteger(value) || Number(value)<1)throw new AccessDenied(403);
  return value as number;
}
export function identifier(value:unknown):string{
  if(typeof value!=="string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))throw new AccessDenied(404);
  return value;
}

export type CsvParse={rows:ImportedStudentInput[];rowNumbers:number[];issues:{row:number;code:"invalid-row"|"invalid-columns"}[]};
const LEGACY_HEADER="firstName,lastName,ceremonyDate,parentEmail,ownEmail";
const FULL_HEADER=LEGACY_HEADER+",service_slot,parashah,tutor,parent1_name,household_phone,parent2_name,parent2_email,hebrew_name,notes";
// Strict RFC4180-style state machine; no data is executed and cells are never
// echoed in errors. Only known columns are accepted; CRLF and quoted commas work.
export function parseStudentCsv(csv:unknown):CsvParse{
  if(typeof csv!=="string" || Buffer.byteLength(csv,"utf8")>1024*1024)throw new AccessDenied(403);
  const records:string[][]=[];
  let row:string[]=[],cell="",quoted=false,closed=false;
  const finishCell=()=>{row.push(cell);cell="";closed=false;};
  const finishRow=()=>{finishCell();records.push(row);row=[];if(records.length>501)throw new AccessDenied(403);};
  for(let i=0;i<csv.length;i++){
    const char=csv[i];
    if(quoted){if(char==='"'){if(csv[i+1]==='"'){cell+='"';i++;}else{quoted=false;closed=true;}}else cell+=char;continue;}
    if(char==='"'){if(cell!=="" || closed)throw new AccessDenied(403);quoted=true;continue;}
    if(char===","){finishCell();continue;}
    if(char==="\r" || char==="\n"){if(char==="\r" && csv[i+1]==="\n")i++;finishRow();continue;}
    if(closed)throw new AccessDenied(403);
    cell+=char;
  }
  if(quoted)throw new AccessDenied(403);
  if(cell!=="" || row.length || closed)finishRow();
  const header=records.shift();
  const format=[LEGACY_HEADER,"studentKind,"+LEGACY_HEADER,FULL_HEADER,"studentKind,"+FULL_HEADER]
    .map(value=>value.split(",")).find(expected=>header?.length===expected.length && expected.every((name,index)=>header?.[index]===name));
  if(!header || !format || records.length<1)throw new AccessDenied(403);
  const full=format.length===14 || format.length===15;
  const rows:ImportedStudentInput[]=[],rowNumbers:number[]=[],issues:CsvParse["issues"]=[];
  records.forEach((record,index)=>{
    if(record.length!==header.length){issues.push({row:index+2,code:"invalid-columns"});return;}
    try{
      if(record.some((cell,index)=>header[index]!=="notes" && /[\x00-\x1f\x7f-\x9f]/.test(cell)))throw new AccessDenied(403);
      const raw=Object.fromEntries(header.map((key,i)=>[key,record[i]]));
      const student=studentInput({...raw,...(full?{serviceSlot:raw.service_slot.trim(),hebrewName:raw.hebrew_name,secondParentEmail:raw.parent2_email}:{})});
      const importMetadata:StudentImportMetadata|undefined=full?{version:1,parent1Name:optionalText(raw.parent1_name,400),householdPhone:optionalText(raw.household_phone,100),parent2Name:optionalText(raw.parent2_name,400),
        parashahLabel:optionalText(raw.parashah,400),tutorName:optionalText(raw.tutor,400),tutorMatch:null,adminNotes:optionalText(raw.notes,4096,true)}:undefined;
      rows.push({...student,...(importMetadata?{importMetadata}:{})});rowNumbers.push(index+2);
    }
    catch{issues.push({row:index+2,code:"invalid-row"});}
  });
  return {rows,rowNumbers,issues};
}
