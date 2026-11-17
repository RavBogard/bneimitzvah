import { expect, test } from "vitest";
import { parseStudents } from "../../src/components/portal/workspace/api";

// Kept from the removed CSV import's tests (Daniel, 2026-11-17): the admin roster still carries intake details stored on older rows.
test("admin roster accepts closed intake metadata without weakening ordinary student projections or legacy roster values",()=>{
  const student={id:"00000000-0000-4000-8000-000000000001",firstName:"Synthetic",lastName:"Intake",ceremonyDate:"2027-01-02",revision:1};
  const old={...student,studentKind:"child",serviceSlot:"unknown",parentEmail:"parent@example.test",ownEmail:null,disabledAt:null};
  expect(parseStudents({students:[old]},true)).toEqual([old]);
  const metadata={version:1,parent1Name:"Synthetic Parent",householdPhone:"555-0100",parent2Name:null,parashahLabel:"Synthetic",tutorName:"Synthetic Tutor",tutorMatch:{status:"matched",grantId:student.id},adminNotes:"Synthetic\nNote"};
  const rich={...old,hebrewName:"שֵׁם",secondParentEmail:"second@example.test",importMetadata:metadata};
  expect(parseStudents({students:[rich]},true)).toEqual([rich]);
  for(const invalid of [{...rich,extra:true},{...rich,hebrewName:"\u0000"},{...rich,ownEmail:"second@example.test"},{...rich,importMetadata:{...metadata,version:2}},{...rich,importMetadata:{...metadata,actorId:student.id}},{...rich,importMetadata:{...metadata,tutorMatch:{status:"unmatched",grantId:student.id}}},{...rich,importMetadata:{...metadata,adminNotes:"x".repeat(4097)}}])expect(()=>parseStudents({students:[invalid]},true)).toThrow();
  expect(parseStudents({students:[student]})).toEqual([student]);expect(()=>parseStudents({students:[rich]})).toThrow();
});
