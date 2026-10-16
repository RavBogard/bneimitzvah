import "server-only";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";
import { AccessDenied } from "../access/errors";

export const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const TTL = 5 * 60_000;
const purposes = new Set(["student-import", "student-reading", "reading-preview", "service-plan"]);
export function createBindings(secret: string, now: () => number) {
  if (typeof secret !== "string" || secret.length < 32) throw new Error("Private student service signing configuration required");
  const material = (purpose: string) => {
    if (!purposes.has(purpose)) throw new AccessDenied(403);
    const aad = Buffer.from(`crc-portal:student-review:v1:${purpose}`);
    return { aad, key: createHmac("sha256", secret).update(aad).digest() };
  };
  const time = () => {
    const value = now();
    if (!Number.isSafeInteger(value) || value < 0 || value > Number.MAX_SAFE_INTEGER - TTL) throw new AccessDenied(403);
    return value;
  };
  const sign = (body: Record<string, unknown>) => {
    try {
      if (typeof body.purpose !== "string") throw 0;
      const { key, aad } = material(body.purpose);
      const serialized = JSON.stringify({ ...body, expiresAt: time() + TTL });
      if (Buffer.byteLength(serialized) > 32000) throw 0;
      const nonce = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key, nonce);
      cipher.setAAD(aad);
      const encrypted = Buffer.concat([cipher.update(serialized, "utf8"), cipher.final()]);
      return `v1.${Buffer.concat([nonce, encrypted, cipher.getAuthTag()]).toString("base64url")}`;
    } catch { throw new AccessDenied(403); }
  };
  const verify = (token: unknown, purpose: string): Record<string, unknown> => {
    try {
      if (typeof token !== "string" || token.length > 48000 || !/^v1\.[A-Za-z0-9_-]+$/.test(token)) throw 0;
      const encoded = token.slice(3), packed = Buffer.from(encoded, "base64url");
      if (packed.length < 29 || packed.toString("base64url") !== encoded) throw 0;
      const { key, aad } = material(purpose);
      const decipher = createDecipheriv("aes-256-gcm", key, packed.subarray(0, 12));
      decipher.setAAD(aad); decipher.setAuthTag(packed.subarray(-16));
      const plaintext = Buffer.concat([decipher.update(packed.subarray(12, -16)), decipher.final()]);
      if (plaintext.length > 32000) throw 0;
      const body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plaintext));
      const current = time();
      if (!body || typeof body !== "object" || Array.isArray(body) || body.purpose !== purpose || !Number.isSafeInteger(body.expiresAt)
        || body.expiresAt <= current || body.expiresAt > current + TTL) throw 0;
      return body;
    } catch { throw new AccessDenied(403); }
  };
  return { sign, verify };
}
