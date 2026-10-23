import "server-only";
import { sql } from "drizzle-orm";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { createAccessService } from "../access/service";
import { AccessDenied } from "../access/errors";
import type { AccessRequest, AccessTransaction } from "../access/types";
import { courseEligibility } from "../data/course-progress";

/** The verified owner of a member's course progress, fixed for one request. */
export type CourseOwner = Readonly<{ tenantId: string; membershipId: string; userId: string; sessionExpiresAt: number }>;
export type CourseIntent = "read" | "data-write";

/**
 * The only place that sets app.course_owner (a structural test holds this), on the saved layer's model
 * (src/server/saved/access.ts). In order:
 * 1. a verified cookie session (no practice-context header; a POST needs the exact Origin);
 * 2. a membership in the host's tenant, not disabled;
 * 3. a live grant under a share lock;
 * 4. the transaction-local owner setting, which the forced owner_only policy reads;
 * 5. the action, with the session's expiry checked before and after it.
 * Staff, Daniel, MCP, cron, the roster Sheet and notifications never come through here and see no rows.
 */
export function createCourseProgressAccess<Q extends PgQueryResultHKT>(input: { access: Pick<ReturnType<typeof createAccessService<Q>>, "withVerifiedIdentity"> }) {
  return async function withCourseOwner<T>(request: AccessRequest & { method?: string }, intent: CourseIntent, action: (tx: AccessTransaction<Q>, owner: CourseOwner) => Promise<T>): Promise<T> {
    if (intent !== "read" && intent !== "data-write") throw new AccessDenied(403);
    return input.access.withVerifiedIdentity(request, { intent, mutation: intent !== "read" }, async (tx, identity) => {
      if (!identity.membership) throw new AccessDenied(403);
      if (!await courseEligibility(tx, identity.tenantId, identity.membership.id)) throw new AccessDenied(403);
      await tx.execute(sql`select set_config('app.course_owner', ${identity.membership.id}, true)`);
      const owner: CourseOwner = Object.freeze({ tenantId: identity.tenantId, membershipId: identity.membership.id, userId: identity.userId,
        sessionExpiresAt: identity.sessionExpiresAt.getTime() });
      const assertLive = () => { if (owner.sessionExpiresAt <= Date.now()) throw new AccessDenied(401); };
      assertLive();
      const result = await action(tx, owner);
      // Lock waits inside the action can outlast the session; an expiry rolls the whole write back.
      assertLive();
      return result;
    });
  };
}
