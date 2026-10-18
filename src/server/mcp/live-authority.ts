import "server-only";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { AccessDatabase, AccessRequest, AccessTransaction, Actor, DeploymentScope } from "../access/types";
import { AccessDenied, AccessUnavailable } from "../access/errors";
import { resolveTenantHost } from "../tenancy/resolve";
import { withTenantTransaction } from "../db/runtime";
import { mcpAuthorityData } from "../data/mcp-authority";
import type { createMcpTokenVerifier, McpTokenPolicy } from "./token-verifier";

// Internal delivery-fence metadata, never a public tool DTO field.
type StaffActor = Actor & Readonly<{ mode: "admin" | "tutor"; authorizationExpiresAt: number }>;
type Boundary = Pick<ReturnType<typeof createMcpTokenVerifier>, "readEvidence">;
const instant = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && Number.isFinite(new Date(n).getTime());
const positive = (n: number) => Number.isSafeInteger(n) && n > 0;

/** Dormant provider-evidence + live SQL authority. Internal finite reads only.
 * No network, delivery, streaming, writes or independent transactions in action.
 * No refresh-linked acceptance; no claim that later revocation cancels a read
 * which already committed. Transport still needs its own delivery fence.
 */
export function createMcpLiveAuthority<Q extends PgQueryResultHKT>(input: {
  db: AccessDatabase<Q>; deployment: DeploymentScope; boundary: Boundary; policy: McpTokenPolicy;
}) {
  const policy = Object.freeze({ ...input.policy }), deployment = Object.freeze({ ...input.deployment });
  if (policy.resource !== "https://beitmitzvah.centralreform.org/api/mcp" || policy.issuer !== "https://beitmitzvah.centralreform.org/api/auth"
    || !policy.clientId || policy.clientId !== policy.clientId.trim() || Buffer.byteLength(policy.clientId) > 255 || /[\x00-\x1f\x7f]/.test(policy.clientId)) throw Error("Invalid MCP authority composition");
  async function withActor<T>(request: AccessRequest & { readonly signal?: AbortSignal }, evidence: unknown,
    action: (tx: AccessTransaction<Q>, actor: StaffActor) => Promise<T>): Promise<T> {
    let deadline = Infinity;
    function fence() {
      if (request.signal?.aborted) throw new AccessUnavailable();
      if (Date.now() >= deadline) throw new AccessDenied(401);
    }
    function cap(value: number) {
      if (!instant(value)) throw new AccessDenied(401);
      deadline = Math.min(deadline, value); fence();
    }
    async function checked<TValue>(operation: Promise<TValue>): Promise<TValue> { const value = await operation; fence(); return value; }
    function authority(value: unknown): asserts value { if (!value) throw new AccessDenied(403); }
    try {
      fence();
      const proof = input.boundary.readEvidence(evidence);
      if (!proof || proof.issuer !== policy.issuer || proof.resource !== policy.resource || proof.clientId !== policy.clientId || proof.scope !== "portal:read") throw new AccessDenied(401);
      cap(proof.expiresAt);
      // Preserve the resolver's existing404 concealment for ALL host-directory
      // refusals, including its DB/timeout failures. Later private SQL is503.
      const host = await checked(resolveTenantHost(input.db, request, deployment));
      const target = new URL(request.url);
      authority(target.origin === host.origin && target.href === policy.resource && !request.headers.has("x-practice-context") && !request.headers.has("dpop"));
      const result = await checked(withTenantTransaction(input.db, host, async tx => {
        const data = mcpAuthorityData(tx);
        await checked(data.lockLimit());
        await checked(data.statementLimit());
        authority((await checked(data.tenant(host.tenantId)))?.enabled === true);
        authority((await checked(data.user(proof.userId)))?.verified === true);
        const session = await checked(data.session(proof.authSessionId, proof.userId));
        if (!session || !instant(session.created) || session.created > Date.now() || !instant(session.google) || session.google > Date.now() || session.google < session.created) throw new AccessDenied(401);
        cap(session.expires);
        const member = await checked(data.membership(host.tenantId, proof.userId));
        authority(member?.enabled && positive(member.revision));
        const locator = await checked(data.locator(host.tenantId, proof.delegationId));
        authority(locator?.member === member.id);
        const grant = await checked(data.grant(host.tenantId, locator.grant, member.id));
        authority(grant?.enabled && positive(grant.revision) && (grant.role === "admin" || grant.role === "tutor"));
        const delegation = await checked(data.delegation(host.tenantId, proof.delegationId));
        authority(delegation && delegation.enabled && delegation.user === proof.userId && delegation.session === proof.authSessionId
          && delegation.member === member.id && delegation.grant === locator.grant && delegation.role === grant.role
          && delegation.membershipRevision === member.revision && delegation.grantRevision === grant.revision
          && delegation.client === policy.clientId && delegation.resource === policy.resource && delegation.scope === "portal:read"
          && typeof delegation.consent === "string" && delegation.consent.length > 0
          && instant(delegation.created) && delegation.created <= Date.now() && instant(delegation.authorized)
          && delegation.authorized >= delegation.created && delegation.authorized <= Date.now()
          && instant(delegation.selection) && delegation.authorized <= delegation.selection && delegation.selection <= delegation.created + 600_000
          && instant(delegation.hard) && delegation.authorized < delegation.hard);
        cap(delegation.hard);
        authority((await checked(data.client(policy.clientId)))?.valid === true);
        authority((await checked(data.resource(policy.resource)))?.valid === true);
        authority((await checked(data.link(policy.clientId, policy.resource)))?.valid === true);
        authority((await checked(data.consent(delegation.consent, proof.userId, policy.clientId, proof.delegationId, policy.resource)))?.valid === true);
        const token = await checked(data.token(proof.accessTokenHash, proof.userId, proof.authSessionId, policy.clientId, proof.delegationId, policy.resource));
        authority(token?.valid === true && instant(token.created) && token.created <= Date.now()
          && instant(token.expires) && token.expires > token.created && token.expires - token.created <= 900_000);
        cap(token.expires);
        const actor: StaffActor = Object.freeze({ tenantId: host.tenantId, origin: host.origin, userId: proof.userId, authSessionId: proof.authSessionId,
          membershipId: member.id, authSessionExpiresAt: session.expires, roleGrantId: locator.grant,
          roleGrantRevision: grant.revision, mode: grant.role as "admin" | "tutor", authorityRevision: member.revision, authorizationExpiresAt: deadline });
        return checked(action(tx, actor));
      })); // Includes actual COMMIT acknowledgement, then the final deadline fence.
      fence();
      return result;
    } catch (error) {
      if (error instanceof AccessDenied || error instanceof AccessUnavailable) throw error;
      throw new AccessUnavailable();
    }
  }
  return Object.freeze({ withActor });
}
