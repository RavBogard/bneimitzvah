import type { Melody } from "./course";

/**
 * "Open in Lein": the reading page on one verse, selected, with the inline player's Repeat and Speed
 * there (plan, Decided 6). The address is /read's own (1.3 A3, PR #34): `?ref=<canonical ref>&kind=&verse=`
 * or `?date=<Saturday>[&kind=haftarah]&verse=`, the verse 1-based within the passage. When #34 lands this
 * becomes a call to urls.ts readAddress(); this is the one place that builds the link.
 */
export type LeinTarget = Readonly<{ date: string; kind: Melody; verse: number } | { ref: string; kind: Melody; verse: number }>;
export function leinHref(target: LeinTarget): string {
  const entries: [string, string][] = "date" in target
    ? [["date", target.date], ...(target.kind === "haftarah" ? [["kind", "haftarah"] as [string, string]] : [])]
    : [["ref", target.ref], ["kind", target.kind]];
  entries.push(["verse", String(target.verse)]);
  return `/read?${new URLSearchParams(entries).toString()}`;
}
