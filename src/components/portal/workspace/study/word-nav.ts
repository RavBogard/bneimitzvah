/**
 * Word navigation, kept pure so it can be tested. Hebrew runs right to left, so ArrowLeft reads on to the next
 * word and ArrowRight goes back (the haftarah study sheet's roving pattern); one Tab stop per verse.
 */
export function rovingTarget(index: number, count: number, key: string): number | null {
  if (!Number.isSafeInteger(index) || !Number.isSafeInteger(count) || count <= 0) return null;
  switch (key) {
    case "ArrowLeft": return Math.min(count - 1, index + 1);
    case "ArrowRight": return Math.max(0, index - 1);
    case "Home": return 0;
    case "End": return count - 1;
    default: return null;
  }
}

/** The word before or after this one, stepping over verses that have no words; null at either end of the loaded text. */
export function adjacentWord(counts: readonly number[], verse: number, word: number, direction: -1 | 1): { verse: number; word: number } | null {
  if (!Number.isSafeInteger(verse) || !Number.isSafeInteger(word) || (direction !== -1 && direction !== 1)) return null;
  let v = verse, w = word + direction;
  while (v >= 0 && v < counts.length) {
    if (w >= 0 && w < counts[v]) return { verse: v, word: w };
    v += direction; w = direction === 1 ? 0 : (counts[v] ?? 0) - 1;
  }
  return null;
}

/** What a tap on a word does. In Study a card is available and opens; in Lein there is none, so the tap plays, as before. */
export type WordTap = Readonly<{ openCard: ((verse: string, word: number, element: HTMLElement | null) => void) | null; play(word: number): void }>;
export function tapWord(route: WordTap, verse: string, word: number, element: HTMLElement | null): "card" | "play" {
  if (route.openCard) { route.openCard(verse, word, element); return "card"; }
  route.play(word); return "play";
}
