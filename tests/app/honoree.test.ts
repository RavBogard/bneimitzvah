import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { eq, sql } from "drizzle-orm";
import { createHonoreeTokens, hardExpiry } from "../../src/server/honoree/tokens";
import { material } from "../../src/server/honoree/recipient-material";
import * as s from "../../src/server/db/index";
import { honoreeFixture, syntheticMaterial } from "./honoree-fixture";
const fixtures: Awaited<ReturnType<typeof honoreeFixture>>[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const f of fixtures.splice(0)) await f.client.close(); });
async function fixture(approved = true) { const f = await honoreeFixture(approved); fixtures.push(f); return f; }

test("canonical token is opaque, random, scoped to stable project/tenant/environment/origin/key and hash-only", () => {
  const scope = { secret: "synthetic-private-key-32-characters-minimum", origin: "http://localhost:3000", environment: "test", project: "crc-bneimitzvah", tenantId: "crc" }, a = createHonoreeTokens(scope), issued = a.issue();
  expect(issued.token.length).toBeLessThanOrEqual(128); expect(a.verify(issued.token)).toEqual({ id: issued.id, hash: issued.hash, keyId: "k1" }); expect(a.issue().token).not.toBe(issued.token);
  for (const token of [issued.token + "=", issued.token + "x", issued.token.replace("hl1", "hl2"), issued.token.replace("k1", "k2"), issued.token.slice(0, -1) + (issued.token.endsWith("A") ? "B" : "A"), { token: issued.token }]) expect(() => a.verify(token)).toThrow("Honoree unavailable");
  for (const change of [{ tenantId: "other" }, { origin: "http://localhost:3101" }, { project: "other-project" }, { environment: "preview" }, { secret: "different-synthetic-key-32-characters" }]) expect(() => createHonoreeTokens({ ...scope, ...change }).verify(issued.token)).toThrow();
});
test("exclusive Chicago date+7 midnight and 90x24h ceiling cross DST without browser timezone", () => {
  expect(new Date(hardExpiry(Date.parse("2026-02-01T00:00:00Z"), "2026-03-01")).toISOString()).toBe("2026-03-08T06:00:00.000Z");
  expect(new Date(hardExpiry(Date.parse("2026-02-01T00:00:00Z"), "2026-03-02")).toISOString()).toBe("2026-03-09T05:00:00.000Z");
  expect(new Date(hardExpiry(Date.parse("2026-10-01T00:00:00Z"), "2026-10-26")).toISOString()).toBe("2026-11-02T06:00:00.000Z");
  const issued = Date.parse("2026-01-01T12:00:00Z"); expect(hardExpiry(issued, "2027-01-01")).toBe(issued + 90 * 86400000);
  for (const date of ["2026-02-30", "2026-1-1", "2020-01-01"]) expect(() => hardExpiry(issued, date)).toThrow();
});
test("closed bounded reviewed projection rejects leaked metadata, wrong digest and oversized material", () => {
  expect(material(syntheticMaterial)).toEqual(syntheticMaterial);
  for (const value of [{ ...syntheticMaterial, audio: "private" }, { ...syntheticMaterial, before: [{ ...syntheticMaterial.before[0], tr: "excluded" }] }, { ...syntheticMaterial, credits: [] }, { ...syntheticMaterial, after: [{ he: "x".repeat(8193), en: "synthetic" }] }]) expect(() => material(value)).toThrow();
  expect(() => material(syntheticMaterial, "0".repeat(64))).toThrow();
});
test("synthetic own-span read is minimal; runtime projector absent or approval absent always denies", async () => {
  const f = await fixture(), issued = await f.issue(), result = await f.honoree.read(f.guest(), issued.token);
  expect(result).toEqual({ ok: true, schemaVersion: 1, student: { firstName: "Synthetic", ceremonyDate: "2027-01-02" }, aliyah: { startVerse: "Genesis 1:1", endVerse: "Genesis 1:1" }, material: syntheticMaterial, expiresAt: issued.result.expiresAt });
  const rows = await f.owner(() => f.db.select().from(s.honoreeLink)); expect(rows).toHaveLength(1); expect(JSON.stringify(rows, (_, v) => typeof v === "bigint" ? v.toString() : v)).not.toContain(issued.token);
  await expect(f.noProjector.read(f.guest(), issued.token)).rejects.toMatchObject({ status: 404 });
  await expect(f.noProjector.mutate(f.req(), f.selected, await f.honoreeIntent("issue", null, "Genesis 1:3"))).rejects.toBeDefined();
  const absent = await fixture(false); await expect(absent.issue()).rejects.toBeDefined();
});
test("global original UUID receipt never remints, and explicit reissue atomically revokes old credential", async () => {
  const f = await fixture(), original = await f.issue();
  expect(await f.honoree.mutate(f.req(), f.selected, original.write)).toEqual({ ok: true, outcome: "committed", replayed: true, operation: "issue", linkId: original.id, startVerse: "Genesis 1:1" });
  expect(await f.honoree.receipt(f.req(), f.selected, original.write)).toEqual({ ok: true, outcome: "committed", replayed: true, operation: "issue", linkId: original.id, startVerse: "Genesis 1:1" });
  expect(await f.honoree.status(f.req(), f.selected, "Genesis 1:1")).toMatchObject({ ok: true, currentLink: { id: original.id, startVerse: "Genesis 1:1" } });
  expect(await f.honoree.mutate(f.req("admin"), { ...f.selected, mode: "admin" }, original.write)).toEqual({ ok: false, code: "conflict" });
  const reissued = await f.honoree.mutate(f.req(), f.selected, await f.honoreeIntent("reissue", original.id)); expect(reissued).toMatchObject({ ok: true, replayed: false, operation: "reissue" });
  await expect(f.honoree.read(f.guest(), original.token)).rejects.toMatchObject({ status: 404 });
  const next = new URLSearchParams(new URL((reissued as {url:string}).url).hash.slice(1)).get("token")!; expect(await f.honoree.read(f.guest(), next)).toMatchObject({ ok: true });
  expect(await f.owner(() => f.db.select().from(s.honoreeLink))).toHaveLength(2);
});
test("committed date change away/back permanently invalidates; rollback and unrelated ark save preserve", async () => {
  const f = await fixture(), original = await f.issue();
  await expect(f.owner(() => f.db.transaction(async tx => { await tx.update(s.student).set({ ceremonyDate: "2027-02-06" }).where(eq(s.student.id, f.selected.studentId)); throw new Error("synthetic rollback"); }))).rejects.toThrow();
  expect(await f.honoree.read(f.guest(), original.token)).toMatchObject({ ok: true });
  const form = { ...f.form, closingArk: [{ id: crypto.randomUUID(), englishName: "Synthetic unrelated" }] }; await f.service.replace(f.req(), f.selected, await f.intent(form, 1));
  expect(await f.honoree.read(f.guest(), original.token)).toMatchObject({ ok: true });
  await f.owner(async () => { for (const ceremonyDate of ["2027-02-06", "2027-01-02"]) await f.db.update(s.student).set({ ceremonyDate }).where(eq(s.student.id, f.selected.studentId)); });
  await expect(f.honoree.read(f.guest(), original.token)).rejects.toMatchObject({ status: 404 });
});
test("group change-away/back invalidates only changed group; losing CAS never bumps epochs", async () => {
  const f = await fixture(), a = await f.issue(), b = await f.issue("Genesis 1:3"), initial = await f.owner(() => f.db.select().from(s.honoreeGroupEpoch));
  const changed = { ...f.form, aliyot: f.form.aliyot.map((g, i) => i ? g : { ...g, participants: g.participants.map(p => ({ ...p, englishName: "Synthetic changed" })) }) };
  await f.service.replace(f.req(), f.selected, await f.intent(changed, 1)); await f.service.replace(f.req(), f.selected, await f.intent(f.form, 2));
  const after = await f.owner(() => f.db.select().from(s.honoreeGroupEpoch)); expect(after.find(r=>r.startVerse==="Genesis 1:1")!.epoch).toBe(initial.find(r=>r.startVerse==="Genesis 1:1")!.epoch+2n);
  expect(after.find(r=>r.startVerse==="Genesis 1:3")!.epoch).toBe(initial.find(r=>r.startVerse==="Genesis 1:3")!.epoch);
  await expect(f.honoree.read(f.guest(), a.token)).rejects.toMatchObject({ status: 404 }); expect(await f.honoree.read(f.guest(), b.token)).toMatchObject({ ok: true });
  expect(await f.service.replace(f.req(), f.selected, await f.intent(changed, 1))).toEqual({ ok: false, code: "conflict" });
  expect(await f.owner(() => f.db.select().from(s.honoreeGroupEpoch))).toEqual(after);
});
test("guest relies on live original authority but not issuing session expiry; runtime cannot reset epochs or approve material", async () => {
  const f = await fixture(), original = await f.issue();
  await f.owner(async () => { await f.db.update(s.session).set({ expiresAt: new Date(0) }).where(eq(s.session.id, f.identities.multi.sessionId)); });
  expect(await f.honoree.read(f.guest(), original.token)).toMatchObject({ ok: true });
  await expect(f.client.exec("set app.tenant_id='crc'; update honoree_reading_epoch set epoch=0")).rejects.toBeDefined();
  await expect(f.client.exec("delete from honoree_group_epoch")).rejects.toBeDefined();
  await expect(f.client.exec("update honoree_material_release set state='withdrawn'")).rejects.toBeDefined();
  await f.owner(async () => { await f.db.update(s.roleGrant).set({ revokedAt: new Date(), revision: sql`${s.roleGrant.revision}+1` }).where(eq(s.roleGrant.id, f.parentGrant.id)); });
  await expect(f.honoree.read(f.guest(), original.token)).rejects.toMatchObject({ status: 404 });
});
