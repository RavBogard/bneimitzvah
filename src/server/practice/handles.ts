import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { AccessDenied } from "../access/errors";
import type { AccessRequest } from "../access/types";

export const PRACTICE_LIFETIME_MS = 60 * 60_000;
export const PRACTICE_HEADER = "X-Practice-Context";
export function hashPracticeHandle(request: AccessRequest) {
  const value = request.headers.get(PRACTICE_HEADER);
  if (!value || !/^[A-Za-z0-9_-]{43}$/.test(value) || Buffer.from(value, "base64url").toString("base64url") !== value) throw new AccessDenied(404);
  return createHash("sha256").update(value).digest("hex");
}
export function createPracticeHandle() {
  const handle = randomBytes(32).toString("base64url");
  return { handle, tokenHash: createHash("sha256").update(handle).digest("hex") };
}
