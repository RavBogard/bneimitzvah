import type { FamilyId } from "../trope/chart-catalog";
import { COURSE, pathLessons, type Lesson, type Melody } from "./course";

/** N18, producing the chant: from zakef on, a phrase's own lesson comes at or after zakef's on its path. Only the two endings before it keep a recording in front of the question. */
export function fromZakef(family: FamilyId, melody: Melody): boolean {
  const path = pathLessons(melody), at = path.findIndex(lesson => lesson.family === family), zakef = path.findIndex(lesson => lesson.family === "zakef");
  return at >= 0 && zakef >= 0 && at >= zakef;
}
/** A review card in this box or a higher one gets the harder item: the tune from the text, the ending with no recording first. */
export const HARDER_FROM_BOX = 3;
export const isHarder = (box: number): boolean => box >= HARDER_FROM_BOX;
/** The lesson that teaches a family in one melody, for the "More about" link after a miss. */
export const lessonOfFamily = (family: FamilyId, melody: Melody): Lesson | null => COURSE.lessons.find(lesson => lesson.family === family && lesson.melody === melody) ?? null;
