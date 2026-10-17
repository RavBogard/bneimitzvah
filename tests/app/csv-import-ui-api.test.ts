import { afterEach, expect, test, vi } from "vitest";
import { checkCsvSize, CSV_HEADER, CSV_FULL_HEADER, CSV_FULL_ADULT_HEADER, csvApi, parsePreview } from "../../src/components/portal/workspace/csv-import/api";
import { parseStudents } from "../../src/components/portal/workspace/api";
const csv = `${CSV_HEADER}\nSynthetic,Import,2027-01-02,parent@example.test,`;
const preview = { validRows: 1, issues: [], duplicateRows: [], requiresDuplicateConfirmation: false, canConfirm: true, binding: "v1.synthetic" };
afterEach(() => vi.unstubAllGlobals());
test("preview accepts row diagnostics and duplicate decisions only when confirmation and binding agree", () => {
  expect(parsePreview(preview, false)).toEqual(preview);
  const duplicate = { ...preview, duplicateRows: [2], requiresDuplicateConfirmation: true, canConfirm: false, binding: null };
  expect(parsePreview(duplicate, false).canConfirm).toBe(false);
  expect(() => parsePreview(duplicate, true)).toThrow();
  expect(parsePreview({ ...duplicate, canConfirm: true, binding: preview.binding }, true).canConfirm).toBe(true);
  for (const row of [{ ...preview, binding: null }, { ...preview, canConfirm: false }, { ...preview, validRows: 0 }, { ...preview, duplicateRows: [501, 501] }, { ...preview, issues: [{ row: 1, code: "invalid-row" }] }, { ...preview, rows: [csv] }]) expect(() => parsePreview(row, false)).toThrow();
});

test("rich preview accepts only closed bounded row outcomes and never contact or tutor identity fields",()=>{
  expect(CSV_FULL_HEADER.split(",")).toHaveLength(14);expect(CSV_FULL_ADULT_HEADER).toBe("studentKind,"+CSV_FULL_HEADER);
  const rich={...preview,validRows:3,tutorMatches:[{row:2,status:"matched"},{row:3,status:"unmatched"},{row:4,status:"ambiguous"}],missingSecondParentRows:[3,4],tutorAssignmentsPending:true};
  expect(parsePreview(rich,false)).toEqual(rich);
  for(const invalid of [{...rich,tutorAssignmentsPending:false},{...rich,tutorMatches:[{row:2,status:"assigned"}]},{...rich,tutorMatches:[{row:2,status:"matched",grantId:"00000000-0000-4000-8000-000000000001"}]},{...rich,tutorMatches:[{row:5,status:"matched"}]},{...rich,missingSecondParentRows:[3,3]},{...rich,missingSecondParentRows:[1]},{...rich,notes:"Synthetic"},{...preview,tutorMatches:[]}])expect(()=>parsePreview(invalid,false)).toThrow();
  const invalidRow={...rich,validRows:2,issues:[{row:3,code:"invalid-row"}],canConfirm:false,binding:null,tutorMatches:[{row:3,status:"matched"}]};
  expect(()=>parsePreview(invalidRow,false)).toThrow();
});

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
test("UTF-8 and encoded-envelope limits are separate and no local parser invents extra CSV fields", () => {
  expect(CSV_HEADER).toBe("firstName,lastName,ceremonyDate,parentEmail,ownEmail"); expect(() => checkCsvSize(csv, false)).not.toThrow();
  expect(() => checkCsvSize("א".repeat(524289), false)).toThrow();
  expect(() => checkCsvSize("\u0001".repeat(400000), false)).toThrow();
  expect(() => checkCsvSize("", false)).toThrow();
});
test("CSV commit sends exact reviewed bytes/choice/binding, validates count and unique IDs, and never retries", async () => {
  const id = "00000000-0000-4000-8000-000000000001";
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, ids: [id] }), { headers: { "content-type": "application/json" } })); vi.stubGlobal("fetch", fetch);
  expect(await csvApi.confirm(csv, false, preview)).toEqual([id]);
  const [path, options] = fetch.mock.calls[0]; expect(path).toBe("/api/admin/students/import/confirm"); expect(JSON.parse(options.body)).toEqual({ csv, allowDuplicates: false, binding: preview.binding }); expect(options.cache).toBe("no-store"); expect(options.referrerPolicy).toBe("no-referrer");
  fetch.mockReset().mockResolvedValue(new Response(JSON.stringify({ ok: true, ids: [] }), { headers: { "content-type": "application/json" } })); await expect(csvApi.confirm(csv, false, preview)).rejects.toThrow(); expect(fetch).toHaveBeenCalledTimes(1);
  fetch.mockReset().mockRejectedValue(new Error("Synthetic lost response")); await expect(csvApi.confirm(csv, false, preview)).rejects.toThrow(); expect(fetch).toHaveBeenCalledTimes(1);
});
