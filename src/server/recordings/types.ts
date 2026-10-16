import "server-only";

/** Internal policy data, never an authorization proof or a transport response. */
export type RecordingLimits = Readonly<{
  maxByteLength: number;
  maxDurationMs: number;
  maxRevision: number;
}>;
export type RecordingMedia = Readonly<{
  mediaType: "audio/webm;codecs=opus" | "audio/mp4;codecs=mp4a.40.2";
  byteLength: number;
  durationMs: number;
}>;
type RecordingBase = Readonly<{
  id: string;
  tenantId: string;
  revision: number;
  media: RecordingMedia;
}>;
export type StudentRecording = RecordingBase & Readonly<{
  kind: "student-recording";
  studentId: string;
  state: "private" | "submitted" | "deleting" | "deleted";
}>;
export type ReferenceRecording = RecordingBase & Readonly<{
  kind: "reference-recording";
  state: "available" | "deleting" | "deleted";
  verse: Readonly<{ reading: "torah" | "haftarah"; verseId: string }>;
}>;
export type RecordingMetadata = StudentRecording | ReferenceRecording;
export type RecordingOperation = Readonly<{
  operation: "submit" | "begin-delete" | "complete-delete";
  recordingId: string;
  expectedRevision: number;
}>;
export type RecordingResult<T> = Readonly<{ ok: true; value: T }> |
  Readonly<{ ok: false; error: "invalid-recording" | "recording-conflict" }>;
export type RecordingTransition = Readonly<{ recording: RecordingMetadata; changed: boolean }>;
export type SubmissionRetention = Readonly<{ applies: false }> | Readonly<{
  applies: true;
  deadlineDate: string;
  deleteDue: boolean;
}>;
