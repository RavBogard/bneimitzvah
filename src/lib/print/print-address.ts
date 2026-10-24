import { parseReadAddress, readAddress, type ReadTarget } from "../../components/portal/public-reading/urls";
import { isPortionPick, type PortionPick } from "./portions";
import { TANAKH_VERSE_COUNTS } from "../readings/catalog";
import { hebcalRef } from "../readings/leyning.mjs";
import { canonicalReadingRef, joinReadingRef } from "../readings/reading-ref";
import { DEFAULT_FORMAT, formatEntries, parseFormat, type SheetFormat } from "./sheet-format";

/**
 * The reader's print sheet address. The reading is named exactly as on /read (urls.ts: a Shabbat `date` and
 * `kind`, a catalog `reading` and `passage`, a canonical `ref` and `kind`, or a member's `saved` id), plus
 * `pick` for part of a Shabbat's Torah reading (portions.ts). The format follows (sheet-format.ts). With no
 * parameters at all it is this coming Shabbat's Torah reading in the default format.
 */
export const PRINT_PATH = "/print";
export type PrintTarget = Exclude<ReadTarget, { mode: "week" }> | Readonly<{ mode: "week"; date: string | null; kind: "torah" | "haftarah" | null; pick: PortionPick }>;
export type PrintAddress = Readonly<{ target: PrintTarget | null; format: SheetFormat }>;

export function parsePrintAddress(search: string): PrintAddress {
  let params: URLSearchParams;
  try { params = new URLSearchParams(search); } catch { return { target: null, format: DEFAULT_FORMAT }; }
  const format = parseFormat(params), read = parseReadAddress(search).target;
  if (!read) return { target: null, format };
  if (read.mode !== "week") return { target: read, format };
  const pick = params.get("pick"), torah = read.kind !== "haftarah";
  return { target: Object.freeze({ mode: "week", date: read.date, kind: read.kind, pick: torah && isPortionPick(pick) ? pick : "full" }), format };
}

/** The address of a sheet. `today` (this Shabbat) is left out of the address, as /read does; pass null to always name the date. */
export function printAddress(target: PrintTarget, format: SheetFormat = DEFAULT_FORMAT, options: { today?: string | null } = {}): string {
  const read: ReadTarget = target.mode === "week" ? { mode: "week", date: target.date, kind: target.kind } : target;
  const entries = [...new URLSearchParams(readAddress(read, { today: options.today }).split("?")[1] ?? "").entries()];
  if (target.mode === "week" && target.kind !== "haftarah" && target.pick !== "full") entries.push(["pick", target.pick]);
  entries.push(...formatEntries(format));
  const query = new URLSearchParams(entries).toString();
  return query ? `${PRINT_PATH}?${query}` : PRINT_PATH;
}

/** A /read address (what the reading chooser opens) as a print target, keeping nothing but the reading. */
export function printTargetFromRead(address: string): PrintTarget | null {
  const search = address.includes("?") ? address.slice(address.indexOf("?")) : "";
  return parsePrintAddress(search).target;
}

/**
 * A reading's ordered verse list as one canonical ref (Hebcal's form, contiguous runs joined by "; "), so an assigned reading,
 * whatever form its stored ranges take, opens on the print sheet; null when the verses cannot be named that way.
 */
export function refFromVerses(verses: readonly string[], kind: "torah" | "haftarah"): string | null {
  const parts = verses.map(ref => { const m = /^(.+) ([1-9]\d*):([1-9]\d*)$/.exec(ref); return m ? { book: m[1], chapter: Number(m[2]), verse: Number(m[3]) } : null; });
  if (!parts.length || parts.some(part => part === null)) return null;
  const runs: { book: string; from: [number, number]; to: [number, number] }[] = [];
  for (const part of parts as { book: string; chapter: number; verse: number }[]) {
    const run = runs.at(-1), count = run ? TANAKH_VERSE_COUNTS[run.book]?.[run.to[0] - 1] : undefined;
    const follows = run !== undefined && run.book === part.book && (part.chapter === run.to[0] && part.verse === run.to[1] + 1 || part.chapter === run.to[0] + 1 && part.verse === 1 && run.to[1] === count);
    if (follows) run.to = [part.chapter, part.verse]; else runs.push({ book: part.book, from: [part.chapter, part.verse], to: [part.chapter, part.verse] });
  }
  const ref = joinReadingRef(runs.map(run => hebcalRef({ k: run.book, b: run.from.join(":"), e: run.to.join(":") })));
  const canonical = canonicalReadingRef(ref, kind);
  return canonical && canonical.verses.length === verses.length && canonical.verses.every((verse, index) => verse === verses[index]) ? canonical.ref : null;
}
