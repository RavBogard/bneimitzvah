import "server-only";
import { TANAKH_VERSE_COUNTS } from "../../lib/readings/catalog";
import { expandReadingRanges, readingSegments } from "../../lib/readings/ranges";
import { proposeReading, type Calendar, type Snapshot } from "../../lib/readings/proposals";
import { publicShabbat } from "../../lib/readings/public-shabbat";
import { canonicalReadingRef } from "../../lib/readings/reading-ref";
import { WORD_DETAILS_LIMITS, type StudyWordDetails } from "../../lib/hebrew/word-details";
import type { StudyWordAids } from "../../lib/hebrew/word-aids";
import { projectStudyVerse } from "../../lib/hebrew/study-tokens";
import { parseReferenceShortResolution, REFERENCE_SHORT_RESOLUTION_SCHEMA, type ReferenceShortResolution } from "../../lib/reference-audio/short-resolution";
import { planStudyPage } from "../study/sefaria";
import { createStudyWordAids } from "../study/word-aids";
import { createSelectedWordDetails } from "../study/lexical/word-details";
import type { StepSourceLoader } from "../study/lexical/source-loader";
import { StepSourceUnavailable } from "../study/lexical/step";
import { StudyUnavailable, type StudyPage, type StudyRequest } from "../study/types";
import { ReferenceUnavailable, resolveReference, type ReferenceCatalog } from "../reference-audio/catalog";
import { findShortSource, readShortSourceEntry, type ShortSourceManifest } from "../reference-audio/short-source-manifest";
import { portionsOf, type WeekPortions } from "../../lib/print/portions";

/**
 * Signed-out reading (Daniel, 2026-10-22: show the text, trope, translation,
 * human recordings and study tools to visitors). PocketTorah is the only
 * reference audio here; generated chant stays behind G3 and has no path in. A passage is named by a
 * Shabbat date (resolved through the same Hebcal calendar the signed-in reading uses) or, for "Any
 * reading" (1.3), by a caller's reference. Caller ranges are accepted only in canonical, bounded form
 * (canonicalReadingRef: Hebcal's own segment form joined by "; ", at most 1000 characters, 32 segments
 * and 1000 verses, Torah in one book or Nevi'im only): one spelling per segment list. The same verses can
 * still be named more than one way (adjacent segments, or a haftarah's segments in another order), so a
 * cache may hold a passage under several URLs; every body echoes its own ref, so one can never stand in
 * for another. Either way the text comes from the same Sefaria reader, paged identically. Everything else is a kind and small
 * bounded numbers. This service holds no database handle, session, actor or tenant row: its
 * dependencies are public readers only.
 */
export const PUBLIC_TENANT = "crc";
/** CRC's own custom (migration 0002 seeds `calendar.diaspora = true`). */
export const PUBLIC_CALENDAR: Calendar = "diaspora";
export type PublicKind = "torah" | "haftarah";
export type PublicPage = Readonly<{ offset: number; first: string; last: string }>;
export type PublicPassage = Readonly<{ kind: PublicKind; ranges: readonly string[]; verseCount: number; pages: readonly PublicPage[] }>;
export type PublicRefReading = Readonly<{ ref: string; kind: PublicKind; passage: PublicPassage; listening: Readonly<{ pocketTorah: boolean }> }>;
export type PublicWeek = Readonly<{ date: string; parashah: string | null; torah: PublicPassage | null; haftarah: PublicPassage | null;
  fetchedAt: number; listening: Readonly<{ pocketTorah: boolean }> }>;
export class PublicReadingUnavailable extends Error {
  constructor(public readonly code: "not-found" | "invalid-request" | "upstream") { super("Public reading unavailable"); this.name = "PublicReadingUnavailable"; }
}
const notFound = (): never => { throw new PublicReadingUnavailable("not-found"); };
const invalid = (): never => { throw new PublicReadingUnavailable("invalid-request"); };
const counts = TANAKH_VERSE_COUNTS;
type Plan = Readonly<{ kind: PublicKind; ranges: readonly string[]; verses: readonly string[]; pages: readonly PublicPage[] }>;

function plan(kind: PublicKind, ranges: readonly string[]): Plan {
  const verses = expandReadingRanges(ranges, kind, counts), pages: PublicPage[] = [];
  let offset: number | null = 0;
  while (offset !== null) {
    const page = planStudyPage({ kind, ranges, verses, translation: "jps2023", offset }, counts);
    pages.push(Object.freeze({ offset, first: page.refs[0], last: page.refs.at(-1)! }));
    offset = page.nextOffset;
  }
  return Object.freeze({ kind, ranges: Object.freeze([...ranges]), verses: Object.freeze(verses), pages: Object.freeze(pages) });
}
/** The full parashah (as the signed-in proposed portion) and the haftarah actually read. */
export function publicPlans(snapshot: Snapshot): { torah: Plan | null; haftarah: Plan | null } {
  let torah: Plan | null = null, haftarah: Plan | null = null;
  if (snapshot.classification === "regular" && snapshot.reading) {
    try { const ref = proposeReading(snapshot, counts, { pick: "full" }).selection?.ref; if (ref) torah = plan("torah", readingSegments(ref)); } catch { torah = null; }
  }
  if (snapshot.haftarah) { try { haftarah = plan("haftarah", readingSegments(snapshot.haftarah)); } catch { haftarah = null; } }
  return { torah, haftarah };
}
const view = (value: Plan): PublicPassage => Object.freeze({ kind: value.kind, ranges: value.ranges, verseCount: value.verses.length, pages: value.pages });

export function createPublicReadingService(input: {
  loadReading(date: string, calendar: Calendar): Promise<{ snapshot: Snapshot; fetchedAt: number }>;
  loadText(request: StudyRequest): Promise<StudyPage>;
  stepSource: StepSourceLoader;
  /** Present only when PocketTorah playback is released to students. */
  pocketTorah: null | Readonly<{ loadCatalog(signal?: AbortSignal): Promise<ReferenceCatalog>; loadManifest(signal?: AbortSignal): Promise<ShortSourceManifest> }>;
  now?: () => number;
}) {
  const now = input.now ?? Date.now;
  const connected = (signal?: AbortSignal) => { if (signal?.aborted) throw new PublicReadingUnavailable("upstream"); };
  function shabbat(value: string) { const date = publicShabbat(value, now()); return date ?? invalid(); }
  async function snapshot(value: string, signal?: AbortSignal) {
    const date = shabbat(value); connected(signal);
    let loaded: { snapshot: Snapshot; fetchedAt: number };
    try { loaded = await input.loadReading(date, PUBLIC_CALENDAR); } catch { throw new PublicReadingUnavailable("upstream"); }
    connected(signal);
    if (loaded.snapshot.date !== date || loaded.snapshot.calendar !== PUBLIC_CALENDAR) throw new PublicReadingUnavailable("upstream");
    return { date, ...loaded };
  }
  /** A Shabbat's passage, from the calendar. */
  async function byDate(kind: PublicKind, date: string, signal?: AbortSignal): Promise<Plan> {
    if (kind !== "torah" && kind !== "haftarah") invalid();
    const loaded = await snapshot(date, signal);
    return publicPlans(loaded.snapshot)[kind] ?? notFound();
  }
  /** A caller's passage: canonical and bounded, or refused. Computed locally; no upstream call. */
  function byRef(kind: PublicKind, ref: string): Plan {
    const canonical = canonicalReadingRef(ref, kind) ?? invalid();
    try { return plan(canonical.kind, canonical.segments); } catch { return invalid(); }
  }
  async function text(value: Plan, offset: number, signal?: AbortSignal): Promise<StudyPage> {
    connected(signal);
    let page: StudyPage;
    try { page = await input.loadText(Object.freeze({ kind: value.kind, ranges: value.ranges, verses: value.verses, offset, translation: "jps2023", signal })); }
    catch (error) { if (error instanceof StudyUnavailable && error.code === "invalid-request") invalid(); throw new PublicReadingUnavailable("upstream"); }
    connected(signal);
    const expected = planStudyPage({ kind: value.kind, ranges: value.ranges, verses: value.verses, translation: "jps2023", offset }, counts);
    if (page.offset !== offset || page.totalVerses !== value.verses.length || page.nextOffset !== expected.nextOffset
      || page.verses.length !== expected.refs.length || page.verses.some((verse, i) => verse.ref !== expected.refs[i])) throw new PublicReadingUnavailable("upstream");
    return page;
  }
  const pageOffset = (value: Plan, offset: number) => { if (!Number.isSafeInteger(offset) || !value.pages.some(page => page.offset === offset)) invalid(); };
  const verseIndex = (value: Plan, index: number) => { if (!Number.isSafeInteger(index) || index < 0 || index >= value.verses.length) invalid(); };

  async function wordAidsOf(value: Plan, verse: number, signal?: AbortSignal): Promise<StudyWordAids> {
    verseIndex(value, verse);
    const target = (await text(value, verse, signal)).verses[0];
    const aids = createStudyWordAids(target); connected(signal);
    return aids ?? notFound();
  }
  async function wordDetailsOf(value: Plan, verse: number, word: number, signal?: AbortSignal): Promise<StudyWordDetails> {
    verseIndex(value, verse);
    const page = await text(value, verse, signal), target = page.verses[0];
    // Only real words: one cacheable URL per word of the reading, never one per arbitrary index.
    const projected = projectStudyVerse(target.ref, target.hebrew);
    if (projected.status === "ready" ? word >= projected.projection.words.length : word !== 0) invalid();
    // "This word elsewhere" stays inside this one reading: further pages only, each bounded and cached.
    const reading = Object.freeze({ verses: value.verses, loaded: page.verses,
      load: async (offset: number, inner: AbortSignal) => (await text(value, offset, inner)).verses });
    let details: StudyWordDetails | null;
    try { details = await createSelectedWordDetails(target, word, input.stepSource, signal, reading); }
    catch (error) { if (error instanceof StudyUnavailable && error.code === "invalid-request") invalid(); if (error instanceof PublicReadingUnavailable) throw error; throw new PublicReadingUnavailable("upstream"); }
    connected(signal);
    if (!details) return notFound();
    // A momentary miss (lexical source busy or over budget, or "elsewhere" out of time) is a 503,
    // never a cacheable "unavailable" that the CDN would keep for a day. A long reading searched only as far
    // as the page budget is a ready, `partial` answer, the same every time, and is cached like any other.
    if (details.status === "unavailable" && details.reason === "source-unavailable"
      || details.status === "ready" && details.elsewhere?.status === "unavailable" && details.elsewhere.reason === "text-unavailable") throw new PublicReadingUnavailable("upstream");
    return details;
  }
  /** PocketTorah verse resolutions for one text page; the bytes stay on the existing public short route. */
  async function shortOf(value: Plan, offset: number, signal?: AbortSignal) {
    const reference = input.pocketTorah; if (!reference) return notFound();
    pageOffset(value, offset);
    const page = await text(value, offset, signal);
    let references: ReferenceShortResolution[];
    try {
      const catalog = await reference.loadCatalog(signal); connected(signal);
      const manifest = await reference.loadManifest(signal); connected(signal);
      references = page.verses.map(verse => {
        const resolved = resolveReference(catalog, verse), entry = findShortSource(manifest, resolved);
        const parsed = parseReferenceShortResolution({ schema: REFERENCE_SHORT_RESOLUTION_SCHEMA, verse: resolved.verse, source: entry ? readShortSourceEntry(entry).source : null });
        if (!parsed) throw new ReferenceUnavailable(); return parsed;
      });
    } catch { throw new PublicReadingUnavailable("upstream"); }
    const result = Object.freeze({ offset: page.offset, nextOffset: page.nextOffset, totalVerses: page.totalVerses, references: Object.freeze(references) });
    if (Buffer.byteLength(JSON.stringify(result)) > 1024 * 1024) throw new PublicReadingUnavailable("upstream");
    return result;
  }
  const wordIndex = (word: number) => { if (!Number.isSafeInteger(word) || word < 0 || word >= WORD_DETAILS_LIMITS.words) invalid(); };
  const listening = () => Object.freeze({ pocketTorah: input.pocketTorah !== null });

  return Object.freeze({
    async week(date: string, signal?: AbortSignal): Promise<PublicWeek> {
      const loaded = await snapshot(date, signal), plans = publicPlans(loaded.snapshot);
      return Object.freeze({ date: loaded.date, parashah: loaded.snapshot.reading?.parashah ?? null,
        torah: plans.torah ? view(plans.torah) : null, haftarah: plans.haftarah ? view(plans.haftarah) : null, fetchedAt: loaded.fetchedAt,
        listening: listening() });
    },
    /** The reader's print sheet: the Shabbat's calendar aliyot (full kriyah and triennial), numbers only. */
    async portions(date: string, signal?: AbortSignal): Promise<WeekPortions> {
      return portionsOf((await snapshot(date, signal)).snapshot);
    },
    async text(kind: PublicKind, date: string, offset: number, signal?: AbortSignal): Promise<StudyPage> {
      const value = await byDate(kind, date, signal); pageOffset(value, offset);
      return text(value, offset, signal);
    },
    async wordAids(kind: PublicKind, date: string, verse: number, signal?: AbortSignal): Promise<StudyWordAids> {
      return wordAidsOf(await byDate(kind, date, signal), verse, signal);
    },
    async wordDetails(kind: PublicKind, date: string, verse: number, word: number, signal?: AbortSignal): Promise<StudyWordDetails> {
      wordIndex(word);
      return wordDetailsOf(await byDate(kind, date, signal), verse, word, signal);
    },
    async shortReferences(kind: PublicKind, date: string, offset: number, signal?: AbortSignal) {
      if (!input.pocketTorah) return notFound();
      return shortOf(await byDate(kind, date, signal), offset, signal);
    },
    /** "Any reading": the passage a canonical reference names, paged exactly as a week's passage. */
    readingByRef(kind: PublicKind, ref: string): PublicRefReading {
      const value = byRef(kind, ref);
      return Object.freeze({ ref, kind: value.kind, passage: view(value), listening: listening() });
    },
    async textByRef(kind: PublicKind, ref: string, offset: number, signal?: AbortSignal): Promise<StudyPage> {
      const value = byRef(kind, ref); pageOffset(value, offset);
      return text(value, offset, signal);
    },
    async wordAidsByRef(kind: PublicKind, ref: string, verse: number, signal?: AbortSignal): Promise<StudyWordAids> {
      return wordAidsOf(byRef(kind, ref), verse, signal);
    },
    async wordDetailsByRef(kind: PublicKind, ref: string, verse: number, word: number, signal?: AbortSignal): Promise<StudyWordDetails> {
      wordIndex(word);
      return wordDetailsOf(byRef(kind, ref), verse, word, signal);
    },
    async shortReferencesByRef(kind: PublicKind, ref: string, offset: number, signal?: AbortSignal) {
      if (!input.pocketTorah) return notFound();
      return shortOf(byRef(kind, ref), offset, signal);
    },
  });
}
export type PublicReadingService = ReturnType<typeof createPublicReadingService>;

/**
 * The lexical source holds one STEP book per server instance, and changing book
 * re-downloads and re-parses a whole 18-25 MB source file. Signed-out traffic gets
 * its own instance of the loader (so it can never evict a student's book) and a
 * small per-instance budget of book changes; past it, word details answer 503
 * until the window moves on. Cached books cost nothing and are never limited.
 */
export function budgetedStepSource(source: StepSourceLoader, options: { changes?: number; windowMs?: number; now?: () => number } = {}): StepSourceLoader {
  const changes = options.changes ?? 4, windowMs = options.windowMs ?? 60_000, now = options.now ?? Date.now;
  const started: number[] = []; let current: string | null = null, loading: string | null = null;
  return Object.freeze({
    lexicon: (signal?: AbortSignal) => source.lexicon(signal),
    book(code: string, signal?: AbortSignal) {
      // One change is counted once, however many visitors wait on the same load.
      if (code !== current && code !== loading) {
        const time = now();
        while (started.length && time - started[0] >= windowMs) started.shift();
        if (started.length >= changes) return Promise.reject(new StepSourceUnavailable());
        started.push(time); loading = code;
      }
      const work = source.book(code, signal);
      void work.then(() => { current = code; if (loading === code) loading = null; }, () => { if (loading === code) loading = null; });
      return work;
    },
  });
}
