import { TANAKH_VERSE_COUNTS } from "../readings/catalog";
import { catalogTorahVerses } from "../readings/guide-catalog";
import { hebcalRef, parseRange } from "../readings/leyning.mjs";
import { TORAH_BOOKS } from "../readings/ranges";
import source from "./human-tracks.json";

export const HUMAN_VOICES = {
  "rotem-cohen": { name: "Hazan Rotem Cohen", tradition: "Egyptian Karaite tradition" },
  "josh-finkel": { name: "Cantor Josh Finkel", tradition: "Central Reform Congregation" },
} as const;
export const HUMAN_TRACK_KINDS = { torah: "Torah", haftarah: "Haftarah", megillah: "Megillah", other: "Other recordings" } as const;
export type HumanVoice = keyof typeof HUMAN_VOICES;
export type HumanTrackKind = keyof typeof HUMAN_TRACK_KINDS;
type Position = { book: string; chapter: number; verse: number };
export type HumanTrackCut = Position & { startSec: number; endSec: number };
export type HumanTrackPassage = { book: string; startChapter: number; startVerse: number; endChapter: number; endVerse: number; startSec?: number; endSec?: number };
export type HumanTrack = {
  id: string; voice: HumanVoice; kind: HumanTrackKind; title: string; sourceUrl?: string; streamUrl?: string; audioPath?: string;
  sha256?: string; bytes?: number; durationSec?: number; notes?: string; portions?: readonly string[];
  passages?: readonly HumanTrackPassage[]; verseCuts?: readonly HumanTrackCut[];
};
export const HUMAN_TRACK_ID = /^[a-z0-9][a-z0-9-]{0,95}$/;
export const HUMAN_TRACK_DIGEST = /^[a-f0-9]{64}$/;
export const MAX_HUMAN_TRACK_BYTES = 128 * 1024 * 1024;
const BOOK_NAMES = new Map(Object.keys(TANAKH_VERSE_COUNTS).map(book => [book.toLowerCase().replaceAll(" ", "-"), book]));
const bookName = (book: string) => BOOK_NAMES.get(book.toLowerCase().replaceAll(" ", "-"));
const coordinate = (chapter: number, verse: number) => chapter * 1000 + verse;
const within = (position: Position, passage: HumanTrackPassage) => {
  if (position.book !== passage.book) return false;
  const value = coordinate(position.chapter, position.verse);
  return value >= coordinate(passage.startChapter, passage.startVerse) && value <= coordinate(passage.endChapter, passage.endVerse);
};
const verseInBook = (book: string, chapter: number, verse: number) =>
  Number.isSafeInteger(chapter) && Number.isSafeInteger(verse) && chapter > 0 && verse > 0 && verse <= (TANAKH_VERSE_COUNTS[book]?.[chapter - 1] ?? 0);
const times = (start: number, end: number, duration?: number) =>
  Number.isFinite(start) && start >= 0 && Number.isFinite(end) && end > start && end <= (duration ?? 4 * 3600);

export function karaiteTrackSource(url: string | undefined) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.origin === "https://karaites.org" && !parsed.username && !parsed.password && !parsed.search && !parsed.hash
      && /^\/uploads\/7\/4\/1\/3\/7413835\/[a-z0-9_-]+\.mp3$/i.test(parsed.pathname) ? parsed.href : null;
  } catch { return null; }
}

export const humanTrackPath = (track: HumanTrack) => "/api/human-tracks/" + track.id;
export const offlineHumanTrackPath = (track: HumanTrack) =>
  humanTrackPath(track) + "?copy=" + track.sha256;
export function humanTrackPlayable(track: HumanTrack) {
  return track.voice === "rotem-cohen" ? karaiteTrackSource(track.streamUrl) !== null : !!track.sha256 && !!track.bytes;
}
export function offlineHumanTrackAvailable(track: HumanTrack): track is HumanTrack & { sha256: string; bytes: number } {
  return humanTrackPlayable(track) && typeof track.sha256 === "string" && typeof track.bytes === "number";
}

function normalizeTrack(track: HumanTrack): HumanTrack {
  const passages = track.passages?.flatMap(passage => {
    const book = bookName(passage.book);
    if (!book || !verseInBook(book, passage.startChapter, passage.startVerse) || !verseInBook(book, passage.endChapter, passage.endVerse)
      || coordinate(passage.startChapter, passage.startVerse) > coordinate(passage.endChapter, passage.endVerse)) return [];
    return [{ ...passage, book }];
  });
  const verseCuts = track.verseCuts?.flatMap(cut => {
    const book = bookName(cut.book);
    if (!book || !verseInBook(book, cut.chapter, cut.verse) || !times(cut.startSec, cut.endSec, track.durationSec)) return [];
    const segment = { ...cut, book };
    return passages?.length && !passages.some(passage => within(segment, passage)) ? [] : [segment];
  });
  return { ...track, passages, verseCuts,
    sha256: track.sha256 && HUMAN_TRACK_DIGEST.test(track.sha256) ? track.sha256 : undefined,
    bytes: track.bytes && Number.isSafeInteger(track.bytes) && track.bytes > 0 && track.bytes <= MAX_HUMAN_TRACK_BYTES ? track.bytes : undefined };
}

export const HUMAN_TRACKS: readonly HumanTrack[] = (source as HumanTrack[])
  .filter(track => HUMAN_TRACK_ID.test(track.id) && Object.hasOwn(HUMAN_VOICES, track.voice) && Object.hasOwn(HUMAN_TRACK_KINDS, track.kind))
  .map(normalizeTrack);
const indexedTracks = new Map(HUMAN_TRACKS.map(track => [track.id, track]));
export const humanTrackById = (id: string) => indexedTracks.get(id);

const refsByPortion = new Map<string, ReadonlySet<string>>();
function portionRefs(portion: string) {
  let refs = refsByPortion.get(portion);
  if (!refs) {
    refs = new Set(catalogTorahVerses(portion, TANAKH_VERSE_COUNTS));
    refsByPortion.set(portion, refs);
  }
  return refs;
}

function versePosition(ref: string) {
  const parsed = parseRange(ref);
  if (!parsed || parsed.from[0] !== parsed.to[0] || parsed.from[1] !== parsed.to[1]) return null;
  return { book: parsed.book, chapter: parsed.from[0], verse: parsed.from[1] };
}

export function humanTracksForVerses(verses: readonly string[], tracks: readonly HumanTrack[] = HUMAN_TRACKS) {
  if (!verses.length) return [];
  const positions = verses.map(versePosition).filter(verse => verse !== null);
  return tracks.filter(track => {
    if (!humanTrackPlayable(track)) return false;
    if (positions.some(verse => track.verseCuts?.some(cut => cut.book === verse.book && cut.chapter === verse.chapter && cut.verse === verse.verse))) return true;
    if (track.passages?.length) return positions.some(verse => track.passages!.some(passage => within(verse, passage)));
    // CRC's named Torah portion gives a navigation match. A Karaite haftarah's boundaries can differ even with the same weekly name.
    return track.kind === "torah" && positions.some(verse => (TORAH_BOOKS as readonly string[]).includes(verse.book))
      && track.portions?.some(portion => verses.some(verse => portionRefs(portion).has(verse)));
  });
}
export function humanTrackCoverage(track: HumanTrack) {
  return track.passages?.map(passage => hebcalRef({ k: passage.book, b: passage.startChapter + ":" + passage.startVerse, e: passage.endChapter + ":" + passage.endVerse })).join("; ") || null;
}
export function humanTrackCut(track: HumanTrack, ref?: string) {
  if (!ref) return null;
  const verse = versePosition(ref);
  if (!verse) return null;
  const matches = track.verseCuts?.filter(cut => cut.book === verse.book && cut.chapter === verse.chapter && cut.verse === verse.verse);
  if (matches?.length === 1) return matches[0];
  // A published passage span may also provide exact timestamps for one verse.
  const passages = track.passages?.filter(passage => within(verse, passage)
    && passage.startChapter === passage.endChapter && passage.startVerse === passage.endVerse
    && passage.startSec !== undefined && passage.endSec !== undefined && times(passage.startSec, passage.endSec, track.durationSec));
  if (passages?.length !== 1) return null;
  return { ...verse, startSec: passages[0].startSec!, endSec: passages[0].endSec! };
}
