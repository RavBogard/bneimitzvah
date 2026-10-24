import type { FamilyId } from "../trope/chart-catalog";
import { COURSE, MELODY_FAMILIES, pathLessons, type HearAndName, type Melody, type Practice } from "./course";
import { isDone, type Progress } from "./progress";

/**
 * Practice runs that are not lessons (1.6): Quick ten. Pure, so the page and the tests share it.
 * Quick ten is hear-and-name over the families the learner has heard in that melody, three choices each,
 * and answers the same name cards hear-and-name does.
 */
export const QUICK_TEN_MIN_FAMILIES = 3;
/** The families whose lesson is done in a melody, in the path's order. */
export function heardFamilies(progress: Progress, melody: Melody): FamilyId[] {
  return pathLessons(melody).filter(lesson => lesson.family && isDone(progress, lesson.id) && MELODY_FAMILIES[melody].includes(lesson.family)).map(lesson => lesson.family!);
}
/** Open once its lesson is done and three families are heard in its melody. */
export const practiceOpen = (progress: Progress, practice: Practice) =>
  isDone(progress, practice.unlockAfter) && heardFamilies(progress, practice.melody).length >= QUICK_TEN_MIN_FAMILIES;
/** The practice runs open to this learner, in course order. */
export const openPractice = (progress: Progress): Practice[] => COURSE.practice.filter(practice => practiceOpen(progress, practice));
/** The hear-and-name drill a Quick ten runs: every heard family, its ten items and three choices. */
export function quickTenDrill(practice: Practice, families: readonly FamilyId[]): HearAndName {
  const { items, choices } = practice.activity.params;
  return Object.freeze({ type: "hear-and-name", params: Object.freeze({ families: Object.freeze([...families]), items, choices: Math.min(choices, families.length), weight: Object.freeze({}) }) });
}
