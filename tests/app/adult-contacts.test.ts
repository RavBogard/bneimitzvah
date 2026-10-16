import { expect, test, vi } from "vitest";
vi.mock("server-only",()=>({}));
import { studentInput, parseStudentCsv } from "../../src/server/students/validation";
import { AccessDenied } from "../../src/server/access/errors";
import { parseStudents } from "../../src/components/portal/workspace/api";
import { PortalRequestError } from "../../src/components/portal/api";
import { CSV_HEADER, CSV_ADULT_HEADER } from "../../src/components/portal/workspace/csv-import/api";

const base = { firstName: "Synthetic", lastName: "Learner", ceremonyDate: "2027-01-02" };
test("contact validation uses explicit kind, keeps legacy children and requires each kind's contact", () => {
  expect(studentInput({ ...base, parentEmail: " PARENT@example.test " })).toEqual({ ...base, studentKind: "child", parentEmail: "parent@example.test", ownEmail: null });
  for (const parentEmail of [undefined, null, "", "   "]) {
    expect(studentInput({ ...base, studentKind: "adult", ownEmail: " Adult@example.test ", parentEmail })).toEqual({ ...base, studentKind: "adult", parentEmail: null, ownEmail: "adult@example.test" });
    expect(() => studentInput({ ...base, parentEmail })).toThrow(AccessDenied);
  }
  expect(studentInput({ ...base, studentKind: "adult", parentEmail: "parent@example.test", ownEmail: "adult@example.test" }).parentEmail).toBe("parent@example.test");
  for (const value of [
    { ...base, studentKind: "adult", parentEmail: "parent@example.test" },
    { ...base, studentKind: "adult", ownEmail: "   " },
    { ...base, studentKind: "adult", ownEmail: "adult@example.test", parentEmail: "not-an-address" },
    { ...base, studentKind: "adult", ownEmail: "not-an-address", parentEmail: null },
    { ...base, studentKind: "child", parentEmail: "parent@example.test", ownEmail: " PARENT@example.test " },
    ...[null, "", "learner", false].map(studentKind => ({ ...base, parentEmail: "parent@example.test", studentKind })),
  ]) expect(() => studentInput(value)).toThrow(AccessDenied);
});

test("CSV has two exact known formats; legacy rows cannot infer adult kind from contacts", () => {
  expect(parseStudentCsv(CSV_HEADER + "\nSynthetic,Legacy,2027-01-02,parent@example.test,").rows[0].studentKind).toBe("child");
  const extended = parseStudentCsv(CSV_ADULT_HEADER + "\nadult,Synthetic,Adult,2027-01-02,,adult@example.test\nchild,Synthetic,Child,2027-01-02,parent@example.test,");
  expect(extended.issues).toEqual([]); expect(extended.rows.map(row => [row.studentKind, row.parentEmail])).toEqual([["adult", null], ["child", "parent@example.test"]]);
  for (const csv of [CSV_HEADER + "\nSynthetic,Legacy,2027-01-02,,adult@example.test",
    CSV_ADULT_HEADER + "\nadult,Synthetic,Adult,2027-01-02,parent@example.test,",
    CSV_ADULT_HEADER + "\n,Synthetic,Adult,2027-01-02,,adult@example.test",
    CSV_ADULT_HEADER + "\nchild,Synthetic,Child,2027-01-02,,child@example.test"]) {
    expect(parseStudentCsv(csv).issues).toEqual([{ row: 2, code: "invalid-row" }]);
  }
  for (const header of [CSV_ADULT_HEADER + ",extra", CSV_ADULT_HEADER.replace("studentKind", "kind"), CSV_ADULT_HEADER.replace("studentKind,firstName", "firstName,studentKind")]) {
    expect(() => parseStudentCsv(header + "\nadult,Synthetic,Adult,2027-01-02,,adult@example.test")).toThrow(AccessDenied);
  }
});

test("only private admin roster DTO accepts nullable contacts and explicit kind", () => {
  const student = { id: "10000000-0000-4000-8000-000000000001", ...base, revision: 1 };
  const adult = { ...student, studentKind: "adult", parentEmail: null, ownEmail: "adult@example.test", disabledAt: null };
  expect(parseStudents({ students: [adult] }, true)).toEqual([adult]);
  expect(parseStudents({ students: [student] })).toEqual([student]);
  for (const row of [adult, { ...student, studentKind: "adult" }, { ...student, parentEmail: null }]) expect(() => parseStudents({ students: [row] })).toThrow(PortalRequestError);
  for (const row of [{ ...adult, studentKind: "child" }, { ...adult, ownEmail: null }, { ...adult, parentEmail: "" }, { ...adult, parentEmail: "not-an-address" }, { ...adult, studentKind: "other" }]) {
    expect(() => parseStudents({ students: [row] }, true)).toThrow(PortalRequestError);
  }
});
