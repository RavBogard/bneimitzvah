import "server-only";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import { readAddress } from "../../components/portal/public-reading/urls";
import { printAddress } from "../../lib/print/print-address";
import { createMcpSavedReadings, MCP_SAVED_UUID_PATTERN, type McpSavedOutcome, type McpSavedReading } from "../saved/mcp";
import { SCOPES } from "./oauth";
import { MCP_PICKS, resolvePick } from "./portion-reading";
import type { Tool, ToolContext } from "./tools";

/**
 * The person's own saved readings, from Claude (release 1.7 M4; MISSION 2026-10-23, "Existing MCP users"). Four tools, for
 * the admin or tutor a connection acts for, on a connection they approved themselves: never a scheduled routine. The owner is
 * always the connection's own membership (src/server/saved/mcp.ts binds it); no argument names a person. Staff reach only
 * their own readings, exactly as anyone else would. A result carries a reading's name, date, ranges and counts, and the links
 * that open it in Study or on the print sheet; never verse text, and never the person's notes, translations or marks.
 * This is the only MCP file that may import the saved layer, and only src/server/saved/mcp (a structural test holds this).
 */
const display = (ref: string) => ref.replace(/(\d)-(\d)/g, "$1–$2");
const id = { type: "string", pattern: MCP_SAVED_UUID_PATTERN, description: "The reading's id, from list_saved_readings." };
const name = { type: "string", maxLength: 200, description: "The reading's name, 1 to 80 characters, e.g. \"Noach, second aliyah\"." };
const date = { type: ["string", "null"], maxLength: 10, description: "Optional: the date the reading is for (YYYY-MM-DD), or null for none." };
const ranges = { type: "string", maxLength: 1000, description: "The verses in Hebcal's form: up to 32 segments joined by \"; \", in order, within the Torah or within the Prophets, e.g. \"Genesis 12:1-13\" or \"Genesis 1:1-5; Genesis 2:1-3\"." };
const portion = { type: "string", maxLength: 80, description: "Instead of ranges: a weekly parashah by its usual English name, e.g. \"Vayera\". With pick it names one part of that portion (\"aliyah 4 of Vayera\" is portion \"Vayera\", pick \"aliyah-4\"); the server looks up the verses on the portal's own calendar, so no ranges need looking up. get_reading lists a portion's aliyot." };
const pick = { type: "string", enum: [...MCP_PICKS], description: "Instead of ranges: which part of the portion (or of this coming Shabbat's reading when no portion is named): full (default), aliyah-1 to aliyah-7, maftir, triennial, triennial-aliyah-1 to triennial-aliyah-7, or haftarah." };
const closed = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });

const described = (origin: string, reading: McpSavedReading) => {
  const target = { mode: "saved" as const, id: reading.id };
  return { ...reading, passage: display(reading.ranges),
    statement: `${reading.name}: ${reading.kind === "torah" ? "Torah" : "Haftarah"}, ${display(reading.ranges)} (${reading.verseCount} verse${reading.verseCount === 1 ? "" : "s"})${reading.date ? `, for ${reading.date}` : ""}.`,
    studyLink: `${origin}${readAddress(target, { today: null, study: true })}`, printLink: `${origin}${printAddress(target, undefined, { today: null })}` };
};
const HINTS: Readonly<Record<string, string>> = Object.freeze({
  conflict: "The reading changed since your last read (in the portal or another conversation): current is how it stands now. Show the person, then resend with its revision if they still want the change.",
  limit: "The person already keeps the most saved readings an account may hold. They can remove one in the portal first.",
  "no-change": "Name at least one of name, date or ranges to change.",
  "mutation-reused": "That mutationId already made a different reading. Use a fresh random UUID for each new reading; resend the same one only to repeat the same create.",
  invalid: "Fix the listed problems and resend.",
});
const answer = (origin: string, outcome: McpSavedOutcome) => {
  if (outcome.ok) return { ok: true, ...(outcome.replayed ? { replayed: true } : {}), reading: described(origin, outcome.reading) };
  return { ...outcome, ...("current" in outcome ? { current: described(origin, outcome.current) } : {}), hint: HINTS[outcome.code] };
};
/**
 * `portion` and `pick`, when given, stand in for `ranges`: they become the calendar's verse range through the one resolver the
 * study tools share (portion-reading.ts, public calendar data only). A person's own reading is never read or named here.
 */
async function byPortion<Q extends PgQueryResultHKT>(input: Record<string, unknown>, ctx: ToolContext<Q>, create: boolean): Promise<{ input: Record<string, unknown> } | { refused: unknown }> {
  const named = input.portion !== undefined || input.pick !== undefined;
  const invalid = (problem: string) => ({ refused: { ok: false, code: "invalid", problems: [problem], hint: HINTS.invalid } });
  if (!named) return create && input.ranges === undefined ? invalid("Give ranges, or name a portion and a pick.") : { input };
  if (input.ranges !== undefined) return invalid("Give ranges, or a portion and a pick, not both.");
  // With no portion, a pick resolves against the Shabbat of the reading's own date when one is given (not this week's).
  const on = input.portion === undefined && typeof input.date === "string" ? input.date : undefined;
  const picked = await resolvePick({ portion: input.portion, pick: input.pick, kind: input.kind, date: on }, ctx.signal, ctx.loadReading);
  if (!picked.ok) return invalid(picked.problem);
  const { portion: _portion, pick: _pick, ...rest } = input;
  return { input: { ...rest, ranges: picked.ref, ...create ? { kind: picked.kind, date: input.date === undefined ? picked.date : input.date } : {} } };
}
const ROUTINE = Object.freeze({ ok: false, code: "channel-not-permitted", hint: "A scheduled routine cannot reach saved readings. They open only on a connection the person approved for themselves." });

export function createSavedTools<Q extends PgQueryResultHKT>(): readonly Tool<Q>[] {
  const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
  // A tool exists only for an attended admin or tutor connection; the binding refuses any other on every call as well.
  const base = { roles: ["admin", "tutor"] as const, scope: SCOPES.read, attendedOnly: true as const };
  const own = (ctx: ToolContext<Q>) => createMcpSavedReadings<Q>(ctx.mcp);
  return Object.freeze([
    {
      ...base, name: "list_saved_readings", annotations: readOnly,
      description: "Your own saved readings in the portal: the person this connection acts for, and no one else (staff included). Each has its id, name, date, kind, ranges, verse count, revision, and links that open it in Study or on the print sheet. Newest date first; at most 100. Never verse text, notes or translations.",
      inputSchema: closed({}),
      handler: async (_input, ctx) => {
        if (ctx.actor.unattended) return ROUTINE;
        const listed = await own(ctx).list(ctx.actor, ctx.signal);
        return { readings: listed.readings.map(reading => described(ctx.actor.origin, reading)), total: listed.total };
      },
    },
    {
      ...base, name: "open_saved_reading", annotations: readOnly,
      description: "One of your own saved readings by id: its name, date, kind, ranges, verse count and revision, with the link that opens it in Study (Lein and the whole portion are a tap away there) and the print sheet link. It never returns verse text, notes or translations; the page loads the text when the person opens the link signed in.",
      inputSchema: closed({ id }, ["id"]),
      handler: async (input, ctx) => ctx.actor.unattended ? ROUTINE : answer(ctx.actor.origin, await own(ctx).open(ctx.actor, ctx.signal, input.id)),
    },
    {
      ...base, name: "create_saved_reading", annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      description: "Save a new reading to your own account, only when the person asks for it: a name, the verses (ranges, or a portion and a pick such as aliyah 4 of Vayera) and an optional date (a portion's own Shabbat when left out). kind is optional; without it the ranges say which. Pass a fresh mutationId: resending the same create returns the reading it made (replayed: true) instead of saving twice; a mutationId reused for a different reading is refused. Show the person the reading it states.",
      inputSchema: closed({ name, ranges, portion, pick, kind: { type: "string", enum: ["torah", "haftarah"], description: "Optional: torah or haftarah. Without it, the corpus the ranges name." }, date,
        mutationId: { type: "string", pattern: MCP_SAVED_UUID_PATTERN, description: "A fresh random UUID for this create; resending it returns the same reading instead of saving a second." } }, ["name", "mutationId"]),
      handler: async (input, ctx) => {
        if (ctx.actor.unattended) return ROUTINE;
        const chosen = await byPortion(input, ctx, true);
        return "refused" in chosen ? chosen.refused : answer(ctx.actor.origin, await own(ctx).create(ctx.actor, ctx.signal, chosen.input));
      },
    },
    {
      ...base, name: "revise_saved_reading", annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
      description: "Change one of your own saved readings, only when the person asks: its name, its date (null clears it) or its verses (ranges, or a portion and a pick, within the same corpus; the verse count is recounted). Anything left out stays as it is. Pass the revision from your last read; on conflict, current shows how it stands now. The person's own work on verses a revision drops is kept and returns with the verse.",
      inputSchema: closed({ id, revision: { type: "integer", minimum: 1, maximum: 2147483646, description: "The reading's revision from your last read." }, name, date, ranges, portion, pick }, ["id", "revision"]),
      handler: async (input, ctx) => {
        if (ctx.actor.unattended) return ROUTINE;
        const chosen = await byPortion(input, ctx, false);
        return "refused" in chosen ? chosen.refused : answer(ctx.actor.origin, await own(ctx).revise(ctx.actor, ctx.signal, chosen.input));
      },
    },
  ] satisfies Tool<Q>[]);
}
