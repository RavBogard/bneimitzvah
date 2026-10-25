import "server-only";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import { AccessDenied } from "../access/errors";
import { lockRabbi } from "../study-guides/authority";
import { approveSummary, draftSummary, listSummaries, withdrawSummary, type SummaryAuthority } from "../portion-summary/service";
import { PORTION_SUMMARY_LIMITS } from "../portion-summary/validation";
import { SCOPES } from "./oauth";
import type { Tool, ToolContext } from "./tools";

/**
 * Portion summaries through Claude (release 1.9 N6, decision 4: "Claude drafts, you approve"). Claude drafts a parashah's
 * summary and a one-line outline of each aliyah; nothing is shown to anyone until the rabbi or an administrator approves that
 * exact revision, in a conversation they attend; then readers see it credited "Rabbi Daniel Bogard". Admin only: a tutor,
 * parent or student never sees these tools. A scheduled routine may draft and list, never approve or withdraw. The tools take
 * only explicit text (closed schemas: no student, saved reading or membership is ever an argument), and nothing they return
 * names a membership or an address.
 */
const UUID_PATTERN = "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$";
const closed = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });
const reading = { type: "string", maxLength: 80, description: "A parashah from the portal's reading list, by name or slug, e.g. \"Vayera\" or \"lech-lecha\". Not a special Shabbat, festival or fast." };
const revision = { type: "integer", minimum: 1, maximum: 1000000, description: "The revision, from list_portion_summaries or draft_portion_summary." };

/** The rabbi's authority for one call: a live admin connection whose grant is re-locked in the transaction. */
function summaryAuthority<Q extends PgQueryResultHKT>(ctx: ToolContext<Q>, intent: "read" | "data-write"): SummaryAuthority<Q> {
  return {
    run: action => ctx.mcp.withLive(ctx.actor, intent, async (tx, actor, alive) => {
      if (actor.role !== "admin") throw new AccessDenied(403);
      const rabbi = await lockRabbi(tx, actor.tenantId, actor.membershipId, { roleGrantId: actor.roleGrantId, roleGrantRevision: actor.roleGrantRevision, authorityRevision: actor.authorityRevision });
      const writer = Object.freeze({ tenantId: actor.tenantId, membershipId: rabbi.membershipId, roleGrantId: rabbi.roleGrantId, attended: !actor.unattended });
      return action(tx, writer, () => { alive(); if (ctx.signal.aborted) throw new AccessDenied(401); });
    }),
  };
}
/** Admins only; writes need the study consent; approving and withdrawing need the rabbi present. Refused before any work. */
function refusal(ctx: { actor: ToolContext<PgQueryResultHKT>["actor"] }, write: boolean, attended: boolean) {
  if (ctx.actor.role !== "admin") throw new AccessDenied(403);
  if (write && !ctx.actor.scopes.has(SCOPES.study)) throw new AccessDenied(403);
  if (attended && ctx.actor.unattended) return { ok: false, code: "attended-only", hint: hints["attended-only"] };
  return null;
}
const hints: Record<string, string> = {
  invalid: "Fix the listed problems and resend.", conflict: "Someone changed it first: call list_portion_summaries, then resend.",
  "no-change": "That exact text is already a revision; nothing was saved.", "not-found": "No revision of that parashah has that number.",
  withdrawn: "That revision is withdrawn for good; draft a new one instead.", "not-draft": "Only a draft can be approved; that revision is already approved.",
  "attended-only": "Approving or withdrawing a portion summary is the rabbi's own act, in a conversation: a scheduled routine cannot do it.",
  "no-credit": "This congregation has no portion summary credit set, so nothing can be approved.",
};
const outcome = (result: { ok: boolean; code?: string } & Record<string, unknown>) => result.ok ? result : { ...result, hint: hints[result.code ?? ""] };

export function createPortionSummaryTools<Q extends PgQueryResultHKT>(): readonly Tool<Q>[] {
  return Object.freeze([
    {
      name: "draft_portion_summary", roles: ["admin"], scope: SCOPES.study, deadlineMs: 30_000,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      description: `Save Claude's draft of one parashah's summary and a one-line outline of each of its seven aliyot, as a new revision. Nothing is shown to anyone until the rabbi approves it with approve_portion_summary; until then it is only in list_portion_summaries. The summary is prose for a twelve-year-old and an adult together (at most ${PORTION_SUMMARY_LIMITS.summaryBytes} bytes; paragraphs, emphasis and lists; no links, HTML or English verse text). The outline is exactly seven plain lines, aliyah 1 to 7 in order. A draft is never edited: a corrected text is a new revision. Show the rabbi the full text.`,
      inputSchema: closed({ reading, summary: { type: "string", maxLength: 8000, description: "The summary of the whole parashah." },
        outline: { type: "array", minItems: 7, maxItems: 7, items: { type: "string", maxLength: 400 }, description: "Seven lines, one per aliyah, in order." },
        mutationId: { type: "string", pattern: UUID_PATTERN, description: "A fresh random UUID for this draft; resending the same one replays the saved result instead of drafting twice." } },
      ["reading", "summary", "outline", "mutationId"]),
      handler: async (input, ctx) => refusal(ctx, true, false) ?? outcome(await draftSummary(summaryAuthority(ctx, "data-write"), input)),
    },
    {
      name: "list_portion_summaries", roles: ["admin"], scope: SCOPES.read, annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      description: "Portion summaries with their full text, outline, status and revision: drafts waiting for approval by default. Name a parashah to see its every revision (approved, drafts and withdrawn), or a status (draft, approved, withdrawn or all). Only an approved revision is shown to readers.",
      inputSchema: closed({ reading, status: { type: "string", enum: ["draft", "approved", "withdrawn", "all"], description: "Which revisions; default draft." } }),
      handler: async (input, ctx) => refusal(ctx, false, false) ?? outcome(await listSummaries(summaryAuthority(ctx, "read"), input)),
    },
    {
      name: "approve_portion_summary", roles: ["admin"], scope: SCOPES.study, attendedOnly: true,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      description: "Approve one draft revision, exactly as listed: it becomes the parashah's public portion summary, credited \"Rabbi Daniel Bogard\", and will show once the reading page displays summaries. Only when the rabbi has read that exact text in this conversation and says to approve it. A revision approved before it for the same parashah is withdrawn. Never from a scheduled routine.",
      inputSchema: closed({ reading, revision }, ["reading", "revision"]),
      handler: async (input, ctx) => refusal(ctx, true, true) ?? outcome(await approveSummary(summaryAuthority(ctx, "data-write"), input)),
    },
    {
      name: "withdraw_portion_summary", roles: ["admin"], scope: SCOPES.study, attendedOnly: true,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
      description: "Withdraw a revision for good: a draft is discarded; the approved one stops being public (cached answers refresh within about ten minutes). Its record is kept; draft a new revision instead. Only when the rabbi asks.",
      inputSchema: closed({ reading, revision }, ["reading", "revision"]),
      handler: async (input, ctx) => refusal(ctx, true, true) ?? outcome(await withdrawSummary(summaryAuthority(ctx, "data-write"), input)),
    },
  ] satisfies Tool<Q>[]);
}
