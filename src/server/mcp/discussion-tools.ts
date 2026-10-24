import "server-only";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import { AccessDenied } from "../access/errors";
import { lockRabbi } from "../study-guides/authority";
import { versesFor, type CuratorAuthority } from "../discussions/service";
import { VERSE_REF } from "../study-guides/validation";
import { selectorName } from "../discussions/validation";
import { eq } from "drizzle-orm";
import * as s from "../db/index";
import { findNamedReading } from "./print-tools";
import { SCOPES } from "./oauth";
import type { Tool, ToolContext } from "./tools";

/**
 * Curated discussions through Claude (release 1.7 M6, spec 2026-10-24-curated-discussions-design). The rabbi names a question
 * or theme and selects original sources with Claude; adding one publishes it at once, for everyone, beside its verses. Admin
 * only and attended only, like the voice: a scheduled routine can neither write nor list them. The tools take only explicit
 * text and references (closed schemas: no saved reading, note, student or membership is ever an argument), and nothing they
 * return names a membership or an address.
 */
const UUID_PATTERN = "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$";
const SLUG_PATTERN = "^[a-z0-9]+(?:-[a-z0-9]+)*$";
const closed = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });
const mutationId = { type: "string", pattern: UUID_PATTERN, description: "A fresh random UUID for this add; resending the same one replays the saved result instead of adding twice." };
const slug = { type: "string", maxLength: 80, pattern: SLUG_PATTERN, description: "The discussion's slug, from add_discussion or list_discussions." };
const revision = { type: "integer", minimum: 1, maximum: 1000000, description: "The current revision, from list_discussions or the last change; a stale one is refused." };
const title = { type: "string", maxLength: 160, description: "The question or theme, one plain line (at most 160 bytes). No introduction or essay: a discussion is its title and its sources." };
const source = { type: "object", additionalProperties: false, properties: {
  ref: { type: "string", maxLength: 256, description: "The Sefaria citation of the passage, e.g. \"Rashi on Genesis 12:1:1\" or \"Mishnah Avot 1:14\"." },
  anchorRef: { type: "string", maxLength: 100, description: "The one verse it sits beside, \"Book C:V\": a verse of a real Torah reading, or of a haftarah on the reading list." },
  edition: { type: "string", maxLength: 300, description: "A Sefaria English version title for this source, exactly as Sefaria names it. Give this or translationId." },
  translationId: { type: "string", pattern: UUID_PATTERN, description: "An id from add_source_translation, made for exactly this ref. Give this or edition." },
}, required: ["ref", "anchorRef"] };
const sources = { type: "array", minItems: 1, maxItems: 24, items: source, description: "The original sources, in reading order, 1 to 24. Each is checked on Sefaria before anything is saved." };
const kind = { type: "string", enum: ["torah", "haftarah"], description: "Which reading the verses belong to." };

/** The rabbi's authority for one call: a live, attended admin connection whose grant is re-locked in the transaction. */
function curatorAuthority<Q extends PgQueryResultHKT>(ctx: ToolContext<Q>, intent: "read" | "data-write"): CuratorAuthority<Q> {
  return {
    run: action => ctx.mcp.withLive(ctx.actor, intent, async (tx, actor, alive) => {
      if (actor.role !== "admin" || actor.unattended) throw new AccessDenied(403);
      const rabbi = await lockRabbi(tx, actor.tenantId, actor.membershipId, { roleGrantId: actor.roleGrantId, roleGrantRevision: actor.roleGrantRevision, authorityRevision: actor.authorityRevision });
      const [account] = await tx.select({ name: s.user.name }).from(s.user).where(eq(s.user.id, rabbi.userId)).limit(1);
      const writer = Object.freeze({ tenantId: actor.tenantId, membershipId: rabbi.membershipId, userId: rabbi.userId, displayName: selectorName(account?.name) });
      return action(tx, writer, () => { alive(); if (ctx.signal.aborted) throw new AccessDenied(401); });
    }),
  };
}
/** Attended admins only; writes need the study consent. Refused plainly, before any work. */
function refusal(ctx: { actor: ToolContext<PgQueryResultHKT>["actor"] }, write: boolean) {
  if (ctx.actor.role !== "admin") throw new AccessDenied(403);
  if (ctx.actor.unattended) return { ok: false, code: "attended-only", hint: "Curated discussions are the rabbi's own act: a scheduled routine cannot add, revise, withdraw or list them." };
  if (write && !ctx.actor.scopes.has(SCOPES.study)) throw new AccessDenied(403);
  return null;
}
const hints: Record<string, string> = {
  invalid: "Fix the listed problems and resend.", conflict: "Someone changed it first or the revision is stale: call list_discussions, then resend with the current revision.",
  "no-change": "Nothing changed; nothing was saved.", "not-found": "No discussion has that slug.", withdrawn: "That discussion is withdrawn; add a new one instead.",
  unavailable: "Sefaria could not be checked just now; nothing was saved. Try again.",
};
const outcome = (result: { ok: boolean; code?: string } & Record<string, unknown>) => result.ok ? result : { ...result, hint: hints[result.code ?? ""] };

export function createDiscussionTools<Q extends PgQueryResultHKT>(): readonly Tool<Q>[] {
  const write = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true };
  return Object.freeze([
    {
      name: "add_source_translation", roles: ["admin"], scope: SCOPES.study, annotations: write, deadlineMs: 55_000,
      description: "Save a Claude translation of one original passage, for a curated discussion. originalRef and originalEdition must name a Hebrew or Aramaic text Sefaria holds; the body is the English translation only (markdown-lite: paragraphs, emphasis, lists; no links, HTML or commentary of your own). Never edited afterwards: a corrected translation is a new one. Returns translationId and the credit it is shown with, \"Claude translation for {productName}\". Only when the rabbi asks.",
      inputSchema: closed({ originalRef: { type: "string", maxLength: 256, description: "The Sefaria citation of the original, e.g. \"Mishnah Avot 1:14\"." },
        originalEdition: { type: "string", maxLength: 300, description: "The Sefaria Hebrew or Aramaic version title translated from, exactly as Sefaria names it." },
        body: { type: "string", maxLength: 20000, description: "The English translation, at most 16 KB." }, mutationId }, ["originalRef", "originalEdition", "body", "mutationId"]),
      handler: async (input, ctx) => refusal(ctx, true) ?? outcome(await ctx.discussions.addTranslation(curatorAuthority(ctx, "data-write"), input as never, ctx.signal)),
    },
    {
      name: "add_discussion", roles: ["admin"], scope: SCOPES.study, annotations: write, deadlineMs: 55_000,
      description: "Publish a curated discussion at once, for everyone, beside its verses: a question or theme as the title, and the original sources the rabbi selected, in order, each anchored to one verse. Sources only: no introduction, connecting text or summary is accepted. Each source is a Sefaria passage in a named English edition, or a Claude translation from add_source_translation. Refused whole if any ref or edition is not on Sefaria, or any anchor is not a verse of a real reading. Returns the slug and revision 1. Only when the rabbi asks.",
      inputSchema: closed({ title, kind, sources, mutationId }, ["title", "kind", "sources", "mutationId"]),
      handler: async (input, ctx) => refusal(ctx, true) ?? outcome(await ctx.discussions.addDiscussion(curatorAuthority(ctx, "data-write"), input, ctx.signal)),
    },
    {
      name: "revise_discussion", roles: ["admin"], scope: SCOPES.study, annotations: { ...write, idempotentHint: false }, deadlineMs: 55_000,
      description: "Change a published discussion's title, its whole ordered set of sources, or both, under its current revision. New sources replace the old set entirely and are checked on Sefaria as for add_discussion. The change is public at once. Returns the new revision.",
      inputSchema: closed({ slug, revision, title, sources }, ["slug", "revision"]),
      handler: async (input, ctx) => refusal(ctx, true) ?? outcome(await ctx.discussions.reviseDiscussion(curatorAuthority(ctx, "data-write"), input, ctx.signal)),
    },
    {
      name: "withdraw_discussion", roles: ["admin"], scope: SCOPES.study, annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
      description: "Withdraw a discussion: within about five minutes it disappears from the verses and the reading list for everyone (cached pages refresh). Its record is kept and it cannot be republished; add a new one instead. Only when the rabbi asks.",
      inputSchema: closed({ slug, revision }, ["slug", "revision"]),
      handler: async (input, ctx) => refusal(ctx, true) ?? outcome(await ctx.discussions.withdrawDiscussion(curatorAuthority(ctx, "data-write"), input)),
    },
    {
      name: "list_discussions", roles: ["admin"], scope: SCOPES.read, annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      description: "Every curated discussion with a source anchored in a reading or on one verse, withdrawn ones included: slug, title, status, current revision and the ordered sources (ref, anchor, edition or translationId). Name a reading (a parashah, special Shabbat, festival or fast from the portal's list) or one verse.",
      inputSchema: closed({ reading: { type: "string", maxLength: 80, description: "A reading from the portal's list, e.g. \"Noach\" or \"Shabbat Shekalim\"." },
        verse: { type: "string", maxLength: 100, description: "One verse, \"Book C:V\"." } }),
      handler: async (input, ctx) => {
        const refused = refusal(ctx, false); if (refused) return refused;
        if ((input.reading === undefined) === (input.verse === undefined)) return { ok: false, code: "invalid", hint: "Name exactly one of reading or verse." };
        let verses: string[];
        if (input.reading !== undefined) {
          const reading = findNamedReading(input.reading as string);
          if (!reading) return { ok: false, code: "invalid", hint: "No reading by that name in the portal's list; use its usual English spelling, or name a verse." };
          verses = versesFor({ reading });
        } else {
          if (!VERSE_REF.test(input.verse as string)) return { ok: false, code: "invalid", hint: "verse is one verse, \"Book C:V\"." };
          verses = versesFor({ verse: input.verse as string });
          if (!verses.length) return { ok: false, code: "invalid", hint: "That verse is not in any Torah reading or haftarah on the reading list." };
        }
        return { ok: true, ...(await ctx.discussions.listDiscussions(curatorAuthority(ctx, "read"), verses)) };
      },
    },
  ] satisfies Tool<Q>[]);
}
