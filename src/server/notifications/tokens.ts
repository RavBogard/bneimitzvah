import { createHmac, timingSafeEqual } from "node:crypto";
import { KIND_CODE, KIND_OF_CODE, type NotificationKind } from "./schedule";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const UNSUBSCRIBE_TOKEN = /^([tdr])\.([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.([A-Za-z0-9_-]{43})$/;
const mac = (secret: string, tenantId: string, membershipId: string, kind: NotificationKind) =>
  createHmac("sha256", secret).update(JSON.stringify(["notification-unsubscribe/v1", tenantId, membershipId, kind])).digest("base64url");

/**
 * The one-click unsubscribe capability for one member and one kind in one congregation. It can only
 * turn that kind off for that member; it opens no page, session or content.
 */
export function signUnsubscribe(secret: string, tenantId: string, membershipId: string, kind: NotificationKind) {
  if (secret.length < 32 || !UUID.test(membershipId)) throw new Error("Unsubscribe unavailable");
  return `${KIND_CODE[kind]}.${membershipId}.${mac(secret, tenantId, membershipId, kind)}`;
}
export function openUnsubscribe(secret: string, tenantId: string, token: unknown): { membershipId: string; kind: NotificationKind } | null {
  if (typeof token !== "string" || secret.length < 32) return null;
  const match = UNSUBSCRIBE_TOKEN.exec(token); if (!match) return null;
  const kind = KIND_OF_CODE[match[1]], expected = Buffer.from(mac(secret, tenantId, match[2], kind)), candidate = Buffer.from(match[3]);
  return expected.length === candidate.length && timingSafeEqual(expected, candidate) ? { membershipId: match[2], kind } : null;
}
