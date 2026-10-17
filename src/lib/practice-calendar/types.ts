/** Client-safe shapes; selectors never establish authority. */
export type PracticeCalendarMode = "student" | "parent" | "tutor" | "admin" | "child-practice";
export type PracticeSelection = Readonly<{ mode: PracticeCalendarMode; studentId: string }>;
export type PracticeWindow = Readonly<{ fromDate: string; throughDate: string }>;
export type PracticeTarget = Readonly<{ type: "verse"; kind: "torah" | "haftarah"; assignmentId: string; assignmentRevision: number; verseRef: string }>
  | Readonly<{ type: "service-unit"; catalogId: string; catalogIdentity: string; planId: string; planRevision: number; unitId: string }>;
export type PracticeAction = "visit" | "play" | "record";
export type PracticeEventWrite = Readonly<{ eventId: string; expectedDay: string; action: PracticeAction; target: PracticeTarget }>;
export type PracticeRawCursor = Readonly<{ receivedAt: string; eventId: string }>;
export type PracticeRawEvent = Readonly<{ eventId: string; practiceDay: string; receivedAtISO: string; action: PracticeAction; sourceMode: "student" | "child-practice"; target: PracticeTarget }>;
export type PracticeCalendarPage = Readonly<{ ok: true; studentId: string; mode: PracticeCalendarMode; serverDay: string; dates: readonly string[] }>;
export type PracticeRawPage = Readonly<{ ok: true; studentId: string; mode: "student"; events: readonly PracticeRawEvent[]; nextCursor: PracticeRawCursor | null }>;
export type PracticeDayAck = Readonly<{ ok: true; practiceDay: string }>;
export type PracticeCalendarFailure = Readonly<{ ok: false; code: "stale-day" | "stale-material" | "retention-expired" }>;
