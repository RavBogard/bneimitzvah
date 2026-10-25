import type { AnalysedVerse } from "./verse";

export type PreparationStage = "model" | "words" | "echo" | "attempt" | "check" | "word-repair" | "tune-repair" | "unsure" | "choose-part" | "join-model" | "join-attempt" | "join-check" | "whole-attempt" | "whole-check" | "recover" | "summary";
export type PreparationState = Readonly<{ stage: PreparationStage; part: number; join: number; word: number | null; repairScope: "part" | "whole";
  /** A temporary learner comparison, never an accuracy measurement or persisted progress. */ selfComparison: "same" | null }>;
export const startPreparation = (): PreparationState => ({ stage: "model", part: 0, join: 0, word: null, repairScope: "part", selfComparison: null });
export type PreparationAction = { type: "stage"; stage: PreparationStage } | { type: "part"; part: number; stage?: "words" | "tune-repair" | "unsure" } | { type: "word"; word: number; part?: number }
  | { type: "next-part"; count: number } | { type: "next-join"; count: number } | { type: "self-report"; same: boolean };
export function preparationStep(state: PreparationState, action: PreparationAction): PreparationState {
  if (action.type === "self-report") return state.stage !== "whole-check" ? state : { ...state, stage: action.same ? "summary" : "choose-part", selfComparison: action.same ? "same" : null };
  if (action.type === "stage") return { ...state, stage: action.stage, selfComparison: null, repairScope: action.stage === "whole-check" ? "whole" : action.stage === "check" ? "part" : state.repairScope };
  if (action.type === "part") return { ...state, part: action.part, word: null, stage: action.stage ?? "words", repairScope: "part", selfComparison: null };
  if (action.type === "word") return { ...state, word: action.word, part: action.part ?? state.part, repairScope: "part" };
  if (action.type === "next-part") return state.part + 1 < action.count ? { ...state, part: state.part + 1, word: null, stage: "words" }
    : { ...state, join: 0, stage: action.count > 1 ? "join-model" : "whole-attempt" };
  return state.join + 1 < action.count - 1 ? { ...state, join: state.join + 1, stage: "join-model" } : { ...state, stage: "whole-attempt" };
}
/** Authoritative engine phrases, not equal word groups or guessed musical cuts. */
export function preparationParts(verse: AnalysedVerse): readonly (readonly [number, number])[] {
  return verse.phrases.length ? verse.phrases.map(phrase => phrase.units) : [[0, verse.units.length - 1]];
}
/** A join keeps both adjacent complete phrases and their actual transition in context. */
export function preparationJoin(parts: readonly (readonly [number, number])[], join: number): readonly [number, number] {
  return [parts[join][0], (parts[join + 1] ?? parts[join])[1]];
}
export const independentPreparation = (stage: PreparationStage) => stage === "attempt" || stage === "join-attempt" || stage === "whole-attempt";
