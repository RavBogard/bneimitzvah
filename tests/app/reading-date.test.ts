import { expect, test, vi } from "vitest";
vi.mock("server-only",()=>({}));
import { readingDate } from "../../src/lib/readings/reading-date";
import { studentInput, parseStudentCsv } from "../../src/server/students/validation";

test("Saturday date-only derivation crosses months, years and DST without choosing another week",()=>{
 for(const [date,next] of [["2026-10-17","2026-10-24"],["2026-12-26","2027-01-02"],["2028-02-26","2028-03-04"],["2026-03-07","2026-03-14"],["2026-10-31","2026-11-07"]]){
  expect(readingDate(date,"morning")).toEqual({readingDate:date,manualFallback:null});
  expect(readingDate(date,"havdalah")).toEqual({readingDate:next,manualFallback:null});
 }
 for(const date of ["2026-10-16","2026-10-18"])for(const slot of ["morning","havdalah"])expect(readingDate(date,slot)).toEqual({readingDate:null,manualFallback:"non-saturday"});
 expect(readingDate("2026-10-17","unknown")).toEqual({readingDate:null,manualFallback:"unknown-slot"});
 for(const slot of [null,"Friday",undefined])expect(()=>readingDate("2026-10-17",slot)).toThrow();
 expect(()=>readingDate("2026-02-30","morning")).toThrow();
 expect(readingDate("9999-12-25","havdalah")).toEqual({readingDate:null,manualFallback:"calendar-date-out-of-range"});
});
test("student slot is explicit, closed and unknown for both supported CSV formats",()=>{
 const base={firstName:"Synthetic",lastName:"Student",ceremonyDate:"2027-01-02",parentEmail:"parent@example.test"};
 expect(studentInput(base).serviceSlot).toBe("unknown");
 for(const serviceSlot of ["morning","havdalah","unknown"] as const)expect(studentInput({...base,serviceSlot}).serviceSlot).toBe(serviceSlot);
 for(const serviceSlot of [null,"",false,"afternoon"])expect(()=>studentInput({...base,serviceSlot})).toThrow();
 for(const csv of ["firstName,lastName,ceremonyDate,parentEmail,ownEmail\nSynthetic,Child,2027-01-02,parent@example.test,","studentKind,firstName,lastName,ceremonyDate,parentEmail,ownEmail\nadult,Synthetic,Adult,2027-01-02,,adult@example.test"]){
  expect(parseStudentCsv(csv).rows[0].serviceSlot).toBe("unknown");
 }
});
