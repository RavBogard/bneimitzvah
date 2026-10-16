import { describe, expect, it, vi } from "vitest";
import { createSefariaStudyReader, planStudyPage, STUDY_LIMITS } from "../../src/server/study/sefaria";
import { JPS2023, MAM, versionParameter } from "../../src/server/study/versions";
import { StudyUnavailable, type StudyRequest } from "../../src/server/study/types";
import { expandReadingRanges, type VerseCounts } from "../../src/lib/readings/ranges";
vi.mock("server-only", () => ({}));

const counts: VerseCounts = { Genesis: [3, 2], Isaiah: [2] };
const request = (ranges = ["Genesis 1:1-3"], extra: Partial<StudyRequest> = {}): StudyRequest => ({ kind: "torah", ranges,
  verses: expandReadingRanges(ranges, "torah", counts), offset: 0, translation: "jps2023", ...extra });
function payload(chapter = 1, n = counts.Genesis[chapter - 1]) {
  const version = (edition: typeof MAM) => ({ versionTitle: edition.versionTitle, versionSource: edition.sourceUrl,
    license: edition.language === "he" ? "CC-BY-SA" : "CC-BY-NC", language: edition.language,
    actualLanguage: edition.language, languageFamilyName: edition.language === "he" ? "hebrew" : "english",
    text: Array.from({ length: n }, (_, i) => edition.language === "he" ? `אָ֑ב ג׃` : `Synthetic segment ${i + 1}`) });
  return { ref: `Genesis ${chapter}`, book: "Genesis", indexTitle: "Genesis", textDepth: 2, isComplex: false, isSpanning: false,
    sectionNames: ["Chapter", "Verse"], sections: [String(chapter)], toSections: [String(chapter)],
    versions: [version(MAM), version(JPS2023)], warnings: [] as unknown[] };
}
const response = (data: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(data), { headers: { "content-type": "application/json" }, ...init });
const reader = (fetch: typeof globalThis.fetch, extra: { requestMs?: number; pageMs?: number } = {}) => createSefariaStudyReader({ fetch, verseCounts: counts, now: () => 123456, ...extra });

it("builds only exact official chapter requests and projects only assigned verses with independent edition credits", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async (url, options) => {
    const u = new URL(String(url));
    expect(u.origin).toBe("https://www.sefaria.org");
    expect(u.pathname).toBe("/api/v3/texts/Genesis%201");
    expect(u.searchParams.getAll("version")).toEqual([versionParameter(MAM), versionParameter(JPS2023)]);
    expect(u.searchParams.get("fill_in_missing_segments")).toBe("0");
    expect(options).toMatchObject({ credentials: "omit", redirect: "error", cache: "no-store", method: "GET", headers: { accept: "application/json" } });
    expect(Object.keys(options!.headers!)).toEqual(["accept"]);
    return response(payload());
  });
  const page = await reader(fetch)(request(["Genesis 1:2-3"]));
  expect(page.verses.map(verse => verse.ref)).toEqual(["Genesis 1:2", "Genesis 1:3"]);
  expect(page.chapters[0]).toMatchObject({ ref: "Genesis 1", sefariaUrl: "https://www.sefaria.org/Genesis.1", fetchedAt: 123456, editions: [MAM, JPS2023] });
  expect(page.chapters[0].hash).toMatch(/^[a-f0-9]{64}$/);
  expect(page.translation.status).toBe("available");
  expect(Object.isFrozen(page) && Object.isFrozen(page.verses)).toBe(true);
});

it("plans canonical pages under both caps and rejects tampered row order/ranges, arbitrary versions and empty offsets", () => {
  const many: VerseCounts = { Genesis: Array.from({ length: 10 }, () => 20) };
  const ranges = ["Genesis 1:1-6:20"], verses = expandReadingRanges(ranges, "torah", many);
  expect(planStudyPage({ kind: "torah", ranges, verses, translation: "jps2023", offset: 0 }, many)).toMatchObject({ nextOffset: 100, totalVerses: 120 });
  const gaps = Array.from({ length: 10 }, (_, i) => `Genesis ${i + 1}:1`), gapVerses = expandReadingRanges(gaps, "torah", many);
  expect(planStudyPage({ kind: "torah", ranges: gaps, verses: gapVerses, translation: "jps2023", offset: 0 }, many)).toMatchObject({ refs: gapVerses.slice(0, 8), nextOffset: 8 });
  for (const value of [request(undefined, { verses: ["Genesis 1:3", "Genesis 1:2", "Genesis 1:1"] }),
    request(undefined, { offset: 3 }), request(undefined, { offset: -1 }), request(undefined, { translation: "all" as "jps2023" }),
    request(undefined, { ranges: ["https://example.test"] })]) expect(() => planStudyPage(value, counts)).toThrow(StudyUnavailable);
});

it("represents a warned missing English edition and empty translation segments explicitly without fallback", async () => {
  const absent = payload(); absent.versions.pop();
  absent.warnings = [{ [versionParameter(JPS2023)]: { warning_code: 101, message: "Synthetic absent edition" } }];
  const page = await reader(async () => response(absent))(request());
  expect(page.translation.status).toBe("unavailable"); expect(page.verses.every(verse => verse.english === null)).toBe(true);
  expect(page.chapters[0].editions).toEqual([MAM]);
  const partial = payload(); partial.versions[1].text[1] = "";
  const result = await reader(async () => response(partial))(request());
  expect(result.translation.status).toBe("partial"); expect(result.verses[1].english).toBeNull();
});

describe("strict provider structure and edition mapping", () => {
  it.each([
    (p: ReturnType<typeof payload>) => { p.book = "Isaiah"; },
    p => { p.ref = "Genesis 1:1-3"; }, p => { p.sections = ["01"]; }, p => { p.toSections = ["2"]; },
    p => { p.textDepth = 3; }, p => { p.isComplex = true; }, p => { p.isSpanning = true; },
    p => { p.versions[0].text.pop(); }, p => { p.versions[0].text[0] = ""; },
    p => { p.versions[1].text.push("Synthetic extra"); }, p => { p.versions[1].versionTitle = "Different translation"; },
    p => { p.versions[1].license = "Copyright unknown"; }, p => { p.versions[0].versionSource = "https://example.test"; },
    p => { p.versions[0].actualLanguage = "en"; }, p => { p.versions.push(p.versions[0]); },
    p => { p.versions[1] = p.versions[0]; }, p => { p.warnings.push({ unexpected: true }); },
    p => { p.versions.pop(); }, p => { p.versions[1].text[0] = '<span class="unreviewed">Synthetic</span>'; },
  ])("rejects malformed/mixed payloads with a fresh fixed error (%#)", async mutate => {
    const p = payload(); mutate(p);
    await expect(reader(async () => response(p))(request())).rejects.toMatchObject({ message: "Study text unavailable", code: "invalid-response" });
  });
});

it("bounds streamed bytes independently of declared size and cancels rejected streams", async () => {
  let canceled = false;
  const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(STUDY_LIMITS.chapterBytes + 1)); }, cancel() { canceled = true; } });
  await expect(reader(async () => new Response(body, { headers: { "content-type": "application/json", "content-length": "1" } }))(request())).rejects.toMatchObject({ code: "invalid-response" });
  expect(canceled).toBe(true);
  const rejected: ResponseInit[] = [{ status: 302 }, { headers: { "content-type": "text/html" } }, { headers: { "content-type": "application/json", "content-length": "-1" } }];
  for (const init of rejected)
    await expect(reader(async () => response(payload(), init))(request())).rejects.toBeInstanceOf(StudyUnavailable);
  await expect(reader(async () => new Response(new Uint8Array([0xff]), { headers: { "content-type": "application/json" } }))(request())).rejects.toMatchObject({ code: "invalid-response" });
});

it("deadlines cover providers and bodies that ignore AbortSignal; cancellation rejects promptly", async () => {
  await expect(reader(async () => new Promise(() => {}), { requestMs: 10, pageMs: 20 })(request())).rejects.toMatchObject({ code: "upstream" });
  let canceled = false;
  await expect(reader(async () => new Response(new ReadableStream({ cancel() { canceled = true; } }), { headers: { "content-type": "application/json" } }),
    { requestMs: 10, pageMs: 20 })(request())).rejects.toMatchObject({ code: "upstream" });
  expect(canceled).toBe(true);
  const controller = new AbortController(); controller.abort(); const fetch = vi.fn<typeof globalThis.fetch>();
  await expect(reader(fetch)(request(undefined, { signal: controller.signal }))).rejects.toMatchObject({ code: "upstream" });
  expect(fetch).not.toHaveBeenCalled();
});

it("runs no more than two chapter requests concurrently and keeps canonical output despite reverse completion", async () => {
  let active = 0, maximum = 0;
  const fetch: typeof globalThis.fetch = async url => {
    active++; maximum = Math.max(active, maximum);
    const chapter = decodeURIComponent(new URL(String(url)).pathname).endsWith("2") ? 2 : 1;
    await new Promise(resolve => setTimeout(resolve, chapter === 1 ? 10 : 1)); active--;
    return response(payload(chapter));
  };
  const result = await reader(fetch)(request(["Genesis 1:3-2:2"]));
  expect(maximum).toBe(2); expect(result.verses.map(verse => verse.ref)).toEqual(["Genesis 1:3", "Genesis 2:1", "Genesis 2:2"]);
  expect(result.chapters.map(chapter => chapter.ref)).toEqual(["Genesis 1", "Genesis 2"]);
});

it("cancels a parallel stalled reader after the first chapter fails without waiting for its request deadline", async () => {
  let parallelCanceled = false, parallelAborted = false, started!: () => void;
  const parallelStarted = new Promise<void>(resolve => { started = resolve; });
  const fetch: typeof globalThis.fetch = async (url, options) => {
    if (decodeURIComponent(new URL(String(url)).pathname).endsWith("1")) {
      await parallelStarted;
      return response({ error: "Synthetic invalid chapter" });
    }
    options?.signal?.addEventListener("abort", () => { parallelAborted = true; });
    started();
    return new Response(new ReadableStream({ cancel() { parallelCanceled = true; } }), { headers: { "content-type": "application/json" } });
  };
  await expect(reader(fetch)(request(["Genesis 1:3-2:2"]))).rejects.toMatchObject({ code: "invalid-response" });
  expect(parallelCanceled && parallelAborted).toBe(true);
});

it("enforces a shared byte budget across concurrently valid chapter responses", async () => {
  const manyCounts: VerseCounts = { Genesis: Array.from({ length: 8 }, () => 1) };
  const ranges = ["Genesis 1:1-8:1"], verses = expandReadingRanges(ranges, "torah", manyCounts);
  let requests = 0;
  const fetch: typeof globalThis.fetch = async url => {
    requests++;
    const chapter = Number(decodeURIComponent(new URL(String(url)).pathname).match(/ (\d+)$/)![1]);
    const body = JSON.stringify({ ...payload(chapter, 1), ignoredSyntheticPadding: " ".repeat(450 * 1024) });
    expect(Buffer.byteLength(body)).toBeLessThan(STUDY_LIMITS.chapterBytes);
    return new Response(body, { headers: { "content-type": "application/json" } });
  };
  const load = createSefariaStudyReader({ fetch, verseCounts: manyCounts });
  await expect(load({ kind: "torah", ranges, verses, offset: 0, translation: "jps2023" })).rejects.toMatchObject({ code: "invalid-response" });
  expect(requests).toBeGreaterThanOrEqual(5); expect(requests).toBeLessThan(8);
});

it("caller cancellation reaches a stalled response reader and rejects without retaining provider errors", async () => {
  const controller = new AbortController(); let canceled = false, ready!: () => void;
  const started = new Promise<void>(resolve => { ready = resolve; });
  const load = reader(async () => {
    ready(); return new Response(new ReadableStream({ cancel() { canceled = true; } }), { headers: { "content-type": "application/json" } });
  })(request(undefined, { signal: controller.signal }));
  await started;
  // Let the adapter acquire its response reader before aborting the request.
  await new Promise(resolve => setTimeout(resolve, 0)); controller.abort();
  await expect(load).rejects.toMatchObject({ code: "upstream", message: "Study text unavailable" });
  expect(canceled).toBe(true);
  const providerError = Object.assign(new Error("Synthetic private provider diagnostics"), { cause: "Synthetic private cause" });
  try { await reader(async () => { throw providerError; })(request()); throw new Error("Expected denial"); }
  catch (error) {
    expect(error).toBeInstanceOf(StudyUnavailable); expect(error === providerError).toBe(false);
    expect(error).toMatchObject({ message: "Study text unavailable", code: "upstream" });
    expect((error as Error).cause).toBeUndefined();
  }
});

it("cancels a response that arrives only after its ignored abort deadline without acquiring a stalled reader", async () => {
  let release!: (response: Response) => void, canceled = false;
  const pending = new Promise<Response>(resolve => { release = resolve; });
  const load = reader(async () => pending, { requestMs: 10, pageMs: 20 })(request());
  await expect(load).rejects.toMatchObject({ code: "upstream" });
  release(new Response(new ReadableStream({ cancel() { canceled = true; } }), { headers: { "content-type": "application/json" } }));
  await vi.waitFor(() => expect(canceled).toBe(true));
});
