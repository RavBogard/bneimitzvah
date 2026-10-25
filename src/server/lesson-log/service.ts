import "server-only";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { AccessRequest, AccessTransaction } from "../access/types";
import type { createAccessService } from "../access/service";
import type { createPracticeService } from "../practice/service";
import { AccessDenied } from "../access/errors";
import * as data from "../data/lesson-log";
import * as validate from "./validation";
import type { LessonLogChanged, LessonLogConflict, LessonLogCreate, LessonLogCursor, LessonLogDelete, LessonLogEdit, LessonLogPage, LessonLogRemoved, LessonLogSelection } from "../../lib/lesson-log/types";

type Request = AccessRequest & { method?: string };
const conflict: LessonLogConflict = { ok: false, code: "conflict" };
export function createLessonLogService<Q extends PgQueryResultHKT>(input: { access: ReturnType<typeof createAccessService<Q>>; practice: ReturnType<typeof createPracticeService<Q>> }) {
  async function authorized<T>(request: Request, selection: LessonLogSelection, write: boolean,
    action: (tx: AccessTransaction<Q>, actor: data.LessonLogActor, assertLive: () => void) => Promise<T>) {
    const run = async (tx: AccessTransaction<Q>, actor: data.LessonLogActor) => {
      const assertLive = () => {
        const now = Date.now();
        if (actor.authSessionExpiresAt <= now) throw new AccessDenied(401);
        if ("context" in actor && actor.context && Date.parse(actor.context.expiresAt) <= now) throw new AccessDenied(404);
      };
      assertLive(); const result = await action(tx, actor, assertLive); assertLive(); return result;
    };
    if (write) {
      if (selection.mode !== "tutor" && selection.mode !== "admin") throw new AccessDenied(403);
      return input.access.withStudentCapability(request, { mode: selection.mode, studentId: selection.studentId, capability: "note-write" }, run);
    }
    return selection.mode === "child-practice"
      ? input.practice.withPracticeCapability(request, { mode: selection.mode, studentId: selection.studentId, capability: "read" }, run)
      : input.access.withStudentCapability(request, { mode: selection.mode, studentId: selection.studentId, capability: "read" }, run);
  }
  async function project(tx: AccessTransaction<Q>, actor: data.LessonLogActor, row: data.LessonLogRow, assertLive: () => void) {
    const name = await data.creatorName(tx, row); assertLive(); return data.view(actor, row, name);
  }
  return Object.freeze({
    async page(request: Request, supplied: LessonLogSelection, suppliedCursor?: LessonLogCursor): Promise<LessonLogPage> {
      const selection = validate.selection(supplied), before = validate.cursor(suppliedCursor);
      return authorized(request, selection, false, async (tx, actor, assertLive) => {
        const rows = await data.page(tx, actor, before); assertLive();
        const page = rows.slice(0, 50), last = page.at(-1)?.row;
        return { ok: true, studentId: actor.studentId, mode: actor.mode, entries: page.map(({ row, name }) => data.view(actor, row, name)),
          nextCursor: rows.length > 50 && last ? { lessonDate: last.lessonDate, entryId: last.entryId } : null };
      });
    },
    async create(request: Request, supplied: LessonLogSelection, suppliedWrite: LessonLogCreate): Promise<LessonLogChanged | LessonLogConflict> {
      const selection = validate.selection(supplied), write = validate.create(suppliedWrite);
      return authorized(request, selection, true, async (tx, actor, assertLive) => {
        let row = await data.insert(tx, actor, write); assertLive();
        if (!row) {
          row = await data.lock(tx, actor, write.entryId); assertLive();
          if (!row || row.deleted || row.version !== 1 || row.creatorMembershipId !== actor.membershipId || row.creatorUserId !== actor.userId || row.lessonDate !== write.lessonDate || row.summary !== write.summary
            || (row.beforeNext ?? null) !== write.beforeNext) return conflict;
        } else { await data.audit(tx, actor, "create", row.entryId); assertLive(); }
        return { ok: true, entry: await project(tx, actor, row, assertLive) };
      });
    },
    async edit(request: Request, supplied: LessonLogSelection, suppliedWrite: LessonLogEdit): Promise<LessonLogChanged | LessonLogConflict> {
      const selection = validate.selection(supplied), write = validate.edit(suppliedWrite);
      return authorized(request, selection, true, async (tx, actor, assertLive) => {
        const row = await data.lock(tx, actor, write.entryId); assertLive();
        if (!row) throw new AccessDenied(404);
        if (!data.canChange(actor, row)) throw new AccessDenied(403);
        if (row.deleted || row.version !== write.expectedVersion) return conflict;
        // Leaving beforeNext out keeps the saved line, so an edit from an older page never erases it.
        const beforeNext = write.beforeNext === undefined ? row.beforeNext ?? null : write.beforeNext;
        if (row.lessonDate === write.lessonDate && row.summary === write.summary && (row.beforeNext ?? null) === beforeNext) return { ok: true, entry: await project(tx, actor, row, assertLive) };
        if (row.version === 2147483647) return conflict;
        const changed = await data.change(tx, actor, row, { lessonDate: write.lessonDate, summary: write.summary, beforeNext }); assertLive();
        if (!changed) return conflict;
        await data.audit(tx, actor, "edit", row.entryId); assertLive();
        return { ok: true, entry: await project(tx, actor, changed, assertLive) };
      });
    },
    async remove(request: Request, supplied: LessonLogSelection, suppliedWrite: LessonLogDelete): Promise<LessonLogRemoved | LessonLogConflict> {
      const selection = validate.selection(supplied), write = validate.remove(suppliedWrite);
      return authorized(request, selection, true, async (tx, actor, assertLive) => {
        const row = await data.lock(tx, actor, write.entryId); assertLive();
        if (!row) throw new AccessDenied(404);
        if (!data.canChange(actor, row)) throw new AccessDenied(403);
        if (row.deleted || row.version !== write.expectedVersion || row.version === 2147483647) return conflict;
        const changed = await data.change(tx, actor, row, { summary: "", beforeNext: null, deleted: true }); assertLive();
        if (!changed) return conflict;
        await data.audit(tx, actor, "delete", row.entryId); assertLive();
        return { ok: true, entryId: row.entryId, version: changed.version };
      });
    },
  });
}
