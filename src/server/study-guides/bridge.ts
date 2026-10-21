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
import { projectRelatedCatalog } from "../study/sources/discovery";
import { readableInApp } from "./citations";

/**
 * A Cowork draft may name each source by its Sefaria ref alone ({ "ref": "Rashi on Numbers 1:2:1" }).
 * Each such ref is looked up among the sources Sefaria lists for that note's verse and replaced with
 * Sefaria's own record; any ref not listed there is reported, and the bridge refuses the whole guide.
 * Full source records pass through untouched.
 */
export async function resolveSourceRefs(body: unknown, related: (ref: string, signal: AbortSignal) => Promise<RelatedSourceCatalog>, signal: AbortSignal): Promise<{ body: unknown; unlisted: string[] }> {
  const themes = body && typeof body === "object" ? (body as { themes?: unknown }).themes : null, unlisted: string[] = [];
  if (!Array.isArray(themes)) return { body, unlisted };
  const catalogs = new Map<string, Promise<ReadonlyMap<string, ReturnType<typeof projectRelatedCatalog>["entries"][number]>>>();
  const lookup = (verse: string) => {
    let found = catalogs.get(verse);
    if (!found) { found = related(verse, signal).then(catalog => new Map(projectRelatedCatalog(catalog, verse).entries.map(entry => [entry.ref, entry]))); catalogs.set(verse, found); }
    return found;
  };
  const out = [];
  for (const theme of themes) {
    const notes = theme && typeof theme === "object" ? (theme as { notes?: unknown }).notes : null;
    if (!Array.isArray(notes)) { out.push(theme); continue; }
    const resolvedNotes = [];
    for (const note of notes) {
      const n = note && typeof note === "object" ? note as { verseRef?: unknown; sources?: unknown } : null;
      if (!n || typeof n.verseRef !== "string" || !Array.isArray(n.sources)) { resolvedNotes.push(note); continue; }
      const sources = [];
      for (const source of n.sources) {
        const onlyRef = source && typeof source === "object" && Object.keys(source).length === 1 && typeof (source as { ref?: unknown }).ref === "string";
        if (!onlyRef) { sources.push(source); continue; }
        const entry = (await lookup(n.verseRef)).get((source as { ref: string }).ref);
        if (!entry) { unlisted.push(`${(source as { ref: string }).ref.slice(0, 200)} is not a Sefaria source for ${n.verseRef}`); continue; }
        sources.push({ id: entry.id, ref: entry.ref, indexTitle: entry.indexTitle, category: entry.category, labels: { en: entry.labels.en, he: entry.labels.he }, readable: readableInApp(entry) });
      }
      resolvedNotes.push({ ...n, sources });
    }
    out.push({ ...(theme as object), notes: resolvedNotes });
  }
  return { body: { ...(body as object), themes: out }, unlisted };
}

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
  // Refs-only sources from a Cowork draft become Sefaria's records first; failure to reach Sefaria refuses below.
  let body: unknown = input.body;
  try { const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 20_000); try { const resolved = await resolveSourceRefs(input.body, input.related, controller.signal); body = resolved.body;
    if (resolved.unlisted.length) return Object.freeze({ mode, outcome: "refused" as const, code: "invalid", problems: resolved.unlisted, ...counts(input.body) }); } finally { clearTimeout(timer); } }
  catch { return Object.freeze({ mode, outcome: "refused", code: "invalid", problems: ["Sefaria's related sources could not be checked just now; nothing was saved. Try again."], ...counts(input.body) }); }
  let resolvedBody: unknown = body;
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
  const result = await service.setBaseGuide(authority, { kind: input.kind, readingKey: input.readingKey, expectedVersion: current.currentVersion, body,
    origin: "claude", reviewed: false, hold: input.hold ?? false, mutationId: randomUUID() });
  const finalVerdict = verdict as Awaited<ReturnType<GuideChecker>> | null;
  if (!input.apply && finalVerdict?.ok) return Object.freeze({ mode, outcome: "valid", ...counts(resolvedBody) });
  if (!result.ok) {
    const problems = result.code === "invalid" && result.problems?.[0] !== "dry run" ? result.problems : undefined;
    return Object.freeze({ mode, outcome: "refused", code: result.code, ...(problems ? { problems } : {}), ...counts(body) });
  }
  return Object.freeze({ mode, outcome: "committed", version: result.version, held: result.held, ...counts(resolvedBody) });
}
