import { describe, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import {
  DEFAULT_RECORDING_LIMITS, studentSubmissionRetention, transitionRecording,
  validateRecordingMedia, validateRecordingMetadata, validateRecordingOperation,
} from "../../src/server/recordings/policy";
import type { RecordingMetadata, RecordingResult } from "../../src/server/recordings/types";

const ids = {
  recording: "10000000-0000-0000-0000-000000000001",
  tenant: "20000000-0000-0000-0000-000000000001",
  student: "30000000-0000-0000-0000-000000000001",
  verse: "40000000-0000-0000-0000-000000000001",
  other: "50000000-0000-0000-0000-000000000001",
};
const media = () => ({ mediaType: "audio/webm;codecs=opus", byteLength: 1024, durationMs: 5000 });
const student = (state = "private", revision = 1) => ({
  kind: "student-recording", id: ids.recording, tenantId: ids.tenant, studentId: ids.student,
  revision, state, media: media(),
});
const reference = () => ({
  kind: "reference-recording", id: ids.recording, tenantId: ids.tenant, revision: 1,
  state: "available", media: media(), verse: { reading: "torah", verseId: ids.verse },
});
const operation = (name = "submit", revision = 1) => ({ operation: name, recordingId: ids.recording, expectedRevision: revision });
function value<T>(result: RecordingResult<T>): T {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("Expected valid policy result");
  return result.value;
}
const invalid = { ok: false, error: "invalid-recording" };
const conflict = { ok: false, error: "recording-conflict" };

describe("closed recording boundaries", () => {
  test("allows only explicit WebM/Opus and MP4/AAC declarations at inclusive configured bounds", () => {
    for (const mediaType of ["audio/webm;codecs=opus", "audio/mp4;codecs=mp4a.40.2"]) {
      const input = { mediaType, byteLength: 10, durationMs: 20 };
      expect(value(validateRecordingMedia(input, { maxByteLength: 10, maxDurationMs: 20, maxRevision: 2 }))).toEqual(input);
    }
  });
  test.each(["audio/webm", "audio/mp4", "audio/mpeg", "audio/webm;codecs=vorbis", "audio/mp4;codecs=opus", "audio/wav", "Audio/WebM;codecs=opus"])("rejects undeclared/unsupported media %s", (mediaType) => {
    expect(validateRecordingMedia({ ...media(), mediaType })).toEqual(invalid);
  });
  test.each([0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "1", null])("rejects malformed sizes and durations: %s", (bad) => {
    expect(validateRecordingMedia({ ...media(), byteLength: bad })).toEqual(invalid);
    expect(validateRecordingMedia({ ...media(), durationMs: bad })).toEqual(invalid);
  });
  test("enforces default and custom bounds and rejects malformed configuration", () => {
    expect(validateRecordingMedia({ ...media(), byteLength: DEFAULT_RECORDING_LIMITS.maxByteLength + 1 })).toEqual(invalid);
    expect(validateRecordingMedia({ ...media(), durationMs: DEFAULT_RECORDING_LIMITS.maxDurationMs + 1 })).toEqual(invalid);
    expect(validateRecordingMedia(media(), { ...DEFAULT_RECORDING_LIMITS, maxByteLength: 1 })).toEqual(invalid);
    for (const limits of [null, {}, { ...DEFAULT_RECORDING_LIMITS, maxRevision: 0 }, { ...DEFAULT_RECORDING_LIMITS, maxDurationMs: Infinity }, { ...DEFAULT_RECORDING_LIMITS, extra: true }]) {
      expect(validateRecordingMedia(media(), limits)).toEqual(invalid);
      expect(transitionRecording(student(), operation(), limits)).toEqual(invalid);
    }
  });
  test.each(["tenantId", "studentId", "ownerId", "url", "storageUrl", "filename", "generated", "role", "consent"])("capture descriptors cannot smuggle %s", (field) => {
    expect(validateRecordingMedia({ ...media(), [field]: "untrusted-synthetic" })).toEqual(invalid);
  });
  test("rejects missing, inherited, symbolic, hidden and accessor fields without invoking getters", () => {
    const getter = vi.fn(() => "audio/webm;codecs=opus");
    const accessor = Object.defineProperty({ byteLength: 1, durationMs: 1 }, "mediaType", { get: getter, enumerable: true });
    const hidden = Object.defineProperty(media(), "mediaType", { value: "audio/webm;codecs=opus", enumerable: false });
    for (const input of [null, [], "audio", { byteLength: 1 }, Object.assign(Object.create({ owner: true }), media()), { ...media(), [Symbol("hidden")]: true }, hidden, accessor,
      JSON.parse('{"mediaType":"audio/webm;codecs=opus","byteLength":1,"durationMs":1,"__proto__":{}}')]) {
      expect(validateRecordingMedia(input)).toEqual(invalid);
    }
    expect(getter).not.toHaveBeenCalled();
    expect(value(validateRecordingMedia(Object.assign(Object.create(null), media())))).toEqual(media());
  });
  test("throwing proxies fail closed with generic errors and no input echo", () => {
    const proxy = new Proxy({}, { getOwnPropertyDescriptor() { throw new Error("synthetic-secret"); }, getPrototypeOf() { throw new Error("synthetic-secret"); } });
    for (const result of [validateRecordingMedia(proxy), validateRecordingMetadata(proxy), validateRecordingOperation(proxy), transitionRecording(proxy, operation()), studentSubmissionRetention(proxy, "2026-01-01", "2027-01-01")]) {
      expect(result).toEqual(invalid);
      expect(JSON.stringify(result)).not.toContain("synthetic-secret");
      expect(Object.isFrozen(result)).toBe(true);
    }
  });
  test("metadata is closed, discriminated and bounded; generated audio is never a recording kind", () => {
    expect(value(validateRecordingMetadata(student()))).toEqual(student());
    expect(value(validateRecordingMetadata(reference()))).toEqual(reference());
    for (const input of [
      { ...student(), kind: "generated-recording" }, { ...reference(), kind: "generated-chant" }, { ...student(), state: "published" },
      { ...student(), id: "https://invalid.example/synthetic" }, { ...student(), tenantId: "x".repeat(10000) },
      { ...student(), studentId: "" }, { ...student(), revision: 0 }, { ...student(), revision: 1.5 },
      { ...student(), revision: DEFAULT_RECORDING_LIMITS.maxRevision + 1 }, { ...student(), storageKey: "synthetic" },
      { ...student(), media: { ...media(), filename: "synthetic" } }, { ...student(), verse: reference().verse },
      { ...reference(), studentId: ids.student }, { ...reference(), state: "submitted" },
      { ...reference(), verse: { reading: "prayer", verseId: ids.verse } },
      { ...reference(), verse: { reading: "torah", verseId: ids.verse, url: "synthetic" } },
      { ...reference(), verse: { reading: "haftarah", verseId: "" } },
    ]) expect(validateRecordingMetadata(input)).toEqual(invalid);
    expect(value(validateRecordingMetadata({ ...reference(), verse: { reading: "haftarah", verseId: ids.verse } })).kind).toBe("reference-recording");
  });
  test.each(["crc", "other", "CRC-Practice_2", "a".repeat(64)])("preserves the exact bounded text tenant key %s", (tenantId) => {
    for (const metadata of [student(), reference()]) {
      expect(value(validateRecordingMetadata({ ...metadata, tenantId })).tenantId).toBe(tenantId);
    }
    expect(value(transitionRecording({ ...student(), tenantId }, operation())).recording.tenantId).toBe(tenantId);
  });
  test.each(["", " crc", "crc ", "cr c", "crc\n", "crc\t", "crc\u0000", "https://invalid.example", "crc/other", "crc.other", "a".repeat(65), null])("rejects invalid text tenant key %s", (tenantId) => {
    expect(validateRecordingMetadata({ ...student(), tenantId })).toEqual(invalid);
    expect(validateRecordingMetadata({ ...reference(), tenantId })).toEqual(invalid);
  });
  test("operations accept only IDs/revisions and explicit supported commands", () => {
    expect(value(validateRecordingOperation(operation()))).toEqual(operation());
    for (const input of [{ ...operation(), role: "admin" }, { ...operation(), tenantId: ids.tenant }, { ...operation(), expectedRevision: "1" },
      { ...operation(), expectedRevision: 0 }, { ...operation(), recordingId: "synthetic" }, operation("publish"), operation("restore"), operation("Submit")]) {
      expect(validateRecordingOperation(input)).toEqual(invalid);
    }
  });
  test("results are detached immutable data including nested media and verse", () => {
    const input = reference();
    const result = validateRecordingMetadata(input);
    const record = value(result);
    input.media.byteLength = 99;
    input.verse.reading = "haftarah";
    expect(record.media.byteLength).toBe(1024);
    expect(record.kind === "reference-recording" && record.verse.reading).toBe("torah");
    expect([result, record, record.media, record.kind === "reference-recording" && record.verse].every(Object.isFrozen)).toBe(true);
  });
});

describe("explicit lifecycle proposals", () => {
  test("validation leaves a private recording private; explicit submit alone changes it", () => {
    const input = student();
    expect(value(validateRecordingMetadata(input)).state).toBe("private");
    const result = value(transitionRecording(input, operation()));
    expect(result.recording.state).toBe("submitted");
    expect(result.recording.revision).toBe(2);
    expect(result.changed).toBe(true);
    expect(input.state).toBe("private");
    expect(Object.isFrozen(result)).toBe(true);
  });
  test("repeated submissions require the current revision and never republish/increment", () => {
    const submitted = value(transitionRecording(student(), operation())).recording;
    expect(transitionRecording(submitted, operation())).toEqual(conflict);
    expect(value(transitionRecording(submitted, operation("submit", 2)))).toEqual({ recording: submitted, changed: false });
  });
  test("concurrent proposals require atomic persistence: once one wins, the stale proposal fails", () => {
    const first = value(transitionRecording(student(), operation()));
    const simultaneous = value(transitionRecording(student(), operation("begin-delete")));
    expect(first.recording.revision).toBe(simultaneous.recording.revision);
    expect(transitionRecording(first.recording, operation("begin-delete"))).toEqual(conflict);
    expect(transitionRecording(student(), { ...operation(), recordingId: ids.other })).toEqual(conflict);
  });
  test.each(["private", "submitted"])("deletion from %s is irreversible and ordered", (initial) => {
    let record: RecordingMetadata = value(transitionRecording(student(initial), operation("begin-delete"))).recording;
    expect(record.state).toBe("deleting");
    expect(transitionRecording(record, operation("submit", record.revision))).toEqual(conflict);
    expect(value(transitionRecording(record, operation("begin-delete", record.revision))).changed).toBe(false);
    record = value(transitionRecording(record, operation("complete-delete", record.revision))).recording;
    expect(record.state).toBe("deleted");
    expect(transitionRecording(record, operation("submit", record.revision))).toEqual(conflict);
    expect(value(transitionRecording(record, operation("complete-delete", record.revision))).changed).toBe(false);
    expect(value(transitionRecording(record, operation("begin-delete", record.revision))).recording.state).toBe("deleted");
    expect(transitionRecording(student(initial), operation("complete-delete"))).toEqual(conflict);
  });
  test("references can be deleted but cannot enter student submission lifecycle", () => {
    expect(transitionRecording(reference(), operation())).toEqual(conflict);
    expect(value(transitionRecording(reference(), operation("begin-delete"))).recording.state).toBe("deleting");
  });
  test("revision exhaustion fails on changes but permits valid current-revision no-ops", () => {
    const limits = { ...DEFAULT_RECORDING_LIMITS, maxRevision: 2 };
    expect(transitionRecording(student("private", 2), operation("submit", 2), limits)).toEqual(conflict);
    expect(value(transitionRecording(student("submitted", 2), operation("submit", 2), limits)).changed).toBe(false);
    expect(transitionRecording(student("submitted", 2), operation("submit", 1), limits)).toEqual(conflict);
  });
});

describe("calendar anniversary retention of submitted student recordings", () => {
  test.each([
    ["2026-10-16", "2027-10-15", "2027-10-16", false],
    ["2026-10-16", "2027-10-16", "2027-10-16", true],
    ["2023-03-01", "2024-02-29", "2024-03-01", false],
    ["2023-03-01", "2024-03-01", "2024-03-01", true],
    ["2024-02-29", "2025-02-27", "2025-02-28", false],
    ["2024-02-29", "2025-02-28", "2025-02-28", true],
    ["2000-02-29", "2001-02-28", "2001-02-28", true],
    ["1899-03-01", "1900-03-01", "1900-03-01", true],
    ["2099-03-01", "2100-03-01", "2100-03-01", true],
    ["0001-01-01", "0002-01-01", "0002-01-01", true],
    ["9998-12-31", "9999-12-31", "9999-12-31", true],
  ])("ceremony %s, current %s -> anniversary %s, due %s", (ceremonyDate, currentDate, deadlineDate, deleteDue) => {
    const result = studentSubmissionRetention(student("submitted"), ceremonyDate, currentDate);
    expect(value(result)).toEqual({ applies: true, deadlineDate, deleteDue });
    expect(Object.isFrozen(value(result))).toBe(true);
  });
  test.each(["2026-2-01", "2026-02-29", "1900-02-29", "2100-02-29", "0000-01-01", "2026-04-31", "2026-00-01", "2026-13-01", "2026-01-00", "2026-01-01Z", "2026-01-01T00:00:00Z", " 2026-01-01", "2026-01-01\n", "", null, 20260101])("malformed ceremony or current date fails closed: %s", (bad) => {
    expect(studentSubmissionRetention(student("submitted"), bad, "2027-01-01")).toEqual(invalid);
    expect(studentSubmissionRetention(student("submitted"), "2026-01-01", bad)).toEqual(invalid);
  });
  test("an unrepresentable next year is rejected rather than wrapped", () => {
    expect(studentSubmissionRetention(student("submitted"), "9999-01-01", "9999-12-31")).toEqual(invalid);
  });
  test("private/reference/deletion records gain no submission-retention policy", () => {
    for (const input of [student(), reference(), student("deleting"), student("deleted")]) {
      expect(value(studentSubmissionRetention(input, "2026-01-01", "2028-01-01"))).toEqual({ applies: false });
    }
    expect(studentSubmissionRetention({ ...reference(), kind: "generated-chant" }, "2026-01-01", "2028-01-01")).toEqual(invalid);
  });
  test("fresh ceremony rescheduling recomputes due dates but cannot revive deletion", () => {
    expect(value(studentSubmissionRetention(student("submitted"), "2026-01-01", "2027-01-01"))).toMatchObject({ deleteDue: true });
    expect(value(studentSubmissionRetention(student("submitted"), "2027-01-01", "2027-01-01"))).toMatchObject({ deleteDue: false });
    for (const state of ["deleting", "deleted"]) {
      expect(value(studentSubmissionRetention(student(state), "2027-01-01", "2027-01-01"))).toEqual({ applies: false });
      expect(transitionRecording(student(state), operation())).toEqual(conflict);
    }
  });
});
