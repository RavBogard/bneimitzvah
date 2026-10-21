import "server-only";
import { randomUUID } from "node:crypto";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { AccessDatabase } from "../access/types";
import type { createAccessService } from "../access/service";
import type { createPracticeService } from "../practice/service";
import type { RelatedSourceCatalog } from "../study/sources/metadata";
import { AccessDenied } from "../access/errors";
import { createStudyGuideService, type GuideChecker } from "./service";
import { operatorRabbiAuthority } from "./authority";
import { createGuideChecker } from "./citations";
import { validateGuideBody } from "./validation";

/**
 * The interim write path (spec §3a) until the portal MCP is accepted: one Claude-drafted base guide
 * from a JSON file, validated and citation-checked exactly as save_guide will be, written as
 * origin claude, reviewed false, attributed to the named admin membership. Dry run unless apply.
 * Returns counts and codes only; never the body, a name, an email or a connection detail.
 *
 * Remove this module and scripts/apply-study-guide.mjs in the commit that enables the MCP endpoint.
 */
export type BridgeReport = Readonly<{
  mode: "dry-run" | "apply"; outcome: "valid" | "committed" | "refused"; code?: string; problems?: readonly string[];
  themes: number; notes: number; sources: number; readableSources: number; version?: number; held?: boolean;
}>;

export async function applyStudyGuide<Q extends PgQueryResultHKT>(input: {
  db: AccessDatabase<Q>; tenantId: string; membershipId: string; kind: unknown; readingKey: unknown; body: unknown; hold?: boolean; apply: boolean;
  related: (ref: string, signal: AbortSignal) => Promise<RelatedSourceCatalog>;
  // Only the service's write path is used; reads need neither.
  access?: ReturnType<typeof createAccessService<Q>>; practice?: ReturnType<typeof createPracticeService<Q>>;
}): Promise<BridgeReport> {
  const mode = input.apply ? "apply" as const : "dry-run" as const;
  const counts = (body: unknown) => {
    const v = validateGuideBody(body, { allowOverview: true }), themes = v.ok ? v.value.themes : [];
    const sources = themes.flatMap(t => t.notes.flatMap(n => n.sources));
    return { themes: themes.length, notes: themes.reduce((sum, t) => sum + t.notes.length, 0), sources: sources.length, readableSources: sources.filter(s => s.readable).length };
  };
  let resolvedBody: unknown = input.body;
  const realCheck = createGuideChecker({ related: input.related });
  // In a dry run the checker's verdict is the result; nothing reaches the append phase.
  let verdict: Awaited<ReturnType<GuideChecker>> | null = null;
  const check: GuideChecker = async request => {
    verdict = await realCheck(request);
    if (!verdict.ok) return verdict;
    resolvedBody = verdict.body;
    return input.apply ? verdict : { ok: false, problems: ["dry run"] };
  };
  const unused = () => { throw new AccessDenied(403); };
  const service = createStudyGuideService<Q>({ access: input.access ?? (new Proxy({}, { get: unused }) as never), practice: input.practice ?? (new Proxy({}, { get: unused }) as never), check });
  const authority = operatorRabbiAuthority({ db: input.db, tenantId: input.tenantId, membershipId: input.membershipId });
  const current = await service.getBaseGuide(authority, { kind: input.kind, readingKey: input.readingKey });
  const result = await service.setBaseGuide(authority, { kind: input.kind, readingKey: input.readingKey, expectedVersion: current.currentVersion, body: input.body,
    origin: "claude", reviewed: false, hold: input.hold ?? false, mutationId: randomUUID() });
  const finalVerdict = verdict as Awaited<ReturnType<GuideChecker>> | null;
  if (!input.apply && finalVerdict?.ok) return Object.freeze({ mode, outcome: "valid", ...counts(resolvedBody) });
  if (!result.ok) {
    const problems = result.code === "invalid" && result.problems?.[0] !== "dry run" ? result.problems : undefined;
    return Object.freeze({ mode, outcome: "refused", code: result.code, ...(problems ? { problems } : {}), ...counts(input.body) });
  }
  return Object.freeze({ mode, outcome: "committed", version: result.version, held: result.held, ...counts(resolvedBody) });
}
