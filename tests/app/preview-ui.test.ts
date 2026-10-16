import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { parsePreviewPreparation, parsePreviewPage, previewApi } from "../../src/components/portal/workspace/preview-api";
import { PortalRequestError } from "../../src/components/portal/api";
import type { Assigned } from "../../src/components/portal/workspace/api";
import { syntheticUiStudyPage } from "../helpers/study-ui";
import { expandReadingRanges } from "../../src/lib/readings/ranges";
import { TANAKH_VERSE_COUNTS } from "../../src/lib/readings/catalog";

const id = "10000000-0000-4000-8000-000000000001";
const baseline: Assigned = { student: { id, firstName: "Synthetic", lastName: "Preview", ceremonyDate: "2027-01-02", revision: 1 }, mode: "admin", context: null, readings: [] };
function prepared() {
  return { status: "prepared", studentId: id, studentRevision: 1, mode: "admin", kind: "torah", ceremonyDate: "2027-01-02", serviceSlot: "morning", readingDate: "2027-01-02",
    calendar: "diaspora", source: "calendar", sourceFetchedAt: Date.now() - 1000, manualFallback: null, portion: "Synthetic", calendarAliyot: [{ n: 1, ref: "Genesis 1:1-6:8" }],
    maftir: { ref: "Numbers 28:9-10", reason: "Synthetic special maftir" }, binding: `v1.${"a".repeat(100)}`, expiresAt: Date.now() + 299000, ranges: ["Genesis 1:1-6:8"], verseCount: 146,
    pages: [{ offset: 0, first: "Genesis 1:1", last: "Genesis 4:20", chapters: ["Genesis 1", "Genesis 2", "Genesis 3", "Genesis 4"] }, { offset: 100, first: "Genesis 4:21", last: "Genesis 6:8", chapters: ["Genesis 4", "Genesis 5", "Genesis 6"] }] };
}
const response = (body: unknown) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
afterEach(() => vi.unstubAllGlobals());

test("preview validates a candidate's exact bounded pages and canonical Hebrew/qere/credits without assigning an ending", () => {
  const value = parsePreviewPreparation(prepared(), baseline, "torah", "calendar");
  if (value.status !== "prepared") throw new Error("Expected preview");
  const body = { studentId: id, studentRevision: 1, mode: "admin", kind: "torah", expiresAt: value.expiresAt,
    ...syntheticUiStudyPage({ kind: "torah", ranges: value.ranges, verses: expandReadingRanges(value.ranges, "torah", TANAKH_VERSE_COUNTS), offset: 0, translation: "jps2023" }) };
  const page = parsePreviewPage(body, value, 0);
  expect(page.verses).toHaveLength(100); expect(page.chapters).toHaveLength(4); expect(page.verses[0].hebrew.segments.some(segment => segment.kind === "alternative")).toBe(true);
  expect(page.chapters[0].editions.map(edition => edition.key)).toEqual(["mam", "jps2023"]);
  expect(() => parsePreviewPage({ ...body, expiresAt: value.expiresAt + 1 }, value, 0)).toThrow(PortalRequestError);
  expect(() => parsePreviewPage({ ...body, kind: "haftarah" }, value, 0)).toThrow(PortalRequestError);
  expect(() => parsePreviewPage({ ...body, diagnostic: "private" }, value, 0)).toThrow(PortalRequestError);
  expect(() => parsePreviewPage(body, value, 1)).toThrow(PortalRequestError);
});

test("preview rejects ambiguous metadata, false dates, invented calendar boundaries, overlarge or altered pagination and extra fields", () => {
  const original = prepared();
  for (const mutant of [
    { ...original, diagnostic: "private" }, { ...original, source: { url: "https://example.test" } }, { ...original, serviceSlot: "unknown" }, { ...original, readingDate: "2027-01-09" },
    { ...original, binding: "legacy" }, { ...original, expiresAt: Date.now() + 600000 }, { ...original, verseCount: 145 }, { ...original, pages: original.pages.slice(0, 1) },
    { ...original, pages: [{ ...original.pages[0], offset: 1 }, original.pages[1]] }, { ...original, pages: [{ ...original.pages[0], chapters: ["Genesis 50"] }, original.pages[1]] },
    { ...original, calendarAliyot: [{ n: 1, ref: "Numbers 28:9-10" }] }, { ...original, calendarAliyot: [{ n: 8, ref: "Genesis 1:1-3" }] },
  ]) expect(() => parsePreviewPreparation(mutant, baseline, "torah", "calendar")).toThrow(PortalRequestError);
  expect(() => parsePreviewPreparation({ ...original, source: "manual" }, baseline, "torah", "manual")).toThrow(PortalRequestError);
  const manual = parsePreviewPreparation({ ...original, source: "manual", serviceSlot: "unknown", readingDate: null, sourceFetchedAt: null, manualFallback: "unknown-slot", calendarAliyot: [], maftir: null }, baseline, "torah", "manual");
  expect(manual).toMatchObject({ source: "manual", readingDate: null, manualFallback: "unknown-slot", calendarAliyot: [] });
});

test("preview transport keeps tokens in POST bodies, rechecks the monotonic baseline, and preserves the original token expiry", async () => {
  const original = prepared(), fetch = vi.fn().mockResolvedValueOnce(response(original)).mockResolvedValueOnce(response(baseline)); vi.stubGlobal("fetch", fetch);
  const preparedValue = await previewApi.prepare("admin", baseline, "torah", "calendar", undefined, new AbortController().signal);
  if (preparedValue.status !== "prepared") throw new Error("Expected preview");
  const body = { studentId: id, studentRevision: 1, mode: "admin", kind: "torah", expiresAt: preparedValue.expiresAt,
    ...syntheticUiStudyPage({ kind: "torah", ranges: preparedValue.ranges, verses: expandReadingRanges(preparedValue.ranges, "torah", TANAKH_VERSE_COUNTS), offset: 0, translation: "jps2023" }) };
  fetch.mockResolvedValueOnce(response(body)); await previewApi.page(preparedValue, 0, new AbortController().signal);
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ mode: "admin", kind: "torah", source: "calendar" });
  expect(JSON.parse(fetch.mock.calls[2][1].body)).toEqual({ mode: "admin", binding: original.binding, offset: 0 });
  expect(fetch.mock.calls.every(([url, options]) => !url.includes(original.binding) && !url.includes("Genesis") && options.credentials === "same-origin" && options.cache === "no-store" && options.referrerPolicy === "no-referrer")).toBe(true);
  fetch.mockResolvedValueOnce(response(original)).mockResolvedValueOnce(response({ ...baseline, student: { ...baseline.student, revision: 2 } }));
  await expect(previewApi.prepare("admin", baseline, "torah", "calendar", undefined, new AbortController().signal)).rejects.toMatchObject({ status: 409 });
});
