import "server-only";
import type {
  RecordingLimits, RecordingMedia, RecordingMetadata, RecordingOperation, RecordingResult,
  RecordingTransition, SubmissionRetention,
} from "./types";

// Engineering bounds for this internal slice, not Daniel's product limits.
export const DEFAULT_RECORDING_LIMITS: RecordingLimits = Object.freeze({
  maxByteLength: 32 * 1024 * 1024,
  maxDurationMs: 10 * 60 * 1000,
  maxRevision: 2_147_483_647,
});
const invalid = Object.freeze({ ok: false, error: "invalid-recording" } as const);
const conflict = Object.freeze({ ok: false, error: "recording-conflict" } as const);
const success = <T>(value: T): RecordingResult<T> => Object.freeze({ ok: true, value });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const id = (value: unknown): value is string => typeof value === "string" && uuid.test(value);
// Existing tenant primary keys are text (including "crc"), not UUIDs. Keep
// their exact spelling; the syntax bound supplies no tenant authority.
const tenantKey = (value: unknown): value is string => typeof value === "string" &&
  value.length >= 1 && value.length <= 64 && /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value);
const positiveInteger = (value: unknown, max: number): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= max;

// Inspect data properties without invoking user-defined getters. Unknown keys,
// symbols, accessors and non-plain prototypes fail closed. The public functions
// also catch proxies that throw during inspection.
function closed(input: unknown, keys: readonly string[]): Record<string, unknown> | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const proto = Object.getPrototypeOf(input);
  if (proto !== Object.prototype && proto !== null) return null;
  const own = Reflect.ownKeys(input);
  if (own.length !== keys.length || own.some((key) => typeof key !== "string" || !keys.includes(key))) return null;
  const copy = Object.create(null) as Record<string, unknown>;
  for (const key of keys) {
    const property = Object.getOwnPropertyDescriptor(input, key);
    if (!property || !Object.hasOwn(property, "value") || !property.enumerable) return null;
    copy[key] = property.value;
  }
  return copy;
}
function limitsFrom(input: unknown): RecordingLimits | null {
  const value = closed(input, ["maxByteLength", "maxDurationMs", "maxRevision"]);
  if (!value || !positiveInteger(value.maxByteLength, Number.MAX_SAFE_INTEGER) ||
    !positiveInteger(value.maxDurationMs, Number.MAX_SAFE_INTEGER) ||
    !positiveInteger(value.maxRevision, Number.MAX_SAFE_INTEGER)) return null;
  return Object.freeze({ maxByteLength: value.maxByteLength, maxDurationMs: value.maxDurationMs, maxRevision: value.maxRevision });
}
function mediaFrom(input: unknown, limits: RecordingLimits): RecordingMedia | null {
  const value = closed(input, ["mediaType", "byteLength", "durationMs"]);
  if (!value || (value.mediaType !== "audio/webm;codecs=opus" && value.mediaType !== "audio/mp4;codecs=mp4a.40.2") ||
    !positiveInteger(value.byteLength, limits.maxByteLength) || !positiveInteger(value.durationMs, limits.maxDurationMs)) return null;
  return Object.freeze({ mediaType: value.mediaType, byteLength: value.byteLength, durationMs: value.durationMs });
}
function metadataFrom(input: unknown, limits: RecordingLimits): RecordingMetadata | null {
  // Read the discriminator as a data property, before choosing the closed schema.
  if (!input || typeof input !== "object") return null;
  const kind = Object.getOwnPropertyDescriptor(input, "kind");
  if (!kind || !Object.hasOwn(kind, "value")) return null;
  const student = kind.value === "student-recording";
  if (!student && kind.value !== "reference-recording") return null;
  const value = closed(input, student
    ? ["kind", "id", "tenantId", "revision", "media", "studentId", "state"]
    : ["kind", "id", "tenantId", "revision", "media", "verse", "state"]);
  if (!value || !id(value.id) || !tenantKey(value.tenantId) || !positiveInteger(value.revision, limits.maxRevision)) return null;
  const media = mediaFrom(value.media, limits);
  if (!media) return null;
  const base = { id: value.id, tenantId: value.tenantId, revision: value.revision, media };
  if (student) {
    if (!id(value.studentId) || !["private", "submitted", "deleting", "deleted"].includes(value.state as string)) return null;
    return Object.freeze({ ...base, kind: "student-recording", studentId: value.studentId, state: value.state as "private" | "submitted" | "deleting" | "deleted" });
  }
  const verse = closed(value.verse, ["reading", "verseId"]);
  if (!verse || (verse.reading !== "torah" && verse.reading !== "haftarah") || !id(verse.verseId) ||
    !["available", "deleting", "deleted"].includes(value.state as string)) return null;
  return Object.freeze({ ...base, kind: "reference-recording", state: value.state as "available" | "deleting" | "deleted",
    verse: Object.freeze({ reading: verse.reading, verseId: verse.verseId }) });
}
function operationFrom(input: unknown, limits: RecordingLimits): RecordingOperation | null {
  const value = closed(input, ["operation", "recordingId", "expectedRevision"]);
  if (!value || !["submit", "begin-delete", "complete-delete"].includes(value.operation as string) ||
    !id(value.recordingId) || !positiveInteger(value.expectedRevision, limits.maxRevision)) return null;
  return Object.freeze({ operation: value.operation as RecordingOperation["operation"], recordingId: value.recordingId, expectedRevision: value.expectedRevision });
}

/** Only capture facts cross this boundary; no owner, filename or storage locator. */
export function validateRecordingMedia(input: unknown, limits: unknown = DEFAULT_RECORDING_LIMITS): RecordingResult<RecordingMedia> {
  try {
    const bounds = limitsFrom(limits);
    const value = bounds && mediaFrom(input, bounds);
    return value ? success(value) : invalid;
  } catch { return invalid; }
}

/** For metadata loaded internally; validity does not establish ownership/access. */
export function validateRecordingMetadata(input: unknown, limits: unknown = DEFAULT_RECORDING_LIMITS): RecordingResult<RecordingMetadata> {
  try {
    const bounds = limitsFrom(limits);
    const value = bounds && metadataFrom(input, bounds);
    return value ? success(value) : invalid;
  } catch { return invalid; }
}
export function validateRecordingOperation(input: unknown, limits: unknown = DEFAULT_RECORDING_LIMITS): RecordingResult<RecordingOperation> {
  try {
    const bounds = limitsFrom(limits);
    const value = bounds && operationFrom(input, bounds);
    return value ? success(value) : invalid;
  } catch { return invalid; }
}

/** Pure proposal only: future persistence must atomically compare revision and
 * fresh server-bound tenant/student/context before writing or exposing anything. */
export function transitionRecording(metadata: unknown, operation: unknown, limits: unknown = DEFAULT_RECORDING_LIMITS): RecordingResult<RecordingTransition> {
  try {
    const bounds = limitsFrom(limits);
    if (!bounds) return invalid;
    const recording = metadataFrom(metadata, bounds);
    const command = operationFrom(operation, bounds);
    if (!recording || !command) return invalid;
    if (command.recordingId !== recording.id || command.expectedRevision !== recording.revision) return conflict;
    let state: RecordingMetadata["state"];
    if (command.operation === "submit") {
      if (recording.kind !== "student-recording" || (recording.state !== "private" && recording.state !== "submitted")) return conflict;
      state = "submitted";
    } else if (command.operation === "begin-delete") {
      state = recording.state === "deleted" ? "deleted" : "deleting";
    } else {
      if (recording.state !== "deleting" && recording.state !== "deleted") return conflict;
      state = "deleted";
    }
    if (state === recording.state) return success(Object.freeze({ recording, changed: false }));
    if (recording.revision === bounds.maxRevision) return conflict;
    // Each branch above preserves the kind-specific state set.
    const next = metadataFrom({ ...recording, state, revision: recording.revision + 1 }, bounds);
    return next ? success(Object.freeze({ recording: next, changed: true })) : invalid;
  } catch { return invalid; }
}

const leap = (year: number) => year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
function dateFrom(input: unknown): { year: number; month: number; day: number } | null {
  if (typeof input !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(input)) return null;
  const year = Number(input.slice(0, 4));
  const month = Number(input.slice(5, 7));
  const day = Number(input.slice(8, 10));
  const days = [31, leap(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1] ? { year, month, day } : null;
}

/** UTC-style ISO date-only comparison; the caller must supply a freshly bound
 * authoritative ceremony date and validated current date. No clock or scheduler
 * is installed here. Private/reference/deletion records gain no retention rule. */
export function studentSubmissionRetention(metadata: unknown, ceremonyDate: unknown, currentDate: unknown,
  limits: unknown = DEFAULT_RECORDING_LIMITS): RecordingResult<SubmissionRetention> {
  try {
    const bounds = limitsFrom(limits);
    const ceremony = dateFrom(ceremonyDate);
    if (!bounds || !ceremony || !dateFrom(currentDate) || ceremony.year === 9999) return invalid;
    const recording = metadataFrom(metadata, bounds);
    if (!recording) return invalid;
    if (recording.kind !== "student-recording" || recording.state !== "submitted") return success(Object.freeze({ applies: false }));
    const year = ceremony.year + 1;
    const day = ceremony.month === 2 && ceremony.day === 29 && !leap(year) ? 28 : ceremony.day;
    const deadlineDate = `${String(year).padStart(4, "0")}-${String(ceremony.month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    return success(Object.freeze({ applies: true, deadlineDate, deleteDue: (currentDate as string) >= deadlineDate }));
  } catch { return invalid; }
}
