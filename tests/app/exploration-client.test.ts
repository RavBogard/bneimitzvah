import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { explorationApi, parseExplorationPreparation, parseExplorationPage } from "../../src/components/portal/workspace/study/exploration-api";
import type { Selection } from "../../src/components/portal/workspace/api";
import { PortalRequestError } from "../../src/components/portal/api";
import { explorationBaseline, explorationResponse, explorationPrepared, explorationPage } from "./exploration-client-helper";
const response = (value: unknown) => new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

test("full proposal validates exact pagination/canonical text/credits and has no fake assignment identity", () => {
  const baseline = explorationBaseline(), prepared = explorationPrepared();
  expect(prepared.verseCount).toBe(146); let total = 0;
  for (const offset of [0, 100]) {
    const page = parseExplorationPage({ studentId: prepared.studentId, studentRevision: 1, mode: "student", kind: "torah", expiresAt: prepared.expiresAt, ...explorationPage(offset) }, prepared, offset);
    total += page.verses.length; expect(page.chapters[0].editions[0].key).toBe("mam");
  }
  expect(total).toBe(146); expect(baseline.readings).toEqual([]); expect(prepared).not.toHaveProperty("assignmentId");
});

test("malformed, extra, wrong date/slot, bounded scope and incomplete pagination responses fail closed", () => {
  const original = explorationResponse();
  for (const patch of [{ kind: "haftarah" }, { mode: "parent" }, { studentRevision: 2 }, { actor: {} }, { ceremonyDate: "2027-01-09" },
    { readingDate: "2027-01-09" }, { serviceSlot: "unknown" }, { binding: "https://example.test" }, { expiresAt: Date.now() - 1 }, { sourceFetchedAt: Date.now() + 60000 },
    { ranges: ["Genesis 1:1-50:26"] }, { ranges: ["Genesis 1:1-3", "Genesis 1:4-6"] }, { verseCount: 9 }, { pages: original.pages.slice(0, 1) },
    { pages: [{ ...original.pages[0], offset: 1 }, original.pages[1]] }, { pages: [...original.pages, original.pages[1]] }])
    expect(() => parseExplorationPreparation({ ...original, ...patch }, explorationBaseline())).toThrow(PortalRequestError);
});

test("unresolved date/slot and nonregular reasons are closed; existing confirmed Torah is never replaced", () => {
  const original = explorationResponse(), common = Object.fromEntries(Object.entries(original).filter(([key]) => ["studentId", "studentRevision", "mode", "kind", "ceremonyDate", "serviceSlot", "readingDate", "calendar"].includes(key)));
  expect(parseExplorationPreparation({ ...common, status: "unresolved", serviceSlot: "unknown", readingDate: null, reason: "unknown-slot" }, explorationBaseline())).toMatchObject({ status: "unresolved", reason: "unknown-slot" });
  expect(() => parseExplorationPreparation({ ...common, status: "unresolved", serviceSlot: "unknown", readingDate: null, reason: "holiday" }, explorationBaseline())).toThrow();
  expect(() => parseExplorationPreparation({ ...common, status: "unresolved", reason: "anything" }, explorationBaseline())).toThrow();
  expect(() => parseExplorationPreparation(original, { ...explorationBaseline(), mode: "parent" })).toThrow();
  const assigned = { ...explorationBaseline(), readings: [{ kind: "torah" }] } as ReturnType<typeof explorationBaseline>;
  expect(() => parseExplorationPreparation(original, assigned)).toThrow();
});

test("page cannot swap student/mode/binding deadline/refs/content or invent an offset", () => {
  const prepared = explorationPrepared(), body = { studentId: prepared.studentId, studentRevision: 1, mode: "student", kind: "torah", expiresAt: prepared.expiresAt, ...explorationPage() };
  for (const patch of [{ mode: "tutor" }, { studentRevision: 2 }, { expiresAt: prepared.expiresAt + 1 }, { assignment: {} }, { totalVerses: 9 }, { nextOffset: null },
    { verses: [{ ...body.verses[0], ref: "Genesis 50:1" }, ...body.verses.slice(1)] }, { chapters: [{ ...body.chapters[0], sefariaUrl: "https://foreign.example.test" }, ...body.chapters.slice(1)] }])
    expect(() => parseExplorationPage({ ...body, ...patch }, prepared, 0)).toThrow();
  expect(() => parseExplorationPage(body, prepared, 1)).toThrow();
});

test("literal POST body carries only server scope inputs; child handle stays in private header and metadata rechecks after each response", async () => {
  const baseline = explorationBaseline(), selection: Selection = { handle: "synthetic-private-handle", context: { id: "10000000-0000-4000-8000-000000000002", studentId: baseline.student.id, studentRevision: 1, authorityRevision: 1, expiresAt: new Date(Date.now() + 300000).toISOString() } };
  baseline.mode = "child-practice"; baseline.student.revision = 2; baseline.context = { ...selection.context, studentRevision: 2 };
  // The selected tab's authority is stable while student metadata revisions
  // refresh. It is not required to recreate the practice context on every edit.
  const raw = { ...explorationResponse(), studentRevision: 2, mode: "child-practice" }, prepared = parseExplorationPreparation(raw, baseline);
  if (prepared.status !== "prepared") throw 0;
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (path, init) => {
    if (init?.method === "POST") return response(String(path).endsWith("prepare") ? raw : { studentId: baseline.student.id, studentRevision: baseline.student.revision, mode: baseline.mode, kind: "torah", expiresAt: prepared.expiresAt, ...explorationPage() });
    return response(baseline);
  }); vi.stubGlobal("fetch", fetcher);
  const result = await explorationApi.prepare(baseline, new AbortController().signal, selection);
  if (result.status !== "prepared") throw 0;
  await explorationApi.page(baseline, result, 0, new AbortController().signal, selection);
  expect(fetcher).toHaveBeenCalledTimes(4);
  for (const [path, init] of fetcher.mock.calls) {
    expect(String(path)).not.toContain(selection.handle); expect(init).toMatchObject({ credentials: "same-origin", cache: "no-store", referrerPolicy: "no-referrer", redirect: "error" });
    expect(new Headers(init?.headers).get("X-Practice-Context")).toBe(selection.handle);
    if (init?.method === "POST") expect(JSON.parse(String(init.body))).toEqual(String(path).endsWith("prepare") ? { mode: "child-practice" } : { mode: "child-practice", binding: result.binding, offset: 0 });
  }
});

test("metadata drift, abort and invalid child selection refuse late public result without assigned endpoint calls", async () => {
  const baseline = explorationBaseline(), fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(response(explorationResponse())).mockResolvedValueOnce(response({ ...baseline, student: { ...baseline.student, revision: 2 } }));
  vi.stubGlobal("fetch", fetcher);
  await expect(explorationApi.prepare(baseline, new AbortController().signal)).rejects.toMatchObject({ status: 409 });
  const controller = new AbortController();
  fetcher.mockReset().mockImplementation(async path => { if (String(path).includes("explore")) { controller.abort(); return response(explorationResponse()); } return response(baseline); });
  await expect(explorationApi.prepare(baseline, controller.signal)).rejects.toMatchObject({ status: 409 });
  fetcher.mockClear(); await expect(explorationApi.prepare({ ...baseline, mode: "child-practice" }, new AbortController().signal)).rejects.toMatchObject({ status: 409 });
  expect(fetcher).not.toHaveBeenCalled();
});
