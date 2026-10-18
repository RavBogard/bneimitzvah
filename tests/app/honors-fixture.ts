import { randomUUID } from "node:crypto";
import { portalRoutesFixture } from "./portal-routes-fixture";
import * as s from "../../src/server/db/index";
import type { HonorsForm } from "../../src/lib/honors/types";
export const emptyForm = (): HonorsForm => ({ schemaVersion: 1, openingArk: [], generationToGeneration: [], undressingTorah: [], redressingTorah: [], closingArk: [], aliyot: [], parentalBlessing: { participation: null, delivery: null } });
export const person = (englishName = "Synthetic Person") => ({ id: randomUUID(), englishName });
export async function honorsFixture(assigned = true) {
  const f = await portalRoutesFixture(), student = f.students[0];
  const assignment = assigned ? await f.owner(async () => { const [row] = await f.db.insert(s.assignment).values({ tenantId: "crc", studentId: student.id, kind: "torah", basis: "custom", status: "confirmed", ref: "Genesis 1:1-4", aliyahStarts: ["Genesis 1:2", "Genesis 1:3", "Genesis 1:4"],
    setByMembershipId: f.adminMember.id, proposalSnapshot: { confirmationDate: student.ceremonyDate, serviceSlot: "morning", slotProvenance: 1, needsReview: false } }).returning();
    await f.db.insert(s.assignmentVerse).values([1, 2, 3, 4].map(i => ({ tenantId: "crc", studentId: student.id, assignmentId: row.id, ordinal: i, verseRef: `Genesis 1:${i}` }))); return row; }) : null;
  const selected = { mode: "parent" as const, studentId: student.id }, service = f.runtime.honors, path = `/api/students/${student.id}/honors`;
  const req = (who: "admin" | "multi" | "learner" = "multi", signal?: AbortSignal) => { const original = f.request(path, { who, method: "POST" }); return { url: original.url, headers: original.headers, method: original.method, signal }; };
  const read = () => service.read(req(), selected);
  const intent = async (form = emptyForm(), expectedVersion = 0) => ({ expectedVersion, mutationId: randomUUID(), contextHash: (await read()).currentContext.hash, form });
  return { ...f, assignment, selected, service, path, req, read, intent };
}
