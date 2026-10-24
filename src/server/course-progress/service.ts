import "server-only";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { createAccessService } from "../access/service";
import type { AccessRequest, AccessTransaction } from "../access/types";
import * as data from "../data/course-progress";
import { mergeProgress, parseProgress, type Progress } from "../../lib/learn/progress";
import { courseOwnerName, createCourseProgressAccess, type CourseOwner } from "./access";
import * as validate from "./validation";

type Request = AccessRequest & { method?: string };
export { courseOwnerName };
/** A stored document re-read with the same parser; a row that no longer parses is refused, never served. */
function stored(row: data.CourseProgressRow): Progress {
  const value = parseProgress(row.progress);
  if (!value) throw new Error("Course progress unavailable");
  return value;
}
const view = (owner: CourseOwner, row: data.CourseProgressRow | null, until: string | null) =>
  ({ ok: true as const, owner: courseOwnerName(owner), progress: row ? stored(row) : null, version: row?.version ?? 0, until });

export function createCourseProgressService<Q extends PgQueryResultHKT>(input: { access: Pick<ReturnType<typeof createAccessService<Q>>, "withVerifiedIdentity"> }) {
  const withCourseOwner = createCourseProgressAccess<Q>(input);
  // Every write takes the member's write lock first, so a merge sees every earlier write of this member.
  const write = <T>(request: Request, action: (tx: AccessTransaction<Q>, owner: CourseOwner) => Promise<T>) =>
    withCourseOwner<T>(request, "data-write", async (tx, owner) => { await data.lockOwnerWrites(tx, owner); return action(tx, owner); });
  return Object.freeze({
    /** 401 signed out, 403 without a membership or a live grant: the browser learns its own state from this. */
    async get(request: Request) {
      return withCourseOwner(request, "read", async (tx, owner) => view(owner, await data.progressRow(tx, owner), await data.ownCeremonyDate(tx, owner)));
    },
    /** Replace the document under its version; a stale version is a 409 conflict carrying the current one. */
    async put(request: Request, supplied: unknown) {
      const value = validate.put(supplied);
      return write(request, async (tx, owner) => {
        const current = await data.progressRow(tx, owner), until = await data.ownCeremonyDate(tx, owner);
        if ((current?.version ?? 0) !== value.expectedVersion) return { ok: false as const, code: "conflict" as const, current: view(owner, current, until) };
        const row = current ? await data.updateProgress(tx, owner, value.expectedVersion, value.progress) : await data.insertProgress(tx, owner, value.progress);
        if (!row) throw new Error("Course progress unavailable");
        return view(owner, row, until);
      });
    },
    /**
     * Fold the browser's progress into the account's (plan, slice 3). With no stored document the browser's is
     * taken; otherwise lessons are the union with the earliest done, and each card keeps the higher box with its
     * due. The browser clears nothing until this answers.
     */
    async merge(request: Request, supplied: unknown) {
      const value = validate.merge(supplied);
      return write(request, async (tx, owner) => {
        const current = await data.progressRow(tx, owner), until = await data.ownCeremonyDate(tx, owner);
        const merged = current ? mergeProgress(stored(current), value.progress) : value.progress;
        const row = current ? await data.updateProgress(tx, owner, current.version, merged) : await data.insertProgress(tx, owner, merged);
        if (!row) throw new Error("Course progress unavailable");
        return view(owner, row, until);
      });
    },
  });
}
export type CourseProgressService = ReturnType<typeof createCourseProgressService>;
