import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { randomUUID } from "node:crypto";
import { accessFixture } from "./access-fixture";
import { createPracticeService } from "../../src/server/practice/service";
import { createStudentRecordingRegistrar, RecordingRegistrationConflict, RecordingRegistrationLimit } from "../../src/server/recordings/registration";
import { createRecordingReceiptService, createRecordingReceiptTestMaintenance } from "../../src/server/recordings/receipts";
import { AccessDenied, AccessUnavailable } from "../../src/server/access/errors";
import type { VerifiedRecordingDescriptor } from "../../src/server/recordings/validation";
import * as data from "../../src/server/data/recordings";
import * as admission from "../../src/server/data/recording-receipts";
import * as s from "../../src/server/db/index";
const opened: Awaited<ReturnType<typeof accessFixture>>[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const f of opened.splice(0)) await f.client.close(); });
const descriptor = (): VerifiedRecordingDescriptor => ({ assetId: randomUUID(), contentSha256: "c".repeat(64), media: { mediaType: "audio/webm;codecs=opus", byteLength: 100, durationMs: 100 } });
async function fixture() {
 const f = await accessFixture(); opened.push(f);
 const deps = { access: f.service, practice: createPracticeService({ access: f.service }) }, registrar = createStudentRecordingRegistrar(deps), selected = { mode: "student" as const, studentId: f.students[0].id };
 const request = () => { const r = f.request("learner"); r.headers.set("origin", "http://localhost:3000"); return { ...r, method: "POST" }; };
 return { ...f, registrar, selected, request, receipts: createRecordingReceiptService({ ...deps, storeGeneration: "capacity-review-v1" }), exact: (id: string, value: ReturnType<typeof descriptor>) => registrar.withRegistrationAuthority(request(), selected, x => x.registerVerified(id, value)), rows: () => f.owner(() => f.db.select().from(s.studentRecording)), audits: () => f.owner(() => f.db.select().from(s.auditEvent)) };
}
test("review actual legacy/receipt overlap stays additive while retained reservation wins over exact replay", async () => {
 const f = await fixture(), head = await f.receipts.admit(f.request(), f.selected, { requestId: randomUUID(), declaredBytes: 1048578 }), value = { ...descriptor(), assetId: head.assetId };
 await f.owner(() => f.db.insert(s.studentRecording).values({ id: head.originalRecordingId, tenantId: "crc", studentId: f.selected.studentId, ...value.media, assetId: value.assetId, contentSha256: value.contentSha256, state: "private", revision: 1, createdAt: new Date() }));
 let totals!: Awaited<ReturnType<typeof admission.aggregates>>;
 await f.registrar.withRegistrationAuthority(f.request(), f.selected, async x => { totals = await admission.aggregates(x.tx, x.actor, await admission.clock(x.tx), x.fresh); });
 expect(totals).toMatchObject({ studentBytes: 1048678n, tenantBytes: 1048678n, studentTakes: 2n, tenantTakes: 2n, studentIds: 1n, tenantIds: 1n, studentMarkerBytes: 128n, tenantMarkerBytes: 128n });
 const insert = vi.spyOn(data, "insertWithId");
 await expect(f.exact(head.originalRecordingId, value)).rejects.toBeInstanceOf(RecordingRegistrationConflict);
 expect(await f.registrar.register(f.request(), f.selected, value)).toEqual({ ok: false, code: "conflict" });
 expect(insert).not.toHaveBeenCalled(); expect(await f.audits()).toEqual([]); expect(await f.rows()).toHaveLength(1);
});
test("review closed terminal reservation retains marker/identity but released audio/takes never subtract ledger charge", async () => {
 const f = await fixture(), head = await f.receipts.admit(f.request(), f.selected, { requestId: randomUUID(), declaredBytes: 46 });
 const retired = await f.receipts.retire(f.request(), f.selected, { receiptId: head.receiptId, expectedRevision: head.revision });
 await createRecordingReceiptTestMaintenance({ transaction: action => f.owner(() => f.db.transaction(action)) }).withHead({ tenantId: "crc", receiptId: head.receiptId }, x => x.closeNeverOpened(retired.revision));
 const value = descriptor(); await f.exact(randomUUID(), value);
 let totals!: Awaited<ReturnType<typeof admission.aggregates>>;
 await f.registrar.withRegistrationAuthority(f.request(), f.selected, async x => { totals = await admission.aggregates(x.tx, x.actor, await admission.clock(x.tx), x.fresh); });
 expect(totals).toMatchObject({ studentBytes: 100n, tenantBytes: 100n, studentTakes: 1n, tenantTakes: 1n, studentIds: 2n, tenantIds: 2n, studentMarkerBytes: 64n, tenantMarkerBytes: 64n, studentHour: 1n });
});
test("review false INSERT result after actual inserted row poisons caught callback work and never adopts its row", async () => {
 const f = await fixture(), original = data.insertWithId, lookup = vi.spyOn(data, "registrationRow"), insert = vi.spyOn(data, "insertWithId").mockImplementation(async (...args) => { await original(...args); return null; });
 await expect(f.registrar.withRegistrationAuthority(f.request(), f.selected, async x => { await data.audit(x.tx, x.actor, "delete-request", randomUUID()); try { await x.registerVerified(randomUUID(), descriptor()); } catch { /* A caller cannot turn a failed insertion into success. */ } })).rejects.toBeInstanceOf(RecordingRegistrationConflict);
 expect(await f.rows()).toEqual([]); expect(await f.audits()).toEqual([]); expect(lookup).toHaveBeenCalledTimes(1); expect(insert).toHaveBeenCalledTimes(1);
 expect(await f.registrar.register(f.request(), f.selected, descriptor())).toEqual({ ok: false, code: "conflict" }); expect(await f.rows()).toEqual([]); expect(await f.audits()).toEqual([]); expect(lookup).toHaveBeenCalledTimes(2); expect(insert).toHaveBeenCalledTimes(2);
});
test("review reservation rejection stops planned implicit UUID before INSERT and all private errors retain their own meaning", async () => {
 const f = await fixture(), reserve = vi.spyOn(admission, "reserved").mockResolvedValueOnce(true), insert = vi.spyOn(data, "insertWithId");
 expect(await f.registrar.register(f.request(), f.selected, descriptor())).toEqual({ ok: false, code: "conflict" }); expect(reserve).toHaveBeenCalledTimes(1); expect(reserve.mock.calls[0][2]).toMatch(/^[a-f0-9-]{36}$/); expect(insert).not.toHaveBeenCalled(); reserve.mockRestore();
 const aggregates = vi.spyOn(admission, "aggregates");
 for (const status of [401, 403, 404] as const) { aggregates.mockRejectedValueOnce(new AccessDenied(status)); await expect(f.exact(randomUUID(), descriptor())).rejects.toMatchObject({ status }); }
 aggregates.mockRejectedValueOnce(new RecordingRegistrationLimit()); await expect(f.exact(randomUUID(), descriptor())).rejects.toBeInstanceOf(AccessUnavailable);
 aggregates.mockRejectedValueOnce(new RecordingRegistrationConflict()); await expect(f.exact(randomUUID(), descriptor())).rejects.toBeInstanceOf(AccessUnavailable);
 expect(await f.rows()).toEqual([]); expect(await f.audits()).toEqual([]);
});
test("review mutex completes before callback; escaped registrar and parent dashboard never start further SQL", async () => {
 const f = await fixture(), original = admission.mutex, events: string[] = [];
 vi.spyOn(admission, "mutex").mockImplementation(async (...args) => { events.push("gate-enter"); await original(...args); events.push("gate-complete"); });
 let escape!: Parameters<Parameters<typeof f.registrar.withRegistrationAuthority>[2]>[0]["registerVerified"];
 await f.registrar.withRegistrationAuthority(f.request(), f.selected, x => { events.push("callback"); escape = x.registerVerified; });
 expect(events).toEqual(["gate-enter", "gate-complete", "callback"]); const lookups = vi.spyOn(data, "registrationRow"), gates = vi.spyOn(admission, "mutex");
 await expect(escape(randomUUID(), descriptor())).rejects.toThrow("scope unavailable"); expect(lookups).not.toHaveBeenCalled();
 const n = gates.mock.calls.length; await expect(f.registrar.withRegistrationAuthority(f.request(), { ...f.selected, mode: "parent" }, () => { throw Error("Must not run"); })).rejects.toMatchObject({ status: 403 }); expect(gates.mock.calls).toHaveLength(n); expect(await f.rows()).toEqual([]);
});
