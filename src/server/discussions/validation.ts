import { HIDDEN, markdown, plain, VERSE_REF } from "../study-guides/validation";
import { parseSourceRef } from "../../lib/readings/shelf";
import { NAMED_READINGS } from "../../lib/readings/named-readings";
import { TANAKH_VERSE_COUNTS } from "../../lib/readings/catalog";
import { canonicalReadingRef } from "../../lib/readings/reading-ref";
import { TORAH_BOOKS } from "../../lib/readings/ranges";

/**
 * Curated discussions (1.7 M6, spec 2026-10-24-curated-discussions-design): the shapes the MCP tools accept, closed. A
 * discussion is a title and its ordered sources, nothing else: no introduction, essay, summary or note field is accepted
 * anywhere, and an unknown key refuses the whole call. Translation text follows the guide prose rules exactly (the shared
 * `markdown` check: no links, no HTML, no hidden characters). The SQL CHECKs in migration 0042 hold the same bounds.
 */
export const DISCUSSION_LIMITS = Object.freeze({ titleBytes: 160, sources: 24, translationBytes: 16384, editionBytes: 300, slugBytes: 80 });
export type DiscussionKind = "torah" | "haftarah";
export type SourceInput = Readonly<{ ref: string; anchorRef: string } & ({ edition: string; translationId?: undefined } | { translationId: string; edition?: undefined })>;
export type DiscussionInput = Readonly<{ title: string; kind: DiscussionKind; sources: readonly SourceInput[] }>;
type Result<T> = { ok: true; value: T } | { ok: false; problems: string[] };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

let verseSets: Readonly<Record<DiscussionKind, ReadonlySet<string>>> | null = null;
/**
 * The verses a discussion of each kind may be anchored to: any verse of the Torah (every one belongs to a weekly portion), and
 * for the haftarah any verse inside a haftarah passage on the portal's reading list. Computed once from the shipped catalogs.
 */
export function anchorVerses(kind: DiscussionKind): ReadonlySet<string> {
  if (!verseSets) {
    const torah = new Set<string>(), haftarah = new Set<string>();
    for (const book of TORAH_BOOKS) (TANAKH_VERSE_COUNTS[book] ?? []).forEach((count, i) => { for (let v = 1; v <= count; v++) torah.add(`${book} ${i + 1}:${v}`); });
    for (const reading of NAMED_READINGS) for (const passage of reading.passages) {
      if (passage.kind !== "haftarah") continue;
      for (const verse of canonicalReadingRef(passage.ref, "haftarah")?.verses ?? []) haftarah.add(verse);
    }
    verseSets = Object.freeze({ torah, haftarah });
  }
  return verseSets[kind];
}

/** The verses a list or a public read covers: a named reading's passages, a canonical passage with its kind, or one verse. */
export function versesFor(selection: { reading?: { passages: readonly { kind: "torah" | "haftarah"; ref: string }[] }; ref?: string; kind?: DiscussionKind; verse?: string }): string[] {
  if (selection.verse !== undefined) return VERSE_REF.test(selection.verse) && (anchorVerses("torah").has(selection.verse) || anchorVerses("haftarah").has(selection.verse)) ? [selection.verse] : [];
  if (selection.reading) return [...new Set(selection.reading.passages.flatMap(passage => canonicalReadingRef(passage.ref, passage.kind)?.verses ?? []))];
  if (selection.ref !== undefined && selection.kind) return [...(canonicalReadingRef(selection.ref, selection.kind)?.verses ?? [])];
  return [];
}

/**
 * The selector's public name for "Selected by {name}" (Daniel, 2026-10-24: the person who selected the source), taken from
 * their account name when they select it and kept with the source: one plain line of at most 120 characters, never an
 * address. A name that fails reads "Portal member", as lesson logs and student work do.
 */
export function selectorName(raw: unknown): string {
  const value = typeof raw === "string" ? raw.normalize("NFC").replace(/\s+/g, " ").trim() : "";
  return value && plain(value, 480) && [...value].length <= 120 && !value.includes("@") ? value : "Portal member";
}

/** One plain line of at most 160 bytes, the same rule as the CHECK (portal_source_plain). */
export function validTitle(value: unknown): value is string {
  return plain(value, DISCUSSION_LIMITS.titleBytes);
}
/** A Sefaria version title, as the rabbi picked it: one plain line. */
export function validEdition(value: unknown): value is string {
  return plain(value, DISCUSSION_LIMITS.editionBytes) && !/\s{2}/.test(value);
}
/** A Sefaria citation the source reader can open (the shelf's own grammar, at most 256 bytes). */
export const validRef = (value: unknown): value is string => parseSourceRef(value) !== null && !HIDDEN.test(value as string);

function sourceOf(value: unknown, kind: DiscussionKind, problems: string[], where: string): SourceInput | null {
  if (!object(value)) { problems.push(`${where}: a source is { ref, anchorRef, edition } or { ref, anchorRef, translationId }`); return null; }
  const keys = Object.keys(value), allowed = ["ref", "anchorRef", "edition", "translationId"];
  const unknown = keys.filter(key => !allowed.includes(key));
  if (unknown.length) { problems.push(`${where}: only ref, anchorRef and one of edition or translationId; not ${unknown.join(", ")}`); return null; }
  const before = problems.length;
  if (!validRef(value.ref)) problems.push(`${where}.ref: a Sefaria citation such as "Rashi on Genesis 1:1:1"`);
  if (typeof value.anchorRef !== "string" || value.anchorRef.length > 100 || !VERSE_REF.test(value.anchorRef)) problems.push(`${where}.anchorRef: one verse, "Book C:V"`);
  else if (!anchorVerses(kind).has(value.anchorRef)) problems.push(`${where}.anchorRef: ${value.anchorRef} is not a verse of any ${kind === "torah" ? "Torah reading" : "haftarah on the reading list"}`);
  const hasEdition = Object.hasOwn(value, "edition"), hasTranslation = Object.hasOwn(value, "translationId");
  if (hasEdition === hasTranslation) problems.push(`${where}: exactly one of edition or translationId`);
  else if (hasEdition && !validEdition(value.edition)) problems.push(`${where}.edition: the Sefaria English version title, one plain line`);
  else if (hasTranslation && (typeof value.translationId !== "string" || !UUID.test(value.translationId))) problems.push(`${where}.translationId: an id from add_source_translation`);
  if (problems.length > before) return null;
  return Object.freeze(hasEdition ? { ref: value.ref as string, anchorRef: value.anchorRef as string, edition: value.edition as string }
    : { ref: value.ref as string, anchorRef: value.anchorRef as string, translationId: (value.translationId as string).toLowerCase() });
}

/** The ordered sources, 1 to 24, no source twice. */
export function validateSources(value: unknown, kind: DiscussionKind): Result<readonly SourceInput[]> {
  if (!Array.isArray(value) || value.length < 1 || value.length > DISCUSSION_LIMITS.sources) return { ok: false, problems: [`sources: 1 to ${DISCUSSION_LIMITS.sources}, in order`] };
  const problems: string[] = [], sources: SourceInput[] = [], seen = new Set<string>();
  value.forEach((item, i) => {
    const source = sourceOf(item, kind, problems, `sources[${i}]`);
    if (!source) return;
    const key = JSON.stringify([source.ref, source.edition ?? null, source.translationId ?? null]);
    if (seen.has(key)) problems.push(`sources[${i}]: the same source twice`); else seen.add(key);
    sources.push(source);
  });
  return problems.length ? { ok: false, problems } : { ok: true, value: Object.freeze(sources) };
}

export function validateDiscussion(value: Record<string, unknown>): Result<DiscussionInput> {
  const allowed = ["title", "kind", "sources"], unknown = Object.keys(value).filter(key => !allowed.includes(key));
  if (unknown.length) return { ok: false, problems: [`A discussion is a title and its sources only; not ${unknown.join(", ")}`] };
  const problems: string[] = [];
  if (!validTitle(value.title)) problems.push(`title: one plain line of at most ${DISCUSSION_LIMITS.titleBytes} bytes, the question or theme`);
  if (value.kind !== "torah" && value.kind !== "haftarah") return { ok: false, problems: [...problems, "kind: torah or haftarah"] };
  const sources = validateSources(value.sources, value.kind);
  if (!sources.ok) problems.push(...sources.problems);
  return problems.length || !sources.ok ? { ok: false, problems } : { ok: true, value: Object.freeze({ title: value.title as string, kind: value.kind, sources: sources.value }) };
}

/** A Claude translation's text: the guide prose rules exactly, at most 16 KB. */
export function validateTranslationBody(value: unknown): Result<string> {
  const problems: string[] = [];
  return markdown(value, DISCUSSION_LIMITS.translationBytes, problems, "body") ? { ok: true, value } : { ok: false, problems };
}

/** A slug from the title: lowercase ASCII words, at most 60 bytes, never empty ("discussion" when nothing is left). */
export function slugBase(title: string): string {
  const base = title.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const cut = base.slice(0, 60).replace(/-+$/g, "");
  return cut || "discussion";
}

