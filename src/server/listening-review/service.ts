import "server-only";
import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { createAccessService } from "../access/service";
import type { AccessRequest, AccessTransaction, Actor } from "../access/types";
import { AccessDenied } from "../access/errors";
import { requireCookieMutation, type CookieMutationRequest } from "../http/mutations";
import * as s from "../db/index";
import type { StudyPage, StudyRequest } from "../study/types";
import { ReferenceUnavailable } from "../reference-audio/catalog";
import type { ReferenceShortResolution } from "../../lib/reference-audio/short-resolution";
import { LISTENING_COMPARISON_BAR, LISTENING_LATENCY_LIMIT_MS, LISTENING_REASONS, LISTENING_SAMPLE, LISTENING_SAMPLE_VERSION, LISTENING_SETS, LISTENING_SOURCES, listeningItem, listeningNote,
  type ListeningItem, type ListeningReason, type ListeningSet, type ListeningSource } from "../../lib/listening-review/sample";
import type { ListeningSourceProvider } from "./sources";

export type ListeningVerdict = Readonly<{ verdict: "pass" | "needs-work"; reasons: readonly ListeningReason[]; note: string | null; latencyMs: number | null; asset: string; at: string }>;
export type ListeningOverviewItem = ListeningItem & Readonly<{ available: boolean; verdict: ListeningVerdict | null }>;
export type ListeningTally = Readonly<{ source: ListeningSource; set: ListeningSet; items: number; heard: number; pass: number; needsWork: number; wouldTeachWrong: number }>;
export type ListeningOverview = Readonly<{ sampleVersion: string; items: readonly ListeningOverviewItem[]; tallies: readonly ListeningTally[];
  comparison: Readonly<{ passRate: number; wouldTeachWrong: number }> }>;
export type ListeningItemView = Readonly<{ item: ListeningItem; page: StudyPage; reference: ReferenceShortResolution | null }>;
type Failure = Readonly<{ ok: false; code: "conflict" | "invalid" | "unavailable" | "changed" }>;
export type ListeningRecordResult = Failure | Readonly<{ ok: true; replayed: boolean; verdict: ListeningVerdict }>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (code: Failure["code"]): Failure => Object.freeze({ ok: false, code });
type Row = typeof s.listeningReviewVerdict.$inferSelect;
const view = (row: Row): ListeningVerdict => Object.freeze({ verdict: row.verdict as ListeningVerdict["verdict"], reasons: Object.freeze([...row.reasons] as ListeningReason[]),
  note: row.note, latencyMs: row.latencyMs, asset: row.asset, at: row.createdAt.toISOString() });

/**
 * Admin-only. Reading the review needs the admin grant in admin mode (read-defaults); recording a verdict
 * needs manage-defaults, a same-origin cookie POST and a mutation-id receipt. Nothing here changes what a
 * student can hear: references are resolved for the admin only and never stored or handed to student paths.
 * Text and audio metadata are loaded outside any transaction, between two live authorization passes.
 */
export function createListeningReviewService<Q extends PgQueryResultHKT>(input: {
  access: ReturnType<typeof createAccessService<Q>>;
  loadText(request: StudyRequest): Promise<StudyPage>;
  sources: readonly ListeningSourceProvider[];
  sample?: readonly ListeningItem[];
}) {
  const sample = input.sample ?? LISTENING_SAMPLE;
  const providers = new Map(input.sources.map(provider => [provider.id, provider] as const));
  const pinOf = (source: ListeningSource) => { try { return providers.get(source)?.pin() ?? null; } catch { return null; } };
  const admin = <T>(request: AccessRequest, capability: "read-defaults" | "manage-defaults", action: (tx: AccessTransaction<Q>, actor: Actor) => Promise<T>) =>
    input.access.withAdminCapability(request, { mode: "admin", capability }, action);

  /** Which sampled verses a source would actually play now. Fails closed: an error means none. */
  async function playable(signal: AbortSignal): Promise<ReadonlyMap<ListeningSource, ReadonlySet<string>>> {
    const result = new Map<ListeningSource, ReadonlySet<string>>();
    await Promise.all([...providers.values()].map(async provider => {
      if (!pinOf(provider.id)) { result.set(provider.id, new Set()); return; }
      const mine = sample.filter(item => item.source === provider.id).map(item => Object.freeze({ ref: item.ref, kind: item.kind }));
      if (!provider.playable) { result.set(provider.id, new Set(mine.map(row => row.ref))); return; }
      try { result.set(provider.id, await provider.playable(mine, signal)); } catch { result.set(provider.id, new Set()); }
    }));
    return result;
  }

  async function overview(request: AccessRequest & { signal?: AbortSignal }): Promise<ListeningOverview> {
    const rows = await admin(request, "read-defaults", async (tx, actor) => {
      const t = s.listeningReviewVerdict;
      return tx.select().from(t).where(and(eq(t.tenantId, actor.tenantId), eq(t.actorUserId, actor.userId), eq(t.sampleVersion, LISTENING_SAMPLE_VERSION)))
        .orderBy(desc(t.createdAt), desc(t.id)).limit(5000);
    });
    const controller = new AbortController(), abort = () => controller.abort(); request.signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(abort, 20_000);
    let ready: ReadonlyMap<ListeningSource, ReadonlySet<string>>;
    try { ready = await playable(controller.signal); } finally { clearTimeout(timer); request.signal?.removeEventListener("abort", abort); }
    const items = sample.map((item): ListeningOverviewItem => {
      const pin = pinOf(item.source), available = pin !== null && ready.get(item.source)?.has(item.ref) === true;
      const latest = available ? rows.find(row => row.itemId === item.id && row.source === item.source && row.sourcePin === pin) : undefined;
      return Object.freeze({ ...item, available, verdict: latest ? view(latest) : null });
    });
    const tallies = LISTENING_SOURCES.flatMap(source => LISTENING_SETS.filter(set => sample.some(item => item.source === source && item.set === set)).map((set): ListeningTally => {
      const mine = items.filter(item => item.source === source && item.set === set && item.available), heard = mine.filter(item => item.verdict);
      return Object.freeze({ source, set, items: mine.length, heard: heard.length, pass: heard.filter(item => item.verdict!.verdict === "pass").length,
        needsWork: heard.filter(item => item.verdict!.verdict === "needs-work").length, wouldTeachWrong: heard.filter(item => item.verdict!.reasons.includes("would-teach-wrong")).length });
    }));
    return Object.freeze({ sampleVersion: LISTENING_SAMPLE_VERSION, items: Object.freeze(items), tallies: Object.freeze(tallies), comparison: LISTENING_COMPARISON_BAR });
  }

  /** Text and the clip a student would get, for one sampled verse. Throws ReferenceUnavailable when the source is not configured. */
  async function resolveItem(item: ListeningItem, signal: AbortSignal): Promise<{ page: StudyPage; reference: ReferenceShortResolution | null }> {
    const provider = providers.get(item.source); if (!provider || !pinOf(item.source)) throw new ReferenceUnavailable();
    const page = await input.loadText({ kind: item.kind, ranges: [item.ref], verses: [item.ref], offset: 0, translation: "jps2023", signal });
    if (signal.aborted || page.verses.length !== 1 || page.verses[0].ref !== item.ref || page.offset !== 0 || page.totalVerses !== 1 || page.nextOffset !== null) throw new ReferenceUnavailable();
    const reference = await provider.resolve(page.verses[0], item.kind, signal);
    if (signal.aborted || (reference && (reference.verse.ref !== item.ref || !reference.source))) throw new ReferenceUnavailable();
    return { page, reference };
  }

  async function item(request: AccessRequest & { signal?: AbortSignal }, id: unknown): Promise<ListeningItemView> {
    await admin(request, "read-defaults", async () => undefined);
    const selected = listeningItem(id, sample); if (!selected) throw new AccessDenied(404);
    const controller = new AbortController(), abort = () => controller.abort(); request.signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(abort, 20_000);
    try {
      const { page, reference } = await resolveItem(selected, controller.signal);
      await admin(request, "read-defaults", async () => undefined);
      return Object.freeze({ item: selected, page, reference });
    } finally { clearTimeout(timer); request.signal?.removeEventListener("abort", abort); }
  }

  async function record(request: CookieMutationRequest & { signal?: AbortSignal }, supplied: Record<string, unknown>): Promise<ListeningRecordResult> {
    if (typeof supplied.mutationId !== "string" || !UUID.test(supplied.mutationId)) throw new AccessDenied(403);
    const mutationId = supplied.mutationId.toLowerCase();
    const receipt = async (tx: AccessTransaction<Q>, actor: Actor) => {
      const t = s.listeningReviewVerdict;
      const [row] = await tx.select().from(t).where(and(eq(t.tenantId, actor.tenantId), eq(t.actorUserId, actor.userId), eq(t.mutationId, mutationId))).limit(1);
      return row ?? null;
    };
    // A resent save answers from its receipt before any audio lookup, so a later clip change cannot hide it.
    const earlier = await admin(request, "read-defaults", async (tx, actor) => { requireCookieMutation(request, actor.origin); return receipt(tx, actor); });
    const selected = listeningItem(supplied.itemId, sample), note = listeningNote(supplied.note);
    const reasons = supplied.reasons === undefined ? [] : Array.isArray(supplied.reasons) && supplied.reasons.length <= LISTENING_REASONS.length && supplied.reasons.every(r => (LISTENING_REASONS as readonly unknown[]).includes(r))
      && new Set(supplied.reasons).size === supplied.reasons.length ? LISTENING_REASONS.filter(r => (supplied.reasons as unknown[]).includes(r)) : null;
    const latency = supplied.latencyMs === null || supplied.latencyMs === undefined ? null
      : Number.isSafeInteger(supplied.latencyMs) && (supplied.latencyMs as number) >= 0 && (supplied.latencyMs as number) <= LISTENING_LATENCY_LIMIT_MS ? supplied.latencyMs as number : undefined;
    const verdict = supplied.verdict === "pass" || supplied.verdict === "needs-work" ? supplied.verdict : null;
    if (!selected || note === undefined || !reasons || latency === undefined || !verdict || (verdict === "pass" && reasons.length) || typeof supplied.asset !== "string") return fail("invalid");
    const same = (row: Row) => row.itemId === selected.id && row.verdict === verdict && row.note === note && row.latencyMs === latency && row.asset === supplied.asset
      && row.reasons.length === reasons.length && row.reasons.every((r, i) => r === reasons[i]);
    if (earlier) return same(earlier) ? Object.freeze({ ok: true as const, replayed: true, verdict: view(earlier) }) : fail("conflict");
    const pin = pinOf(selected.source); if (!pin) return fail("unavailable");
    const controller = new AbortController(), abort = () => controller.abort(); request.signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(abort, 20_000);
    let reference: ReferenceShortResolution | null;
    try { reference = (await resolveItem(selected, controller.signal)).reference; }
    finally { clearTimeout(timer); request.signal?.removeEventListener("abort", abort); }
    if (!reference?.source) return fail("unavailable");
    const asset = reference.source.id;
    return admin(request, "manage-defaults", async (tx, actor) => {
      requireCookieMutation(request, actor.origin);
      const t = s.listeningReviewVerdict, prior = await receipt(tx, actor);
      if (prior) return same(prior) ? Object.freeze({ ok: true as const, replayed: true, verdict: view(prior) }) : fail("conflict");
      // The verdict is about the clip the reviewer heard; a re-cut or different clip since the page loaded is refused.
      if (supplied.asset !== asset) return fail("changed");
      if (actor.authSessionExpiresAt <= Date.now()) throw new AccessDenied(401);
      const [row] = await tx.insert(t).values({ tenantId: actor.tenantId, sampleVersion: LISTENING_SAMPLE_VERSION, itemId: selected.id, verseRef: selected.ref,
        source: selected.source, sourcePin: pin, asset, verdict, reasons: [...reasons], note, latencyMs: latency,
        actorUserId: actor.userId, actorMembershipId: actor.membershipId, roleGrantId: actor.roleGrantId, role: "admin", mode: "admin", mutationId }).onConflictDoNothing().returning();
      if (!row) {
        const raced = await receipt(tx, actor);
        return raced && same(raced) ? Object.freeze({ ok: true as const, replayed: true, verdict: view(raced) }) : fail("conflict");
      }
      await tx.insert(s.auditEvent).values({ tenantId: actor.tenantId, actorUserId: actor.userId, actorMembershipId: actor.membershipId, roleGrantId: actor.roleGrantId,
        mode: "admin", action: "listening-review.set", targetType: "listening_review_verdict", targetId: row.id, requestId: randomUUID() });
      return Object.freeze({ ok: true as const, replayed: false, verdict: view(row) });
    });
  }
  return Object.freeze({ overview, item, record });
}
