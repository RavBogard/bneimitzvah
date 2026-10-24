import "server-only";
import { createHash } from "node:crypto";
import { parseBoundedServiceJson } from "../service-learning/feed";
import { SERVICE_TEXT_LIMITS, type ServiceText, type TextLine } from "../../lib/service-course/text";
import { COURSE_TEXT_PIN_KEYS, PUBLIC_COURSE_CREDIT, PUBLIC_COURSE_VOLUMES, REFUSED_COURSE_UNIT, type CourseTextPins } from "./pin";

/**
 * The service course's reader of a PUBLIC volume's feed (2.0 SC2, A4 5.4: a fork of src/server/service-learning/feed.ts,
 * which accepts only the licensed Beit Mitzvah volume and drops transliteration). This one is its mirror image: it accepts
 * only a public volume from the public lane and keeps `tr`. The bounded pre-parse scanner is the same function.
 *
 * What it refuses, atomically (one constant error, never the input): bytes whose hash is not the pin; a pin or feed naming a
 * volume that is not a public course volume (so `legacy-beit-mitzvah` and every `legacy-*` or `crc-*` book); a build whose
 * printing says any lane but "public", or whose source sha is a `-LICENSED` one; an artifact that is not the volume's own
 * public artifact (so `dist-app` never); a licence other than the public volume's; and any key or block shape it does not
 * know. The Mi Shebeirach is dropped at parse and never projected (A2 discrepancy 13). Only lines of Hebrew, with their
 * transliteration and English, leave this module: no footnote, folio, page or rubric.
 */
export class CourseTextInvalid extends Error {
  constructor() { super("Course text unavailable"); this.name = "CourseTextInvalid"; }
}
const invalid = (): never => { throw new CourseTextInvalid(); };
export const COURSE_FEED_LIMITS = Object.freeze({ feedBytes: 2_097_152, units: 256, blocksPerUnit: 256, blocks: 8_192, string: 16_384 });
export type PublicCourseFeed = Readonly<{ identity: string; volume: string; sourceGitSha: string; units: ReadonlyMap<string, readonly TextLine[]>; front: readonly TextLine[] }>;

const own = (value: object, key: string) => Object.hasOwn(value, key);
function object(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  const out = value as Record<string, unknown>;
  if (required.some(key => !own(out, key)) || Object.keys(out).some(key => !required.includes(key) && !optional.includes(key))) return invalid();
  return out;
}
const string = (value: unknown, nonempty = false): string => typeof value !== "string" || value.length > COURSE_FEED_LIMITS.string || (nonempty && !value.length) || !value.isWellFormed() ? invalid() : value;
const array = (value: unknown, max: number, min = 0): unknown[] => !Array.isArray(value) || value.length < min || value.length > max ? invalid() : value;
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** Every pin, exactly: the eight keys, each well formed, and nothing that names a licensed lane, volume or artifact. */
export function checkCourseTextPins(pins: unknown): CourseTextPins {
  const value = object(pins, COURSE_TEXT_PIN_KEYS);
  const v = (key: (typeof COURSE_TEXT_PIN_KEYS)[number]) => string(value[key], true);
  const volume = v("volume"), commit = v("artifactCommit"), source = v("sourceGitSha");
  if (v("lane") !== "public" || !PUBLIC_COURSE_VOLUMES.includes(volume) || /^(?:legacy|crc)-/.test(volume)) return invalid();
  if (!/^[a-f0-9]{64}$/.test(v("feedSha256")) || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(v("artifactRepo")) || !/^[a-f0-9]{40}$/.test(commit) || !/^[1-9]\d{0,19}$/.test(v("artifactRunId"))) return invalid();
  // A public build's source sha is the commit's short form, never a "-LICENSED" one; its artifact is the volume's own, never dist-app.
  if (!/^[a-f0-9]{7,40}$/.test(source) || !commit.startsWith(source) || v("artifactName") !== `${volume}-${commit.slice(0, 7)}`) return invalid();
  return Object.freeze({ volume, lane: "public", feedSha256: v("feedSha256"), artifactRepo: v("artifactRepo"), artifactCommit: commit, artifactRunId: v("artifactRunId"), artifactName: v("artifactName"), sourceGitSha: source });
}
/** The stored row's identity: the pinned feed hash and its volume, so one row per public build. */
export const courseTextIdentity = (pins: Pick<CourseTextPins, "feedSha256" | "volume">) => createHash("sha256").update(`course-text-v1\0${pins.volume}\0${pins.feedSha256}`).digest("hex");

const BLOCK_TYPES = ["stanza", "trope", "english", "rubric", "chatimah", "seasonal", "display"];
const LINE_TYPES = ["stanza", "trope", "chatimah", "seasonal", "display"];
const BLOCK_KEYS = ["he", "bare", "tr", "en", "text", "footnote", "translates", "role", "label", "verse", "cue", "occasion", "gold", "folio", "phys", "marks"];
const HEBREW_LETTER = /[\u05D0-\u05EA]/;
type Spans = readonly unknown[];
/** A span list's plain text; footnotes are left out. */
function spanText(value: unknown, depth = 0): string {
  if (depth > 6) return invalid();
  return array(value, 512).map(raw => {
    const entry = object(raw, [], ["t", "em", "strong", "footnote"]), keys = Object.keys(entry);
    if (keys.length !== 1) return invalid();
    return keys[0] === "t" ? string(entry.t) : keys[0] === "footnote" ? (spanText(entry.footnote, depth + 1), "") : spanText(entry[keys[0]] as Spans, depth + 1);
  }).join("");
}
/** A unit's blocks as lines: each block with Hebrew is a line; an English block joins the last line it translates. */
function lines(value: unknown, budget: { blocks: number }): TextLine[] {
  const raws = array(value, COURSE_FEED_LIMITS.blocksPerUnit);
  const rows: { he?: string; tr?: string; en?: string; type: string; translates?: number[] }[] = raws.map(raw => {
    if (++budget.blocks > COURSE_FEED_LIMITS.blocks) return invalid();
    const block = object(raw, ["type"], BLOCK_KEYS), type = string(block.type);
    if (!BLOCK_TYPES.includes(type)) return invalid();
    for (const key of ["he", "bare", "tr", "label", "verse", "cue", "occasion"]) if (own(block, key)) string(block[key]);
    for (const key of ["text", "footnote"]) if (own(block, key)) spanText(block[key]);
    if (own(block, "gold") && typeof block.gold !== "boolean") return invalid();
    if (own(block, "role") && block.role !== "original") return invalid();
    for (const key of ["folio", "phys"]) if (own(block, key) && !Number.isSafeInteger(block[key])) return invalid();
    if (own(block, "marks")) array(block.marks, 64).forEach(mark => { const m = object(mark, ["type", "label"]); string(m.type, true); string(m.label); });
    const en = own(block, "en") ? (typeof block.en === "string" ? string(block.en) : spanText(block.en)) : undefined;
    const translates = own(block, "translates") ? array(block.translates, 64, 1).map(n => Number.isSafeInteger(n) && (n as number) >= 0 && (n as number) < raws.length ? n as number : invalid()) : undefined;
    if (translates && type !== "english") return invalid();
    // Only a block of prayer text is a line: an English block or a rubric that carries Hebrew is refused, not shown.
    if (typeof block.he === "string" && HEBREW_LETTER.test(block.he) && !LINE_TYPES.includes(type)) return invalid();
    const he = typeof block.he === "string" && HEBREW_LETTER.test(block.he) ? block.he.trim() : undefined;
    return { type, ...(he ? { he } : {}), ...(he && typeof block.tr === "string" && block.tr.trim() ? { tr: block.tr.trim() } : {}), ...(en && en.trim() ? { en: en.trim() } : {}), ...(translates ? { translates } : {}) };
  });
  const out: { he: string; tr?: string; en?: string }[] = [], at = new Map<number, number>();
  rows.forEach((row, i) => { if (row.he) { at.set(i, out.length); out.push({ he: row.he, ...(row.tr ? { tr: row.tr } : {}), ...(row.en ? { en: row.en } : {}) }); } });
  for (const row of rows) if (row.type === "english" && row.translates && row.en) {
    const line = at.get(Math.max(...row.translates));
    if (line !== undefined) out[line].en = out[line].en ? `${out[line].en} ${row.en}` : row.en;
  }
  for (const line of out) if (line.he.length > SERVICE_TEXT_LIMITS.he || (line.tr?.length ?? 0) > SERVICE_TEXT_LIMITS.tr || (line.en?.length ?? 0) > SERVICE_TEXT_LIMITS.en) return invalid();
  return out.map(line => Object.freeze(line));
}

export function parsePublicCourseFeed(feedBytes: Uint8Array, pins: unknown): PublicCourseFeed {
  try { return parsePinned(feedBytes, pins); }
  catch { return invalid(); } // Never the input, an identifier or a parser message.
}
function parsePinned(feedBytes: Uint8Array, pinsValue: unknown): PublicCourseFeed {
  if (!(feedBytes instanceof Uint8Array) || !feedBytes.byteLength || feedBytes.byteLength > COURSE_FEED_LIMITS.feedBytes) return invalid();
  const pins = checkCourseTextPins(pinsValue);
  if (sha256(feedBytes) !== pins.feedSha256) return invalid();
  const feed = object(parseBoundedServiceJson(feedBytes, COURSE_FEED_LIMITS.feedBytes), ["schemaVersion", "volume", "title", "printing", "license", "sections", "units", "pageIndex"], ["front", "blockGranularity"]);
  if (feed.schemaVersion !== 1 || feed.volume !== pins.volume) return invalid();
  const printing = object(feed.printing, ["gitSha", "pages", "builtAt", "source"]), source = object(printing.source, ["gitSha", "pages", "builtAt", "lane"]);
  if (source.lane !== "public" || source.gitSha !== pins.sourceGitSha || printing.gitSha !== source.gitSha || printing.pages !== source.pages || printing.builtAt !== source.builtAt) return invalid();
  const license = object(feed.license, ["spdx"], ["attribution"]);
  if (license.spdx !== PUBLIC_COURSE_CREDIT.spdx) return invalid();
  if (own(license, "attribution")) string(license.attribution, true);
  array(feed.sections, 64, 1); if (!feed.pageIndex || typeof feed.pageIndex !== "object" || Array.isArray(feed.pageIndex)) return invalid();
  const budget = { blocks: 0 }, units = new Map<string, readonly TextLine[]>(), seen = new Set<string>();
  const unitPattern = new RegExp(`^[a-z0-9-]+\\.[a-z0-9-]+@(?:${pins.volume}|shabbat-maariv)$`);
  for (const raw of array(feed.units, COURSE_FEED_LIMITS.units, 1)) {
    const unit = object(raw, ["id", "name", "section", "blocks"], ["caption", "folios", "group"]), id = string(unit.id);
    if (!unitPattern.test(id) || seen.has(id)) return invalid(); seen.add(id);
    string(unit.name, true); if (own(unit, "caption")) string(unit.caption);
    const projected = lines(unit.blocks, budget);
    // The mixed unit is parsed for shape like any other, then dropped: it never reaches the map a route reads.
    if (REFUSED_COURSE_UNIT.test(id) || projected.length < 1 || projected.length > SERVICE_TEXT_LIMITS.lines) continue;
    units.set(id, Object.freeze(projected));
  }
  const front = own(feed, "front") ? lines(feed.front, budget) : [];
  return Object.freeze({ identity: courseTextIdentity(pins), volume: pins.volume, sourceGitSha: pins.sourceGitSha, units, front: Object.freeze(front) });
}

/** The front matter is addressed as `front.<name>@<volume>`; at the pinned build it is the tallit blessing alone, one line. */
const FRONT_UNIT = /^front\.[a-z0-9-]+@([a-z0-9-]+)$/;
/** One unit's answer for the route. A refused, unknown or empty unit is null. */
export function courseTextAnswer(feed: PublicCourseFeed, unit: string): ServiceText | null {
  if (typeof unit !== "string" || REFUSED_COURSE_UNIT.test(unit)) return null;
  const front = FRONT_UNIT.exec(unit);
  const found = front ? (front[1] === feed.volume && feed.front.length === 1 ? feed.front : undefined) : feed.units.get(unit);
  if (!found || !found.length) return null;
  return Object.freeze({ unit, volume: feed.volume, credit: Object.freeze({ title: PUBLIC_COURSE_CREDIT.title, licence: PUBLIC_COURSE_CREDIT.licence }), lines: found });
}
