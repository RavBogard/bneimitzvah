import type { Progress } from "./progress";
import { isDone, nextLesson } from "./progress";
import { lessonById } from "./course";

/** A usable verse follows the two endings; the remaining catalogue stays available as a library. */
export function recommendedLesson(progress: Progress) {
  for (const melody of ["torah", "haftarah"] as const) {
    if (isDone(progress, `${melody}-sof-pasuk`) && isDone(progress, `${melody}-etnachta`) && !isDone(progress, `${melody}-first-verse`)) return lessonById(`${melody}-first-verse`)!;
  }
  return nextLesson(progress);
}
