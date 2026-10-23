import "server-only";
import { AccessDenied } from "../access/errors";
import { PublicReadingUnavailable, type PublicKind, type PublicPassage, type PublicReadingService } from "../public-reading/service";
import { canonicalReadingRef, READING_REF_LIMITS } from "../../lib/readings/reading-ref";
import { HttpBoundaryError, type JsonValue } from "./responses";
import { publicShabbat } from "../../lib/readings/public-shabbat";
import { studyPageView, wordAidsView, wordDetailsView } from "./portal";
import { parseCommentaryChapter } from "../../lib/readings/commentary";
import { CommentaryUnavailable, type CommentaryReader } from "../study/commentary";
import { TranslationsUnavailable, type TranslationsReader } from "../study/translations";
import { parseCompareVerse } from "../../lib/readings/compare";
import { parseSourceRef, type ShelfAnswer } from "../../lib/readings/shelf";
import { SourceTextUnavailable, type SourceTextReader } from "../study/source-text";
import { SourceMetadataUnavailable } from "../study/sources/metadata";

/**
 * Signed-out reading routes. A strict allowlist under /api/public/: GET only, a
 * closed canonical query, no body. Handlers never read cookies or Authorization,
 * never resolve a session and never set a cookie; the only tenant fact used is
 * the exact host mapping, which must be CRC. Responses are the same for every
 * caller, so the CDN may keep them. No audio bytes are served here: PocketTorah
 * clips stay on the existing content-addressed /reference-audio/short-v1 route.
 * A passage is a Shabbat date or a canonical reading ref (reading-ref.ts), checked before any
 * runtime opens. Every response asks search engines not to index.
 */
export type PublicRuntime = Readonly<{
  /** Exact host → tenant; refuses (404) anything that is not CRC. Reads tenant_host only. */
  resolveTenant(request: Request): Promise<void>;
  reading: PublicReadingService;
  /** One registered commentary on one Torah or Nevi'im chapter, from public transport only. */
  commentary: CommentaryReader;
  /** Compare: one verse's English translations and its Targum, from public transport only. */
  translations: TranslationsReader;
  /** More on this verse: Sefaria's links for one verse, grouped and curated (public transport only). */
  shelf(verse: string, signal?: AbortSignal): Promise<ShelfAnswer>;
  /** One shelf item's text in Sefaria's default editions. */
  source: SourceTextReader;
}>;
export type PublicRuntimeScope = (action: (runtime: PublicRuntime) => Promise<Response>) => Promise<Response>;

/**
 * Each route lists the keysets it accepts; a query must match exactly one, in its order. A passage is
 * named by a Shabbat `date` (the weekly page) or, for "Any reading", by a canonical `ref` with its
 * `kind` (the 1.5 offline packer depends on these exact shapes).
 */
type Route = Readonly<{ kind: "reading" | "text" | "word-aids" | "word-details" | "short" | "commentary" | "translations" | "related" | "source"; keysets: readonly (readonly string[])[] }>;
const exact: Readonly<Record<string, Route>> = Object.freeze({
  "/api/public/reading": { kind: "reading", keysets: [["date"], ["ref", "kind"]] },
  "/api/public/text": { kind: "text", keysets: [["date", "kind", "offset"], ["ref", "kind", "offset"]] },
  "/api/public/word-aids": { kind: "word-aids", keysets: [["date", "kind", "verse"], ["ref", "kind", "verse"]] },
  "/api/public/word-details": { kind: "word-details", keysets: [["date", "kind", "verse", "word"], ["ref", "kind", "verse", "word"]] },
  "/api/public/reference/short": { kind: "short", keysets: [["date", "kind", "offset"], ["ref", "kind", "offset"]] },
  "/api/public/commentary": { kind: "commentary", keysets: [["work", "chapter"]] },
  "/api/public/translations": { kind: "translations", keysets: [["verse"]] },
  "/api/public/related": { kind: "related", keysets: [["verse"]] },
  "/api/public/source": { kind: "source", keysets: [["ref"]] },
});
/** Longest decoded value per key; a `ref` is bounded by READING_REF_LIMITS.chars, everything else by 80. */
const valueLimit = (key: string) => key === "ref" ? READING_REF_LIMITS.chars : 80; // a source ref is bounded tighter (256 bytes) by its own check
function route(pathname: string): Route | null {
  return Object.hasOwn(exact, pathname) ? exact[pathname] : null;
}
/** The exact public allowlist, for the dispatcher and the isolated browser server. */
export const publicReadingRouteMethods = (pathname: string): readonly string[] | null => route(pathname) ? ["GET"] : null;
export const isPublicReadingPath = (pathname: string) => pathname === "/api/public" || pathname.startsWith("/api/public/");

const common = { "x-robots-tag": "noindex, nofollow", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" } as const;
const messages = { 400: "invalid-request", 404: "not-found", 405: "method-not-allowed", 503: "unavailable" } as const;
function failure(status: keyof typeof messages): Response {
  const headers = new Headers({ ...common, "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "vercel-cdn-cache-control": "no-store" });
  if (status === 405) headers.set("allow", "GET");
  return new Response(JSON.stringify({ error: messages[status] }), { status, headers });
}
/** 404 for an answer that cannot change soon: briefly cacheable, unlike every other failure. */
function definiteNotFound(): Response {
  return new Response(JSON.stringify({ error: messages[404] }), { status: 404, headers: { ...common, "content-type": "application/json; charset=utf-8",
    "cache-control": "public, max-age=300", "vercel-cdn-cache-control": "public, s-maxage=3600" } });
}
function json(value: JsonValue, cdnSeconds: number): Response {
  const body = JSON.stringify(value);
  if (Buffer.byteLength(body) > 2 * 1024 * 1024) return failure(503);
  return new Response(body, { status: 200, headers: { ...common, "content-type": "application/json; charset=utf-8",
    "cache-control": "public, max-age=300", "vercel-cdn-cache-control": `public, s-maxage=${cdnSeconds}` } });
}
function statusOf(error: unknown): keyof typeof messages {
  try {
    if (error instanceof PublicReadingUnavailable) return error.code === "not-found" ? 404 : error.code === "invalid-request" ? 400 : 503;
    if (error instanceof CommentaryUnavailable) return error.code === "invalid-request" ? 400 : 503;
    if (error instanceof TranslationsUnavailable) return error.code === "invalid-request" ? 400 : 503;
    if (error instanceof SourceTextUnavailable) return error.code === "invalid-request" ? 400 : error.code === "not-found" || error.code === "unsupported" ? 404 : 503;
    if (error instanceof SourceMetadataUnavailable) return 503;
    if (error instanceof HttpBoundaryError) return error.status === 404 ? 404 : error.status === 405 ? 405 : 400;
    if (error instanceof AccessDenied) return 404;
  } catch { /* Hostile accessors never shape a response. */ }
  return 503;
}
/** One accepted keyset, every key present once, nothing else, in that fixed order: one URL per resource. */
function canonical(url: URL, keysets: readonly (readonly string[])[]): Record<string, string> {
  const values: Record<string, string> = Object.create(null);
  const seen = [...url.searchParams.keys()];
  const keys = keysets.find(set => seen.length === set.length && seen.every((key, i) => key === set[i]));
  if (!keys) throw new HttpBoundaryError();
  for (const key of keys) {
    const value = url.searchParams.get(key);
    if (value === null || value.length > valueLimit(key) || /[\u0000-\u001f\u007f]/.test(value)) throw new HttpBoundaryError();
    values[key] = value;
  }
  const rebuilt = new URLSearchParams(keys.map(key => [key, values[key]])).toString();
  if (url.search !== (rebuilt ? `?${rebuilt}` : "")) throw new HttpBoundaryError();
  return values;
}
const kindOf = (value: string): PublicKind => { if (value !== "torah" && value !== "haftarah") throw new HttpBoundaryError(); return value; };
/** The passage shape both reading forms serve (`PublicPassage`), so the 1.5 packer and the page parse one thing. */
const passageView = (value: PublicPassage): JsonValue => ({ kind: value.kind, ranges: [...value.ranges], verseCount: value.verseCount,
  pages: value.pages.map(page => ({ offset: page.offset, first: page.first, last: page.last })) });
/** The key that named the passage, echoed in the body in the position `date` always had. */
const selector = (query: Record<string, string>): { date: string } | { ref: string } => query.ref !== undefined ? { ref: query.ref } : { date: query.date };
const count = (value: string): number => { if (!/^(?:0|[1-9]\d{0,3})$/.test(value)) throw new HttpBoundaryError(); return Number(value); };

export async function handlePublicReadingRequest(request: Request, withPublic: PublicRuntimeScope): Promise<Response> {
  try {
    if (request.url.length > 2048) return failure(400);
    const url = new URL(request.url), selected = route(url.pathname);
    if (!selected) return failure(404);
    if (request.method !== "GET") return failure(405);
    // The page never sends Authorization or Range; refusing them keeps every answer CDN-cacheable.
    if (url.username || url.password || url.hash || request.headers.has("transfer-encoding") || request.headers.has("authorization")
      || request.headers.has("range") || request.headers.has("if-range") || request.headers.has("content-length") && request.headers.get("content-length") !== "0") return failure(400);
    const query = canonical(url, selected.keysets), signal = request.signal;
    // Cheap checks first: a bad date, ref, kind, number, work or chapter never opens the database.
    // Every route but commentary and translations is keyed by a date or a ref, and those always check it.
    if (query.date !== undefined && publicShabbat(query.date) === null || selected.kind === "commentary" && parseCommentaryChapter(query.work, query.chapter) === null
      || (selected.kind === "translations" || selected.kind === "related") && parseCompareVerse(query.verse) === null
      || selected.kind === "source" && parseSourceRef(query.ref) === null
      || query.kind !== undefined && query.kind !== "torah" && query.kind !== "haftarah"
      || query.ref !== undefined && selected.kind !== "source" && canonicalReadingRef(query.ref, query.kind) === null
      || [query.offset, selected.kind === "translations" || selected.kind === "related" ? undefined : query.verse, query.word].some(value => value !== undefined && !/^(?:0|[1-9]\d{0,3})$/.test(value))) return failure(400);
    const ref = query.ref;
    return await withPublic(async runtime => {
      try {
        await runtime.resolveTenant(request);
        const reading = runtime.reading;
        switch (selected.kind) {
          case "reading": {
            if (ref !== undefined) {
              // Computed locally from the canonical ref: the same passage shape and paging as a week's.
              const named = reading.readingByRef(kindOf(query.kind), ref);
              return json({ ref: named.ref, kind: named.kind, passage: passageView(named.passage), listening: { pocketTorah: named.listening.pocketTorah } }, 3600);
            }
            const week = await reading.week(query.date, signal);
            return json({ date: week.date, parashah: week.parashah, torah: week.torah && passageView(week.torah), haftarah: week.haftarah && passageView(week.haftarah),
              fetchedAt: week.fetchedAt, listening: { pocketTorah: week.listening.pocketTorah } }, 3600);
          }
          // Every page body below is the weekly one with `ref` in place of `date`.
          case "text": {
            const kind = kindOf(query.kind), offset = count(query.offset);
            const page = ref !== undefined ? await reading.textByRef(kind, ref, offset, signal) : await reading.text(kind, query.date, offset, signal);
            return json({ kind: query.kind, ...selector(query), ...studyPageView(page) }, 86400);
          }
          case "word-aids": {
            const kind = kindOf(query.kind), verse = count(query.verse);
            const aids = ref !== undefined ? await reading.wordAidsByRef(kind, ref, verse, signal) : await reading.wordAids(kind, query.date, verse, signal);
            return json({ kind: query.kind, ...selector(query), verse: Number(query.verse), wordAids: wordAidsView(aids) }, 86400);
          }
          case "word-details": {
            const kind = kindOf(query.kind), verse = count(query.verse), word = count(query.word);
            const details = ref !== undefined ? await reading.wordDetailsByRef(kind, ref, verse, word, signal) : await reading.wordDetails(kind, query.date, verse, word, signal);
            const body = { kind: query.kind, ...selector(query), verse: Number(query.verse), wordDetails: wordDetailsView(details) };
            return json(body, 86400);
          }
          case "short": {
            const kind = kindOf(query.kind), offset = count(query.offset);
            const page = ref !== undefined ? await reading.shortReferencesByRef(kind, ref, offset, signal) : await reading.shortReferences(kind, query.date, offset, signal);
            return json({ kind: query.kind, ...selector(query), page: { offset: page.offset, nextOffset: page.nextOffset, totalVerses: page.totalVerses,
              references: page.references as unknown as JsonValue[] } }, 86400);
          }
          case "commentary": {
            // A pinned edition does not change: the CDN may keep a chapter for thirty days. A chapter Sefaria says it has
            // no text for is kept a day; an answer with no edition at all may be a momentary gap upstream, so an hour only.
            const chapter = await runtime.commentary(query.work, query.chapter, signal);
            return json({ work: chapter.work, chapter: chapter.chapter, verses: chapter.verses as unknown as JsonValue, editions: chapter.editions as unknown as JsonValue[] },
              chapter.editions.length ? 2592000 : chapter.absent ? 86400 : 3600);
          }
          case "translations": {
            // Thirty days when both halves answered; an hour when one side was missing, so it is asked again soon.
            const result = await runtime.translations(query.verse, signal);
            return json(result.answer as unknown as JsonValue, result.complete ? 2592000 : 3600);
          }
          case "related": {
            // A verse's links change slowly: the CDN keeps the shelf a week.
            const shelf = await runtime.shelf(query.verse, signal);
            return json(shelf as unknown as JsonValue, 604800);
          }
          case "source": {
            let text;
            try { text = await runtime.source(query.ref, signal); }
            catch (error) {
              // A definite "this page will never show that" (Sefaria's own "no text", or a text too deep, large or
              // renamed) is kept an hour, so repeated requests for it stop at the CDN; any other failure is not kept.
              if (error instanceof SourceTextUnavailable && error.code === "unsupported") return definiteNotFound();
              throw error;
            }
            return json(text as unknown as JsonValue, 2592000);
          }
        }
      } catch (error) { return failure(statusOf(error)); }
    });
  } catch (error) { return failure(statusOf(error)); }
}
