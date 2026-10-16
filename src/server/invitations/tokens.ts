import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { AccessDenied } from "../access/errors";

export const INVITATION_LIFETIME_MS = 72 * 60 * 60_000;
export function createInvitationSecret() {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashInvitationToken(token) };
}
export function hashInvitationToken(token: string) {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new AccessDenied(404);
  return createHash("sha256").update(token).digest("hex");
}
export function normalizedInvitationEmail(value: string) {
  if (typeof value !== "string") throw new AccessDenied(403);
  const normalized = value.trim().toLowerCase();
  if (normalized.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized)) throw new AccessDenied(403);
  return normalized;
}
