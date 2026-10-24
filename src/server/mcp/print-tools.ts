import "server-only";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import { NAMED_READINGS, namedReading, type NamedReading } from "../../lib/readings/named-readings";
import { canonicalReadingRef } from "../../lib/readings/reading-ref";
import { isSaturday, publicShabbat, shabbatOnOrAfter, thisShabbat } from "../../lib/readings/public-shabbat";
import { PORTION_PICKS, portionRef, portionsOf, type PortionPick } from "../../lib/print/portions";
import { COMMENTARY_CHOICES, describeFormat, formatFromRecord, FORMAT_VALUES } from "../../lib/print/sheet-format";
import { printAddress, type PrintTarget } from "../../lib/print/print-address";
import { publicPlans, PUBLIC_CALENDAR } from "../public-reading/service";
import { SCOPES } from "./oauth";
import type { Tool } from "./tools";

/**
 * The reader's print sheet from Claude (Daniel, 2026-10-23: "selectable and creatable from the MCP"). One read-only tool:
 * it names a reading and a format and returns the sheet's link, with a plain statement of both to check before printing.
 * It never loads, returns or logs a verse: the sheet's Hebrew and its licensed English are fetched by the browser when the
 * link is opened, so no translation text passes through a tool result. This tool never reads a saved reading (only saved-tools.ts
 * may, saved-structure test): a saved reading's id is only carried into the link, and the page opens it from the signed-in member's own account.
 */
const UUID_PATTERN = "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$";
const display = (ref: string) => ref.replace(/(\d)-(\d)/g, "$1–$2");
const longDate = (date: string) => new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
const squash = (value: string) => value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "");
const kindName = (kind: "torah" | "haftarah") => kind === "torah" ? "Torah" : "Haftarah";
const PICK_NAMES: Readonly<Record<PortionPick, string>> = Object.freeze({ full: "the whole parashah", triennial: "the triennial portion", maftir: "the maftir",
  "aliyah-1": "aliyah 1", "aliyah-2": "aliyah 2", "aliyah-3": "aliyah 3", "aliyah-4": "aliyah 4", "aliyah-5": "aliyah 5", "aliyah-6": "aliyah 6", "aliyah-7": "aliyah 7" });

/** A catalog reading by slug or by name, ignoring case, spaces and punctuation ("Lech Lecha", "lech-lecha", "Lech-Lecha"). */
export function findNamedReading(value: string): NamedReading | null {
  const bySlug = namedReading(value.trim().toLowerCase());
  if (bySlug) return bySlug;
  const wanted = squash(value);
  return wanted ? NAMED_READINGS.find(reading => squash(reading.name) === wanted || squash(reading.slug) === wanted) ?? null : null;
}

type Outcome = { ok: false; problem: string } | { ok: true; target: PrintTarget; reading: Record<string, unknown> };
const refuse = (problem: string): Outcome => ({ ok: false, problem });

export function createPrintTools<Q extends PgQueryResultHKT>(): readonly Tool<Q>[] {
  return Object.freeze([{
    name: "print_sheet_link", roles: ["admin", "tutor"], scope: SCOPES.read,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    description: "A link to the reader's print sheet: the Hebrew and the JPS 2023 English side by side for reading at the Torah, in the format you choose. With no reading named, it is this coming Shabbat's Torah reading. Name at most one of parashah, ref or savedReadingId. Returns the link and a plain statement of the reading and format to check with the person before they print; it never returns verse text. The person opens the link and presses Print.",
    inputSchema: { type: "object", additionalProperties: false, properties: {
      parashah: { type: "string", maxLength: 80, description: "A parashah, special Shabbat, festival or fast from the portal's reading list, e.g. \"Noach\", \"Lech Lecha\" or \"Shabbat Shekalim\"." },
      ref: { type: "string", maxLength: 1000, description: "Any Torah or Prophets passage in Hebcal's form, segments joined by \"; \", e.g. \"Genesis 12:1-13\" or \"Isaiah 40:1-11\". Pass kind haftarah for the Prophets." },
      kind: { type: "string", enum: ["torah", "haftarah"], description: "Torah (the default) or haftarah." },
      passage: { type: "integer", minimum: 1, maximum: 64, description: "With parashah only: which passage of a reading that has several (a festival's second Torah reading or its maftir), counting from 1 in the reading list's order. Overrides kind." },
      date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "A Shabbat (YYYY-MM-DD; another day means the Shabbat on or after it), when no parashah, ref or saved reading is named. Defaults to this coming Shabbat." },
      portion: { type: "string", enum: [...PORTION_PICKS], description: "Part of that Shabbat's Torah reading: full (default), triennial, aliyah-1 to aliyah-7, or maftir." },
      savedReadingId: { type: "string", pattern: UUID_PATTERN, description: "One of the person's own saved readings, by id. This tool does not read saved readings; the sheet opens it from the person's account when they open the link signed in." },
      format: { type: "object", description: `Optional; anything left out takes its default. ${Object.entries(FORMAT_VALUES).map(([key, values]) => `${key}: ${key === "numbers" ? "true or false (default true)" : key === "discussions" ? "true or false (default false): curated discussions' sources after the commentary, only editions licensed for print" : values.join(" | ")}`).join("; ")}; commentary: a list of works to print on a new page after the reading, grouped by verse, from ${COMMENTARY_CHOICES.join(", ")} (default none). Commentary prints only editions whose stated licence is public domain, CC0, CC BY or CC BY-NC, each with its credit; the page says plainly when a work has none. Defaults: both languages, vowels and trope, standard size, aliyot marked, no notes column, US Letter portrait, normal spacing, JPS 2023, no commentary.` },
    } },
    handler: async (input, ctx) => {
      // The connection must still be live, as for every tool; nothing private is read here.
      await ctx.mcp.withLive(ctx.actor, "read", async () => null);
      const { format, problems } = formatFromRecord(input.format);
      if (problems.length) return { ok: false, problems };
      const named = [input.parashah, input.ref, input.savedReadingId].filter(value => value !== undefined);
      if (named.length > 1) return { ok: false, problems: ["Name at most one of parashah, ref and savedReadingId."] };
      const outcome = await choose(input, ctx.signal, ctx.loadReading);
      if (!outcome.ok) return { ok: false, problems: [outcome.problem] };
      return { ok: true, link: `${ctx.actor.origin}${printAddress(outcome.target, format, { today: null })}`, reading: outcome.reading, format: describeFormat(format),
        note: "The link carries no text. The page loads the Hebrew and the JPS 2023 English when it is opened, with the edition credit on every printed page; the format can still be changed there before printing."
          + (format.commentary.length ? " Chosen commentary is loaded when the page opens and printed only from editions licensed for print; the page says so beside any work with none." : "") };
    },
  }] satisfies Tool<Q>[]);
}

async function choose(input: Record<string, unknown>, signal: AbortSignal, loadReading: Parameters<Tool<PgQueryResultHKT>["handler"]>[1]["loadReading"]): Promise<Outcome> {
  const kind = (input.kind as "torah" | "haftarah" | undefined) ?? "torah", pick = (input.portion as PortionPick | undefined) ?? "full";
  const weekOnly = (what: string) => input[what] !== undefined ? `${what} applies only to a Shabbat from the calendar; leave it out with parashah, ref or savedReadingId.` : null;
  if (input.savedReadingId !== undefined) {
    const extra = ["kind", "date", "portion"].find(key => input[key] !== undefined);
    if (extra) return refuse(`${extra} does not apply to a saved reading; the reading is the one saved.`);
    return { ok: true, target: { mode: "saved", id: (input.savedReadingId as string).toLowerCase() },
      reading: { statement: "One of your own saved readings. It opens from your account when you follow the link signed in; this tool cannot see its name or verses." } };
  }
  if (input.passage !== undefined && input.parashah === undefined) return refuse("passage applies only with parashah.");
  if (input.ref !== undefined || input.parashah !== undefined) {
    const extra = weekOnly("date") ?? weekOnly("portion");
    if (extra) return refuse(extra);
  }
  if (input.ref !== undefined) {
    const canonical = canonicalReadingRef(input.ref, kind);
    if (!canonical) return refuse(kind === "torah" ? "ref is not a Torah passage in Hebcal's form (one book, in order, e.g. \"Genesis 12:1-13\"; under 1,000 verses)." : "ref is not a Prophets passage in Hebcal's form (e.g. \"Isaiah 40:1-11\"; under 1,000 verses).");
    return { ok: true, target: { mode: "ref", ref: canonical.ref, kind }, reading: { kind, passage: display(canonical.ref), verses: canonical.verses.length, statement: `${kindName(kind)}: ${display(canonical.ref)} (${canonical.verses.length} verses).` } };
  }
  if (input.parashah !== undefined) {
    const reading = findNamedReading(input.parashah as string);
    if (!reading) return refuse("No reading by that name in the portal's list. Use the parashah's usual English spelling (\"Bereshit\", \"Lech-Lecha\"), or give a ref.");
    const at = input.passage !== undefined ? (input.passage as number) - 1 : reading.passages.findIndex(row => row.kind === kind);
    if (input.passage !== undefined && !reading.passages[at]) return refuse(`${reading.name} has ${reading.passages.length} passage${reading.passages.length === 1 ? "" : "s"} in the portal's list: ${reading.passages.map((row, index) => `${index + 1} ${row.label}`).join(", ")}.`);
    if (at < 0) return refuse(`The portal's list has no ${kind} passage for ${reading.name}.`);
    const passage = reading.passages[at], verses = canonicalReadingRef(passage.ref, passage.kind)?.verses.length ?? 0;
    return { ok: true, target: { mode: "named", slug: reading.slug, passage: at + 1 },
      reading: { name: reading.name, kind: passage.kind, passage: display(passage.ref), verses, statement: `${reading.name}, ${passage.label}: ${display(passage.ref)} (${verses} verses).` } };
  }
  // A Shabbat from the calendar: this coming one unless a date is given.
  let date: string;
  if (input.date !== undefined) {
    let shabbat: string | null = null;
    try { shabbat = isSaturday(input.date as string) ? input.date as string : shabbatOnOrAfter(input.date as string); } catch { shabbat = null; }
    if (!shabbat || !publicShabbat(shabbat)) return refuse("date must be a real date within about two years back and three years ahead.");
    date = shabbat;
  } else date = thisShabbat();
  if (kind === "haftarah" && pick !== "full") return refuse("portion applies only to the Torah reading.");
  let loaded;
  try { loaded = await loadReading(date, PUBLIC_CALENDAR); } catch { return refuse("The calendar could not be read just now; try again, or name the parashah or a ref."); }
  if (signal.aborted) return refuse("The request ended before the calendar answered.");
  const snapshot = loaded.snapshot, parashah = snapshot.reading?.parashah || null, when = `Shabbat, ${longDate(date)}`;
  if (kind === "haftarah") {
    const plan = publicPlans(snapshot).haftarah;
    if (!plan) return refuse(`The calendar lists no haftarah for ${when}.`);
    const ref = plan.ranges.join("; ");
    return { ok: true, target: { mode: "week", date, kind: "haftarah", pick: "full" },
      reading: { name: parashah, date, kind, passage: display(ref), verses: plan.verses.length, statement: `${parashah ? `${parashah}, ` : ""}Haftarah: ${display(ref)} (${plan.verses.length} verses), for ${when}.` } };
  }
  const plan = publicPlans(snapshot).torah;
  if (!plan) return refuse(`The calendar lists no weekly Torah reading for ${when}. Name a parashah or give a ref instead.`);
  const ref = pick === "full" ? plan.ranges.join("; ") : portionRef(portionsOf(snapshot), pick);
  if (!ref) return refuse(`The calendar gives no ${PICK_NAMES[pick]} for ${when}.`);
  const verses = canonicalReadingRef(ref, "torah")?.verses.length ?? plan.verses.length;
  return { ok: true, target: { mode: "week", date, kind: "torah", pick },
    reading: { name: parashah, date, kind, portion: pick, passage: display(ref), verses, statement: `${parashah ? `${parashah}, ` : ""}Torah, ${PICK_NAMES[pick]}: ${display(ref)} (${verses} verses), for ${when}.` } };
}
