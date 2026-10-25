import { COURSE, isDrill, type Drill, type Lesson } from "./course";
import type { FamilyId } from "../trope/chart-catalog";
import type { AnalysedVerse } from "./verse";
import type { Progress } from "./progress";
import type { Phrase, Pools } from "./pools";

export type SoundStage = "model" | "echo" | "attempt" | "compare" | "word" | "tune" | "unsure" | "context";
export type SoundState = Readonly<{ stage: SoundStage; word: number | null; comparison: "familiar" | "revisit" | null }>;
export const startSound = (): SoundState => ({ stage: "model", word: null, comparison: null });
export type SoundAction = { type: "stage"; stage: SoundStage } | { type: "word"; word: number } | { type: "compare"; comparison: "familiar" | "revisit" };
export function soundStep(state: SoundState, action: SoundAction): SoundState {
  if (action.type === "word") return { ...state, word: action.word };
  if (action.type === "compare") return state.stage === "compare" ? { ...state, comparison: action.comparison } : state;
  return { ...state, stage: action.stage, comparison: null };
}
/** An ordinary lesson models its exact validated catalogue range. Orientation starts with one real engine phrase. */
export function soundRange(lesson: Lesson, verse: AnalysedVerse, example: readonly [number, number]): readonly [number, number] | null {
  if (!verse.wordReady || example[0] < 0 || example[1] >= verse.units.length || example[1] < example[0]) return null;
  if (lesson.id !== "intro-phrases") return example;
  return verse.phrases.find(phrase => example[0] <= phrase.units[0] && phrase.units[1] <= example[1])?.units ?? null;
}
export function taughtSoundFamilies(lesson: Lesson, progress: Progress | null, modeled: ReadonlySet<FamilyId>): ReadonlySet<FamilyId> {
  return new Set([...(lesson.family ? [lesson.family] : []), ...modeled, ...COURSE.lessons.filter(row => row.melody === lesson.melody && row.family && progress?.lessons[row.id]).map(row => row.family!)]);
}
/** Old catalogue drills remain a data API. Course use requires taught options and never asserts family == acoustic sameness. */
export function optionalSoundDrills(lesson: Lesson, taught: ReadonlySet<FamilyId>): Drill[] {
  if (lesson.id === "intro-phrases") return [];
  return lesson.activities.filter(isDrill).flatMap<Drill>(activity => {
    if (activity.type === "same-or-different") return [];
    if (activity.type === "look-alikes") return [activity];
    if (activity.type === "build-the-phrase") return taught.has(activity.params.family) ? [activity] : [];
    const families = activity.params.families.filter(family => taught.has(family));
    if (!families.length || activity.type === "hear-and-name" && families.length < 2) return [];
    return [{ ...activity, params: { ...activity.params, families, ...(activity.type === "hear-and-name" ? { choices: Math.min(activity.params.choices, families.length) } : {}) } } as Drill];
  });
}
export type SoundExample = Readonly<{ example: Readonly<{ words: readonly [number, number] }>; verse: AnalysedVerse }>;
export type SoundAnchor = Readonly<{ family: FamilyId; phrase: Phrase; verse: AnalysedVerse }>;
/** Use the validated authored family example, never an incidental verse-pool variant. */
export function soundAnchors(lesson: Lesson, examples: ReadonlyMap<string, readonly SoundExample[]>): SoundAnchor[] {
  const families = new Set<FamilyId>(lesson.family ? [lesson.family] : []);
  for (const activity of lesson.activities.filter(isDrill)) {
    if (activity.type === "build-the-phrase") families.add(activity.params.family);
    else if (activity.type !== "look-alikes") for (const family of activity.params.families) families.add(family);
  }
  return [...families].flatMap(family => {
    const source = COURSE.lessons.find(row => row.family === family && row.melody === lesson.melody);
    const target = source && examples.get(source.id)?.[0];
    if (!target || !target.verse.wordReady) return [];
    const { verse, example } = target, words = example.words;
    if (verse.units[words[1]]?.family !== family) return [];
    const phrase: Phrase = { ref: verse.ref, kind: verse.kind, family, words, tropes: verse.units.slice(words[0], words[1] + 1).map(unit => unit.trope), book: verse.book, verseUnits: verse.units.length };
    return [{ family, phrase, verse }];
  });
}
/** First recognition retrieves displayed models; structural practice keeps its full original pools. */
export function soundAnchorPools(pools: Pools, anchors: readonly SoundAnchor[]): Pools {
  const families = new Map<FamilyId, ReadonlyMap<Lesson["melody"], readonly Phrase[]>>();
  for (const anchor of anchors) families.set(anchor.family, new Map([[anchor.phrase.kind, [anchor.phrase]]]));
  return { families, verses: pools.verses };
}
