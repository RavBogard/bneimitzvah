import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { postgresAccessFixture, deferred, waitForEntry } from "./access-fixture";
import { createHonorsService } from "../../src/server/honors/service";
import * as s from "../../src/server/db/index";
import type { HonorsForm } from "../../src/lib/honors/types";
const fixtures: Awaited<ReturnType<typeof postgresAccessFixture>>[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const f of fixtures.splice(0)) await f.close(); });
const draft = (): HonorsForm => ({ schemaVersion: 1, openingArk: [], generationToGeneration: [], undressingTorah: [], redressingTorah: [], closingArk: [], aliyot: [], parentalBlessing: { participation: null, delivery: null } });
async function fixture() {
  const f = await postgresAccessFixture(); fixtures.push(f);
  const [member] = await f.ownerDb.select().from(s.membership).where(eq(s.membership.userId, f.admin.id));
  await f.ownerDb.update(s.student).set({ serviceSlot: "morning" }).where(eq(s.student.id, f.student.id));
  const [assignment] = await f.ownerDb.insert(s.assignment).values({ tenantId: "crc", studentId: f.student.id, kind: "torah", basis: "custom", ref: "Genesis 1:1-2", status: "confirmed", aliyahStarts: [], setByMembershipId: member.id,
    proposalSnapshot: { confirmationDate: f.student.ceremonyDate, serviceSlot: "morning", slotProvenance: 1, needsReview: false } }).returning();
  await f.ownerDb.insert(s.assignmentVerse).values([1, 2].map(i => ({ tenantId: "crc", studentId: f.student.id, assignmentId: assignment.id, ordinal: i, verseRef: `Genesis 1:${i}` })));
  const second = await f.signIn("pg-second-parent"), [parentMember] = await f.ownerDb.insert(s.membership).values({ tenantId: "crc", userId: second.id }).returning(),
    [parentGrant] = await f.ownerDb.insert(s.roleGrant).values({ tenantId: "crc", membershipId: parentMember.id, role: "parent" }).returning();
  await f.ownerDb.insert(s.guardian).values({ tenantId: "crc", studentId: f.student.id, parentGrantId: parentGrant.id, linkProvenance: "synthetic second parent" });
  const a = createHonorsService({ access: f.a }), b = createHonorsService({ access: f.b }), selected = { mode: "parent" as const, studentId: f.student.id };
  const request = (cookie = f.tutor.cookie, signal?: AbortSignal) => ({ url: "http://localhost:3000/honors", method: "POST", headers: new Headers({ cookie, origin: "http://localhost:3000" }), signal });
  const intent = { expectedVersion: 0, mutationId: randomUUID(), contextHash: (await a.read(request(), selected)).currentContext.hash, form: draft() };
  return { ...f, aService: a, bService: b, second, selected, intent, honorRequest: request, assignment };
}

test("native independent guardians race at absent head; original receipt remains private and survives ceremony change", async () => {
  const f = await fixture(), enteredA = deferred(), enteredB = deferred(), release = deferred();
  const restoreA = await f.intercept("a", text => text.startsWith('insert into "honors_version"'), async proceed => { enteredA.resolve(); await release.promise; return proceed(); });
  const restoreB = await f.intercept("b", text => text.startsWith('insert into "honors_version"'), async proceed => { enteredB.resolve(); await release.promise; return proceed(); });
  const otherIntent = { ...f.intent, mutationId: randomUUID() }, pending = Promise.all([f.aService.replace(f.honorRequest(), f.selected, f.intent), f.bService.replace(f.honorRequest(f.second.cookie), f.selected, otherIntent)]);
  try {
    await waitForEntry(Promise.all([enteredA.promise, enteredB.promise]).then(() => {}), pending); release.resolve();
    const results = await pending; expect(results.filter(result => result.ok)).toHaveLength(1); expect(results.filter(result => !result.ok)).toEqual([{ ok: false, code: "conflict" }]);
    const rows = await f.ownerDb.select().from(s.honorsVersion); expect(rows).toHaveLength(1);
    expect(await f.ownerDb.select().from(s.auditEvent).where(eq(s.auditEvent.action, "honors.set"))).toHaveLength(1);
    const firstWon = rows[0].actorUserId === f.tutor.id, winner = firstWon ? f.intent : otherIntent, winnerCookie = firstWon ? f.tutor.cookie : f.second.cookie;
    await f.ownerDb.update(s.student).set({ ceremonyDate: "2027-02-06" }).where(eq(s.student.id, f.student.id));
    expect(await f.aService.receipt(f.honorRequest(winnerCookie), f.selected, winner)).toMatchObject({ outcome: "committed", committedVersion: 1, needsReview: true });
    expect(await f.aService.receipt(f.honorRequest(firstWon ? f.second.cookie : f.tutor.cookie), f.selected, winner)).toEqual({ ok: false, code: "conflict" });
    expect(await f.aDb.select().from(s.honorsVersion)).toHaveLength(0);
  } finally { release.resolve(); await pending.catch(() => {}); restoreA(); restoreB(); }
});

test("native same original UUID races replay one immutable commit and audit", async () => {
  const f = await fixture(), enteredA = deferred(), enteredB = deferred(), release = deferred();
  const restores = await Promise.all([f.intercept("a", t => t.startsWith('insert into "honors_version"'), async go => { enteredA.resolve(); await release.promise; return go(); }),
    f.intercept("b", t => t.startsWith('insert into "honors_version"'), async go => { enteredB.resolve(); await release.promise; return go(); })]);
  const pending = Promise.all([f.aService.replace(f.honorRequest(), f.selected, f.intent), f.bService.replace(f.honorRequest(), f.selected, f.intent)]);
  try { await waitForEntry(Promise.all([enteredA.promise, enteredB.promise]).then(() => {}), pending); release.resolve(); const results = await pending;
    expect(results.every(r => r.ok)).toBe(true); expect(results.filter(r => r.ok && "replayed" in r && r.replayed)).toHaveLength(1);
    expect(await f.ownerDb.select().from(s.honorsVersion)).toHaveLength(1); expect(await f.ownerDb.select().from(s.auditEvent).where(eq(s.auditEvent.action, "honors.set"))).toHaveLength(1);
  } finally { release.resolve(); await pending.catch(() => {}); for (const restore of restores) restore(); }
});

test("native unique-index waits recheck abort and expiry before returning or appending an audit", async () => {
  for (const reason of ["abort", "expiry"] as const) {
    const f = await fixture(), entered = deferred(), release = deferred(), control = new AbortController();
    const restoreA = await f.intercept("a", text => text.startsWith('insert into "audit_event"'), async proceed => { entered.resolve(); await release.promise; return proceed(); });
    const restoreB = await f.intercept("b", text => text.startsWith('insert into "honors_version"'), async proceed => { const result = await proceed(); if (reason === "abort") control.abort(); else vi.spyOn(Date, "now").mockReturnValue(Number.MAX_SAFE_INTEGER); return result; });
    const first = f.aService.replace(f.honorRequest(), f.selected, f.intent); let second: Promise<unknown> | undefined;
    try { await waitForEntry(entered.promise, first); second = f.bService.replace(f.honorRequest(f.second.cookie, control.signal), f.selected, { ...f.intent, mutationId: randomUUID() });
      const rejected = expect(second).rejects.toBeDefined(); await f.waitForLock(f.pidB, f.pidA); release.resolve(); expect(await first).toMatchObject({ ok: true }); await rejected;
      vi.restoreAllMocks(); expect(await f.ownerDb.select().from(s.honorsVersion)).toHaveLength(1); expect(await f.ownerDb.select().from(s.auditEvent).where(eq(s.auditEvent.action, "honors.set"))).toHaveLength(1);
    } finally { release.resolve(); await first.catch(() => {}); await second?.catch(() => {}); vi.restoreAllMocks(); restoreA(); restoreB(); }
  }
});

test("native audit refusal rolls back form+receipt and database enforces attribution/immutability", async () => {
  const f = await fixture();
  await f.ownerDb.execute(sql`create function synthetic_honors_native_audit_failure() returns trigger language plpgsql as $$ begin if NEW.action='honors.set' then raise exception 'Synthetic failure'; end if; return NEW; end $$; create trigger synthetic_honors_native_audit_failure before insert on audit_event for each row execute function synthetic_honors_native_audit_failure()`);
  try { await expect(f.aService.replace(f.honorRequest(), f.selected, f.intent)).rejects.toBeDefined(); expect(await f.ownerDb.select().from(s.honorsVersion)).toHaveLength(0);
    expect(await f.bService.receipt(f.honorRequest(), f.selected, f.intent)).toEqual({ ok: true, outcome: "unconfirmed" });
  } finally { await f.ownerDb.execute(sql`drop trigger synthetic_honors_native_audit_failure on audit_event; drop function synthetic_honors_native_audit_failure()`); }
  expect(await f.aService.replace(f.honorRequest(), f.selected, f.intent)).toMatchObject({ ok: true });
  const [row] = await f.ownerDb.select().from(s.honorsVersion);
  await expect(f.ownerDb.insert(s.honorsVersion).values({ ...row, id: randomUUID(), mutationId: randomUUID(), guardianId: null })).rejects.toBeDefined();
  await expect(f.ownerDb.execute(sql`update honors_version set request_digest=request_digest`)).rejects.toBeDefined();
  await expect(f.aDb.execute(sql`delete from honors_version`)).rejects.toBeDefined();
  expect(await f.ownerDb.select().from(s.auditEvent).where(and(eq(s.auditEvent.action, "honors.set"), eq(s.auditEvent.actingStudentId, f.student.id)))).toHaveLength(1);
});
