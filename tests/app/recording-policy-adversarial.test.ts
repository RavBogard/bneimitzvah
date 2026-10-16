import { describe, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import {
  DEFAULT_RECORDING_LIMITS, studentSubmissionRetention, transitionRecording,
  validateRecordingMedia, validateRecordingMetadata, validateRecordingOperation,
} from "../../src/server/recordings/policy";
import type { RecordingResult } from "../../src/server/recordings/types";

const recordingId = "10000000-0000-0000-0000-000000000001";
const studentId = "20000000-0000-0000-0000-000000000001";
const verseId = "30000000-0000-0000-0000-000000000001";
const media = () => ({ mediaType: "audio/webm;codecs=opus", byteLength: 1024, durationMs: 1000 });
const student = (state = "private", revision = 7, tenantId = "crc") => ({ kind: "student-recording", id: recordingId, tenantId, studentId, state, revision, media: media() });
const reference = (state = "available", revision = 7, tenantId = "crc") => ({ kind: "reference-recording", id: recordingId, tenantId, state, revision, media: media(), verse: { reading: "torah", verseId } });
const command = (operation: string, expectedRevision = 7) => ({ operation, recordingId, expectedRevision });
const invalid = { ok: false, error: "invalid-recording" };
const conflict = { ok: false, error: "recording-conflict" };
function value<T>(result: RecordingResult<T>): T {
  if (!result.ok) throw new Error("Expected successful synthetic policy result");
  return result.value;
}

describe("independent recording boundary probes", () => {
  test("existing CRC tenant and persisted verse UUID shapes survive complete lifecycle; no IDs are normalized", () => {
    for (const tenant of ["crc", "other", "CRC", "a".repeat(64)]) {
      const input = student("private", 7, tenant);
      let current = value(transitionRecording(input, command("submit"))).recording;
      current = value(transitionRecording(current, command("begin-delete", 8))).recording;
      current = value(transitionRecording(current, command("complete-delete", 9))).recording;
      expect(current).toMatchObject({ tenantId: tenant, studentId, id: recordingId, state: "deleted", revision: 10 });
      expect(value(validateRecordingMetadata(reference("available", 7, tenant)))).toMatchObject({ tenantId: tenant, verse: { reading: "torah", verseId } });
    }
    for (const tenantId of [" crc", "crc ", "crc\n", "crc\0", "https://example.test", "a".repeat(65), "", "../crc", "c\u200brc"]) {
      expect(validateRecordingMetadata(student("private", 7, tenantId))).toEqual(invalid);
    }
    for (const bad of ["Genesis 1:1", verseId.toUpperCase().replace("30000000", "A0000000"), "", "crc"]) {
      expect(validateRecordingMetadata({ ...reference(), verse: { reading: "torah", verseId: bad } })).toEqual(invalid);
    }
  });

  test("capture and command descriptors cannot carry any internal metadata or authority field", () => {
    for (const field of [...Object.keys(student()), "verse", "url", "storageKey", "filename", "actor", "mode", "capability", "context", "consent", "generated", "released", "ceremonyDate"]) {
      if (!Object.hasOwn(media(), field)) expect(validateRecordingMedia({ ...media(), [field]: "synthetic" })).toEqual(invalid);
      if (!Object.hasOwn(command("submit"), field)) expect(validateRecordingOperation({ ...command("submit"), [field]: "synthetic" })).toEqual(invalid);
    }
    for (const kind of ["generated-chant", "generated-recording", "training-recording", "adult-reference", "prayer-recording"]) {
      expect(validateRecordingMetadata({ ...reference(), kind })).toEqual(invalid);
    }
  });

  test("accessors at every metadata, media, verse, command and configuration field never execute", () => {
    const cases: Array<[Record<string, unknown>, (input: unknown) => unknown]> = [
      [student(), validateRecordingMetadata], [media(), validateRecordingMedia],
      [reference().verse, (verse) => validateRecordingMetadata({ ...reference(), verse })],
      [command("submit"), validateRecordingOperation],
      [{ ...DEFAULT_RECORDING_LIMITS }, (limits) => validateRecordingMetadata(student(), limits)],
    ];
    const getter = vi.fn(() => { throw new Error("synthetic private accessor diagnostic"); });
    for (const [plain, inspect] of cases) for (const key of Object.keys(plain)) {
      const input = Object.defineProperty({ ...plain }, key, { enumerable: true, get: getter });
      expect(inspect(input)).toEqual(invalid);
    }
    expect(getter).not.toHaveBeenCalled();
  });

  test("throwing structural proxy traps sanitize nested inputs; ordinary property get traps are unnecessary", () => {
    for (const trap of ["getPrototypeOf", "ownKeys", "getOwnPropertyDescriptor"]) {
      const proxy = new Proxy({}, { [trap]: () => { throw new Error("synthetic private proxy diagnostic"); } });
      for (const result of [validateRecordingMetadata(proxy), validateRecordingMedia(proxy), validateRecordingOperation(proxy),
        validateRecordingMetadata({ ...student(), media: proxy }), validateRecordingMetadata({ ...reference(), verse: proxy }),
        validateRecordingMedia(media(), proxy), transitionRecording(student(), proxy), studentSubmissionRetention(proxy, "2026-01-01", "2027-01-01")]) {
        expect(result).toEqual(invalid);
        expect(Object.isFrozen(result)).toBe(true);
        expect(JSON.stringify(result)).not.toContain("diagnostic");
      }
    }
    const get = vi.fn(() => { throw new Error("ordinary property reads forbidden by synthetic probe"); });
    expect(value(validateRecordingMetadata(new Proxy(student(), { get })))).toEqual(student());
    expect(get).not.toHaveBeenCalled();
  });

  test("accepted null-prototype trees and every transition output are detached and deeply immutable", () => {
    const nullCopy = (object: Record<string, unknown>) => Object.assign(Object.create(null), object);
    const input = nullCopy({ ...reference(), media: nullCopy(media()), verse: nullCopy(reference().verse) });
    const result = validateRecordingMetadata(input), record = value(result);
    input.tenantId = "other"; input.media.byteLength = 999; input.verse.verseId = recordingId;
    expect(record).toEqual(reference());
    expect(record).not.toBe(input); expect(record.media).not.toBe(input.media);
    expect([result, record, record.media, record.kind === "reference-recording" && record.verse].every(Object.isFrozen)).toBe(true);
    for (const state of ["private", "submitted", "deleting", "deleted"]) {
      const source = student(state);
      const operation = state === "private" ? "submit" : state === "submitted" ? "submit" : "begin-delete";
      const proposal = transitionRecording(source, command(operation)), next = value(proposal);
      expect(next.recording).not.toBe(source); expect(next.recording.media).not.toBe(source.media);
      expect([proposal, next, next.recording, next.recording.media].every(Object.isFrozen)).toBe(true);
      expect(Reflect.set(next.recording, "tenantId", "other")).toBe(false);
      expect(Reflect.set(next.recording.media, "byteLength", 99)).toBe(false);
      expect(source.tenantId).toBe("crc"); expect(source.revision).toBe(7);
    }
  });
});

describe("independent lifecycle and retention invariants", () => {
  test("all state-operation pairs preserve ownership and tombstones; stale no-ops and exhausted changes conflict", () => {
    const expected: Record<string, Array<string | null>> = {
      private: ["submitted", "deleting", null], submitted: ["submitted", "deleting", null],
      deleting: [null, "deleting", "deleted"], deleted: [null, "deleted", "deleted"],
      available: [null, "deleting", null],
    };
    for (const make of [student, reference]) {
      const states = make === student ? ["private", "submitted", "deleting", "deleted"] : ["available", "deleting", "deleted"];
      for (const state of states) for (const [index, operation] of ["submit", "begin-delete", "complete-delete"].entries()) {
        const input = make(state), result = transitionRecording(input, command(operation));
        const target = make === reference && operation === "submit" ? null : expected[state][index];
        if (target === null) expect(result).toEqual(conflict);
        else {
          const next = value(result), changed = target !== state;
          expect(next.changed).toBe(changed);
          expect(next.recording).toMatchObject({ id: input.id, tenantId: "crc", kind: input.kind, revision: changed ? 8 : 7, state: target, media: input.media });
          if (next.recording.kind === "student-recording") expect(next.recording.studentId).toBe(studentId);
          else expect(next.recording.verse).toEqual(reference().verse);
          const limits = { ...DEFAULT_RECORDING_LIMITS, maxRevision: 7 };
          const exhausted = transitionRecording(input, command(operation), limits);
          expect(exhausted).toEqual(changed ? conflict : result);
        }
        expect(transitionRecording(input, command(operation, 6))).toEqual(conflict);
        expect(transitionRecording(input, { ...command(operation), recordingId: verseId })).toEqual(conflict);
      }
    }
  });

  test("all actual dates around leap-century years match an independent UTC calendar calculation", () => {
    const iso = (date: Date) => date.toISOString().slice(0, 10);
    let checked = 0;
    for (const year of [1899, 1900, 1999, 2000, 2099, 2100, 2399, 2400]) {
      for (let month = 0; month < 12; month++) {
        const monthDays = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
        for (let day = 1; day <= monthDays; day++) {
          const ceremony = new Date(Date.UTC(year, month, day));
          const maxNextDay = new Date(Date.UTC(year + 1, month + 1, 0)).getUTCDate();
          const deadline = new Date(Date.UTC(year + 1, month, Math.min(day, maxNextDay)));
          const before = new Date(deadline.getTime() - 86_400_000);
          expect(value(studentSubmissionRetention(student("submitted"), iso(ceremony), iso(before)))).toEqual({ applies: true, deadlineDate: iso(deadline), deleteDue: false });
          expect(value(studentSubmissionRetention(student("submitted"), iso(ceremony), iso(deadline)))).toEqual({ applies: true, deadlineDate: iso(deadline), deleteDue: true });
          checked++;
        }
      }
    }
    expect(checked).toBe(2922);
  });

  test("only submitted students are retention-eligible; a reschedule changes the decision but never revives tombstones", () => {
    for (const input of [student("private"), student("deleting"), student("deleted"), reference(), reference("deleting"), reference("deleted")]) {
      expect(value(studentSubmissionRetention(input, "2026-01-01", "9999-12-31"))).toEqual({ applies: false });
    }
    const before = value(studentSubmissionRetention(student("submitted"), "2024-02-29", "2025-02-28"));
    const rescheduled = value(studentSubmissionRetention(student("submitted"), "2025-03-01", "2025-02-28"));
    expect(before).toEqual({ applies: true, deadlineDate: "2025-02-28", deleteDue: true });
    expect(rescheduled).toEqual({ applies: true, deadlineDate: "2026-03-01", deleteDue: false });
    for (const state of ["deleting", "deleted"]) {
      expect(transitionRecording(student(state), command("submit"))).toEqual(conflict);
      expect(value(studentSubmissionRetention(student(state), "2025-03-01", "2025-02-28")).applies).toBe(false);
    }
    for (const untrusted of [{ date: "2025-01-01" }, new Date("2025-01-01"), new String("2025-01-01"), "2025-01-01\u200b", "2025-01-01\r\n"]) {
      expect(studentSubmissionRetention(student("submitted"), untrusted, "2026-01-01")).toEqual(invalid);
      expect(studentSubmissionRetention(student("submitted"), "2025-01-01", untrusted)).toEqual(invalid);
    }
  });
});
