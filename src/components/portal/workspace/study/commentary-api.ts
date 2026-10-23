import { PortalRequestError } from "../../api";
import { getJson } from "../../public-reading/api";
import { referenceRecord } from "../../../../lib/reference-audio/source";
import { commentaryCandidates, commentaryChapterOfVerse, commentaryEditionUrl, commentarySefariaUrl, parseCommentaryChapter, COMMENTARY_LIMITS,
  type CommentaryChapter, type CommentaryChapterRef, type CommentaryComment, type CommentaryEdition, type CommentaryRun } from "../../../../lib/readings/commentary";

/**
 * Commentary in the browser: a same-origin GET to /api/public/commentary (no
 * cookie, no Authorization, the same answer for every reader), strictly parsed.
 * Everything here is text for React to render as text; nothing is ever markup.
 */
const bad = (): never => { throw new PortalRequestError(503); };
/** Strict text runs, as the sanitiser makes them (shared with Compare). */
export function parseRuns(value: unknown, maxChars: number = COMMENTARY_LIMITS.runChars): readonly CommentaryRun[] {
  if (!Array.isArray(value) || value.length > COMMENTARY_LIMITS.runsPerComment) return bad();
  return Object.freeze(value.map(raw => {
    const has = (key: string) => raw !== null && typeof raw === "object" && Object.hasOwn(raw, key), bold = has("bold"), italic = has("italic");
    const row = referenceRecord(raw, ["text", ...bold ? ["bold"] : [], ...italic ? ["italic"] : []]);
    if (!row || typeof row.text !== "string" || !row.text || row.text.length > maxChars || bold && row.bold !== true || italic && row.italic !== true) return bad();
    return Object.freeze({ text: row.text, ...bold ? { bold: true as const } : {}, ...italic ? { italic: true as const } : {} });
  }));
}
function comment(value: unknown): CommentaryComment {
  const row = referenceRecord(value, ["hebrew", "english"]);
  if (!row) return bad();
  const hebrew = row.hebrew === null ? null : parseRuns(row.hebrew), english = row.english === null ? null : parseRuns(row.english);
  if (hebrew && !hebrew.length || english && !english.length || !hebrew && !english) return bad();
  return Object.freeze({ hebrew, english });
}
function edition(value: unknown, chapter: CommentaryChapterRef): CommentaryEdition {
  const row = referenceRecord(value, ["language", "title", "license", "credit", "url"]);
  const known = row && (row.language === "he" || row.language === "en")
    ? commentaryCandidates(chapter)[row.language].find(candidate => candidate.title === row.title && candidate.license === row.license) : undefined;
  if (!row || !known || row.credit !== known.credit || row.url !== commentaryEditionUrl(chapter, known)) return bad();
  return Object.freeze({ language: known.language, title: known.title, license: known.license, credit: known.credit, url: row.url as string });
}
export function parseCommentaryResponse(value: unknown, work: string, chapterName: string): CommentaryChapter {
  const chapter = parseCommentaryChapter(work, chapterName), row = referenceRecord(value, ["work", "chapter", "verses", "editions"]);
  if (!chapter || !row || row.work !== chapter.work.key || row.chapter !== chapter.chapter || !row.verses || typeof row.verses !== "object"
    || ![Object.prototype, null].includes(Object.getPrototypeOf(row.verses)) || !Array.isArray(row.editions) || row.editions.length > 2) return bad();
  const verses: Record<string, Readonly<{ comments: readonly CommentaryComment[] }>> = Object.create(null);
  for (const key of Reflect.ownKeys(row.verses)) {
    if (typeof key !== "string" || !/^[1-9]\d{0,2}$/.test(key) || Number(key) > chapter.verseCount) return bad();
    const verse = referenceRecord((row.verses as Record<string, unknown>)[key], ["comments"]);
    if (!verse || !Array.isArray(verse.comments) || verse.comments.length < 1 || verse.comments.length > COMMENTARY_LIMITS.commentsPerVerse) return bad();
    verses[key] = Object.freeze({ comments: Object.freeze(verse.comments.map(comment)) });
  }
  const editions = row.editions.map(item => edition(item, chapter));
  if (new Set(editions.map(item => item.language)).size !== editions.length || Object.keys(verses).length > 0 && !editions.length) return bad();
  return Object.freeze({ work: chapter.work.key, chapter: chapter.chapter, verses: Object.freeze(verses), editions: Object.freeze(editions) });
}
export async function fetchCommentaryChapter(work: string, chapterName: string, signal: AbortSignal): Promise<CommentaryChapter> {
  const chapter = parseCommentaryChapter(work, chapterName);
  if (!chapter) return bad();
  const path = `/api/public/commentary?${new URLSearchParams([["work", chapter.work.key], ["chapter", chapter.chapter]]).toString()}`;
  return parseCommentaryResponse(await getJson(path, COMMENTARY_LIMITS.responseBytes, signal), chapter.work.key, chapter.chapter);
}

export type CommentaryChapterState = Readonly<{ status: "loading" }> | Readonly<{ status: "failed"; at: number }> | Readonly<{ status: "ready"; data: CommentaryChapter }>;
/** "none": the work does not cover this verse (or is switched off). "ready" with no comments: the work says nothing on it. */
export type CommentaryVerseState = Readonly<{ status: "none" }> | Readonly<{ status: "loading" }> | Readonly<{ status: "failed" }>
  | Readonly<{ status: "ready"; comments: readonly CommentaryComment[]; editions: readonly CommentaryEdition[]; sefariaUrl: string }>;
const NONE: CommentaryVerseState = Object.freeze({ status: "none" }), LOADING: CommentaryVerseState = Object.freeze({ status: "loading" });
const FAILED: CommentaryVerseState = Object.freeze({ status: "failed" }), EMPTY: readonly CommentaryComment[] = Object.freeze([]);
const LOADING_STATE: CommentaryChapterState = Object.freeze({ status: "loading" });
/** A failed chapter is quiet, and is asked for again by a later load once this long has passed. */
export const COMMENTARY_RETRY_MS = 60_000;

/**
 * Framework-free chapter store for one work, behind useCommentaryChapters. Any
 * number of consumers may share it: each load() subscribes its listener and
 * registers interest in its chapters; every state change notifies every
 * listener. A chapter is fetched at most once while it is wanted (at most two
 * fetches at a time across the store), aborted only when no consumer still
 * wants it, kept once ready, and retried after COMMENTARY_RETRY_MS if it failed.
 */
export function createCommentaryChapterStore(work: string,
  fetchChapter: (work: string, chapter: string, signal: AbortSignal) => Promise<CommentaryChapter> = fetchCommentaryChapter,
  concurrency = 2, now: () => number = Date.now) {
  const states = new Map<string, CommentaryChapterState>(), listeners = new Set<() => void>();
  type Flight = { controller: AbortController; wanted: number; started: boolean; slot: boolean };
  const flights = new Map<string, Flight>(), waiting: string[] = [];
  let running = 0;
  const notify = () => { for (const listener of [...listeners]) { try { listener(); } catch { /* A consumer's error never stops the others. */ } } };
  const pump = () => {
    while (running < concurrency && waiting.length) {
      const chapter = waiting.shift()!, flight = flights.get(chapter);
      if (!flight || flight.started) continue;
      flight.started = true; flight.slot = true; running++;
      void (async () => {
        let next: CommentaryChapterState;
        try { next = Object.freeze({ status: "ready", data: await fetchChapter(work, chapter, flight.controller.signal) }); }
        catch { next = Object.freeze({ status: "failed", at: now() }); }
        if (flight.slot) { flight.slot = false; running--; }
        if (flights.get(chapter) === flight) {
          flights.delete(chapter);
          if (flight.controller.signal.aborted) states.delete(chapter); else states.set(chapter, next);
          notify();
        }
        pump();
      })();
    }
  };
  const wanted = (chapter: string) => {
    const state = states.get(chapter);
    return parseCommentaryChapter(work, chapter) !== null && (!state || state.status === "failed" && now() - state.at >= COMMENTARY_RETRY_MS || state.status === "loading");
  };
  return Object.freeze({
    work,
    state: (chapter: string): CommentaryChapterState | undefined => states.get(chapter),
    forVerse(ref: string): CommentaryVerseState {
      const chapter = commentaryChapterOfVerse(work, ref);
      if (!chapter) return NONE;
      const state = states.get(chapter.chapter);
      if (!state || state.status === "loading") return LOADING;
      if (state.status === "failed") return FAILED;
      const verse = Number(ref.slice(ref.lastIndexOf(":") + 1));
      return Object.freeze({ status: "ready", comments: state.data.verses[String(verse)]?.comments ?? EMPTY, editions: state.data.editions, sefariaUrl: commentarySefariaUrl(chapter, verse) });
    },
    /** Subscribes `changed` and asks for these chapters; the returned cleanup unsubscribes and gives up its interest. */
    load(chapters: readonly string[], changed: () => void): () => void {
      listeners.add(changed);
      // Each consumer holds the very fetch it joined, so leaving never releases a later fetch of the same chapter it never asked for.
      const joined: [string, Flight][] = [];
      for (const chapter of [...new Set(chapters)].filter(wanted)) {
        let flight = flights.get(chapter);
        if (flight) flight.wanted++;
        else {
          flight = { controller: new AbortController(), wanted: 1, started: false, slot: false };
          flights.set(chapter, flight); states.set(chapter, LOADING_STATE); waiting.push(chapter);
        }
        joined.push([chapter, flight]);
      }
      pump();
      let done = false;
      return () => {
        if (done) return; done = true;
        listeners.delete(changed);
        let forgot = false;
        for (const [chapter, flight] of joined) {
          if (flights.get(chapter) !== flight || --flight.wanted > 0) continue; // finished already, or still wanted by another
          // Nobody wants it now: abort it and forget it, so the next consumer that needs it asks again.
          // An aborted fetch gives its slot back at once, so the next wanted chapter is not held behind it.
          flight.controller.abort(); flights.delete(chapter); states.delete(chapter); forgot = true;
          if (flight.slot) { flight.slot = false; running--; }
          if (!flight.started && waiting.includes(chapter)) waiting.splice(waiting.indexOf(chapter), 1);
        }
        if (forgot) { notify(); pump(); }
      };
    },
  });
}
export type CommentaryChapterStore = ReturnType<typeof createCommentaryChapterStore>;

