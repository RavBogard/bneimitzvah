/**
 * 1.9 N23 (decision 7): what the server answers about a student's practice. Dates only (YYYY-MM-DD, America/Chicago), verse
 * references, mark states and whether a parent was there. Never a time of day, a duration, an action, a play count or a score.
 */
export type PracticeKind = "torah" | "haftarah";
export type PracticeMarkState = "working" | "got-it";
/** One day: per reading, the verses opened that day (and any marked that day), and the marks made that day. */
export type PracticeDayReading = Readonly<{ kind: PracticeKind; opened: readonly string[]; marked: readonly Readonly<{ verseRef: string; state: PracticeMarkState }>[] }>;
export type PracticeDay = Readonly<{ day: string; readings: readonly PracticeDayReading[] }>;
/** A verse's current mark. withParent is null for a mark made before 0052 recorded it. */
export type PracticeMark = Readonly<{ kind: PracticeKind; verseRef: string; state: PracticeMarkState; withParent: boolean | null }>;
export type LearnHeard = Readonly<{ heard: number; of: number }>;
/** Learn to lein: the "Can hear" counts per path and the pair of families most often mixed up (family names), or null. */
export type PracticeLearn = Readonly<{ torah: LearnHeard; haftarah: LearnHeard; mixedUp: readonly [string, string] | null }>;
/** The assigned tutor's view of one student. */
export type TutorPractice = Readonly<{
  from: string; today: string; days: readonly PracticeDay[]; marks: readonly PracticeMark[];
  practisedDays: number; lastLesson: string | null; stillWorking: number; learn: PracticeLearn | null;
}>;
/** A parent's view: how many verses are marked, and nothing per day. */
export type ParentPractice = Readonly<{ gotIt: number; working: number }>;
