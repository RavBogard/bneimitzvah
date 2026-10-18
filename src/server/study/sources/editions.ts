import "server-only";
import { createHash } from "node:crypto";
import { parseEditionMetadata, SourceMetadataUnavailable, SOURCE_METADATA_LIMITS as L, sourceMetadataWork, type SourceEditionMetadata } from "./metadata";
export type EditionCatalog = Readonly<{ workTitle: string; editionCatalogHash: string; receivedRows: number; heldCount: number; duplicateCount: number; entries: readonly SourceEditionMetadata[] }>;
export type EditionPage = Readonly<{ schema: "study-edition-page/v1"; workTitle: string; editionCatalogHash: string; editionOffset: number; pageSize: 10; totalEntries: number; receivedRows: number; heldCount: number; duplicateCount: number; nextEditionOffset: number | null; entries: readonly SourceEditionMetadata[] }>;
const fail = (): never => { throw new SourceMetadataUnavailable(); };
/** Revalidate the normalized catalog via the unchanged metadata parser, then sort copied rows only. */
export function projectEditionCatalog(value: unknown, work: string): EditionCatalog {
  if (!value || typeof value !== "object" || ![Object.prototype,null].includes(Object.getPrototypeOf(value))) return fail();
  const get = (key: string): unknown => { const d=Object.getOwnPropertyDescriptor(value,key); return d && Object.hasOwn(d,"value") ? d.value : fail(); };
  if (get("schema") !== "study-edition-metadata/v1" || get("workTitle") !== sourceMetadataWork(work)) return fail();
  const raw=get("entries"); if (!Array.isArray(raw) || Object.getPrototypeOf(raw)!==Array.prototype || raw.length>L.editions || Reflect.ownKeys(raw).length!==raw.length+1) return fail();
  const input: object[]=[];
  for(let i=0;i<raw.length;i++){ const d=Object.getOwnPropertyDescriptor(raw,String(i)); if(!d || !Object.hasOwn(d,"value"))return fail(); const r=d.value;
    if(!r || typeof r!=="object" || ![Object.prototype,null].includes(Object.getPrototypeOf(r)))return fail();
    const f=(k:string)=>{const e=Object.getOwnPropertyDescriptor(r,k);return e&&Object.hasOwn(e,"value")?e.value:fail();};
    input.push({title:work,versionTitle:f("versionTitle"),language:f("language"),actualLanguage:f("actualLanguage"),license:f("license"),versionSource:f("source")}); }
  const parsed=parseEditionMetadata(input,work);
  if(parsed.entries.length!==raw.length || parsed.heldCount || parsed.duplicateCount)return fail();
  const count=(k:string)=>{const n=get(k);return Number.isSafeInteger(n)&&Number(n)>=0&&Number(n)<=L.editions?Number(n):fail();};
  const receivedRows=count("receivedRows"),heldCount=count("heldCount"),duplicateCount=count("duplicateCount");
  if(raw.length+heldCount+duplicateCount!==receivedRows)return fail();
  const entries=Object.freeze([...parsed.entries].sort((a,b)=>{const x=JSON.stringify([a.versionTitle,a.language,a.actualLanguage,a.license,a.source]),y=JSON.stringify([b.versionTitle,b.language,b.actualLanguage,b.license,b.source]);return x<y?-1:x>y?1:0;}));
  const serialized=JSON.stringify({schema:"study-edition-catalog-hash/v1",workTitle:work,receivedRows,heldCount,duplicateCount,entries});
  if(Buffer.byteLength(serialized)>L.bytes)return fail();
  return Object.freeze({workTitle:work,editionCatalogHash:createHash("sha256").update(serialized).digest("hex"),receivedRows,heldCount,duplicateCount,entries});
}
export function editionPage(catalog: EditionCatalog, editionOffset: number): EditionPage {
  if(!Number.isSafeInteger(editionOffset)||editionOffset<0||editionOffset>510||editionOffset%10||editionOffset>=catalog.entries.length&&(editionOffset!==0||catalog.entries.length!==0))return fail();
  const end=Math.min(catalog.entries.length,editionOffset+10);
  return Object.freeze({schema:"study-edition-page/v1",workTitle:catalog.workTitle,editionCatalogHash:catalog.editionCatalogHash,editionOffset,pageSize:10,totalEntries:catalog.entries.length,receivedRows:catalog.receivedRows,heldCount:catalog.heldCount,duplicateCount:catalog.duplicateCount,nextEditionOffset:end<catalog.entries.length?end:null,entries:Object.freeze(catalog.entries.slice(editionOffset,end))});
}
export function selectEdition(catalog: EditionCatalog, language: "he"|"en", title: string): SourceEditionMetadata | null {
  const matches=catalog.entries.filter(e=>e.actualLanguage===language&&e.versionTitle===title);return matches.length===1?matches[0]:null;
}
