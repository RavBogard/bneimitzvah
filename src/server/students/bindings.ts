import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { AccessDenied } from "../access/errors";

export const digest=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function createBindings(secret:string,now:()=>number){
  if(typeof secret!=="string" || secret.length<32)throw new Error("Private student service signing configuration required");
  const sign=(body:Record<string,unknown>)=>{
    const serialized=JSON.stringify({...body,expiresAt:now()+5*60_000});
    if(Buffer.byteLength(serialized)>32000)throw new AccessDenied(403);
    const encoded=Buffer.from(serialized).toString("base64url");
    return `${encoded}.${createHmac("sha256",secret).update(encoded).digest("hex")}`;
  };
  const verify=(token:unknown,purpose:string):Record<string,unknown>=>{
    if(typeof token!=="string" || token.length>48000)throw new AccessDenied(403);
    const parts=token.split(".");
    if(parts.length!==2 || !/^[A-Za-z0-9_-]+$/.test(parts[0]) || !/^[a-f0-9]{64}$/.test(parts[1]))throw new AccessDenied(403);
    const expected=createHmac("sha256",secret).update(parts[0]).digest();
    if(!timingSafeEqual(expected,Buffer.from(parts[1],"hex")))throw new AccessDenied(403);
    let body:Record<string,unknown>;
    try{body=JSON.parse(Buffer.from(parts[0],"base64url").toString("utf8"));}catch{throw new AccessDenied(403);}
    if(!body || body.purpose!==purpose || !Number.isSafeInteger(body.expiresAt) || Number(body.expiresAt)<=now() || Number(body.expiresAt)>now()+5*60_000)throw new AccessDenied(403);
    return body;
  };
  return {sign,verify};
}
