import type { Melody } from "../../lib/learn/course";
import { readAddress } from "../portal/public-reading/urls";

/**
 * "Open in Lein": /read's own address for the reading with one verse (1-based within the passage)
 * opened selected and parked in the player (plan, Decided 6). Built by urls.ts readAddress().
 */
export type LeinTarget = Readonly<{ date: string; kind: Melody; verse: number } | { ref: string; kind: Melody; verse: number }>;
export const leinHref = (target: LeinTarget): string => "date" in target
  ? readAddress({ mode: "week", date: target.date, kind: target.kind }, { verse: target.verse })
  : readAddress({ mode: "ref", ref: target.ref, kind: target.kind }, { verse: target.verse });
