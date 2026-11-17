import { expect, test, vi } from "vitest";
vi.mock("server-only",()=>({}));
import { studentInput } from "../../src/server/students/validation";
import { AccessDenied } from "../../src/server/access/errors";
import { parseStudents } from "../../src/components/portal/workspace/api";
import { PortalRequestError } from "../../src/components/portal/api";

const base = { firstName: "Synthetic", lastName: "Learner", ceremonyDate: "2027-01-02" };
test("contact validation uses explicit kind, keeps legacy children and requires each kind's contact", () => {
  expect(studentInput({ ...base, parentEmail: " PARENT@example.test " })).toEqual({ ...base, serviceSlot: "unknown", studentKind: "child", parentEmail: "parent@example.test", ownEmail: null });
  for (const parentEmail of [undefined, null, "", "   "]) {
    expect(studentInput({ ...base, serviceSlot: "unknown", studentKind: "adult", ownEmail: " Adult@example.test ", parentEmail })).toEqual({ ...base, serviceSlot: "unknown", studentKind: "adult", parentEmail: null, ownEmail: "adult@example.test" });
    expect(() => studentInput({ ...base, parentEmail })).toThrow(AccessDenied);
  }
  expect(studentInput({ ...base, serviceSlot: "unknown", studentKind: "adult", parentEmail: "parent@example.test", ownEmail: "adult@example.test" }).parentEmail).toBe("parent@example.test");
  for (const value of [
    { ...base, serviceSlot: "unknown", studentKind: "adult", parentEmail: "parent@example.test" },
    { ...base, serviceSlot: "unknown", studentKind: "adult", ownEmail: "   " },
    { ...base, serviceSlot: "unknown", studentKind: "adult", ownEmail: "adult@example.test", parentEmail: "not-an-address" },
    { ...base, serviceSlot: "unknown", studentKind: "adult", ownEmail: "not-an-address", parentEmail: null },
    { ...base, serviceSlot: "unknown", studentKind: "child", parentEmail: "parent@example.test", ownEmail: " PARENT@example.test " },
    ...[null, "", "learner", false].map(studentKind => ({ ...base, parentEmail: "parent@example.test", studentKind })),
  ]) expect(() => studentInput(value)).toThrow(AccessDenied);
});

test("only private admin roster DTO accepts nullable contacts and explicit kind", () => {
  const student = { id: "10000000-0000-4000-8000-000000000001", ...base, revision: 1 };
  const adult = { ...student, studentKind: "adult", serviceSlot:"unknown", parentEmail: null, ownEmail: "adult@example.test", disabledAt: null };
  expect(parseStudents({ students: [adult] }, true)).toEqual([adult]);
  expect(parseStudents({ students: [student] })).toEqual([student]);
  for (const row of [adult, { ...student, studentKind: "adult" }, { ...student, parentEmail: null }]) expect(() => parseStudents({ students: [row] })).toThrow(PortalRequestError);
  for (const row of [{ ...adult, studentKind: "child" }, { ...adult, ownEmail: null }, { ...adult, parentEmail: "" }, { ...adult, parentEmail: "not-an-address" }, { ...adult, studentKind: "other" }]) {
    expect(() => parseStudents({ students: [row] }, true)).toThrow(PortalRequestError);
  }
});
