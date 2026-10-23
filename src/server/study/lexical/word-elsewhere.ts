import "server-only";
import { projectStudyVerse } from "../../../lib/hebrew/study-tokens";
import { WORD_DETAILS_LIMITS, wordDetailsWord, type WordElsewhere, type WordPlace } from "../../../lib/hebrew/word-details";
import { alignStepVerse, type StepVerse } from "./step";
import type { StudyVerse } from "../types";

/** The student's own assigned verses in reading order, the text page already
 * authorized for this request, and a loader for further pages of the same reading. */
export type WordReading = Readonly<{ verses: readonly string[]; loaded: readonly StudyVerse[]; load(offset: number, signal: AbortSignal): Promise<readonly StudyVerse[]> }>;
/** Extra text pages one selected word may read; the first page is already loaded. A long reading that
 * needs more gets a `partial` answer: the places in the pages searched, the same every time (so a cache
 * may keep it). Only a failed, slow or aborted load drops the places. */
export const WORD_ELSEWHERE_LOADS = 4;
/** Whole budget for those pages, so slow text drops only the places, never the word facts. */
export const WORD_ELSEWHERE_MS = 4000;
const unavailable = (reason: "no-lexeme" | "text-unavailable"): WordElsewhere => Object.freeze({ status: "unavailable", reason });
const bytes = (words: readonly string[]) => new TextEncoder().encode(words.join(" ")).length;

/** Up to two rendered words either side, narrowed until the snippet fits. */
function place(ref: string, index: number, words: readonly string[]): WordPlace | null {
  let start = Math.max(0, index - 2), end = Math.min(words.length, index + 3);
  while (bytes(words.slice(start, end)) > WORD_DETAILS_LIMITS.placeBytes) {
    if (start === index && end === index + 1) return null;
    if (start < index && index - start >= end - index - 1) start++; else end--;
  }
  return Object.freeze({ ref, wordIndex: index, words: Object.freeze(words.slice(start, end)), mark: index - start });
}

/** Same STEP lexical id, same book, the student's assigned verses only. Every
 * place is a fully aligned rendered word; an unaligned verse is left out, never guessed. */
export async function findWordElsewhere(input: Readonly<{ book: readonly StepVerse[]; lemma: string | null; ref: string; wordIndex: number; reading: WordReading; connected(): void; signal?: AbortSignal; budgetMs?: number }>): Promise<WordElsewhere> {
  const { book, lemma, ref, wordIndex, reading, connected, signal } = input;
  if (!lemma) return unavailable("no-lexeme");
  // Child of the request: request abort still wins; the budget only ends these loads.
  const own = new AbortController(), stop = () => own.abort(), timer = setTimeout(stop, input.budgetMs ?? WORD_ELSEWHERE_MS);
  if (signal?.aborted) stop(); signal?.addEventListener("abort", stop, { once: true });
  // Ends a load that ignores its signal; handled here so it never rejects unobserved.
  const ended = new Promise<never>((_, reject) => { own.signal.addEventListener("abort", () => reject(new Error("ended")), { once: true }); }); ended.catch(() => {});
  try {
    const name = /^(.+) [0-9]+:[0-9]+$/.exec(ref)?.[1]; if (!name) return unavailable("text-unavailable");
    const order = new Map<string, number>();
    reading.verses.forEach((verse, offset) => { if (!order.has(verse)) order.set(verse, offset); });
    const same = (source: StepVerse & { status: "ready" }, number: number) => source.words[number - 1]?.lemmas.some(entry => entry.lexical && entry.id === lemma) === true;
    const candidates = new Map<string, Readonly<{ source: StepVerse & { status: "ready" }; numbers: readonly number[] }>>();
    for (const verse of book) {
      if (verse.status !== "ready" || !order.has(verse.ref) || !verse.ref.startsWith(`${name} `)) continue;
      const numbers = verse.words.filter(word => same(verse, word.number) && !(verse.ref === ref && word.number - 1 === wordIndex)).map(word => word.number);
      if (numbers.length) candidates.set(verse.ref, Object.freeze({ source: verse, numbers: Object.freeze(numbers) }));
    }
    const wanted = [...candidates.keys()].sort((a, b) => order.get(a)! - order.get(b)!), text = new Map<string, StudyVerse>();
    const take = (rows: readonly StudyVerse[]) => { for (const row of rows) if (row && typeof row.ref === "string" && order.has(row.ref) && !text.has(row.ref)) text.set(row.ref, row); };
    take(reading.loaded);
    let loads = 0, partial = false;
    for (const verse of wanted) {
      if (text.has(verse)) continue;
      // Over the page budget: search no further, and say so; never a failure.
      if (loads === WORD_ELSEWHERE_LOADS) { partial = true; break; }
      loads++;
      let rows: readonly StudyVerse[];
      try { rows = await Promise.race([reading.load(order.get(verse)!, own.signal), ended]); } catch { connected(); return unavailable("text-unavailable"); }
      connected(); if (own.signal.aborted) return unavailable("text-unavailable");
      if (!Array.isArray(rows) || rows[0]?.ref !== verse) return unavailable("text-unavailable");
      take(rows);
    }
    const places: WordPlace[] = []; let total = 0;
    for (const verse of wanted) {
      const row = text.get(verse), candidate = candidates.get(verse)!;
      if (!row) { if (partial) continue; return unavailable("text-unavailable"); }
      let projected; try { projected = projectStudyVerse(verse, row.hebrew); } catch { continue; }
      if (projected.status !== "ready") continue;
      const words = Object.freeze(projected.projection.words.map(word => word.text));
      if (!words.every(wordDetailsWord) || alignStepVerse(candidate.source, { ref: verse, words }).status !== "ready") continue;
      for (const number of candidate.numbers) {
        const found = place(verse, number - 1, words); if (!found) continue;
        total++; if (places.length < WORD_DETAILS_LIMITS.places) places.push(found);
      }
    }
    connected();
    return Object.freeze({ status: "ready", lemma, total, places: Object.freeze(places), ...(partial ? { partial: true as const } : {}) });
  } catch { connected(); return unavailable("text-unavailable"); }
  finally { clearTimeout(timer); signal?.removeEventListener("abort", stop); }
}
