import { expect, test, vi } from "vitest";
vi.mock("server-only",()=>({}));
import { randomBytes } from "node:crypto";
import { createMusicBroker,parseMusicResult } from "../../src/server/service-ecosystem/broker";
import { AccessUnavailable } from "../../src/server/access/errors";
const origin="https://music.example.test",url=`${origin}/api/integrations/beit-mitzvah/v1`;
const linked=()=>({version:1,status:"linked",setlistId:"synthetic-set",sourceRevision:"synthetic-revision",projection:{setlistId:"synthetic-set",sourceRevision:"synthetic-revision",localDate:"2027-01-02",ceremonyType:"morning",operatorLinks:{music:`${origin}/setlists/synthetic-set`,review:`${origin}/beit-mitzvah/synthetic`},rows:[{rowId:"synthetic-row",order:0,title:"Synthetic part",momentId:"music-namespace",catalogUnitId:"sample.first@bm-shacharit",liturgyRef:{book:"synthetic-book",folio:2,unitId:"reader-namespace",serviceViewId:"synthetic-view"},resources:[{resourceId:"synthetic-score",kind:"score",label:"Synthetic score"}]}]}});
test("broker sends the source's fixed org header, strict v1 body and dedicated bearer server-side with redirects/cache disabled",async()=>{
  const token=randomBytes(48).toString("base64url");
  const fetcher=vi.fn<typeof fetch>(async(_url,options)=>{const headers=new Headers(options?.headers);expect(headers.get("x-org-id")).toBe("crc");expect(headers.get("authorization")).toBe(`Bearer ${token}`);expect(options?.redirect).toBe("error");expect(options?.cache).toBe("no-store");expect(JSON.parse(String(options?.body))).toMatchObject({version:1,operation:"ensure",orgId:"crc",localDate:"2027-01-02",ceremonyType:"morning"});return Response.json(linked());});
  const result=await createMusicBroker({url,token},fetcher).ensure({ceremonyId:"00000000-0000-4000-8000-000000000025",localDate:"2027-01-02",ceremonyType:"morning",idempotencyKey:"synthetic-key"});
  expect(result.status).toBe("linked");if(result.status!=="linked")throw new Error("Synthetic response mismatch");
  expect(result.projection.rows[0]).toMatchObject({momentId:"music-namespace",catalogUnitId:"sample.first@bm-shacharit",liturgyRef:{unitId:"reader-namespace",folio:2}});
  expect(JSON.stringify(result)).not.toContain(token);
});
test("unconfigured, malformed/foreign URLs, revision identity mismatch and duplicate source rows fail closed",async()=>{
  const fetcher=vi.fn<typeof fetch>(async()=>Response.json(linked())),token=randomBytes(48).toString("base64url");
  await expect(createMusicBroker(undefined,fetcher).projection("synthetic")).rejects.toBeInstanceOf(AccessUnavailable);expect(fetcher).not.toHaveBeenCalled();
  for(const endpoint of ["http://music.example.test/api/integrations/beit-mitzvah/v1",`${url}?token=forbidden`])await expect(createMusicBroker({url:endpoint,token},fetcher).projection("synthetic")).rejects.toBeInstanceOf(AccessUnavailable);
  for(const mutate of [(v:ReturnType<typeof linked>)=>{v.projection.operatorLinks.music="https://foreign.example.test/";},(v:ReturnType<typeof linked>)=>{v.sourceRevision="mismatch";},(v:ReturnType<typeof linked>)=>{v.projection.rows.push(v.projection.rows[0]);}]){const value=linked();mutate(value);expect(()=>parseMusicResult(value,origin)).toThrow(AccessUnavailable);}
});
test("review-required source metadata never projects approved rows and private source fields are not copied",()=>{
  const value={...linked(),status:"review_required",privateNotes:"Synthetic private source notes"};
  const result=parseMusicResult(value,origin);expect(result.status).toBe("review_required");expect(JSON.stringify(result)).not.toContain("privateNotes");
  if(result.status!=="review_required")throw new Error("Synthetic review state missing");expect(result.projection?.rows).toEqual([]);expect(result.projection?.operatorLinks.review).toContain("/beit-mitzvah/");
});
test("resource tickets require exact ID, a short expiry and same-source HTTPS proxy",async()=>{
  const token=randomBytes(48).toString("base64url");
  for(const resource of [
    {resourceId:"other",kind:"score",url:`${origin}/api/proxy`,expiresAt:new Date(Date.now()+60000).toISOString()},
    {resourceId:"synthetic-score",kind:"score",url:"https://storage.example.test/public",expiresAt:new Date(Date.now()+60000).toISOString()},
    {resourceId:"synthetic-score",kind:"score",url:`${origin}/api/proxy`,expiresAt:new Date(Date.now()+3600000).toISOString()},
  ])await expect(createMusicBroker({url,token},async()=>Response.json({version:1,resource})).resource("synthetic","synthetic-row","synthetic-score")).rejects.toBeInstanceOf(AccessUnavailable);
});
