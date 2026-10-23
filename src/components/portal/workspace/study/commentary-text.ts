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
  /**
   * The English edition's own lemma, split off only so it can be set calmer: its leading bold run
   * (the Prophets' editions), or its leading capitalized run up to the first dash outside brackets
   * (the Torah edition's "GET THEE OUT —", the Women's Commentary's capitalized section heads).
   * The text is the edition's, unchanged; `caps` says it was printed in capitals.
   */
  lemma: Readonly<{ text: string; caps: boolean }> | null;
  /** The English after the lemma. */
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
  const split = englishLemma(english ?? []);
  return Object.freeze({ dibbur, hebrew: hebrew?.length ? hebrew : null, lemma: split.lemma, english: split.english.length ? split.english : null });
}
const DASHES = new Set(["\u2014", "\u2013", "-"]);
/** Capitals only outside brackets and parentheses, at least two of them, and not a single capitalized word. */
function capitalized(text: string): boolean {
  const outside = text.replace(/\([^)]*\)|\[[^\]]*\]/g, " ");
  return !/\p{Ll}/u.test(outside) && (outside.match(/\p{Lu}/gu)?.length ?? 0) >= 2;
}
/** The English edition's lemma and the English after it; no lemma when the comment does not open with one. */
export function englishLemma(runs: readonly CommentaryRun[]): Readonly<{ lemma: Readonly<{ text: string; caps: boolean }> | null; english: readonly CommentaryRun[] }> {
  const first = runs[0];
  if (!first) return { lemma: null, english: runs };
  if (first.bold) {
    const text = first.text.trim();
    return text ? { lemma: Object.freeze({ text, caps: false }), english: trimStart(runs.slice(1)) } : { lemma: null, english: runs };
  }
  if (first.italic) return { lemma: null, english: runs };
  // The first dash outside brackets ends the lemma; a dash inside "(12:1–9)" does not.
  const text = first.text;
  let depth = 0, end = -1;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === "(" || char === "[") depth++;
    else if ((char === ")" || char === "]") && depth > 0) depth--;
    else if (depth === 0 && DASHES.has(char) && (char !== "-" || text[index - 1] === " ")) { end = index; break; }
  }
  const head = (end < 0 ? text : text.slice(0, end)).trimEnd();
  // A whole capitalized paragraph with no dash is a section head; otherwise the lemma must end at a dash.
  if (!head || !capitalized(head) || end < 0 && runs.length > 1) return { lemma: null, english: runs };
  const rest = end < 0 ? "" : text.slice(end);
  return { lemma: Object.freeze({ text: head, caps: true }), english: Object.freeze(rest ? [{ ...first, text: rest }, ...runs.slice(1)] : runs.slice(1)) };
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
