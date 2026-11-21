/** Page offsets and section bounds are positions in the assignment, not in the Tanakh. */
export function nextAssignedVerse(selected: { at: number; end: number }, page: { offset: number; verses: readonly unknown[]; nextOffset: number | null }) {
  const next = selected.at + 1;
  if (next >= selected.end) return { kind: "complete" } as const;
  if (next < page.offset + page.verses.length) return { kind: "verse", at: next } as const;
  if (page.nextOffset === next) return { kind: "page", at: next } as const;
  return { kind: "invalid" } as const;
}
