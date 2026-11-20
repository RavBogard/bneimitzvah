import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq } from "drizzle-orm";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { createAccessService } from "../access/service";
import type { AccessRequest, AccessTransaction, Actor } from "../access/types";
import { AccessDenied } from "../access/errors";
import { requireCookieMutation } from "../http/mutations";
import * as s from "../db/index";
import { currentSettings } from "../data/tenant-settings";
import * as discussionData from "../discussions/data";
import * as guideData from "../data/study-guides";
import type { CuratorAuthority, DiscussionService } from "../discussions/service";
import { selectorName } from "../discussions/validation";
import * as summaryData from "../portion-summary/data";
import { approveSummary, withdrawSummary, type SummaryAuthority } from "../portion-summary/service";
import { lockRabbi } from "../study-guides/authority";
import { guideVersion, rabbiName, type createStudyGuideService, type RabbiAuthority } from "../study-guides/service";
import { placeOfGuide, placeOfSummary, placeOfVerse, studyAddress, type ReadingPlace } from "../../lib/guide-admin/places";

/**
 * The admin's Guides page (gap A6, Daniel 2026-11-17): see the congregation's study guides, discussions and portion summaries on the
 * web, and withdraw a discussion or approve or withdraw a portion summary when the Claude connector is not to hand.
 *
 * Access: every read runs inside `withAdminCapability(..., "read-guides")` and every write inside `withAdminCapability(...,
 * "manage-defaults")` plus a same-origin cookie POST, the wrappers the guide sharing page already uses. Nothing here adds a check of its own.
 *
 * Writes: one code path. Each action calls the very service function its MCP tool calls (`discussions.withdrawDiscussion`,
 * `approveSummary`, `withdrawSummary`) with the same arguments (`slug`/`reading` and the `revision` last read), under an authority
 * built the way the MCP builds its own: the admin grant re-locked by `lockRabbi` inside the write transaction. A web session is always
 * attended. Guides (Daniel 2026-11-17, migration 0058): release a held version (`publishBaseGuide`, publish_guide's own function) or hold
 * a released one (`holdBaseGuide`), with the version last read, under the same authority with channel "web". Neither writes text: the
 * row is a copy of the version just before it, and the database refuses a web row whose text or labels differ (portal_study_guide_copy).
 * `setBaseGuide` refuses the web channel. Nothing here marks anything reviewed.
 */
type Access<Q extends PgQueryResultHKT> = Pick<ReturnType<typeof createAccessService<Q>>, "withAdminCapability">;
type Kind = "torah" | "haftarah";
const MAX_GUIDE_ROWS = 20000, MAX_DISCUSSIONS = 200, MAX_SUMMARIES = 200;
const KEY = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const readingOf = (place: ReadingPlace | null) => place ? Object.freeze({ slug: place.slug, name: place.name, order: place.order }) : null;

type Guides<Q extends PgQueryResultHKT> = Pick<ReturnType<typeof createStudyGuideService<Q>>, "publishBaseGuide" | "holdBaseGuide">;
export function createGuideAdminService<Q extends PgQueryResultHKT>(input: { access: Access<Q>; discussions: Pick<DiscussionService<Q>, "withdrawDiscussion">; guides: Guides<Q> }) {
  const read = <T>(request: AccessRequest, action: (tx: AccessTransaction<Q>, actor: Actor) => Promise<T>) =>
    input.access.withAdminCapability(request, { mode: "admin", capability: "read-guides" }, action);
  /** The admin write wrapper: admin mode, a same-origin cookie POST, then the admin grant re-locked as the MCP's authority does. */
  const write = <T>(request: AccessRequest & { method?: string }, action: (tx: AccessTransaction<Q>, actor: Actor, rabbi: Awaited<ReturnType<typeof lockRabbi>>, live: () => void) => Promise<T>) =>
    input.access.withAdminCapability(request, { mode: "admin", capability: "manage-defaults" }, async (tx, actor) => {
      requireCookieMutation(request, actor.origin);
      const rabbi = await lockRabbi(tx, actor.tenantId, actor.membershipId);
      const live = () => { if (Date.now() >= actor.authSessionExpiresAt) throw new AccessDenied(401); };
      return action(tx, actor, rabbi, live);
    });
  const curator = (request: AccessRequest & { method?: string }): CuratorAuthority<Q> => ({
    run: action => write(request, async (tx, actor, rabbi, live) => {
      const [account] = await tx.select({ name: s.user.name }).from(s.user).where(eq(s.user.id, rabbi.userId)).limit(1);
      return action(tx, Object.freeze({ tenantId: actor.tenantId, membershipId: rabbi.membershipId, userId: rabbi.userId, displayName: selectorName(account?.name) }), live);
    }),
  });
  const summaries = (request: AccessRequest & { method?: string }): SummaryAuthority<Q> => ({
    run: action => write(request, (tx, actor, rabbi, live) =>
      action(tx, Object.freeze({ tenantId: actor.tenantId, membershipId: rabbi.membershipId, roleGrantId: rabbi.roleGrantId, attended: true }), live)),
  });

  /** The rabbi authority the MCP builds, from the admin's own web session: channel "web", never a review. */
  const rabbi = (request: AccessRequest & { method?: string }): RabbiAuthority<Q> => ({
    run: action => write(request, (tx, actor, locked, live) =>
      action(tx, Object.freeze({ tenantId: actor.tenantId, userId: locked.userId, membershipId: locked.membershipId, roleGrantId: locked.roleGrantId, channel: "web" as const, mayReview: false }), live)),
  });

  /** Everything the page lists for the caller's own congregation. Guide bodies are left out; one version's text is `guideText`. */
  async function overview(request: AccessRequest) {
    return read(request, async (tx, actor) => {
      const [tenant] = await tx.select({ customs: s.tenant.customs }).from(s.tenant).where(eq(s.tenant.id, actor.tenantId)).limit(1);
      const name = rabbiName(tenant?.customs, await currentSettings(tx, actor.tenantId));
      const t = s.studyGuide;
      const rows = await tx.select({ kind: t.kind, readingKey: t.readingKey, version: t.version, hold: t.hold, reviewed: t.reviewed, origin: t.origin, importCredit: t.importCredit,
        copyOfVersion: t.copyOfVersion, createdAt: t.createdAt }).from(t).where(eq(t.tenantId, actor.tenantId)).orderBy(asc(t.kind), asc(t.readingKey), asc(t.version)).limit(MAX_GUIDE_ROWS);
      type Row = (typeof rows)[number];
      // `before`: the release readers go back to if the released head is held (data.releasedStack), for the Hold confirmation.
      const released = new Map<string, Row[]>(), streams = new Map<string, { head: Row; visible: Row | null; before: Row | null }>();
      for (const row of rows) {
        const id = `${row.kind}:${row.readingKey}`, stack = guideData.releasedStack(released.get(id) ?? [], row);
        released.set(id, stack); streams.set(id, { head: row, visible: stack.at(-1) ?? null, before: stack.at(-2) ?? null });
      }
      const version = (row: Row) => Object.freeze({ version: row.version, origin: row.origin === "rabbi" ? "rabbi" : "claude", reviewed: row.reviewed,
        ...(row.importCredit ? { importedFrom: row.importCredit } : {}), changedAt: row.createdAt.toISOString() });
      const guides = [...streams.values()].map(({ head, visible, before }) => {
        const place = placeOfGuide(head.kind as Kind, head.readingKey);
        return Object.freeze({ kind: head.kind, readingKey: head.readingKey, reading: readingOf(place),
          state: head.hold ? "held" : head.reviewed ? "reviewed" : "draft", current: version(head), visible: visible ? version(visible) : null,
          ...(head.hold ? {} : { afterHold: before ? version(before) : null }),
          href: visible && place ? studyAddress(place) : null });
      });

      const d = s.curatedDiscussion;
      const talks = await tx.select({ id: d.id, slug: d.slug, title: d.title, kind: d.kind, status: d.status, revision: d.revision, updatedAt: d.updatedAt })
        .from(d).where(eq(d.tenantId, actor.tenantId)).orderBy(desc(d.updatedAt), asc(d.slug)).limit(MAX_DISCUSSIONS + 1);
      const discussions = [];
      for (const talk of talks.slice(0, MAX_DISCUSSIONS)) {
        const sources = await discussionData.currentSources(tx, actor.tenantId, talk.id);
        const place = sources[0] ? placeOfVerse(talk.kind as Kind, sources[0].anchorRef) : null;
        discussions.push(Object.freeze({ slug: talk.slug, title: talk.title, kind: talk.kind, status: talk.status, revision: talk.revision, sourceCount: sources.length,
          reading: readingOf(place), changedAt: talk.updatedAt.toISOString(), href: talk.status === "published" && place ? studyAddress(place) : null }));
      }

      const summaryRows = await summaryData.summariesIn(tx, actor.tenantId, null, MAX_SUMMARIES + 1);
      const portionSummaries = summaryRows.slice(0, MAX_SUMMARIES).map(row => {
        const place = placeOfSummary(row.readingKey);
        return Object.freeze({ reading: row.readingKey, readingPlace: readingOf(place), revision: row.revision, status: row.status, summary: row.summary,
          outline: Object.freeze([...row.outline]), ...(row.credit !== null ? { credit: row.credit } : {}), ...(row.importCredit ? { importedFrom: row.importCredit } : {}),
          changedAt: row.updatedAt.toISOString(), href: row.status === "approved" && place ? studyAddress(place) : null });
      });
      return Object.freeze({ rabbiName: name, guides: Object.freeze(guides), discussions: Object.freeze(discussions), summaries: Object.freeze(portionSummaries),
        truncated: rows.length >= MAX_GUIDE_ROWS || talks.length > MAX_DISCUSSIONS || summaryRows.length > MAX_SUMMARIES });
    });
  }

  /** One guide version's full text, read only, from the caller's own congregation; null when there is no such servable version. */
  async function guideText(request: AccessRequest, supplied: { kind: unknown; readingKey: unknown; version: unknown }) {
    const kind = supplied.kind, readingKey = supplied.readingKey, version = supplied.version;
    if ((kind !== "torah" && kind !== "haftarah") || typeof readingKey !== "string" || readingKey.length > 160 || !KEY.test(readingKey)
      || !Number.isSafeInteger(version) || (version as number) < 1 || (version as number) > 2147483646) throw new AccessDenied(404);
    return read(request, async (tx, actor) => {
      const t = s.studyGuide;
      const [row] = await tx.select().from(t).where(and(eq(t.tenantId, actor.tenantId), eq(t.kind, kind), eq(t.readingKey, readingKey), eq(t.version, version as number))).limit(1);
      if (!row) throw new AccessDenied(404);
      let value; try { value = guideVersion(row); } catch { throw new AccessDenied(404); }
      const [tenant] = await tx.select({ customs: s.tenant.customs }).from(s.tenant).where(eq(s.tenant.id, actor.tenantId)).limit(1);
      return Object.freeze({ kind, readingKey, version: value.version, hold: value.hold, rabbiName: rabbiName(tenant?.customs, await currentSettings(tx, actor.tenantId)),
        label: Object.freeze({ origin: value.origin, reviewed: value.reviewed, ...(value.importedFrom ? { importedFrom: value.importedFrom } : {}) }),
        body: value.body, changedAt: value.createdAt });
    });
  }

  /** Authority first, as guide sharing does: a caller who may not write is refused before any body is read or any argument judged. */
  const authorize = (request: AccessRequest & { method?: string }) => write(request, async () => undefined);
  // The writes: the MCP tools' own service functions, with the arguments those tools pass.
  const withdrawDiscussion = (request: AccessRequest & { method?: string }, supplied: { slug: unknown; revision: unknown }) =>
    input.discussions.withdrawDiscussion(curator(request), { slug: supplied.slug, revision: supplied.revision });
  const approvePortionSummary = (request: AccessRequest & { method?: string }, supplied: { reading: unknown; revision: unknown }) =>
    approveSummary(summaries(request), { reading: supplied.reading, revision: supplied.revision });
  const withdrawPortionSummary = (request: AccessRequest & { method?: string }, supplied: { reading: unknown; revision: unknown }) =>
    withdrawSummary(summaries(request), { reading: supplied.reading, revision: supplied.revision });

  /** Release a held guide version, or hold a released one; `version` is the guide's current version as last read. A fresh mutation id each time. */
  const releaseGuide = (request: AccessRequest & { method?: string }, supplied: { kind: unknown; readingKey: unknown; version: unknown }) =>
    input.guides.publishBaseGuide(rabbi(request), { kind: supplied.kind, readingKey: supplied.readingKey, version: supplied.version, mutationId: randomUUID() });
  const holdGuide = (request: AccessRequest & { method?: string }, supplied: { kind: unknown; readingKey: unknown; version: unknown }) =>
    input.guides.holdBaseGuide(rabbi(request), { kind: supplied.kind, readingKey: supplied.readingKey, version: supplied.version, mutationId: randomUUID() });

  return Object.freeze({ overview, guideText, authorize, withdrawDiscussion, approvePortionSummary, withdrawPortionSummary, releaseGuide, holdGuide });
}
