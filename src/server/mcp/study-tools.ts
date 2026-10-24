import "server-only";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import { readAddress, READ_VERSE_MAX, type ReadTarget } from "../../components/portal/public-reading/urls";
import { canonicalReadingRef } from "../../lib/readings/reading-ref";
import { isSaturday, publicShabbat, shabbatOnOrAfter, thisShabbat } from "../../lib/readings/public-shabbat";
import { publicPlans, PUBLIC_CALENDAR } from "../public-reading/service";
import { findNamedReading } from "./print-tools";
import { SCOPES } from "./oauth";
import type { Tool } from "./tools";

/**
 * A reading opened in Study on /read, from Claude (release 1.7 M2, PLAN-1-7 acceptance check 2). One read-only tool: it names a
 * selection in /read's own grammar (a canonical ref of up to 32 "; "-joined segments, a parashah from the reading list, a Shabbat
 * from the calendar, or one of the person's own saved readings by id) and returns the /read link with `lens=study`. It never
 * loads, returns or logs a verse: the page fetches the text when the link is opened. Saved readings stay out of the MCP
 * (saved-structure test): a saved reading's id is only carried into the link, and the page opens it from the member's account.
 */
const UUID_PATTERN = "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$";
const display = (ref: string) => ref.replace(/(\d)-(\d)/g, "$1–$2");
const longDate = (date: string) => new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
const kindName = (kind: "torah" | "haftarah") => kind === "torah" ? "Torah" : "Haftarah";

type Outcome = { ok: false; problem: string } | { ok: true; target: ReadTarget; verses: number | null; reading: Record<string, unknown> };
const refuse = (problem: string): Outcome => ({ ok: false, problem });

export function createStudyTools<Q extends PgQueryResultHKT>(): readonly Tool<Q>[] {
  return Object.freeze([{
    name: "study_link", roles: ["admin", "tutor"], scope: SCOPES.read,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    description: "A link that opens a reading in Study on the portal's reader (/read): the Hebrew with its meaning, commentary and word help, verse by verse. Name at most one of ref, parashah or savedReadingId; with none, it is this coming Shabbat's reading (or the Shabbat of date). ref may be several separate passages, joined by \"; \". Returns the link and a plain statement of the reading to check with the person; it never returns verse text. From Study the person can switch to Lein, open the whole portion, or print.",
    inputSchema: { type: "object", additionalProperties: false, properties: {
      ref: { type: "string", maxLength: 1000, description: "Any Torah or Prophets selection in Hebcal's form: up to 32 segments joined by \"; \", in order, e.g. \"Genesis 12:1-13\" or \"Genesis 1:1-5; Genesis 2:1-3\". Pass kind haftarah for the Prophets." },
      kind: { type: "string", enum: ["torah", "haftarah"], description: "Torah (the default) or haftarah." },
      parashah: { type: "string", maxLength: 80, description: "A parashah, special Shabbat, festival or fast from the portal's reading list, e.g. \"Noach\" or \"Shabbat Shekalim\"." },
      passage: { type: "integer", minimum: 1, maximum: 64, description: "With parashah only: which passage of a reading that has several, counting from 1 in the reading list's order. Overrides kind." },
      date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "A Shabbat (YYYY-MM-DD; another day means the Shabbat on or after it), when no ref, parashah or saved reading is named. Defaults to this coming Shabbat." },
      savedReadingId: { type: "string", pattern: UUID_PATTERN, description: "One of the person's own saved readings, by id. This tool does not read saved readings; the page opens it from the person's account when they follow the link signed in." },
      verse: { type: "integer", minimum: 1, maximum: READ_VERSE_MAX, description: "Optional: open with this verse of the selection selected, counting from 1 within the selection." },
    } },
    handler: async (input, ctx) => {
      // The connection must still be live, as for every tool; nothing private is read here.
      await ctx.mcp.withLive(ctx.actor, "read", async () => null);
      const named = [input.ref, input.parashah, input.savedReadingId].filter(value => value !== undefined);
      if (named.length > 1) return { ok: false, problems: ["Name at most one of ref, parashah and savedReadingId."] };
      const outcome = await choose(input, ctx.signal, ctx.loadReading);
      if (!outcome.ok) return { ok: false, problems: [outcome.problem] };
      const verse = input.verse as number | undefined;
      if (verse !== undefined && outcome.verses !== null && verse > outcome.verses) return { ok: false, problems: [`verse must be from 1 to ${outcome.verses}, within the selection.`] };
      return { ok: true, link: `${ctx.actor.origin}${readAddress(outcome.target, { today: null, verse: verse ?? null, study: true })}`, reading: outcome.reading,
        note: "The link carries no text. The page loads the Hebrew and the English when it is opened, in Study; Lein and the whole portion are a tap away there. For a printed copy, use print_sheet_link." };
    },
  }] satisfies Tool<Q>[]);
}

async function choose(input: Record<string, unknown>, signal: AbortSignal, loadReading: Parameters<Tool<PgQueryResultHKT>["handler"]>[1]["loadReading"]): Promise<Outcome> {
  const kind = (input.kind as "torah" | "haftarah" | undefined) ?? "torah";
  if (input.passage !== undefined && input.parashah === undefined) return refuse("passage applies only with parashah.");
  if (input.date !== undefined && (input.ref !== undefined || input.parashah !== undefined || input.savedReadingId !== undefined))
    return refuse("date applies only to a Shabbat from the calendar; leave it out with ref, parashah or savedReadingId.");
  if (input.savedReadingId !== undefined) {
    if (input.kind !== undefined) return refuse("kind does not apply to a saved reading; the reading is the one saved.");
    return { ok: true, target: { mode: "saved", id: (input.savedReadingId as string).toLowerCase() }, verses: null,
      reading: { statement: "One of your own saved readings. It opens from your account when you follow the link signed in; this tool cannot see its name or verses." } };
  }
  if (input.ref !== undefined) {
    const canonical = canonicalReadingRef(input.ref, kind);
    if (!canonical) return refuse(kind === "torah"
      ? "ref is not a Torah selection in Hebcal's form (one book, in order, segments joined by \"; \", at most 32, e.g. \"Genesis 12:1-13\"; under 1,000 verses)."
      : "ref is not a Prophets selection in Hebcal's form (segments joined by \"; \", at most 32, e.g. \"Isaiah 40:1-11\"; under 1,000 verses).");
    return { ok: true, target: { mode: "ref", ref: canonical.ref, kind }, verses: canonical.verses.length,
      reading: { kind, passage: display(canonical.ref), segments: canonical.segments.length, verses: canonical.verses.length, statement: `${kindName(kind)}: ${display(canonical.ref)} (${canonical.verses.length} verses).` } };
  }
  if (input.parashah !== undefined) {
    const reading = findNamedReading(input.parashah as string);
    if (!reading) return refuse("No reading by that name in the portal's list. Use the parashah's usual English spelling (\"Bereshit\", \"Lech-Lecha\"), or give a ref.");
    const at = input.passage !== undefined ? (input.passage as number) - 1 : reading.passages.findIndex(row => row.kind === kind);
    if (input.passage !== undefined && !reading.passages[at]) return refuse(`${reading.name} has ${reading.passages.length} passage${reading.passages.length === 1 ? "" : "s"} in the portal's list: ${reading.passages.map((row, index) => `${index + 1} ${row.label}`).join(", ")}.`);
    if (at < 0) return refuse(`The portal's list has no ${kind} passage for ${reading.name}.`);
    const passage = reading.passages[at], verses = canonicalReadingRef(passage.ref, passage.kind)?.verses.length ?? null;
    return { ok: true, target: { mode: "named", slug: reading.slug, passage: at + 1 }, verses,
      reading: { name: reading.name, kind: passage.kind, passage: display(passage.ref), verses, statement: `${reading.name}, ${passage.label}: ${display(passage.ref)}${verses === null ? "" : ` (${verses} verses)`}.` } };
  }
  // A Shabbat from the calendar: this coming one unless a date is given.
  let date: string;
  if (input.date !== undefined) {
    let shabbat: string | null = null;
    try { shabbat = isSaturday(input.date as string) ? input.date as string : shabbatOnOrAfter(input.date as string); } catch { shabbat = null; }
    if (!shabbat || !publicShabbat(shabbat)) return refuse("date must be a real date within about two years back and three years ahead.");
    date = shabbat;
  } else date = thisShabbat();
  let loaded;
  try { loaded = await loadReading(date, PUBLIC_CALENDAR); } catch { return refuse("The calendar could not be read just now; try again, or name the parashah or a ref."); }
  if (signal.aborted) return refuse("The request ended before the calendar answered.");
  const snapshot = loaded.snapshot, parashah = snapshot.reading?.parashah || null, when = `Shabbat, ${longDate(date)}`;
  const plan = publicPlans(snapshot)[kind];
  if (!plan) return refuse(kind === "torah" ? `The calendar lists no weekly Torah reading for ${when}. Name a parashah or give a ref instead.` : `The calendar lists no haftarah for ${when}.`);
  const ref = plan.ranges.join("; ");
  return { ok: true, target: { mode: "week", date, kind }, verses: plan.verses.length,
    reading: { name: parashah, date, kind, passage: display(ref), verses: plan.verses.length, statement: `${parashah ? `${parashah}, ` : ""}${kindName(kind)}: ${display(ref)} (${plan.verses.length} verses), for ${when}.` } };
}
