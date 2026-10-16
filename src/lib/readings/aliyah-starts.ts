import { TANAKH_VERSE_COUNTS } from "./catalog";
import { expandReadingRanges, type VerseCounts } from "./ranges";

/** null is unrecorded; [] explicitly records one aliyah. The first verse is implicit. */
export function aliyahStarts(kind: "torah" | "haftarah", value: unknown, verses: readonly string[]): string[] | null {
  if (value === null) return null;
  if (kind !== "torah" || !Array.isArray(value) || value.length > 999 || value.length >= verses.length) throw new Error("Invalid aliyah starts");
  let previous = 0;
  return value.map(ref => {
    if (typeof ref !== "string" || ref.length > 100) throw new Error("Invalid aliyah start");
    const index = verses.indexOf(ref);
    if (index <= previous) throw new Error("Aliyah starts must follow the first verse in selection order");
    previous = index; return ref;
  });
}

/** Selecting across a gap must never manufacture verses absent from the preview. */
export function previewSelection(ranges: readonly string[], kind: "torah" | "haftarah", start: string, end: string, counts: VerseCounts = TANAKH_VERSE_COUNTS): string {
  const verses = expandReadingRanges(ranges, kind, counts), first = verses.indexOf(start), last = verses.indexOf(end);
  if (first < 0 || last < first) throw new Error("Choose an ordered preview start and end");
  const a = /^(.+) ([1-9]\d*):([1-9]\d*)$/.exec(start), b = /^(.+) ([1-9]\d*):([1-9]\d*)$/.exec(end);
  if (!a || !b || a[1] !== b[1]) throw new Error("Choose verses in one book");
  const ref = start === end ? start : `${start}-${a[2] === b[2] ? b[3] : `${b[2]}:${b[3]}`}`;
  const expanded = expandReadingRanges([ref], kind, counts), selected = verses.slice(first, last + 1);
  if (expanded.length !== selected.length || expanded.some((ref, i) => ref !== selected[i])) throw new Error("Selection crosses a gap");
  return ref;
}

export function aliyahPosition(kind:"torah"|"haftarah",starts:readonly string[]|null,verses:readonly string[],ref:string):{number:number;startsHere:boolean}|null{
  if(kind!=="torah" || starts===null)return null;
  const ordinal=verses.indexOf(ref);if(ordinal<0)return null;
  const boundaries=[verses[0],...starts];let number=1;
  for(let i=1;i<boundaries.length;i++)if(verses.indexOf(boundaries[i])<=ordinal)number=i+1;
  return {number,startsHere:boundaries[number-1]===ref};
}
