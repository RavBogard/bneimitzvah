import "server-only";
import type { RelatedSourceMetadata, SourceEditionMetadata } from "./metadata";
export class SourceContentUnsupported extends Error { constructor(readonly profile: "source"|"edition") {super("Source content profile unsupported");} }
export class SourceContentUnavailable extends Error { constructor(){super("Source content unavailable");} }
export const SOURCE_CONTENT_LIMITS=Object.freeze({bytes:2*1024*1024,scalarBytes:64*1024,responseBytes:128*1024,totalMs:20000,callMs:10000,idleMs:5000});
export const MOTHER_TONGUES=Object.freeze({he:"hebrew",en:"english"} as const);
export type ContentSelection=Readonly<{ref:string;indexTitle:string;editionTitle:string;language:string;actualLanguage:"he"|"en";motherTongue:"hebrew"|"english"}>;
export type SourceText=Readonly<{schema:"study-source-text/v1";ref:string;text:string;edition:Readonly<{versionTitle:string;language:string;actualLanguage:"he"|"en"}>;provenance:Readonly<{provider:"Sefaria";sourceRef:string;editionTitle:string;license:"Public Domain"|"CC0";versionSource:string;format:"text_only"}>}>;
const fail=():never=>{throw new SourceContentUnavailable();};
function object(value:unknown):Record<string,unknown>{if(!value||typeof value!=="object"||![Object.prototype,null].includes(Object.getPrototypeOf(value)))return fail();return value as Record<string,unknown>;}
function get(value:Record<string,unknown>,key:string):unknown{const d=Object.getOwnPropertyDescriptor(value,key);return d&&Object.hasOwn(d,"value")?d.value:fail();}
function array(value:unknown):unknown[]{if(!Array.isArray(value)||Object.getPrototypeOf(value)!==Array.prototype||Reflect.ownKeys(value).length!==value.length+1)return fail();for(let i=0;i<value.length;i++){const d=Object.getOwnPropertyDescriptor(value,String(i));if(!d||!Object.hasOwn(d,"value"))return fail();}return value;}
export function sourceLeaf(source:RelatedSourceMetadata):readonly string[]{
  const prefix=source.indexTitle+" ";if(!source.ref.startsWith(prefix))throw new SourceContentUnsupported("source");
  const address=source.ref.slice(prefix.length);if(!/^[1-9][0-9]*(?::[1-9][0-9]*)*$/.test(address))throw new SourceContentUnsupported("source");return Object.freeze(address.split(":"));
}
export function supportedEdition(edition:SourceEditionMetadata,language:"he"|"en"){
  if(edition.actualLanguage!==language||edition.versionTitle.includes("|")||edition.license!=="Public Domain"&&edition.license!=="CC0"||!edition.source)throw new SourceContentUnsupported("edition");
}
export function parseSourceContent(value:unknown,input:Readonly<{source:RelatedSourceMetadata;edition:SourceEditionMetadata;language:"he"|"en"}>):SourceText{
  const {source,edition,language}=input, addresses=sourceLeaf(source);supportedEdition(edition,language);
  const row=object(value);if(get(row,"ref")!==source.ref||get(row,"indexTitle")!==source.indexTitle||get(row,"textDepth")!==addresses.length||get(row,"isSpanning")!==false)return fail();
  for(const key of ["sections","toSections"]){const list=array(get(row,key));if(list.length!==addresses.length||list.some((v,i)=>typeof v!=="string"||v!==addresses[i]))return fail();}
  const spanning=Object.getOwnPropertyDescriptor(row,"spanningRefs");if(spanning&&(!Object.hasOwn(spanning,"value")||array(spanning.value).length))return fail();
  if(array(get(row,"warnings")).length)return fail();const versions=array(get(row,"versions"));if(versions.length!==1)return fail();const version=object(versions[0]);
  for(const [key,expected]of Object.entries({versionTitle:edition.versionTitle,language:edition.language,actualLanguage:language,languageFamilyName:MOTHER_TONGUES[language],license:edition.license,versionSource:edition.source}))if(get(version,key)!==expected)return fail();
  const text=get(version,"text");if(typeof text!=="string"||!text.trim()||!text.isWellFormed()||Buffer.byteLength(text)>SOURCE_CONTENT_LIMITS.scalarBytes||/[<>\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/u.test(text)||/&(?:#[0-9]+|#x[a-fA-F0-9]+|[A-Za-z][A-Za-z0-9]+);/.test(text))return fail();
  return Object.freeze({schema:"study-source-text/v1",ref:source.ref,text,edition:Object.freeze({versionTitle:edition.versionTitle,language:edition.language,actualLanguage:language}),provenance:Object.freeze({provider:"Sefaria",sourceRef:source.ref,editionTitle:edition.versionTitle,license:edition.license as "Public Domain"|"CC0",versionSource:edition.source!,format:"text_only"})});
}
