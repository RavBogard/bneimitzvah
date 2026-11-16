import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import type { PgliteQueryResultHKT } from "drizzle-orm/pglite";
import type { AccessTransaction } from "../../src/server/access/types";
import { portalRoutesFixture } from "./portal-routes-fixture";
import { withTenantTransaction } from "../../src/server/db/runtime";
import * as s from "../../src/server/db/index";

// Student recordings were dropped (Daniel 2026-10-22) and their code removed; the student_recording table stays,
// so its native guards (RLS, private inserts, immutability, irreversible lifecycle) stay tested here.
const fixtures: Awaited<ReturnType<typeof portalRoutesFixture>>[] = [];
afterEach(async () => { for (const f of fixtures.splice(0)) await f.client.close(); });
async function sqlState(operation: PromiseLike<unknown>) {
  try { await operation; return "accepted"; } catch (error) {
    let value = error as { code?: unknown; cause?: unknown } | undefined;
    for (let depth = 0; value && depth < 4; depth++, value = value.cause as typeof value) if (typeof value.code === "string" && /^[A-Z0-9]{5}$/.test(value.code)) return value.code;
    return "unknown";
  }
}

test("recording native guards force tenant integrity, private inserts, immutable capture and consecutive irreversible deletion without runtime DELETE", async () => {
  const f = await portalRoutesFixture(); fixtures.push(f);
  const within = <T>(action: (tx: AccessTransaction<PgliteQueryResultHKT>) => Promise<T>) => withTenantTransaction(f.db, { tenantId: "crc" }, action);
  const id = randomUUID();
  await within(tx => tx.insert(s.studentRecording).values({ id, tenantId: "crc", studentId: f.students[0].id, assetId: randomUUID(), contentSha256: "a".repeat(64),
    mediaType: "audio/webm;codecs=opus", byteLength: 1024, durationMs: 1500, state: "private", revision: 1, createdAt: new Date() }));
  const [row] = await f.owner(() => f.db.select().from(s.studentRecording));
  expect(await withTenantTransaction(f.db, { tenantId: "other" }, tx => tx.select().from(s.studentRecording))).toEqual([]);
  expect(await sqlState(withTenantTransaction(f.db, { tenantId: "other" }, tx => tx.insert(s.studentRecording).values({ ...row, id: randomUUID(), assetId: randomUUID() })))).toBe("42501");
  expect(await sqlState(withTenantTransaction(f.db, { tenantId: "crc" }, tx => tx.insert(s.studentRecording).values({ ...row, id: randomUUID(), assetId: randomUUID(), studentId: f.students[3].id })))).toBe("23503");
  for (const patch of [{ state: "submitted", revision: 2, submittedAt: new Date() }, { state: "deleting", revision: 2, deletionRequestedAt: new Date() }]) expect(await sqlState(withTenantTransaction(f.db, { tenantId: "crc" }, tx => tx.insert(s.studentRecording).values({ ...row, id: randomUUID(), assetId: randomUUID(), ...patch })))).toBe("23514");
  expect(await sqlState(within(tx => tx.update(s.studentRecording).set({ assetId: randomUUID() }).where(eq(s.studentRecording.id, id))))).toBe("42501");
  expect(await sqlState(within(tx => tx.update(s.studentRecording).set({ revision: 2 })))).toBe("23514");
  expect(await sqlState(within(tx => tx.delete(s.studentRecording)))).toBe("42501");
  await within(tx => tx.update(s.studentRecording).set({ state: "submitted", revision: 2, submittedAt: new Date(Math.max(Date.now(), row.createdAt.getTime())) }));
  expect(await sqlState(within(tx => tx.update(s.studentRecording).set({ state: "deleting", revision: 3, submittedAt: new Date(row.createdAt.getTime() + 1000), deletionRequestedAt: new Date(row.createdAt.getTime() + 1000) })))).toBe("23514");
  await within(tx => tx.update(s.studentRecording).set({ state: "deleting", revision: 3, deletionRequestedAt: new Date(Date.now() + 2000) }));
  expect(await sqlState(within(tx => tx.update(s.studentRecording).set({ state: "private", revision: 1, submittedAt: null, deletionRequestedAt: null })))).toBe("23514");
  expect((await f.owner(() => f.db.execute(sql`select relrowsecurity,relforcerowsecurity from pg_class where relname='student_recording'`))).rows).toEqual([{ relrowsecurity: true, relforcerowsecurity: true }]);
});
