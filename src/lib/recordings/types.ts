/** Metadata only: no value in this contract authorizes playback or upload. */
export type RecordingMode = "student" | "parent" | "child-practice" | "tutor" | "admin";
export type RecordingSelection = Readonly<{ studentId: string; mode: RecordingMode }>;
export type RecordingMediaView = Readonly<{ mediaType: "audio/webm;codecs=opus" | "audio/mp4;codecs=mp4a.40.2"; byteLength: number; durationMs: number }>;
export type StudentRecordingView = Readonly<{ id: string; revision: number; state: "private" | "submitted"; media: RecordingMediaView; recordedDate: string; submittedDate?: string }>;
export type StaffRecordingView = Readonly<{ id: string; revision: number; state: "submitted"; media: RecordingMediaView; submittedDate: string }>;
export type RecordingPage = Readonly<{ ok: true; studentId: string; mode: RecordingMode; entries: readonly (StudentRecordingView | StaffRecordingView)[]; nextCursor: string | null }>;
export type RecordingWrite = Readonly<{ recordingId: string; expectedRevision: number }>;
export type RecordingReceipt = Readonly<{ ok: true; recording: Readonly<{ id: string; revision: number; state: "private" | "submitted" | "deleting" }> }>;
export type RecordingConflict = Readonly<{ ok: false; code: "conflict" }>;
