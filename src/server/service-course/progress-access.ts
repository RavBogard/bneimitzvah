import "server-only";
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { createAccessService } from "../access/service";
import { AccessDenied } from "../access/errors";
import type { AccessRequest, AccessTransaction } from "../access/types";
import { serviceCourseEligibility } from "../data/service-course-progress";

/** The verified owner of a member's service-course progress, fixed for one request. */
export type ServiceCourseOwner = Readonly<{ tenantId: string; membershipId: string; userId: string; sessionExpiresAt: number }>;
export type ServiceCourseIntent = "read" | "data-write";
/**
 * An opaque, stable name for this member's account, so a browser can tell whose progress it holds (a shared device must
 * never fold one member's progress into another's). A hash, not an id, in its own namespace (never Learn to lein's name for
 * the same member), and only ever returned to the member themself.
 */
export const serviceCourseOwnerName = (owner: Pick<ServiceCourseOwner, "tenantId" | "membershipId">) =>
  createHash("sha256").update(`service-course-progress-owner/v1:${owner.tenantId}:${owner.membershipId}`).digest("hex").slice(0, 32);
/**
 * A verified membership that does not keep service-course progress now. Its 403 carries that membership's own owner name,
 * so the browser keeps a copy that is theirs and clears one that is someone else's (a shared device).
 */
export class ServiceCourseRefused extends AccessDenied {
  constructor(readonly owner: string) { super(403); this.name = "ServiceCourseRefused"; }
}

/**
 * The only place that sets app.service_course_owner (a structural test holds this), on Learn to lein's model
 * (src/server/course-progress/access.ts). In order:
 * 1. a verified cookie session (no practice-context header; a POST needs the exact Origin);
 * 2. a membership in the host's tenant, not disabled;
 * 3. a live grant, or an approved Member, under a share lock;
 * 4. the transaction-local owner setting, which the forced owner_only policy reads;
 * 5. the action, with the session's expiry checked before and after it.
 * Staff, Daniel, MCP, cron, the roster Sheet and notifications never come through here and see no rows.
 */
export function createServiceCourseProgressAccess<Q extends PgQueryResultHKT>(input: { access: Pick<ReturnType<typeof createAccessService<Q>>, "withVerifiedIdentity"> }) {
  return async function withServiceCourseOwner<T>(request: AccessRequest & { method?: string }, intent: ServiceCourseIntent, action: (tx: AccessTransaction<Q>, owner: ServiceCourseOwner) => Promise<T>): Promise<T> {
    if (intent !== "read" && intent !== "data-write") throw new AccessDenied(403);
    return input.access.withVerifiedIdentity(request, { intent, mutation: intent !== "read" }, async (tx, identity) => {
      if (!identity.membership) throw new AccessDenied(403);
      if (!await serviceCourseEligibility(tx, identity.tenantId, identity.membership.id)) throw new ServiceCourseRefused(serviceCourseOwnerName({ tenantId: identity.tenantId, membershipId: identity.membership.id }));
      await tx.execute(sql`select set_config('app.service_course_owner', ${identity.membership.id}, true)`);
      const owner: ServiceCourseOwner = Object.freeze({ tenantId: identity.tenantId, membershipId: identity.membership.id, userId: identity.userId,
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
