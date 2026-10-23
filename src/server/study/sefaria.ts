import "server-only";
import { SEFARIA_REQUEST_HEADERS } from "./sefaria-json";
import { createHash } from "node:crypto";
import type { VerseCounts } from "../../lib/readings/ranges";
import { expandReadingRanges } from "../../lib/readings/ranges";
import { normalizeEnglish, normalizeHebrew } from "./normalize";
import { MAM, matchesEdition, translationEdition, versionParameter } from "./versions";
import { StudyUnavailable, type EditionProvenance, type StudyPage, type StudyRequest, type StudyVerse } from "./types";
import { createStudyCacheEntry, studyCacheBinding, validateStudyCacheEntry, STUDY_CACHE_TTL_MS,
  type StudyChapterCache } from "./cache";
import type { PublicStudyCoalescer, PublicStudyTask } from "./coalescing";

// Application operating bounds, not claims about the provider's limits.
export const STUDY_LIMITS = Object.freeze({ verses: 100, chapters: 8, concurrency: 2, requestMs: 5000, pageMs: 8000,
  chapterBytes: 512 * 1024, pageBytes: 2 * 1024 * 1024 });
type Chapter = Readonly<{ ref: string; book: string; number: number; count: number }>;
type ChapterResult = { verses: readonly StudyVerse[]; editions: readonly EditionProvenance[]; fetchedAt: number; hash: string; decodedBytes: number };
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const invalid = () => { throw new StudyUnavailable("invalid-response"); };

export function planStudyPage(request: StudyRequest, counts: VerseCounts) {
  try {
    if (!object(request) || !Number.isSafeInteger(request.offset) || request.offset < 0) throw 0;
    const translation = translationEdition(request.translation);
    const all = expandReadingRanges(request.ranges, request.kind, counts);
    if (!Array.isArray(request.verses) || all.length !== request.verses.length || all.some((ref, i) => ref !== request.verses[i]) || request.offset >= all.length) throw 0;
    const refs: string[] = [], chapters: Chapter[] = [];
    for (const ref of all.slice(request.offset, request.offset + STUDY_LIMITS.verses)) {
      const match = /^(.*) ([1-9]\d*):[1-9]\d*$/.exec(ref)!;
      const book = match[1], number = Number(match[2]), chapterRef = `${book} ${number}`;
      if (!chapters.some(chapter => chapter.ref === chapterRef)) {
        if (chapters.length === STUDY_LIMITS.chapters) break;
        chapters.push(Object.freeze({ ref: chapterRef, book, number, count: counts[book][number - 1] }));
      }
      refs.push(ref);
    }
    return Object.freeze({ refs: Object.freeze(refs), chapters: Object.freeze(chapters), translation, totalVerses: all.length,
      offset: request.offset, nextOffset: request.offset + refs.length < all.length ? request.offset + refs.length : null });
  } catch { throw new StudyUnavailable("invalid-request"); }
}

function requestUrl(chapter: Chapter, translation: EditionProvenance) {
  const url = new URL(`https://www.sefaria.org/api/v3/texts/${encodeURIComponent(chapter.ref)}`);
  url.searchParams.append("version", versionParameter(MAM));
  url.searchParams.append("version", versionParameter(translation));
  url.searchParams.set("fill_in_missing_segments", "0");
  url.searchParams.set("return_format", "default");
  return url;
}
function validateChapter(payload: unknown, chapter: Chapter, english: EditionProvenance): Omit<ChapterResult, "fetchedAt" | "hash" | "decodedBytes"> {
  if (!object(payload) || payload.ref !== chapter.ref || payload.book !== chapter.book || payload.indexTitle !== chapter.book
    || payload.textDepth !== 2 || payload.isComplex !== false || payload.isSpanning !== false
    || !Array.isArray(payload.sectionNames) || payload.sectionNames.join("|") !== "Chapter|Verse"
    || !Array.isArray(payload.sections) || payload.sections.length !== 1 || String(payload.sections[0]) !== String(chapter.number)
    || !Array.isArray(payload.toSections) || payload.toSections.length !== 1 || String(payload.toSections[0]) !== String(chapter.number)
    || !Array.isArray(payload.versions) || payload.versions.length < 1 || payload.versions.length > 2 || !Array.isArray(payload.warnings)) return invalid();
  const versions = payload.versions;
  if (versions.some(value => !object(value))) return invalid();
  const he = versions.filter(value => object(value) && matchesEdition(value, MAM));
  const en = versions.filter(value => object(value) && matchesEdition(value, english));
  if (he.length !== 1 || en.length > 1 || versions.length !== he.length + en.length) return invalid();
  if (en.length === 1) { if (payload.warnings.length) return invalid(); }
  else {
    if (payload.warnings.length !== 1 || !object(payload.warnings[0])) return invalid();
    const warning = payload.warnings[0], key = versionParameter(english);
    if (Object.keys(warning).length !== 1 || !object(warning[key]) || ![101, 102, 104].includes(warning[key].warning_code as number)) return invalid();
  }
  const texts = (value: Record<string, unknown>) => {
    if (!Array.isArray(value.text) || value.text.length !== chapter.count || value.text.some(item => typeof item !== "string")) return invalid();
    return value.text as string[];
  };
  const hebrew = texts(he[0]), englishText = en.length ? texts(en[0]) : null;
  const verses = hebrew.map((value, i) => Object.freeze({ ref: `${chapter.ref}:${i + 1}`, hebrew: normalizeHebrew(value),
    english: englishText ? normalizeEnglish(englishText[i]) : null }));
  return { verses, editions: [MAM, ...(en.length ? [english] : [])] };
}

// This factory receives public transport dependencies only. Tasks handed to a
// shared coalescer cannot retain request-scoped cache/database/actor objects.
function publicChapterTasks(fetch: typeof globalThis.fetch, now: () => number, requestMs: number) {
  return (selection: Chapter, translation: EditionProvenance): PublicStudyTask<ChapterResult> => async (signal, progress) => {
    const local = new AbortController(), stop = () => local.abort();
    signal.addEventListener("abort", stop, { once: true });
    if (signal.aborted) local.abort();
    let timer: ReturnType<typeof setTimeout> | undefined, reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    const cancel = () => { void reader?.cancel().catch(() => {}); };
    local.signal.addEventListener("abort", cancel, { once: true });
    try {
      return await Promise.race([
        (async () => {
          if (local.signal.aborted) throw new StudyUnavailable("upstream");
          const url = requestUrl(selection, translation);
          let response: Response;
          try { response = await fetch(url, { method: "GET", headers: SEFARIA_REQUEST_HEADERS,
            credentials: "omit", redirect: "error", cache: "no-store", signal: local.signal }); }
          catch { throw new StudyUnavailable("upstream"); }
          if (local.signal.aborted) { void response.body?.cancel().catch(() => {}); throw new StudyUnavailable("upstream"); }
          if (response.status !== 200 || response.redirected || response.url && response.url !== url.href
            || !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(response.headers.get("content-type") ?? "")) {
            void response.body?.cancel().catch(() => {}); return invalid();
          }
          const length = response.headers.get("content-length");
          if (length !== null && (!/^\d+$/.test(length) || Number(length) > STUDY_LIMITS.chapterBytes) || !response.body) {
            void response.body?.cancel().catch(() => {}); return invalid();
          }
          reader = response.body.getReader();
          const decoder = new TextDecoder("utf-8", { fatal: true });
          let count = 0, text = "";
          while (true) {
            const chunk = await reader.read();
            if (local.signal.aborted) throw new StudyUnavailable("upstream");
            if (chunk.done) break;
            count += chunk.value.byteLength;
            if (count > STUDY_LIMITS.chapterBytes) return invalid();
            progress(count);
            text += decoder.decode(chunk.value, { stream: true });
          }
          const parsed = validateChapter(JSON.parse(text + decoder.decode()), selection, translation), fetchedAt = now();
          const normalizedBytes = Buffer.byteLength(JSON.stringify(parsed));
          if (!Number.isSafeInteger(fetchedAt) || fetchedAt < 0 || normalizedBytes > STUDY_LIMITS.chapterBytes) return invalid();
          progress(Math.max(count, normalizedBytes));
          return { ...parsed, fetchedAt, decodedBytes: count, hash: createHash("sha256").update(JSON.stringify(parsed)).digest("hex") };
        })(),
        new Promise<never>((_, reject) => { timer = setTimeout(() => { local.abort(); reject(new StudyUnavailable("upstream")); }, requestMs); }),
        new Promise<never>((_, reject) => { local.signal.addEventListener("abort", () => reject(new StudyUnavailable("upstream")), { once: true }); }),
      ]);
    } finally {
      if (timer) clearTimeout(timer); local.abort(); signal.removeEventListener("abort", stop);
      void reader?.cancel().catch(() => {});
      try { reader?.releaseLock(); } catch { /* No upstream diagnostic. */ }
    }
  };
}

/** Call only between preflight and final live authority transactions. */
export function createSefariaStudyReader(input: { fetch: typeof globalThis.fetch; verseCounts: VerseCounts; now?: () => number;
  cache?: StudyChapterCache; coalescer?: PublicStudyCoalescer; requestMs?: number; pageMs?: number }) {
  const requestMs = input.requestMs ?? STUDY_LIMITS.requestMs, pageMs = input.pageMs ?? STUDY_LIMITS.pageMs, now = input.now ?? Date.now;
  if (!Number.isInteger(requestMs) || requestMs < 1 || requestMs > STUDY_LIMITS.requestMs
    || !Number.isInteger(pageMs) || pageMs < 1 || pageMs > STUDY_LIMITS.pageMs) throw new Error("Invalid study deadline");
  const task = publicChapterTasks(input.fetch, now, requestMs);
  return async function load(request: StudyRequest): Promise<StudyPage> {
    const plan = planStudyPage(request, input.verseCounts), controller = new AbortController();
    const abort = () => controller.abort();
    request.signal?.addEventListener("abort", abort, { once: true });
    if (request.signal?.aborted) controller.abort();
    let bytes = 0, next = 0, pageTimer: ReturnType<typeof setTimeout> | undefined;
    const results = new Map<string, ChapterResult>();
    const chapter = async (selection: Chapter): Promise<ChapterResult> => {
      if (controller.signal.aborted) throw new StudyUnavailable("upstream");
      let accounted = 0;
      const progress = (total: number) => {
        if (!Number.isSafeInteger(total) || total < accounted || total > STUDY_LIMITS.chapterBytes) return invalid();
        bytes += total - accounted; accounted = total;
        if (bytes > STUDY_LIMITS.pageBytes) return invalid();
      };
      const binding = input.cache ? studyCacheBinding(selection.ref, request.translation) : null;
      const cached = binding ? await input.cache!.get(binding) : null;
      if (controller.signal.aborted) throw new StudyUnavailable("upstream");
      if (cached && binding) {
        const valid = validateStudyCacheEntry(binding, cached, now());
        if (valid.expiresAt > now()) {
          progress(Buffer.byteLength(JSON.stringify(valid.payload)));
          return { ...valid.payload, fetchedAt: valid.fetchedAt, hash: valid.hash, decodedBytes: 0 };
        }
      }
      const publicTask = task(selection, plan.translation);
      const key = JSON.stringify(["sefaria:v3:parse5-8.0.1:study-normalized-v1", selection.ref, selection.count, plan.translation.key]);
      const result = input.coalescer
        ? await input.coalescer.run(key, publicTask, controller.signal, progress)
        : await publicTask(controller.signal, progress);
      if (controller.signal.aborted) throw new StudyUnavailable("upstream");
      // Re-account the full public result even when joining after its stream.
      progress(Math.max(result.decodedBytes, Buffer.byteLength(JSON.stringify({ verses: result.verses, editions: result.editions }))));
      if (binding) await input.cache!.set(binding, createStudyCacheEntry(binding, result));
      if (controller.signal.aborted) throw new StudyUnavailable("upstream");
      return result;
    };
    const worker = async () => {
      while (next < plan.chapters.length) {
        if (controller.signal.aborted) throw new StudyUnavailable("upstream");
        const selection = plan.chapters[next++];
        results.set(selection.ref, await chapter(selection));
      }
    };
    try {
      await Promise.race([
        Promise.all(Array.from({ length: Math.min(STUDY_LIMITS.concurrency, plan.chapters.length) }, worker)),
        new Promise<never>((_, reject) => { pageTimer = setTimeout(() => { controller.abort(); reject(new StudyUnavailable("upstream")); }, pageMs); }),
        new Promise<never>((_, reject) => { controller.signal.addEventListener("abort", () => reject(new StudyUnavailable("upstream")), { once: true }); }),
      ]);
      if (controller.signal.aborted) throw new StudyUnavailable("upstream");
      if ([...results.values()].some(result => result.fetchedAt + STUDY_CACHE_TTL_MS <= now())) return invalid();
      const mapped = new Map([...results.values()].flatMap(result => result.verses.map(verse => [verse.ref, verse] as const)));
      const verses = plan.refs.map(ref => { const verse = mapped.get(ref); if (!verse) return invalid(); return verse; });
      const translated = verses.filter(verse => verse.english !== null).length;
      return Object.freeze({ offset: plan.offset, nextOffset: plan.nextOffset, totalVerses: plan.totalVerses, verses: Object.freeze(verses),
        translation: Object.freeze({ key: request.translation, status: translated === verses.length ? "available" : translated === 0 ? "unavailable" : "partial" }),
        chapters: Object.freeze(plan.chapters.map(selection => { const result = results.get(selection.ref)!;
          return Object.freeze({ ref: selection.ref, sefariaUrl: `https://www.sefaria.org/${encodeURIComponent(selection.book)}.${selection.number}`,
            fetchedAt: result.fetchedAt, hash: result.hash, editions: Object.freeze(result.editions) }); })) });
    } catch (error) { throw new StudyUnavailable(error instanceof StudyUnavailable ? error.code : "invalid-response"); }
    finally {
      if (pageTimer) clearTimeout(pageTimer); controller.abort(); request.signal?.removeEventListener("abort", abort);
    }
  };
}
