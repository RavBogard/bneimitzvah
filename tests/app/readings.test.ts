import { describe, expect, test, vi } from "vitest";
import { defaultPick, hebcalRef, leyningOf, parsePick, parseRange, selectTorah } from "../../src/lib/readings/leyning.mjs";
import { expandReadingRanges, parseCeremonyDate, type VerseCounts } from "../../src/lib/readings/ranges";
import { createHebcalReader, hebcalRequest, proposeReading, ReadingUnavailable, type CacheEntry, type HebcalCache } from "../../src/lib/readings/proposals";

// Synthetic numeric metadata and tiny calendar fragments; no text/student data.
const counts: VerseCounts={Genesis:[3,4,2],Numbers:[5],Isaiah:[3,4],"I Samuel":[5]};
const date=parseCeremonyDate("2028-02-29");
const item=()=>({date,type:"shabbat",parshaNum:1,name:{en:"Synthetic reading"},fullkriyah:{
  1:{k:"Genesis",b:"1:1",e:"1:3",v:3},2:{k:"Genesis",b:"2:1",e:"2:4",v:4},3:{k:"Genesis",b:"3:1",e:"3:2",v:2},
  M:{k:"Numbers",b:"1:1",e:"1:2",v:2,reason:"Special maftir"}},
  triennial:{1:{k:"Genesis",b:"2:1",e:"2:4",v:4},2:{k:"Genesis",b:"3:1",e:"3:2",v:2}},triYear:2,
  haft:{k:"Isaiah",b:"1:1",e:"1:3",v:3}});
const response=(payload:unknown,options:ResponseInit={})=>new Response(JSON.stringify(payload),{headers:{"content-type":"application/json"},...options});
function harness(payload:unknown={items:[item()]}) {
  let cached: CacheEntry | null=null;
  const cache:HebcalCache={get:vi.fn(async()=>cached),set:vi.fn(async(_key,entry)=>{cached=entry;})};
  const fetch=vi.fn<typeof globalThis.fetch>().mockImplementation(async()=>response(payload));
  const load=createHebcalReader({fetch,cache,verseCounts:counts,now:()=>100000000});
  return {load,fetch,cache,setCached:(entry:CacheEntry)=>{cached=entry;}};
}

describe("pure source selection parity",()=>{
  // Outputs match the source functions at haftarah5b2530f; these cases use the
  // same annual/special-maftir/triennial branches as its leyning.test.mjs.
  test("normalization, picks, multi-chapter selection and separate special maftir",()=>{
    const original=leyningOf(item());
    expect(hebcalRef({k:"Genesis",b:"1:1",e:"1:3"})).toBe("Genesis 1:1-3");
    expect(parseRange("I Samuel 1:1-5")).toEqual({book:"I Samuel",from:[1,1],to:[1,5]});
    expect(parseRange("Genesis 1:1-2; 3:1-2")).toBeNull();
    expect(selectTorah(original,parsePick("aliyah:1-2"))).toEqual({ref:"Genesis 1:1-2:4",book:"Genesis",selection:"aliyot 1-2",maftir:{ref:"Numbers 1:1-2",reason:"Special maftir"}});
    expect(selectTorah(original,parsePick("triennial"))).toEqual({ref:"Genesis 2:1-3:2",book:"Genesis",selection:"triennial year 2",maftir:{ref:"Numbers 1:1-2",reason:"Special maftir"}});
    expect(selectTorah(original,parsePick("aliyah:M")).ref).toBe("Numbers 1:1-2");
    expect(selectTorah(original,parsePick("full")).ref).toBe("Genesis 1:1-3:2");
    expect(defaultPick({torah:{mode:"weekly-selection"}})).toBeNull();
    expect(defaultPick({torah:{mode:"triennial"}})).toEqual({kind:"triennial"});
    expect(()=>parsePick("aliyah:4-2")).toThrow();
  });
});

test("strict date-only parsing uses Gregorian arithmetic, never local/UTC conversion",()=>{
  for(const valid of ["0001-01-01","2000-02-29","2028-02-29","2026-03-08","2026-11-01"])expect(parseCeremonyDate(valid)).toBe(valid);
  for(const invalid of ["0000-01-01","1900-02-29","2026-02-29","2026-04-31","2026-13-01","2026-00-01","2026-01-00","2026-1-01","2026-01-01T00:00:00Z",new Date(),null])expect(()=>parseCeremonyDate(invalid)).toThrow("Invalid ceremony date");
});

test("range expansion validates actual injected chapter boundaries, limits, ordering and kind",()=>{
  expect(expandReadingRanges(["Genesis 1:3-2:2"],"torah",counts)).toEqual(["Genesis 1:3","Genesis 2:1","Genesis 2:2"]);
  expect(expandReadingRanges(["I Samuel 1:2-3"],"haftarah",counts)).toEqual(["I Samuel 1:2","I Samuel 1:3"]);
  for(const refs of [["Genesis 1:4"],["Genesis 0:1"],["Genesis 4:1"],["Genesis 1:2-1"],["Genesis 2:1-1:2"],["Genesis 01:1"],["Genesis 1:1","Genesis 1:1"],["Genesis 2:1","Genesis 1:1"],["Unknown 1:1"]])expect(()=>expandReadingRanges(refs,"torah",counts)).toThrow();
  expect(()=>expandReadingRanges(["Genesis 1:1-3"],"torah",counts,2)).toThrow();
  expect(()=>expandReadingRanges(["Isaiah 1:1"],"torah",counts)).toThrow();
  expect(()=>expandReadingRanges(["Genesis 1:1"],"torah",{})).toThrow("metadata required");
  expect(()=>expandReadingRanges(["Genesis 1:1"],"blessing-before",counts)).toThrow("liturgical definition");
});

test("request/cache keys contain only date/calendar/version and retain explicit Israel distinction",()=>{
  const diaspora=hebcalRequest(date),israel=hebcalRequest(date,"israel");
  expect(diaspora.url.origin).toBe("https://www.hebcal.com");
  expect(diaspora.url.pathname).toBe("/leyning");
  expect(Object.fromEntries(diaspora.url.searchParams)).toEqual({cfg:"json",date,i:"off",triennial:"on"});
  expect(israel.cacheKey).not.toBe(diaspora.cacheKey);
  expect(()=>hebcalRequest("https://private.invalid")).toThrow();
});

test("normalizes/caches only approved calendar fields and requires confirmation while preserving confirmed reading",async()=>{
  const h=harness({items:[{...item(),ignored:{personal:"not cached"}}]});
  const {snapshot}=await h.load(date);
  expect(snapshot.haftarah).toBe("Isaiah 1:1-3");
  const confirmed={status:"confirmed" as const,ceremonyDate:parseCeremonyDate("2027-01-01"),ranges:Object.freeze(["Genesis 1:1"]),revision:4};
  expect(proposeReading(snapshot,counts,{confirmed})).toMatchObject({status:"needs-selection",reason:"choose-selection",selection:null});
  const proposed=proposeReading(snapshot,counts,{confirmed,pick:"triennial"});
  expect(proposed).toMatchObject({status:"proposed",requiresConfirmation:true,confirmedDateChanged:true,confirmed,selection:{ref:"Genesis 2:1-3:2"},toConfirm:["torah","entryCap","nusach"]});
  expect(confirmed.ranges).toEqual(["Genesis 1:1"]);
  expect(proposeReading(snapshot,counts,{pick:{kind:"ref",ref:"Genesis 1:2-3"}}).selection?.selection).toBe("custom");
  expect(proposeReading(snapshot,counts,{pick:"full"}).selection?.ref).toBe("Genesis 1:1-3:2");
  expect((await h.load(date)).source).toBe("cache");
  expect(h.fetch).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(vi.mocked(h.cache.set).mock.calls)).not.toContain("personal");
  expect(h.fetch.mock.calls[0][1]).toMatchObject({redirect:"error",credentials:"omit"});
});

test("empty dates, weekday and festival without triennial never silently select full reading",async()=>{
  const empty=await harness({items:[]}).load(date);
  expect(proposeReading(empty.snapshot,counts)).toMatchObject({status:"needs-selection",reason:"no-reading",selection:null});
  const festival=item() as Record<string,unknown>;delete festival.triennial;delete festival.triYear;festival.type="holiday";
  const loaded=await harness({items:[festival]}).load(date);
  expect(proposeReading(loaded.snapshot,counts)).toMatchObject({status:"needs-selection",reason:"choose-selection",selection:null});
  expect(()=>proposeReading(loaded.snapshot,counts,{pick:"triennial"})).toThrow();
  const weekday={date,name:{en:"Synthetic weekday"},weekday:{1:{k:"Genesis",b:"1:1",e:"1:3"}}};
  const weekdayLoaded=await harness({items:[weekday]}).load(date);
  expect(weekdayLoaded.snapshot.reading?.type).toBe("weekday");
  expect(proposeReading(weekdayLoaded.snapshot,counts).selection).toBeNull();
});

test("empty calendar dates permit explicit valid custom ranges without replacing confirmed work",async()=>{
  const {snapshot}=await harness({items:[]}).load(date);
  const confirmed={status:"confirmed" as const,ceremonyDate:parseCeremonyDate("2027-01-01"),ranges:Object.freeze(["Genesis 1:1"]),revision:4};
  const proposal=proposeReading(snapshot,counts,{pick:{kind:"ref",ref:"Genesis 2:2-4"},confirmed});
  expect(proposal).toMatchObject({status:"proposed",requiresConfirmation:true,reason:null,selection:{ref:"Genesis 2:2-4",selection:"custom",maftir:null},confirmed,confirmedDateChanged:true});
  expect(proposal.confirmed).toBe(confirmed);
  expect(confirmed.ranges).toEqual(["Genesis 1:1"]);
  expect(()=>proposeReading(snapshot,counts,{pick:{kind:"ref",ref:"Genesis 2:99"},confirmed})).toThrow();
  for(const pick of ["full","triennial","aliyah:1"]) {
    expect(proposeReading(snapshot,counts,{pick,confirmed})).toMatchObject({status:"needs-selection",requiresConfirmation:true,reason:"no-reading",selection:null,confirmed});
  }
});

test("cached payload bindings reject same-date foreign-calendar and different-date empty-result transplants",async()=>{
  const israel=harness();await israel.load(date,"israel");
  const foreignCalendar=harness();foreignCalendar.setCached(vi.mocked(israel.cache.set).mock.calls[0][1]);
  await expect(foreignCalendar.load(date,"diaspora")).rejects.toMatchObject({code:"cache"});
  expect(foreignCalendar.fetch).not.toHaveBeenCalled();
  const empty=harness({items:[]});await empty.load(date);
  const cachedEmpty=vi.mocked(empty.cache.set).mock.calls[0][1];
  expect(cachedEmpty.payload).toEqual({binding:{version:2,date,calendar:"diaspora"},items:[]});
  expect((await empty.load(date)).source).toBe("cache");
  const foreignDate=harness();foreignDate.setCached(cachedEmpty);
  await expect(foreignDate.load("2028-03-01")).rejects.toMatchObject({code:"cache"});
  expect(foreignDate.fetch).not.toHaveBeenCalled();
  const unbound=harness();unbound.setCached({...cachedEmpty,payload:{items:[]}});
  await expect(unbound.load(date)).rejects.toMatchObject({code:"cache"});
});

test("malformed, wrong-day, ambiguous, calendar-mismatch and invalid references fail closed",async()=>{
  const bad=[{}, {items:[{...item(),date:"2028-03-01"}]},{location:"Israel",items:[item()]},{range:{start:date,end:"2028-03-01"},items:[item()]},{items:[{...item(),fullkriyah:{1:{k:"Genesis",b:"1:1",e:"1:99"}}}]},{items:[{...item(),fullkriyah:{1:{k:"Genesis",b:"1:1",e:"1:3",v:99}}}]}];
  for(const payload of bad){const h=harness(payload);await expect(h.load(date)).rejects.toBeInstanceOf(ReadingUnavailable);expect(h.cache.set).not.toHaveBeenCalled();}
});

test("rejects oversized/chunked, wrong-content-type, redirected, failed, timed-out and invalid JSON responses",async()=>{
  const variants=[new Response("not JSON",{headers:{"content-type":"application/json"}}),response({items:[]},{headers:{"content-type":"text/html"}}),response({items:[]},{status:503}),response({items:[]},{headers:{"content-type":"application/json","content-length":"200000"}}),new Response('"'+"x".repeat(140000)+'"',{headers:{"content-type":"application/json"}})];
  for(const result of variants){const h=harness();h.fetch.mockResolvedValue(result);await expect(h.load(date)).rejects.toBeInstanceOf(ReadingUnavailable);}
  const h=harness();const moved=response({items:[]});Object.defineProperty(moved,"redirected",{value:true});h.fetch.mockResolvedValue(moved);await expect(h.load(date)).rejects.toBeInstanceOf(ReadingUnavailable);
  const timeout=createHebcalReader({fetch:vi.fn().mockImplementation(()=>new Promise(()=>{})),cache:h.cache,verseCounts:counts,timeoutMs:5});
  await expect(timeout(date)).rejects.toMatchObject({code:"upstream"});
});

test("expired cache is never served as fresh on upstream failure; corrupt cache also denies use",async()=>{
  const h=harness();h.setCached({fetchedAt:0,expiresAt:86400000,payload:{items:[item()]}});h.fetch.mockRejectedValue(new Error("synthetic upstream failure"));
  await expect(h.load(date)).rejects.toMatchObject({code:"upstream",cachedAt:0});
  const binding={version:2,date,calendar:"diaspora"};
  const corrupt=harness();corrupt.setCached({fetchedAt:100000000,expiresAt:186400000,payload:{binding,items:[{date}]}});
  await expect(corrupt.load(date)).rejects.toMatchObject({code:"cache"});expect(corrupt.fetch).not.toHaveBeenCalled();
  for(const payload of [{items:[{...item(),date:"2028-03-01"}]},{items:[item()],range:{start:date,end:"2028-03-01"}},{items:[{...item(),fullkriyah:{1:{k:"Genesis",b:"1:1",e:"1:99"}}}]}]) {
    const poisoned=harness();poisoned.setCached({fetchedAt:100000000,expiresAt:186400000,payload:{binding,...payload}});
    await expect(poisoned.load(date)).rejects.toMatchObject({code:"cache"});expect(poisoned.fetch).not.toHaveBeenCalled();
  }
});

test("a trimmed aliyot set cannot invent the omitted middle verses",async()=>{
  const partial=item();delete (partial.fullkriyah as Record<string,unknown>)["2"];
  const {snapshot}=await harness({items:[partial]}).load(date);
  expect(()=>proposeReading(snapshot,counts,{pick:"full"})).toThrow("complete ordered range");
});


test("classification preserves regular double portions and special maftir, but holidays and multiple items require manual choice",async()=>{
  const doubled=await harness({items:[{...item(),parshaNum:[22,23]}]}).load(date);
  expect(doubled.snapshot.classification).toBe("regular");
  expect(doubled.snapshot.reading?.aliyot.find(row=>row.n==="M")?.ref).toBe("Numbers 1:1-2");
  const holiday=await harness({items:[{...item(),type:"holiday",parshaNum:undefined}]}).load(date);
  expect(holiday.snapshot.classification).toBe("holiday");
  const unclassified=await harness({items:[{...item(),parshaNum:undefined}]}).load(date);
  expect(unclassified.snapshot.classification).toBe("nonregular");
  const multiple=harness({items:[{...item(),type:"holiday"},{...item(),type:"holiday"}]});
  expect((await multiple.load(date)).snapshot).toMatchObject({classification:"multiple",reading:null,haftarah:null});
  expect((await multiple.load(date)).snapshot.classification).toBe("multiple");
  expect(hebcalRequest(date).cacheKey).toContain(":v2:");
  const old=harness();old.setCached({fetchedAt:100000000,expiresAt:186400000,payload:{binding:{version:1,date,calendar:"diaspora"},items:[item()]}});
  await expect(old.load(date)).rejects.toMatchObject({code:"cache"});
});


test("cache roundtrip never promotes missing source type and validates calendar/range before multiple-result fallback",async()=>{
 const h=harness({items:[{...item(),type:undefined,parshaNum:2}]});
 const upstream=await h.load(date),cached=await h.load(date);
 expect(upstream.snapshot).toMatchObject({classification:"nonregular",reading:{type:"unknown"}});
 expect(cached.snapshot).toEqual(upstream.snapshot);
 for(const metadata of [{location:"Israel"},{range:{start:date,end:"2028-03-01"}}]){
  await expect(harness({...metadata,items:[item(),item()]}).load(date)).rejects.toMatchObject({code:"invalid-response"});
  const invalid=harness();invalid.setCached({fetchedAt:100000000,expiresAt:186400000,payload:{binding:{version:2,date,calendar:"diaspora"},classification:"multiple",items:[],...metadata}});
  await expect(invalid.load(date)).rejects.toMatchObject({code:"cache"});
 }
});
