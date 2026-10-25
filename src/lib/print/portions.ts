import { selectTorah, type Leyning, type Pick } from "../readings/leyning.mjs";
import { canonicalReadingRef } from "../readings/reading-ref";
import type { Snapshot } from "../readings/proposals";

/**
 * A Shabbat's Torah portions for the reader's print sheet: the calendar's full-kriyah aliyot and the triennial
 * year's aliyot, as Hebcal gives them (CC BY 4.0), numbers and book names only. Shared by the public
 * `/api/public/aliyot` route, the page that parses its answer, and the MCP print tool. Each aliyah's ref is
 * canonical (reading-ref.ts) or the aliyah is left out; nothing here reads a text.
 */
export type PortionAliyah = Readonly<{ n: string; ref: string }>;
export type WeekPortions = Readonly<{ date: string; parashah: string | null; full: readonly PortionAliyah[]; triennial: Readonly<{ year: number | null; aliyot: readonly PortionAliyah[] }> | null }>;
/** What part of the week's Torah reading to print. `full` is the whole parashah, as /read shows it. */
export type PortionPick = "full" | "triennial" | "maftir" | `aliyah-${1 | 2 | 3 | 4 | 5 | 6 | 7}`;
export const PORTION_PICKS: readonly PortionPick[] = Object.freeze(["full", "triennial", "aliyah-1", "aliyah-2", "aliyah-3", "aliyah-4", "aliyah-5", "aliyah-6", "aliyah-7", "maftir"]);
export const isPortionPick = (value: unknown): value is PortionPick => typeof value === "string" && (PORTION_PICKS as readonly string[]).includes(value);

const N = /^(?:[1-7]|M)$/;
function rows(value: readonly { n: number | string; ref: string }[]): PortionAliyah[] {
  const seen = new Set<string>(), out: PortionAliyah[] = [];
  for (const row of value) {
    const n = String(row.n);
    if (!N.test(n) || seen.has(n) || !canonicalReadingRef(row.ref, "torah")) continue;
    seen.add(n); out.push(Object.freeze({ n, ref: row.ref }));
  }
  return out;
}

/** A calendar snapshot's portions; a Shabbat with no regular weekly reading has none. */
export function portionsOf(snapshot: Snapshot): WeekPortions {
  const reading = snapshot.classification === "regular" ? snapshot.reading : null;
  const year = reading?.triennial?.year;
  return Object.freeze({
    date: snapshot.date, parashah: snapshot.reading?.parashah || null,
    full: Object.freeze(reading ? rows(reading.aliyot) : []),
    triennial: reading?.triennial ? Object.freeze({ year: year === 1 || year === 2 || year === 3 ? year : null, aliyot: Object.freeze(rows(reading.triennial.aliyot)) }) : null,
  });
}

const plain = (value: unknown, keys: readonly string[]): Record<string, unknown> | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const own = Object.keys(value);
  return own.length === keys.length && own.every(key => keys.includes(key)) ? value as Record<string, unknown> : null;
};
function parseRows(value: unknown): PortionAliyah[] | null {
  if (!Array.isArray(value) || value.length > 8) return null;
  const out: PortionAliyah[] = [];
  for (const raw of value) {
    const row = plain(raw, ["n", "ref"]);
    if (!row || typeof row.n !== "string" || !N.test(row.n) || !canonicalReadingRef(row.ref, "torah") || out.some(item => item.n === row.n)) return null;
    out.push(Object.freeze({ n: row.n, ref: row.ref as string }));
  }
  return out;
}
/** The public route's answer, strictly; null for anything else. */
export function parsePortions(value: unknown, date: string): WeekPortions | null {
  const row = plain(value, ["date", "parashah", "full", "triennial"]);
  if (!row || row.date !== date || row.parashah !== null && (typeof row.parashah !== "string" || row.parashah.length > 160)) return null;
  const full = parseRows(row.full);
  if (!full) return null;
  let triennial: WeekPortions["triennial"] = null;
  if (row.triennial !== null) {
    const t = plain(row.triennial, ["year", "aliyot"]), aliyot = t && parseRows(t.aliyot);
    if (!t || !aliyot || t.year !== null && t.year !== 1 && t.year !== 2 && t.year !== 3) return null;
    triennial = Object.freeze({ year: t.year as number | null, aliyot: Object.freeze(aliyot) });
  }
  return Object.freeze({ date, parashah: row.parashah as string | null, full: Object.freeze(full), triennial });
}

const leyningOf = (portions: WeekPortions): Leyning => ({ parashah: portions.parashah ?? "", type: "shabbat", summary: "", source: "Hebcal",
  aliyot: portions.full.map(row => ({ n: row.n === "M" ? "M" as const : Number(row.n), ref: row.ref })),
  triennial: portions.triennial && { year: portions.triennial.year, aliyot: portions.triennial.aliyot.map(row => ({ n: row.n === "M" ? "M" as const : Number(row.n), ref: row.ref })) } });
const pickOf = (pick: PortionPick): Pick => pick === "full" || pick === "triennial" ? { kind: pick } : pick === "maftir" ? { kind: "aliyah", from: "M", to: "M" }
  : { kind: "aliyah", from: Number(pick.slice(7)), to: Number(pick.slice(7)) };

/** Whether the calendar gives this pick for the week. */
export function portionAvailable(portions: WeekPortions, pick: PortionPick): boolean { return portionRef(portions, pick) !== null; }
/** The canonical Torah ref a pick names for the week, or null when the calendar does not give it. */
export function portionRef(portions: WeekPortions, pick: PortionPick): string | null {
  if (!portions.full.length) return null;
  try { const ref = selectTorah(leyningOf(portions), pickOf(pick)).ref; return canonicalReadingRef(ref, "torah")?.ref ?? null; } catch { return null; }
}

/**
 * Where each aliyah of the printed verses begins: verse ref → its label number ("1" to "7", or "M" for the maftir).
 * A triennial pick uses the triennial year's aliyot; everything else uses the full-kriyah aliyot. An aliyah whose
 * first verse is not printed has no marker; the maftir is marked where it begins inside the printed verses.
 */
export function aliyahStartsIn(portions: WeekPortions, pick: PortionPick, verses: readonly string[]): ReadonlyMap<string, string> {
  const all = pick === "triennial" ? portions.triennial?.aliyot ?? [] : portions.full, printed = new Set(verses), out = new Map<string, string>();
  // Printing the maftir alone, its label wins where it begins on the same verse as an aliyah.
  const set = pick === "maftir" ? [...all.filter(row => row.n === "M"), ...all.filter(row => row.n !== "M")] : all;
  for (const row of set) {
    const first = canonicalReadingRef(row.ref, "torah")?.verses[0];
    if (first && printed.has(first) && !out.has(first)) out.set(first, row.n);
  }
  return out;
}

/** What each pick is called, on the print sheet's Portion control and on /read's (the same words in both). */
export const PORTION_LABELS: Readonly<Record<PortionPick, string>> = Object.freeze({ full: "Full calendar portion", triennial: "Triennial portion", maftir: "Maftir",
  "aliyah-1": "Aliyah 1", "aliyah-2": "Aliyah 2", "aliyah-3": "Aliyah 3", "aliyah-4": "Aliyah 4", "aliyah-5": "Aliyah 5", "aliyah-6": "Aliyah 6", "aliyah-7": "Aliyah 7" });
/** A pick's label, with the triennial year when the calendar names it ("Triennial portion (year 2)"). */
export const portionLabel = (pick: PortionPick, portions: WeekPortions | null): string =>
  pick === "triennial" && portions?.triennial?.year ? `${PORTION_LABELS[pick]} (year ${portions.triennial.year})` : PORTION_LABELS[pick];
/** The picks a week offers, in the control's order: the whole portion always, the rest only where the calendar gives them (a festival Saturday gives none). */
export const portionPicks = (portions: WeekPortions | null): readonly PortionPick[] =>
  PORTION_PICKS.filter(pick => pick === "full" || (portions !== null && portionRef(portions, pick) !== null));
