/** Client-safe contract; authorization and persistence stay server-only. */
export type LessonLogMode = "student" | "parent" | "tutor" | "admin" | "child-practice";
export type LessonLogSelection = Readonly<{ mode: LessonLogMode; studentId: string }>;
export type LessonLogCursor = Readonly<{ lessonDate: string; entryId: string }>;
/** beforeNext: the optional "Before next time" line (N12). null clears it; on an edit, leaving it out keeps the saved line. */
export type LessonLogCreate = Readonly<{ entryId: string; lessonDate: string; summary: string; beforeNext?: string | null }>;
export type LessonLogEdit = LessonLogCreate & Readonly<{ expectedVersion: number }>;
export type LessonLogDelete = Readonly<{ entryId: string; expectedVersion: number }>;
export type LessonLogEntry = Readonly<{ entryId: string; lessonDate: string; summary: string; beforeNext: string | null; version: number; displayName: string; canEdit: boolean; canDelete: boolean }>;
export type LessonLogPage = Readonly<{ ok: true; studentId: string; mode: LessonLogMode; entries: readonly LessonLogEntry[]; nextCursor: LessonLogCursor | null }>;
export type LessonLogChanged = Readonly<{ ok: true; entry: LessonLogEntry }>;
export type LessonLogRemoved = Readonly<{ ok: true; entryId: string; version: number }>;
export type LessonLogConflict = Readonly<{ ok: false; code: "conflict" }>;
