import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { mailbox } from "../runtime/config";

/**
 * The typed sign-in code's device binding (1.5, plan §2.3). Asking for a sign-in email on this device sets a
 * sealed, HttpOnly cookie that only the code route receives; typing the code sends no email address, so the
 * code can be tried only from the device that asked for it, only for that address, and the browser never holds
 * the address. AES-256-GCM with a purpose key; the origin is bound in as associated data. The binding grants no
 * attempts of its own: attempts belong to the issued code (three, in the auth SDK's verification row).
 */
export const SIGN_IN_CODE_PATH = "/api/auth/sign-in/code";
export const SIGN_IN_CODE_LIFETIME_MS = 300_000;
const VERSION = 1;
export type SignInCodeBinding = Readonly<{ email: string; bucket: string }>;

export function createSignInCodeBindings(input: { origin: string; secret: string; now?: () => number }) {
  const secure = new URL(input.origin).protocol === "https:";
  const name = secure ? "__Secure-portal-code" : "portal-code", other = secure ? "portal-code" : "__Secure-portal-code";
  const key = createHash("sha256").update(`crc-portal:sign-in-code-binding:v1:${input.secret}`).digest();
  const aad = Buffer.from(`crc-portal:sign-in-code:v1:${input.origin}`);
  const now = () => (input.now ?? Date.now)();
  const cookie = (value: string, maxAge: number) => `${name}=${value}; Path=${SIGN_IN_CODE_PATH}; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
  function seal(email: string): string {
    const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(aad);
    const body = Buffer.concat([cipher.update(JSON.stringify({ v: VERSION, e: email.toLowerCase(), x: now() + SIGN_IN_CODE_LIFETIME_MS }), "utf8"), cipher.final()]);
    return Buffer.concat([iv, body, cipher.getAuthTag()]).toString("base64url");
  }
  function unseal(value: string): string | null {
    if (value.length < 40 || value.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
    const raw = Buffer.from(value, "base64url");
    if (raw.toString("base64url") !== value || raw.length < 12 + 16 + 2) return null;
    try {
      const decipher = createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
      decipher.setAAD(aad); decipher.setAuthTag(raw.subarray(raw.length - 16));
      const plain = Buffer.concat([decipher.update(raw.subarray(12, raw.length - 16)), decipher.final()]).toString("utf8");
      const parsed = JSON.parse(plain) as Record<string, unknown>;
      const time = now();
      if (!parsed || typeof parsed !== "object" || Object.keys(parsed).join() !== "v,e,x" || parsed.v !== VERSION || typeof parsed.e !== "string" || !mailbox(parsed.e)
        || parsed.e !== parsed.e.toLowerCase() || !Number.isSafeInteger(parsed.x) || (parsed.x as number) <= time || (parsed.x as number) > time + SIGN_IN_CODE_LIFETIME_MS) return null;
      return parsed.e;
    } catch { return null; }
  }
  return Object.freeze({
    /** The Set-Cookie for a fresh binding to this address. */
    issue: (email: string) => cookie(seal(email), Math.floor(SIGN_IN_CODE_LIFETIME_MS / 1000)),
    clear: () => cookie("", 0),
    /** This device's one binding, or null: missing, duplicated, tampered, from the other cookie scheme or expired. */
    read(request: Request): SignInCodeBinding | null {
      const header = request.headers.get("cookie") ?? "";
      if (Buffer.byteLength(header) > 16 * 1024) return null;
      let found: string | null = null, count = 0;
      for (const part of header.split(";")) {
        const pair = part.trim(), equal = pair.indexOf("=");
        if (equal < 1) continue;
        const cookieName = pair.slice(0, equal);
        if (cookieName === other) return null;
        if (cookieName === name) { count++; found = pair.slice(equal + 1); }
      }
      if (count !== 1 || !found) return null;
      const email = unseal(found);
      // Each binding gets its own rate-limit bucket, so wrong codes never drain anyone else's sign-in.
      return email ? Object.freeze({ email, bucket: createHash("sha256").update(found).digest("hex").slice(0, 32) }) : null;
    },
  });
}
export type SignInCodeBindings = ReturnType<typeof createSignInCodeBindings>;
