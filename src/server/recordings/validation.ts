import "server-only";
import { closedObject } from "../http/query";
import { HttpBoundaryError } from "../http/responses";
import { integer } from "../student-work/validation";
import { validateRecordingMedia } from "./policy";
import type { RecordingMediaView, RecordingSelection, RecordingWrite } from "../../lib/recordings/types";

/** Trusted capture-pipeline input; never a public request body or runtime field. */
export type VerifiedRecordingDescriptor = Readonly<{ assetId: string; contentSha256: string; media: RecordingMediaView }>;
export function recordingId(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value)) throw new HttpBoundaryError();
  return value;
}
export function selection(value: unknown): RecordingSelection {
  const row = closedObject(value, ["mode", "studentId"]);
  if (!["student", "parent", "child-practice", "tutor", "admin"].includes(row.mode as string)) throw new HttpBoundaryError();
  return Object.freeze({ mode: row.mode as RecordingSelection["mode"], studentId: recordingId(row.studentId) });
}
export function write(value: unknown): RecordingWrite {
  const row = closedObject(value, ["recordingId", "expectedRevision"]);
  return Object.freeze({ recordingId: recordingId(row.recordingId), expectedRevision: integer(row.expectedRevision, 1, 3) });
}
export function descriptor(value: unknown): VerifiedRecordingDescriptor {
  const row = closedObject(value, ["assetId", "contentSha256", "media"]), media = validateRecordingMedia(row.media);
  if (!media.ok || typeof row.contentSha256 !== "string" || !/^[a-f0-9]{64}$/.test(row.contentSha256)) throw new HttpBoundaryError();
  return Object.freeze({ assetId: recordingId(row.assetId), contentSha256: row.contentSha256, media: media.value });
}
