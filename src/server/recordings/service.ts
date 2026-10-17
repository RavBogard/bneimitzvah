import "server-only";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import { AccessDenied } from "../access/errors";
import * as data from "../data/recordings";
import { createRecordingAuthority, type RecordingDependencies, type RecordingRequest } from "./authority";
import { recordingDate } from "./retention";
import * as validate from "./validation";
import type { RecordingConflict, RecordingPage, RecordingReceipt, RecordingSelection, RecordingWrite, StaffRecordingView, StudentRecordingView } from "../../lib/recordings/types";

const conflict: RecordingConflict = Object.freeze({ ok: false, code: "conflict" });
export function receipt(row: data.RecordingRow): RecordingReceipt {
  if (!["private", "submitted", "deleting"].includes(row.state)) throw new Error("Recording unavailable");
  return { ok: true, recording: { id: row.id, revision: row.revision, state: row.state as "private" | "submitted" | "deleting" } };
}
function view(actor: data.RecordingActor, row: data.RecordingRow): StaffRecordingView | StudentRecordingView {
  if (row.state !== "private" && row.state !== "submitted") throw new Error("Recording unavailable");
  const media = validate.descriptor({ assetId: row.assetId, contentSha256: row.contentSha256, media: { mediaType: row.mediaType, byteLength: row.byteLength, durationMs: row.durationMs } }).media;
  if (data.staff(actor)) {
    if (row.state !== "submitted" || !row.submittedAt) throw new Error("Recording unavailable");
    return { id: row.id, revision: row.revision, state: "submitted", media, submittedDate: recordingDate(row.submittedAt) };
  }
  return { id: row.id, revision: row.revision, state: row.state, media, recordedDate: recordingDate(row.createdAt), ...(row.submittedAt ? { submittedDate: recordingDate(row.submittedAt) } : {}) };
}
/** Actual public runtime surface: no registration or trusted descriptor method. */
export function createStudentRecordingService<Q extends PgQueryResultHKT>(input: RecordingDependencies<Q>) {
  const authorized = createRecordingAuthority(input);
  async function mutate(request: RecordingRequest, selection: RecordingSelection, suppliedWrite: RecordingWrite, operation: "submit" | "delete") {
    const write = validate.write(suppliedWrite);
    return authorized(request, selection, true, operation === "delete", async (tx, actor, _student, fresh): Promise<RecordingReceipt | RecordingConflict> => {
      const row = await data.lock(tx, actor, write.recordingId); const current = fresh();
      if (!row) throw new AccessDenied(404);
      if (row.revision !== write.expectedRevision) return conflict;
      if (operation === "submit") {
        if (row.state === "submitted") return receipt(row);
        if (row.state !== "private") return conflict;
      } else if (row.state === "deleting") return receipt(row);
      const instant = new Date(Math.max(current.instant, row.createdAt.getTime(), row.submittedAt?.getTime() ?? 0));
      const changed = await data.transition(tx, actor, row, operation === "submit" ? "submitted" : "deleting", instant); fresh();
      if (!changed) return conflict;
      await data.audit(tx, actor, operation === "submit" ? "submit" : "delete-request", row.id); fresh();
      return receipt(changed);
    });
  }
  return Object.freeze({
    async page(request: RecordingRequest, selection: RecordingSelection, suppliedAfterId?: string): Promise<RecordingPage> {
      const afterId = suppliedAfterId === undefined ? undefined : validate.recordingId(suppliedAfterId);
      return authorized(request, selection, false, "read", async (tx, actor, _student, fresh) => {
        let due = fresh().due;
        // At most one anniversary crossing can occur in an ordinary monotonic
        // request. Requery the newly visible set so neither private nor submitted
        // metadata survives an anniversary crossing while SQL was awaited.
        for (let attempt = 0; attempt < 2; attempt++) {
          const cursor = afterId ? await data.cursor(tx, actor, afterId, due) : undefined;
          let latest = fresh().due;
          if (latest !== due) { due = latest; continue; }
          if (afterId && !cursor) throw new AccessDenied(404);
          const rows = await data.page(tx, actor, due, cursor ?? undefined); latest = fresh().due;
          if (latest !== due) { due = latest; continue; }
          const page = rows.slice(0, 50), last = page.at(-1);
          return { ok: true, studentId: actor.studentId, mode: actor.mode, entries: page.map(row => view(actor, row)), nextCursor: rows.length > 50 && last ? last.id : null };
        }
        throw new Error("Recording unavailable");
      });
    },
    submit: (request: RecordingRequest, selection: RecordingSelection, write: RecordingWrite) => mutate(request, selection, write, "submit"),
    remove: (request: RecordingRequest, selection: RecordingSelection, write: RecordingWrite) => mutate(request, selection, write, "delete"),
  });
}
