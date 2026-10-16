import { afterEach, expect, it, vi } from "vitest";
import { parseReadingProposal, customReadingRanges, readingBaseline } from "../../src/components/portal/workspace/reading-proposal";
import { workspaceApi, type Assigned } from "../../src/components/portal/workspace/api";
import { PortalRequestError } from "../../src/components/portal/api";
import { reconcileSelectedStudent } from "../../src/components/portal/workspace/student-label";

const id = "10000000-0000-4000-8000-000000000001";
const student = { id, firstName: "Synthetic", lastName: "Learner", ceremonyDate: "2027-01-02", revision: 1 };
const source = { sourceStatus: "available", sourceFetchedAt: 1792100000000, warning: null, toConfirm: ["torah", "entryCap", "nusach"], requiresConfirmation: true };
const prepared = () => ({ ...source, status: "prepared", binding: `v1.${"a".repeat(100)}`, kind: "torah", basis: "custom", ranges: ["Genesis 1:1-3"], verseCount: 3, maftir: { ref: "Numbers 28:9-10", reason: "Synthetic calendar maftir" } });
const aliyah = (n: number | "M", ref: string) => ({ n, ref, verses: null, reason: null });
const empty = () => ({ ...source, status: "needs-selection", snapshot: { date: student.ceremonyDate, calendar: "diaspora", haftarah: null, reading: null } });
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
afterEach(() => vi.unstubAllGlobals());

it("keeps exact prepared ranges, source warning and separately described maftir without expanding the assignment", () => {
  const value = parseReadingProposal(prepared(), "torah", student.ceremonyDate);
  expect(value.status === "prepared" && value.ranges.join() === "Genesis 1:1-3" && value.verseCount === 3 && value.maftir?.ref === "Numbers 28:9-10").toBe(true);
  const unavailable = parseReadingProposal({ ...prepared(), sourceStatus: "unavailable", sourceFetchedAt: null, warning: "calendar-source-unavailable" }, "torah", student.ceremonyDate);
  expect(unavailable.sourceStatus === "unavailable" && unavailable.warning === "calendar-source-unavailable").toBe(true);
});

it("offers only snapshot-derived choices and honestly preserves an empty calendar", () => {
  const none = parseReadingProposal(empty(), "torah", student.ceremonyDate);
  expect(none.status === "needs-selection" && none.choices.length === 0 && none.parashah === null && none.haftarah === null).toBe(true);
  const value = parseReadingProposal({ ...empty(), snapshot: { ...empty().snapshot, reading: { parashah: "Synthetic", source: "Hebcal", type: "shabbat", aliyot: [aliyah(1, "Genesis 1:1-3"), aliyah("M", "Numbers 28:9-10")], triennial: null } } }, "torah", student.ceremonyDate);
  expect(value.status === "needs-selection" && value.choices.map(row => row.pick).join() === "full,aliyah:1,aliyah:M").toBe(true);
});

it("rejects malformed, foreign-date, wrong-kind, diagnostic and oversized review DTOs as fixed unavailable errors", () => {
  for (const body of [{ ...prepared(), kind: "haftarah" }, { ...prepared(), diagnostic: "private" }, { ...prepared(), binding: "readable-legacy" }, { ...prepared(), verseCount: 1001 }, { ...prepared(), ranges: Array(33).fill("Genesis 1:1") }, { ...prepared(), sourceStatus: "unavailable" }, { ...prepared(), sourceFetchedAt: Number.MAX_VALUE }])
    expect(() => parseReadingProposal(body, "torah", student.ceremonyDate)).toThrow(PortalRequestError);
  expect(() => parseReadingProposal({ ...empty(), snapshot: { ...empty().snapshot, date: "2027-01-09" } }, "torah", student.ceremonyDate)).toThrow(PortalRequestError);
});

it("retains line order and bounds custom ranges without inventing reference validity", () => {
  expect(customReadingRanges(" Genesis 1:1-3 \n\nGenesis 2:1-2 ")).toEqual(["Genesis 1:1-3", "Genesis 2:1-2"]);
  for (const text of [" ", "Genesis\t1:1", Array(33).fill("Genesis 1:1").join("\n"), "x".repeat(101)]) {
    expect(() => customReadingRanges(text)).toThrow(PortalRequestError);
  }
  expect(customReadingRanges("Unrecognized book 1:1")).toEqual(["Unrecognized book 1:1"]); // Server validates canonical books/counts.
});

it("baseline changes bind explicit mode, student revision/date and current kind assignment, never names alone", () => {
  const value: Assigned = { student, mode: "tutor", context: null, readings: [] };
  const original = readingBaseline(value, "torah");
  expect(readingBaseline({ ...value, student: { ...student, firstName: "Changed" } }, "torah")).toBe(original);
  for (const changed of [{ ...value, mode: "admin" as const }, { ...value, student: { ...student, revision: 2 } }, { ...value, student: { ...student, ceremonyDate: "2027-01-09" } }])
    expect(readingBaseline(changed, "torah") === original).toBe(false);
  expect(readingBaseline(value, "haftarah") === original).toBe(false);
});

it("prepares with explicit staff mode and confirms only the opaque binding without context headers or automatic retries", async () => {
  const baseline: Assigned = { student, mode: "tutor", context: null, readings: [] };
  const fetch = vi.fn().mockResolvedValueOnce(response(prepared())).mockResolvedValueOnce(response(baseline)).mockResolvedValueOnce(response({ ok: true, assignmentId: id, revision: 2 })); vi.stubGlobal("fetch", fetch);
  const proposal = await workspaceApi.prepareReading("tutor", baseline, "torah", { ranges: ["Genesis 1:1-3"] });
  if (proposal.status !== "prepared") throw new Error("Expected synthetic proposal");
  await workspaceApi.confirmReading("tutor", student.id, proposal.binding);
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ mode: "tutor", kind: "torah", ranges: ["Genesis 1:1-3"] });
  expect(Object.keys(JSON.parse(fetch.mock.calls[2][1].body)).sort()).toEqual(["binding", "mode"]);
  for (const [path, options] of fetch.mock.calls) expect(!path.includes(proposal.binding) && !options.headers.has("X-Practice-Context") && options.cache === "no-store").toBe(true);
  fetch.mockResolvedValue(response({ diagnostic: "private" }, 409));
  await expect(workspaceApi.confirmReading("admin", id, proposal.binding)).rejects.toMatchObject({ status: 409 }); expect(fetch).toHaveBeenCalledTimes(4);
  fetch.mockResolvedValue(response({ diagnostic: "private" }, 503));
  await expect(workspaceApi.confirmReading("admin", id, proposal.binding)).rejects.toMatchObject({ status: 503 }); expect(fetch).toHaveBeenCalledTimes(5);
});

it("does not expose a prepared review against a baseline changed before preparation, including empty-calendar results", async () => {
  const baseline: Assigned = { student, mode: "tutor", context: null, readings: [] };
  for (const proposal of [prepared(), empty()]) {
    const fetch = vi.fn().mockResolvedValueOnce(response(proposal)).mockResolvedValueOnce(response({ ...baseline, student: { ...student, revision: 2, ceremonyDate: "2027-01-09" } })); vi.stubGlobal("fetch", fetch);
    await expect(workspaceApi.prepareReading("tutor", baseline, "torah", {})).rejects.toMatchObject({ status: 409 });
    expect(fetch).toHaveBeenCalledTimes(2);
  }
});

it("reconciles only the selected stable student ID without downgrading revisions or changing other labels", () => {
  const other = { ...student, id: "10000000-0000-4000-8000-000000000002", firstName: "Other" };
  const rows = [student, other], current = { ...student, firstName: "Updated", ceremonyDate: "2027-01-09", revision: 2 };
  const updated = reconcileSelectedStudent(rows, student.id, current);
  expect(updated[0] === current && updated[1] === other && rows[0] === student).toBe(true);
  expect(reconcileSelectedStudent(updated, student.id, student)).toBe(updated);
  expect(reconcileSelectedStudent(rows, other.id, current)).toBe(rows);
  expect(reconcileSelectedStudent(rows, null, current)).toBe(rows);
  expect(reconcileSelectedStudent([other], student.id, current)).toEqual([other]);
});
