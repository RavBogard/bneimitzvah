import { expandReadingRanges,parseCeremonyDate,readingSegments,type VerseCounts } from "../../lib/readings/ranges";
import type { Aliyah,Leyning } from "../../lib/readings/leyning.mjs";
import type { Calendar,Snapshot } from "../../lib/readings/proposals";
import { AccessDenied } from "../access/errors";

const object=(value:unknown):value is Record<string,unknown>=>!!value && typeof value==="object" && !Array.isArray(value);
const label=(value:unknown)=>{
  if(typeof value!=="string" || !value.length || value.length>160 || /[<>@\x00-\x1f]/.test(value))throw new AccessDenied(403);
  return value;
};
// Validate an injected provider at runtime too. Retain only calendar metadata;
// arbitrary response fields and textual summaries never enter signed claims.
export function validatedSnapshot(value:unknown,date:string,calendar:Calendar,counts:VerseCounts):Snapshot{
  if(!object(value) || value.date!==date || value.calendar!==calendar)throw new AccessDenied(403);
  let reading:Leyning|null=null;
  const aliyot=(value:unknown):Aliyah[]=>{
    if(!Array.isArray(value) || !value.length || value.length>8)throw new AccessDenied(403);
    const seen=new Set<number|string>();
    return value.map(row=>{
      if(!object(row) || (row.n!=="M" && (!Number.isInteger(row.n) || Number(row.n)<1 || Number(row.n)>7)) || seen.has(row.n as string|number) || typeof row.ref!=="string")throw new AccessDenied(403);
      seen.add(row.n as string|number);
      let verseCount:number;try{verseCount=expandReadingRanges([row.ref],"torah",counts).length;}catch{throw new AccessDenied(403);}
      if(row.verses!==undefined && row.verses!==verseCount)throw new AccessDenied(403);
      return {n:row.n as number|"M",ref:row.ref,...(row.verses!==undefined?{verses:verseCount}:{}),...(row.reason!==undefined?{reason:label(row.reason)}:{})};
    });
  };
  if(value.reading!==null){
    if(!object(value.reading) || !["shabbat","weekday","holiday","unknown"].includes(String(value.reading.type)))throw new AccessDenied(403);
    const row=value.reading;
    let triennial:Leyning["triennial"]=null;
    if(row.triennial!==null){
      if(!object(row.triennial) || (row.triennial.year!==null && ![1,2,3].includes(Number(row.triennial.year))))throw new AccessDenied(403);
      triennial={year:row.triennial.year===null?null:Number(row.triennial.year),aliyot:aliyot(row.triennial.aliyot)};
    }
    reading={parashah:label(row.parashah),type:String(row.type),summary:"",source:"Hebcal",aliyot:aliyot(row.aliyot),triennial};
  }
  if(value.haftarah!==null){
    if(typeof value.haftarah!=="string")throw new AccessDenied(403);
    if(value.haftarah.length>400)throw new AccessDenied(403);
    try{expandReadingRanges(readingSegments(value.haftarah),"haftarah",counts);}catch{throw new AccessDenied(403);}
  }
  const classification=["regular","holiday","multiple","nonregular","missing"].includes(String(value.classification))?value.classification as NonNullable<Snapshot["classification"]>:"nonregular";
  if(classification==="regular" && reading?.type!=="shabbat")throw new AccessDenied(403);
  return {date:parseCeremonyDate(date),calendar,reading,haftarah:value.haftarah as string|null,classification};
}
