import "server-only";
import { createHmac } from "node:crypto";

export function offlineOwnerName(secret: string, tenantId: string, userId: string) {
  return createHmac("sha256", secret).update(JSON.stringify(["offline-owner:v1", tenantId, userId])).digest("base64url");
}
