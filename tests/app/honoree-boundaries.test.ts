import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { and, eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { honoreeFixture } from "./honoree-fixture";
import * as s from "../../src/server/db/index";
import * as data from "../../src/server/data/honoree";
import * as honorsData from "../../src/server/data/honors";
import { handleHonoreeRequest } from "../../src/server/http/honoree";
import { createHttpDispatcher } from "../../src/server/http/dispatch";
const fixtures: Awaited<ReturnType<typeof honoreeFixture>>[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const f of fixtures.splice(0)) await f.client.close(); });
async function fixture() { const f = await honoreeFixture(); fixtures.push(f); return f; }

test("fresh roster rows stay quiet until reading assignment, then counters fence issue, revocation and restoration", async () => {
  const f = await fixture(), originalId = f.selected.studentId, freshId = randomUUID();
  const counter = () => f.owner(() => f.db.select().from(s.honoreeReadingEpoch).where(eq(s.honoreeReadingEpoch.studentId, freshId)));
  await f.owner(async () => {
    const [original] = await f.db.select().from(s.student).where(eq(s.student.id, originalId));
    await f.db.insert(s.student).values({ ...original, id: freshId });
  });
  expect(await counter()).toEqual([]);
  // Even a roster correction cannot materialize a honoree counter.
  await f.owner(async () => {
    for (const serviceSlot of ["unknown", "morning"] as const)
      await f.db.update(s.student).set({ serviceSlot }).where(eq(s.student.id, freshId));
    await f.db.insert(s.guardian).values({ ...f.guardians[0], id: randomUUID(), studentId: freshId });
  });
  expect(await counter()).toEqual([]);
  f.selected.studentId = freshId;
  const unready = await f.honoreeIntent();
  await expect(f.honoree.mutate(f.req(), f.selected, unready)).rejects.toBeDefined();
  expect(await f.owner(() => f.db.select().from(s.honoreeLink))).toEqual([]);
  let assignmentId!: string;
  await f.owner(async () => {
    const [assignment] = await f.db.insert(s.assignment).values({ ...f.assignment!, id: randomUUID(), studentId: freshId }).returning();
    assignmentId = assignment.id;
  });
  expect(await counter()).toMatchObject([{ epoch: 1n }]);
  // A counter alone is insufficient: complete ordered verses and saved honors
  // still have to establish current readiness before issuing a link.
  await expect(f.honoree.mutate(f.req(), f.selected, unready)).rejects.toBeDefined();
  await f.owner(async () => {
    const verses = await f.db.select().from(s.assignmentVerse).where(eq(s.assignmentVerse.assignmentId, f.assignment!.id));
    await f.db.insert(s.assignmentVerse).values(verses.map(verse => ({ ...verse, id: randomUUID(), assignmentId, studentId: freshId })));
  });
  expect(await counter()).toMatchObject([{ epoch: 5n }]);
  await f.service.replace(f.req(), f.selected, await f.intent(f.form));
  const revoked = await f.issue();
  expect(await f.honoree.read(f.guest(), revoked.token)).toMatchObject({ ok: true });
  expect(await f.honoree.mutate(f.req(), f.selected, await f.honoreeIntent("revoke", revoked.id))).toMatchObject({ ok: true });
  await expect(f.honoree.read(f.guest(), revoked.token)).rejects.toMatchObject({ status: 404 });
  const stale = await f.issue();
  await f.owner(async () => {
    for (const serviceSlot of ["havdalah", "morning"] as const)
      await f.db.update(s.student).set({ serviceSlot }).where(eq(s.student.id, freshId));
    for (const verseRef of ["Genesis 1:5", "Genesis 1:4"])
      await f.db.update(s.assignmentVerse).set({ verseRef }).where(and(eq(s.assignmentVerse.assignmentId, assignmentId), eq(s.assignmentVerse.ordinal, 4)));
  });
  expect(await counter()).toMatchObject([{ epoch: 9n }]);
  await expect(f.honoree.read(f.guest(), stale.token)).rejects.toMatchObject({ status: 404 });
  expect(await f.honoree.mutate(f.req(), f.selected, await f.honoreeIntent("revoke", stale.id))).toMatchObject({ ok: true });
  await expect(f.honoree.read(f.guest(), revoked.token)).rejects.toMatchObject({ status: 404 });
});

test("direct slot/confirmation/cuts/verse changes away and back cannot revive a credential", async () => {
  const f = await fixture();
  for (const target of ["slot", "confirmation", "cuts", "verse"] as const) {
    const issued = await f.issue();
    await f.owner(async () => {
      if (target === "slot") for (const serviceSlot of ["havdalah", "morning"] as const) await f.db.update(s.student).set({ serviceSlot }).where(eq(s.student.id, f.selected.studentId));
      if (target === "confirmation") for (const needsReview of [true, false]) await f.db.update(s.assignment).set({ proposalSnapshot: { confirmationDate: "2027-01-02", serviceSlot: "morning", slotProvenance: 1, needsReview } }).where(eq(s.assignment.id, f.assignment!.id));
      if (target === "cuts") for (const aliyahStarts of [[], ["Genesis 1:2", "Genesis 1:3", "Genesis 1:4"]]) await f.db.update(s.assignment).set({ aliyahStarts }).where(eq(s.assignment.id, f.assignment!.id));
      if (target === "verse") for (const verseRef of ["Genesis 1:5", "Genesis 1:4"]) await f.db.update(s.assignmentVerse).set({ verseRef }).where(eq(s.assignmentVerse.ordinal, 4));
    });
    await expect(f.honoree.read(f.guest(), issued.token)).rejects.toMatchObject({ status: 404 });
    // Revoke remains possible after reading corruption/staleness; it does not
    // require re-approval of the context whose credential is being removed.
    expect(await f.honoree.mutate(f.req(), f.selected, await f.honoreeIntent("revoke", issued.id))).toMatchObject({ ok: true });
  }
});
test("group removal/re-add is permanent and SQL key/counter/link/receipt/material mutation is denied", async () => {
  const f = await fixture(), issued = await f.issue();
  await f.service.replace(f.req(), f.selected, await f.intent({ ...f.form, aliyot: [] }, 1)); await f.service.replace(f.req(), f.selected, await f.intent(f.form, 2));
  await expect(f.honoree.read(f.guest(), issued.token)).rejects.toMatchObject({ status: 404 });
  await f.client.exec("set app.tenant_id='crc'");
  for (const query of ["update honoree_group_epoch set epoch=epoch", "update honoree_reading_epoch set student_id=gen_random_uuid()", "delete from honoree_reading_epoch", "update honoree_link set expires_at=expires_at", "delete from honoree_link", "delete from honoree_operation", "update honoree_operation set request_digest=request_digest", "update honoree_material_release set approval_basis='pretend approval'"]) await expect(f.client.exec(query)).rejects.toBeDefined();
  await f.owner(async () => {
    for (const query of ["update honoree_group_epoch set epoch=epoch-1", "delete from honoree_group_epoch", "update honoree_link set expires_at=expires_at+interval '1 hour'", "delete from honoree_operation"]) await expect(f.client.exec(query)).rejects.toBeDefined();
  });
});
test("real ON CONFLICT loser and post-append abort leave no group-epoch or A audit side effects", async () => {
  const f=await fixture(), initial=await f.owner(()=>f.db.select().from(s.honoreeGroupEpoch)), [row]=await f.owner(()=>f.db.select().from(s.honorsVersion));
  const changed={...f.form,aliyot:[{...f.form.aliyot[0],participants:[{...f.form.aliyot[0].participants[0],englishName:"Synthetic competing change"}]}]};
  await f.owner(async()=>{expect(await f.db.insert(s.honorsVersion).values({...row,id:randomUUID(),mutationId:randomUUID(),form:changed}).onConflictDoNothing().returning()).toEqual([]);});
  expect(await f.owner(()=>f.db.select().from(s.honoreeGroupEpoch))).toEqual(initial);
  const original=honorsData.append;let reached=false;
  const spy=vi.spyOn(honorsData,"append").mockImplementation(async(...args)=>{const inserted=await original(...args);expect(inserted).not.toBeNull();reached=true;throw Error("Synthetic post-append failure");});
  try{await expect(f.service.replace(f.req(),f.selected,await f.intent(changed,1))).rejects.toBeDefined();}finally{spy.mockRestore();}
  expect(reached).toBe(true);expect(await f.owner(()=>f.db.select().from(s.honoreeGroupEpoch))).toEqual(initial);
  expect(await f.owner(()=>f.db.select().from(s.honorsVersion))).toHaveLength(1);expect(await f.owner(()=>f.db.select().from(s.auditEvent).where(eq(s.auditEvent.action,"honors.set")))).toHaveLength(1);
});
test("base-mode, practice, foreign tenant, unknown group and unresolved current readiness fail closed", async () => {
  const f = await fixture(), issued = await f.issue(), write = await f.honoreeIntent();
  for (const mode of ["student", "tutor"] as const) await expect(f.honoree.mutate(f.req(), { ...f.selected, mode }, write)).rejects.toBeDefined();
  const delegated = f.req(); delegated.headers.set("X-Practice-Context", "synthetic"); await expect(f.honoree.mutate(delegated, f.selected, write)).rejects.toMatchObject({ status: 403 });
  await expect(f.honoree.read({ ...f.guest(), url: "http://localhost:3101/api/honoree/read", headers: new Headers({ origin: "http://localhost:3101" }) }, issued.token)).rejects.toMatchObject({ status: 404 });
  await expect(f.honoree.mutate(f.req(), f.selected, { ...write, startVerse: "Genesis 1:99" })).rejects.toBeDefined();
  await f.owner(async () => { await f.db.update(s.assignment).set({ aliyahStarts: null }).where(eq(s.assignment.id, f.assignment!.id)); });
  await expect(f.honoree.mutate(f.req(), f.selected, { ...write, startVerse: "Genesis 1:3" })).rejects.toBeDefined();
  expect(await f.honoree.mutate(f.req(), f.selected, { ...write, operation: "revoke", linkId: issued.id })).toMatchObject({ ok: true });
});
test("abort/expiry after actual link+operation+audit insertion rolls back the entire mutation", async () => {
  const f = await fixture(), originalNow = data.now;
  for (const failure of ["abort", "session", "expiry"] as const) {
    const control = new AbortController(), write = await f.honoreeIntent(); let calls = 0, reached = false;
    const spy = vi.spyOn(data, "now").mockImplementation(async tx => {
      const instant = await originalNow(tx); if (++calls === 2) {
        expect(await tx.select().from(s.honoreeLink)).toHaveLength(1); expect(await tx.select().from(s.honoreeOperation)).toHaveLength(1);
        expect(await tx.select().from(s.auditEvent).where(eq(s.auditEvent.action, "honoree.issue"))).toHaveLength(1); reached = true;
        if (failure === "abort") control.abort(); if (failure === "session") vi.spyOn(Date, "now").mockReturnValue(Number.MAX_SAFE_INTEGER);
        if (failure === "expiry") return instant + 91 * 86400000;
      } return instant;
    });
    try { await expect(f.honoree.mutate({ ...f.req(), signal: control.signal }, f.selected, write)).rejects.toBeDefined(); } finally { spy.mockRestore(); vi.restoreAllMocks(); }
    expect(reached).toBe(true); expect(await f.owner(() => f.db.select().from(s.honoreeLink))).toHaveLength(0); expect(await f.owner(() => f.db.select().from(s.honoreeOperation))).toHaveLength(0);
    expect(await f.owner(() => f.db.select().from(s.auditEvent).where(eq(s.auditEvent.action, "honoree.issue")))).toHaveLength(0);
  }
});
test("post-read wait cancellation/expiry denies; terminal source withdrawal cannot be undone", async () => {
  const f = await fixture(), issued = await f.issue(), originalNow = data.now;
  for (const failure of ["abort", "expiry"] as const) {
    const control = new AbortController(); let reached = false;
    const spy = vi.spyOn(data, "now").mockImplementation(async tx => { reached = true; const instant = await originalNow(tx); if (failure === "abort") control.abort(); return failure === "expiry" ? instant + 91 * 86400000 : instant; });
    try { await expect(f.honoree.read(f.guest(control.signal), issued.token)).rejects.toMatchObject({ status: 404 }); } finally { spy.mockRestore(); }
    expect(reached).toBe(true);
  }
  await f.owner(async () => { await f.db.update(s.serviceCatalogLifecycle).set({ state: "withdrawn", revision: sql`${s.serviceCatalogLifecycle.revision}+1` }).where(eq(s.serviceCatalogLifecycle.catalogId, f.materialRelease!.catalogId)); });
  expect(await f.owner(() => f.db.select().from(s.honoreeMaterialRelease))).toMatchObject([{ state: "withdrawn" }]);
  await expect(f.honoree.read(f.guest(), issued.token)).rejects.toMatchObject({ status: 404 });
  await expect(f.owner(() => f.db.update(s.honoreeMaterialRelease).set({ state: "active" }))).rejects.toBeDefined();
});
test("prepared guest HTTP uses one private 404 for all denials, strict bounded POST and closed minimal success", async () => {
  const f = await fixture(), issued = await f.issue(), runtime = { origin: "http://localhost:3000", honoree: f.honoree };
  const request = (body: unknown, path = "/api/honoree/read", headers: Record<string,string> = {}) => new Request(runtime.origin + path, { method: "POST", headers: { origin: runtime.origin, "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  const success = await handleHonoreeRequest(request({ token: issued.token }), runtime); expect(success!.status).toBe(200); expect(await success!.json()).toMatchObject({ student: { firstName: "Synthetic" }, aliyah: { startVerse: "Genesis 1:1" } });
  for (const req of [request({ token: "invalid" }), request({ token: issued.token, studentId: f.selected.studentId }), request({ token: issued.token }, "/api/honoree/read?token=invalid"), request({ token: issued.token }, undefined, { cookie: "synthetic=1" }), request({ token: issued.token }, undefined, { origin: "https://foreign.example.test" }), request({ token: "x".repeat(1025) }), new Request(runtime.origin + "/api/honoree/read")]) {
    const response = await handleHonoreeRequest(req, runtime); expect(response!.status).toBe(404); expect(await response!.json()).toEqual({ error: "not-found" });
    expect(response!.headers.get("cache-control")).toBe("private, no-store"); expect(response!.headers.get("set-cookie")).toBeNull(); expect(response!.headers.get("location")).toBeNull(); expect(response!.headers.get("referrer-policy")).toBe("no-referrer");
  }
  expect(await handleHonoreeRequest(request({}, "/not-owned"), runtime)).toBeNull();
});
test("only the three exact management paths are owned; operation and trailing-slash aliases remain unavailable",async()=>{
  const scope=vi.fn(async()=>{throw Error("Unreviewed route must not construct runtime");}), dispatch=createHttpDispatcher(scope);
  for(const suffix of ["/issue","/reissue","/revoke","/receipt/","/status/","/other"]){
    const path="/api/students/00000000-0000-0000-0000-000000000000/honoree-links"+suffix;
    const response=await dispatch(new Request("http://localhost:3000"+path,{method:"POST",headers:{"content-type":"application/json"},body:'{"token":"synthetic"}'}));
    expect(response.status).toBe(404);expect(await response.json()).toEqual({error:"not-found"});
  }expect(scope).not.toHaveBeenCalled();
});
