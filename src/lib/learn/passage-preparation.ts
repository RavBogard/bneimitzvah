import type { Melody } from "./course";
import type { AnalysedVerse } from "./verse";
import { preparationParts } from "./preparation";
import { TANAKH_VERSE_COUNTS } from "../readings/catalog";
import { canonicalReadingRef } from "../readings/reading-ref";

const position = (ref: string) => {
  const match = /^(.+) ([1-9]\d*):([1-9]\d*)$/.exec(ref);
  return match ? { book: match[1], chapter: Number(match[2]), verse: Number(match[3]) } : null;
};

/** Audio gaps and omitted verses never become a made-up verse transition. */
export function adjacentPassageVerses(left: AnalysedVerse, right: AnalysedVerse): boolean {
  const a = position(left.ref), b = position(right.ref);
  if (!a || !b || a.book !== b.book || left.kind !== right.kind) return false;
  return a.chapter === b.chapter ? b.verse === a.verse + 1
    : b.chapter === a.chapter + 1 && b.verse === 1 && TANAKH_VERSE_COUNTS[a.book]?.[a.chapter - 1] === a.verse;
}

/** The longest available run from this verse, in the reading's own order. */
export function passageRunEnd(verses: readonly AnalysedVerse[], start: number): number {
  if (!verses[start]?.wordReady) return start - 1;
  let end = start;
  while (verses[end + 1]?.wordReady && adjacentPassageVerses(verses[end], verses[end + 1])) end++;
  return end;
}

export function selectedPassage(verses: readonly AnalysedVerse[], start: number, end: number): readonly AnalysedVerse[] {
  return Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end >= start && end <= passageRunEnd(verses, start) ? verses.slice(start, end + 1) : [];
}

/** A single canonical range keeps even long selected sections in the public URL's bounds. */
export function passageReference(verses: readonly AnalysedVerse[]): string | null {
  if (!verses.length || verses.some((verse, n) => n > 0 && !adjacentPassageVerses(verses[n - 1], verse))) return null;
  const a = position(verses[0].ref)!, b = position(verses.at(-1)!.ref)!;
  const ref = verses.length === 1 ? verses[0].ref : `${a.book} ${a.chapter}:${a.verse}-${a.chapter === b.chapter ? b.verse : `${b.chapter}:${b.verse}`}`;
  return canonicalReadingRef(ref, verses[0].kind)?.ref ?? null;
}

/** Complete canonical phrases on either side; never one invented short cut. */
export function passageBoundary(left: AnalysedVerse, right: AnalysedVerse) {
  if (!left.wordReady || !right.wordReady || !adjacentPassageVerses(left, right)) return null;
  return { left: preparationParts(left).at(-1)!, right: preparationParts(right)[0] };
}

export const preparationHref = (ref: string, kind: Melody) => `/learn/prepare?${new URLSearchParams({ ref, kind })}`;

/** An arbitrary excerpt ending is neither a haftarah ending nor a verified recording ending. */
export function referencePassageFlags(assets: readonly (string | null)[], index: number): { final: false; endsRecording: boolean | null } {
  const current = assets[index], next = assets[index + 1];
  return { final: false, endsRecording: current && next ? current !== next : null };
}

export function preparationTarget(params: Record<string, string | string[] | undefined>): { ref: string | null; kind: Melody } | null {
  if (params.kind !== undefined && params.kind !== "torah" && params.kind !== "haftarah") return null;
  const kind = params.kind ?? "torah";
  if (params.ref === undefined) return { ref: null, kind };
  const parsed = canonicalReadingRef(params.ref, kind);
  return parsed ? { ref: parsed.ref, kind: parsed.kind } : null;
}
