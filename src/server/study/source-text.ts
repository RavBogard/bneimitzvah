import "server-only";
import type { CommentaryComment, CommentaryRun } from "../../lib/readings/commentary";
import { creditLine, EDITION_TEXT_LIMITS, licenseLabel, plainCredit } from "../../lib/readings/edition-credit";
import { parseSourceRef, sourceSefariaUrl } from "../../lib/readings/shelf";
import { sefariaRuns } from "./sefaria-runs";
import { fetchSefariaJson, SEFARIA_ORIGIN } from "./sefaria-json";

/**
 * One shelf item's text (`/api/public/source?ref=`): a bounded proxy of a public Sefaria text in Sefaria's
 * default Hebrew and English editions (hundreds of works: nothing pinned), each credited from what Sefaria
 * returns. A string is one segment, an array of up to 64 strings a section or range; anything deeper, larger
 * or empty is "unsupported" and the page offers Sefaria instead. Sefaria's 404 or 400 is "not found".
 */
export class SourceTextUnavailable extends Error {
  constructor(readonly code: "invalid-request" | "not-found" | "upstream") { super("Source text unavailable"); this.name = "SourceTextUnavailable"; }
}
export type SourceTextEdition = Readonly<{ language: "he" | "en"; title: string; license: string; licenseLabel: string; credit: string; url: string }>;
export type SourceText = Readonly<{ ref: string; sefariaUrl: string; segments: readonly CommentaryComment[]; editions: readonly SourceTextEdition[] }>;
export type SourceTextReader = (ref: string, signal?: AbortSignal) => Promise<SourceText>;
export const SOURCE_TEXT_LIMITS = Object.freeze({ segments: 64, responseBytes: 256 * 1024, upstreamBytes: 1024 * 1024, requestMs: 5000, versions: 8 });
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const upstream = (): never => { throw new SourceTextUnavailable("upstream"); };
const unsupported = (): never => { throw new SourceTextUnavailable("not-found"); };

/** A version's text as segments: null when this language has none here. */
function segmentsOf(text: unknown): readonly string[] | null {
  if (typeof text === "string") return [text];
  if (!Array.isArray(text)) return upstream();
  if (text.some(Array.isArray)) return unsupported(); // a chapter of comments or deeper: open it on Sefaria
  if (text.length > SOURCE_TEXT_LIMITS.segments) return unsupported();
  if (!text.every(item => typeof item === "string")) return upstream();
  return text as string[];
}
export function projectSourceText(payload: unknown, ref: string): SourceText {
  if (object(payload) && typeof payload.ref === "string" && payload.ref !== ref) return unsupported(); // Sefaria renamed it: open its own page
  if (!object(payload) || payload.ref !== ref || !Array.isArray(payload.versions) || payload.versions.length > SOURCE_TEXT_LIMITS.versions
    || payload.warnings !== undefined && !Array.isArray(payload.warnings)) return upstream();
  // Only "this language isn't here" warnings, and only for the two languages asked for.
  for (const warning of (payload.warnings ?? []) as unknown[]) {
    if (!object(warning) || Object.keys(warning).length !== 1) return upstream();
    const [key] = Object.keys(warning), detail = warning[key];
    if (key !== "hebrew" && key !== "english" || !object(detail) || ![101, 102, 103, 104].includes(detail.warning_code as number)) return upstream();
  }
  const picked: Partial<Record<"he" | "en", { title: string; license: string; segments: readonly string[] }>> = {};
  for (const version of payload.versions as unknown[]) {
    if (!object(version) || version.language !== "he" && version.language !== "en" || version.actualLanguage !== version.language) return upstream();
    const language = version.language as "he" | "en";
    if (picked[language]) continue; // Sefaria's default edition is the first
    const title = plainCredit(version.versionTitle, EDITION_TEXT_LIMITS.title);
    if (!title) return upstream();
    const segments = segmentsOf(version.text);
    if (segments) picked[language] = { title, license: plainCredit(version.license, EDITION_TEXT_LIMITS.license) ?? "", segments };
  }
  const runs = (text: string | undefined): readonly CommentaryRun[] => {
    if (text === undefined) return [];
    // Bounded per segment by the commentary limits (64 KiB, 400 runs); a segment past them is opened on Sefaria.
    try { return Object.freeze(sefariaRuns(text)); } catch { return unsupported(); }
  };
  const he = picked.he?.segments ?? [], en = picked.en?.segments ?? [], segments: CommentaryComment[] = [];
  for (let i = 0; i < Math.max(he.length, en.length); i++) {
    const hebrew = runs(he[i]), english = runs(en[i]);
    if (hebrew.length || english.length) segments.push(Object.freeze({ hebrew: hebrew.length ? hebrew : null, english: english.length ? english : null }));
  }
  if (!segments.length) return unsupported();
  const used = (language: "he" | "en") => segments.some(segment => language === "he" ? segment.hebrew : segment.english);
  const editions = (["he", "en"] as const).flatMap(language => {
    const edition = picked[language];
    return edition && used(language) ? [Object.freeze({ language, title: edition.title, license: edition.license, licenseLabel: licenseLabel(edition.license),
      credit: creditLine(edition.title, edition.license), url: sourceSefariaUrl(ref, { language, title: edition.title }) })] : [];
  });
  const answer: SourceText = Object.freeze({ ref, sefariaUrl: sourceSefariaUrl(ref), segments: Object.freeze(segments), editions: Object.freeze(editions) });
  if (Buffer.byteLength(JSON.stringify(answer)) > SOURCE_TEXT_LIMITS.responseBytes) return unsupported();
  return answer;
}
export function createSefariaSourceReader(input: { fetch: typeof globalThis.fetch }): SourceTextReader {
  return async function read(value: string, signal?: AbortSignal): Promise<SourceText> {
    const ref = parseSourceRef(value);
    if (!ref) throw new SourceTextUnavailable("invalid-request");
    const url = new URL(`${SEFARIA_ORIGIN}/api/v3/texts/${encodeURIComponent(ref)}`);
    url.searchParams.append("version", "hebrew"); url.searchParams.append("version", "english");
    url.searchParams.set("fill_in_missing_segments", "0"); url.searchParams.set("return_format", "default");
    let row: Readonly<{ status: number; json: unknown }>;
    try { row = await fetchSefariaJson(input.fetch, url, { deadlineMs: SOURCE_TEXT_LIMITS.requestMs, maxBytes: SOURCE_TEXT_LIMITS.upstreamBytes }, signal); }
    catch { throw new SourceTextUnavailable("upstream"); }
    if (row.status === 404 || row.status === 400) throw new SourceTextUnavailable("not-found");
    if (row.status !== 200) throw new SourceTextUnavailable("upstream");
    return projectSourceText(row.json, ref);
  };
}
