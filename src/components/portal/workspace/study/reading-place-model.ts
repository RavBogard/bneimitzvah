/** The reading place line and chapter jump, as pure functions over the verse refs of the loaded reading. */
export type Chapter = Readonly<{ key: string; label: string; first: string }>;
const CHAPTER = /^(.+ [1-9]\d*):[1-9]\d*$/;
export const chapterOf = (ref: string): string | null => CHAPTER.exec(ref)?.[1] ?? null;

/** Each chapter the reading touches, in reading order, with its first verse in the reading (a range may start mid-chapter). */
export function readingChapters(refs: readonly string[]): readonly Chapter[] {
  const seen = new Map<string, Chapter>();
  for (const ref of refs) { const key = chapterOf(ref); if (key !== null && !seen.has(key)) seen.set(key, Object.freeze({ key, label: key, first: ref })); }
  return [...seen.values()];
}

/** The offset of the text page that holds `ref`: the last page starting at or before its place in the reading. Null if it is not in the reading. */
export function pageOffsetFor(offsets: readonly number[], refs: readonly string[], ref: string): number | null {
  const position = refs.indexOf(ref); if (position < 0) return null;
  return offsets.filter(offset => offset <= position).at(-1) ?? null;
}

/** The verse nearest the top among those on screen, in reading order; null when none is, so the line keeps what it had. */
export function topVisible(order: readonly string[], visible: ReadonlySet<string>): string | null {
  return order.find(ref => visible.has(ref)) ?? null;
}
