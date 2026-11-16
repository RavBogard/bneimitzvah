import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import * as s from "../../src/server/db/index";
import { withTenantTransaction } from "../../src/server/db/runtime";
import { postgresAccessFixture } from "./access-fixture";

// Student recordings were dropped (Daniel 2026-10-22) and their code removed; the student_recording table stays,
// so its native guards (tenant RLS, private inserts, immutability, irreversible ceremony staging) stay tested here.
type Base = Awaited<ReturnType<typeof postgresAccessFixture>>;
const opened: Base[] = [];
afterEach(async () => { for (const f of opened.splice(0)) await f.close(); });
async function sqlState(operation: PromiseLike<unknown>) {
  try { await operation; return "accepted"; } catch (error) {
    let current = error as { code?: unknown; cause?: unknown } | undefined;
    for (let i = 0; current && i < 4; i++, current = current.cause as typeof current) if (typeof current.code === "string" && /^[A-Z0-9]{5}$/.test(current.code)) return current.code;
    return "unknown";
  }
}
async function fixture() { const f = await postgresAccessFixture(); opened.push(f); return f; }
type Fixture = Awaited<ReturnType<typeof fixture>>;
// A private head inserted by the restricted runtime role, as the removed registrar did.
async function recording(f: Fixture, createdAt = new Date()) {
  const id = randomUUID();
  await withTenantTransaction(f.aDb, { tenantId: "crc" }, tx => tx.insert(s.studentRecording).values({ id, tenantId: "crc", studentId: f.student.id, assetId: randomUUID(),
    contentSha256: "a".repeat(64), mediaType: "audio/webm;codecs=opus", byteLength: 2048, durationMs: 2000, state: "private", revision: 1, createdAt }));
  return { id };
}
const submit = (f: Fixture, id: string, submittedAt: Date) => withTenantTransaction(f.aDb, { tenantId: "crc" }, tx => tx.update(s.studentRecording).set({ state: "submitted", revision: 2, submittedAt }).where(eq(s.studentRecording.id, id)));

test("native restricted SQL preserves private insertion, tenant FK/RLS, immutability and irreversible lifecycle", async () => {
  const f = await fixture(), { id } = await recording(f), [row] = await f.ownerDb.select().from(s.studentRecording);
  expect(await withTenantTransaction(f.aDb, { tenantId: "other" }, tx => tx.select().from(s.studentRecording))).toEqual([]);
  expect(await sqlState(withTenantTransaction(f.aDb, { tenantId: "other" }, tx => tx.insert(s.studentRecording).values({ ...row, id: randomUUID(), assetId: randomUUID() })))).toBe("42501");
  expect(await sqlState(withTenantTransaction(f.aDb, { tenantId: "crc" }, tx => tx.insert(s.studentRecording).values({ ...row, id: randomUUID(), assetId: randomUUID(), studentId: f.otherStudent.id })))).toBe("23503");
  expect(await sqlState(withTenantTransaction(f.aDb, { tenantId: "crc" }, tx => tx.insert(s.studentRecording).values({ ...row, id: randomUUID() })))).toBe("23505");
  for (const patch of [{ state: "submitted", revision: 2, submittedAt: new Date() }, { state: "deleting", revision: 2, deletionRequestedAt: new Date() }]) expect(await sqlState(withTenantTransaction(f.aDb, { tenantId: "crc" }, tx => tx.insert(s.studentRecording).values({ ...row, id: randomUUID(), assetId: randomUUID(), ...patch })))).toBe("23514");
  expect(await sqlState(withTenantTransaction(f.aDb, { tenantId: "crc" }, tx => tx.delete(s.studentRecording)))).toBe("42501");
  expect(await sqlState(withTenantTransaction(f.aDb, { tenantId: "crc" }, tx => tx.update(s.studentRecording).set({ contentSha256: "f".repeat(64) })))).toBe("42501");
  expect(await sqlState(withTenantTransaction(f.aDb, { tenantId: "crc" }, tx => tx.update(s.studentRecording).set({ revision: 2 })))).toBe("23514");
  await withTenantTransaction(f.aDb, { tenantId: "crc" }, tx => tx.update(s.studentRecording).set({ state: "deleting", revision: 2, deletionRequestedAt: new Date(Math.max(Date.now(), row.createdAt.getTime())) }).where(eq(s.studentRecording.id, id)));
  expect(await sqlState(withTenantTransaction(f.aDb, { tenantId: "crc" }, tx => tx.update(s.studentRecording).set({ state: "private", revision: 1, deletionRequestedAt: null })))).toBe("23514");
});

test("native old-expired ceremony postponement irreversibly deletes submitted heads atomically without inventing recording audits", async () => {
  const f = await fixture(); await f.ownerDb.update(s.student).set({ ceremonyDate: "2000-01-01" }).where(eq(s.student.id, f.student.id));
  const created = new Date("2000-01-01T12:00:00Z"), { id } = await recording(f, created); await submit(f, id, new Date(created.getTime() + 1000));
  const audits = await f.ownerDb.select().from(s.auditEvent);
  await expect(f.ownerDb.transaction(async tx => { await tx.update(s.student).set({ ceremonyDate: "2099-01-01" }).where(eq(s.student.id, f.student.id)); throw new Error("Synthetic rollback"); })).rejects.toThrow("Synthetic rollback");
  expect(await f.ownerDb.select().from(s.studentRecording)).toMatchObject([{ id, state: "submitted", revision: 2 }]);
  await f.ownerDb.update(s.student).set({ ceremonyDate: "2099-01-01" }).where(eq(s.student.id, f.student.id));
  expect(await f.ownerDb.select().from(s.studentRecording)).toMatchObject([{ id, state: "deleting", revision: 3 }]);
  await f.ownerDb.update(s.student).set({ ceremonyDate: "2100-01-01" }).where(eq(s.student.id, f.student.id));
  expect(await f.ownerDb.select().from(s.studentRecording)).toMatchObject([{ id, state: "deleting", revision: 3 }]); expect(await f.ownerDb.select().from(s.auditEvent)).toEqual(audits);
});

for (const expired of ["old", "new"] as const) test(`restricted ceremony edit with ${expired} expired date irreversibly stages private recordings with rollback and NULL submission`, async () => {
  const f = await fixture(), initial = expired === "old" ? "2000-01-01" : "2099-01-01", replacement = expired === "old" ? "2099-01-01" : "2000-01-01";
  await f.ownerDb.update(s.student).set({ ceremonyDate: initial }).where(eq(s.student.id, f.student.id));
  const { id } = await recording(f, expired === "old" ? new Date("2000-01-01T12:00:00Z") : new Date()), audits = await f.ownerDb.select().from(s.auditEvent);
  await expect(withTenantTransaction(f.aDb, { tenantId: "crc" }, async tx => { await tx.update(s.student).set({ ceremonyDate: replacement }).where(eq(s.student.id, f.student.id)); throw new Error("Synthetic private rollback"); })).rejects.toThrow("Synthetic private rollback");
  expect(await f.ownerDb.select().from(s.student).where(eq(s.student.id, f.student.id))).toMatchObject([{ ceremonyDate: initial }]);
  expect(await f.ownerDb.select().from(s.studentRecording)).toMatchObject([{ id, state: "private", revision: 1, submittedAt: null, deletionRequestedAt: null }]);
  await withTenantTransaction(f.aDb, { tenantId: "crc" }, tx => tx.update(s.student).set({ ceremonyDate: replacement }).where(eq(s.student.id, f.student.id)));
  const rows = await f.ownerDb.select().from(s.studentRecording); expect(rows).toMatchObject([{ id, state: "deleting", revision: 2, submittedAt: null, deletionRequestedAt: expect.any(Date) }]);
  await withTenantTransaction(f.aDb, { tenantId: "crc" }, tx => tx.update(s.student).set({ ceremonyDate: "2100-01-01" }).where(eq(s.student.id, f.student.id)));
  expect(await f.ownerDb.select().from(s.studentRecording)).toEqual(rows); expect(await f.ownerDb.select().from(s.auditEvent)).toEqual(audits);
});
