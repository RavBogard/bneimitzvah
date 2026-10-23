import type { Melody } from "./course";

/**
 * "Open in Lein": the reading page on one verse, selected, with the inline player's Repeat and Speed
 * there (plan, Decided 6). The verse is its 1-based place in the reading. /read's own verse parameter
 * arrives with 1.3's A3; until then this is the one place that names it, so the link changes here only.
 */
export type LeinTarget = Readonly<{ date: string; kind: Melody; verse: number } | { ref: string; kind: Melody; verse: number }>;
export function leinHref(target: LeinTarget): string {
  const entries: [string, string][] = "date" in target ? [["date", target.date]] : [["ref", target.ref]];
  entries.push(["kind", target.kind], ["verse", String(target.verse)]);
  return `/read?${new URLSearchParams(entries).toString()}`;
}
