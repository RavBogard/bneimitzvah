import { COURSE, FAMILY_IDS, MELODIES, pathLessons, type Melody } from "../learn/course";
import type { FamilyId } from "../trope/chart-catalog";
import type { LearnHeard, PracticeLearn } from "./types";

/**
 * 1.9 N23: the Learn to lein lines the assigned tutor sees, from the lesson ids done and each card's Leitner box (0052's
 * Learn view gives nothing else: no done instants, no due dates).
 *
 * "Can hear": the families whose lesson is done, per path, as the learner's own `heard` counts them.
 *
 * "Often mixed up": the course's own confusable pairs (lessons.json `confusedWith`) where both families are taught in the same
 * path and both are weak there: each family's lowest box over its cards in that path is 0 or 1, and at least one is 0. Box 0
 * only follows a miss (a right answer moves a card up; a new card starts in box 1), so a pair shows only after a miss. The pair
 * with the lowest sum of boxes wins; ties go to the Torah path, then the course's own family order. Null when no pair qualifies.
 */
export function heardOf(lessons: ReadonlySet<string>, melody: Melody): LearnHeard {
  const families = pathLessons(melody).filter(lesson => lesson.family);
  return { heard: families.filter(lesson => lessons.has(lesson.id)).length, of: families.length };
}

export function mixedUpPair(lessons: ReadonlySet<string>, boxes: Readonly<Record<string, unknown>>): readonly [string, string] | null {
  let best: { score: number; pair: [FamilyId, FamilyId] } | null = null;
  for (const melody of MELODIES) {
    const taught = new Set(pathLessons(melody).filter(lesson => lesson.family && lessons.has(lesson.id)).map(lesson => lesson.family!));
    const lowest = (family: FamilyId) => {
      let low: number | null = null;
      for (const [id, box] of Object.entries(boxes)) {
        const [cardFamily, cardMelody] = id.split(":");
        if (cardFamily !== family || cardMelody !== melody || !Number.isSafeInteger(box) || (box as number) < 0 || (box as number) > 5) continue;
        low = low === null ? box as number : Math.min(low, box as number);
      }
      return low;
    };
    for (const [i, a] of FAMILY_IDS.entries()) for (const b of FAMILY_IDS.slice(i + 1)) {
      if (!COURSE.families[a].confusedWith.includes(b) && !COURSE.families[b].confusedWith.includes(a)) continue;
      if (!taught.has(a) || !taught.has(b)) continue;
      const boxA = lowest(a), boxB = lowest(b);
      if (boxA === null || boxB === null || Math.max(boxA, boxB) > 1 || Math.min(boxA, boxB) !== 0) continue;
      const score = boxA + boxB;
      if (!best || score < best.score) best = { score, pair: boxB < boxA ? [b, a] : [a, b] };
    }
  }
  return best ? [COURSE.families[best.pair[0]].name, COURSE.families[best.pair[1]].name] : null;
}

export function learnSummary(lessonIds: readonly string[], boxes: Readonly<Record<string, unknown>>): PracticeLearn {
  const lessons = new Set(lessonIds);
  return { torah: heardOf(lessons, "torah"), haftarah: heardOf(lessons, "haftarah"), mixedUp: mixedUpPair(lessons, boxes) };
}
