import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { createAccessService } from "../access/service";
import type { AccessTransaction } from "../access/types";
import { AccessDenied } from "../access/errors";
import { requireCookieMutation, type CookieMutationRequest } from "../http/mutations";
import * as data from "../data/study-guides";
import * as s from "../db/index";
import * as summaries from "../portion-summary/data";
import { parashahOf, validateSummary } from "../portion-summary/validation";
import { canonical, guidePassageVerses, rabbiName } from "../study-guides/service";
import { createGuideChecker } from "../study-guides/citations";
import { validateGuideBody, type GuideBody, type GuideSource } from "../study-guides/validation";
import { projectRelatedCatalog } from "../study/sources/discovery";
import type { RelatedSourceCatalog } from "../study/sources/metadata";
import { currentSettings } from "../data/tenant-settings";
import { authorName, parseShareFile, SHARE_LIMITS, SHARE_SCHEMA, type ShareDiscussion, type ShareFile, type ShareGuide, type ShareSummary } from "./format";

/**
 * Guide sharing (plan ruling 11, 2026-10-30). Export reads the congregation's reviewed work and nothing else; import writes only into the
 * caller's own tenant, held, after looking every citation up again in this portal's own catalog. Both are admin-only and carry no id.
 * What an export can never contain is decided by what these queries select: no student guide table, no held or unreviewed version, no
 * member, grant, email or row id, and nothing from the Sefaria text store.
 */
type Related = (ref: string, signal: AbortSignal) => Promise<RelatedSourceCatalog>;
type Status = "ready" | "skipped";
export type GuideReason = "already-imported" | "has-guide" | "not-in-catalog" | "verse-outside-reading" | "citations-unchecked" | "invalid";
export type SummaryReason = "already-imported" | "not-a-parashah";
export type DiscussionReason = "cannot-arrive-held";
export type PlanGuide = Readonly<{ kind: "torah" | "haftarah"; readingKey: string; status: Status; reason?: GuideReason; droppedCitations: number; credit: string }>;
export type PlanSummary = Readonly<{ reading: string; status: Status; reason?: SummaryReason; credit: string }>;
export type PlanDiscussion = Readonly<{ slug: string; status: "skipped"; reason: DiscussionReason }>;
export type SharePreview = Readonly<{ ok: true; guides: readonly PlanGuide[]; summaries: readonly PlanSummary[]; discussions: readonly PlanDiscussion[]; authors: readonly string[] }>;
export type ShareInvalid = Readonly<{ ok: false; code: "invalid"; problems: readonly string[] }>;
export type ShareImported = Readonly<{ ok: true; imported: Readonly<{ guides: number; summaries: number }>; guides: readonly PlanGuide[]; summaries: readonly PlanSummary[]; discussions: readonly PlanDiscussion[]; authors: readonly string[] }>;

const sha = (parts: unknown) => createHash("sha256").update(canonical(parts)).digest("hex");
/** The identity of a guide's content, from the file's own words: the same file always makes the same key, and the file's claims about itself are never read. */
export const guideImportKey = (guide: ShareGuide) => sha(["guide-import/v1", guide.kind, guide.readingKey, guide.origin, guide.body]);
const FALLBACK_NAME = "the rabbi";
const MAX_CATALOG_READS = 600;

type Ready = { guide: ShareGuide; key: string; body: GuideBody; dropped: number };
type Analysis = { guides: PlanGuide[]; ready: Ready[]; summaries: PlanSummary[]; readySummaries: ShareSummary[]; discussions: PlanDiscussion[]; authors: string[] };

export function createGuideShareService<Q extends PgQueryResultHKT>(input: { access: ReturnType<typeof createAccessService<Q>>; related: Related }) {
  async function nameOf(tx: AccessTransaction<Q>, tenantId: string) {
    const [row] = await tx.select({ customs: s.tenant.customs }).from(s.tenant).where(eq(s.tenant.id, tenantId)).limit(1);
    const name = rabbiName(row?.customs, await currentSettings(tx, tenantId));
    return authorName(name) ? name : FALLBACK_NAME;
  }

  // Export ------------------------------------------------------------------------------------------
  async function exportFile(request: CookieMutationRequest): Promise<ShareFile> {
    return input.access.withAdminCapability(request, { mode: "admin", capability: "read-guides" }, async (tx, actor) => {
      const name = await nameOf(tx, actor.tenantId), keep = <T>(items: T[], one: (item: T) => ShareFile) => items.filter(item => parseShareFile(JSON.parse(JSON.stringify(one(item)))).ok);
      const guides: ShareGuide[] = [];
      for (const row of await data.reviewedVisibleGuides(tx, actor.tenantId, SHARE_LIMITS.guides * 3)) {
        if (!row.reviewed || (row.origin !== "claude" && row.origin !== "rabbi") || (row.kind !== "torah" && row.kind !== "haftarah")) continue;
        const checked = validateGuideBody(row.body, { allowOverview: true });
        if (!checked.ok || checked.value.overview === undefined) continue;
        guides.push({ kind: row.kind, readingKey: row.readingKey, origin: row.origin, credit: row.importCredit ?? name,
          body: { overview: checked.value.overview, themes: checked.value.themes.map(theme => ({ id: theme.id, title: theme.title, intro: theme.intro,
            notes: theme.notes.map(note => ({ verseRef: note.verseRef, body: note.body, sources: note.sources.map(source => ({ ref: source.ref })) })) })) } });
      }
      const approved: ShareSummary[] = (await summaries.summariesIn(tx, actor.tenantId, "approved", SHARE_LIMITS.summaries * 2))
        .flatMap(row => row.credit !== null ? [{ reading: row.readingKey, summary: row.summary, outline: [...row.outline], credit: row.credit }] : []);
      const talks = await discussionsOf(tx, actor.tenantId);
      const empty = { schema: SHARE_SCHEMA, exportedAt: new Date().toISOString(), guides: [], summaries: [], discussions: [] } as const;
      const file: ShareFile = { ...empty,
        guides: keep(guides, guide => ({ ...empty, guides: [guide] })).slice(0, SHARE_LIMITS.guides),
        summaries: keep(approved, summary => ({ ...empty, summaries: [summary] })).slice(0, SHARE_LIMITS.summaries),
        discussions: keep(talks, discussion => ({ ...empty, discussions: [discussion] })).slice(0, SHARE_LIMITS.discussions) };
      if (Buffer.byteLength(JSON.stringify(file)) > SHARE_LIMITS.fileBytes) throw new Error("Export too large");
      return file;
    });
  }
  /** Published discussions with their current sources. Selects named columns only: the runtime cannot read the curator's membership. */
  async function discussionsOf(tx: AccessTransaction<Q>, tenantId: string): Promise<ShareDiscussion[]> {
    const d = s.curatedDiscussion, rows = await tx.select({ id: d.id, slug: d.slug, title: d.title, kind: d.kind }).from(d)
      .where(and(eq(d.tenantId, tenantId), eq(d.status, "published"))).orderBy(asc(d.slug)).limit(SHARE_LIMITS.discussions);
    const out: ShareDiscussion[] = [];
    for (const row of rows) {
      const sources = await tx.select({ translationId: s.curatedDiscussionSource.translationId, position: s.curatedDiscussionSource.position, ref: s.curatedDiscussionSource.ref, anchorRef: s.curatedDiscussionSource.anchorRef,
        edition: s.curatedDiscussionSource.edition, selectedByName: s.curatedDiscussionSource.selectedByName }).from(s.curatedDiscussionSource)
        .where(and(eq(s.curatedDiscussionSource.tenantId, tenantId), eq(s.curatedDiscussionSource.discussionId, row.id),
          eq(s.curatedDiscussionSource.revision, (await currentRevision(tx, tenantId, row.id)) ?? 0))).orderBy(asc(s.curatedDiscussionSource.position));
      const ids = sources.flatMap(source => source.translationId ? [source.translationId] : []);
      const t = s.sourceTranslation, translations = ids.length ? await tx.select({ id: t.id, originalEdition: t.originalEdition, body: t.body }).from(t).where(and(eq(t.tenantId, tenantId), inArray(t.id, ids))) : [];
      out.push({ slug: row.slug, title: row.title, kind: row.kind, sources: sources.map(source => {
        const translation = translations.find(item => item.id === source.translationId) ?? null;
        return { ref: source.ref, anchorRef: source.anchorRef, edition: source.edition, translation: translation ? { originalEdition: translation.originalEdition, body: translation.body } : null, selectedBy: source.selectedByName };
      }) });
    }
    return out;
  }
  async function currentRevision(tx: AccessTransaction<Q>, tenantId: string, discussionId: string) {
    const src = s.curatedDiscussionSource, rows = await tx.select({ revision: src.revision }).from(src).where(and(eq(src.tenantId, tenantId), eq(src.discussionId, discussionId))).orderBy(asc(src.revision));
    return rows.length ? Math.max(...rows.map(r => r.revision)) : null;
  }

  // Import ------------------------------------------------------------------------------------------
  /** What this tenant already holds that an import must not touch: which readings have any guide, which content is already in, and each parashah's summary revisions. */
  async function stateOf(tx: AccessTransaction<Q>, tenantId: string, file: ShareFile) {
    const streams = await data.guideStreamKeys(tx, tenantId), imported = await data.importedKeys(tx, tenantId);
    const verses = new Map<string, Set<string>>();
    for (const guide of file.guides) verses.set(`${guide.kind}:${guide.readingKey}`, await guidePassageVerses(tx, tenantId, guide.kind, guide.readingKey));
    const revisions = new Map<string, Awaited<ReturnType<typeof summaries.revisionsOf>>>();
    for (const summary of file.summaries) { const parashah = parashahOf(summary.reading); if (parashah && parashah.slug === summary.reading) revisions.set(summary.reading, await summaries.revisionsOf(tx, tenantId, summary.reading)); }
    return { streams, imported, verses, revisions };
  }
  /**
   * Plans an import: reads this tenant's state, then resolves every citation against this portal's own catalog, outside any transaction.
   * Nothing from the file is trusted: its Sefaria references are looked up again and a citation this catalog cannot confirm is dropped.
   */
  async function analyse(request: CookieMutationRequest, raw: unknown): Promise<ShareInvalid | { ok: true; file: ShareFile; analysis: Analysis }> {
    const parsed = parseShareFile(raw);
    if (!parsed.ok) return Object.freeze({ ok: false, code: "invalid", problems: Object.freeze(parsed.problems) });
    const file = parsed.file;
    const state = await input.access.withAdminCapability(request, { mode: "admin", capability: "read-guides" }, async (tx, actor) => stateOf(tx, actor.tenantId, file));
    return { ok: true, file, analysis: await plan(file, state) };
  }
  /** A catalog read shared by every guide in this request, with a deadline of its own: one caller's abort never poisons another's read. */
  function memoRelated(): Related {
    const kept = new Map<string, Promise<RelatedSourceCatalog>>();
    return (ref) => {
      let pending = kept.get(ref);
      // A file can name many readings; one request looks up at most this many distinct verses, then the rest are left unchecked.
      if (!pending && kept.size >= MAX_CATALOG_READS) return Promise.reject(new Error("Too many catalog reads"));
      if (!pending) {
        const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 20_000);
        pending = input.related(ref, controller.signal).finally(() => clearTimeout(timer));
        kept.set(ref, pending);
      }
      return pending;
    };
  }
  async function plan(file: ShareFile, state: Awaited<ReturnType<typeof stateOf>>): Promise<Analysis> {
    const related = memoRelated(), check = createGuideChecker({ related, timeoutMs: 25_000 });
    const guides: PlanGuide[] = [], ready: Ready[] = [];
    for (const guide of file.guides) {
      const base = { kind: guide.kind, readingKey: guide.readingKey, credit: guide.credit }, key = guideImportKey(guide), id = `${guide.kind}:${guide.readingKey}`;
      const skip = (reason: GuideReason, droppedCitations = 0) => guides.push(Object.freeze({ ...base, status: "skipped" as const, reason, droppedCitations }));
      if (state.imported.has(`${id}:${key}`)) { skip("already-imported"); continue; }
      if (state.streams.has(id)) { skip("has-guide"); continue; }
      const verses = state.verses.get(id) ?? new Set<string>();
      if (!verses.size) { skip("not-in-catalog"); continue; }
      if (guide.body.themes.some(theme => theme.notes.some(note => !verses.has(note.verseRef)))) { skip("verse-outside-reading"); continue; }
      // Look each cited reference up again in this portal's catalog for the verse it sits under; an unmatched one is dropped, never trusted.
      let dropped = 0;
      const placed: GuideBody = { overview: guide.body.overview, themes: [] };
      try {
        for (const theme of guide.body.themes) {
          const notes = [];
          for (const note of theme.notes) {
            const entries = note.sources.length ? new Map(projectRelatedCatalog(await related(note.verseRef, new AbortController().signal), note.verseRef).entries.map(entry => [entry.ref, entry.id])) : new Map<string, string>();
            const sources: GuideSource[] = [];
            for (const source of note.sources) { const found = entries.get(source.ref); if (found) sources.push({ id: found } as GuideSource); else dropped++; }
            notes.push({ verseRef: note.verseRef, body: note.body, sources });
          }
          placed.themes.push({ id: theme.id, title: theme.title, intro: theme.intro, notes });
        }
      } catch { skip("citations-unchecked"); continue; }
      const resolved = await check({ kind: guide.kind, readingKey: guide.readingKey, studentId: null, verses, body: placed });
      if (!resolved.ok) { skip("citations-unchecked"); continue; }
      const checked = validateGuideBody(resolved.body, { allowOverview: true });
      if (!checked.ok) { skip("invalid"); continue; }
      guides.push(Object.freeze({ ...base, status: "ready" as const, droppedCitations: dropped }));
      ready.push({ guide, key, body: checked.value, dropped });
    }
    const plannedSummaries: PlanSummary[] = [], readySummaries: ShareSummary[] = [];
    for (const summary of file.summaries) {
      const revisions = state.revisions.get(summary.reading), parsed = validateSummary({ summary: summary.summary, outline: summary.outline });
      if (!revisions || !parsed.ok) { plannedSummaries.push(Object.freeze({ reading: summary.reading, status: "skipped" as const, reason: "not-a-parashah" as const, credit: summary.credit })); continue; }
      if (revisions.some(row => row.summary === summary.summary && row.outline.length === summary.outline.length && row.outline.every((line, i) => line === summary.outline[i]))) {
        plannedSummaries.push(Object.freeze({ reading: summary.reading, status: "skipped" as const, reason: "already-imported" as const, credit: summary.credit })); continue;
      }
      plannedSummaries.push(Object.freeze({ reading: summary.reading, status: "ready" as const, credit: summary.credit })); readySummaries.push(summary);
    }
    // A discussion is published the moment it is saved; there is no held state for one, so none can arrive here yet.
    const discussions = file.discussions.map(discussion => Object.freeze({ slug: discussion.slug, status: "skipped" as const, reason: "cannot-arrive-held" as const }));
    const authors = [...new Set([...file.guides.map(g => g.credit), ...file.summaries.map(x => x.credit)])].sort();
    return { guides, ready, summaries: plannedSummaries, readySummaries, discussions, authors };
  }

  /**
   * Who may post a file at all, settled before the body is read: an admin of this congregation, on a same-origin post. The origin is the
   * one this request's own host resolved to, so a fork's own address is the only one it accepts.
   */
  async function authorize(request: CookieMutationRequest): Promise<void> {
    await input.access.withAdminCapability(request, { mode: "admin", capability: "read-guides" }, async (_tx, actor) => { requireCookieMutation(request, actor.origin); });
  }

  async function preview(request: CookieMutationRequest, raw: unknown): Promise<SharePreview | ShareInvalid> {
    const result = await analyse(request, raw);
    if (!result.ok) return result;
    const { analysis } = result;
    return Object.freeze({ ok: true as const, guides: analysis.guides, summaries: analysis.summaries, discussions: analysis.discussions, authors: analysis.authors });
  }

  async function importFile(request: CookieMutationRequest, raw: unknown): Promise<ShareImported | ShareInvalid> {
    const result = await analyse(request, raw);
    if (!result.ok) return result;
    const { analysis } = result;
    return input.access.withAdminCapability(request, { mode: "admin", capability: "manage-defaults" }, async (tx, actor) => {
      requireCookieMutation(request, actor.origin);
      if (actor.authSessionExpiresAt <= Date.now()) throw new AccessDenied(401);
      // The state is read again here, in the writing transaction: what the preview saw may have changed, and nothing is overwritten.
      const state = await stateOf(tx, actor.tenantId, result.file), landed = new Set<string>();
      const guides = analysis.guides.map(item => ({ ...item })) as { -readonly [K in keyof PlanGuide]: PlanGuide[K] }[];
      for (const item of analysis.ready) {
        const id = `${item.guide.kind}:${item.guide.readingKey}`, plan = guides.find(g => g.kind === item.guide.kind && g.readingKey === item.guide.readingKey)!;
        if (state.streams.has(id) || state.imported.has(`${id}:${item.key}`)) { plan.status = "skipped"; plan.reason = state.imported.has(`${id}:${item.key}`) ? "already-imported" : "has-guide"; continue; }
        const row = await data.importGuide(tx, actor, { kind: item.guide.kind, readingKey: item.guide.readingKey, origin: item.guide.origin, body: item.body, credit: item.guide.credit, key: item.key, digest: sha(["guide-import-row/v1", item.key, item.body]) });
        if (row) landed.add(id); else { plan.status = "skipped"; plan.reason = "has-guide"; }
      }
      const sums = analysis.summaries.map(item => ({ ...item })) as { -readonly [K in keyof PlanSummary]: PlanSummary[K] }[];
      let summaryCount = 0;
      for (const summary of analysis.readySummaries) {
        const plan = sums.find(x => x.reading === summary.reading)!, revisions = await summaries.revisionsOf(tx, actor.tenantId, summary.reading, true);
        if (revisions.some(row => row.summary === summary.summary && row.outline.length === summary.outline.length && row.outline.every((line, i) => line === summary.outline[i]))) { plan.status = "skipped"; plan.reason = "already-imported"; continue; }
        const row = await summaries.insertDraft(tx, { tenantId: actor.tenantId, membershipId: actor.membershipId, readingKey: summary.reading, revision: (revisions[0]?.revision ?? 0) + 1,
          summary: summary.summary, outline: summary.outline, mutationId: randomUUID(), requestDigest: sha(["portion-summary-import/v1", summary.reading, summary.summary, summary.outline]) });
        if (row) summaryCount++; else { plan.status = "skipped"; plan.reason = "already-imported"; }
      }
      if (landed.size || summaryCount) await data.auditGuideImport(tx, actor);
      return Object.freeze({ ok: true as const, imported: Object.freeze({ guides: landed.size, summaries: summaryCount }), guides: Object.freeze(guides), summaries: Object.freeze(sums), discussions: analysis.discussions, authors: analysis.authors });
    });
  }
  return Object.freeze({ exportFile, authorize, preview, importFile });
}
