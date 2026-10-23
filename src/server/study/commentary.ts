import "server-only";
import { SEFARIA_REQUEST_HEADERS } from "./sefaria-json";
import { TANAKH_VERSE_COUNTS } from "../../lib/readings/catalog";
import type { VerseCounts } from "../../lib/readings/ranges";
import { commentaryCandidates, commentaryComplex, commentaryEditionUrl, parseCommentaryChapter, COMMENTARY_LIMITS, type CommentaryChapter, type CommentaryChapterRef,
  type CommentaryComment, type CommentaryEdition, type CommentaryEditionCandidate, type CommentaryRun } from "../../lib/readings/commentary";
import { sefariaRuns } from "./sefaria-runs";

/**
 * One commentary chapter from Sefaria's v3 texts API, for any registered work.
 * Every pinned edition for the corpus is requested at once; Sefaria returns the
 * ones it has and a warning for each it does not, and the first pinned edition
 * (in preference order) with any comment in the chapter is used, per language.
 * A chapter Sefaria has no text for at all (a 404 "We have no text for …", as for
 * a work with gaps) is an empty chapter, marked `absent` so the route can cache it
 * for a day; every other failure stays a failure.
 */
export class CommentaryUnavailable extends Error {
  constructor(readonly code: "invalid-request" | "upstream" | "invalid-response") { super("Commentary unavailable"); }
}
/** `absent`: Sefaria has no text for this chapter of the work (never sent to the browser; the body is the same empty chapter). */
export type ReadCommentaryChapter = CommentaryChapter & Readonly<{ absent?: true }>;
export type CommentaryReader = (work: string, chapter: string, signal?: AbortSignal) => Promise<ReadCommentaryChapter>;
/** The one 404 that means "nothing here" rather than a failure: Sefaria's own words, bounded (it appends "<d>" to some refs). */
const NO_TEXT = /^We have no text for [\p{L}\p{N} ,.'’()\-:;"]{1,200}(?:<d>)?\.$/u;
export function isNoTextAnswer(payload: unknown): boolean {
  return payload !== null && typeof payload === "object" && !Array.isArray(payload) && Object.keys(payload).length === 1
    && typeof (payload as Record<string, unknown>).error === "string" && NO_TEXT.test((payload as Record<string, string>).error);
}
export const COMMENTARY_FETCH_LIMITS = Object.freeze({ requestMs: 5000, upstreamBytes: 1024 * 1024, verseSlots: 1000 });
const invalid = (): never => { throw new CommentaryUnavailable("invalid-response"); };
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

const parameter = (candidate: CommentaryEditionCandidate) => `${candidate.language === "he" ? "hebrew" : "english"}|${candidate.title}`;
const allCandidates = (chapter: CommentaryChapterRef) => [...commentaryCandidates(chapter).he, ...commentaryCandidates(chapter).en];
const matches = (value: Record<string, unknown>, candidate: CommentaryEditionCandidate) => value.versionTitle === candidate.title
  && value.language === candidate.language && value.actualLanguage === candidate.language
  && value.languageFamilyName === (candidate.language === "he" ? "hebrew" : "english") && value.license === candidate.license;

export function commentaryRequestUrl(chapter: CommentaryChapterRef): URL {
  const url = new URL(`https://www.sefaria.org/api/v3/texts/${encodeURIComponent(chapter.ref)}`);
  for (const candidate of allCandidates(chapter)) url.searchParams.append("version", parameter(candidate));
  url.searchParams.set("fill_in_missing_segments", "0");
  url.searchParams.set("return_format", "default");
  return url;
}
const runsOf = (value: unknown): CommentaryRun[] => { try { return sefariaRuns(value); } catch { return invalid(); } };

/** Strict validation of a chapter-level v3 commentary payload: depth 3, [verse][comment] strings, only the pinned editions. */
export function validateCommentaryPayload(payload: unknown, chapter: CommentaryChapterRef): CommentaryChapter {
  const number = String(chapter.number);
  if (!object(payload) || payload.ref !== chapter.ref || payload.book !== chapter.index || payload.indexTitle !== chapter.indexTitle
    || payload.textDepth !== 3 || payload.isComplex !== commentaryComplex(chapter.work, chapter.book) || payload.isSpanning !== false
    || !Array.isArray(payload.sectionNames) || payload.sectionNames.join("|") !== chapter.work.sectionNames.join("|")
    || !Array.isArray(payload.sections) || payload.sections.length !== 1 || String(payload.sections[0]) !== number
    || !Array.isArray(payload.toSections) || payload.toSections.length !== 1 || String(payload.toSections[0]) !== number
    || !Array.isArray(payload.versions) || !Array.isArray(payload.warnings)) return invalid();
  const candidates = allCandidates(chapter), returned = new Map<CommentaryEditionCandidate, unknown[]>(), warned = new Set<CommentaryEditionCandidate>();
  for (const version of payload.versions) {
    if (!object(version)) return invalid();
    const candidate = candidates.find(item => matches(version, item));
    if (!candidate || returned.has(candidate)) return invalid();
    returned.set(candidate, Array.isArray(version.text) ? version.text : invalid());
  }
  for (const warning of payload.warnings) {
    if (!object(warning) || Object.keys(warning).length !== 1) return invalid();
    const key = Object.keys(warning)[0], candidate = candidates.find(item => parameter(item) === key), detail = warning[key];
    if (!candidate || returned.has(candidate) || warned.has(candidate) || !object(detail) || ![101, 102, 103, 104].includes(detail.warning_code as number)) return invalid();
    warned.add(candidate);
  }
  // Every requested edition is accounted for: either returned or reported missing.
  if (returned.size + warned.size !== candidates.length) return invalid();
  const shaped = new Map<CommentaryEditionCandidate, CommentaryRun[][][]>();
  for (const [candidate, text] of returned) {
    if (text.length > COMMENTARY_FETCH_LIMITS.verseSlots) return invalid();
    shaped.set(candidate, text.map((verse, i) => {
      if (!Array.isArray(verse) || verse.length > COMMENTARY_LIMITS.commentsPerVerse) return invalid();
      if (verse.some(comment => typeof comment !== "string")) return invalid();
      // Sefaria pads some chapters past the last verse, usually empty; a work with its own versification may put
      // text there (the Women's Commentary, Numbers 25:19). Those slots are checked for shape and left out.
      if (i >= chapter.verseCount) return [];
      return verse.map(runsOf);
    }));
  }
  const pick = (language: "he" | "en") => commentaryCandidates(chapter)[language]
    .find(candidate => shaped.get(candidate)?.some(verse => verse.some(runs => runs.length > 0))) ?? null;
  const he = pick("he"), en = pick("en"), hebrew = he ? shaped.get(he)! : null, english = en ? shaped.get(en)! : null;
  const verses: Record<string, Readonly<{ comments: readonly CommentaryComment[] }>> = {};
  for (let i = 0; i < chapter.verseCount; i++) {
    const heVerse = hebrew?.[i] ?? [], enVerse = english?.[i] ?? [], comments: CommentaryComment[] = [];
    // Segment n of every edition is the same Sefaria address (<ref>:<verse>:<n>), so comments pair by index.
    for (let c = 0; c < Math.max(heVerse.length, enVerse.length); c++) {
      const heRuns = heVerse[c] ?? [], enRuns = enVerse[c] ?? [];
      if (!heRuns.length && !enRuns.length) continue;
      comments.push(Object.freeze({ hebrew: heRuns.length ? Object.freeze(heRuns) : null, english: enRuns.length ? Object.freeze(enRuns) : null }));
    }
    if (comments.length) verses[String(i + 1)] = Object.freeze({ comments: Object.freeze(comments) });
  }
  const editions: CommentaryEdition[] = [he, en].flatMap(candidate => candidate ? [Object.freeze({ language: candidate.language, title: candidate.title,
    license: candidate.license, credit: candidate.credit, url: commentaryEditionUrl(chapter, candidate) })] : []);
  const result: CommentaryChapter = Object.freeze({ work: chapter.work.key, chapter: chapter.chapter, verses: Object.freeze(verses), editions: Object.freeze(editions) });
  if (Buffer.byteLength(JSON.stringify(result)) > COMMENTARY_LIMITS.chapterBytes) return invalid();
  return result;
}

/** Signed-out safe: public transport only, no cache, no database, no request-scoped objects. */
export function createSefariaCommentaryReader(input: { fetch: typeof globalThis.fetch; verseCounts?: VerseCounts; requestMs?: number }): CommentaryReader {
  const requestMs = input.requestMs ?? COMMENTARY_FETCH_LIMITS.requestMs, counts = input.verseCounts ?? TANAKH_VERSE_COUNTS;
  if (!Number.isInteger(requestMs) || requestMs < 1 || requestMs > COMMENTARY_FETCH_LIMITS.requestMs) throw new Error("Invalid commentary deadline");
  return async function load(work: string, value: string, signal?: AbortSignal): Promise<ReadCommentaryChapter> {
    const chapter = parseCommentaryChapter(work, value, counts);
    if (!chapter) throw new CommentaryUnavailable("invalid-request");
    const local = new AbortController(), stop = () => local.abort();
    signal?.addEventListener("abort", stop, { once: true });
    if (signal?.aborted) local.abort();
    let timer: ReturnType<typeof setTimeout> | undefined, reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      return await Promise.race([
        (async () => {
          if (local.signal.aborted) throw new CommentaryUnavailable("upstream");
          const url = commentaryRequestUrl(chapter);
          let response: Response;
          try { response = await input.fetch(url, { method: "GET", headers: SEFARIA_REQUEST_HEADERS, credentials: "omit", redirect: "error", cache: "no-store", signal: local.signal }); }
          catch { throw new CommentaryUnavailable("upstream"); }
          if (local.signal.aborted) { void response.body?.cancel().catch(() => {}); throw new CommentaryUnavailable("upstream"); }
          if (response.status !== 200 && response.status !== 404 || response.redirected || response.url && response.url !== url.href
            || !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(response.headers.get("content-type") ?? "")) {
            void response.body?.cancel().catch(() => {}); throw new CommentaryUnavailable("upstream");
          }
          const length = response.headers.get("content-length");
          if (length !== null && (!/^\d+$/.test(length) || Number(length) > COMMENTARY_FETCH_LIMITS.upstreamBytes) || !response.body) {
            void response.body?.cancel().catch(() => {}); return invalid();
          }
          reader = response.body.getReader();
          const decoder = new TextDecoder("utf-8", { fatal: true });
          let count = 0, text = "";
          for (;;) {
            const part = await reader.read();
            if (local.signal.aborted) throw new CommentaryUnavailable("upstream");
            if (part.done) break;
            count += part.value.byteLength;
            if (count > COMMENTARY_FETCH_LIMITS.upstreamBytes) return invalid();
            text += decoder.decode(part.value, { stream: true });
          }
          let payload: unknown;
          try { payload = JSON.parse(text + decoder.decode()); } catch { return invalid(); }
          if (response.status === 404) {
            if (!isNoTextAnswer(payload)) throw new CommentaryUnavailable("upstream");
            return Object.freeze({ work: chapter.work.key, chapter: chapter.chapter, verses: Object.freeze({}), editions: Object.freeze([]), absent: true as const });
          }
          return validateCommentaryPayload(payload, chapter);
        })(),
        new Promise<never>((_, reject) => { timer = setTimeout(() => { local.abort(); reject(new CommentaryUnavailable("upstream")); }, requestMs); }),
        new Promise<never>((_, reject) => { local.signal.addEventListener("abort", () => reject(new CommentaryUnavailable("upstream")), { once: true }); }),
      ]);
    } catch (error) { throw error instanceof CommentaryUnavailable ? error : new CommentaryUnavailable("invalid-response"); }
    finally {
      if (timer) clearTimeout(timer); local.abort(); signal?.removeEventListener("abort", stop);
      void reader?.cancel().catch(() => {});
      try { reader?.releaseLock(); } catch { /* No upstream diagnostic. */ }
    }
  };
}
