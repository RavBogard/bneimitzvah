import "server-only";
import { and, eq } from "drizzle-orm";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { AccessTransaction } from "../access/types";
import * as s from "../db/index";
import { parseBoundedServiceJson, parseServiceFeed, SERVICE_FEED_LIMITS, type ServiceBlock, type ServiceSpan } from "../service-learning/feed";
import { EVENING_TEXT_UNITS, eveningTextTenant, TENANTS } from "../../lib/service-course/course";
import { EVENING_TEXT_BUILD, EVENING_TEXT_LIMITS, EVENING_UNIT, REFUSED_UNIT, SERVICE_TEXT_LIMITS, type ServiceText, type TextLine } from "../../lib/service-course/text";
import { CourseTextUnavailable } from "./text";

/**
 * The evening and Havdalah lessons' text (2.0 SC7). Daniel, 2026-10-25 (MISSION, amended): the evening lessons use the CRC Beit
 * Mitzvah siddur's own text, the licensed build the app already stores for assigned parts, in the book's order and pages; CRC only;
 * "Anyone on the CRC site" may see it; signed-in CRC people may keep it offline, signed-out visitors may not. For CRC this replaces the
 * 2.0 rule that this text is never shown, stored or cached. Every other congregation is refused here, before any query.
 *
 * This module is the only part of the service course that reads the licensed catalog (service_catalog), and only:
 * - for a congregation the course allows (`eveningTextTenant`: CRC) whose course file turns the evening on;
 * - its one active catalog row, inside that congregation's own tenant transaction (forced row security);
 * - when that row is exactly the pinned build below (identity and all six pins), re-checked by the licensed parser's own hashes;
 * - the Saturday-evening units the evening lessons name, never a morning unit and never the Mi Shebeirach;
 * - as lines of prayer text: a block with Hebrew, its transliteration, and the translation the book prints after it with that
 *   translation's own printed credit line. Kavannot, rubrics, epigraphs, front matter and the song lyrics that carry no Hebrew are dropped.
 * No prayer text is in this file or anywhere in the repo: the bytes live only in the database, as they did before SC7.
 */
export const EVENING_TEXT_PIN = Object.freeze({
  // The licensed Beit Mitzvah build the app already serves (1.8 service parts, the honoree booklet): RavBogard/ShireiShabbat CI run
  // 35741258239 at edfef85e1e06737d5fea1c33970f23961f599fc5, artifact `dist-app`; a test holds it equal to the booklet's pin.
  identity: "781faabb7b219f76d684841fc91c9f13aecabc38b5cf5c7302144f5f80f41126",
  feedSha256: "8ea640e392a88dd4fee2825004b2db3c5d228025cf3685325dc709f7936c8266",
  provenanceSha256: "f046833c25cda7c153a6131d05425a388528ed60797b0fd84463adf5625f8978",
  artifactRepo: "RavBogard/ShireiShabbat",
  artifactCommit: "edfef85e1e06737d5fea1c33970f23961f599fc5",
  artifactRunId: "35741258239",
  sourceGitSha: "edfef85-LICENSED",
} as const);
export type EveningTextPin = Readonly<{ identity: string; feedSha256: string; provenanceSha256: string; artifactRepo: string; artifactCommit: string; artifactRunId: string; sourceGitSha: string }>;
const PIN_KEYS = ["feedSha256", "provenanceSha256", "artifactRepo", "artifactCommit", "artifactRunId", "sourceGitSha"] as const;

/**
 * Where a line's transliteration comes from, when the pinned build prints it on another row (T5's source defect, Hashkiveinu,
 * `08-shma.typ:162-171`): from that row (a block index), or nowhere (null). Keyed by the build it is true of, so a new build never
 * inherits it. On the pinned build the Hashkiveinu's Hebrew sits one row above its transliteration (the rows between carry song
 * credits), so each Hebrew row takes the next row's transliteration; the fourth Hebrew row's transliteration leaves out a word
 * there, so that row shows no transliteration at all rather than a misaligned one.
 */
export const TRANSLIT_FIXES: Readonly<Record<string, Readonly<Record<string, Readonly<Record<number, number | null>>>>>> = Object.freeze({
  [EVENING_TEXT_PIN.identity]: Object.freeze({ "shma.hashkiveinu@bm-maariv": Object.freeze({ 7: 8, 8: 9, 13: 14, 14: null, 15: 16 }) }),
});

export type EveningBook = Readonly<{ identity: string; title: string; attribution: string; units: ReadonlyMap<string, readonly TextLine[]> }>;
class EveningTextInvalid extends Error { constructor() { super("Evening text unavailable"); this.name = "EveningTextInvalid"; } }
const invalid = (): never => { throw new EveningTextInvalid(); };
const LINE_TYPES = ["stanza", "chatimah", "seasonal"], HEBREW_LETTER = /[\u05D0-\u05EA]/, LATIN_LETTER = /[A-Za-z]/;
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const samePins = (stored: unknown, pin: EveningTextPin) => isRecord(stored) && Object.keys(stored).length === PIN_KEYS.length && PIN_KEYS.every(key => stored[key] === pin[key]);
/** A span list's reading text: footnotes are dropped, emphasis and strong keep their words. */
const spanText = (spans: readonly ServiceSpan[]): string => spans.map(span => "t" in span ? span.t : "em" in span ? spanText(span.em) : "strong" in span ? spanText(span.strong) : "").join("");

/**
 * One unit's blocks as lines (pure). `translits` holds each block's transliteration by index (the licensed parser checks it and does
 * not keep it); `fix` is the pinned build's correction for this unit, if any.
 */
export function eveningLines(blocks: readonly ServiceBlock[], translits: readonly (string | undefined)[], fix?: Readonly<Record<number, number | null>>): TextLine[] {
  const out: { he: string; tr?: string; en?: string }[] = [];
  blocks.forEach((block, index) => {
    const he = typeof block.he === "string" ? block.he.trim() : "";
    if (LINE_TYPES.includes(block.type) && HEBREW_LETTER.test(he)) {
      const from = fix && Object.hasOwn(fix, index) ? fix[index] : index;
      const tr = from === null ? undefined : translits[from]?.trim();
      // A row's credit ("~ ...") or a row with no Latin letters is never shown as a transliteration.
      out.push({ he, ...(tr && LATIN_LETTER.test(tr) && !tr.startsWith("~") ? { tr } : {}) });
      return;
    }
    // A translation the book prints after its lines joins the last line, with its own credit line; a labelled kavannah, a source-owned
    // English page, anything before the first line, and rubrics are not prayer text and are dropped.
    if (block.type !== "english" || block.label !== undefined || block.role === "original" || !out.length || block.en === undefined) return;
    const en = (typeof block.en === "string" ? block.en : spanText(block.en)).trim();
    if (!en) return;
    const last = out[out.length - 1];
    last.en = last.en ? `${last.en}\n${en}` : en;
  });
  if (out.length > SERVICE_TEXT_LIMITS.lines || out.some(line => line.he.length > SERVICE_TEXT_LIMITS.he || (line.tr?.length ?? 0) > SERVICE_TEXT_LIMITS.tr || (line.en?.length ?? 0) > SERVICE_TEXT_LIMITS.en)) return invalid();
  return out.map(line => Object.freeze(line));
}

/**
 * The pinned build's evening units as lines. The licensed parser checks the bytes against the stored pins (both hashes) and the
 * whole feed's shape; the stored pins must equal the code pin key for key, and the parse's identity must be the pin's.
 */
export function parseEveningBook(feedBytes: Uint8Array, provenanceBytes: Uint8Array, pins: unknown, pin: EveningTextPin = EVENING_TEXT_PIN): EveningBook {
  try {
    if (!samePins(pins, pin)) return invalid();
    const feed = parseServiceFeed(feedBytes, provenanceBytes, pins as Parameters<typeof parseServiceFeed>[2]);
    if (feed.identity !== pin.identity || feed.source.lane !== "licensed" || typeof feed.license.attribution !== "string") return invalid();
    const title = typeof feed.title === "string" ? feed.title : feed.title.en, attribution = feed.license.attribution!.trim();
    if (!title || title.length > EVENING_TEXT_LIMITS.title || !attribution || attribution.length > EVENING_TEXT_LIMITS.attribution) return invalid();
    // The transliterations, from the same hashed bytes the licensed parser just accepted.
    const raw = parseBoundedServiceJson(feedBytes, SERVICE_FEED_LIMITS.feedBytes);
    const rawUnits = isRecord(raw) && Array.isArray(raw.units) ? raw.units : invalid();
    const units = new Map<string, readonly TextLine[]>();
    for (const unit of feed.units) {
      if (unit.family !== "bm-maariv" || !EVENING_TEXT_UNITS.has(unit.id) || REFUSED_UNIT.test(unit.id)) continue;
      const rawUnit = rawUnits.find(entry => isRecord(entry) && entry.id === unit.id);
      const rawBlocks = isRecord(rawUnit) && Array.isArray(rawUnit.blocks) && rawUnit.blocks.length === unit.blocks.length ? rawUnit.blocks : invalid();
      const translits = rawBlocks.map(block => isRecord(block) && typeof block.tr === "string" ? block.tr : undefined);
      const lines = eveningLines(unit.blocks, translits, TRANSLIT_FIXES[pin.identity]?.[unit.id]);
      if (lines.length) units.set(unit.id, Object.freeze(lines));
    }
    return Object.freeze({ identity: feed.identity, title, attribution, units });
  } catch { return invalid(); } // Never the input, an identifier or a parser message.
}

/** One unit's answer: a Saturday-evening unit an evening lesson names, from the pinned book, credited with its own attribution. */
export function eveningTextOf(book: EveningBook, unit: string, volume: string): ServiceText {
  if (typeof unit !== "string" || !EVENING_UNIT.test(unit) || REFUSED_UNIT.test(unit) || !EVENING_TEXT_UNITS.has(unit)) throw new CourseTextUnavailable("not-found");
  const lines = book.units.get(unit);
  if (!lines || !lines.length) throw new CourseTextUnavailable("not-found");
  return Object.freeze({ unit, volume, credit: Object.freeze({ title: book.title, attribution: book.attribution }), lines });
}

const parsed = new Map<string, EveningBook>();
/** The congregation's course file, when its evening is on: CRC's, and no other (Daniel, 2026-10-25). */
export function eveningTenantFile(tenantId: string) {
  return eveningTextTenant(tenantId) ? TENANTS.find(tenant => tenant.tenant === tenantId && tenant.enabled && tenant.evening) ?? null : null;
}
/**
 * The congregation's pinned siddur book, read inside its tenant transaction. Any congregation but CRC is refused before the first
 * query (not-found, so the answer can say the course is not offered here); a CRC catalog that is missing, withdrawn or not exactly the
 * pinned build is unavailable, and nothing is shown. `pin` is the code pin; tests pass a synthetic one.
 */
export async function readEveningText<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, tenantId: string, pin: EveningTextPin = EVENING_TEXT_PIN): Promise<{ book: EveningBook; volume: string }> {
  const tenant = eveningTenantFile(tenantId);
  if (!tenant) throw new CourseTextUnavailable("not-found");
  const [life] = await tx.select({ catalogId: s.serviceCatalogLifecycle.catalogId }).from(s.serviceCatalogLifecycle)
    .where(and(eq(s.serviceCatalogLifecycle.tenantId, tenantId), eq(s.serviceCatalogLifecycle.state, "active")));
  if (!life) throw new CourseTextUnavailable("unavailable");
  const where = and(eq(s.serviceCatalog.tenantId, tenantId), eq(s.serviceCatalog.id, life.catalogId));
  const [head] = await tx.select({ identity: s.serviceCatalog.identity, pins: s.serviceCatalog.pins }).from(s.serviceCatalog).where(where);
  if (!head || head.identity !== pin.identity || !samePins(head.pins, pin)) throw new CourseTextUnavailable("unavailable");
  // A book is kept only after its bytes passed the licensed parser's hashes under this pin, so a kept book is always the pinned build.
  const kept = parsed.get(pin.identity);
  if (kept) return { book: kept, volume: tenant.siddurBook };
  const [row] = await tx.select({ identity: s.serviceCatalog.identity, feedBytes: s.serviceCatalog.feedBytes, provenanceBytes: s.serviceCatalog.provenanceBytes, pins: s.serviceCatalog.pins })
    .from(s.serviceCatalog).where(where);
  if (!row || row.identity !== pin.identity) throw new CourseTextUnavailable("unavailable");
  let book: EveningBook;
  try { book = parseEveningBook(new Uint8Array(row.feedBytes), new Uint8Array(row.provenanceBytes), row.pins, pin); }
  catch { throw new CourseTextUnavailable("unavailable"); }
  if (parsed.size > 4) parsed.clear();
  parsed.set(pin.identity, book);
  return { book, volume: tenant.siddurBook };
}
/** The build key every evening text URL carries: the first twelve hex of the pinned identity (`EVENING_TEXT_BUILD`, tested equal). */
export const EVENING_PIN_BUILD = EVENING_TEXT_PIN.identity.slice(0, EVENING_TEXT_BUILD.length);
