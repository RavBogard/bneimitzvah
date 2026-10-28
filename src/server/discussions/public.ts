import "server-only";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { AccessTransaction } from "../access/types";
import { eq } from "drizzle-orm";
import * as s from "../db/index";
import { readProductName } from "../data/product-name";
import { currentSettings } from "../data/tenant-settings";
import { effectiveRabbiName } from "../settings/validation";
import { sourceSefariaUrl } from "../../lib/readings/shelf";
import { claudeTranslationCredit, selectedByDetail } from "../../lib/discussions/labels";
import type { PinnedEdition, PinnedSourceReader, SourceText } from "../study/source-text";
import { publicDiscussionRows, type PublicSourceRow } from "./data";

/**
 * The signed-out discussions answer (`GET /api/public/discussions`, 1.7 M6). The same for every caller: no session, no
 * cookie, no membership. Rows come only through curated_discussion_public (published discussions, current sources, no
 * curator id); each source's text comes live from Sefaria through the Study lens's own source reader, pinned to the chosen
 * edition, and is never stored. A Claude translation carries its body and the credit "Claude translation for {productName}";
 * every source carries "Selected by {name}" (the selector's own display name, kept with the source) as a separate detail,
 * never in its credit. The answer stays under a byte budget: past it a source's text is left out (complete: false) and,
 * past that, further discussions are left out (truncated: true), rather than failing the whole answer.
 */
export const PUBLIC_DISCUSSION_LIMITS = Object.freeze({ discussions: 8, fetches: 48, concurrency: 6, deadlineMs: 8000, answerBytes: 1536 * 1024 });
export type PublicDiscussionsRead = Readonly<{ rows: readonly PublicSourceRow[]; truncated: boolean; productName: string;
  /** The rabbi's display name from the congregation's settings, for the reader's "From {name}" label; absent where a harness has none. */
  rabbiName?: string }>;

/** One read transaction's worth: the rows for these verses and the product name the translation credit needs. */
export async function readPublicDiscussions<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, tenantId: string, verses: readonly string[]): Promise<PublicDiscussionsRead> {
  const { rows, truncated } = await publicDiscussionRows(tx, tenantId, verses, PUBLIC_DISCUSSION_LIMITS.discussions);
  if (!rows.length) return Object.freeze({ rows, truncated, productName: "" });
  const [tenant] = await tx.select({ customs: s.tenant.customs }).from(s.tenant).where(eq(s.tenant.id, tenantId)).limit(1);
  return Object.freeze({ rows, truncated, productName: await readProductName(tx, tenantId), rabbiName: effectiveRabbiName(await currentSettings(tx, tenantId), tenant?.customs) });
}

type Fetch = Readonly<{ ref: string; edition: PinnedEdition }>;
const keyOf = (item: Fetch) => JSON.stringify([item.ref, item.edition.language, item.edition.title]);
const textView = (text: SourceText) => ({ segments: text.segments, editions: text.editions });
const size = (value: unknown) => Buffer.byteLength(JSON.stringify(value));

/**
 * A process-wide memo of pinned Sefaria reads (successes only, a few hours, bounded), with in-flight reads shared: distinct
 * passage URLs miss the CDN separately, and this keeps them from each fanning out to Sefaria again for the same sources.
 */
export function memoPinnedSource(reader: PinnedSourceReader, options: { max?: number; ttlMs?: number; now?: () => number } = {}): PinnedSourceReader {
  const max = options.max ?? 500, ttlMs = options.ttlMs ?? 6 * 3600_000, now = options.now ?? Date.now;
  const kept = new Map<string, { at: number; text: SourceText }>(), flying = new Map<string, Promise<SourceText>>();
  return async (ref, edition, signal) => {
    const key = keyOf({ ref, edition }), hit = kept.get(key);
    if (hit && now() - hit.at < ttlMs) { kept.delete(key); kept.set(key, hit); return hit.text; }
    if (hit) kept.delete(key);
    let pending = flying.get(key);
    if (!pending) {
      // Not tied to one caller's signal: a shared read finishes for the others (it has its own Sefaria deadline).
      pending = reader(ref, edition).then(text => { kept.set(key, { at: now(), text }); while (kept.size > max) kept.delete(kept.keys().next().value!); return text; })
        .finally(() => flying.delete(key));
      flying.set(key, pending);
    }
    if (!signal) return pending;
    if (signal.aborted) throw new Error("aborted");
    return new Promise<SourceText>((resolve, reject) => {
      const stop = () => reject(new Error("aborted"));
      signal.addEventListener("abort", stop, { once: true });
      pending.then(resolve, reject).finally(() => signal.removeEventListener("abort", stop));
    });
  };
}

export async function publicDiscussionsAnswer(read: PublicDiscussionsRead, verses: readonly string[], pinned: PinnedSourceReader, signal?: AbortSignal) {
  const order = new Map(verses.map((verse, i) => [verse, i]));
  const groups = new Map<string, PublicSourceRow[]>();
  for (const row of read.rows) groups.set(row.slug, [...(groups.get(row.slug) ?? []), row]);
  const first = (rows: readonly PublicSourceRow[]) => Math.min(...rows.map(row => order.get(row.anchorRef) ?? Number.MAX_SAFE_INTEGER));
  const discussions = [...groups.values()].map(rows => [...rows].sort((a, b) => a.position - b.position))
    .sort((a, b) => first(a) - first(b) || (a[0].slug < b[0].slug ? -1 : a[0].slug > b[0].slug ? 1 : 0));

  // Each distinct (ref, edition) once, in reading order, within the budget; anything past it is marked incomplete.
  const wanted = new Map<string, Fetch>();
  for (const rows of discussions) for (const row of rows) {
    const item: Fetch | null = row.edition !== null ? { ref: row.ref, edition: { language: "en", title: row.edition } }
      : row.translationEdition !== null ? { ref: row.ref, edition: { language: "he", title: row.translationEdition } } : null;
    if (item && !wanted.has(keyOf(item)) && wanted.size < PUBLIC_DISCUSSION_LIMITS.fetches) wanted.set(keyOf(item), item);
  }
  const texts = new Map<string, SourceText>(), queue = [...wanted.entries()];
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), PUBLIC_DISCUSSION_LIMITS.deadlineMs);
  const stop = () => controller.abort();
  signal?.addEventListener("abort", stop, { once: true });
  try {
    let next = 0;
    const worker = async () => {
      while (next < queue.length && !controller.signal.aborted) {
        const [key, item] = queue[next++];
        try { texts.set(key, await pinned(item.ref, item.edition, controller.signal)); } catch { /* That source is shown without its text: open it on Sefaria. */ }
      }
    };
    await Promise.all(Array.from({ length: Math.min(PUBLIC_DISCUSSION_LIMITS.concurrency, queue.length) }, worker));
  } finally { clearTimeout(timer); signal?.removeEventListener("abort", stop); controller.abort(); }

  let complete = true, truncated = read.truncated, budget = PUBLIC_DISCUSSION_LIMITS.answerBytes;
  const answer = [];
  for (const rows of discussions) {
    const head = rows[0], anchors: string[] = [];
    for (const row of rows) if (!anchors.includes(row.anchorRef)) anchors.push(row.anchorRef);
    const sources = rows.map(row => {
      const details = { selectedBy: selectedByDetail(row.selectedByName) };
      if (row.edition !== null) {
        const text = texts.get(keyOf({ ref: row.ref, edition: { language: "en", title: row.edition } })) ?? null;
        const english = text?.editions.find(edition => edition.language === "en") ?? null;
        return { position: row.position, ref: row.ref, anchorRef: row.anchorRef, kind: "edition" as const, edition: row.edition,
          credit: english?.credit ?? null, license: english?.license ?? null, licenseLabel: english?.licenseLabel ?? null,
          sefariaUrl: sourceSefariaUrl(row.ref, { language: "en", title: row.edition }), details, text: text ? textView(text) : null };
      }
      const text = row.translationEdition !== null ? texts.get(keyOf({ ref: row.ref, edition: { language: "he", title: row.translationEdition } })) ?? null : null;
      return { position: row.position, ref: row.ref, anchorRef: row.anchorRef, kind: "translation" as const, credit: claudeTranslationCredit(read.productName),
        translation: { body: row.translationBody ?? "", originalEdition: row.translationEdition ?? "" },
        sefariaUrl: row.translationEdition !== null ? sourceSefariaUrl(row.ref, { language: "he", title: row.translationEdition }) : sourceSefariaUrl(row.ref),
        details, text: text ? textView(text) : null };
    });
    const bare = { slug: head.slug, title: head.title, kind: head.kind, revision: head.revision, updatedAt: head.updatedAt.toISOString(), anchors,
      sources: sources.map(source => ({ ...source, text: null })) };
    const bareBytes = size(bare);
    if (bareBytes > budget) { truncated = true; break; }
    budget -= bareBytes;
    // Text in source order while it fits; a source left without text is opened on Sefaria instead.
    for (const source of sources) {
      if (!source.text) { complete = false; continue; }
      const bytes = size(source.text);
      if (bytes > budget) { source.text = null; complete = false; } else budget -= bytes;
    }
    answer.push({ ...bare, sources });
  }
  return { discussions: answer, complete, truncated };
}
