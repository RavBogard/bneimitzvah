import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { authFixture } from "./auth-stack-helper";
import * as schema from "../../src/server/db/index";
import { loadRuntimeConfig } from "../../src/server/runtime/config";
import { RuntimeUnavailable } from "../../src/server/runtime/errors";
import { composeRuntime, createRuntimeScope } from "../../src/server/runtime/composition";
import { createPersistentReadingCache } from "../../src/server/data/reading-cache";
import { createHebcalReader, hebcalRequest, ReadingUnavailable } from "../../src/lib/readings/proposals";
import { TANAKH_VERSE_COUNTS } from "../../src/lib/readings/catalog";

const env = () => {
  const database = new URL("postgresql://ep-synthetic.us-east-2.aws.neon.tech/synthetic");
  database.username = "synthetic_login";
  database.password = randomBytes(24).toString("hex");
  database.searchParams.set("sslmode", "require");
  return { PORTAL_ENVIRONMENT: "local", PORTAL_DEPLOYMENT: "synthetic-runtime", BETTER_AUTH_URL: "http://localhost:3000", "DATABASE_URL": database.href,
    "BETTER_AUTH_SECRET": randomBytes(48).toString("base64url"), "RESEND_API_KEY": `re_${randomBytes(24).toString("hex")}`, RESEND_FROM: "synthetic@example.test" };
};
const clients: Awaited<ReturnType<typeof authFixture>>[] = [];
afterEach(async () => { await Promise.all(clients.splice(0).map((f) => f.client.close())); });
async function safeUnavailable(action: () => unknown | Promise<unknown>) {
  try { await action(); return false; } catch (error) { return error instanceof RuntimeUnavailable && error.message === "Service temporarily unavailable" && !("cause" in error); }
}
async function cacheDenied(action: () => Promise<unknown>) {
  try { await action(); return false; } catch (error) { return error instanceof ReadingUnavailable && error.code === "cache" && !("cause" in error); }
}

test("private configuration rejects aliases, environment contradictions, operator credentials and incomplete secrets without leaking inputs", async () => {
  const base = env();
  const invalid = [
    { BETTER_AUTH_URL: "https://bneimitzvah-random.vercel.app", PORTAL_ENVIRONMENT: "production", PORTAL_DEPLOYMENT: "production" },
    { BETTER_AUTH_URL: "http://localhost:3000", PORTAL_ENVIRONMENT: "production" },
    { NODE_ENV: "production" }, { VERCEL: "1" }, { VERCEL_ENV: "production" },
    { PORTAL_ENVIRONMENT: "test" }, { PORTAL_DEPLOYMENT: "" }, { BETTER_AUTH_URL: "http://localhost:3000/" },
    { BETTER_AUTH_URL: "http://user@localhost:3000" }, { BETTER_AUTH_URL: "http://localhost:3000/path" },
    { "BETTER_AUTH_SECRET": "short" }, { GOOGLE_CLIENT_ID: "partial" }, { "GOOGLE_CLIENT_SECRET": "partial" },
    { DATABASE_MIGRATION_URL: base.DATABASE_URL }, { BOOTSTRAP_OWNER_EMAIL: "synthetic@example.test" },
    { "DATABASE_URL": base.DATABASE_URL.replace("synthetic_login", "neondb_owner") },
    { "DATABASE_URL": base.DATABASE_URL + "&options=-crole%3Downer" },
    { "DATABASE_URL": base.DATABASE_URL + "&channel_binding=require" },
    { "DATABASE_URL": base.DATABASE_URL.replace("sslmode=require", "sslmode=disable") },
    { "RESEND_API_KEY": "" }, { RESEND_FROM: "Synthetic <synthetic@example.test>" },
    { PORTAL_ENVIRONMENT: "preview", BETTER_AUTH_URL: "https://bneimitzvah.centralreform.org" },
    { PORTAL_ENVIRONMENT: "preview", BETTER_AUTH_URL: "https://bneimitzvah.vercel.app" },
    { PORTAL_ENVIRONMENT: "preview", BETTER_AUTH_URL: "http://preview.example.test" },
  ];
  for (const change of invalid) expect(await safeUnavailable(() => loadRuntimeConfig({ ...base, ...change }))).toBe(true);
  const production = loadRuntimeConfig({ ...base, PORTAL_ENVIRONMENT: "production", PORTAL_DEPLOYMENT: "production", VERCEL_ENV: "production", NODE_ENV: "production", BETTER_AUTH_URL: "https://bneimitzvah.centralreform.org" });
  expect(production.deployment).toEqual({ environment: "production", deployment: "production" });
  const preview = loadRuntimeConfig({ ...base, PORTAL_ENVIRONMENT: "preview", VERCEL_ENV: "preview", BETTER_AUTH_URL: "https://one-exact-preview.example.test" });
  expect(preview.origin).toBe("https://one-exact-preview.example.test");
  expect(Object.isFrozen(preview)).toBe(true);
});

test("production selects exactly one configured CRC origin and rejects sibling aliases or preview reuse", async () => {
  const base = { ...env(), PORTAL_ENVIRONMENT: "production", PORTAL_DEPLOYMENT: "production", VERCEL_ENV: "production", NODE_ENV: "production" };
  for (const origin of ["https://beitmitzvah.centralreform.org", "https://bneimitzvah.centralreform.org", "https://bneimitzvah.vercel.app", "https://torah.centralreform.org"]) {
    expect(loadRuntimeConfig({ ...base, BETTER_AUTH_URL: origin }).origin === origin).toBe(true);
    expect(await safeUnavailable(() => loadRuntimeConfig({ ...base, PORTAL_ENVIRONMENT: "preview", VERCEL_ENV: "preview", BETTER_AUTH_URL: origin }))).toBe(true);
  }
  for (const origin of ["https://barmitzvah.centralreform.org", "https://batmitzvah.centralreform.org", "https://bnaimitzvah.centralreform.org", "https://bneimitzvah-random.vercel.app", "https://sub.bneimitzvah.vercel.app", "https://bneimitzvah.vercel.app.evil.invalid",
    "https://sub.torah.centralreform.org", "https://torah.centralreform.org.evil.invalid", "http://torah.centralreform.org", "https://torah.centralreform.org/",
    "https://bneimitzvah.vercel.app:443", "https://bneimitzvah.vercel.app/", "https://bneimitzvah.vercel.app/path", "http://bneimitzvah.vercel.app"]) {
    expect(await safeUnavailable(() => loadRuntimeConfig({ ...base, BETTER_AUTH_URL: origin }))).toBe(true);
  }
});

test("adding canonical directory data never creates an auth-origin union and switching back restores exact stable selection", async () => {
  const f = await authFixture(); clients.push(f);
  const db = drizzle(f.client, { schema });
  const origins = ["https://beitmitzvah.centralreform.org", "https://bneimitzvah.vercel.app", "https://bneimitzvah.centralreform.org", "https://torah.centralreform.org"];
  for (const selected of [origins[1], origins[0], origins[3], origins[1]]) {
    const config = loadRuntimeConfig({ ...env(), PORTAL_ENVIRONMENT: "production", PORTAL_DEPLOYMENT: "production", BETTER_AUTH_URL: selected });
    const runtime = composeRuntime(config, db, async () => { throw new Error("No external requests permitted"); });
    expect(runtime.auth.options.trustedOrigins).toEqual([selected]);
    expect(runtime.auth.options.baseURL).toBe(selected);
    expect((await runtime.resolveHost({ url: selected, headers: new Headers({ host: new URL(selected).host }) })).origin).toBe(selected);
    for (const other of origins.filter(origin => origin !== selected)) {
      expect(await safeUnavailable(() => runtime.resolveHost({ url: other, headers: new Headers({ host: new URL(other).host }) }))).toBe(true);
    }
  }
});

test("parked student recordings stay off unless PORTAL_RECORDINGS_ENABLED is exactly true, in production as anywhere", async () => {
  const production = { ...env(), PORTAL_ENVIRONMENT: "production", PORTAL_DEPLOYMENT: "production", VERCEL_ENV: "production", NODE_ENV: "production", BETTER_AUTH_URL: "https://beitmitzvah.centralreform.org" };
  expect(loadRuntimeConfig(production).recordingsEnabled).toBe(false);
  expect(loadRuntimeConfig({ ...production, PORTAL_RECORDINGS_ENABLED: "false" }).recordingsEnabled).toBe(false);
  expect(loadRuntimeConfig({ ...production, PORTAL_RECORDINGS_ENABLED: "true" }).recordingsEnabled).toBe(true);
  for (const value of ["1", "yes", "TRUE", " true", ""]) expect(await safeUnavailable(() => loadRuntimeConfig({ ...production, PORTAL_RECORDINGS_ENABLED: value }))).toBe(true);
  const f = await authFixture(); clients.push(f);
  const db = drizzle(f.client, { schema });
  const offline = async () => { throw new Error("No external requests permitted"); };
  expect(composeRuntime(loadRuntimeConfig(production), db, offline).recordings).toBeNull();
  expect(composeRuntime(loadRuntimeConfig({ ...production, PORTAL_RECORDINGS_ENABLED: "true" }), db, offline).recordings).not.toBeNull();
});

test("runtime scope remains lazy and missing configuration fails closed before callback/network", async () => {
  let reads = 0, calls = 0;
  const scope = createRuntimeScope(() => { reads++; return {}; });
  expect(reads).toBe(0);
  const spy = vi.spyOn(console, "info").mockImplementation(() => {});
  try { expect(await safeUnavailable(() => scope(async () => { calls++; }))).toBe(true); }
  finally { spy.mockRestore(); }
  expect(reads).toBe(1);
  expect(calls).toBe(0);
});

test("composed real auth stack sends only synthetic mail to injected transport and exact deployment host mapping remains authoritative", async () => {
  const f = await authFixture(); clients.push(f);
  const db = drizzle(f.client, { schema });
  const config = loadRuntimeConfig(env());
  await db.insert(schema.tenantHost).values({ host: "localhost:3000", origin: config.origin, tenantId: "crc", environment: "local", deployment: config.deployment.deployment });
  // Compose as production does: a restricted nonowner login acting as portal_runtime. The sign-in email reads the
  // congregation's product name in a tenant transaction, which refuses any elevated role.
  await f.client.exec("CREATE ROLE runtime_login LOGIN; GRANT portal_runtime TO runtime_login; SET SESSION AUTHORIZATION runtime_login; SET ROLE portal_runtime");
  let mailCalls = 0;
  const runtime = composeRuntime(config, db, async (url, options) => {
    if (String(url) !== "https://api.resend.com/emails") throw new Error("Unexpected test provider");
    const payload = JSON.parse(String(options?.body));
    if (typeof payload.text !== "string" || !payload.text.includes("/auth/email#token=")) throw new Error("Invalid synthetic message");
    mailCalls++;
    return new Response("{}", { status: 200 });
  });
  expect((await runtime.resolveHost({ url: config.origin, headers: new Headers() })).tenantId).toBe("crc");
  await runtime.auth.api.signInMagicLink({ body: { email: "runtime-recipient@example.test", callbackURL: "/" }, headers: new Headers({ origin: config.origin }) });
  expect(mailCalls).toBe(1);
  expect(typeof runtime.invitations.issue).toBe("function");
  expect(typeof runtime.students.prepareReading).toBe("function");
  expect(typeof runtime.practice.enter).toBe("function");
  const mismatched = composeRuntime({ ...config, deployment: { environment: "local", deployment: "foreign" } }, db, async () => { throw 0; });
  let denied = false;
  try { await mismatched.resolveHost({ url: config.origin, headers: new Headers() }); } catch { denied = true; }
  expect(denied).toBe(true);
});

test("persistent nonpersonal reading cache round-trips normalized metadata and rejects transplanted binding, invalid ranges and hidden personal fields", async () => {
  const f = await authFixture(); clients.push(f);
  const db = drizzle(f.client, { schema });
  const cache = createPersistentReadingCache(db);
  const time = Date.now();
  const request = hebcalRequest("2027-01-02");
  let calls = 0;
  const read = createHebcalReader({ cache, verseCounts: TANAKH_VERSE_COUNTS, now: () => time, fetch: async () => {
    calls++; return new Response(JSON.stringify({ items: [{ date: request.date, name: { en: "Synthetic" }, type:"shabbat", parshaNum:13, fullkriyah: { "1": { k: "Genesis", b: "1:31", e: "2:2", v: 3 } } }] }), { headers: { "content-type": "application/json" } });
  } });
  const upstream=await read(request.date),cached=await read(request.date);
  expect(upstream.source).toBe("upstream");expect(upstream.snapshot.classification).toBe("regular");
  expect(cached.source).toBe("cache");expect(cached.snapshot).toEqual(upstream.snapshot);
  expect(calls).toBe(1);
  const entry = (await cache.get(request.cacheKey))!;
  const clone = () => JSON.parse(JSON.stringify(entry));
  const mutate=(change:(payload:Record<string,any>)=>void)=>{const payload=clone().payload;change(payload);return payload;};
  for (const payload of [
    { binding: { version: 2, date: request.date, calendar: "israel" }, items: [] },
    { binding: { version: 2, date: "2027-01-03", calendar: "diaspora" }, items: [] },
    { ...(entry.payload as object), email: "synthetic@example.test" },
    mutate(p=>{p.binding.token="synthetic-private";}),
    mutate(p=>{p.items[0].name.email="synthetic@example.test";}),
    mutate(p=>{p.items[0].fullkriyah["1"].token="synthetic-private";}),
    mutate(p=>{p.items[0].parshaNum={email:"synthetic@example.test"};}),
    mutate(p=>{p.items[0].parshaNum=[1,2,3];}),
    mutate(p=>{p.items[0].type="arbitrary";}),
    mutate(p=>{delete p.items[0].type;}),
    mutate(p=>{p.classification={email:"synthetic@example.test"};}),
    mutate(p=>{p.classification="multiple";}),
    mutate(p=>{p.items[0].name.en="x".repeat(140000);}),
    { binding: { version: 2, date: request.date, calendar: "diaspora" }, items: [{ date: request.date, name: { en: "Synthetic" }, type: "shabbat", fullkriyah: { "1": { k: "Genesis", b: "1:31", e: "2:9999" } } }] },
  ]) expect(await cacheDenied(() => cache.set(request.cacheKey, { ...clone(), payload }))).toBe(true);
  expect(await cacheDenied(() => cache.set("personal:synthetic@example.test", entry))).toBe(true);
  for(const change of [{fetchedAt:-1},{fetchedAt:NaN},{expiresAt:entry.expiresAt+1},{expiresAt:Infinity}])expect(await cacheDenied(()=>cache.set(request.cacheKey,{...clone(),...change}))).toBe(true);
  const oldKey=request.cacheKey.replace(":v2:",":v1:");
  expect(await cacheDenied(()=>cache.set(oldKey,entry))).toBe(true);
  expect(await cacheDenied(()=>cache.get(oldKey))).toBe(true);
  await db.update(schema.hebcalCache).set({ parameters: { calendar: "israel" } }).where(eq(schema.hebcalCache.requestKey, request.cacheKey));
  expect(await cacheDenied(() => cache.get(request.cacheKey))).toBe(true);
  await db.update(schema.hebcalCache).set({ parameters: { calendar: "diaspora" }, payload: { binding: { version: 2, date: "2027-01-03", calendar: "diaspora" }, items: [] } }).where(eq(schema.hebcalCache.requestKey, request.cacheKey));
  expect(await cacheDenied(() => cache.get(request.cacheKey))).toBe(true);
});


test("persistent v2 cache retains missing-type uncertainty and multiple-result fallback across real database reads",async()=>{
 const f=await authFixture();clients.push(f);const db=drizzle(f.client,{schema}),cache=createPersistentReadingCache(db),time=Date.now();
 for(const [date,multiple] of [["2026-10-03",true],["2026-10-17",false]] as const){
  const request=hebcalRequest(date);let calls=0;
  const item={date,name:{en:"Synthetic calendar"},parshaNum:2,fullkriyah:{"1":{k:"Genesis",b:"1:1",e:"1:3",v:3}}};
  const payload={items:multiple?[{...item,type:"holiday"},{...item,type:"holiday"}]:[item]};
  const read=createHebcalReader({cache,verseCounts:TANAKH_VERSE_COUNTS,now:()=>time,fetch:async()=>{calls++;return new Response(JSON.stringify(payload),{headers:{"content-type":"application/json"}});}});
  const upstream=await read(date),cached=await read(date);
  expect(upstream.snapshot.classification).toBe(multiple?"multiple":"nonregular");
  expect(cached.source).toBe("cache");expect(cached.snapshot).toEqual(upstream.snapshot);expect(calls).toBe(1);
  const saved=(await cache.get(request.cacheKey))!;
  const normalized=saved.payload as {classification?:string;items:{type:string;parshaNum:number}[]};
  if(multiple)expect(normalized).toMatchObject({classification:"multiple",items:[]});
  else expect(normalized.items[0]).toMatchObject({type:"unknown",parshaNum:2});
  for(const payload of [
   {...normalized,classification:{email:"synthetic@example.test"}},
   {...normalized,binding:{version:2,date,calendar:"israel"}},
   {...normalized,binding:{version:2,date:"2026-10-24",calendar:"diaspora"}},
   {...normalized,token:"synthetic-private"}
  ]){
   await db.update(schema.hebcalCache).set({payload}).where(eq(schema.hebcalCache.requestKey,request.cacheKey));
   expect(await cacheDenied(()=>cache.get(request.cacheKey))).toBe(true);
  }
 }
 // A valid v1 row must be invisible to a v2 lookup rather than transplanted.
 const request=hebcalRequest("2026-10-24");
 await db.insert(schema.hebcalCache).values({requestKey:request.cacheKey.replace(":v2:",":v1:"),requestDate:request.date,parameters:{calendar:"diaspora"},payload:{binding:{version:1,date:request.date,calendar:"diaspora"},items:[]},fetchedAt:new Date(time),expiresAt:new Date(time+86400000)});
 expect(await cache.get(request.cacheKey)).toBeNull();
});

test("persistent reading cache stores and serves a multi-range haftarah (Shemot, Shabbat Shuva, Mishpatim) and still refuses smuggled fields in its rows",async()=>{
  const f=await authFixture();clients.push(f);const db=drizzle(f.client,{schema}),cache=createPersistentReadingCache(db),time=Date.now();
  const expected:Record<string,string>={shemot:"Isaiah 27:6-28:13; Isaiah 29:22-23","shabbat-shuva":"Hosea 14:2-10; Joel 2:15-27",mishpatim:"Jeremiah 34:8-22; Jeremiah 33:25-26"};
  for(const name of Object.keys(expected)){
    const payload=JSON.parse(readFileSync(new URL(`../fixtures/trope/hebcal/${name}.json`,import.meta.url),"utf8")),date=payload.range.start as string;let calls=0;
    const read=createHebcalReader({cache,verseCounts:TANAKH_VERSE_COUNTS,now:()=>time,fetch:async()=>{calls++;return new Response(JSON.stringify(payload),{headers:{"content-type":"application/json"}});}});
    const upstream=await read(date),cached=await read(date);
    expect(upstream.snapshot.haftarah).toBe(expected[name]);expect(upstream.snapshot.reading).not.toBeNull();
    expect(cached.source).toBe("cache");expect(cached.snapshot).toEqual(upstream.snapshot);expect(calls).toBe(1);
    const key=hebcalRequest(date).cacheKey,entry=(await cache.get(key))!;
    expect(Array.isArray((entry.payload as {items:{haft:unknown}[]}).items[0].haft)).toBe(true);
    const mutate=(change:(haft:Record<string,unknown>[])=>unknown)=>{const copy=JSON.parse(JSON.stringify(entry));const next=change(copy.payload.items[0].haft);if(next!==undefined)copy.payload.items[0].haft=next;return copy;};
    for(const bad of [mutate(h=>{h[1].email="synthetic@example.test";}),mutate(h=>{h[0].k="synthetic@example.test";}),mutate(h=>{h[1].b="token-abc";}),mutate(h=>{h[0].v="secret";}),mutate(h=>{h[1].reason="a@b";}),mutate(h=>{h[1].e="99:99";}),mutate(h=>[...h,"x"]),mutate(()=>[]),mutate(h=>Array.from({length:9},()=>h[0])),mutate(h=>[h[0],[h[1]]])])
      expect(await cacheDenied(()=>cache.set(key,bad))).toBe(true);
  }
});
