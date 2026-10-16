import { afterEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { fetchStudyPage, parseStudyPage, studyPlan, studyBinding } from "../../src/components/portal/workspace/study/api";
import { PortalRequestError } from "../../src/components/portal/api";
import type { Assigned, ReadingMode, Selection } from "../../src/components/portal/workspace/api";
import { expandReadingRanges } from "../../src/lib/readings/ranges";
import { TANAKH_VERSE_COUNTS } from "../../src/lib/readings/catalog";
import { syntheticUiStudyPage } from "../helpers/study-ui";

const studentId = "10000000-0000-4000-8000-000000000001", assignmentId = "10000000-0000-4000-8000-000000000002", contextId = "10000000-0000-4000-8000-000000000003";
function baseline(mode: ReadingMode = "tutor", ranges = ["Genesis 1:1-3"]): Assigned {
  return { mode, student: { id: studentId, firstName: "Synthetic", lastName: "Study", ceremonyDate: "2027-01-02", revision: 2 },
    context: mode === "child-practice" ? { id: contextId, studentId, studentRevision: 2, authorityRevision: 1, expiresAt: "2026-10-17T00:00:00Z" } : null,
    readings: [{ id: assignmentId, kind: "torah", basis: "custom", revision: 3, ranges, verses: expandReadingRanges(ranges, "torah", TANAKH_VERSE_COUNTS), needsReview: true, confirmationDate: "2026-12-26", source: { status: "unknown", fetchedAt: null, date: null, calendar: null, attribution: null } }] };
}
function page(value: Assigned = baseline(), offset = 0) {
  const assignment = value.readings[0];
  return { studentId, studentRevision: value.student.revision, mode: value.mode, context: value.context,
    assignment: { id: assignment.id, revision: assignment.revision, kind: assignment.kind, needsReview: assignment.needsReview },
    ...syntheticUiStudyPage({ kind: assignment.kind, ranges: assignment.ranges, verses: assignment.verses, offset, translation: "jps2023" }) };
}
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
afterEach(() => vi.unstubAllGlobals());

it("accepts every explicit mode and validates live child student revision independently of the original entry metadata", () => {
  for (const mode of ["student", "parent", "tutor", "admin", "child-practice"] as const) {
    const value = baseline(mode), selection: Selection | undefined = value.context ? { handle: "h".repeat(43), context: { ...value.context, studentRevision: 1 } } : undefined;
    const parsed = parseStudyPage(page(value), value, "torah", 0, selection);
    expect(parsed.verses.length === 3 && parsed.translation.status === "partial").toBe(true);
  }
});

it("retains Hebrew marks, explicit written/read alternatives, paragraph meaning and escaped-text payloads", () => {
  const parsed = parseStudyPage(page(), baseline(), "torah", 0), verse = parsed.verses[0];
  expect(verse.hebrew.segments.some(row => row.kind === "alternative" && row.written !== row.read) && verse.hebrew.paragraphAfter === "setumah" && /[\u0591-\u05af]/.test(verse.hebrew.text)).toBe(true);
  expect(verse.english?.includes("<img") && parsed.verses[1].english === null).toBe(true);
});

it("rejects drift in student/mode/context/assignment/review binding instead of accepting mismatched text", () => {
  const value = baseline("child-practice"), original = page(value), selection = { handle: "h".repeat(43), context: value.context! };
  for (const changed of [{ ...original, studentRevision: 3 }, { ...original, studentId: assignmentId }, { ...original, mode: "parent" }, { ...original, context: { ...value.context, id: assignmentId } }, { ...original, context: { ...value.context, authorityRevision: 2 } }, { ...original, assignment: { ...original.assignment, revision: 4 } }, { ...original, assignment: { ...original.assignment, needsReview: false } }])
    expect(() => parseStudyPage(changed, value, "torah", 0, selection)).toThrow(PortalRequestError);
  expect(studyBinding(value) === studyBinding({ ...value, student: { ...value.student, revision: 3 } })).toBe(false);
});

it("requires exact canonical page order/count/offset and bounded100-verse eight-chapter partitions", () => {
  const value = baseline("tutor", ["Genesis 1:1-4:24"]), plan = studyPlan(value, "torah", 0);
  expect(plan.refs.length === 100 && plan.nextOffset === 100).toBe(true);
  expect(parseStudyPage(page(value), value, "torah", 0).verses).toHaveLength(100);
  const chapterBound = baseline("tutor", Array.from({ length: 9 }, (_, n) => `Genesis ${n + 1}:1`));
  expect(studyPlan(chapterBound, "torah", 0).nextOffset).toBe(8);
  expect(parseStudyPage(page(chapterBound), chapterBound, "torah", 0).chapters).toHaveLength(8);
  for (const changed of [{ ...page(), verses: [...page().verses].reverse() }, { ...page(), verses: page().verses.slice(1) }, { ...page(), totalVerses: 4 }, { ...page(), nextOffset: 1 }, { ...page(), offset: 1 }])
    expect(() => parseStudyPage(changed, baseline(), "torah", 0)).toThrow(PortalRequestError);
  expect(() => studyPlan({ ...value, readings: [{ ...value.readings[0], verses: [...value.readings[0].verses].reverse() }] }, "torah", 0)).toThrow(PortalRequestError);
});

it("renders only reviewed edition/link metadata and never accepts provider-selected URLs or licenses", () => {
  const original = page();
  for (const chapter of [{ ...original.chapters[0], sefariaUrl: "https://example.test/track" }, { ...original.chapters[0], editions: [{ ...original.chapters[0].editions[0], sourceUrl: "javascript:synthetic()" }] }, { ...original.chapters[0], editions: [{ ...original.chapters[0].editions[0], license: "MIT" }] }, { ...original.chapters[0], hash: "invalid" }])
    expect(() => parseStudyPage({ ...original, chapters: [chapter] }, baseline(), "torah", 0)).toThrow(PortalRequestError);
  expect(() => parseStudyPage({ ...original, translation: { key: "jps2023", status: "available" } }, baseline(), "torah", 0)).toThrow(PortalRequestError);
});

it("rejects unknown structured segments, bidi controls, inconsistent flattened text and extra fields atomically", () => {
  const original = page(), first = original.verses[0];
  for (const hebrew of [{ ...first.hebrew, segments: [{ kind: "html", text: "private" }] }, { ...first.hebrew, text: first.hebrew.text + "\u202e" }, { ...first.hebrew, text: "אָב" }, { ...first.hebrew, paragraphAfter: null }, { ...first.hebrew, diagnostic: "private" }])
    expect(() => parseStudyPage({ ...original, verses: [{ ...first, hebrew }, ...original.verses.slice(1)] }, baseline(), "torah", 0)).toThrow(PortalRequestError);
});

it("constructs closed private assignment queries, keeps handles in child headers only and never retries failures", async () => {
  const value = baseline("child-practice"), selection = { handle: "h".repeat(43), context: value.context! }, fetch = vi.fn().mockResolvedValue(response(page(value))); vi.stubGlobal("fetch", fetch);
  await fetchStudyPage(value, "torah", 0, new AbortController().signal, selection);
  const [path, options] = fetch.mock.calls[0], url = new URL(path, "http://localhost");
  expect([...url.searchParams.keys()].sort()).toEqual(["assignmentId", "assignmentRevision", "kind", "mode", "offset", "translation"]);
  expect(options.headers.get("X-Practice-Context") === selection.handle && !path.includes(selection.handle) && options.cache === "no-store" && options.credentials === "same-origin").toBe(true);
  fetch.mockResolvedValue(response({ privateDiagnostic: "withheld" }, 503)); await expect(fetchStudyPage(baseline(), "torah", 0, new AbortController().signal)).rejects.toMatchObject({ status: 503 }); expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetch.mock.calls[1][1].headers.has("X-Practice-Context")).toBe(false);
  fetch.mockResolvedValue(response({ padding: "x".repeat(2 * 1024 * 1024) })); await expect(fetchStudyPage(baseline(), "torah", 0, new AbortController().signal)).rejects.toMatchObject({ status: 503 }); expect(fetch).toHaveBeenCalledTimes(3);
});
