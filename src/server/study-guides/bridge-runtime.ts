import "server-only";
import { createRuntimeDatabase } from "../db/runtime";
import { createSefariaMetadataReader } from "../study/sources/sefaria-metadata";
import { applyStudyGuide, type BridgeReport } from "./bridge";

/**
 * Entry for scripts/apply-study-guide.mjs only. Opens the app's own restricted runtime connection
 * (the same role and RLS the deployed app uses), applies or dry-runs one guide, and closes it.
 */
export async function runBridge(input: { connectionString: string; tenantId: string; membershipId: string; kind: string; readingKey: string; body: unknown; hold: boolean; apply: boolean }): Promise<BridgeReport> {
  const runtime = createRuntimeDatabase(input.connectionString);
  try {
    return await applyStudyGuide({ db: runtime.db, tenantId: input.tenantId, membershipId: input.membershipId, kind: input.kind, readingKey: input.readingKey,
      body: input.body, hold: input.hold, apply: input.apply, related: createSefariaMetadataReader({ fetch }).related });
  } finally { await runtime.close().catch(() => {}); }
}
