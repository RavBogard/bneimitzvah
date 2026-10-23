import { PortalRequestError } from "../portal/api";
import { getJson } from "../portal/public-reading/api";
import { parseStudyContent, studyRangePlan, type StudyVerse } from "../portal/workspace/study/api";
import { referenceRecord } from "../../lib/reference-audio/source";
import { parseReferenceShortResolution, type ReferenceShortResolution } from "../../lib/reference-audio/short-resolution";
import { expandReadingRanges } from "../../lib/readings/ranges";
import { TANAKH_VERSE_COUNTS } from "../../lib/readings/catalog";
import type { Melody } from "../../lib/learn/course";
import type { LoadedVerse } from "../../lib/learn/phrase-audio";

/**
 * The course's verses, by canonical reference, through the public ref routes (plan, Decided 2):
 * /api/public/text?ref=&kind=&offset= and /api/public/reference/short?ref=&kind=&offset=. No new
 * server route. A lesson's verses go as few canonical passages as the ref rules allow (one Torah book
 * per passage, Nevi'im together), each of at most 32 segments and 1000 characters, so the requests
 * stay few and the CDN keeps them. Same-origin GETs with no cookie, as the public reading sends.
 */
export const REF_LIMITS = Object.freeze({ segments: 32, chars: 1000 });
const bad = (): never => { throw new PortalRequestError(503); };
const query = (entries: [string, string][]) => new URLSearchParams(entries).toString();
const position = (ref: string) => { const m = /^(.+) ([1-9]\d*):([1-9]\d*)$/.exec(ref); return m ? { book: m[1], chapter: Number(m[2]), verse: Number(m[3]) } : null; };
const ORDER = Object.keys(TANAKH_VERSE_COUNTS);

/** Single verses grouped into canonical passages: "Genesis 1:1; Genesis 1:3" (Torah within one book, in order). */
export function passagesFor(refs: readonly string[], kind: Melody): string[] {
  const unique = [...new Set(refs)].filter(ref => { const p = position(ref); return p && Object.hasOwn(TANAKH_VERSE_COUNTS, p.book); });
  unique.sort((a, b) => { const x = position(a)!, y = position(b)!; return ORDER.indexOf(x.book) - ORDER.indexOf(y.book) || x.chapter - y.chapter || x.verse - y.verse; });
  const groups: string[][] = [];
  for (const ref of unique) {
    const group = groups.at(-1), book = position(ref)!.book;
    const fits = group && group.length < REF_LIMITS.segments && [...group, ref].join("; ").length <= REF_LIMITS.chars && (kind === "haftarah" || position(group[0])!.book === book);
    if (fits) group.push(ref); else groups.push([ref]);
  }
  return groups.map(group => group.join("; "));
}

type Page = { refs: string[]; verses: StudyVerse[]; shorts: (ReferenceShortResolution | null)[]; shortsFailed: boolean };
async function textPage(ref: string, kind: Melody, offset: number, total: number, signal: AbortSignal) {
  const plan = studyRangePlan(ref.split("; "), kind, offset);
  const row = referenceRecord(await getJson(`/api/public/text?${query([["ref", ref], ["kind", kind], ["offset", String(offset)]])}`, 2 * 1024 * 1024, signal),
    ["kind", "ref", "offset", "nextOffset", "totalVerses", "translation", "verses", "chapters"]);
  if (!row || row.kind !== kind || row.ref !== ref) return bad();
  return { plan, page: parseStudyContent(row, plan, offset, total) };
}
async function shortPage(ref: string, kind: Melody, offset: number, refs: readonly string[], nextOffset: number | null, total: number, signal: AbortSignal) {
  const row = referenceRecord(await getJson(`/api/public/reference/short?${query([["ref", ref], ["kind", kind], ["offset", String(offset)]])}`, 1024 * 1024, signal), ["kind", "ref", "page"]);
  if (!row || row.kind !== kind || row.ref !== ref) return bad();
  const page = referenceRecord(row.page, ["offset", "nextOffset", "totalVerses", "references"]);
  if (!page || page.offset !== offset || page.nextOffset !== nextOffset || page.totalVerses !== total || !Array.isArray(page.references) || page.references.length !== refs.length) return bad();
  return page.references.map((raw, i) => { const parsed = parseReferenceShortResolution(raw); if (!parsed || parsed.verse.ref !== refs[i]) return bad(); return parsed; });
}
/** Every page of one passage: its text and, when the recordings answer, its short resolutions. */
async function passage(ref: string, kind: Melody, signal: AbortSignal): Promise<Page> {
  let total: number;
  try { total = expandReadingRanges(ref.split("; "), kind, TANAKH_VERSE_COUNTS).length; } catch { return bad(); }
  const out: Page = { refs: [], verses: [], shorts: [], shortsFailed: false };
  for (let offset: number | null = 0, guard = 0; offset !== null && guard < 12; guard++) {
    const { plan, page } = await textPage(ref, kind, offset, total, signal);
    let shorts: (ReferenceShortResolution | null)[];
    try { shorts = await shortPage(ref, kind, offset, plan.refs, plan.nextOffset, total, signal); }
    catch (error) { if (signal.aborted) throw error; shorts = plan.refs.map(() => null); out.shortsFailed = true; }
    out.refs.push(...plan.refs); out.verses.push(...page.verses); out.shorts.push(...shorts);
    offset = plan.nextOffset;
  }
  return out;
}

/** One per page: loads each verse once, however many lessons and drills ask for it. */
export function createVerseLoader(fetchPassage: typeof passage = passage) {
  const verses = new Map<string, Promise<LoadedVerse>>(), passages = new Map<string, Promise<readonly LoadedVerse[]>>();
  const key = (ref: string, kind: Melody) => `${kind}:${ref}`;
  function request(refs: readonly string[], kind: Melody) {
    const missing = [...new Set(refs)].filter(ref => !verses.has(key(ref, kind)));
    for (const ref of passagesFor(missing, kind)) {
      const work = fetchPassage(ref, kind, new AbortController().signal);
      const members = ref.split("; ");
      for (const member of members) {
        const one = work.then(result => {
          const i = result.refs.indexOf(member); if (i < 0) return bad();
          // A recording answer that failed is not remembered, so Try again asks again.
          if (result.shortsFailed) queueMicrotask(() => { if (verses.get(key(member, kind)) === one) verses.delete(key(member, kind)); });
          return Object.freeze({ ref: member, kind, hebrew: result.verses[i].hebrew, short: result.shorts[i] });
        });
        verses.set(key(member, kind), one);
        void one.catch(() => { if (verses.get(key(member, kind)) === one) verses.delete(key(member, kind)); });
      }
    }
  }
  /** A whole canonical passage (this week's reading) as one ref; its verses then load like any other. */
  function passageVerses(ref: string, kind: Melody): Promise<readonly LoadedVerse[]> {
    const k = `passage:${kind}:${ref}`;
    let work = passages.get(k);
    if (!work) {
      const fetched = fetchPassage(ref, kind, new AbortController().signal);
      work = fetched.then(result => Object.freeze(result.refs.map((member, i) => {
        const verse = Object.freeze({ ref: member, kind, hebrew: result.verses[i].hebrew, short: result.shorts[i] });
        if (!result.shortsFailed && !verses.has(key(member, kind))) verses.set(key(member, kind), Promise.resolve(verse));
        return verse;
      })));
      passages.set(k, work); void work.catch(() => passages.delete(k));
      void work.then(() => fetched.then(result => { if (result.shortsFailed) passages.delete(k); }), () => {});
    }
    return work;
  }
  return Object.freeze({
    passage: passageVerses,
    /** Start loading a batch together, so they share passages. */
    preload(refs: readonly string[], kind: Melody) { request(refs, kind); },
    load(ref: string, kind: Melody, signal: AbortSignal): Promise<LoadedVerse> {
      if (!verses.has(key(ref, kind))) request([ref], kind);
      const work = verses.get(key(ref, kind)) ?? Promise.reject(new PortalRequestError(503));
      return signal.aborted ? Promise.reject(new PortalRequestError(409)) : work;
    },
  });
}
export type VerseLoader = ReturnType<typeof createVerseLoader>;
