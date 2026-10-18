import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import * as s from "../../src/server/db/index";
import * as data from "../../src/server/data/honors";
import { honorsFixture, emptyForm, person } from "./honors-fixture";
const fixtures: Awaited<ReturnType<typeof honorsFixture>>[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const f of fixtures.splice(0)) await f.client.close(); });
async function fixture(assigned = true) { const f = await honorsFixture(assigned); fixtures.push(f); return f; }

test("guardian saves four actual aliyot/groups and admin corrects; original receipt survives later head/date/cut changes", async () => {
  const f = await fixture(), draft = { ...emptyForm(), openingArk: [person(), person(), person()], aliyot: ["Genesis 1:1", "Genesis 1:4"].map(startVerse => ({ startVerse, participants: [{ ...person(), hebrewName: null, parent1HebrewName: null, parent2HebrewName: null, relationship: null }] })) };
  const initial = await f.read(); expect(initial).toMatchObject({ currentVersion: 0, currentContext: { status: "assigned", spans: [{ startVerse: "Genesis 1:1" }, { startVerse: "Genesis 1:2" }, { startVerse: "Genesis 1:3" }, { startVerse: "Genesis 1:4" }] } });
  const write = await f.intent(draft); expect(await f.service.replace(f.req(), f.selected, write)).toMatchObject({ ok: true, committedVersion: 1, currentLatestVersion: 1, needsReview: false });
  expect(await f.service.replace(f.req("admin"), { ...f.selected, mode: "admin" }, { ...await f.intent(emptyForm(), 1) })).toMatchObject({ ok: true, committedVersion: 2 });
  await f.owner(async () => { await f.db.update(s.student).set({ ceremonyDate: "2027-02-06", serviceSlot: "havdalah" }).where(eq(s.student.id, f.selected.studentId)); await f.db.update(s.assignment).set({ revision: 2, aliyahStarts: [] }).where(eq(s.assignment.id, f.assignment!.id)); });
  expect(await f.service.receipt(f.req(), f.selected, write)).toMatchObject({ ok: true, committedVersion: 1, currentLatestVersion: 2, needsReview: true, committed: { form: draft, reviewedContext: { spans: [{ startVerse: "Genesis 1:1" }, { startVerse: "Genesis 1:2" }, { startVerse: "Genesis 1:3" }, { startVerse: "Genesis 1:4" }] } } });
  expect(await f.service.replace(f.req(), f.selected, write)).toMatchObject({ ok: true, replayed: true, committedVersion: 1 });
  expect(await f.service.replace(f.req(), f.selected, { ...write, mutationId: randomUUID(), expectedVersion: 2 })).toEqual({ ok: false, code: "stale-context" });
  expect(await f.service.receipt(f.req(), f.selected, { ...write, form: emptyForm() })).toEqual({ ok: false, code: "conflict" });
  expect(await f.service.receipt(f.req(), f.selected, { ...write, mutationId: randomUUID() })).toEqual({ ok: true, outcome: "unconfirmed" });
  expect(await f.service.replace(f.req(), f.selected, await f.intent(emptyForm(), 2))).toMatchObject({ ok: true, committedVersion: 3, needsReview: false });
  expect(await f.owner(() => f.db.select().from(s.auditEvent).where(eq(s.auditEvent.action, "honors.set")))).toHaveLength(3);
});

test("unassigned/null-cut drafts retain non-aliyah fields; [] is one actual aliyah and stale/order/invented mappings refuse", async () => {
  const f = await fixture(false), draft = { ...emptyForm(), openingArk: [person()] };
  expect(await f.read()).toMatchObject({ currentContext: { status: "unassigned" } });
  expect(await f.service.replace(f.req(), f.selected, await f.intent(draft))).toMatchObject({ ok: true, committedVersion: 1 });
  const bad = { ...draft, aliyot: [{ startVerse: "Genesis 1:1", participants: [] }] };
  expect(await f.service.replace(f.req(), f.selected, await f.intent(bad, 1))).toEqual({ ok: false, code: "invalid-request" });
  await f.owner(async () => { const [a] = await f.db.insert(s.assignment).values({ tenantId: "crc", studentId: f.selected.studentId, kind: "torah", basis: "custom", ref: "Genesis 1:1-2", status: "confirmed", setByMembershipId: f.adminMember.id }).returning(); await f.db.insert(s.assignmentVerse).values([1, 2].map(i => ({ tenantId: "crc", studentId: f.selected.studentId, assignmentId: a.id, ordinal: i, verseRef: `Genesis 1:${i}` }))); });
  expect(await f.read()).toMatchObject({ needsReview: true, currentContext: { status: "unresolved-cuts" } });
  await f.owner(async () => { await f.db.update(s.assignment).set({ aliyahStarts: [] }); });
  expect(await f.read()).toMatchObject({ currentContext: { status: "assigned", spans: [{ startVerse: "Genesis 1:1", endVerse: "Genesis 1:2" }] } });
  expect(await f.service.replace(f.req(), f.selected, await f.intent({ ...draft, aliyot: [{ startVerse: "Genesis 1:2", participants: [] }] }, 1))).toEqual({ ok: false, code: "invalid-request" });
  expect(await f.service.replace(f.req(), f.selected, await f.intent(bad, 1))).toMatchObject({ ok: true, committedVersion: 2 });
});

test("live base guardian/admin only; practice-disabled retains form; authority and attributed UUID changes cannot replay", async () => {
  const f = await fixture(), write = await f.intent();
  await f.owner(async () => { await f.db.update(s.guardian).set({ practiceEnabled: false }).where(eq(s.guardian.id, f.guardians[0].id)); });
  expect(await f.service.replace(f.req(), f.selected, write)).toMatchObject({ ok: true });
  for (const selected of [{ ...f.selected, mode: "tutor" as const }, { ...f.selected, mode: "student" as const }, { ...f.selected, studentId: f.students[2].id }]) await expect(f.service.read(f.req(selected.mode === "student" ? "learner" : "multi"), selected)).rejects.toBeDefined();
  const delegated = f.req(); delegated.headers.set("X-Practice-Context", "synthetic"); await expect(f.service.read(delegated, f.selected)).rejects.toMatchObject({ status: 403 });
  await expect(f.service.read(f.req("admin"), { ...f.selected, studentId: f.students[3].id, mode: "admin" })).rejects.toMatchObject({ status: 404 });
  await f.owner(async () => { await f.db.update(s.student).set({ studentKind: "adult", ownEmail: "synthetic-adult@example.test" }).where(eq(s.student.id, f.selected.studentId)); });
  await expect(f.service.read(f.req("learner"), { ...f.selected, mode: "student" })).rejects.toMatchObject({ status: 403 });
  await f.owner(async () => { await f.db.update(s.guardian).set({ revokedAt: new Date() }).where(eq(s.guardian.id, f.guardians[0].id)); });
  await expect(f.service.receipt(f.req(), f.selected, write)).rejects.toMatchObject({ status: 404 });
  await f.owner(async () => { await f.db.insert(s.guardian).values({ tenantId: "crc", studentId: f.selected.studentId, parentGrantId: f.parentGrant.id, linkProvenance: "synthetic replacement" }); });
  expect(await f.service.receipt(f.req(), f.selected, write)).toEqual({ ok: false, code: "conflict" });
});

test("second actual SDK guardian cannot overwrite the same base or read another actor's receipt", async () => {
  const f = await fixture();
  await f.owner(async () => { const [member] = await f.db.insert(s.membership).values({ tenantId: "crc", userId: f.identities.recipient.id }).returning();
    const [grant] = await f.db.insert(s.roleGrant).values({ tenantId: "crc", membershipId: member.id, role: "parent" }).returning(); await f.db.insert(s.guardian).values({ tenantId: "crc", studentId: f.selected.studentId, parentGrantId: grant.id, linkProvenance: "synthetic second guardian" }); });
  const secondRequest = f.request(f.path, { who: "recipient", method: "POST" }), write = await f.intent(), secondWrite = { ...write, mutationId: randomUUID(), form: { ...emptyForm(), openingArk: [person()] } };
  expect(await f.service.replace(f.req(), f.selected, write)).toMatchObject({ ok: true, committedVersion: 1 });
  expect(await f.service.replace(secondRequest, f.selected, secondWrite)).toEqual({ ok: false, code: "conflict" });
  expect(await f.service.receipt(secondRequest, f.selected, write)).toEqual({ ok: false, code: "conflict" });
  expect(await f.service.replace(secondRequest, f.selected, { ...write, expectedVersion: 1 })).toEqual({ ok: false, code: "conflict" });
  expect(await f.service.replace(f.req(), f.selected, write)).toMatchObject({ ok: true, replayed: true, committedVersion: 1 });
  expect(await f.owner(() => f.db.select().from(s.honorsVersion))).toHaveLength(1);
});

test("every live authority revocation denies the original receipt and audit failure rolls back a new version", async () => {
  const f = await fixture(), write = await f.intent(); await f.service.replace(f.req(), f.selected, write);
  const [session] = await f.owner(() => f.db.select().from(s.session).where(eq(s.session.id, f.identities.multi.sessionId)));
  await f.owner(() => f.client.exec("CREATE FUNCTION synthetic_honors_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='honors.set' THEN RAISE EXCEPTION 'Synthetic audit refusal'; END IF; RETURN NEW; END $$; CREATE TRIGGER synthetic_honors_audit_failure BEFORE INSERT ON audit_event FOR EACH ROW EXECUTE FUNCTION synthetic_honors_audit_failure()"));
  await expect(f.service.replace(f.req(), f.selected, await f.intent(emptyForm(), 1))).rejects.toBeDefined();
  expect(await f.owner(() => f.db.select().from(s.honorsVersion))).toHaveLength(1);
  expect(await f.owner(() => f.db.select().from(s.auditEvent).where(eq(s.auditEvent.action, "honors.set")))).toHaveLength(1);
  const cases: (() => Promise<() => Promise<void>>)[] = [
    async () => { await f.owner(async () => { await f.db.update(s.tenant).set({ enabled: false }).where(eq(s.tenant.id, "crc")); }); return async () => { await f.owner(async () => { await f.db.update(s.tenant).set({ enabled: true }).where(eq(s.tenant.id, "crc")); }); }; },
    async () => { await f.owner(async () => { await f.db.update(s.membership).set({ disabledAt: new Date() }).where(eq(s.membership.id, f.multiMember.id)); }); return async () => { await f.owner(async () => { await f.db.update(s.membership).set({ disabledAt: null }).where(eq(s.membership.id, f.multiMember.id)); }); }; },
    async () => { await f.owner(async () => { await f.db.update(s.student).set({ disabledAt: new Date() }).where(eq(s.student.id, f.selected.studentId)); }); return async () => { await f.owner(async () => { await f.db.update(s.student).set({ disabledAt: null }).where(eq(s.student.id, f.selected.studentId)); }); }; },
    async () => { await f.owner(async () => { await f.db.update(s.session).set({ expiresAt: new Date(0) }).where(eq(s.session.id, session.id)); }); return async () => { await f.owner(async () => { await f.db.update(s.session).set({ expiresAt: session.expiresAt }).where(eq(s.session.id, session.id)); }); }; },
    // Revocation is deliberately irreversible: finish with this case.
    async () => { await f.owner(async () => { await f.db.update(s.roleGrant).set({ revokedAt: new Date() }).where(eq(s.roleGrant.id, f.parentGrant.id)); }); return async () => {}; },
  ];
  for (const disable of cases) { const restore = await disable(); try { await expect(f.service.receipt(f.req(), f.selected, write)).rejects.toBeDefined(); } finally { await restore(); } }
});

test("context ignores unrelated student metadata but includes review/date/slot/cuts; corrupt vectors fail closed", async () => {
  const f = await fixture(), initial = await f.read();
  await f.owner(async () => { await f.db.update(s.student).set({ firstName: "Other Synthetic", revision: sql`${s.student.revision}+1` }).where(eq(s.student.id, f.selected.studentId)); });
  expect((await f.read()).currentContext.hash).toBe(initial.currentContext.hash);
  await f.owner(async () => { await f.db.update(s.assignment).set({ proposalSnapshot: { needsReview: true } }).where(eq(s.assignment.id, f.assignment!.id)); });
  expect((await f.read()).currentContext.hash).not.toBe(initial.currentContext.hash);
  await f.owner(async () => { await f.db.update(s.assignmentVerse).set({ verseRef: "Genesis 1:5" }).where(eq(s.assignmentVerse.ordinal, 4)); });
  await expect(f.read()).rejects.toMatchObject({ status: 503 });
});

test("abort/final projection/expiry after awaited append rolls back both version and audit", async () => {
  const f = await fixture(), originalAppend = data.append, originalView = data.view;
  for (const failure of ["abort", "projection", "expiry"] as const) {
    const control = new AbortController(), write = await f.intent(); let reached = false;
    if (failure === "projection") vi.spyOn(data, "view").mockImplementation(row => { const value = originalView(row); reached = true; control.abort(); return value; });
    else vi.spyOn(data, "append").mockImplementation(async (...args) => { const row = await originalAppend(...args); expect(row).not.toBeNull(); reached = true; if (failure === "abort") control.abort(); else vi.spyOn(Date, "now").mockReturnValue(Number.MAX_SAFE_INTEGER); return row; });
    await expect(f.service.replace(f.req("multi", control.signal), f.selected, write)).rejects.toBeDefined();
    expect(reached).toBe(true);
    vi.restoreAllMocks();
    expect(await f.owner(() => f.db.select().from(s.honorsVersion))).toHaveLength(0);
    expect(await f.owner(() => f.db.select().from(s.auditEvent).where(eq(s.auditEvent.action, "honors.set")))).toHaveLength(0);
  }
});
