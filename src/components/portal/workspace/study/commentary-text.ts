import type { CommentaryComment, CommentaryRun } from "../../../../lib/readings/commentary";
import { hebrewLetters } from "../../../../lib/hebrew/dibbur";
import type { CommentaryVerseState } from "./commentary-api";

/**
 * How one comment is shown English-led: Rashi's quoted words (the leading bold
 * run of the Hebrew comment) first, then the English. Some English editions
 * repeat the quoted Hebrew at their start; that repetition is dropped only when
 * its letters are exactly the quoted words'. Text stays text; nothing is markup.
 */
export type CommentaryParts = Readonly<{
  /** The quoted words as printed (pointing kept, trailing full stop dropped), or null. */
  dibbur: string | null;
  /** The Hebrew comment after the quoted words; the whole Hebrew comment when there are none. */
  hebrew: readonly CommentaryRun[] | null;
  english: readonly CommentaryRun[] | null;
}>;
const LEADING_HEBREW = /^[֐-׿\s'"׳״.,:;\-־]+/;

export function commentaryParts(comment: CommentaryComment): CommentaryParts {
  const first = comment.hebrew?.[0];
  const dibbur = first?.bold ? first.text.trim().replace(/[.:,;]+$/, "").trim() || null : null;
  const hebrew = comment.hebrew ? dibbur ? trimStart(comment.hebrew.slice(1)) : comment.hebrew : null;
  let english = comment.english;
  if (dibbur && english?.length && !english[0].bold) {
    const lead = LEADING_HEBREW.exec(english[0].text)?.[0];
    if (lead && hebrewLetters(lead) === hebrewLetters(dibbur)) {
      const rest = english[0].text.slice(lead.length).trimStart();
      english = trimStart(rest ? [{ ...english[0], text: rest }, ...english.slice(1)] : english.slice(1));
    }
  }
  return Object.freeze({ dibbur, hebrew: hebrew?.length ? hebrew : null, english: english?.length ? english : null });
}
function trimStart(runs: readonly CommentaryRun[]): readonly CommentaryRun[] {
  const out = [...runs];
  while (out.length && !out[0].text.trim()) out.shift();
  if (out.length) out[0] = { ...out[0], text: out[0].text.trimStart() };
  return Object.freeze(out);
}
/** "Rashi (n)": the number of comments on a verse; 0 until they have loaded, and when there are none. */
export const commentaryCount = (state: CommentaryVerseState): number => state.status === "ready" ? state.comments.length : 0;
/** One summary for the verses on screen: failed wins over loading, loading over ready. */
export function commentarySummary(states: readonly CommentaryVerseState[]): "none" | "loading" | "failed" | "ready" {
  if (states.some(state => state.status === "failed")) return "failed";
  if (states.some(state => state.status === "loading")) return "loading";
  return states.some(state => state.status === "ready") ? "ready" : "none";
}
