import "server-only";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// The portal MCP's OAuth 2.1 surface (Decided here, 2026-10-21), modelled on the haftarah
// connector Daniel already uses from Claude: public clients registered dynamically, PKCE S256,
// redirects held to Claude's own callbacks or a loopback. Registration and the pending consent
// request are HMAC-signed records carrying their own expiry; codes, access and refresh tokens are
// random and stored only as SHA-256 hashes (mcp_token), so a connection can be revoked.
// portal:roster (Daniel, 2026-10-21): the Maven roster intake, a consent of its own, admin only and never for a scheduled routine.
export const SCOPES = { read: "portal:read", study: "portal:study", roster: "portal:roster" } as const;
export const MCP_PATH = "/api/mcp";
export const TTL = { client: 10 * 365 * 24 * 3600_000, request: 10 * 60_000, code: 5 * 60_000, access: 3600_000, connection: 30 * 24 * 3600_000, rosterPlan: 30 * 60_000 } as const;
export const CLAUDE_CALLBACKS: readonly string[] = Object.freeze(["https://claude.ai/api/mcp/auth_callback", "https://claude.com/api/mcp/auth_callback"]);

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64url");
const hmac = (secret: string, s: string) => createHmac("sha256", secret).update(s).digest("base64url");
export const hashOpaque = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
export const pkceChallenge = (verifier: string) => createHash("sha256").update(verifier, "ascii").digest("base64url");
export const randomToken = () => randomBytes(32).toString("base64url");

/** mc: a registered client; mr: a pending consent request; rp: a reviewed roster plan (Maven intake). */
type Kind = "mc" | "mr" | "rp";
/** `<kind>.<payload>.<mac>`, the payload JSON with `iat`/`exp` in milliseconds. */
export function sign(secret: string, kind: Kind, payload: Record<string, unknown>, ttlMs: number, now: number): string {
  const body = b64(JSON.stringify({ ...payload, iat: now, exp: now + ttlMs }));
  return `${kind}.${body}.${hmac(secret, `${kind}.${body}`)}`;
}
/** The payload when the kind, the mac and the expiry hold; null otherwise. Never throws. */
export function verify(secret: string, kind: Kind, token: unknown, now: number): Record<string, unknown> | null {
  if (typeof token !== "string" || token.length > 8192 || !secret) return null;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== kind || !/^[A-Za-z0-9_-]+$/.test(parts[1]) || !/^[A-Za-z0-9_-]{43}$/.test(parts[2])) return null;
  const expected = Buffer.from(hmac(secret, `${parts[0]}.${parts[1]}`)), given = Buffer.from(parts[2]);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const p: unknown = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    if (!p || typeof p !== "object" || Array.isArray(p)) return null;
    const record = p as Record<string, unknown>;
    return typeof record.exp === "number" && record.exp > now ? record : null;
  } catch { return null; }
}

const loopback = (host: string) => host === "localhost" || host === "127.0.0.1" || host === "[::1]";
/** Exactly Claude's callbacks, or an http: loopback URL (Claude Code picks its own port). */
export function redirectPermitted(uri: unknown): uri is string {
  if (typeof uri !== "string" || uri.length > 2048) return false;
  if (CLAUDE_CALLBACKS.includes(uri)) return true;
  let u: URL; try { u = new URL(uri); } catch { return false; }
  return u.protocol === "http:" && loopback(u.hostname) && !u.username && !u.password && !u.hash && u.toString() === uri;
}
/** A registered loopback redirect matches on everything but the port. */
export function redirectMatches(registered: readonly string[], given: string): boolean {
  if (registered.includes(given)) return true;
  let g: URL; try { g = new URL(given); } catch { return false; }
  return g.protocol === "http:" && loopback(g.hostname) && registered.some(r => {
    try { const u = new URL(r); return u.protocol === "http:" && loopback(u.hostname) && u.hostname === g.hostname && u.pathname === g.pathname && u.search === g.search; } catch { return false; }
  });
}

export const authorizationMetadata = (origin: string) => ({
  issuer: origin, authorization_endpoint: `${origin}/api/oauth/authorize`, token_endpoint: `${origin}/api/oauth/token`,
  registration_endpoint: `${origin}/api/oauth/register`, revocation_endpoint: `${origin}/api/oauth/revoke`,
  scopes_supported: [SCOPES.read, SCOPES.study, SCOPES.roster], response_types_supported: ["code"], response_modes_supported: ["query"],
  grant_types_supported: ["authorization_code", "refresh_token"], code_challenge_methods_supported: ["S256"],
  token_endpoint_auth_methods_supported: ["none"], revocation_endpoint_auth_methods_supported: ["none"],
  authorization_response_iss_parameter_supported: true,
});
export const resourceMetadata = (origin: string) => ({
  resource: `${origin}${MCP_PATH}`, authorization_servers: [origin], scopes_supported: [SCOPES.read, SCOPES.study, SCOPES.roster],
  bearer_methods_supported: ["header"], resource_name: "CRC B'nei Mitzvah",
});

/** The scopes a client asked for, closed to ours; none asked means the role's default. */
export function requestedScopes(value: unknown): Set<string> | null {
  if (value === null || value === undefined || value === "") return new Set();
  if (typeof value !== "string" || value.length > 200) return null;
  const items = value.split(" ").filter(Boolean);
  if (new Set(items).size !== items.length) return null;
  // offline_access is how some clients ask for a refresh token; every grant here already has one.
  if (items.some(item => item !== SCOPES.read && item !== SCOPES.study && item !== SCOPES.roster && item !== "offline_access")) return null;
  return new Set(items.filter(item => item !== "offline_access"));
}
