import "server-only";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { AccessRequest, AccessTransaction } from "../access/types";
import { AccessDenied } from "../access/errors";
import type { createAccessService } from "../access/service";
import type { createPracticeService } from "../practice/service";
import type { RecordingActor } from "../data/recordings";
import type { StudentView } from "../data/students";
import type { RecordingSelection } from "../../lib/recordings/types";
import { recordingDue, recordingInstant } from "./retention";
import * as validate from "./validation";

export type RecordingRequest = AccessRequest & { method?: string };
export type RecordingDependencies<Q extends PgQueryResultHKT> = { access: ReturnType<typeof createAccessService<Q>>; practice: ReturnType<typeof createPracticeService<Q>>; now?: () => number };
export type RecordingFreshness = () => { instant: number; due: boolean };
export function createRecordingAuthority<Q extends PgQueryResultHKT>(input: RecordingDependencies<Q>) {
  return async function authorized<T>(request: RecordingRequest, supplied: RecordingSelection, write: boolean, allowDue: boolean | "read",
    action: (tx: AccessTransaction<Q>, actor: RecordingActor, student: StudentView, fresh: RecordingFreshness) => Promise<T>) {
    const selection = validate.selection(supplied);
    // This is an operation/mode gate, never an inference from overlapping grants.
    if (selection.mode === "parent" || write && selection.mode !== "student" && selection.mode !== "child-practice") throw new AccessDenied(403);
    const run = async (tx: AccessTransaction<Q>, actor: RecordingActor, student: StudentView) => {
      let latestDue: boolean | undefined;
      const fresh: RecordingFreshness = () => {
        const realNow = Date.now();
        if (actor.authSessionExpiresAt <= realNow) throw new AccessDenied(401);
        if ("context" in actor && actor.context && Date.parse(actor.context.expiresAt) <= realNow) throw new AccessDenied(404);
        const instant = recordingInstant((input.now ?? Date.now)()), due = recordingDue(student.ceremonyDate, instant);
        if (due && !allowDue) throw new AccessDenied(404);
        latestDue = due;
        return { instant, due };
      };
      fresh(); const result = await action(tx, actor, student, fresh);
      const resultDue = latestDue, final = fresh();
      if (allowDue === "read" && resultDue !== final.due) throw new Error("Recording unavailable");
      return result;
    };
    return selection.mode === "student" || selection.mode === "child-practice"
      ? input.practice.withPracticeCapability(request, { mode: selection.mode, studentId: selection.studentId, capability: write ? "practice-write" : "read" }, run)
      : input.access.withStudentCapability(request, { mode: selection.mode, studentId: selection.studentId, capability: "read" }, run);
  };
}
