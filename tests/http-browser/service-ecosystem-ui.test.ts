import { afterAll,beforeAll,expect,it,vi } from "vitest";
import { expect as ui } from "@playwright/test";
import { chromium,type Browser,type BrowserContext,type Page } from "playwright";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { isolatedEnv } from "../helpers/isolatedEnv.mjs";
import { browserFixture } from "./fixture";
import { BROWSER_ORIGIN,assertBrowserStartupAllowed,startBrowserServer } from "./server";
import { installLoopbackFetchGuard } from "./egress";
import { openAuthMail } from "./auth-navigation";
import { syntheticServiceCatalog } from "../helpers/service-learning";
import { syntheticUiStudyPage } from "../helpers/study-ui";
import { resourceIdentity } from "../../src/server/service-ecosystem/service";
import type { MusicProjection,MusicBroker,MusicResult } from "../../src/server/service-ecosystem/contract";
import * as s from "../../src/server/db/index";
vi.mock("server-only",()=>({}));
let fixture:Awaited<ReturnType<typeof browserFixture>>,browser:Browser,stop:(()=>Promise<void>)|undefined,restore:(()=>void)|undefined,isolation:Awaited<ReturnType<typeof isolatedEnv>>|undefined;
const contexts:BrowserContext[]=[];let revoked=false;
const projection:MusicProjection={setlistId:"synthetic-service",sourceRevision:"synthetic-revision-1",localDate:"2027-01-02",ceremonyType:"morning",operatorLinks:{music:"https://music.example.test/setlists/synthetic-service",review:"https://music.example.test/beit-mitzvah/synthetic"},rows:[
  {rowId:"synthetic-opening",order:0,title:"Synthetic opening part",prayerId:"synthetic-prayer",arrangement:{songId:"synthetic-song"},liturgyRef:{book:"synthetic-book",folio:2,serviceViewId:"synthetic-view"},resources:[{resourceId:"synthetic-score",kind:"score",label:"Practice score"},{resourceId:"synthetic-held-audio",kind:"audio",label:"Held recording"}]},
  {rowId:"synthetic-closing",order:1,title:"Synthetic closing part",resources:[]},
]};
const response=async():Promise<MusicResult>=>revoked?{version:1,status:"review_required",setlistId:projection.setlistId,sourceRevision:projection.sourceRevision,projection:{...projection,rows:[]}}:{version:1,status:"linked",setlistId:projection.setlistId,sourceRevision:projection.sourceRevision,projection};
const broker:MusicBroker={ensure:response,projection:response,resource:async()=>{throw new Error("Synthetic resource access not requested");}};
beforeAll(async()=>{
  let stage="preflight";
  try{
    assertBrowserStartupAllowed();restore=installLoopbackFetchGuard();stage="fixture";fixture=await browserFixture({musicBroker:broker,referenceStudentRelease:false,studyLoad:async request=>syntheticUiStudyPage(request)});
    stage="student identity";
    const learner=await fixture.signIn("pg-service-ecosystem"),[membership]=await fixture.ownerDb.insert(s.membership).values({tenantId:"crc",userId:learner.id}).returning();
    const [grant]=await fixture.ownerDb.insert(s.roleGrant).values({tenantId:"crc",membershipId:membership.id,role:"student"}).returning();
    await fixture.ownerDb.insert(s.studentIdentity).values({tenantId:"crc",studentId:fixture.student.id,roleGrantId:grant.id});
    await fixture.ownerDb.update(s.student).set({serviceSlot:"morning"}).where(eq(s.student.id,fixture.student.id));
    await fixture.ownerDb.update(s.guardian).set({practiceEnabled:true,revision:2}).where(eq(s.guardian.studentId,fixture.student.id));
    stage="catalog and ceremony";const content=syntheticServiceCatalog(),catalogId=randomUUID(),ceremonyId=randomUUID();
    await fixture.ownerDb.insert(s.serviceCatalog).values({id:catalogId,tenantId:"crc",identity:content.identity,feedBytes:content.feedBytes,provenanceBytes:content.provenanceBytes,pins:content.pins});
    await fixture.ownerDb.insert(s.serviceCatalogLifecycle).values({tenantId:"crc",catalogId,state:"active"});
    await fixture.ownerDb.insert(s.serviceCeremony).values({id:ceremonyId,tenantId:"crc",localDate:"2027-01-02",ceremonyType:"morning",requestedDate:"2027-01-02",requestedType:"morning",scheduleKey:"2027-01-02-morning",state:"linked",setlistId:projection.setlistId,projection});
    await fixture.ownerDb.insert(s.studentCeremony).values({tenantId:"crc",studentId:fixture.student.id,ceremonyId});
    await fixture.ownerDb.insert(s.studentServicePart).values({tenantId:"crc",studentId:fixture.student.id,ceremonyId,rowId:"synthetic-opening",resourceIdentity:resourceIdentity(projection.rows[0]),directions:"Practice this synthetic phrase.",privateFeedback:"Synthetic feedback for the student.",catalogId,catalogIdentity:content.identity,catalogUnitId:content.first});
    stage="Next server";stop=await startBrowserServer(fixture.withRuntime);stage="Chromium";isolation=await isolatedEnv();browser=await chromium.launch({headless:true,env:isolation.env});
  }catch(error){await browser?.close().catch(()=>undefined);await stop?.().catch(()=>undefined);await fixture?.close().catch(()=>undefined);await isolation?.cleanup();restore?.();throw new Error(`Synthetic service ecosystem browser setup failed at ${stage}${stage==="Next server"&&error instanceof Error?`: ${error.message}`:""}`);}
},120000);
afterAll(async()=>{await Promise.all(contexts.map(context=>context.close().catch(()=>undefined)));await browser?.close().catch(()=>undefined);await stop?.().catch(()=>undefined);await fixture?.close().catch(()=>undefined);await isolation?.cleanup();restore?.();},120000);
async function page(role:"student"|"admin"|"parent"){
  const context=await browser.newContext({baseURL:BROWSER_ORIGIN,serviceWorkers:"block",acceptDownloads:false,viewport:{width:390,height:844}});contexts.push(context);
  await context.route("**/*",async route=>{if(new URL(route.request().url()).origin===BROWSER_ORIGIN)await route.continue();else await route.abort();});
  const tab=await context.newPage();await tab.goto("/",{waitUntil:"domcontentloaded"});
  const email=role==="student"?"pg-service-ecosystem@example.test":role==="parent"?"pg-tutor@example.test":"pg-admin@example.test";
  await tab.evaluate(async email=>{const response=await fetch("/api/auth/sign-in/magic-link",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email})});if(!response.ok)throw new Error("Synthetic sign-in unavailable");},email);
  await openAuthMail(tab,fixture.takeMail(email));await tab.goto(role==="student"?"/workspace/student?tab=reading":role==="parent"?"/workspace/parent":`/workspace/admin/students/${fixture.student.id}/reading`,{waitUntil:"domcontentloaded"});
  if(role==="parent"){await tab.locator(`button.student-card[data-student-id="${fixture.student.id}"]`).click();await tab.getByRole("button",{name:"Practice with Synthetic",exact:true}).click();await ui(tab.getByRole("button",{name:"Done",exact:true})).toBeVisible();}
  await tab.getByRole("tab",{name:"Service parts",exact:true}).click();
  await ui(tab.locator("[data-my-service]").getByRole("heading",{name:"My service",exact:true})).toBeVisible();return tab;
}
async function captures(tab:Page){
  const directory=join(process.cwd(),".impeccable","review","service-ecosystem");await mkdir(directory,{recursive:true});
  for(const scheme of ["light","dark"]as const)for(const width of [390,1440]){
    await tab.emulateMedia({colorScheme:scheme});await tab.setViewportSize({width,height:width===390?844:1000});await tab.evaluate(async()=>{await document.fonts.ready;});
    const region=tab.locator("[data-my-service]");await region.scrollIntoViewIfNeeded();expect(await tab.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await region.screenshot({path:join(directory,`my-service-${width}-${scheme}.png`)});
  }
}
it("shows ceremony and individual parts on a phone, opens exact approved Hebrew, saves progress and sends a per-part request",async()=>{
  const tab=await page("student"),region=tab.locator("[data-my-service]");
  await ui(region.getByRole("heading",{name:"Parts I lead",exact:true})).toBeVisible();await ui(region.getByText("Practice this synthetic phrase.",{exact:true}).first()).toBeVisible();
  expect(await region.getByRole("button",{name:/Listen/}).count()).toBe(0);await region.getByRole("button",{name:"Read Synthetic opening part",exact:true}).first().click();
  await ui(region.locator(".service-unit-hebrew").first()).toBeVisible();await tab.getByLabel("Progress for Synthetic opening part",{exact:true}).first().selectOption("ready");
  await ui(tab.getByLabel("Progress for Synthetic opening part",{exact:true}).first()).toHaveValue("ready");
  await region.getByText("Ask about this part",{exact:true}).first().click();await region.getByLabel("What would you like to change?",{exact:true}).first().fill("Synthetic practice question");
  await region.getByRole("button",{name:"Send request",exact:true}).first().click();await ui(region.getByText("Part requests (1 pending)",{exact:true})).toBeVisible();
  await region.getByRole("button",{name:"Read Synthetic opening part",exact:true}).first().click();await ui(region.locator(".service-unit-hebrew").first()).toBeVisible();await captures(tab);
});
it("lets staff answer a request without claiming a source edit and removes revoked resources on refresh",async()=>{
  const pending=await fixture.ownerDb.select().from(s.servicePartRequest);if(!pending.length){const [link]=await fixture.ownerDb.select().from(s.studentCeremony);await fixture.ownerDb.insert(s.servicePartRequest).values({tenantId:"crc",studentId:fixture.student.id,ceremonyId:link.ceremonyId,rowId:"synthetic-opening",message:"Synthetic practice question",sourceRevision:projection.sourceRevision,requestedResourceIdentity:resourceIdentity(projection.rows[0])});}
  const tab=await page("admin"),region=tab.locator("[data-my-service]");
  await region.getByText("Part requests (1 pending)",{exact:true}).click();await region.getByLabel("Response",{exact:true}).fill("Synthetic staff response");await region.getByRole("button",{name:"Decline with response",exact:true}).click();
  await ui(region.getByText("Part requests (0 pending)",{exact:true})).toBeVisible();
  const overlays=region.getByRole("link",{name:"Prepare or refresh overlays",exact:true});await ui(overlays).toHaveAttribute("href","https://overlays.centralreform.org/services?setlistId=synthetic-service");
  revoked=true;await region.getByRole("button",{name:"Refresh from Music",exact:true}).click();await ui(region.getByText("Your service is connected. Your tutor is reviewing the parts and resources.",{exact:true})).toBeVisible();expect(await region.getByRole("button",{name:/Score:/}).count()).toBe(0);
});
it("opens My service in selected child practice on a phone with guardian requests and no progress/private feedback controls",async()=>{
  revoked=false;const tab=await page("parent"),region=tab.locator("[data-my-service]");
  await ui(region.getByRole("heading",{name:"Parts I lead",exact:true})).toBeVisible();expect(await region.getByText("Synthetic feedback for the student.",{exact:false}).count()).toBe(0);expect(await region.getByLabel("Progress for Synthetic opening part",{exact:true}).count()).toBe(0);expect(await region.getByRole("button",{name:/Listen/}).count()).toBe(0);
  expect(await tab.locator(".service-additional-practice").getByText("No service parts have been assigned yet.",{exact:true}).isVisible()).toBe(false);await ui(tab.getByText("Additional practice",{exact:true})).toBeVisible();
  await region.getByRole("button",{name:"Read Synthetic opening part",exact:true}).first().click();await ui(region.locator(".service-unit-hebrew").first()).toBeVisible();
  await region.getByText("Ask about this part",{exact:true}).first().click();await region.getByLabel("What would you like to change?",{exact:true}).first().fill("Synthetic guardian question");await region.getByRole("button",{name:"Send request",exact:true}).first().click();await ui(region.getByText("Part requests (1 pending)",{exact:true})).toBeVisible();
  await tab.emulateMedia({colorScheme:"light"});await tab.evaluate(async()=>{await document.fonts.ready;});const directory=join(process.cwd(),".impeccable","review","service-ecosystem");await mkdir(directory,{recursive:true});await region.screenshot({path:join(directory,"my-service-guardian-390-light.png")});
});
