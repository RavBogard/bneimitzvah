import "server-only";
import { AccessDenied } from "../access/errors";
import { PublicReadingUnavailable, type PublicKind, type PublicReadingService } from "../public-reading/service";
import { HttpBoundaryError, type JsonValue } from "./responses";
import { publicShabbat } from "../../lib/readings/public-shabbat";
import { studyPageView, wordAidsView, wordDetailsView } from "./portal";
import { parseCommentaryChapter } from "../../lib/readings/commentary";
import { CommentaryUnavailable, type CommentaryReader } from "../study/commentary";

/**
 * Signed-out reading routes. A strict allowlist under /api/public/: GET only, a
 * closed canonical query, no body. Handlers never read cookies or Authorization,
 * never resolve a session and never set a cookie; the only tenant fact used is
 * the exact host mapping, which must be CRC. Responses are the same for every
 * caller, so the CDN may keep them. No audio bytes are served here: PocketTorah
 * clips stay on the existing content-addressed /reference-audio/short-v1 route.
 * Every response asks search engines not to index.
 */
export type PublicRuntime = Readonly<{
  /** Exact host → tenant; refuses (404) anything that is not CRC. Reads tenant_host only. */
  resolveTenant(request: Request): Promise<void>;
  reading: PublicReadingService;
  /** One registered commentary on one Torah or Nevi'im chapter, from public transport only. */
  commentary: CommentaryReader;
}>;
export type PublicRuntimeScope = (action: (runtime: PublicRuntime) => Promise<Response>) => Promise<Response>;

type Route = Readonly<{ kind: "reading" | "text" | "word-aids" | "word-details" | "short" | "commentary"; keys: readonly string[] }>;
const exact: Readonly<Record<string, Route>> = Object.freeze({
  "/api/public/reading": { kind: "reading", keys: ["date"] },
  "/api/public/text": { kind: "text", keys: ["date", "kind", "offset"] },
  "/api/public/word-aids": { kind: "word-aids", keys: ["date", "kind", "verse"] },
  "/api/public/word-details": { kind: "word-details", keys: ["date", "kind", "verse", "word"] },
  "/api/public/reference/short": { kind: "short", keys: ["date", "kind", "offset"] },
  "/api/public/commentary": { kind: "commentary", keys: ["work", "chapter"] },
});
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
    if (error instanceof HttpBoundaryError) return error.status === 404 ? 404 : error.status === 405 ? 405 : 400;
    if (error instanceof AccessDenied) return 404;
  } catch { /* Hostile accessors never shape a response. */ }
  return 503;
}
/** All keys present once, nothing else, in one fixed order: one URL per resource. */
function canonical(url: URL, keys: readonly string[]): Record<string, string> {
  const values: Record<string, string> = Object.create(null);
  const seen = [...url.searchParams.keys()];
  if (seen.length !== keys.length || seen.some((key, i) => key !== keys[i])) throw new HttpBoundaryError();
  for (const key of keys) {
    const value = url.searchParams.get(key);
    if (value === null || value.length > 80 || /[\u0000-\u001f\u007f]/.test(value)) throw new HttpBoundaryError();
    values[key] = value;
  }
  const rebuilt = new URLSearchParams(keys.map(key => [key, values[key]])).toString();
  if (url.search !== (rebuilt ? `?${rebuilt}` : "")) throw new HttpBoundaryError();
  return values;
}
const kindOf = (value: string): PublicKind => { if (value !== "torah" && value !== "haftarah") throw new HttpBoundaryError(); return value; };
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
    const query = canonical(url, selected.keys), signal = request.signal;
    // Cheap checks first: a bad date, kind, number, work or chapter never opens the database.
    // Every route but commentary is keyed by a date, and those always check it.
    if (selected.keys.includes("date") && publicShabbat(query.date) === null || selected.kind === "commentary" && parseCommentaryChapter(query.work, query.chapter) === null
      || query.kind !== undefined && query.kind !== "torah" && query.kind !== "haftarah"
      || [query.offset, query.verse, query.word].some(value => value !== undefined && !/^(?:0|[1-9]\d{0,3})$/.test(value))) return failure(400);
    return await withPublic(async runtime => {
      try {
        await runtime.resolveTenant(request);
        const reading = runtime.reading;
        switch (selected.kind) {
          case "reading": {
            const week = await reading.week(query.date, signal);
            const passage = (value: typeof week.torah) => value && { kind: value.kind, ranges: [...value.ranges], verseCount: value.verseCount,
              pages: value.pages.map(page => ({ offset: page.offset, first: page.first, last: page.last })) };
            return json({ date: week.date, parashah: week.parashah, torah: passage(week.torah), haftarah: passage(week.haftarah), fetchedAt: week.fetchedAt,
              listening: { pocketTorah: week.listening.pocketTorah } }, 3600);
          }
          case "text": {
            const page = await reading.text(kindOf(query.kind), query.date, count(query.offset), signal);
            return json({ kind: query.kind, date: query.date, ...studyPageView(page) }, 86400);
          }
          case "word-aids": {
            const aids = await reading.wordAids(kindOf(query.kind), query.date, count(query.verse), signal);
            return json({ kind: query.kind, date: query.date, verse: Number(query.verse), wordAids: wordAidsView(aids) }, 86400);
          }
          case "word-details": {
            const details = await reading.wordDetails(kindOf(query.kind), query.date, count(query.verse), count(query.word), signal);
            const body = { kind: query.kind, date: query.date, verse: Number(query.verse), wordDetails: wordDetailsView(details) };
            return json(body, 86400);
          }
          case "short": {
            const page = await reading.shortReferences(kindOf(query.kind), query.date, count(query.offset), signal);
            return json({ kind: query.kind, date: query.date, page: { offset: page.offset, nextOffset: page.nextOffset, totalVerses: page.totalVerses,
              references: page.references as unknown as JsonValue[] } }, 86400);
          }
          case "commentary": {
            // A pinned edition does not change: the CDN may keep a chapter for thirty days. An answer with no
            // edition at all may be a momentary gap upstream, so it is kept for an hour only.
            const chapter = await runtime.commentary(query.work, query.chapter, signal);
            return json({ work: chapter.work, chapter: chapter.chapter, verses: chapter.verses as unknown as JsonValue, editions: chapter.editions as unknown as JsonValue[] },
              chapter.editions.length ? 2592000 : 3600);
          }
        }
      } catch (error) { return failure(statusOf(error)); }
    });
  } catch (error) { return failure(statusOf(error)); }
}
