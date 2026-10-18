import "server-only";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
const PURPOSE = "crc-portal:honoree-link:v1";
const pattern = /^hl1\.k1\.([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})\.([A-Za-z0-9_-]{43})$/;
const invalid = (): never => { throw new Error("Honoree unavailable"); };
export function createHonoreeTokens(input: { secret: string; origin: string; environment: string; project: string; tenantId: string }) {
  if (typeof input.secret !== "string" || input.secret.length < 32 || input.secret.length > 1024
    || !["production", "preview", "local", "test"].includes(input.environment)
    || !/^[A-Za-z0-9_-]{1,128}$/.test(input.project) || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(input.tenantId) || new URL(input.origin).origin !== input.origin) return invalid();
  // Stable project/environment identity, never an ephemeral deployment/commit.
  const scope = JSON.stringify([PURPOSE, input.project, input.environment, input.tenantId, input.origin, "k1"]);
  const key = createHmac("sha256", input.secret).update(scope).digest();
  const sign = (value: string) => createHmac("sha256", key).update(`${scope}\0${value}`).digest();
  const hash = (value: string) => createHash("sha256").update(`${PURPOSE}:hash\0${value}`).digest("hex");
  function verify(value: unknown) {
    if (typeof value !== "string" || value.length > 128) return invalid();
    const match = pattern.exec(value); if (!match) return invalid();
    for (const segment of match.slice(1)) if (Buffer.from(segment, "base64url").toString("base64url") !== segment) return invalid();
    if (!timingSafeEqual(sign(value.slice(0, value.lastIndexOf("."))), Buffer.from(match[3], "base64url"))) return invalid();
    return Object.freeze({ id: match[1], hash: hash(value), keyId: "k1" as const });
  }
  return Object.freeze({ verify, issue() {
    const prefix = `hl1.k1.${randomBytes(16).toString("base64url")}.${randomBytes(32).toString("base64url")}`;
    const token = `${prefix}.${sign(prefix).toString("base64url")}`;
    return Object.freeze({ token, ...verify(token) });
  } });
}

/** Date-only ceremony cutoff: Chicago midnight exactly seven calendar days later. */
export function hardExpiry(issuedAt: number, ceremonyDate: string): number {
  if (!Number.isSafeInteger(issuedAt) || issuedAt < 0 || !/^\d{4}-\d{2}-\d{2}$/.test(ceremonyDate)) return invalid();
  const day = Date.parse(`${ceremonyDate}T00:00:00.000Z`);
  if (!Number.isFinite(day) || new Date(day).toISOString().slice(0, 10) !== ceremonyDate) return invalid();
  const target = day + 7 * 86400000;
  const format = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  let instant = target;
  for (let i = 0; i < 3; i++) {
    const parts = Object.fromEntries(format.formatToParts(instant).map(p => [p.type, p.value]));
    const displayed = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
    instant += target - displayed;
  }
  const expiry = Math.min(issuedAt + 90 * 86400000, instant);
  if (!Number.isSafeInteger(expiry) || expiry <= issuedAt) return invalid();
  return expiry;
}
