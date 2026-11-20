import { afterEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { eq } from "drizzle-orm";
import { accessFixture } from "./access-fixture";
import { createPronounsService, parsePronouns, parsePronounSubject } from "../../src/server/pronouns/service";
import { roleGrant, guardian } from "../../src/server/db/index";
import { handlePronounsRequest } from "../../src/server/http/pronouns";
import type { HttpRuntime } from "../../src/server/runtime/composition";

const opened: Awaited<ReturnType<typeof accessFixture>>[] = [];
afterEach(async () => { await Promise.all(opened.splice(0).map(f => f.client.close())); });
const denied = (status: number) => ({ status });

it("accepts optional plain pronouns and rejects control-bearing, overlong or forged subjects", () => {
  expect(parsePronouns(" they/them ")).toBe("they/them"); expect(parsePronouns("")).toBe("");
  for (const value of ["x".repeat(81), "she\nher", "\u202ethey", null]) expect(() => parsePronouns(value)).toThrow();
  for (const subject of [{ type: "own", membershipId: "forged" }, { type: "student", studentId: "bad", mode: "parent" }, { type: "public" }]) expect(() => parsePronounSubject(subject)).toThrow();
});

it("restricts writes to the authenticated self or explicitly linked guardian and keeps staff reads private", async () => {
  const f = await accessFixture(); opened.push(f);
  const service = createPronounsService({ access: f.service });
  const request = (who: "admin" | "multi" | "learner", write = false, extra = {}) => ({ ...f.request(who, "http://localhost:3000", write ? { origin: "http://localhost:3000", ...extra } : extra), method: write ? "POST" : "GET" });
  const student = { type: "student" as const, mode: "student" as const, studentId: f.students[0].id };
  expect(await service.write(request("learner", true), { subject: student, pronouns: "they/them", expectedRevision: 0 })).toMatchObject({ ok: true, revision: 1 });
  expect(await service.read(request("multi"), { ...student, mode: "tutor" })).toMatchObject({ pronouns: "they/them" });
  expect(await service.read(request("admin"), { ...student, mode: "admin" })).toMatchObject({ pronouns: "they/them" });
  expect(await service.write(request("multi", true), { subject: { ...student, mode: "parent" }, pronouns: "she/her", expectedRevision: 1 })).toMatchObject({ ok: true, revision: 2 });
  expect(await service.write(request("learner", true), { subject: student, pronouns: "he/him", expectedRevision: 1 })).toEqual({ ok: false, code: "changed" });
  await expect(service.write(request("multi", true), { subject: { ...student, mode: "tutor" }, pronouns: "he/him", expectedRevision: 2 })).rejects.toMatchObject(denied(403));
  for (const target of [f.students[2].id, f.students[3].id]) await expect(service.write(request("multi", true), { subject: { ...student, mode: "parent", studentId: target }, pronouns: "she/her", expectedRevision: 0 })).rejects.toMatchObject(denied(404));
  await expect(service.write(request("learner", true, { origin: "https://elsewhere.example.test" }), { subject: student, pronouns: "he/him", expectedRevision: 2 })).rejects.toMatchObject(denied(403));
  await expect(service.read(request("multi", false, { "X-Practice-Context": "synthetic" }), { ...student, mode: "tutor" })).rejects.toMatchObject(denied(403));
  await f.owner(() => f.db.update(guardian).set({ revokedAt: new Date() }).where(eq(guardian.id, f.guardians[0].id)));
  await expect(service.write(request("multi", true), { subject: { ...student, mode: "parent" }, pronouns: "he/him", expectedRevision: 2 })).rejects.toMatchObject(denied(404));
  await f.owner(() => f.db.update(roleGrant).set({ revokedAt: new Date() }).where(eq(roleGrant.id, f.tutorGrant.id)));
  await expect(service.read(request("multi"), { ...student, mode: "tutor" })).rejects.toMatchObject(denied(403));
  const response = await handlePronounsRequest(new Request("http://localhost:3000/api/profile/pronouns?type=student&mode=admin&studentId=" + student.studentId, { headers: f.request("admin").headers }), { pronouns: service } as HttpRuntime);
  expect(response?.headers.get("cache-control")).toBe("private, no-store");
});

it("keeps a standalone owner's field separate and refuses staff mutation or unrelated reading", async () => {
  const f = await accessFixture(); opened.push(f);
  const service = createPronounsService({ access: f.service }), subject = { type: "own" as const };
  const request = { ...f.request("learner", "http://localhost:3000", { origin: "http://localhost:3000" }), method: "POST" };
  expect(await service.write(request, { subject, pronouns: "she/they", expectedRevision: 0 })).toMatchObject({ ok: true });
  expect(await service.read(f.request("learner"), subject)).toMatchObject({ pronouns: "she/they" });
  expect(await service.read(f.request("admin"), subject)).toMatchObject({ pronouns: "" });
  await expect(service.write({ ...f.request("multi", "http://localhost:3000", { origin: "http://localhost:3000" }), method: "POST" }, { subject: { type: "learner", membershipId: f.learnerMember.id }, pronouns: "he/him", expectedRevision: 1 })).rejects.toMatchObject(denied(404));
});
