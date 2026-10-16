import "server-only";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { createAuthStack } from "../auth/factory";
import { withTenantTransaction } from "../db/runtime";
import { resolveTenantHost } from "../tenancy/resolve";
import { lockIdentityRecords } from "../data/authority";
import { requireCookieMutation } from "../http/mutations";
import { AccessDenied, AccessUnavailable } from "./errors";
import type { AccessDatabase, AccessRequest, AccessTransaction, DeploymentScope, LockIntent, VerifiedIdentity } from "./types";

export function createVerifiedIdentityAccess<Q extends PgQueryResultHKT>(input: {
  db: AccessDatabase<Q>; auth: Pick<ReturnType<typeof createAuthStack>, "api">; deployment: DeploymentScope;
}) {
  const deployment = Object.freeze({ ...input.deployment });
  return async function withVerifiedIdentity<T>(request: AccessRequest & { method?: string }, options: { intent: LockIntent; mutation?: boolean; fresh?: boolean; allowPracticeContext?: boolean }, action: (tx: AccessTransaction<Q>, identity: VerifiedIdentity) => Promise<T>) {
    try {
      if (request.headers.has("X-Practice-Context") && !options.allowPracticeContext) throw new AccessDenied(403);
      const resolved = await resolveTenantHost(input.db, request, deployment);
      if (options.mutation) requireCookieMutation(request, resolved.origin);
      const sessionHeaders = new Headers(request.headers);
      // Discard unused RFC proxy metadata before any SDK processing.
      sessionHeaders.delete("forwarded");
      const proof = await input.auth.api.getSession({ headers: sessionHeaders, query: { disableCookieCache: true, disableRefresh: true } });
      if (!proof || proof.session.userId !== proof.user.id) throw new AccessDenied(401);
      return await withTenantTransaction(input.db, resolved, async (tx) => {
        const records = await lockIdentityRecords(tx, resolved.tenantId, { id: proof.session.id, userId: proof.user.id, token: proof.session.token }, options.intent);
        const now = Date.now();
        if (!records.tenant?.enabled) throw new AccessDenied(404);
        if (!records.user || !records.session || records.session.userId !== records.user.id || records.session.expiresAt.getTime() <= now) throw new AccessDenied(401);
        if (!records.user.verified || records.membership?.disabledAt) throw new AccessDenied(403);
        if (options.fresh && now - records.session.createdAt.getTime() >= 15 * 60_000) throw new AccessDenied(403);
        const identity: VerifiedIdentity = Object.freeze({ tenantId: resolved.tenantId, origin: resolved.origin, userId: records.user.id,
          email: records.user.email, authSessionId: records.session.id, sessionExpiresAt: new Date(records.session.expiresAt),
          membership: records.membership ? Object.freeze({ id: records.membership.id, authorityRevision: records.membership.authorityRevision }) : null });
        return action(tx, identity);
      });
    } catch (error) {
      if (error instanceof AccessDenied) throw error;
      throw new AccessUnavailable();
    }
  };
}
