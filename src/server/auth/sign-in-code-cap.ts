import "server-only";
import { createHmac, randomUUID } from "node:crypto";
import { and, count, eq, gt, inArray } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type * as schema from "../db/index";
import { verification } from "../db/auth-schema";

/**
 * Per-address caps on the typed sign-in code (1.5, review §2.8 finding 1). Each code allows 3 tries, but the magic-link
 * limiter is per origin, so on its own an attacker who knows an address could keep guessing indefinitely. An address
 * gets at most 3 codes in any rolling hour and 6 in any rolling 24 hours (later emails carry the link only), and at
 * most 9 failed tries in any hour (later tries are refused as expired). Kept as Better Auth verification rows (no migration): one row per event, keyed on an
 * HMAC of the normalized address, never the address, and expiring after the hour, when Better Auth removes it.
 */
export const SIGN_IN_CODE_CAP = Object.freeze({ codesPerHour: 3, codesPerDay: 6, failedTriesPerHour: 9, windowMs: 60 * 60 * 1000, dayMs: 24 * 60 * 60 * 1000 });
export type SignInCodeCapEvent = "code" | "guess";
type CapKey = SignInCodeCapEvent | "code-day";

export function createSignInCodeCap<Q extends PgQueryResultHKT>(input: {
  db: PgDatabase<Q, typeof schema>; secret: string; capped: (event: SignInCodeCapEvent) => void; now?: () => number;
}) {
  if (typeof input.secret !== "string" || input.secret.length < 32 || typeof input.capped !== "function") throw new Error("Sign-in code cap unavailable");
  const now = input.now ?? (() => Date.now());
  const key = (purpose: CapKey, email: string) =>
    `sign-in-cap:${purpose}:${createHmac("sha256", input.secret).update(`${purpose}\0${email.trim().toLowerCase()}`).digest("hex")}`;
  const live = (identifier: string) => and(eq(verification.identifier, identifier), gt(verification.expiresAt, new Date(now())));
  async function spent(identifier: string) {
    const [row] = await input.db.select({ value: count() }).from(verification).where(live(identifier));
    return Number(row?.value ?? 0);
  }
  async function record(identifier: string, lifetimeMs: number = SIGN_IN_CODE_CAP.windowMs) {
    const id = randomUUID();
    await input.db.insert(verification).values({ id, identifier, value: "1", expiresAt: new Date(now() + lifetimeMs) });
    return id;
  }
  const capped = (event: SignInCodeCapEvent) => { try { input.capped(event); } catch { /* Logging cannot change the outcome. */ } };
  return Object.freeze({
    /**
     * True when this sign-in email may carry a code, and records it. Recording first and then counting means two
     * concurrent requests can only both lose: an address never gets a fourth code within the hour.
     */
    async claimCode(email: string): Promise<boolean> {
      // Two windows on the same address hash: 3 codes in any hour and 6 in any 24 hours.
      const hour = key("code", email), day = key("code-day", email);
      const ids = [await record(hour), await record(day, SIGN_IN_CODE_CAP.dayMs)];
      if (await spent(hour) <= SIGN_IN_CODE_CAP.codesPerHour && await spent(day) <= SIGN_IN_CODE_CAP.codesPerDay) return true;
      await input.db.delete(verification).where(inArray(verification.id, ids));
      capped("code");
      return false;
    },
    /** True when this address has used its failed tries for the hour; the code route then answers as for an expired code. */
    async guessesSpent(email: string): Promise<boolean> {
      if (await spent(key("guess", email)) < SIGN_IN_CODE_CAP.failedTriesPerHour) return false;
      capped("guess");
      return true;
    },
    async recordGuess(email: string): Promise<void> { await record(key("guess", email)); },
  });
}
export type SignInCodeCap = ReturnType<typeof createSignInCodeCap>;
