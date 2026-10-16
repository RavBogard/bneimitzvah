import type { FamilyId } from "../trope/chart-catalog";
import { projectStudyVerse, type HebrewSource, type PhraseToken, type StudyProjection } from "./study-tokens";

export type AnnotationWord = Readonly<{ index: number; family: FamilyId | null; phrase: number | null }>;
export type AnnotatedToken = PhraseToken & Readonly<{ family: FamilyId | null; phrase: number | null }>;
export type ColorResult = Readonly<{ version: 1; ref: string; status: "ready"; final: boolean; projection: StudyProjection; words: readonly AnnotationWord[]; tokens: readonly AnnotatedToken[] }>
  | Readonly<{ version: 1; ref: string; status: "unavailable"; reason: "reconstruction" | "bounds" | "unsupported-system" }>;
export type AssignmentEnding = Readonly<{ kind: "torah" | "haftarah"; confirmed: boolean; verses: readonly string[] }>;
const BLOCK_ENDING: Readonly<Record<string, FamilyId>> = {
  "֑": "etnachta", "֔": "zakef", "֕": "zakef-gadol", "֗": "revia", "֛": "tevir", "֒": "segol", "֓": "segol",
  "֜": "azla", "֝": "azla", "֞": "azla", "֩": "telisha-ketana", "֡": "pazer", "֠": "pazer", "֟": "pazer",
};

/** Port of lib-trope's grouping; alternatives are atomic read tokens, written text has no color/index. */
export function colorStudyVerse(ref: string, source: HebrewSource, assignment: AssignmentEnding): ColorResult {
  // Current grouping/stress rules cover the 21-book system only. Book identity,
  // not accent presence, determines eligibility; Job prose exceptions are deferred.
  if (/^(?:Psalms|Proverbs|Job) [1-9]\d*:[1-9]\d*$/.test(ref)) return { version: 1, ref, status: "unavailable", reason: "unsupported-system" };
  const result = projectStudyVerse(ref, source);
  if (result.status === "unavailable") return { version: 1, ref, ...result };
  const projection = result.projection;
  const final = assignment.kind === "haftarah" && assignment.confirmed && assignment.verses.at(-1) === ref;
  const tokens: AnnotatedToken[] = projection.tokens.map(t => ({ ...t, family: null, phrase: null }));
  let last = -1;
  tokens.forEach((t, k) => { if (t.words.length) last = k; });
  let open: number[] = [], phrase = 0;
  const close = (family: FamilyId) => {
    // Gap/sign pieces remain uncolored; they do not close the surrounding phrase.
    for (const k of open) tokens[k] = { ...tokens[k], family, phrase };
    open = []; phrase++;
  };
  for (let k = 0; k < tokens.length; k++) {
    const t = tokens[k], paseq = t.kind === "text" && t.text.trim() === "׀";
    if (!t.words.length && !paseq) continue;
    open.push(k);
    if (!t.words.length) continue;
    let family: FamilyId | undefined;
    for (const ch of t.text) if (BLOCK_ENDING[ch]) { family = BLOCK_ENDING[ch]; break; }
    if (!family && t.text.includes("֣") && tokens[k + 1]?.kind === "text" && tokens[k + 1].text.trim() === "׀") family = "revia";
    if (k === last) family = final ? "sof-haftarah" : "sof-pasuk";
    if (!family) continue;
    while (tokens[k + 1]?.kind === "text" && tokens[k + 1].text.trim() === "׀") open.push(++k);
    close(family);
  }
  if (open.length) close(final ? "sof-haftarah" : "sof-pasuk");
  const words = projection.words.map(w => {
    const token = tokens.find(t => t.words.includes(w.index));
    return { index: w.index, family: token?.family ?? null, phrase: token?.phrase ?? null };
  });
  return { version: 1, ref, status: "ready", final, projection, words, tokens };
}
