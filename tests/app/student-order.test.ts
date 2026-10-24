import { expect, it } from "vitest";
import { sortStudentsByCeremony } from "../../src/components/portal/workspace/student-label";

const row = (firstName: string, lastName: string, ceremonyDate: string) => ({ firstName, lastName, ceremonyDate });

it("lists the nearest ceremony first, then by name, and keeps a missing date last", () => {
  const rows = [row("Maya", "Testfamily", "2027-03-01"), row("Eli", "Katz", "2027-04-10"), row("Zed", "Nodate", ""), row("Noa", "Katz", "2026-11-07"), row("Leah", "Katz", "2027-03-01"), row("Abe", "Nodate", "")];
  const before = [...rows];
  expect(sortStudentsByCeremony(rows).map(value => value.firstName)).toEqual(["Noa", "Leah", "Maya", "Eli", "Abe", "Zed"]);
  expect(rows).toEqual(before);
});
