import "server-only";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { AccessRequest, AccessTransaction } from "../access/types";
import { AccessDenied } from "../access/errors";
import { HttpBoundaryError } from "../http/responses";
import type { createAccessService } from "../access/service";
import type { createPracticeService } from "../practice/service";
import { confirmedReadings } from "../data/portal";
import * as data from "../data/progress";
import * as validate from "./validation";
import { TANAKH_VERSE_COUNTS } from "../../lib/readings/catalog";
import { expandReadingRanges } from "../../lib/readings/ranges";
import type { AssessmentState, ProgressBinding, ProgressChanged, ProgressFailure, ProgressPage, ProgressSelection, ProgressStream, ProgressVerse, ProgressWrite, SelfCheckState } from "../../lib/progress/types";

type Request = AccessRequest & { method?: string };
const stale: ProgressFailure = { ok: false, code: "stale-assignment" }, conflict: ProgressFailure = { ok: false, code: "conflict" };
const defaultState = (stream: ProgressStream) => stream === "self-check" ? "unmarked" : "not-started";
function head(state: string | null, version: number | null, stream: ProgressStream) {
  if (state === null && version === null) return { state: defaultState(stream), version: 0 };
  try {
    if (!Number.isInteger(version) || version! < 1 || version! > 2147483647) throw 0;
    return { state: validate.state(state, stream), version: version! };
  } catch { throw new Error("Progress unavailable"); }
}
export function createProgressService<Q extends PgQueryResultHKT>(input: { access: ReturnType<typeof createAccessService<Q>>; practice: ReturnType<typeof createPracticeService<Q>> }) {
  async function authorized<T>(request: Request, selection: ProgressSelection, operation: "read" | ProgressStream,
    action: (tx: AccessTransaction<Q>, actor: data.ProgressActor, verses: readonly string[], binding: ProgressBinding, assertLive: () => void) => Promise<T>) {
    const run = async (tx: AccessTransaction<Q>, actor: data.ProgressActor) => {
      const readings = await confirmedReadings(tx, actor.tenantId, actor.studentId);
      const assertLive = () => {
        const now = Date.now();
        if (actor.authSessionExpiresAt <= now) throw new AccessDenied(401);
        if ("context" in actor && actor.context && Date.parse(actor.context.expiresAt) <= now) throw new AccessDenied(404);
      };
      assertLive();
      const reading = readings.find(row => row.kind === selection.kind);
      if (!reading || reading.id !== selection.assignmentId || reading.revision !== selection.assignmentRevision) return stale;
      if (reading.kind !== "torah" && reading.kind !== "haftarah") throw new Error("Progress assignment unavailable");
      const verses = expandReadingRanges(reading.ref.split(/;\s*/), selection.kind, TANAKH_VERSE_COUNTS);
      if (verses.length !== reading.verses.length || verses.some((ref, index) => ref !== reading.verses[index])) throw new Error("Progress assignment unavailable");
      const binding: ProgressBinding = { studentId: actor.studentId, mode: actor.mode, kind: reading.kind, assignmentId: reading.id, assignmentRevision: reading.revision };
      const result = await action(tx, actor, verses, binding, assertLive);
      assertLive(); // Includes read, stale stream, no-op and every post-write wait.
      return result;
    };
    if (operation === "self-check") {
      if (selection.mode !== "student" && selection.mode !== "child-practice") throw new AccessDenied(403);
      return input.practice.withPracticeCapability(request, { mode: selection.mode, studentId: selection.studentId, capability: "practice-write" }, run);
    }
    if (operation === "assessment") {
      if (selection.mode === "child-practice") throw new AccessDenied(403);
      return input.access.withStudentCapability(request, { mode: selection.mode, studentId: selection.studentId, capability: "note-write" }, run);
    }
    return selection.mode === "child-practice"
      ? input.practice.withPracticeCapability(request, { mode: selection.mode, studentId: selection.studentId, capability: "read" }, run)
      : input.access.withStudentCapability(request, { mode: selection.mode, studentId: selection.studentId, capability: "read" }, run);
  }
  async function set(request: Request, supplied: ProgressSelection, suppliedWrite: ProgressWrite, stream: ProgressStream): Promise<ProgressChanged | ProgressFailure> {
    const selection = validate.selection(supplied), write = validate.write(suppliedWrite, stream);
    return authorized(request, selection, stream, async (tx, actor, verses, binding, assertLive) => {
      if (!verses.includes(write.verseRef)) throw new AccessDenied(404);
      const row = await data.lockHead(tx, actor, stream, binding.assignmentId, write.verseRef); assertLive();
      const current = head(row?.state ?? null, row?.version ?? null, stream);
      if (current.version !== write.expectedVersion) return conflict;
      if (current.state === write.state) return { ok: true, binding, verseRef: write.verseRef, stream, state: write.state, version: current.version };
      if (current.version === 2147483647) return conflict;
      const changed = await data.change(tx, actor, stream, binding.assignmentId, write, Boolean(row)); assertLive();
      if (!changed) return conflict;
      await data.audit(tx, actor, stream, changed.id); assertLive();
      return { ok: true, binding, verseRef: write.verseRef, stream, state: write.state, version: changed.version };
    });
  }
  return Object.freeze({
    async page(request: Request, supplied: ProgressSelection, suppliedOffset = 0): Promise<ProgressPage | ProgressFailure> {
      const selection = validate.selection(supplied), offset = validate.offset(suppliedOffset);
      return authorized(request, selection, "read", async (tx, actor, verses, binding) => {
        if (offset >= verses.length) throw new HttpBoundaryError();
        const rows = await data.snapshot(tx, actor, binding.assignmentId);
        if (rows.length !== verses.length || rows.some((row, index) => row.verseRef !== verses[index])) throw new Error("Progress assignment unavailable");
        const all: ProgressVerse[] = rows.map(row => ({ verseRef: row.verseRef,
          selfCheck: head(row.selfState, row.selfVersion, "self-check") as { state: SelfCheckState; version: number },
          assessment: head(row.assessmentState, row.assessmentVersion, "assessment") as { state: AssessmentState; version: number } }));
        const counts = { selfCheck: { unmarked: 0, working: 0, "got-it": 0 }, assessment: { "not-started": 0, working: 0, solid: 0 } };
        for (const verse of all) { counts.selfCheck[verse.selfCheck.state]++; counts.assessment[verse.assessment.state]++; }
        return { ok: true, binding, offset, nextOffset: offset + 100 < all.length ? offset + 100 : null, totalVerses: all.length, verses: all.slice(offset, offset + 100), counts };
      });
    },
    setSelfCheck: (request: Request, selection: ProgressSelection, write: ProgressWrite) => set(request, selection, write, "self-check"),
    setAssessment: (request: Request, selection: ProgressSelection, write: ProgressWrite) => set(request, selection, write, "assessment"),
  });
}
