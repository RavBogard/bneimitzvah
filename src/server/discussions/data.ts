import "server-only";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { AccessTransaction } from "../access/types";
import * as s from "../db/index";
import { curatedDiscussionPublic } from "./public-view";
import type { DiscussionKind, SourceInput } from "./validation";

/**
 * Curated discussion rows (migration 0042). Every select names its columns: the runtime holds no SELECT grant on
 * `selected_by`, so a `select *` or a bare `returning()` would be refused by the database itself.
 */
export type CuratorWriter = Readonly<{ tenantId: string; membershipId: string; userId: string }>;
export type DiscussionRow = Readonly<{ id: string; slug: string; title: string; kind: DiscussionKind; status: "published" | "withdrawn"; revision: number;
  mutationId: string; requestDigest: string; createdAt: Date; updatedAt: Date }>;
export type SourceRow = Readonly<{ position: number; ref: string; anchorRef: string; edition: string | null; translationId: string | null }>;

const d = s.curatedDiscussion, src = s.curatedDiscussionSource, tr = s.sourceTranslation;
const discussionColumns = { id: d.id, slug: d.slug, title: d.title, kind: d.kind, status: d.status, revision: d.revision, mutationId: d.mutationId,
  requestDigest: d.requestDigest, createdAt: d.createdAt, updatedAt: d.updatedAt };
const sourceColumns = { position: src.position, ref: src.ref, anchorRef: src.anchorRef, edition: src.edition, translationId: src.translationId };

export async function discussionReceipt<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, tenantId: string, mutationId: string): Promise<DiscussionRow | null> {
  const [row] = await tx.select(discussionColumns).from(d).where(and(eq(d.tenantId, tenantId), eq(d.mutationId, mutationId))).limit(1);
  return (row as DiscussionRow | undefined) ?? null;
}
export async function discussionBySlug<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, tenantId: string, slug: string, lock = false): Promise<DiscussionRow | null> {
  const query = tx.select(discussionColumns).from(d).where(and(eq(d.tenantId, tenantId), eq(d.slug, slug))).limit(1);
  const [row] = lock ? await query.for("update") : await query;
  return (row as DiscussionRow | undefined) ?? null;
}
/** The current ordered set: the latest revision that wrote sources. */
export async function currentSources<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, tenantId: string, discussionId: string): Promise<SourceRow[]> {
  return tx.select(sourceColumns).from(src).where(and(eq(src.tenantId, tenantId), eq(src.discussionId, discussionId),
    eq(src.revision, sql<number>`(select max(x.revision) from ${src} x where x.tenant_id = ${tenantId} and x.discussion_id = ${discussionId})`)))
    .orderBy(asc(src.position));
}
/** Slugs already taken that a new title's base could collide with. */
export async function slugsLike<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, tenantId: string, base: string): Promise<Set<string>> {
  const rows = await tx.select({ slug: d.slug }).from(d).where(and(eq(d.tenantId, tenantId), sql`(${d.slug} = ${base} or left(${d.slug}, ${base.length + 1}) = ${base + "-"})`));
  return new Set(rows.map(row => row.slug));
}
export async function insertDiscussion<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, writer: CuratorWriter, value: { slug: string; title: string; kind: DiscussionKind; mutationId: string; requestDigest: string }) {
  const [row] = await tx.insert(d).values({ tenantId: writer.tenantId, slug: value.slug, title: value.title, kind: value.kind, status: "published", selectedBy: writer.membershipId,
    revision: 1, mutationId: value.mutationId, requestDigest: value.requestDigest }).onConflictDoNothing().returning({ id: d.id, slug: d.slug, revision: d.revision });
  return row ?? null;
}
export async function insertSources<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, writer: CuratorWriter, discussionId: string, revision: number, sources: readonly SourceInput[]) {
  await tx.insert(src).values(sources.map((source, i) => ({ tenantId: writer.tenantId, discussionId, revision, position: i + 1, ref: source.ref, anchorRef: source.anchorRef,
    edition: source.edition ?? null, translationId: source.translationId ?? null, selectedBy: writer.membershipId })));
}
/** One more revision under the expected one: a new title, or a withdrawal. Returns null when the revision moved. */
export async function bumpDiscussion<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, tenantId: string, id: string, expected: number, change: { title?: string; withdraw?: true }) {
  const [row] = await tx.update(d).set({ ...(change.title !== undefined ? { title: change.title } : {}), ...(change.withdraw ? { status: "withdrawn" as const } : {}),
    revision: expected + 1, updatedAt: new Date() }).where(and(eq(d.tenantId, tenantId), eq(d.id, id), eq(d.revision, expected), eq(d.status, "published")))
    .returning({ revision: d.revision, status: d.status });
  return row ?? null;
}
/** Discussions with any current source anchored in `verses`, withdrawn ones included (the rabbi's list). */
export async function discussionsAnchoredIn<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, tenantId: string, verses: readonly string[], limit: number): Promise<DiscussionRow[]> {
  if (!verses.length) return [];
  const rows = await tx.select(discussionColumns).from(d).where(and(eq(d.tenantId, tenantId), sql`exists (select 1 from ${src} x where x.tenant_id = ${d.tenantId} and x.discussion_id = ${d.id}
      and x.revision = (select max(y.revision) from ${src} y where y.tenant_id = ${d.tenantId} and y.discussion_id = ${d.id}) and x.anchor_ref in (${sql.join(verses.map(verse => sql`${verse}`), sql`, `)}))`))
    .orderBy(asc(d.createdAt), asc(d.slug)).limit(limit);
  return rows as DiscussionRow[];
}

export type TranslationRow = Readonly<{ id: string; originalRef: string; originalEdition: string; body: string; mutationId: string; requestDigest: string; createdAt: Date }>;
const translationColumns = { id: tr.id, originalRef: tr.originalRef, originalEdition: tr.originalEdition, body: tr.body, mutationId: tr.mutationId, requestDigest: tr.requestDigest, createdAt: tr.createdAt };
export async function translationReceipt<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, tenantId: string, mutationId: string): Promise<TranslationRow | null> {
  const [row] = await tx.select(translationColumns).from(tr).where(and(eq(tr.tenantId, tenantId), eq(tr.mutationId, mutationId))).limit(1);
  return row ?? null;
}
export async function translationsById<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, tenantId: string, ids: readonly string[]): Promise<Map<string, TranslationRow>> {
  if (!ids.length) return new Map();
  const rows = await tx.select(translationColumns).from(tr).where(and(eq(tr.tenantId, tenantId), inArray(tr.id, [...ids])));
  return new Map(rows.map(row => [row.id, row]));
}
export async function insertTranslation<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, writer: CuratorWriter, value: { originalRef: string; originalEdition: string; body: string; mutationId: string; requestDigest: string }) {
  const [row] = await tx.insert(tr).values({ tenantId: writer.tenantId, originalRef: value.originalRef, originalEdition: value.originalEdition, body: value.body,
    selectedBy: writer.membershipId, mutationId: value.mutationId, requestDigest: value.requestDigest }).onConflictDoNothing().returning({ id: tr.id });
  return row ?? null;
}

export type PublicSourceRow = Readonly<{ slug: string; title: string; kind: DiscussionKind; revision: number; updatedAt: Date; position: number; ref: string; anchorRef: string;
  edition: string | null; translationId: string | null; translationEdition: string | null; translationBody: string | null }>;
/**
 * The public read, through curated_discussion_public only: the published discussions with any current source anchored in
 * `verses` (at most `limit` of them), with every source of each, in order. Never a curator, never a withdrawn discussion.
 */
export async function publicDiscussionRows<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, tenantId: string, verses: readonly string[], limit: number): Promise<PublicSourceRow[]> {
  if (!verses.length) return [];
  const v = curatedDiscussionPublic;
  const slugs = (await tx.selectDistinct({ slug: v.slug }).from(v).where(and(eq(v.tenantId, tenantId), inArray(v.anchorRef, [...verses])))
    .orderBy(asc(v.slug)).limit(limit)).map(row => row.slug);
  if (!slugs.length) return [];
  return tx.select({ slug: v.slug, title: v.title, kind: v.kind, revision: v.revision, updatedAt: v.updatedAt, position: v.position, ref: v.ref, anchorRef: v.anchorRef,
    edition: v.edition, translationId: v.translationId, translationEdition: v.translationEdition, translationBody: v.translationBody })
    .from(v).where(and(eq(v.tenantId, tenantId), inArray(v.slug, slugs))).orderBy(asc(v.slug), asc(v.position));
}
