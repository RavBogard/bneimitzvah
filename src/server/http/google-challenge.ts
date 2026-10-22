import "server-only";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, gt, inArray, like, lt, sql } from "drizzle-orm";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { AccessDatabase } from "../access/types";
import { AccessDenied } from "../access/errors";
import { verification, rateLimit } from "../db/auth-schema";
import { closedObject } from "./query";
import type { AuthDestination } from "../../components/portal/sign-in-boundary";

const PREFIX = "portal-google:v1:";
const BUDGET = "portal-google-budget:v1:";
const LIFETIME = 300_000;
const hash = (value: string) => createHash("sha256").update(value).digest();
const random = () => randomBytes(32).toString("base64url");
export const challengeSecretValid = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value)
  && Buffer.from(value, "base64url").toString("base64url") === value;
export class GoogleChallengeLimited extends Error { constructor() { super("Sign-in rate limited"); } }

// Application-only verification namespace. No raw caller identifier reaches SQL.
export function createGoogleChallenges<Q extends PgQueryResultHKT>(input: { db: AccessDatabase<Q>; origin: string; secret: string; now?: () => number }) {
  const secure = new URL(input.origin).protocol === "https:";
  const name = secure ? "__Host-portal_google_binding" : "portal_google_binding";
  const cookie = (binding: string, maxAge: number) => `${name}=${binding}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
  const now = () => { const value = (input.now ?? Date.now)(); if (!Number.isSafeInteger(value) || value < 0 || value > 8_640_000_000_000_000 - LIFETIME) throw new AccessDenied(403); return value; };
  const hmac = (value: unknown) => createHmac("sha256", input.secret).update(JSON.stringify([PREFIX, input.origin, value])).digest("hex");
  function binding(request: Request): string | undefined {
    const header = request.headers.get("cookie") ?? "";
    if (Buffer.byteLength(header) > 16 * 1024 || /[\x00-\x1f\x7f]/.test(header)) throw new AccessDenied(403);
    const values = new Map<string, string>();
    for (const part of header.split(";")) {
      if (!part.trim()) continue;
      const pair = part.trim(), equal = pair.indexOf("="), key = pair.slice(0, equal);
      if (equal < 1 || !/^[!#$%&'*+\-.^_`|~A-Za-z0-9]+$/.test(key) || values.has(key)) throw new AccessDenied(403);
      values.set(key, pair.slice(equal + 1));
    }
    const alternate = secure ? "portal_google_binding" : "__Host-portal_google_binding";
    if (values.has(alternate)) throw new AccessDenied(403);
    const value = values.get(name);
    if (value !== undefined && !challengeSecretValid(value)) throw new AccessDenied(403);
    return value;
  }
  type Transaction = Parameters<Parameters<AccessDatabase<Q>["transaction"]>[0]>[0];
  async function spend(tx: Transaction, browser: string, current: number) {
    // Shared origin budget, then browser budget: stable lock ordering.
    for (const [scope, max] of [[hmac(["origin"]), 30], [hmac(["browser", browser]), 5]] as const) {
      const key = `${BUDGET}${scope}:${Math.floor(current / 60_000)}`;
      const result = await tx.insert(rateLimit).values({ id: key, key, count: 1, lastRequest: current })
        .onConflictDoUpdate({ target: rateLimit.key, set: { count: sql`${rateLimit.count} + 1` }, setWhere: lt(rateLimit.count, max) }).returning({ id: rateLimit.id });
      if (result.length !== 1) throw new GoogleChallengeLimited();
    }
    const oldBudgets = await tx.select({ id: rateLimit.id }).from(rateLimit).where(and(like(rateLimit.id, `${BUDGET}%`), lt(rateLimit.lastRequest, current - 3_600_000))).limit(100);
    if (oldBudgets.length) await tx.delete(rateLimit).where(and(like(rateLimit.id, `${BUDGET}%`), inArray(rateLimit.id, oldBudgets.map(row => row.id))));
  }
  return Object.freeze({
    clear: () => cookie("", 0),
    /** Redirect-mode Google spends the same origin and browser budget as a popup challenge. */
    async limit(request: Request): Promise<string> {
      const browser = binding(request) ?? random(), current = now();
      await input.db.transaction(async tx => { await spend(tx, browser, current); });
      return cookie(browser, 600);
    },
    async issue(request: Request, next: AuthDestination) {
      if (next !== "/" && next !== "/invitations/accept" && next !== "/account") throw new AccessDenied(403);
      const browser = binding(request) ?? random();
      const challengeId = random(), nonce = random(), csrfToken = random(), current = now();
      await input.db.transaction(async tx => {
        await spend(tx, browser, current);
        const expired = await tx.select({ id: verification.id }).from(verification).where(and(like(verification.id, `${PREFIX}%`), lt(verification.expiresAt, new Date(current)))).limit(100);
        if (expired.length) await tx.delete(verification).where(and(like(verification.id, `${PREFIX}%`), inArray(verification.id, expired.map(row => row.id)), lt(verification.expiresAt, new Date(current))));
        await tx.insert(verification).values({ id: PREFIX + challengeId, identifier: PREFIX + hmac([browser, challengeId]),
          value: JSON.stringify({ version: 1, nonce, csrfHash: hash(csrfToken).toString("hex"), origin: input.origin, next, issuedAt: current }), expiresAt: new Date(current + LIFETIME) });
      });
      return { body: { challengeId, nonce, csrfToken, expiresAt: current + LIFETIME }, cookie: cookie(browser, 600) };
    },
    async consume(request: Request, challengeId: unknown, csrfToken: unknown): Promise<{ nonce: string; next: AuthDestination }> {
      if (!challengeSecretValid(challengeId) || !challengeSecretValid(csrfToken)) throw new AccessDenied(403);
      const browser = binding(request);
      if (!browser) throw new AccessDenied(403);
      const current = now();
      return input.db.transaction(async tx => {
        const where = and(eq(verification.id, PREFIX + challengeId), eq(verification.identifier, PREFIX + hmac([browser, challengeId])), gt(verification.expiresAt, new Date(current)));
        const [row] = await tx.select().from(verification).where(where).for("update");
        if (!row) throw new AccessDenied(403);
        // A physical row-lock wait may cross the deadline. The pre-lock
        // predicate is an index filter, never the final expiry authority.
        const lockedAt = now();
        if (row.expiresAt.getTime() <= lockedAt) throw new AccessDenied(403);
        let value: Record<string, unknown>;
        try { value = closedObject(JSON.parse(row.value), ["version", "nonce", "csrfHash", "origin", "next", "issuedAt"]); }
        catch { throw new AccessDenied(403); }
        if (value.version !== 1 || value.origin !== input.origin || !challengeSecretValid(value.nonce) || typeof value.csrfHash !== "string" || !/^[a-f0-9]{64}$/.test(value.csrfHash)
          || !Number.isSafeInteger(value.issuedAt) || Number(value.issuedAt) > lockedAt || Number(value.issuedAt) < 0 || row.expiresAt.getTime() !== Number(value.issuedAt) + LIFETIME
          || (value.next !== "/" && value.next !== "/invitations/accept" && value.next !== "/account") || !timingSafeEqual(Buffer.from(value.csrfHash, "hex"), hash(csrfToken))) throw new AccessDenied(403);
        const consumed = await tx.delete(verification).where(where).returning({ id: verification.id });
        if (consumed.length !== 1) throw new AccessDenied(403);
        return { nonce: value.nonce, next: value.next };
      });
    },
  });
}
