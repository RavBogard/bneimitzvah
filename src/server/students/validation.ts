import { parseCeremonyDate } from "../../lib/readings/ranges";
import { AccessDenied } from "../access/errors";

export type StudentInput={firstName:string;lastName:string;ceremonyDate:string;studentKind:"child"|"adult";parentEmail:string|null;ownEmail:string|null};
const email=(value:unknown)=>{
  if(typeof value!=="string" || value.length>254 || !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(value.trim()))throw new AccessDenied(403);
  return value.trim().toLowerCase();
};
const name=(value:unknown)=>{
  if(typeof value!=="string" || value.trim().length<1 || value.trim().length>100 || /[\x00-\x1f<>]/.test(value))throw new AccessDenied(403);
  return value.trim();
};
export function studentInput(value:unknown):StudentInput{
  if(!value || typeof value!=="object" || Array.isArray(value))throw new AccessDenied(403);
  const row=value as Record<string,unknown>;
  // Omitted kind is the existing child contract, never inferred from contacts.
  const studentKind=row.studentKind===undefined?"child":row.studentKind;
  if(studentKind!=="child" && studentKind!=="adult")throw new AccessDenied(403);
  const optionalEmail=(value:unknown)=>value===undefined || value===null || (typeof value==="string" && !value.trim())?null:email(value);
  const parentEmail=optionalEmail(row.parentEmail),ownEmail=optionalEmail(row.ownEmail);
  if((studentKind==="child" && parentEmail===null) || (studentKind==="adult" && ownEmail===null) || (ownEmail!==null && ownEmail===parentEmail))throw new AccessDenied(403);
  let ceremonyDate:string;
  try{ceremonyDate=parseCeremonyDate(row.ceremonyDate);}catch{throw new AccessDenied(403);}
  return {firstName:name(row.firstName),lastName:name(row.lastName),ceremonyDate,studentKind,parentEmail,ownEmail};
}
export function revision(value:unknown):number{
  if(!Number.isSafeInteger(value) || Number(value)<1)throw new AccessDenied(403);
  return value as number;
}
export function identifier(value:unknown):string{
  if(typeof value!=="string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))throw new AccessDenied(404);
  return value;
}

export type CsvParse={rows:StudentInput[];rowNumbers:number[];issues:{row:number;code:"invalid-row"|"invalid-columns"}[]};
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
  const columns=header?.join(",");
  if(!header || records.length<1 || (columns!=="firstName,lastName,ceremonyDate,parentEmail,ownEmail" && columns!=="studentKind,firstName,lastName,ceremonyDate,parentEmail,ownEmail"))throw new AccessDenied(403);
  const rows:StudentInput[]=[],rowNumbers:number[]=[],issues:CsvParse["issues"]=[];
  records.forEach((record,index)=>{
    if(record.length!==header.length){issues.push({row:index+2,code:"invalid-columns"});return;}
    try{rows.push(studentInput(Object.fromEntries(header.map((key,i)=>[key,record[i]]))));rowNumbers.push(index+2);}
    catch{issues.push({row:index+2,code:"invalid-row"});}
  });
  return {rows,rowNumbers,issues};
}
