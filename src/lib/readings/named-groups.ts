import { NAMED_READINGS, type NamedReading } from "./named-readings";
import { canonicalReadingRef, joinReadingRef } from "./reading-ref";
import { parseRange } from "./leyning.mjs";
import { TORAH_BOOKS } from "./ranges";

/**
 * The catalog's readings in the groups the Readings index and the old chooser drew (kept out of named-readings.ts, which is generated
 * and not edited by hand). The parashiyot under their Torah book in Torah order; the occasions in calendar order.
 */
export const OCCASIONS: readonly { group: NamedReading["group"]; label: string }[] = [
  { group: "special", label: "Special Shabbatot" }, { group: "festival", label: "Festivals" }, { group: "fast", label: "Fast days" }];
export function parashotByBook(): readonly { book: string; readings: readonly NamedReading[] }[] {
  return TORAH_BOOKS.map(book => ({ book, readings: NAMED_READINGS.filter(reading => reading.group === "parashah" && parseRange(reading.passages[0].ref)?.book === book) }));
}
/** A custom passage from the pickers (one line per passage) → its canonical ref, or null. */
export function customRef(lines: string, kind: "torah" | "haftarah"): string | null {
  const segments = lines.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (!segments.length) return null;
  return canonicalReadingRef(joinReadingRef(segments), kind)?.ref ?? null;
}
