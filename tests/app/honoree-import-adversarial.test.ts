import { expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { honoreeFixture } from "./honoree-fixture";
import * as s from "../../src/server/db/index";

test("independent runtime role seeds absent epoch, atomically increments conflicts, and rolls back first seed", async () => {
  const f = await honoreeFixture(), studentId = randomUUID(), rollbackStudentId = randomUUID();
  try {
    await f.owner(async () => {
      const [original] = await f.db.select().from(s.student).where(eq(s.student.id, f.selected.studentId));
      await f.db.insert(s.student).values([studentId, rollbackStudentId].map(id => ({ ...original, id })));
    });
    const epochs = (id: string) => f.owner(() => f.db.select().from(s.honoreeReadingEpoch).where(eq(s.honoreeReadingEpoch.studentId, id)));
    expect(await epochs(studentId)).toEqual([]); expect(await epochs(rollbackStudentId)).toEqual([]);
    await f.runtime.access.withStudentCapability(f.req("admin"), { mode: "admin", studentId, capability: "set-reading" }, async tx => {
      const [identity] = await tx.select({ role: sql<string>`current_user`, login: sql<string>`session_user` }).from(sql`(select 1) identity`);
      expect(identity).toEqual({ role: "portal_runtime", login: "access_login" });
      const [assignment] = await tx.insert(s.assignment).values({ ...f.assignment!, id: randomUUID(), studentId }).returning();
      const epoch = async () => (await tx.select().from(s.honoreeReadingEpoch).where(eq(s.honoreeReadingEpoch.studentId, studentId)))[0].epoch;
      expect(await epoch()).toBe(1n);
      await tx.update(s.assignment).set({ ref: "Genesis 1:1-5" }).where(eq(s.assignment.id, assignment.id));
      expect(await epoch()).toBe(2n);
      const [verse] = await tx.insert(s.assignmentVerse).values({ tenantId: "crc", studentId, assignmentId: assignment.id, ordinal: 1, verseRef: "Genesis 1:1" }).returning();
      expect(await epoch()).toBe(3n);
      await tx.update(s.assignmentVerse).set({ verseRef: "Genesis 1:2" }).where(eq(s.assignmentVerse.id, verse.id));
      expect(await epoch()).toBe(4n);
    });
    expect(await epochs(studentId)).toMatchObject([{ epoch: 4n }]);
    await expect(f.runtime.access.withStudentCapability(f.req("admin"), { mode: "admin", studentId: rollbackStudentId, capability: "set-reading" }, async tx => {
      await tx.insert(s.assignment).values({ ...f.assignment!, id: randomUUID(), studentId: rollbackStudentId });
      throw Error("Synthetic abort after first counter seed");
    })).rejects.toBeDefined();
    expect(await epochs(rollbackStudentId)).toEqual([]);
    expect(await f.owner(() => f.db.select().from(s.assignment).where(eq(s.assignment.studentId, rollbackStudentId)))).toEqual([]);
  } finally { await f.client.close(); }
});
