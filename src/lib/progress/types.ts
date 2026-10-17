// Client-safe wire shapes only. All authority and persistence remain server-side.
export const selfCheckStates = ["unmarked", "working", "got-it"] as const;
export const assessmentStates = ["not-started", "working", "solid"] as const;
export type SelfCheckState = typeof selfCheckStates[number];
export type AssessmentState = typeof assessmentStates[number];
export type ProgressMode = "student" | "parent" | "tutor" | "admin" | "child-practice";
export type ProgressStream = "self-check" | "assessment";
export type ProgressBinding = Readonly<{ studentId: string; mode: ProgressMode; kind: "torah" | "haftarah"; assignmentId: string; assignmentRevision: number }>;
export type ProgressSelection = ProgressBinding;
export type ProgressWrite = Readonly<{ verseRef: string; state: SelfCheckState | AssessmentState; expectedVersion: number }>;
export type SelfCheckRequest = Omit<ProgressBinding, "studentId"> & Readonly<{ verseRef: string; state: SelfCheckState; expectedVersion: number }>;
export type AssessmentRequest = Omit<ProgressBinding, "studentId"> & Readonly<{ verseRef: string; state: AssessmentState; expectedVersion: number }>;
export type ProgressVerse = Readonly<{ verseRef: string; selfCheck: Readonly<{ state: SelfCheckState; version: number }>; assessment: Readonly<{ state: AssessmentState; version: number }> }>;
export type ProgressCounts = Readonly<{ selfCheck: Readonly<Record<SelfCheckState, number>>; assessment: Readonly<Record<AssessmentState, number>> }>;
export type ProgressFailure = Readonly<{ ok: false; code: "stale-assignment" | "conflict" }>;
export type ProgressPage = Readonly<{ ok: true; binding: ProgressBinding; offset: number; nextOffset: number | null; totalVerses: number; verses: readonly ProgressVerse[]; counts: ProgressCounts }>;
export type ProgressChanged = Readonly<{ ok: true; binding: ProgressBinding; verseRef: string; stream: ProgressStream; state: SelfCheckState | AssessmentState; version: number }>;
