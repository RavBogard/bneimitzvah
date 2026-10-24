import { createRequire } from "node:module";
import { randomBytes, randomUUID } from "node:crypto";
import { setTimeout as pollDelay } from "node:timers/promises";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createAuthStack } from "../../src/server/auth/factory";
import { createAccessService } from "../../src/server/access/service";
import { createPracticeService } from "../../src/server/practice/service";
import type { AccessRequest } from "../../src/server/access/types";
import type { CookieMutationRequest } from "../../src/server/http/mutations";
import * as s from "../../src/server/db/index";
import * as authSchema from "../../src/server/db/auth-schema";
import { disposableConfig, query } from "./disposable.mjs";

// Runtime driver only; the existing project does not install @types/pg. Drizzle
// supplies the typed application database/transactions used below.
const { Client, Pool } = createRequire(import.meta.url)("pg");

export function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve=done; });
  return {promise,resolve};
}

export async function waitForEntry(entry:Promise<void>,operation:Promise<unknown>) {
  let timer:ReturnType<typeof setTimeout>|undefined;
  try {
    await Promise.race([
      entry,
      operation.then(
        ()=>{throw new Error("Access operation completed before the test barrier");},
        ()=>{throw new Error("Access operation failed before the test barrier");},
      ),
      new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error("Access test barrier was not reached")),5000);}),
    ]);
  } finally { if(timer)clearTimeout(timer); }
}

export async function settleRace(operations:Promise<unknown>[]) {
  let timer:ReturnType<typeof setTimeout>|undefined;
  try {
    await Promise.race([
      Promise.allSettled(operations),
      new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error("Access test operations did not settle after barrier release")),12000);}),
    ]);
  } finally { if(timer)clearTimeout(timer); }
}

export async function postgresAccessFixture(options: { migrationsFolder?: string } = {}) {
  const config=disposableConfig();
  const suffix=randomBytes(8).toString("hex");
  const database=`portal_access_${suffix}`;
  const login=`portal_access_${suffix}`;
  const password=randomBytes(32).toString("hex");
  const secret=randomBytes(48).toString("base64url");
  const anchor=new Client(config);
  const owner=new Client({...config,database});
  const aPool=new Pool({...config,database,user:login,password,max:1});
  const bPool=new Pool({...config,database,user:login,password,max:1});
  const activeClients=new Set<{release:(destroy?:boolean)=>void}>();
  for(const pool of [aPool,bPool]) {
    pool.on("acquire",(client:{release:(destroy?:boolean)=>void})=>activeClients.add(client));
    pool.on("release",(_error:unknown,client:{release:(destroy?:boolean)=>void})=>activeClients.delete(client));
  }
  let createdDatabase=false,createdRole=false;

  async function close() {
    // A failed test must not let a stuck callback keep pool.end waiting forever.
    // Both pools and every checked-out client belong solely to this fixture.
    for(const client of activeClients) {try{client.release(true);}catch{/* Already released. */}}
    await Promise.all([aPool.end(),bPool.end()]);
    await owner.end();
    // These identifiers are generated here, not configured or existing names.
    if(createdDatabase)await query(anchor,`DROP DATABASE "${database}"`);
    if(createdRole)await query(anchor,`DROP ROLE "${login}"`);
    await anchor.end();
  }

  try {
    await anchor.connect();
    await query(anchor,`CREATE DATABASE "${database}"`);createdDatabase=true;
    await owner.connect();
    const ownerDb=drizzle(owner,{schema:s,logger:false});
    await migrate(ownerDb,{migrationsFolder:options.migrationsFolder ?? "src/server/db/migrations"});
    await query(owner,`CREATE ROLE "${login}" LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${password}'`);createdRole=true;
    await query(owner,`GRANT portal_runtime TO "${login}"`);
    // A pre-0028 prefix still signs in with today's auth schema; 0028 adds the column IF NOT EXISTS.
    if(options.migrationsFolder)await query(owner,`ALTER TABLE "session" ADD COLUMN IF NOT EXISTS "google_authenticated_at" timestamp`);
    const aDb=drizzle(aPool,{schema:s,logger:false});
    const bDb=drizzle(bPool,{schema:s,logger:false});
    const authInput={origin:"http://localhost:3000",secret,codeSecret:randomBytes(48).toString("base64url"),sendMagicLink:async()=>{}};
    const deliveries:{url:string}[]=[];
    const authA=createAuthStack(aDb,authSchema,{...authInput,sendMagicLink:async message=>{deliveries.push({url:message.url});}});
    const authB=createAuthStack(bDb,authSchema,authInput);
    async function signIn(name:string) {
      const response=await authA.handler(new Request("http://localhost:3000/api/auth/sign-in/magic-link",{
        method:"POST",headers:{origin:"http://localhost:3000","content-type":"application/json"},
        body:JSON.stringify({email:`${name}@example.test`,callbackURL:"/"}),
      }));
      if(response.status!==200 || !deliveries.length)throw new Error("Synthetic authentication failed");
      const redeemed=await authA.handler(new Request(deliveries.pop()!.url));
      const cookie=redeemed.headers.getSetCookie().map(value=>value.split(";")[0]).join("; ");
      const proof=await authA.api.getSession({headers:new Headers({cookie}),query:{disableRefresh:true,disableCookieCache:true}});
      if(!proof)throw new Error("Synthetic authentication proof missing");
      return {cookie,id:proof.user.id,sessionId:proof.session.id};
    }
    const admin=await signIn("pg-admin");
    const tutor=await signIn("pg-tutor");
    await ownerDb.insert(s.tenant).values({id:"other",name:"Synthetic other",productName:"Synthetic"});
    await ownerDb.insert(s.tenantHost).values([
      {host:"localhost:3000",tenantId:"crc",environment:"test",deployment:"postgres",origin:"http://localhost:3000"},
      {host:"localhost:3101",tenantId:"other",environment:"test",deployment:"postgres",origin:"http://localhost:3101"},
    ]);
    const [adminMember]=await ownerDb.insert(s.membership).values({tenantId:"crc",userId:admin.id}).returning();
    const [tutorMember]=await ownerDb.insert(s.membership).values({tenantId:"crc",userId:tutor.id}).returning();
    await ownerDb.insert(s.roleGrant).values({tenantId:"crc",membershipId:adminMember.id,role:"admin"});
    const [tutorGrant]=await ownerDb.insert(s.roleGrant).values({tenantId:"crc",membershipId:tutorMember.id,role:"tutor"}).returning();
    const [parentGrant]=await ownerDb.insert(s.roleGrant).values({tenantId:"crc",membershipId:tutorMember.id,role:"parent"}).returning();
    // Named columns only: a migration-prefix fixture (the 0023-to-0024 upgrade) predates later student
    // columns, and a Drizzle insert would name every current column.
    const [student,otherStudent]=(await query<{id:string;tenantId:string;firstName:string;lastName:string;ceremonyDate:string;revision:number}>(owner,
      `INSERT INTO student(tenant_id,first_name,last_name,ceremony_date,parent_email) VALUES ('crc','Synthetic','Learner','2027-01-02','fixture@example.test'),('other','Synthetic','Other','2027-01-02','fixture@example.test')
       RETURNING id,tenant_id AS "tenantId",first_name AS "firstName",last_name AS "lastName",ceremony_date::text AS "ceremonyDate",revision`)).rows;
    const [link]=await ownerDb.insert(s.tutorStudent).values({tenantId:"crc",studentId:student.id,tutorGrantId:tutorGrant.id}).returning();
    await ownerDb.insert(s.guardian).values({tenantId:"crc",studentId:student.id,parentGrantId:parentGrant.id,linkProvenance:"synthetic"});
    const deployment={environment:"test" as const,deployment:"postgres"};
    const a=createAccessService({db:aDb,auth:authA,deployment});
    const b=createAccessService({db:bDb,auth:authB,deployment});
    const pidA=(await query<{pid:number}>(aPool,"SELECT pg_backend_pid() AS pid")).rows[0].pid;
    const pidB=(await query<{pid:number}>(bPool,"SELECT pg_backend_pid() AS pid")).rows[0].pid;
    if(pidA===pidB)throw new Error("Independent runtime backends required");
    function request(who:"admin"|"tutor",origin="http://localhost:3000"):AccessRequest {
      return {url:`${origin}/students`,headers:new Headers({cookie:(who==="admin"?admin:tutor).cookie})};
    }
    async function waitForLock(blocked:number,blocker:number) {
      const deadline=Date.now()+5000;
      while(Date.now()<deadline) {
        const state=(await query<{blocked:boolean}>(owner,"SELECT $1::integer = ANY(pg_blocking_pids($2::integer)) AS blocked",[blocker,blocked])).rows[0];
        if(state.blocked)return;
        await pollDelay(10); // Sampling interval; the assertion requires a real PG lock edge.
      }
      throw new Error("Expected PostgreSQL blocking edge was not observed");
    }
    async function intercept(which:"a"|"b",matches:(text:string)=>boolean,handler:(proceed:()=>Promise<unknown>)=>Promise<unknown>){
      const pool=which==="a"?aPool:bPool;
      const client=await pool.connect();
      const original=client.query;
      const bound=original.bind(client);
      // Preserve the driver's callback-style API for every non-target query,
      // including SDK session work performed through pool.query(). No SQL or
      // parameters are logged or copied into assertion failures.
      client.query=(...args:unknown[])=>{
        const config=args[0] as string|{text?:string};
        const text=typeof config==="string"?config:config?.text??"";
        if(!matches(text))return bound(...args);
        return handler(()=>Promise.resolve(bound(...args)));
      };
      client.release();
      return ()=>{client.query=original;};
    }
    async function practice() {
      // Opt-in practice fixture additions leave the existing access/reading
      // fixtures and their exact cardinality assertions unchanged.
      const [sibling]=await ownerDb.insert(s.student).values({tenantId:"crc",firstName:"Synthetic",lastName:"Sibling",
        ceremonyDate:"2027-01-02",parentEmail:"fixture@example.test"}).returning();
      await ownerDb.insert(s.guardian).values({tenantId:"crc",studentId:sibling.id,parentGrantId:parentGrant.id,linkProvenance:"synthetic-practice"});
      function practiceRequest(handle?:string):CookieMutationRequest {
        return {url:"http://localhost:3000/practice",method:"POST",headers:new Headers({origin:"http://localhost:3000",cookie:tutor.cookie,
          ...(handle===undefined?{}:{"X-Practice-Context":handle})})};
      }
      return {a:createPracticeService({access:a}),b:createPracticeService({access:b}),sibling,request:practiceRequest};
    }
    return {a,b,aDb,bDb,owner,ownerDb,pidA,pidB,request,admin,tutor,student,otherStudent,link,tutorGrant,close,waitForLock,intercept,signIn,practice};
  } catch {
    try{await close();}catch{/* Do not disclose provider/SQL details from cleanup. */}
    throw new Error("Disposable PostgreSQL access fixture setup failed; details withheld");
  }
}

export const newRequestId=()=>randomUUID();
