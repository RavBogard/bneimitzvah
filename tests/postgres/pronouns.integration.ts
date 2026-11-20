import { afterEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { eq } from "drizzle-orm";
import { postgresAccessFixture } from "./access-fixture";
import { createPronounsService } from "../../src/server/pronouns/service";
import { privatePronouns } from "../../src/server/db/index";
import { withTenantTransaction } from "../../src/server/db/runtime";

const fixtures: Awaited<ReturnType<typeof postgresAccessFixture>>[] = [];
afterEach(async () => { for (const f of fixtures.splice(0)) await f.close(); });

it("serializes competing guardian profile writes and enforces forced tenant RLS with immutable subject columns", async () => {
  const f = await postgresAccessFixture(); fixtures.push(f);
  const a = createPronounsService({ access: f.a }), b = createPronounsService({ access: f.b });
  const subject = { type: "student" as const, mode: "parent" as const, studentId: f.student.id };
  const request = { ...f.request("tutor"), method: "POST", headers: new Headers({ cookie: f.tutor.cookie, origin: "http://localhost:3000" }) };
  const results = await Promise.all([a.write(request, { subject, pronouns: "they/them", expectedRevision: 0 }), b.write(request, { subject, pronouns: "she/her", expectedRevision: 0 })]);
  expect(results.filter(row => row.ok)).toHaveLength(1); expect(results.filter(row => !row.ok)).toEqual([{ ok: false, code: "changed" }]);
  const row = (await f.ownerDb.select().from(privatePronouns).where(eq(privatePronouns.studentId, f.student.id)))[0];
  expect(row.revision).toBe(1);
  expect(await withTenantTransaction(f.aDb, { tenantId: "other" }, tx => tx.select().from(privatePronouns))).toEqual([]);
  await expect(withTenantTransaction(f.aDb, { tenantId: "other" }, tx => tx.insert(privatePronouns).values({ tenantId: "crc", studentId: f.otherStudent.id, pronouns: "they/them" }))).rejects.toThrow();
  await expect(withTenantTransaction(f.aDb, { tenantId: "crc" }, tx => tx.update(privatePronouns).set({ studentId: f.otherStudent.id }).where(eq(privatePronouns.id, row.id)))).rejects.toThrow();
  const flags = await f.owner.query("select relrowsecurity, relforcerowsecurity from pg_class where relname='private_pronouns'");
  expect(flags.rows).toEqual([{ relrowsecurity: true, relforcerowsecurity: true }]);
});
