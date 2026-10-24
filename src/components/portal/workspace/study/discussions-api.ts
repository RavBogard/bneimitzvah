import { PortalRequestError } from "../../api";
import { getJson } from "../../public-reading/api";
import { canonicalReadingRef } from "../../../../lib/readings/reading-ref";
import { parseSourceRef, sourceSefariaUrl } from "../../../../lib/readings/shelf";
import { plainCredit } from "../../../../lib/readings/edition-credit";
import type { Discussion, DiscussionSource, DiscussionText, DiscussionsAnswer } from "../../../../lib/discussions/answer";
import { parseSourceText } from "./shelf-api";

/**
 * Curated discussions in the browser: one same-origin GET to /api/public/discussions (no cookie, no Authorization, the same
 * answer signed in or out), parsed strictly. Links are recomputed here and must match the route's, and every title, credit and
 * name is plain text. A source's text that does not parse is treated as Sefaria not having given it: the source is kept, its
 * text is not. Anything else wrong with the answer is a failure, and a failure shows nothing.
 */
export type DiscussionPassage = Readonly<{ ref: string; kind: "torah" | "haftarah" }>;
export const DISCUSSIONS_BYTES = 2 * 1024 * 1024;
export const discussionsPath = (passage: DiscussionPassage) => `/api/public/discussions?${new URLSearchParams([["ref", passage.ref], ["kind", passage.kind]]).toString()}`;

const bad = (): never => { throw new PortalRequestError(503); };
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : bad();
const plain = (value: unknown, max: number): string => { const text = plainCredit(value, max); return text !== null && text === value ? text : bad(); };
const VERSE = /^[1-3A-Za-z][A-Za-z ]* [1-9]\d*:[1-9]\d*$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function textOf(value: unknown, ref: string): DiscussionText | null {
  if (value === null) return null;
  try {
    const row = object(value), parsed = parseSourceText({ ref, sefariaUrl: sourceSefariaUrl(ref), segments: row.segments, editions: row.editions }, ref);
    return Object.freeze({ segments: parsed.segments, editions: parsed.editions });
  } catch { return null; }
}

function source(value: unknown): DiscussionSource {
  const row = object(value), ref = row.ref, anchor = row.anchorRef;
  if (typeof ref !== "string" || parseSourceRef(ref) !== ref || typeof anchor !== "string" || !VERSE.test(anchor) || !Number.isSafeInteger(row.position) || Number(row.position) < 1 || Number(row.position) > 24) return bad();
  const shared = { position: Number(row.position), ref, anchorRef: anchor, selectedBy: plain(object(row.details).selectedBy, 200), text: textOf(row.text, ref) };
  if (row.kind === "edition") {
    const edition = plain(row.edition, 300);
    if (row.sefariaUrl !== sourceSefariaUrl(ref, { language: "en", title: edition }) || row.credit !== null && typeof row.credit !== "string") return bad();
    return Object.freeze({ ...shared, kind: "edition" as const, edition, credit: row.credit === null ? null : plain(row.credit, 500), sefariaUrl: row.sefariaUrl as string });
  }
  if (row.kind !== "translation") return bad();
  const translation = object(row.translation), original = plain(translation.originalEdition, 300);
  if (typeof translation.body !== "string" || translation.body.length > 16 * 1024 || row.sefariaUrl !== sourceSefariaUrl(ref, { language: "he", title: original })) return bad();
  return Object.freeze({ ...shared, kind: "translation" as const, translation: Object.freeze({ body: translation.body, originalEdition: original }), sefariaUrl: row.sefariaUrl as string });
}

export function parseDiscussionsAnswer(value: unknown, passage: DiscussionPassage): DiscussionsAnswer {
  const row = object(value);
  if (row.ref !== passage.ref || row.kind !== passage.kind || typeof row.complete !== "boolean" || !Array.isArray(row.discussions) || row.discussions.length > 8) return bad();
  const productName = row.productName === null ? null : plain(row.productName, 120);
  const discussions = row.discussions.map((raw): Discussion => {
    const item = object(raw);
    if (typeof item.slug !== "string" || !SLUG.test(item.slug) || item.kind !== passage.kind || !Array.isArray(item.sources) || !item.sources.length || item.sources.length > 24 || !Array.isArray(item.anchors)) return bad();
    const sources = item.sources.map(source);
    return Object.freeze({ slug: item.slug, title: plain(item.title, 200), kind: passage.kind, sources: Object.freeze(sources),
      anchors: Object.freeze(item.anchors.map(anchor => typeof anchor === "string" && VERSE.test(anchor) && sources.some(entry => entry.anchorRef === anchor) ? anchor : bad())) });
  });
  if (new Set(discussions.map(item => item.slug)).size !== discussions.length || discussions.length > 0 && productName === null) return bad();
  return Object.freeze({ discussions: Object.freeze(discussions), productName, complete: row.complete });
}

/** The discussions for a passage, or a rejection (any failure: the reader shows nothing). */
export async function fetchDiscussions(passage: DiscussionPassage, signal: AbortSignal): Promise<DiscussionsAnswer> {
  if (!canonicalReadingRef(passage.ref, passage.kind)) throw new PortalRequestError(400);
  return parseDiscussionsAnswer(await getJson(discussionsPath(passage), DISCUSSIONS_BYTES, signal), passage);
}
