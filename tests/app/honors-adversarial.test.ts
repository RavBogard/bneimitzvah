import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import * as s from "../../src/server/db/index";
import * as data from "../../src/server/data/honors";
import { storedView } from "../../src/server/honors/context";
import { form } from "../../src/server/honors/validation";
import { honorsFixture, emptyForm, person } from "./honors-fixture";

const opened: Awaited<ReturnType<typeof honorsFixture>>[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const f of opened.splice(0)) await f.client.close(); });
async function fixture() { const f = await honorsFixture(); opened.push(f); return f; }
async function secondGuardian(f: Awaited<ReturnType<typeof honorsFixture>>) {
  return f.owner(async () => {
    const [member] = await f.db.insert(s.membership).values({ tenantId: "crc", userId: f.identities.recipient.id }).returning();
    const [grant] = await f.db.insert(s.roleGrant).values({ tenantId: "crc", membershipId: member.id, role: "parent" }).returning();
    const [guardian] = await f.db.insert(s.guardian).values({ tenantId: "crc", studentId: f.selected.studentId, parentGrantId: grant.id, linkProvenance: "synthetic independent guardian" }).returning();
    return { member, grant, guardian };
  });
}

test("a family mutation UUID cannot be reused by another actual guardian or bypassed through SQL attribution", async () => {
  const f = await fixture(), second = await secondGuardian(f), original = await f.intent({ ...emptyForm(), openingArk: [person("Synthetic Original Intent")] });
  expect(await f.service.replace(f.req(), f.selected, original)).toMatchObject({ ok: true, committedVersion: 1 });
  const request = f.request(f.path, { who: "recipient", method: "POST" });
  const receipt = await f.service.receipt(request, f.selected, original);
  const rewritten = await f.service.replace(request, f.selected, { ...original, expectedVersion: 1, form: { ...emptyForm(), closingArk: [person("Synthetic Different Intent")] } });
  // Collect both outcomes before asserting, so the later-base duplicate cannot
  // hide behind an earlier failed receipt expectation.
  expect({ receipt, rewritten }).toEqual({ receipt: { ok: false, code: "conflict" }, rewritten: { ok: false, code: "conflict" } });
  expect(await f.owner(() => f.db.select().from(s.honorsVersion))).toHaveLength(1);
  const [row] = await f.owner(() => f.db.select().from(s.honorsVersion));
  await expect(f.owner(async () => { await f.db.insert(s.honorsVersion).values({ ...row, id: randomUUID(), version: 2, baseVersion: 1, previousVersion: 1,
    actorUserId: f.identities.recipient.id, actorMembershipId: second.member.id, roleGrantId: second.grant.id, guardianId: second.guardian.id }); })).rejects.toBeDefined();
  expect(await f.owner(() => f.db.select().from(s.auditEvent).where(eq(s.auditEvent.action, "honors.set")))).toHaveLength(1);
});

test("same-user overlapping admin authority cannot replay a parent UUID or silently issue a new version", async () => {
  const f = await fixture(), original = await f.intent();
  await f.owner(async () => { await f.db.insert(s.roleGrant).values({ tenantId: "crc", membershipId: f.multiMember.id, role: "admin" }); });
  expect(await f.service.replace(f.req(), f.selected, original)).toMatchObject({ ok: true });
  const selected = { ...f.selected, mode: "admin" as const };
  expect(await f.service.receipt(f.req(), selected, original)).toEqual({ ok: false, code: "conflict" });
  expect(await f.service.replace(f.req(), selected, { ...original, expectedVersion: 1 })).toEqual({ ok: false, code: "conflict" });
  const delegated = f.req(); delegated.headers.set("X-Practice-Context", "synthetic-even-with-admin-grant");
  await expect(f.service.read(delegated, selected)).rejects.toMatchObject({ status: 403 });
  expect(await f.owner(() => f.db.select().from(s.honorsVersion))).toHaveLength(1);
});

test("actual jsonb reordered historical context verifies canonically while a forged digest fails closed", async () => {
  const f = await fixture(), write = await f.intent();
  await f.service.replace(f.req(), f.selected, write);
  const [row] = await f.owner(() => f.db.select().from(s.honorsVersion)), current = (await f.read()).currentContext;
  expect(Object.keys(row.reviewedContext)).not.toEqual(Object.keys(current.snapshot));
  expect(storedView(row.reviewedContext, row.contextHash)).toEqual(current);
  expect(() => storedView(row.reviewedContext, "0".repeat(64))).toThrow("Honors context unavailable");
  // A structurally valid owner-created row is still untrusted on projection:
  // neither a plausible stored hash nor matching SQL JSON shape proves content.
  await f.owner(async () => { await f.db.insert(s.honorsVersion).values({ ...row, id: randomUUID(), mutationId: randomUUID(), version: 2, baseVersion: 1, previousVersion: 1, contextHash: "0".repeat(64) }); });
  await expect(f.read()).rejects.toMatchObject({ status: 503 });
});

test("receipt liveness is checked after its actual awaited lookup before any private commit projection", async () => {
  const f = await fixture(), original = await f.intent(); await f.service.replace(f.req(), f.selected, original);
  const receipt = data.receipt;
  for (const kind of ["abort", "expiry"] as const) {
    const controller = new AbortController(); let reached = false;
    vi.spyOn(data, "receipt").mockImplementation(async (...args) => {
      const row = await receipt(...args); expect(row).not.toBeNull(); reached = true;
      if (kind === "abort") controller.abort(); else vi.spyOn(Date, "now").mockReturnValue(Number.MAX_SAFE_INTEGER);
      return row;
    });
    await expect(f.service.receipt(f.req("multi", controller.signal), f.selected, original)).rejects.toBeDefined();
    expect(reached).toBe(true); vi.restoreAllMocks();
  }
  expect(await f.owner(() => f.db.select().from(s.honorsVersion))).toHaveLength(1);
  expect(await f.owner(() => f.db.select().from(s.auditEvent).where(eq(s.auditEvent.action, "honors.set")))).toHaveLength(1);
});

test("SQL canonical text defense agrees with JS trimming for Unicode edge spaces and control rejection", async () => {
  const f = await fixture();
  for (const space of ["\u00a0", "\u1680", "\u2000", "\u2028", "\u202f", "\u3000"]) {
    const raw = { ...emptyForm(), openingArk: [{ ...person(), englishName: `${space}Synthetic${space}` }] };
    expect(form(raw).openingArk[0].englishName).toBe("Synthetic");
    const result = await f.client.query<{ valid: boolean }>("select public.portal_honors_form_valid($1::jsonb) valid", [JSON.stringify(raw)]);
    expect(result.rows[0].valid, `Raw U+${space.codePointAt(0)!.toString(16)} boundary must not be canonical SQL text`).toBe(false);
  }
  for (const control of ["\u061c", "\u202e", "\u2066", "\ufeff"]) {
    const raw = { ...emptyForm(), openingArk: [{ ...person(), englishName: `Synthetic${control}` }] };
    expect(() => form(raw)).toThrow();
    expect((await f.client.query<{ valid: boolean }>("select public.portal_honors_form_valid($1::jsonb) valid", [JSON.stringify(raw)])).rows[0].valid).toBe(false);
  }
});

test("reading basis and confirmation changes independently invalidate review without inventing mappings", async () => {
  const f = await fixture(), original = await f.intent(); await f.service.replace(f.req(), f.selected, original);
  await f.owner(async () => { await f.db.update(s.assignment).set({ basis: "selection" }).where(eq(s.assignment.id, f.assignment!.id)); });
  const basis = await f.read(); expect(basis.needsReview).toBe(true); expect(basis.currentContext.hash).not.toBe(original.contextHash);
  await f.owner(async () => { await f.db.update(s.assignment).set({ proposalSnapshot: { confirmationDate: f.students[0].ceremonyDate, serviceSlot: "morning", slotProvenance: 2, needsReview: false } }).where(eq(s.assignment.id, f.assignment!.id)); });
  const facts = await f.read(); expect(facts.currentContext.hash).not.toBe(basis.currentContext.hash);
  expect(await f.service.receipt(f.req(), f.selected, original)).toMatchObject({ ok: true, committedVersion: 1, needsReview: true });
  expect(await f.service.replace(f.req(), f.selected, { ...original, mutationId: randomUUID(), expectedVersion: 1 })).toEqual({ ok: false, code: "stale-context" });
});

test("SQL payload budgets count escaped JSON and UTF-8 exactly as the canonical JS copy", async () => {
  const f = await fixture();
  for (const englishName of ["\\".repeat(256), '"'.repeat(256), "א".repeat(128)]) for (const count of [24, 32]) {
    const list = () => Array.from({ length: count }, () => person(englishName));
    const raw = { ...emptyForm(), openingArk: list(), undressingTorah: list(), redressingTorah: list(), closingArk: list() };
    const expected = Buffer.byteLength(JSON.stringify(raw), "utf8") <= 65536;
    if (expected) expect(form(raw)).toEqual(raw); else expect(() => form(raw)).toThrow();
    expect((await f.client.query<{ valid: boolean }>("select public.portal_honors_form_valid($1::jsonb) valid", [JSON.stringify(raw)])).rows[0].valid).toBe(expected);
  }
});

test("restricted runtime cannot observe or insert a CRC honors version under another tenant scope", async () => {
  const f = await fixture(); await f.service.replace(f.req(), f.selected, await f.intent());
  const [row] = await f.owner(() => f.db.select().from(s.honorsVersion));
  await f.db.transaction(async tx => {
    await tx.execute(sql`select set_config('app.tenant_id','other',true)`);
    expect(await tx.select().from(s.honorsVersion)).toHaveLength(0);
  });
  await expect(f.db.transaction(async tx => {
    await tx.execute(sql`select set_config('app.tenant_id','other',true)`);
    await tx.insert(s.honorsVersion).values({ ...row, id: randomUUID(), mutationId: randomUUID(), version: 2, baseVersion: 1, previousVersion: 1 });
  })).rejects.toBeDefined();
  expect(await f.owner(() => f.db.select().from(s.honorsVersion))).toHaveLength(1);
});
