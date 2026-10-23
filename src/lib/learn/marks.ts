import { accentSample, CHART_ACCENTS, ENDING_SAMPLE, LEGARMEH_SAMPLE } from "../trope/chart-catalog";
import type { TropeId } from "./course";

/** A trope's mark as the chart draws it, on the chart's invented sample letter, and its name. */
const CODEPOINT: Readonly<Partial<Record<TropeId, string>>> = Object.freeze({
  etnachta: "0591", segol: "0592", shalshelet: "0593", "zakef-katan": "0594", "zakef-gadol": "0595", tipcha: "0596", revia: "0597", pashta: "0599", yetiv: "059A",
  tevir: "059B", geresh: "059C", gershayim: "059E", "karnei-farah": "059F", "telisha-gedola": "05A0", pazer: "05A1", munach: "05A3", mahpach: "05A4", mercha: "05A5",
  "mercha-kefula": "05A6", darga: "05A7", kadma: "05A8", "telisha-ketana": "05A9", "yerach-ben-yomo": "05AA", zarka: "05AE",
});
export function tropeSample(id: TropeId): string {
  if (id === "silluq") return ENDING_SAMPLE;
  if (id === "munach-legarmeh") return LEGARMEH_SAMPLE;
  const accent = CHART_ACCENTS.find(row => row.codepoint === CODEPOINT[id]);
  return accent ? accentSample(accent) : ENDING_SAMPLE;
}
export const tropeLabel = (id: TropeId): string => id === "karnei-farah" ? "karnei farah" : id.replaceAll("-", " ");
const CONJUNCTIVE: ReadonlySet<TropeId> = new Set<TropeId>(["munach", "mahpach", "mercha", "mercha-kefula", "darga", "kadma", "yerach-ben-yomo"]);
export const isConjunctive = (id: TropeId) => CONJUNCTIVE.has(id);
