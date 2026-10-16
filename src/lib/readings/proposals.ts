import { hebcalRef, leyningOf, parsePick, selectTorah, type Leyning, type Pick, type Selection } from "./leyning.mjs";
import { expandReadingRanges, parseCeremonyDate, type CeremonyDate, type VerseCounts } from "./ranges";

export type Calendar = "diaspora" | "israel";
export type Classification = "regular" | "holiday" | "multiple" | "nonregular" | "missing";
export type Snapshot = { classification?: Classification; date: CeremonyDate; calendar: Calendar; reading: Leyning | null; haftarah: string | null };
export type CacheEntry = { fetchedAt: number; expiresAt: number; payload: unknown };
export type HebcalCache = { get(key: string): Promise<CacheEntry | null>; set(key: string, entry: CacheEntry): Promise<void> };
export type ConfirmedReading = { status: "confirmed"; ceremonyDate: CeremonyDate; ranges: readonly string[]; revision: number };
export class ReadingUnavailable extends Error {
  constructor(public readonly code: "upstream" | "invalid-response" | "cache", public readonly cachedAt: number | null = null) {
    super("Reading proposal unavailable; review calendar source before continuing");
  }
}
const TTL = 24 * 60 * 60 * 1000;
const MAX_BYTES = 128 * 1024;
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const label = (value: unknown): string => {
  if (typeof value !== "string" || value.length < 1 || value.length > 160 || /[<>@\x00-\x1f]/.test(value)) throw new Error("Invalid calendar label");
  return value;
};

export function hebcalRequest(dateInput: unknown, calendar: Calendar = "diaspora") {
  const date = parseCeremonyDate(dateInput);
  if (calendar !== "diaspora" && calendar !== "israel") throw new Error("Invalid reading calendar");
  const url = new URL("https://www.hebcal.com/leyning");
  url.search = new URLSearchParams({ cfg: "json", date, i: calendar === "diaspora" ? "off" : "on", triennial: "on" }).toString();
  return { date, calendar, url, cacheKey: `hebcal:leyning:v2:${calendar}:${date}:triennial` };
}

function normalizePayload(payload: unknown, date: CeremonyDate, calendar: Calendar, counts: VerseCounts, fromCache=false): { snapshot: Snapshot; payload: unknown } {
  if (!object(payload) || !Array.isArray(payload.items) || payload.items.length > 16) throw new Error("Invalid calendar response");
  if (fromCache && (!object(payload.binding) || payload.binding.version!==2 || payload.binding.date!==date || payload.binding.calendar!==calendar)) throw new Error("Cache request binding mismatch");
  const binding={version:2,date,calendar};
  if (payload.location!==undefined && payload.location!==(calendar==="diaspora" ? "Diaspora" : "Israel")) throw new Error("Wrong reading calendar");
  if (payload.range!==undefined && (!object(payload.range) || payload.range.start!==date || payload.range.end!==date)) throw new Error("Wrong reading date range");

  if (fromCache && payload.classification==="multiple" && payload.items.length===0) return {snapshot:{date,calendar,reading:null,haftarah:null,classification:"multiple"},payload};
  if (payload.items.length>1) {
    if(payload.items.some(item=>!object(item) || item.date!==date))throw new Error("Wrong calendar item date");
    return {snapshot:{date,calendar,reading:null,haftarah:null,classification:"multiple"},payload:{binding,classification:"multiple",items:[]}};
  }
  const item = payload.items[0];
  if (item === undefined) return { snapshot: { date, calendar, reading: null, haftarah: null, classification:"missing" }, payload: { binding, items: [] } };
  if (!object(item) || item.date !== date || !object(item.name)) throw new Error("Wrong or invalid calendar item");
  const safe: Record<string, unknown> = { date, name: { en: label(item.name.en) } };
  safe.type = item.type === undefined ? (item.weekday ? "weekday" : "unknown") : label(item.type);
  if (!["shabbat","holiday","weekday","unknown"].includes(safe.type as string)) throw new Error("Unknown reading type");
  const numbers=Array.isArray(item.parshaNum)?item.parshaNum:[item.parshaNum];
  if(item.parshaNum!==undefined && (numbers.length<1 || numbers.length>2 || numbers.some(n=>!Number.isInteger(n) || Number(n)<1 || Number(n)>54) || new Set(numbers).size!==numbers.length))throw new Error("Invalid parashah classification");
  const regular=item.type==="shabbat" && item.parshaNum!==undefined;
  if(item.parshaNum!==undefined)safe.parshaNum=item.parshaNum;
  const classification:Classification=regular?"regular":safe.type==="holiday"?"holiday":"nonregular";
  const sanitizeSet = (set: unknown, kind: "torah" | "haftarah") => {
    if (!object(set) || Object.keys(set).length === 0 || Object.keys(set).some(n => !/^[1-7M]$/.test(n))) throw new Error("Invalid aliyot set");
    const out: Record<string, unknown> = {};
    for (const [n,value] of Object.entries(set)) {
      if (!object(value) || typeof value.k !== "string" || typeof value.b !== "string" || (value.e !== undefined && typeof value.e !== "string")) throw new Error("Invalid aliyah");
      if (!/^[1-9]\d*:[1-9]\d*$/.test(value.b) || (value.e !== undefined && !/^[1-9]\d*:[1-9]\d*$/.test(value.e as string))) throw new Error("Invalid aliyah endpoint");
      const row: Record<string,unknown> = { k:value.k, b:value.b, e:value.e ?? value.b };
      const verses = expandReadingRanges([hebcalRef(row)],kind,counts);
      if (value.v !== undefined && value.v !== verses.length) throw new Error("Invalid aliyah verse count");
      if (value.v !== undefined) row.v=value.v;
      if (value.reason !== undefined) row.reason=label(value.reason);
      out[n]=row;
    }
    return out;
  };
  if (item.fullkriyah !== undefined) safe.fullkriyah=sanitizeSet(item.fullkriyah,"torah");
  else if (item.weekday !== undefined) safe.fullkriyah=sanitizeSet(item.weekday,"torah");
  else throw new Error("Calendar item has no reading");
  if (item.triennial !== undefined) {
    safe.triennial=sanitizeSet(item.triennial,"torah");
    if (item.triYear !== undefined && ![1,2,3].includes(item.triYear as number)) throw new Error("Invalid triennial year");
    if (item.triYear !== undefined) safe.triYear=item.triYear;
  }
  if (item.reason !== undefined) {
    if (!object(item.reason)) throw new Error("Invalid calendar reason");
    if (item.reason.M !== undefined) safe.reason={M:label(item.reason.M)};
  }
  let haftarah: string | null=null;
  if (item.haft !== undefined) {
    const haft=sanitizeSet({1:item.haft},"haftarah");
    safe.haft=haft["1"]; haftarah=hebcalRef(safe.haft);
  }
  return { snapshot:{date,calendar,reading:leyningOf(safe),haftarah,classification}, payload:{binding,items:[safe]} };
}

async function boundedBody(response: Response): Promise<unknown> {
  const size=response.headers.get("content-length");
  if (size !== null && (!/^\d+$/.test(size) || Number(size)>MAX_BYTES)) throw new Error("Calendar response too large");
  if (!response.body) throw new Error("Empty calendar body");
  const reader=response.body.getReader();
  const decoder=new TextDecoder("utf-8",{fatal:true});
  let bytes=0, text="";
  try {
    while (true) {
      const {done,value}=await reader.read();
      if (done) break;
      bytes+=value.byteLength;
      if (bytes>MAX_BYTES) throw new Error("Calendar response too large");
      text+=decoder.decode(value,{stream:true});
    }
    return JSON.parse(text+decoder.decode());
  } finally { await reader.cancel().catch(()=>{}); reader.releaseLock(); }
}

export function createHebcalReader(input: { fetch: typeof globalThis.fetch; cache: HebcalCache; verseCounts: VerseCounts; now?: () => number; timeoutMs?: number }) {
  const now=input.now ?? Date.now;
  const timeout=input.timeoutMs ?? 5000;
  if (!Number.isFinite(timeout) || timeout<1 || timeout>10000) throw new Error("Invalid calendar timeout");
  return async (dateInput: unknown, calendar: Calendar = "diaspora"): Promise<{ snapshot: Snapshot; fetchedAt: number; source: "cache" | "upstream" }> => {
    const request=hebcalRequest(dateInput,calendar);
    const time=now();
    let cached: CacheEntry | null;
    try { cached=await input.cache.get(request.cacheKey); }
    catch { throw new ReadingUnavailable("cache"); }
    if (cached && (!Number.isFinite(cached.fetchedAt) || !Number.isFinite(cached.expiresAt) || cached.fetchedAt>time || cached.expiresAt-cached.fetchedAt!==TTL)) throw new ReadingUnavailable("cache");
    if (cached && cached.expiresAt>time) {
      try { return {snapshot:normalizePayload(cached.payload,request.date,calendar,input.verseCounts,true).snapshot,fetchedAt:cached.fetchedAt,source:"cache"}; }
      catch { throw new ReadingUnavailable("cache"); }
    }
    const controller=new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const data=await Promise.race([
        (async()=>{
          const response=await input.fetch(request.url,{redirect:"error",credentials:"omit",headers:{accept:"application/json"},signal:controller.signal});
          if (!response.ok || response.redirected || (response.url && response.url!==request.url.href)) throw new ReadingUnavailable("upstream",cached?.fetchedAt ?? null);
          if (!/^application\/(?:[a-z0-9.+-]+\+)?json\b/i.test(response.headers.get("content-type") ?? "")) throw new ReadingUnavailable("invalid-response",cached?.fetchedAt ?? null);
          try { return normalizePayload(await boundedBody(response),request.date,calendar,input.verseCounts); }
          catch { throw new ReadingUnavailable("invalid-response",cached?.fetchedAt ?? null); }
        })(),
        new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new ReadingUnavailable("upstream",cached?.fetchedAt ?? null));},timeout);}),
      ]);
      try { await input.cache.set(request.cacheKey,{payload:data.payload,fetchedAt:time,expiresAt:time+TTL}); }
      catch { throw new ReadingUnavailable("cache"); }
      return {snapshot:data.snapshot,fetchedAt:time,source:"upstream"};
    } catch (error) { if (error instanceof ReadingUnavailable) throw error; throw new ReadingUnavailable("upstream",cached?.fetchedAt ?? null); }
    finally { if(timer)clearTimeout(timer); controller.abort(); }
  };
}

export function proposeReading(snapshot: Snapshot, counts: VerseCounts, options: { pick?: string | Pick; confirmed?: ConfirmedReading } = {}) {
  let selected: Selection | null=null;
  let reason: "no-reading" | "choose-selection" | null=null;
  let pick: Pick | undefined;
  try {
    pick=typeof options.pick === "string" ? parsePick(options.pick) : options.pick;
    if (pick && (!["ref","triennial","full","aliyah"].includes(pick.kind)
      || (pick.kind==="aliyah" && !((pick.from==="M" && pick.to==="M") || (Number.isInteger(pick.from) && Number.isInteger(pick.to) && Number(pick.from)>=1 && Number(pick.to)<=7 && Number(pick.to)>=Number(pick.from)))))) throw new Error();
  } catch { throw new Error("Invalid reading selection"); }
  if (!snapshot.reading && pick?.kind!=="ref") reason="no-reading";
  else if (!pick) reason="choose-selection";
  else {
    const effective=pick!;
    try { selected=selectTorah(snapshot.reading,effective); }
    catch { throw new Error("Invalid or unavailable reading selection"); }
    const selectedVerses=expandReadingRanges([selected.ref],"torah",counts);
    if (effective.kind==="full" || effective.kind==="triennial" || (effective.kind==="aliyah" && effective.from!=="M")) {
      if (!snapshot.reading) throw new Error("Calendar reading required for automatic selection");
      const rows=(effective.kind==="triennial" ? snapshot.reading.triennial!.aliyot : snapshot.reading.aliyot).filter(row=>row.n!=="M" && (effective.kind!=="aliyah" || (Number(row.n)>=Number(effective.from) && Number(row.n)<=Number(effective.to))));
      const individual=rows.flatMap(row=>expandReadingRanges([row.ref],"torah",counts));
      if (individual.join("|")!==selectedVerses.join("|")) throw new Error("Aliyot do not form a complete ordered range; choose an explicit custom range");
    }
  }
  return {
    status:selected ? "proposed" as const : "needs-selection" as const,
    requiresConfirmation:true as const, reason, ceremonyDate:snapshot.date, kind:"torah" as const,
    selection:selected, confirmed:options.confirmed ?? null,
    confirmedDateChanged:!!options.confirmed && options.confirmed.ceremonyDate!==snapshot.date,
    toConfirm:["torah","entryCap","nusach"] as const,
  };
}
