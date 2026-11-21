export type ReadingRecording = "shermet" | "pockettorah";
export const DEFAULT_READING_RECORDING: ReadingRecording = "shermet";
export type RecordingCheck = "available" | "missing" | "unknown";
export type RecordingCoverage = Readonly<{ verse: RecordingCheck; word: RecordingCheck }>;
export type PlaybackCoverage = ReadingRecording | "missing" | "unknown";
export type VerseRecordingCoverage = Readonly<{ ref: string; verse: PlaybackCoverage; word: PlaybackCoverage }>;

export function preferredReadingSource(preference: ReadingRecording, shermetAvailable: boolean): ReadingRecording {
  return preference === "shermet" && shermetAvailable ? "shermet" : "pockettorah";
}

export function resolveReadingCoverage(shermet: RecordingCheck, pocketTorah: RecordingCheck): PlaybackCoverage {
  if (shermet === "unknown") return "unknown";
  const source = preferredReadingSource(DEFAULT_READING_RECORDING, shermet === "available");
  return source === "shermet" || pocketTorah === "available" ? source : pocketTorah;
}
