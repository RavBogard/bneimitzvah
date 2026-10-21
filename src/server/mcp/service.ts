import "server-only";
import { createHmac } from "node:crypto";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import { withTenantTransaction } from "../db/runtime";
import { lockRoleGrant } from "../data/authority";
import * as data from "../data/mcp";
import { AccessDenied } from "../access/errors";
import type { createAccessService } from "../access/service";
import type { AccessDatabase, AccessRequest, AccessTransaction, Actor, LockIntent } from "../access/types";
import { MCP_PATH, SCOPES, TTL, hashOpaque, pkceChallenge, randomToken, redirectMatches, redirectPermitted, requestedScopes, sign, verify } from "./oauth";

/** The live, server-verified authority behind one MCP request (never built from caller input). */
export type McpActor = Readonly<{
  tenantId: string; origin: string; connectionId: string; userId: string; membershipId: string; roleGrantId: string;
  role: "admin" | "tutor"; roleGrantRevision: number; authorityRevision: number; scopes: ReadonlySet<string>; unattended: boolean; expiresAt: number;
}>;
export type OAuthAnswer = Readonly<{ status: number; body: Record<string, unknown> }> | Readonly<{ redirect: string }>;
export type ConsentView = Readonly<{
  clientName: string; destination: string;
  account: null | Readonly<{ name: string; google: boolean; role: "admin" | "tutor" | null; scopes: readonly string[]; viewer: string }>;
}>;
type Resolved = Readonly<{ tenantId: string; origin: string }>;

const STANDARD = new Set(["invalid_request", "invalid_client", "invalid_grant", "unauthorized_client", "unsupported_grant_type", "invalid_scope", "invalid_target", "unsupported_response_type", "access_denied", "server_error", "temporarily_unavailable", "invalid_client_metadata", "invalid_redirect_uri"]);
class OAuthError extends Error { constructor(readonly code: string, readonly status = 400) { super(code); } }
const oauthError = (error: unknown): OAuthAnswer => {
  const code = error instanceof OAuthError && STANDARD.has(error.code) ? error.code : "server_error";
  return Object.freeze({ status: error instanceof OAuthError ? error.status : 500, body: { error: code } });
};
const withQuery = (url: string, values: Record<string, string | undefined>) => {
  const u = new URL(url); for (const [k, v] of Object.entries(values)) if (v !== undefined) u.searchParams.set(k, v); return u.toString();
};
const VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;
const CHALLENGE = /^[A-Za-z0-9_-]{43}$/;
/** A Google sign-in counts for consent only while it is this recent; an older session asks again. */
export const GOOGLE_CONSENT_WINDOW_MS = 15 * 60_000;
const plainName = (value: unknown) => typeof value === "string" && value.trim() && !/[\u0000-\u001f\u007f<>]/.test(value) ? value.trim().slice(0, 120) : "Claude";

/** Scopes a grant may hold. Only an admin grant can carry the study write scope (S21). */
function grantedScope(role: "admin" | "tutor", asked: ReadonlySet<string>): string {
  if (role === "tutor") return SCOPES.read;
  return asked.size === 1 && asked.has(SCOPES.read) ? SCOPES.read : `${SCOPES.read} ${SCOPES.study}`;
}

export function createMcpAuthService<Q extends PgQueryResultHKT>(input: {
  db: AccessDatabase<Q>; access: Pick<ReturnType<typeof createAccessService<Q>>, "withVerifiedIdentity">; secret: string; now?: () => number;
}) {
  const now = input.now ?? Date.now;
  const recentGoogle = (at: Date | null) => !!at && now() - at.getTime() < GOOGLE_CONSENT_WINDOW_MS && at.getTime() <= now() + 60_000;
  const viewerOf = (identity: { userId: string; authSessionId: string; tenantId: string }) =>
    createHmac("sha256", input.secret).update(JSON.stringify(["mcp-consent-viewer/v1", identity.tenantId, identity.userId, identity.authSessionId])).digest("base64url");
  const clientRecord = (clientId: unknown) => {
    const record = verify(input.secret, "mc", clientId, now());
    if (!record || !Array.isArray(record.redirect_uris) || !record.redirect_uris.every(redirectPermitted)) return null;
    return { redirectUris: record.redirect_uris as string[], clientName: plainName(record.client_name), hash: hashOpaque(String(clientId)) };
  };
  const pendingRecord = (pending: unknown) => {
    const r = verify(input.secret, "mr", pending, now());
    if (!r || typeof r.client !== "string" || !redirectPermitted(r.redirect_uri) || typeof r.code_challenge !== "string" || !CHALLENGE.test(r.code_challenge)
      || typeof r.scope !== "string" || (r.state !== null && typeof r.state !== "string") || typeof r.resource !== "string") return null;
    const asked = requestedScopes(r.scope); if (!asked) return null;
    return { client: r.client, clientName: plainName(r.client_name), redirectUri: r.redirect_uri, challenge: r.code_challenge, asked, state: r.state as string | null, resource: r.resource };
  };

  /** Re-establish the connection's authority inside the caller's tenant transaction. */
  async function liveConnection(tx: AccessTransaction<Q>, resolved: Resolved, connectionId: string, intent: LockIntent, tokenExpiresAt?: number): Promise<McpActor> {
    const at = now();
    const tenant = await data.lockTenant(tx, resolved.tenantId, intent);
    if (!tenant?.enabled) throw new AccessDenied(401);
    const connection = await data.lockConnection(tx, resolved.tenantId, connectionId, intent);
    if (!connection || connection.revokedAt || connection.expiresAt.getTime() <= at || (connection.role !== "admin" && connection.role !== "tutor")) throw new AccessDenied(401);
    const user = await data.lockUser(tx, connection.userId, intent);
    const member = await data.lockMembership(tx, resolved.tenantId, connection.membershipId, intent);
    if (!user?.verified || !member || member.disabledAt || member.userId !== connection.userId || member.authorityRevision !== connection.authorityRevision) throw new AccessDenied(401);
    const grant = await lockRoleGrant(tx, resolved.tenantId, member.id, connection.role, intent);
    // A reissued grant, a bumped revision or a revoked grant ends the connection's authority.
    if (!grant || grant.revokedAt || grant.id !== connection.roleGrantId || grant.revision !== connection.roleGrantRevision) throw new AccessDenied(401);
    return Object.freeze({
      tenantId: resolved.tenantId, origin: resolved.origin, connectionId: connection.id, userId: connection.userId, membershipId: member.id, roleGrantId: grant.id,
      role: connection.role, roleGrantRevision: grant.revision, authorityRevision: member.authorityRevision, scopes: new Set(connection.scope.split(" ")),
      unattended: connection.unattended, expiresAt: Math.min(connection.expiresAt.getTime(), tokenExpiresAt ?? Infinity),
    });
  }
  /** Issue an access token and a rotated refresh token, neither outliving the connection. */
  async function issue(tx: AccessTransaction<Q>, actor: McpActor) {
    const at = now(), access = randomToken(), refresh = randomToken();
    const accessExpiry = Math.min(at + TTL.access, actor.expiresAt), refreshExpiry = actor.expiresAt;
    if (accessExpiry <= at + 1000) throw new OAuthError("invalid_grant");
    await data.insertToken(tx, { tokenHash: hashOpaque(access), tenantId: actor.tenantId, connectionId: actor.connectionId, kind: "access", createdAt: new Date(at), expiresAt: new Date(accessExpiry) });
    await data.insertToken(tx, { tokenHash: hashOpaque(refresh), tenantId: actor.tenantId, connectionId: actor.connectionId, kind: "refresh", createdAt: new Date(at), expiresAt: new Date(refreshExpiry) });
    return { access_token: access, token_type: "Bearer", expires_in: Math.floor((accessExpiry - at) / 1000), refresh_token: refresh, scope: [...actor.scopes].join(" ") };
  }

  return Object.freeze({
    /** POST /api/oauth/register: a signed public-client record; nothing is stored. */
    register(body: unknown): OAuthAnswer {
      try {
        if (!body || typeof body !== "object" || Array.isArray(body)) throw new OAuthError("invalid_client_metadata");
        const b = body as Record<string, unknown>;
        const redirects = b.redirect_uris;
        if (!Array.isArray(redirects) || redirects.length < 1 || redirects.length > 10) throw new OAuthError("invalid_redirect_uri");
        if (!redirects.every(redirectPermitted)) throw new OAuthError("invalid_redirect_uri");
        if (b.token_endpoint_auth_method !== undefined && b.token_endpoint_auth_method !== "none") throw new OAuthError("invalid_client_metadata");
        const grants = b.grant_types ?? ["authorization_code", "refresh_token"], responses = b.response_types ?? ["code"];
        if (!Array.isArray(grants) || !grants.includes("authorization_code") || grants.some(g => g !== "authorization_code" && g !== "refresh_token")
          || !Array.isArray(responses) || responses.length !== 1 || responses[0] !== "code") throw new OAuthError("invalid_client_metadata");
        const redirectUris = [...new Set(redirects as string[])], clientName = plainName(b.client_name);
        // The client id travels in the authorize URL; keep it well inside the dispatcher's URL bound.
        if (JSON.stringify(redirectUris).length > 700) throw new OAuthError("invalid_redirect_uri");
        const clientId = sign(input.secret, "mc", { redirect_uris: redirectUris, client_name: clientName }, TTL.client, now());
        return Object.freeze({ status: 201, body: { client_id: clientId, client_id_issued_at: Math.floor(now() / 1000), client_name: clientName, redirect_uris: redirectUris,
          grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none" } });
      } catch (error) { return oauthError(error); }
    },
    /** GET /api/oauth/authorize: validate, then hand a signed pending request to the consent page. */
    authorize(url: URL, resolved: Resolved): OAuthAnswer {
      const q = url.searchParams;
      let verified: string | null = null;
      try {
        for (const key of q.keys()) if (q.getAll(key).length !== 1) throw new OAuthError("invalid_request");
        const client = clientRecord(q.get("client_id")), redirect = q.get("redirect_uri") ?? "";
        if (!client || !redirectPermitted(redirect) || !redirectMatches(client.redirectUris, redirect)) throw new OAuthError("invalid_client");
        verified = redirect;
        const state = q.get("state");
        if (state !== null && state.length > 1024) throw new OAuthError("invalid_request");
        if (q.get("response_type") !== "code") throw new OAuthError("unsupported_response_type");
        const challenge = q.get("code_challenge") ?? "";
        if (q.get("code_challenge_method") !== "S256" || !CHALLENGE.test(challenge)) throw new OAuthError("invalid_request");
        if (!requestedScopes(q.get("scope"))) throw new OAuthError("invalid_scope");
        const resource = `${resolved.origin}${MCP_PATH}`;
        if (q.get("resource") !== null && q.get("resource") !== resource) throw new OAuthError("invalid_target");
        const pending = sign(input.secret, "mr", { client: client.hash, client_name: client.clientName, redirect_uri: redirect, code_challenge: challenge,
          scope: q.get("scope") ?? "", state, resource }, TTL.request, now());
        // A fragment never reaches a server log, a Referer or the consent page's own request line.
        return Object.freeze({ redirect: `${resolved.origin}/connect#request=${pending}` });
      } catch (error) {
        const answer = oauthError(error);
        if (verified && "body" in answer) {
          const state = q.get("state");
          return Object.freeze({ redirect: withQuery(verified, { error: String(answer.body.error), state: state && state.length <= 1024 ? state : undefined, iss: resolved.origin }) });
        }
        return answer;
      }
    },
    /** What the consent page shows: the client, where it returns, and the signed-in staff account. */
    async describe(request: AccessRequest & { method?: string }, pending: unknown): Promise<ConsentView | null> {
      const record = pendingRecord(pending);
      if (!record) return null;
      const destination = new URL(record.redirectUri).host;
      let account: ConsentView["account"] = null;
      try {
        account = await input.access.withVerifiedIdentity(request, { intent: "read" }, async (tx, identity) => {
          const user = await data.lockUser(tx, identity.userId, "read");
          const google = recentGoogle(await data.sessionGoogleMarker(tx, identity.authSessionId, identity.userId));
          let role: "admin" | "tutor" | null = null;
          if (identity.membership) {
            if (await lockRoleGrant(tx, identity.tenantId, identity.membership.id, "admin", "read")) role = "admin";
            else if (await lockRoleGrant(tx, identity.tenantId, identity.membership.id, "tutor", "read")) role = "tutor";
          }
          return Object.freeze({ name: plainName(user?.name), google, role, scopes: role ? grantedScope(role, record.asked).split(" ") : [], viewer: viewerOf(identity) });
        });
      } catch (error) { if (!(error instanceof AccessDenied)) throw error; }
      return Object.freeze({ clientName: record.clientName, destination, account });
    },
    /** POST /api/oauth/consent: the signed-in staff member allows the connection. */
    async approve(request: AccessRequest & { method?: string }, pending: unknown, unattended: boolean, viewer: unknown): Promise<{ ok: true; redirect: string } | { ok: false; reason: "expired" | "google" | "staff" | "account" }> {
      const record = pendingRecord(pending);
      if (!record) return { ok: false, reason: "expired" };
      return input.access.withVerifiedIdentity(request, { intent: "data-write", mutation: true }, async (tx, identity) => {
        // Allow acts only for the account the page showed, confirmed with Google moments ago.
        if (viewer !== viewerOf(identity)) return { ok: false as const, reason: "account" as const };
        if (!recentGoogle(await data.sessionGoogleMarker(tx, identity.authSessionId, identity.userId))) return { ok: false as const, reason: "google" as const };
        if (!identity.membership) return { ok: false as const, reason: "staff" as const };
        const admin = await lockRoleGrant(tx, identity.tenantId, identity.membership.id, "admin", "data-write");
        const grant = admin ?? await lockRoleGrant(tx, identity.tenantId, identity.membership.id, "tutor", "data-write");
        if (!grant || grant.revokedAt || (grant.role !== "admin" && grant.role !== "tutor")) return { ok: false as const, reason: "staff" as const };
        const role = grant.role, at = now();
        if (record.resource !== `${identity.origin}${MCP_PATH}`) return { ok: false as const, reason: "expired" as const };
        const connection = await data.insertConnection(tx, {
          tenantId: identity.tenantId, userId: identity.userId, membershipId: identity.membership.id, roleGrantId: grant.id, role,
          roleGrantRevision: grant.revision, authorityRevision: identity.membership.authorityRevision, scope: grantedScope(role, record.asked),
          unattended, clientName: record.clientName, clientHash: record.client, redirectUri: record.redirectUri,
          createdAt: new Date(at), expiresAt: new Date(at + TTL.connection),
        });
        const code = randomToken();
        await data.insertToken(tx, { tokenHash: hashOpaque(code), tenantId: identity.tenantId, connectionId: connection.id, kind: "code", codeChallenge: record.challenge, createdAt: new Date(at), expiresAt: new Date(at + TTL.code) });
        return { ok: true as const, redirect: withQuery(record.redirectUri, { code, state: record.state ?? undefined, iss: identity.origin }) };
      });
    },
    /** The consent page's Cancel: back to the client with access_denied. */
    deny(pending: unknown, resolved: Resolved): string | null {
      const record = pendingRecord(pending);
      return record ? withQuery(record.redirectUri, { error: "access_denied", state: record.state ?? undefined, iss: resolved.origin }) : null;
    },
    /** POST /api/oauth/token (form-encoded). */
    async token(form: URLSearchParams, resolved: Resolved): Promise<OAuthAnswer> {
      try {
        for (const key of form.keys()) if (form.getAll(key).length !== 1) throw new OAuthError("invalid_request");
        const grantType = form.get("grant_type");
        if (grantType !== "authorization_code" && grantType !== "refresh_token") throw new OAuthError("unsupported_grant_type");
        const client = clientRecord(form.get("client_id"));
        if (!client) throw new OAuthError("invalid_client", 401);
        const resource = form.get("resource");
        if (resource !== null && resource !== `${resolved.origin}${MCP_PATH}`) throw new OAuthError("invalid_target");
        const presented = form.get(grantType === "authorization_code" ? "code" : "refresh_token") ?? "";
        if (!/^[A-Za-z0-9_-]{43}$/.test(presented)) throw new OAuthError("invalid_grant");
        const hash = hashOpaque(presented), at = now();
        const result = await withTenantTransaction(input.db, resolved, async tx => {
          const t = tx as AccessTransaction<Q>;
          const row = await data.lockToken(t, resolved.tenantId, hash, grantType === "authorization_code" ? "code" : "refresh");
          if (!row) return { error: "invalid_grant" as const };
          // A replayed code or refresh token from its own client means one leaked: end the whole
          // connection with a plain UPDATE (no share-then-update upgrade, no wait on running tools).
          if (row.usedAt) {
            if (await data.connectionClient(t, resolved.tenantId, row.connectionId) === client.hash) await data.revokeConnection(t, resolved.tenantId, row.connectionId, new Date(at));
            return { error: "invalid_grant" as const };
          }
          const connection = await data.lockConnection(t, resolved.tenantId, row.connectionId, "data-write");
          if (!connection || connection.clientHash !== client.hash) return { error: "invalid_grant" as const };
          if (row.expiresAt.getTime() <= at) return { error: "invalid_grant" as const };
          if (grantType === "authorization_code") {
            const verifier = form.get("code_verifier") ?? "";
            if (form.get("redirect_uri") !== connection.redirectUri || !VERIFIER.test(verifier) || pkceChallenge(verifier) !== row.codeChallenge) return { error: "invalid_grant" as const };
          }
          if (!(await data.useToken(t, resolved.tenantId, hash, new Date(at)))) return { error: "invalid_grant" as const };
          let actor: McpActor;
          try { actor = await liveConnection(t, resolved, connection.id, "data-write"); }
          catch (error) { if (error instanceof AccessDenied) return { error: "invalid_grant" as const }; throw error; }
          return { body: await issue(t, actor) };
        });
        if ("error" in result) throw new OAuthError(result.error ?? "invalid_grant");
        return Object.freeze({ status: 200, body: result.body });
      } catch (error) { return oauthError(error); }
    },
    /** POST /api/oauth/revoke (RFC 7009): any of the connection's tokens ends the connection. */
    async revoke(form: URLSearchParams, resolved: Resolved): Promise<void> {
      const presented = form.get("token") ?? "";
      if (!/^[A-Za-z0-9_-]{43}$/.test(presented)) return;
      const hash = hashOpaque(presented);
      await withTenantTransaction(input.db, resolved, async tx => {
        const t = tx as AccessTransaction<Q>;
        for (const kind of ["access", "refresh"] as const) {
          const row = await data.lockToken(t, resolved.tenantId, hash, kind);
          if (row) { await data.revokeConnection(t, resolved.tenantId, row.connectionId, new Date(now())); return; }
        }
      });
    },
    /** The bearer's live authority, or null for a missing, unknown, expired or revoked token. */
    async authenticate(request: AccessRequest, resolved: Resolved): Promise<McpActor | null> {
      const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(request.headers.get("authorization") ?? "");
      if (!match) return null;
      const hash = hashOpaque(match[1]);
      try {
        return await withTenantTransaction(input.db, resolved, async tx => {
          const t = tx as AccessTransaction<Q>;
          const row = await data.lockToken(t, resolved.tenantId, hash, "access");
          if (!row || row.expiresAt.getTime() <= now()) return null;
          return liveConnection(t, resolved, row.connectionId, "read", row.expiresAt.getTime());
        });
      } catch (error) { if (error instanceof AccessDenied) return null; throw error; }
    },
    /**
     * Run a tool's work with the connection re-checked inside the same tenant transaction; `live`
     * throws once the token or the connection has expired, for use after any awaited outside work.
     */
    async withLive<T>(actor: McpActor, intent: LockIntent, action: (tx: AccessTransaction<Q>, live: McpActor, alive: () => void) => Promise<T>): Promise<T> {
      return withTenantTransaction(input.db, actor, async tx => {
        const t = tx as AccessTransaction<Q>;
        const fresh = await liveConnection(t, actor, actor.connectionId, intent, actor.expiresAt);
        const alive = () => { if (fresh.expiresAt <= now()) throw new AccessDenied(401); };
        return action(t, fresh, alive);
      });
    },
    /** The portal Actor shape existing student-access helpers take, for an MCP connection. */
    portalActor(actor: McpActor): Actor {
      return Object.freeze({ tenantId: actor.tenantId, origin: actor.origin, userId: actor.userId, authSessionId: "", membershipId: actor.membershipId,
        authSessionExpiresAt: actor.expiresAt, roleGrantId: actor.roleGrantId, roleGrantRevision: actor.roleGrantRevision, mode: actor.role, authorityRevision: actor.authorityRevision });
    },
  });
}
