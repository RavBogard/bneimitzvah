import "server-only";
import { timingSafeEqual } from "node:crypto";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import { AccessDenied, AccessUnavailable } from "../access/errors";
import type { createAccessService } from "../access/service";
import type { AccessDatabase, AccessRequest } from "../access/types";
import { withTenantTransaction } from "../db/runtime";
import { accessToken, replaceSheet, SheetUnavailable, type ServiceAccount } from "./google";
import { rosterRows } from "./rows";

export type RosterSheetConfig = Readonly<{ account: ServiceAccount; sheetId: string }>;
export type RosterSyncResult = Readonly<{ ok: true; students: number; at: string }> | Readonly<{ ok: false; reason: "not-configured" | "google" }>;

/**
 * Rewrites the staff roster Sheet from the portal (staff read it; nothing is read back). Runs
 * nightly from Vercel Cron and on an admin's "Update the Sheet now". Rows are read in one tenant
 * transaction; Google is called after it commits, so no database lock waits on the network.
 */
export function createRosterSheetService<Q extends PgQueryResultHKT>(input: {
  db: AccessDatabase<Q>; access: Pick<ReturnType<typeof createAccessService<Q>>, "withAdminCapability">;
  config: RosterSheetConfig | null; cronSecret?: string; fetch: typeof globalThis.fetch;
}) {
  async function sync(tenantId: string): Promise<RosterSyncResult> {
    if (!input.config) return Object.freeze({ ok: false, reason: "not-configured" });
    const rows = await withTenantTransaction(input.db, { tenantId }, tx => rosterRows(tx as never, tenantId));
    try {
      const token = await accessToken(input.config.account, input.fetch);
      await replaceSheet(input.config.sheetId, rows, token, input.fetch);
    } catch (error) { if (error instanceof SheetUnavailable) return Object.freeze({ ok: false, reason: "google" }); throw error; }
    return Object.freeze({ ok: true, students: rows.length - 1, at: new Date().toISOString() });
  }
  return Object.freeze({
    configured: input.config !== null,
    /** Vercel Cron: GET with the project's CRON_SECRET bearer, never a cookie. */
    async cron(request: AccessRequest, resolved: { tenantId: string }) {
      if (!input.cronSecret || input.cronSecret.length < 32) throw new AccessUnavailable();
      if (request.headers.has("cookie") || request.headers.has("X-Practice-Context")) throw new AccessDenied(403);
      const expected = Buffer.from(`Bearer ${input.cronSecret}`), candidate = Buffer.from(request.headers.get("authorization") ?? "");
      if (candidate.length !== expected.length || !timingSafeEqual(expected, candidate)) throw new AccessDenied(401);
      return sync(resolved.tenantId);
    },
    /** An admin's "Update the Sheet now". */
    async now(request: AccessRequest & { method?: string }) {
      const tenantId = await input.access.withAdminCapability(request, { mode: "admin", capability: "manage-students" }, async (_tx, actor) => actor.tenantId);
      return sync(tenantId);
    },
  });
}
