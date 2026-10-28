import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { eq } from "drizzle-orm";
import { portalRoutesFixture } from "./portal-routes-fixture";
import { handlePortalRequest, portalRouteMethods } from "../../src/server/http/portal";
import * as s from "../../src/server/db/index";

const open: Awaited<ReturnType<typeof portalRoutesFixture>>[] = [];
async function fixture() { const f = await portalRoutesFixture(); open.push(f); return f; }
afterEach(async () => { vi.useRealTimers(); await Promise.all(open.splice(0).map(f => f.client.close())); });
async function json(response: Response) { return await response.json() as Record<string, any>; }
function privateResponse(response: Response) {
  return response.headers.get("cache-control") === "private, no-store" && response.headers.get("referrer-policy") === "no-referrer" && response.headers.get("x-content-type-options") === "nosniff";
}
const contact = { firstName: "Synthetic", lastName: "Created", ceremonyDate: "2027-01-02", parentEmail: "contact@example.test" };

it("projects listening permission only after reading authorization and uses the effective child-practice mode", async () => {
  const f = await fixture(), real = f.runtime.shortReferenceAudio, hint = vi.fn(real.listeningEnabled), read = vi.fn(real.read), readPage = vi.fn(real.readPage);
  Object.assign(f.runtime, { shortReferenceAudio: { ...real, listeningEnabled: hint, read, readPage } });
  const path = `/api/students/${f.students[0].id}/reading`;
  expect((await f.call(`${path}?mode=admin`, { who: "anonymous" })).status).toBe(401); expect(hint).not.toHaveBeenCalled();
  expect((await f.call(`${path}?mode=admin`, { who: "learner" })).status).toBe(403); expect(hint).not.toHaveBeenCalled();
  const admin = await f.call(`${path}?mode=admin`, { who: "admin" }); expect(admin.status).toBe(200); expect((await json(admin)).referenceListeningEnabled).toBe(true);
  expect((await json(await f.call(`${path}?mode=student`, { who: "learner" }))).referenceListeningEnabled).toBe(false);
  await f.owner(() => f.db.insert(s.roleGrant).values({ tenantId: "crc", membershipId: f.multiMember.id, role: "admin" }));
  expect((await json(await f.call(`${path}?mode=admin`, { who: "multi" }))).referenceListeningEnabled).toBe(true);
  const entered = await json(await f.call("/api/practice/enter", { body: { studentId: f.students[0].id } }));
  const practice = await f.call(`${path}?mode=child-practice`, { handle: entered.handle }); expect(practice.status).toBe(200);
  expect(await json(practice)).toMatchObject({ mode: "child-practice", referenceListeningEnabled: false }); expect(hint).toHaveBeenLastCalledWith("child-practice");
  expect(read).not.toHaveBeenCalled(); expect(readPage).not.toHaveBeenCalled(); expect(privateResponse(practice)).toBe(true);
});

it("reading cut contracts stay closed/body-only, retain strict assigned metadata, and expose preserved review truthfully",async()=>{
 const f=await fixture(),id=f.students[0].id,path=`/api/students/${id}/reading`,call=(body:unknown,headers?:Record<string,string>)=>handlePortalRequest(f.request(`${path}/prepare`,{who:"admin",body,headers}),f.runtime);
 for(const bad of [{mode:"admin",kind:"haftarah",ranges:["Isaiah 1:1-3"],aliyahStarts:[]},{mode:"admin",ranges:["Genesis 1:1-3"],aliyahStarts:null},{mode:"admin",preparationMode:"current-assignment",expectedAssignmentRevision:1,ranges:["Genesis 1:1-3"]},{mode:"admin",ranges:["Genesis 1:1-3"],source:{snapshot:"untrusted"}}])expect((await call(bad))!.status).toBe(400);
 const prepare=(await call({mode:"admin",kind:"torah",ranges:["Genesis 1:1-3"],aliyahStarts:["Genesis 1:2"]}))!;expect(prepare.status).toBe(200);expect(privateResponse(prepare)).toBe(true);const prepared=await json(prepare);expect(prepared).toMatchObject({preparationMode:"replace",aliyahStarts:["Genesis 1:2"],preserved:null});
 expect((await handlePortalRequest(f.request(`${path}/confirm`,{who:"admin",body:{mode:"admin",binding:prepared.binding}}),f.runtime))!.status).toBe(200);
 const assigned=(await handlePortalRequest(f.request(`${path}?mode=student`,{who:"learner"}),f.runtime))!,metadata=await json(assigned);expect(metadata.readings[0].aliyahStarts).toEqual(["Genesis 1:2"]);
 const input={mode:"admin",kind:"torah",preparationMode:"current-assignment",expectedAssignmentRevision:1,aliyahStarts:[]};
 expect((await call(input,{origin:"https://foreign.example.test"}))!.status).toBe(403);
 expect((await handlePortalRequest(f.request(`${path}/prepare?aliyahStarts=Genesis1`,{who:"admin",body:input}),f.runtime))!.status).toBe(400);
 const current=(await call(input))!;expect(current.status).toBe(200);expect(privateResponse(current)).toBe(true);const review=await json(current);
 expect(review).toMatchObject({sourceStatus:"preserved",preparationMode:"current-assignment",aliyahStarts:[]});expect(review.preserved.source).toEqual(metadata.readings[0].source);expect(review).not.toHaveProperty("snapshotDigest");expect(review).not.toHaveProperty("snapshot");
});

describe("private portal HTTP adapters over actual SDK and restricted tenant services", () => {
  it("classifies owned paths, rejects unknown/methods and returns only private fixed errors", async () => {
    const f = await fixture();
    expect(await handlePortalRequest(f.request("/api/auth/unknown"), f.runtime) === null).toBe(true);
    expect(portalRouteMethods("/api/session")?.join() === "GET" && portalRouteMethods("/api/session/begin")?.join() === "POST" && portalRouteMethods("/api/admin/students")?.join() === "GET,POST").toBe(true);
    const beginGet = await f.call("/api/session/begin", { method: "GET" });
    expect(beginGet.status === 405 && beginGet.headers.get("allow") === "POST" && privateResponse(beginGet)).toBe(true);
    const unknown = await f.call("/api/students/unknown/missing"), method = await f.call("/api/session", { body: {} });
    expect(unknown.status === 404 && method.status === 405 && method.headers.get("allow") === "GET" && privateResponse(method) && privateResponse(unknown)).toBe(true);
    const bad = await f.call("/api/students?mode=parent&mode=tutor");
    expect(bad.status === 400 && (await json(bad)).error === "invalid-request").toBe(true);
    const failing = { ...f.runtime, portal: { ...f.runtime.portal, sessionSummary: async () => { throw new Error("PRIVATE_PROVIDER_SENTINEL@example.test"); } } };
    const error = await handlePortalRequest(f.request("/api/session"), failing);
    expect(error?.status === 503 && await error.text() === '{"error":"unavailable"}' && privateResponse(error)).toBe(true);
  });

  it("requires real cookies, returns uninvited empty roles, paginates and enforces four-role/two-tenant visibility", async () => {
    const f = await fixture();
    expect((await f.call("/api/session", { who: "anonymous" })).status === 401).toBe(true);
    const empty = await json(await f.call("/api/session", { who: "recipient" }));
    expect(empty.membershipAvailable === false && empty.roles.length === 0 && empty.saved === false).toBe(true);
    // Readings for everyone (plan D1): POST /api/session/begin makes the first membership once; the person then has a shelf and no role.
    const memberships = () => f.owner(() => f.db.select().from(s.membership).where(eq(s.membership.userId, f.identities.recipient.id)));
    expect((await f.call("/api/session/begin", { who: "recipient", body: { extra: true } })).status).toBe(400);
    expect((await f.call("/api/session/begin", { who: "recipient", body: {}, headers: { origin: "https://evil.example.test" } })).status).toBe(403);
    expect((await f.call("/api/session/begin", { who: "anonymous", body: {} })).status).toBe(401);
    expect(await memberships()).toHaveLength(0);
    const begun = await f.call("/api/session/begin", { who: "recipient", body: {} });
    expect(begun.status === 200 && privateResponse(begun)).toBe(true);
    expect(await json(begun)).toMatchObject({ membershipAvailable: true, roles: [], saved: true, approver: false });
    expect(await memberships()).toHaveLength(1);
    expect((await f.call("/api/session/begin", { who: "recipient", body: {} })).status).toBe(200);
    expect(await memberships()).toHaveLength(1);
    expect(await json(await f.call("/api/session", { who: "recipient" }))).toMatchObject({ membershipAvailable: true, roles: [], saved: true });
    // The home's door (Readings for everyone E3): GET only, signed in only, private, a closed shape of names, dates and counts, with no query.
    expect(portalRouteMethods("/api/session/door")?.join()).toBe("GET");
    expect((await f.call("/api/session/door", { who: "anonymous" })).status).toBe(401);
    expect((await f.call("/api/session/door", { who: "recipient", body: {} })).status).toBe(405);
    expect((await f.call("/api/session/door?mode=admin", { who: "recipient" })).status).toBe(400);
    const door = await f.call("/api/session/door", { who: "recipient" });
    expect(door.status === 200 && privateResponse(door)).toBe(true);
    expect(await json(door)).toEqual({ pinned: null, child: null, nearest: null, count: 0 });
    // A membership is not a role: nothing a role gates opens.
    for (const mode of ["student", "parent", "tutor", "admin"]) expect((await f.call(`/api/students?mode=${mode}`, { who: "recipient" })).status, mode).toBe(403);
    for (const [who, mode, expected] of [["multi", "parent", 2], ["multi", "tutor", 1], ["admin", "admin", 3], ["learner", "student", 1]] as const) {
      const response = await f.call(`/api/students?mode=${mode}`, { who }), body = await json(response);
      expect(response.status === 200 && body.students.length === expected && privateResponse(response) && !JSON.stringify(body).includes("@")).toBe(true);
    }
    const first = await json(await f.call("/api/students?mode=parent&limit=1")), second = await json(await f.call(`/api/students?mode=parent&limit=1&afterId=${first.students[0].id}`));
    expect(first.students.length === 1 && second.students.length === 1 && first.students[0].id !== second.students[0].id).toBe(true);
    expect((await f.call(`/api/students/${f.students[3].id}?mode=parent`)).status === 404).toBe(true);
    const other = await json(await f.call(`/api/students/${f.students[3].id}?mode=student`, { origin: "http://localhost:3101" }));
    expect(other.student.id === f.students[3].id && !JSON.stringify(other).includes("@")).toBe(true);
    expect((await f.call("/api/students?mode=parent&limit=0")).status === 400).toBe(true);
    expect((await f.call("/api/students?mode=parent&tenantId=other")).status === 400).toBe(true);
  });

  it("keeps contacts in explicit admin roster and validates closed create/edit/disable contracts with409 stale state", async () => {
    const f = await fixture();
    expect((await f.call("/api/admin/students")).status === 403).toBe(true);
    const roster = await json(await f.call("/api/admin/students", { who: "admin" }));
    expect(roster.students.length === 3 && typeof roster.students[0].parentEmail === "string").toBe(true);
    const unauthorized = await f.call("/api/admin/students", { body: { student: contact } });
    expect(unauthorized.status === 403).toBe(true);
    const createdResponse = await f.call("/api/admin/students", { who: "admin", body: { student: contact } }), created = await json(createdResponse);
    expect(createdResponse.status === 201 && created.revision === 1 && !JSON.stringify(created).includes("@")).toBe(true);
    expect((await f.call("/api/admin/students", { who: "admin", body: { student: { ...contact, tenantId: "other" } } })).status === 400).toBe(true);
    expect((await f.call("/api/admin/students", { who: "admin", body: { student: contact, actor: "claimed" } })).status === 400).toBe(true);
    const edit = await f.call(`/api/admin/students/${created.id}/edit`, { who: "admin", body: { expectedRevision: 1, student: { ...contact, ceremonyDate: "2027-01-09" } } });
    expect(edit.status === 200 && (await json(edit)).revision === 2).toBe(true);
    const stale = await f.call(`/api/admin/students/${created.id}/disable`, { who: "admin", body: { expectedRevision: 1 } });
    expect(stale.status === 409 && (await json(stale)).code === "stale-revision").toBe(true);
    expect((await f.call(`/api/admin/students/${created.id}/disable`, { who: "admin", body: { expectedRevision: 2 } })).status === 200).toBe(true);
    expect((await f.call(`/api/students/${created.id}?mode=admin`, { who: "admin" })).status === 404).toBe(true);
  });

  it("requires exact POST Origin before parsing any mutation or preview body", async () => {
    const f = await fixture();
    const denied = await f.call("/api/admin/students/import/preview", { who: "admin", body: { csv: "bad", allowDuplicates: false }, headers: { origin: "https://evil.example.test" } });
    expect(denied.status === 403 && (await json(denied)).error === "forbidden").toBe(true);
    const missing = f.request("/api/practice/enter", { body: { studentId: f.students[0].id } }); missing.headers.delete("origin");
    expect((await handlePortalRequest(missing, f.runtime))?.status === 403).toBe(true);
    expect((await f.call("/api/admin/students", { who: "admin", body: { student: contact }, headers: { "content-type": "text/plain" } })).status === 415).toBe(true);
    expect((await f.call("/api/admin/students", { who: "admin", body: { student: contact }, headers: { "content-length": "20000" } })).status === 413).toBe(true);
  });

  it("adult HTTP contracts accept nullable parent contact only with required own email and preserve admin-only fields", async () => {
    const f = await fixture();
    const adult = { ...contact, studentKind: "adult", parentEmail: null, ownEmail: "adult@example.test" };
    for (const who of ["multi", "learner", "recipient"] as const) expect((await f.call("/api/admin/students", { who, body: { student: adult } })).status).toBe(403);
    expect((await f.call("/api/admin/students", { who: "admin", body: { student: { ...adult, role: "admin" } } })).status).toBe(400);
    for (const student of [{ ...adult, ownEmail: null }, { ...adult, studentKind: "child" }, { ...adult, studentKind: "other" }]) {
      expect((await f.call("/api/admin/students", { who: "admin", body: { student } })).status).toBe(403);
    }
    const response = await f.call("/api/admin/students", { who: "admin", body: { student: { ...adult, parentEmail: "" } } });
    expect(response.status).toBe(201); expect(privateResponse(response)).toBe(true);
    const created = await json(response), rows = await json(await f.call("/api/admin/students", { who: "admin" }));
    expect(rows.students.find((row: { id: string }) => row.id === created.id)).toMatchObject({ studentKind: "adult", parentEmail: null, ownEmail: "adult@example.test" });
    for (const mode of ["student", "parent", "tutor"]) {
      const list = await f.call(`/api/students?mode=${mode}`, { who: mode === "student" ? "learner" : "multi" });
      const body = await list.text(); expect(body).not.toContain("parentEmail"); expect(body).not.toContain("ownEmail"); expect(body).not.toContain("studentKind");
    }
  });

  it("round-trips opaque CSV review without leaking private claims and detects a changed roster", async () => {
    const f = await fixture();
    const csv = "firstName,lastName,ceremonyDate,parentEmail,ownEmail\nSynthetic,Imported,2027-01-02,contact@example.test,";
    const preview = await json(await f.call("/api/admin/students/import/preview", { who: "admin", body: { csv, allowDuplicates: false } }));
    expect(preview.canConfirm && preview.validRows === 1 && /^v1\./.test(preview.binding) && !JSON.stringify(preview).includes("@")).toBe(true);
    const decoded = Buffer.from(preview.binding.slice(3), "base64url").toString("utf8");
    expect(!decoded.includes(f.identities.admin.id) && !decoded.includes(f.identities.admin.sessionId)).toBe(true);
    const accepted = await f.call("/api/admin/students/import/confirm", { who: "admin", body: { csv, allowDuplicates: false, binding: preview.binding } });
    expect(accepted.status === 201 && (await json(accepted)).ids.length === 1).toBe(true);
    const nextCsv = csv.replace("Imported", "Later"), next = await json(await f.call("/api/admin/students/import/preview", { who: "admin", body: { csv: nextCsv, allowDuplicates: false } }));
    await f.call("/api/admin/students", { who: "admin", body: { student: { ...contact, lastName: "Changes roster" } } });
    expect((await f.call("/api/admin/students/import/confirm", { who: "admin", body: { csv: nextCsv, allowDuplicates: false, binding: next.binding } })).status === 409).toBe(true);
  });

  it("prepares/confirms exact staff readings, rejects parents, reports stale conflicts and exposes safe assigned DTOs", async () => {
    const f = await fixture(), path = `/api/students/${f.students[0].id}/reading`;
    const empty = await json(await f.call(`${path}?mode=parent`)); expect(empty.readings.length === 0).toBe(true);
    expect((await f.call(`${path}/prepare`, { body: { mode: "parent", ranges: ["Genesis 1:31-2:2"] } })).status === 400).toBe(true);
    const prepared = await json(await f.call(`${path}/prepare`, { body: { mode: "tutor", ranges: ["Genesis 1:31-2:2"] } }));
    expect(prepared.status === "prepared" && prepared.verseCount === 3 && /^v1\./.test(prepared.binding) && !JSON.stringify(prepared).includes("@")).toBe(true);
    const accepted = await f.call(`${path}/confirm`, { body: { mode: "tutor", binding: prepared.binding } }); expect(accepted.status === 200).toBe(true);
    expect((await f.call(`${path}/confirm`, { body: { mode: "tutor", binding: prepared.binding } })).status === 409).toBe(true);
    const reading = await json(await f.call(`${path}?mode=parent`));
    expect(reading.readings.length === 1 && reading.readings[0].verses.join() === "Genesis 1:31,Genesis 2:1,Genesis 2:2" && !JSON.stringify(reading).includes("@")).toBe(true);
    await f.owner(async () => { await f.db.update(s.roleGrant).set({ revokedAt: new Date() }).where(eq(s.roleGrant.id, f.tutorGrant.id)); });
    expect((await f.call(`${path}/prepare`, { body: { mode: "tutor", ranges: ["Genesis 1:1"] } })).status === 403).toBe(true);
  });

  it("creates tab-private context responses, switches siblings and denies stale/base/staff requests carrying child authority", async () => {
    const f = await fixture();
    const enteredResponse = await f.call("/api/practice/enter", { body: { studentId: f.students[0].id } }), entered = await json(enteredResponse);
    expect(enteredResponse.status === 201 && privateResponse(enteredResponse) && typeof entered.handle === "string").toBe(true);
    const read = await json(await f.call(`/api/practice/read?mode=child-practice&studentId=${f.students[0].id}`, { handle: entered.handle }));
    expect(read.context.id === entered.context.id && !JSON.stringify(read).includes(entered.handle)).toBe(true);
    const assigned = await json(await f.call(`/api/students/${f.students[0].id}/reading?mode=child-practice`, { handle: entered.handle }));
    expect(assigned.context.id === entered.context.id && assigned.student.id === f.students[0].id && assigned.readings.length === 0).toBe(true);
    expect((await f.call(`/api/students/${f.students[0].id}/reading?mode=parent`, { handle: entered.handle })).status === 403).toBe(true);
    expect((await f.call(`/api/students/${f.students[0].id}/reading?mode=tutor`, { handle: entered.handle })).status === 403).toBe(true);
    expect((await f.call(`/api/students/${f.students[1].id}/reading?mode=child-practice`, { handle: entered.handle })).status === 404).toBe(true);
    expect((await f.call(`/api/students/${f.students[0].id}/reading/prepare`, { handle: entered.handle, body: { mode: "tutor", ranges: ["Genesis 1:1"] } })).status === 403).toBe(true);
    expect((await f.call("/api/session", { handle: "" })).status === 403).toBe(true);
    expect((await f.call(`/api/practice/read?mode=child-practice&studentId=${f.students[0].id}&handle=${entered.handle}`)).status === 400).toBe(true);
    const switched = await json(await f.call("/api/practice/switch", { handle: entered.handle, body: { studentId: f.students[1].id } }));
    expect((await f.call(`/api/practice/read?mode=child-practice&studentId=${f.students[0].id}`, { handle: entered.handle })).status === 404).toBe(true);
    expect((await f.call("/api/practice/exit", { handle: switched.handle, body: {} })).status === 200).toBe(true);
    expect((await f.call(`/api/practice/read?mode=child-practice&studentId=${f.students[1].id}`, { handle: switched.handle })).status === 404).toBe(true);
  });

  it("issues/reissues/revokes invitations without returning raw token/mail and reports failed delivery honestly", async () => {
    const f = await fixture(); f.failSend(true);
    const failedResponse = await f.call("/api/admin/invitations", { who: "admin", body: { role: "parent", email: "routes-recipient@example.test", studentId: f.students[0].id } }), failed = await json(failedResponse);
    expect(failedResponse.status === 201 && failed.delivery === "failed" && !JSON.stringify(failed).includes("@")).toBe(true);
    f.failSend(false);
    const replacement = await json(await f.call(`/api/admin/invitations/${failed.inviteId}/reissue`, { who: "admin", body: {} }));
    expect(replacement.delivery === "sent" && replacement.inviteId !== failed.inviteId).toBe(true);
    expect((await f.call(`/api/admin/invitations/${replacement.inviteId}/revoke`, { who: "admin", body: {} })).status === 200).toBe(true);
    await f.owner(async () => {
      await f.client.exec(`CREATE FUNCTION synthetic_http_receipt_failure() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN IF NEW.action in ('invite.delivery-sent','invite.delivery-failed') THEN RAISE EXCEPTION 'Synthetic receipt failure'; END IF; RETURN NEW; END $$;
        CREATE TRIGGER synthetic_http_receipt_failure BEFORE INSERT ON audit_event FOR EACH ROW EXECUTE FUNCTION synthetic_http_receipt_failure()`);
    });
    const unknownResponse = await f.call("/api/admin/invitations", { who: "admin", body: { role: "parent", email: "routes-recipient@example.test", studentId: f.students[1].id } });
    expect(unknownResponse.status === 201 && (await json(unknownResponse)).delivery === "unknown").toBe(true);
    expect((await f.call("/api/admin/invitations", { body: { role: "tutor", email: "routes-recipient@example.test" } })).status === 403).toBe(true);
    expect((await f.call("/api/admin/invitations", { who: "admin", body: { role: "admin", email: "routes-recipient@example.test" } })).status === 400).toBe(true);
  });

  it("keeps invitation tokens exclusively in encrypted pending cookies and explicitly accepts only reviewed POST", async () => {
    const f = await fixture();
    await f.call("/api/admin/invitations", { who: "admin", body: { role: "parent", email: "routes-recipient@example.test", studentId: f.students[0].id } });
    const pending = f.pending();
    const response = await f.call("/api/invitations/pending", { who: "recipient", pending: pending.cookie }), preview = await json(response);
    expect(response.status === 200 && preview.requiresConfirmation && !JSON.stringify(preview).includes(pending.token) && !JSON.stringify(preview).includes("@")).toBe(true);
    expect((await f.call(`/api/invitations/pending?token=${pending.token}`, { who: "recipient", pending: pending.cookie })).status === 400).toBe(true);
    expect((await f.call("/api/invitations/accept", { who: "recipient", pending: pending.cookie, body: { token: pending.token, reviewBinding: preview.reviewBinding } })).status === 400).toBe(true);
    expect((await f.call("/api/invitations/accept", { who: "recipient", pending: pending.cookie })).status === 405).toBe(true);
    const accepted = await f.call("/api/invitations/accept", { who: "recipient", pending: pending.cookie, body: { reviewBinding: preview.reviewBinding } });
    expect(accepted.status === 200 && accepted.headers.getSetCookie().some(value => value.includes("Max-Age=0"))).toBe(true);
    expect((await f.call(`/api/students/${f.students[0].id}?mode=parent`, { who: "recipient" })).status === 200).toBe(true);
  });

  it("preserves a valid pending cookie after review mismatch/expiry or401, but clears invalid previews/decryption", async () => {
    const f = await fixture();
    for (const student of f.students.slice(0, 2)) await f.call("/api/admin/invitations", { who: "admin", body: { role: "parent", email: "routes-recipient@example.test", studentId: student.id } });
    const a = f.pending(0), b = f.pending(1);
    const previewA = await json(await f.call("/api/invitations/pending", { who: "recipient", pending: a.cookie }));
    const mismatch = await f.call("/api/invitations/accept", { who: "recipient", pending: b.cookie, body: { reviewBinding: previewA.reviewBinding } });
    expect(mismatch.status === 404 && mismatch.headers.getSetCookie().length === 0).toBe(true);
    expect((await f.call("/api/invitations/pending", { who: "recipient", pending: b.cookie })).status === 200).toBe(true);
    const anonymous = await f.call("/api/invitations/pending", { who: "anonymous", pending: b.cookie });
    expect(anonymous.status === 401 && anonymous.headers.getSetCookie().length === 0).toBe(true);
    const invalid = await f.call("/api/invitations/pending", { who: "recipient", pending: "portal_pending_invitation=invalid" });
    expect(invalid.status === 404 && invalid.headers.getSetCookie().some(value => value.includes("Max-Age=0"))).toBe(true);
    const malformedAccept = await f.call("/api/invitations/accept", { who: "recipient", pending: "portal_pending_invitation=invalid", body: { reviewBinding: previewA.reviewBinding } });
    expect(malformedAccept.status === 404 && malformedAccept.headers.getSetCookie().some(value => value.includes("Max-Age=0"))).toBe(true);
    const failing = { ...f.runtime, invitations: { ...f.runtime.invitations, preview: async () => { throw new Error("Synthetic provider unavailable"); } } };
    const unavailable = await handlePortalRequest(f.request("/api/invitations/pending", { who: "recipient", pending: b.cookie }), failing);
    expect(unavailable?.status === 503 && unavailable.headers.getSetCookie().length === 0).toBe(true);
    vi.setSystemTime(new Date(Date.now() + 5 * 60_000 + 1));
    const expiredReview = await f.call("/api/invitations/accept", { who: "recipient", pending: a.cookie, body: { reviewBinding: previewA.reviewBinding } });
    expect(expiredReview.status === 404 && expiredReview.headers.getSetCookie().length === 0).toBe(true);
    expect((await f.call("/api/invitations/pending", { who: "recipient", pending: a.cookie })).status === 200).toBe(true);
    await f.owner(async () => { await f.db.update(s.invite).set({ revokedAt: new Date() }).where(eq(s.invite.studentId, f.students[1].id)); });
    const revoked = await f.call("/api/invitations/pending", { who: "recipient", pending: b.cookie });
    expect(revoked.status === 404 && revoked.headers.getSetCookie().some(value => value.includes("Max-Age=0"))).toBe(true);
  });
});
