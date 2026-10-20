import { afterEach, describe, expect, it, vi } from "vitest";
import { parseAssigned, parseSelection, parseStudents, workspaceApi } from "../../src/components/portal/workspace/api";
import { PortalRequestError } from "../../src/components/portal/api";

afterEach(() => vi.unstubAllGlobals());
const a = "10000000-0000-4000-8000-000000000001", b = "10000000-0000-4000-8000-000000000002";
const student = () => ({ id: a, firstName: "Synthetic", lastName: "Student", ceremonyDate: "2027-01-02", revision: 1 });
const context = () => ({ id: b, studentId: a, studentRevision: 1, authorityRevision: 1, expiresAt: new Date(Date.now() + 60_000).toISOString() });
const reading = (kind = "torah") => ({ id: b, status: "confirmed", kind, basis: "custom", revision: 1, ranges: ["Genesis 1:1"], verses: ["Genesis 1:1"], confirmationDate: "2027-01-02", needsReview: true, aliyahStarts:null,
  source: { status: "unknown", fetchedAt: null, date: null, calendar: null, attribution: null } });
const reply = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });

it("assigned-reading metadata validates canonical cut membership and preserves null versus explicit one aliyah",()=>{
 const row={...reading(),ranges:["Genesis 1:1-3"],verses:["Genesis 1:1","Genesis 1:2","Genesis 1:3"]},dto=(value:unknown)=>({student:student(),mode:"student",context:null,readings:[value]});
 for(const cuts of [null,[],["Genesis 1:2"]])expect(parseAssigned(dto({...row,aliyahStarts:cuts}),"student",a).readings[0].aliyahStarts).toEqual(cuts);
 for(const cuts of [undefined,["Genesis 1:1"],["Genesis 1:2","Genesis 1:2"],["Genesis 1:3","Genesis 1:2"],["Genesis 1:4"]])expect(()=>parseAssigned(dto({...row,aliyahStarts:cuts}),"student",a)).toThrow();
 expect(()=>parseAssigned(dto({...row,kind:"haftarah",aliyahStarts:[]}),"student",a)).toThrow();
 expect(()=>parseAssigned(dto({...row,verses:["Genesis 1:1","Genesis 1:3"]}),"student",a)).toThrow();
});

describe("workspace DTO and private transport boundaries", () => {
  it("accepts only a closed boolean own-adult list affordance, never reading metadata authority", () => {
    for (const ownAdultHonors of [true, false]) expect(parseStudents({ students: [{ ...student(), ownAdultHonors }] })).toEqual([{ ...student(), ownAdultHonors }]);
    expect(parseStudents({ students: [student()] })[0].ownAdultHonors).toBeUndefined();
    for (const ownAdultHonors of [null, "true", 1, {}]) expect(() => parseStudents({ students: [{ ...student(), ownAdultHonors }] })).toThrow(PortalRequestError);
    expect(() => parseAssigned({ student: { ...student(), ownAdultHonors: true }, mode: "student", context: null, readings: [] }, "student", a)).toThrow(PortalRequestError);
  });
  it("keeps contact fields confined to the admin roster and rejects partial or malformed lists", () => {
    expect(parseStudents({ students: [student()] })).toHaveLength(1);
    const row = { ...student(), studentKind: "child" as const, serviceSlot: "unknown" as const, parentEmail: "synthetic-parent@example.test", ownEmail: null, disabledAt: null };
    expect(() => parseStudents({ students: [row] })).toThrow(PortalRequestError);
    expect(parseStudents({ students: [row] }, true)).toHaveLength(1);
    expect(() => parseStudents({ students: [student(), { ...student(), ceremonyDate: "2027-02-30" }] })).toThrow(PortalRequestError);
    expect(() => parseStudents({ students: [student(), student()] })).toThrow(PortalRequestError);
    expect(() => parseStudents({ students: Array.from({ length: 101 }, student) })).toThrow(PortalRequestError);
  });

  it("requires exact child identity, role, context binding and complete reading metadata", () => {
    const currentContext = context();
    const selection = parseSelection({ handle: "a".repeat(43), context: currentContext }, a);
    const value = { student: student(), mode: "child-practice", context: currentContext, readings: [reading()] };
    expect(parseAssigned(value, "child-practice", a, selection).readings[0].needsReview).toBe(true);
    const updated = parseAssigned({ ...value, student: { ...student(), revision: 2 }, context: { ...currentContext, studentRevision: 2 } }, "child-practice", a, selection);
    expect(updated.student.revision === 2 && updated.context?.studentRevision === 2).toBe(true);
    for (const changed of [{ ...value, mode: "parent" }, { ...value, student: { ...student(), id: b } }, { ...value, context: { ...context(), id: a } },
      { ...value, context: { ...currentContext, authorityRevision: 2 } },
      { ...value, context: { ...currentContext, expiresAt: new Date(Date.parse(currentContext.expiresAt) + 1).toISOString() } }, { ...value, readings: [{ ...reading(), privateSnapshot: {} }] }])
      expect(() => parseAssigned(changed, "child-practice", a, selection)).toThrow(PortalRequestError);
    expect(() => parseAssigned({ ...value, mode: "parent" }, "parent", a)).toThrow(PortalRequestError);
  });

  it("orders Torah before haftarah, preserves empty assignments and rejects unsafe attribution URLs", () => {
    const value = { student: student(), mode: "parent", context: null, readings: [reading("haftarah"), reading()] };
    expect(parseAssigned(value, "parent", a).readings.map(row => row.kind)).toEqual(["torah", "haftarah"]);
    expect(parseAssigned({ ...value, readings: [] }, "parent", a).readings).toHaveLength(0);
    expect(() => parseAssigned({ ...value, readings: [{ ...reading(), source: { ...reading().source, attribution: { name: "Hebcal", url: "javascript:untrusted" } } }] }, "parent", a)).toThrow(PortalRequestError);
  });

  it("sends practice handles only as headers on explicit child requests, never on base or admin calls", async () => {
    const fetch = vi.fn().mockImplementation((path: string) => Promise.resolve(path.startsWith("/api/admin/") ? reply({ students: [] }) : reply({ student: student(), mode: "parent", context: null, readings: [] })));
    vi.stubGlobal("fetch", fetch);
    await workspaceApi.reading("parent", a); await workspaceApi.roster();
    for (const [path, options] of fetch.mock.calls) {
      expect(!String(path).includes("handle") && !options.headers.has("X-Practice-Context")).toBe(true);
      expect(options.cache === "no-store" && options.credentials === "same-origin" && options.referrerPolicy === "no-referrer").toBe(true);
    }
    const currentContext = context(), selected = { handle: "a".repeat(43), context: currentContext };
    fetch.mockImplementation(() => Promise.resolve(reply({ student: student(), mode: "child-practice", context: currentContext, readings: [] })));
    await workspaceApi.reading("child-practice", a, selected);
    expect(fetch.mock.calls[2][1].headers.get("X-Practice-Context") === selected.handle && !fetch.mock.calls[2][0].includes(selected.handle)).toBe(true);
    await expect(workspaceApi.reading("tutor", a, selected)).rejects.toThrow(PortalRequestError);
  });

  it("preserves typed409 conflicts without retrying or exposing response diagnostics", async () => {
    const fetch = vi.fn().mockResolvedValue(reply({ privateDiagnostic: "withheld" }, 409)); vi.stubGlobal("fetch", fetch);
    const form = { firstName: "Synthetic", lastName: "Student", ceremonyDate: "2027-01-02", studentKind: "child" as const, serviceSlot: "unknown" as const, parentEmail: "synthetic-parent@example.test", ownEmail: null };
    let caught: unknown; try { await workspaceApi.save(form, { id: a, revision: 1 }); } catch (error) { caught = error; }
    expect(caught instanceof PortalRequestError && caught.status === 409 && !String(caught).includes("withheld")).toBe(true); expect(fetch).toHaveBeenCalledTimes(1);
    expect(Object.keys(JSON.parse(fetch.mock.calls[0][1].body)).sort()).toEqual(["expectedRevision", "student"]);
  });

  it("rejects oversized roster responses atomically and malformed saved-target responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply({ payload: "x".repeat(2 * 1024 * 1024) })));
    await expect(workspaceApi.roster()).rejects.toMatchObject({ status: 503 });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply({ ok: true, id: b, revision: 2, readingNeedsReview: false })));
    await expect(workspaceApi.save({ ...student(), studentKind: "child" as const, serviceSlot: "unknown" as const, parentEmail: "synthetic-parent@example.test", ownEmail: null }, { id: a, revision: 1 })).rejects.toThrow(PortalRequestError);
  });
});
