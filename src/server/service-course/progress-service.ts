import "server-only";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { createAccessService } from "../access/service";
import type { AccessRequest, AccessTransaction } from "../access/types";
import * as data from "../data/service-course-progress";
import { mergeProgress, onlyStampedBy, parseProgress, serializeProgress, type Progress } from "../../lib/service-course/progress";
import { createServiceCourseProgressAccess, serviceCourseOwnerName, ServiceCourseRefused, type ServiceCourseOwner } from "./progress-access";
import * as validate from "./progress-validation";
import { markFinishedParts } from "./finished";

/**
 * A member's own progress in the service course (2.0 SC4, A4 8.1): the same contract as Learn to lein's (plan item 25), on
 * its own owner-only table. Learn to lein's progress does not carry over into this course, nor the reverse.
 */
type Request = AccessRequest & { method?: string };
export { serviceCourseOwnerName };
/** A stored document re-read with the same parser; a row that no longer parses is refused, never served. */
function stored(row: data.ServiceCourseProgressRow): Progress {
  const value = parseProgress(row.progress);
  if (!value) throw new Error("Service course progress unavailable");
  return value;
}
const view = (owner: ServiceCourseOwner, row: data.ServiceCourseProgressRow | null, until: string | null) =>
  ({ ok: true as const, owner: serviceCourseOwnerName(owner), progress: row ? stored(row) : null, version: row?.version ?? 0, until });

export function createServiceCourseProgressService<Q extends PgQueryResultHKT>(input: { access: Pick<ReturnType<typeof createAccessService<Q>>, "withVerifiedIdentity"> }) {
  const withOwner = createServiceCourseProgressAccess<Q>(input);
  // Every write takes the member's write lock first, so a merge sees every earlier write of this member.
  // A write names the account the browser holds progress for; another account's (a tab whose session changed underneath it on a
  // shared device) is refused with the signed-in account's own owner name, before anything is read or written.
  const write = <T>(request: Request, expected: string, action: (tx: AccessTransaction<Q>, owner: ServiceCourseOwner) => Promise<T>) =>
    withOwner<T>(request, "data-write", async (tx, owner) => {
      const name = serviceCourseOwnerName(owner);
      if (expected !== name) throw new ServiceCourseRefused(name);
      await data.lockOwnerWrites(tx, owner); return action(tx, owner);
    });
  return Object.freeze({
    /** 401 signed out, 403 without a membership or a live grant: the browser learns its own state from this. */
    async get(request: Request) {
      return withOwner(request, "read", async (tx, owner) => view(owner, await data.progressRow(tx, owner), await data.ownCeremonyDate(tx, owner)));
    },
    /** Replace the document under its version; a stale version is a 409 conflict carrying the current one. */
    async put(request: Request, supplied: unknown) {
      const value = validate.put(supplied);
      return write(request, value.owner, async (tx, owner) => {
        // 2.0 SC5a: a lesson keeps `by` only when it names this account; any other is stored as done, unstamped.
        const name = serviceCourseOwnerName(owner), progress = onlyStampedBy(value.progress, name);
        const current = await data.progressRow(tx, owner), until = await data.ownCeremonyDate(tx, owner);
        if ((current?.version ?? 0) !== value.expectedVersion) return { ok: false as const, code: "conflict" as const, current: view(owner, current, until) };
        const row = current ? await data.updateProgress(tx, owner, value.expectedVersion, progress) : await data.insertProgress(tx, owner, progress);
        if (!row) throw new Error("Service course progress unavailable");
        // 2.0 SC5 and SC5a: the stored document's lessons done under this account that are the student's own assigned parts become finished marks.
        await markFinishedParts(tx, owner, stored(row), name);
        return view(owner, row, until);
      });
    },
    /**
     * Fold the browser's progress into the account's. With no stored document the browser's is taken; otherwise lessons are
     * the union with the earliest done, and each card keeps the higher box with its due. The browser clears nothing until this answers.
     */
    async merge(request: Request, supplied: unknown) {
      const value = validate.merge(supplied);
      return write(request, value.owner, async (tx, owner) => {
        const name = serviceCourseOwnerName(owner), progress = onlyStampedBy(value.progress, name);
        const current = await data.progressRow(tx, owner), until = await data.ownCeremonyDate(tx, owner);
        const merged = current ? mergeProgress(onlyStampedBy(stored(current), name), progress) : progress;
        // Two valid documents can merge into one the parser refuses (more cards, or more bytes, than one document holds): never
        // store what a later read would refuse; answer 409 with the account's copy, and the browser keeps its own.
        const text = serializeProgress(merged);
        if (text === null || !parseProgress(JSON.parse(text))) return { ok: false as const, code: "too-large" as const, current: view(owner, current, until) };
        const row = current ? await data.updateProgress(tx, owner, current.version, merged) : await data.insertProgress(tx, owner, merged);
        if (!row) throw new Error("Service course progress unavailable");
        await markFinishedParts(tx, owner, stored(row), name);
        return view(owner, row, until);
      });
    },
  });
}
export type ServiceCourseProgressService = ReturnType<typeof createServiceCourseProgressService>;
