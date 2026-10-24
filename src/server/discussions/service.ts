import "server-only";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { AccessTransaction } from "../access/types";
import { canonical } from "../study-guides/service";
import { createHash } from "node:crypto";
import { readProductName } from "../data/product-name";
import { SourceTextUnavailable, type PinnedSourceReader } from "../study/source-text";
import { claudeTranslationCredit } from "../../lib/discussions/labels";
import * as data from "./data";
import { slugBase, validateDiscussion, validateSources, validateTranslationBody, validEdition, validRef, validTitle, type SourceInput } from "./validation";

/**
 * Curated discussions and credited Claude translations (1.7 M6). Writes come only through the admin, attended MCP tools
 * (mcp/discussion-tools.ts), which supply a `CuratorAuthority`: the connection and the admin grant re-locked inside the
 * write transaction. Every write is three phases, as the study guide's: authority and receipt first; Sefaria checks outside
 * any transaction; then authority, receipt and revision again before the insert. Adding publishes at once; fixes come by
 * revising or withdrawing. Nothing here reads saved readings, notes or student data, and no output names a membership.
 */
export type CuratorWriter = data.CuratorWriter;
export type CuratorAuthority<Q extends PgQueryResultHKT> = {
  run<T>(action: (tx: AccessTransaction<Q>, writer: CuratorWriter, live: () => void) => Promise<T>): Promise<T>;
};
type FailureCode = "invalid" | "conflict" | "no-change" | "not-found" | "withdrawn" | "unavailable";
export type DiscussionFailure = Readonly<{ ok: false; code: FailureCode; problems?: readonly string[] }>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const fail = (code: FailureCode, problems?: readonly string[]): DiscussionFailure => Object.freeze({ ok: false, code, ...(problems ? { problems: Object.freeze([...problems]) } : {}) });
const digest = (parts: unknown) => createHash("sha256").update(canonical(parts)).digest("hex");
const CHECK_CONCURRENCY = 4, CHECK_DEADLINE_MS = 30_000, LIST_LIMIT = 100;

/**
 * Sefaria must hold each edition source by its exact version title at that exact ref, and each translation's original in its
 * Hebrew or Aramaic edition. An answer of "not there" refuses the call with the source named; Sefaria being unreachable
 * refuses it whole, saving nothing.
 */
async function checkOnSefaria(pinned: PinnedSourceReader, wanted: readonly { ref: string; language: "he" | "en"; title: string; where: string }[], outer: AbortSignal) {
  const problems: string[] = [];
  const unique = [...new Map(wanted.map(item => [JSON.stringify([item.ref, item.language, item.title]), item])).values()];
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), CHECK_DEADLINE_MS);
  const stop = () => controller.abort();
  outer.addEventListener("abort", stop, { once: true });
  let unreachable = false, next = 0;
  try {
    const worker = async () => {
      while (next < unique.length && !controller.signal.aborted) {
        const item = unique[next++];
        try { await pinned(item.ref, { language: item.language, title: item.title }, controller.signal); }
        catch (error) {
          if (error instanceof SourceTextUnavailable && error.code !== "upstream") problems.push(`${item.where}: Sefaria has no text at ${item.ref} in the ${item.language === "he" ? "Hebrew or Aramaic" : "English"} edition "${item.title}"`);
          else { unreachable = true; controller.abort(); }
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CHECK_CONCURRENCY, unique.length) }, worker));
    // A deadline or a cancelled call leaves the check incomplete: never read a source that was not checked as a pass.
    if (controller.signal.aborted) unreachable = true;
  } finally { clearTimeout(timer); outer.removeEventListener("abort", stop); controller.abort(); }
  if (unreachable) return fail("unavailable", ["Sefaria could not be checked just now; nothing was saved. Try again."]);
  return problems.length ? fail("invalid", problems) : null;
}
const editionChecks = (sources: readonly SourceInput[]) => sources.flatMap((source, i) => source.edition !== undefined
  ? [{ ref: source.ref, language: "en" as const, title: source.edition, where: `sources[${i}]` }] : []);
/** Each translation source names a translation of this congregation, of exactly this ref. */
async function translationProblems<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, tenantId: string, sources: readonly SourceInput[]) {
  const ids = [...new Set(sources.flatMap(source => source.translationId ? [source.translationId] : []))];
  const found = await data.translationsById(tx, tenantId, ids), problems: string[] = [];
  sources.forEach((source, i) => {
    if (!source.translationId) return;
    const row = found.get(source.translationId);
    if (!row) problems.push(`sources[${i}].translationId: no such translation; add it with add_source_translation first`);
    else if (row.originalRef !== source.ref) problems.push(`sources[${i}]: that translation is of ${row.originalRef}, not ${source.ref}`);
  });
  return problems;
}
const sameSources = (rows: readonly data.SourceRow[], sources: readonly SourceInput[]) => rows.length === sources.length
  && rows.every((row, i) => row.ref === sources[i].ref && row.anchorRef === sources[i].anchorRef && row.edition === (sources[i].edition ?? null) && row.translationId === (sources[i].translationId ?? null));
const sourceView = (row: data.SourceRow) => Object.freeze({ position: row.position, ref: row.ref, anchorRef: row.anchorRef, selectedBy: row.selectedByName,
  ...(row.edition !== null ? { edition: row.edition } : { translationId: row.translationId }) });

export { versesFor } from "./validation";

export function createDiscussionService<Q extends PgQueryResultHKT>(input: { pinned: PinnedSourceReader }) {
  // Translations ---------------------------------------------------------------------------------
  async function addTranslation(authority: CuratorAuthority<Q>, supplied: { originalRef: unknown; originalEdition: unknown; body: unknown; mutationId: unknown }, signal: AbortSignal) {
    const problems: string[] = [];
    if (!validRef(supplied.originalRef)) problems.push("originalRef: a Sefaria citation of the original, such as \"Mishnah Avot 1:14\"");
    if (!validEdition(supplied.originalEdition)) problems.push("originalEdition: the Sefaria Hebrew or Aramaic version title, one plain line");
    const body = validateTranslationBody(supplied.body);
    if (!body.ok) problems.push(...body.problems);
    if (typeof supplied.mutationId !== "string" || !UUID.test(supplied.mutationId)) problems.push("mutationId: a fresh UUID");
    if (problems.length || !body.ok) return fail("invalid", problems);
    const originalRef = supplied.originalRef as string, originalEdition = supplied.originalEdition as string, mutationId = (supplied.mutationId as string).toLowerCase();
    const requestDigest = digest(["source-translation/v1", originalRef, originalEdition, body.value]);
    const answer = async (tx: AccessTransaction<Q>, writer: CuratorWriter, id: string, replayed: boolean) => Object.freeze({ ok: true as const, replayed, translationId: id,
      originalRef, originalEdition, credit: claudeTranslationCredit(await readProductName(tx, writer.tenantId)) });
    const replay = async (tx: AccessTransaction<Q>, writer: CuratorWriter, row: data.TranslationRow) => row.requestDigest === requestDigest ? answer(tx, writer, row.id, true) : fail("conflict");
    const first = await authority.run(async (tx, writer) => { const prior = await data.translationReceipt(tx, writer.tenantId, mutationId); return prior ? replay(tx, writer, prior) : null; });
    if (first) return first;
    const refused = await checkOnSefaria(input.pinned, [{ ref: originalRef, language: "he", title: originalEdition, where: "original" }], signal);
    if (refused) return refused;
    return authority.run(async (tx, writer, live) => {
      const prior = await data.translationReceipt(tx, writer.tenantId, mutationId); if (prior) return replay(tx, writer, prior);
      live(); const row = await data.insertTranslation(tx, writer, { originalRef, originalEdition, body: body.value, mutationId, requestDigest }); live();
      if (row) return answer(tx, writer, row.id, false);
      const raced = await data.translationReceipt(tx, writer.tenantId, mutationId); return raced ? replay(tx, writer, raced) : fail("conflict");
    });
  }

  // Discussions ----------------------------------------------------------------------------------
  async function addDiscussion(authority: CuratorAuthority<Q>, supplied: Record<string, unknown>, signal: AbortSignal) {
    const { mutationId: rawMutation, ...rest } = supplied;
    if (typeof rawMutation !== "string" || !UUID.test(rawMutation)) return fail("invalid", ["mutationId: a fresh UUID"]);
    const checked = validateDiscussion(rest);
    if (!checked.ok) return fail("invalid", checked.problems);
    const value = checked.value, mutationId = rawMutation.toLowerCase(), requestDigest = digest(["curated-discussion/v1", value]);
    const replay = (row: data.DiscussionRow) => row.requestDigest === requestDigest
      ? Object.freeze({ ok: true as const, replayed: true, slug: row.slug, revision: row.revision, status: row.status }) : fail("conflict");
    const guard = async (tx: AccessTransaction<Q>, writer: CuratorWriter) => {
      const prior = await data.discussionReceipt(tx, writer.tenantId, mutationId); if (prior) return replay(prior);
      const problems = await translationProblems(tx, writer.tenantId, value.sources);
      return problems.length ? fail("invalid", problems) : null;
    };
    const first = await authority.run(guard);
    if (first) return first;
    const refused = await checkOnSefaria(input.pinned, editionChecks(value.sources), signal);
    if (refused) return refused;
    return authority.run(async (tx, writer, live) => {
      const again = await guard(tx, writer); if (again) return again;
      const base = slugBase(value.title), taken = await data.slugsLike(tx, writer.tenantId, base);
      let slug = base;
      for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`;
      live();
      const row = await data.insertDiscussion(tx, writer, { slug, title: value.title, kind: value.kind, mutationId, requestDigest });
      if (!row) { const raced = await data.discussionReceipt(tx, writer.tenantId, mutationId); return raced ? replay(raced) : fail("conflict", ["Another discussion took that name just now; send it again."]); }
      await data.insertSources(tx, writer, row.id, 1, value.sources);
      live();
      return Object.freeze({ ok: true as const, replayed: false, slug: row.slug, revision: row.revision });
    });
  }

  const slugOf = (value: unknown) => typeof value === "string" && value.length <= 80 && SLUG.test(value) ? value : null;
  const revisionOf = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 1 && (value as number) < 2147483647 ? value as number : null;

  async function reviseDiscussion(authority: CuratorAuthority<Q>, supplied: Record<string, unknown>, signal: AbortSignal) {
    const allowed = ["slug", "revision", "title", "sources"], unknown = Object.keys(supplied).filter(key => !allowed.includes(key));
    if (unknown.length) return fail("invalid", [`A revision changes the title or the sources only; not ${unknown.join(", ")}`]);
    const slug = slugOf(supplied.slug), expected = revisionOf(supplied.revision), problems: string[] = [];
    if (!slug) problems.push("slug: from list_discussions");
    if (expected === null) problems.push("revision: the current revision from list_discussions");
    if (supplied.title === undefined && supplied.sources === undefined) problems.push("Give a new title, new sources, or both.");
    if (supplied.title !== undefined && !validTitle(supplied.title)) problems.push("title: one plain line of at most 160 bytes");
    if (problems.length || !slug || expected === null) return fail("invalid", problems);
    const title = supplied.title as string | undefined;
    type Plan = { id: string; sources: readonly SourceInput[] | null };
    const guard = async (tx: AccessTransaction<Q>, writer: CuratorWriter, lock: boolean): Promise<DiscussionFailure | Plan> => {
      const row = await data.discussionBySlug(tx, writer.tenantId, slug, lock);
      if (!row) return fail("not-found");
      if (row.status === "withdrawn") return fail("withdrawn");
      if (row.revision !== expected) return fail("conflict");
      let sources: readonly SourceInput[] | null = null;
      if (supplied.sources !== undefined) {
        const checked = validateSources(supplied.sources, row.kind);
        if (!checked.ok) return fail("invalid", checked.problems);
        const translationIssues = await translationProblems(tx, writer.tenantId, checked.value);
        if (translationIssues.length) return fail("invalid", translationIssues);
        sources = sameSources(await data.currentSources(tx, writer.tenantId, row.id), checked.value) ? null : checked.value;
      }
      if (sources === null && (title === undefined || title === row.title)) return fail("no-change");
      return { id: row.id, sources };
    };
    const first = await authority.run((tx, writer) => guard(tx, writer, false));
    if ("ok" in first) return first;
    if (first.sources) { const refused = await checkOnSefaria(input.pinned, editionChecks(first.sources), signal); if (refused) return refused; }
    return authority.run(async (tx, writer, live) => {
      const plan = await guard(tx, writer, true);
      if ("ok" in plan) return plan;
      // Only sources checked on Sefaria above are ever written.
      if (plan.sources && !first.sources) return fail("conflict");
      live();
      const bumped = await data.bumpDiscussion(tx, writer.tenantId, plan.id, expected, { ...(title !== undefined ? { title } : {}) });
      if (!bumped) return fail("conflict");
      if (plan.sources) await data.insertSources(tx, writer, plan.id, bumped.revision, plan.sources);
      live();
      return Object.freeze({ ok: true as const, slug, revision: bumped.revision });
    });
  }

  async function withdrawDiscussion(authority: CuratorAuthority<Q>, supplied: Record<string, unknown>) {
    const unknown = Object.keys(supplied).filter(key => key !== "slug" && key !== "revision");
    if (unknown.length) return fail("invalid", [`Withdraw takes slug and revision only; not ${unknown.join(", ")}`]);
    const slug = slugOf(supplied.slug), expected = revisionOf(supplied.revision);
    if (!slug || expected === null) return fail("invalid", ["slug and revision from list_discussions"]);
    return authority.run(async (tx, writer, live) => {
      const row = await data.discussionBySlug(tx, writer.tenantId, slug, true);
      if (!row) return fail("not-found");
      if (row.status === "withdrawn") return fail("withdrawn");
      if (row.revision !== expected) return fail("conflict");
      live(); const bumped = await data.bumpDiscussion(tx, writer.tenantId, row.id, expected, { withdraw: true }); live();
      return bumped ? Object.freeze({ ok: true as const, slug, revision: bumped.revision, status: "withdrawn" as const }) : fail("conflict");
    });
  }

  /** Everything anchored in the verses, withdrawn included, with each current source set: the rabbi's working list. */
  async function listDiscussions(authority: CuratorAuthority<Q>, verses: readonly string[]) {
    return authority.run(async (tx, writer) => {
      const rows = await data.discussionsAnchoredIn(tx, writer.tenantId, verses, LIST_LIMIT + 1);
      const discussions = [];
      for (const row of rows.slice(0, LIST_LIMIT)) {
        const sources = await data.currentSources(tx, writer.tenantId, row.id);
        discussions.push(Object.freeze({ slug: row.slug, title: row.title, kind: row.kind, status: row.status, revision: row.revision,
          createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), sources: Object.freeze(sources.map(sourceView)) }));
      }
      return Object.freeze({ discussions: Object.freeze(discussions), truncated: rows.length > LIST_LIMIT });
    });
  }

  return Object.freeze({ addTranslation, addDiscussion, reviseDiscussion, withdrawDiscussion, listDiscussions });
}
export type DiscussionService<Q extends PgQueryResultHKT> = ReturnType<typeof createDiscussionService<Q>>;
