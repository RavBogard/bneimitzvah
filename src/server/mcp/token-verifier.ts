import "server-only";
import { createHash } from "node:crypto";
import { APIError, createAuthEndpoint } from "better-auth/api";
import type { mcp } from "@better-auth/mcp";
import { getOAuthProviderApi } from "@better-auth/oauth-provider";
import { z } from "zod";

export type McpTokenPolicy = Readonly<{ issuer: string; resource: string; clientId: string }>;
declare const evidenceBrand: unique symbol;
export type McpTokenEvidence = Readonly<{
  issuer: string; resource: string; clientId: string; scope: "portal:read";
  userId: string; authSessionId: string; delegationId: string;
  expiresAt: number; accessTokenHash: string; [evidenceBrand]: true;
}>;
type Projection = Omit<McpTokenEvidence, typeof evidenceBrand | "accessTokenHash">;
type Candidate = Projection & { readonly accessTokenHash: string };
type VerifierApi = { verifyPortalMcpToken(input: { body: { token: string } }): Promise<unknown> };
const tokenSchema = z.string().min(1).max(4096).regex(/^[A-Za-z0-9_-]+$/);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function identifier(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value === value.trim()
    && Buffer.byteLength(value) <= 255 && !/[\x00-\x1f\x7f]/.test(value);
}
function url(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try { const parsed = new URL(value); return ["https:", "http:"].includes(parsed.protocol) && !parsed.username && !parsed.password && !parsed.search && !parsed.hash && parsed.href === value; } catch { return false; }
}
function future(value: number) { return Number.isSafeInteger(value) && Number.isFinite(new Date(value).getTime()) && value > Date.now(); }
function field(value: object, key: string): unknown { return Object.getOwnPropertyDescriptor(value, key)?.value; }
function project(value: unknown, policy: McpTokenPolicy): Projection | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const audience = field(value, "aud"), exp = field(value, "exp"), userId = field(value, "sub"), authSessionId = field(value, "sid"), delegationId = field(value, "portal_reference");
  if (field(value, "active") !== true || field(value, "iss") !== policy.issuer
    || !(audience === policy.resource || Array.isArray(audience) && audience.length === 1 && audience[0] === policy.resource)
    || field(value, "client_id") !== policy.clientId || field(value, "azp") !== policy.clientId
    || field(value, "scope") !== "portal:read" || field(value, "token_type") !== "Bearer" || Object.hasOwn(value, "cnf")
    || !identifier(userId) || !identifier(authSessionId) || typeof delegationId !== "string" || !uuid.test(delegationId)
    || typeof exp !== "number" || !Number.isSafeInteger(exp) || !future(exp * 1000)) return null;
  return { ...policy, scope: "portal:read", userId, authSessionId, delegationId, expiresAt: exp * 1000 };
}
const denied = () => new APIError("UNAUTHORIZED", { message: "MCP token verification denied" });
// Only an ephemeral request correlation tag, never the provider's storage hash
// protocol. The latter is obtained exclusively from the supported SDK API.
const requestTag = (token: string) => createHash("sha256").update(token).digest("hex");

/** Unwired companion for ONE actual mcp() instance. No browser identity path. */
export function createMcpTokenVerifier(provider: Pick<ReturnType<typeof mcp>, "options">, expected: McpTokenPolicy) {
  const options = provider.options; // Capture the real normalized object, not a reconstructed SDK context/options copy.
  if (options.disableJwtPlugin !== true || options.prefix?.opaqueAccessToken || !url(expected.issuer) || !url(expected.resource) || !identifier(expected.clientId)) throw Error("Invalid MCP verifier composition");
  const policy = Object.freeze({ issuer: expected.issuer, resource: expected.resource, clientId: expected.clientId });
  const candidates = new WeakMap<object, string>(), verified = new WeakSet<object>();
  const plugin = {
    id: "portal-mcp-token-verifier",
    endpoints: {
      verifyPortalMcpToken: createAuthEndpoint("/portal/mcp/verify-token", {
        method: "POST", body: z.strictObject({ token: tokenSchema }), metadata: { SERVER_ONLY: true },
      }, async ctx => {
        try {
          const api = getOAuthProviderApi(ctx, options);
          const projection = project(await api.requireActiveAccessToken(ctx.body.token), policy);
          if (!projection) throw denied();
          const hash = await api.hashToken(ctx.body.token, "access_token");
          if (typeof hash !== "string" || !hash.length || hash.length > 1024 || /[^\x21-\x7e]/.test(hash) || hash === ctx.body.token || !future(projection.expiresAt)) throw denied();
          const candidate: Candidate = Object.freeze({ ...projection, accessTokenHash: hash });
          candidates.set(candidate, requestTag(ctx.body.token));
          return candidate;
        } catch { throw denied(); }
      }),
    },
  };
  function readEvidence(value: unknown): McpTokenEvidence | null {
    return value && typeof value === "object" && verified.has(value) && future((value as McpTokenEvidence).expiresAt) ? value as McpTokenEvidence : null;
  }
  function bind(api: VerifierApi) {
    // This dependency is trusted server composition, never request/client input.
    return async function verify(raw: unknown): Promise<McpTokenEvidence | null> {
      if (!tokenSchema.safeParse(raw).success || typeof raw !== "string") return null;
      try {
        const candidate = await api.verifyPortalMcpToken({ body: { token: raw } });
        // Real SDK identity preservation is verified by actual-library tests.
        // Serialization/cloning fails closed, rather than minting a brand from claims.
        if (!candidate || typeof candidate !== "object" || candidates.get(candidate) !== requestTag(raw) || !future((candidate as Candidate).expiresAt)) return null;
        const evidence = Object.freeze({ ...candidate }) as McpTokenEvidence;
        verified.add(evidence); // Brand only AFTER every SDK/hash/API await and expiry fence.
        return evidence;
      } catch { return null; }
    };
  }
  // This evidence is provider validation only. Falsy JSON confirmation can be
  // omitted by the SDK: storage confirmation IS NULL, header policy, live portal
  // locks/Google/grant/consent and a final response fence remain mandatory later.
  return Object.freeze({ plugin, bind, readEvidence });
}
