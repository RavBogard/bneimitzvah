import "server-only";
import { NAMED_READINGS, type NamedReading } from "../../lib/readings/named-readings";
import { canonicalReadingRef } from "../../lib/readings/reading-ref";
import { isSaturday, publicShabbat, shabbatOnOrAfter, addDays, thisShabbat } from "../../lib/readings/public-shabbat";
import { PORTION_PICKS, portionRef, portionsOf, type PortionPick } from "../../lib/print/portions";
import type { Calendar, Snapshot } from "../../lib/readings/proposals";
import { publicPlans, PUBLIC_CALENDAR } from "../public-reading/service";
import { findNamedReading, PICK_NAMES } from "./print-tools";

/**
 * One way for the MCP to turn "aliyah 4 of Vayera" into a reading (release 1.9 N25). It reuses the calendar the reader's own
 * pickers use: the app's Hebcal reader (loadReading), the portions of a Shabbat (lib/print/portions: portionsOf and portionRef)
 * and the reader's pick words. It finds the Shabbat a parashah is read on by asking that same calendar, never from a second
 * table of aliyot. Public data only: the calendar's refs and numbers, never a verse, never anything of a person's.
 */
export const TRIENNIAL_ALIYAH_PICKS = Object.freeze([1, 2, 3, 4, 5, 6, 7].map(n => `triennial-aliyah-${n}` as const));
/** The words the MCP's `pick` takes: the reader's own (full, triennial, aliyah-1 to aliyah-7, maftir), one triennial aliyah, or the haftarah. */
export const MCP_PICKS = Object.freeze([...PORTION_PICKS, ...TRIENNIAL_ALIYAH_PICKS, "haftarah"] as const);
export type McpPick = typeof MCP_PICKS[number];
export const isMcpPick = (value: unknown): value is McpPick => typeof value === "string" && (MCP_PICKS as readonly string[]).includes(value);

type LoadReading = (date: string, calendar: Calendar) => Promise<{ snapshot: Snapshot; fetchedAt: number }>;
const display = (ref: string) => ref.replace(/(\d)-(\d)/g, "$1–$2");
const longDate = (date: string) => new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
const squash = (value: string) => value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "");

// The weekly parashiyot in Torah order, with the combined ones (two names joined by a hyphen) set aside as the weeks that cover two.
const WEEKLY = NAMED_READINGS.filter(row => row.group === "parashah");
const KNOWN = new Set(WEEKLY.map(row => squash(row.name)));
const partsOf = (row: NamedReading) => row.name.split("-").length >= 2 && row.name.split("-").every(part => KNOWN.has(squash(part))) ? row.name.split("-") : null;
const SEPARATE = WEEKLY.filter(row => partsOf(row) === null);
const placeOf = (name: string): readonly [number, number] | null => {
  const wanted = squash(name), row = WEEKLY.find(item => squash(item.name) === wanted);
  if (!row) return null;
  const parts = partsOf(row);
  if (!parts) { const at = SEPARATE.findIndex(item => item.slug === row.slug); return at < 0 ? null : [at, at]; }
  const first = SEPARATE.findIndex(item => squash(item.name) === squash(parts[0])), last = SEPARATE.findIndex(item => squash(item.name) === squash(parts.at(-1)!));
  return first < 0 || last < 0 ? null : [first, last];
};
const MAX_PROBES = 12;

export type Week = Readonly<{ date: string; snapshot: Snapshot }>;
export type WeekOutcome = Readonly<{ ok: true; week: Week }> | Readonly<{ ok: false; problem: string }>;
const refuse = (problem: string) => Object.freeze({ ok: false as const, problem });
const NO_CALENDAR = "The calendar could not be read just now; try again, or give a ref.";

/** The Shabbat on or after `date` (this coming Shabbat when none), with the calendar's snapshot for it. */
export async function weekOf(date: string | undefined, signal: AbortSignal, loadReading: LoadReading): Promise<WeekOutcome> {
  let shabbat: string | null;
  if (date === undefined) shabbat = thisShabbat();
  else { try { shabbat = isSaturday(date) ? date : shabbatOnOrAfter(date); } catch { shabbat = null; } if (!shabbat || !publicShabbat(shabbat)) return refuse("date must be a real date within about two years back and three years ahead."); }
  try { const loaded = await loadReading(shabbat, PUBLIC_CALENDAR); if (signal.aborted) return refuse("The request ended before the calendar answered."); return Object.freeze({ ok: true, week: Object.freeze({ date: shabbat, snapshot: loaded.snapshot }) }); }
  catch { return refuse(NO_CALENDAR); }
}

/**
 * The next Shabbat a weekly parashah is read, found by asking the calendar. Each probe is a Shabbat's calendar answer; the next
 * probe jumps at least as far ahead as the Torah order allows (a week advances one parashah, or two when combined), so it
 * never steps past the answer and takes about ten asks at most. A parashah read only inside a combined week says so and stops.
 */
export async function weekOfPortion(reading: NamedReading, signal: AbortSignal, loadReading: LoadReading): Promise<WeekOutcome> {
  const target = placeOf(reading.name);
  if (reading.group !== "parashah" || !target) return refuse(`${reading.name} is not a weekly parashah, so it has no aliyot of its own to name. Use parashah for its passages, or give a ref.`);
  let date = thisShabbat();
  for (let probe = 0; probe < MAX_PROBES; probe++) {
    if (!publicShabbat(date)) return refuse("That parashah is not read within the calendar the portal covers; give a ref.");
    let snapshot: Snapshot;
    try { snapshot = (await loadReading(date, PUBLIC_CALENDAR)).snapshot; } catch { return refuse(NO_CALENDAR); }
    if (signal.aborted) return refuse("The request ended before the calendar answered.");
    const name = snapshot.reading?.parashah ?? "", here = snapshot.classification === "regular" && name ? placeOf(name) : null;
    if (here && squash(name) === squash(reading.name)) return Object.freeze({ ok: true, week: Object.freeze({ date, snapshot }) });
    if (here && here[0] <= target[0] && target[0] <= here[1]) return refuse(`${reading.name} is read together with its neighbour as ${name} on ${longDate(date)}, with no aliyot of its own that week. Name ${name} as the portion.`);
    if (!here) { date = addDays(date, 7); continue; }
    const ahead = ((target[0] - here[1]) % SEPARATE.length + SEPARATE.length) % SEPARATE.length;
    date = addDays(date, 7 * Math.max(1, Math.ceil(ahead / 2)));
  }
  return refuse(`Could not place ${reading.name} on the calendar just now; give a date or a ref.`);
}

/** The week a request names: a portion's next Shabbat, or the Shabbat of a date (this coming one by default). */
export async function weekFor(input: { portion?: unknown; date?: unknown }, signal: AbortSignal, loadReading: LoadReading): Promise<WeekOutcome> {
  if (input.portion === undefined) return weekOf(input.date as string | undefined, signal, loadReading);
  const reading = findNamedReading(input.portion as string);
  if (!reading) return refuse("No reading by that name in the portal's list. Use the parashah's usual English spelling (\"Bereshit\", \"Vayera\", \"Lech-Lecha\").");
  return weekOfPortion(reading, signal, loadReading);
}

export type PickedReading = Readonly<{
  ok: true; date: string; parashah: string | null; kind: "torah" | "haftarah"; pick: McpPick; ref: string; verses: number; wholeVerses: number;
  /** The reader's own pick word for the link; null when the link names the passage itself (a haftarah, a triennial aliyah). */
  readerPick: PortionPick | null; statement: string;
}>;

/**
 * A pick of a week: the Torah portions as the reader's own pickers give them (portionRef), one triennial aliyah, or the haftarah.
 * `kind` (when given) must agree with the pick. Refused plainly when the calendar gives no such part that week.
 */
export function pickFromWeek(week: Week, pick: McpPick, kind: "torah" | "haftarah" | undefined): PickedReading | { ok: false; problem: string } {
  const { date, snapshot } = week, parashah = snapshot.reading?.parashah || null, when = `Shabbat, ${longDate(date)}`, lead = parashah ? `${parashah}, ` : "";
  const wantKind = pick === "haftarah" ? "haftarah" : "torah";
  if (kind !== undefined && kind !== wantKind) return refuse(pick === "haftarah" ? "pick haftarah is the Prophets; kind torah does not fit it." : `pick ${pick} is the Torah; for the Prophets pass pick haftarah.`);
  const plans = publicPlans(snapshot);
  if (pick === "haftarah") {
    if (!plans.haftarah) return refuse(`The calendar lists no haftarah for ${when}.`);
    const ref = plans.haftarah.ranges.join("; ");
    return Object.freeze({ ok: true, date, parashah, kind: "haftarah", pick, ref, verses: plans.haftarah.verses.length, wholeVerses: plans.haftarah.verses.length, readerPick: null,
      statement: `${lead}Haftarah: ${display(ref)} (${plans.haftarah.verses.length} verses), for ${when}.` });
  }
  if (!plans.torah) return refuse(`The calendar lists no weekly Torah reading for ${when}. Name a parashah or give a ref instead.`);
  const portions = portionsOf(snapshot), triennial = pick.startsWith("triennial-aliyah-");
  const ref = triennial ? portions.triennial?.aliyot.find(row => row.n === pick.slice(-1))?.ref ?? null : pick === "full" ? plans.torah.ranges.join("; ") : portionRef(portions, pick as PortionPick);
  const verses = ref ? canonicalReadingRef(ref, "torah")?.verses.length ?? null : null;
  if (!ref || verses === null) return refuse(`The calendar gives no ${triennial ? `triennial aliyah ${pick.slice(-1)}` : PICK_NAMES[pick as PortionPick].replace(/^the /, "")} for ${when}.`);
  const whole = pick === "triennial" || triennial ? verses : plans.torah.verses.length;
  const year = (pick === "triennial" || triennial) && portions.triennial?.year ? ` (year ${portions.triennial.year})` : "";
  return Object.freeze({ ok: true, date, parashah, kind: "torah", pick, ref: canonicalReadingRef(ref, "torah")!.ref, verses, wholeVerses: whole, readerPick: triennial ? null : pick as PortionPick,
    statement: `${lead}Torah, ${triennial ? `triennial aliyah ${pick.slice(-1)}` : PICK_NAMES[pick as PortionPick]}${year}: ${display(ref)} (${verses} verses), for ${when}.` });
}

/** `portion` and `pick` (either, both or neither) to a picked reading: the portion's Shabbat (or this coming one), then the pick (the whole portion by default). */
export async function resolvePick(input: { portion?: unknown; pick?: unknown; kind?: unknown; date?: unknown }, signal: AbortSignal, loadReading: LoadReading): Promise<PickedReading | { ok: false; problem: string }> {
  const week = await weekFor(input, signal, loadReading);
  if (!week.ok) return week;
  const pick = (input.pick as McpPick | undefined) ?? (input.kind === "haftarah" ? "haftarah" : "full");
  return pickFromWeek(week.week, pick, input.kind as "torah" | "haftarah" | undefined);
}
