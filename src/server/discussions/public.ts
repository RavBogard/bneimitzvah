import "server-only";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { AccessTransaction } from "../access/types";
import { readProductName } from "../data/product-name";
import { sourceSefariaUrl } from "../../lib/readings/shelf";
import { claudeTranslationCredit, selectedByDetail } from "../../lib/discussions/labels";
import type { PinnedEdition, PinnedSourceReader, SourceText } from "../study/source-text";
import { publicDiscussionRows, type PublicSourceRow } from "./data";
import { curatorName } from "./curator";

/**
 * The signed-out discussions answer (`GET /api/public/discussions`, 1.7 M6). The same for every caller: no session, no
 * cookie, no membership. Rows come only through curated_discussion_public (published discussions, current sources, no
 * curator); each source's text comes live from Sefaria through the Study lens's own source reader, pinned to the chosen
 * edition, and is never stored. A Claude translation carries its body and the credit "Claude translation for {productName}";
 * every source carries "Selected by {name}" as a separate detail, never in its credit.
 */
export const PUBLIC_DISCUSSION_LIMITS = Object.freeze({ discussions: 8, fetches: 48, concurrency: 6, deadlineMs: 8000 });
export type PublicDiscussionsRead = Readonly<{ rows: readonly PublicSourceRow[]; productName: string; curator: string }>;

/** One read transaction's worth: the rows for these verses, the product name and the curator's public name. */
export async function readPublicDiscussions<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, tenantId: string, verses: readonly string[]): Promise<PublicDiscussionsRead> {
  const rows = await publicDiscussionRows(tx, tenantId, verses, PUBLIC_DISCUSSION_LIMITS.discussions);
  if (!rows.length) return Object.freeze({ rows, productName: "", curator: "" });
  return Object.freeze({ rows, productName: await readProductName(tx, tenantId), curator: await curatorName(tx, tenantId) });
}

type Fetch = Readonly<{ ref: string; edition: PinnedEdition }>;
const keyOf = (item: Fetch) => JSON.stringify([item.ref, item.edition.language, item.edition.title]);
const textView = (text: SourceText) => ({ segments: text.segments, editions: text.editions });

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

  let complete = true;
  const selectedBy = selectedByDetail(read.curator);
  const answer = discussions.map(rows => {
    const head = rows[0], anchors: string[] = [];
    for (const row of rows) if (!anchors.includes(row.anchorRef)) anchors.push(row.anchorRef);
    const sources = rows.map(row => {
      const details = { selectedBy };
      if (row.edition !== null) {
        const text = texts.get(keyOf({ ref: row.ref, edition: { language: "en", title: row.edition } })) ?? null;
        if (!text) complete = false;
        const english = text?.editions.find(edition => edition.language === "en") ?? null;
        return { position: row.position, ref: row.ref, anchorRef: row.anchorRef, kind: "edition" as const, edition: row.edition,
          credit: english?.credit ?? null, license: english?.license ?? null, licenseLabel: english?.licenseLabel ?? null,
          sefariaUrl: sourceSefariaUrl(row.ref, { language: "en", title: row.edition }), details, text: text ? textView(text) : null };
      }
      const text = row.translationEdition !== null ? texts.get(keyOf({ ref: row.ref, edition: { language: "he", title: row.translationEdition } })) ?? null : null;
      if (!text) complete = false;
      return { position: row.position, ref: row.ref, anchorRef: row.anchorRef, kind: "translation" as const, credit: claudeTranslationCredit(read.productName),
        translation: { body: row.translationBody ?? "", originalEdition: row.translationEdition ?? "" },
        sefariaUrl: row.translationEdition !== null ? sourceSefariaUrl(row.ref, { language: "he", title: row.translationEdition }) : sourceSefariaUrl(row.ref),
        details, text: text ? textView(text) : null };
    });
    return { slug: head.slug, title: head.title, kind: head.kind, revision: head.revision, updatedAt: head.updatedAt.toISOString(), anchors, sources };
  });
  return { discussions: answer, complete };
}
