import { NAMED_READINGS } from "./named-readings";
import { parseRange } from "./leyning.mjs";
import { expandReadingRanges, readingSegments, type VerseCounts } from "./ranges";
import { haftarahRefForKey, readingKeyFor } from "./reading-key";

/**
 * Every study-guide key CRC's rite can read, derived from the generated named-readings catalog (Hebcal, diaspora) and the one
 * reading-key function; nothing here is a hand-written list. A Torah key is the reading's Hebcal name, slugged, and covers every
 * Torah passage of it (aliyot and maftir), as `assignmentReadingKey` expects. A haftarah key is the passage itself, so a passage
 * read in several weeks is one entry that lists the other readings it serves in `alsoFor`.
 *
 * Special Shabbatot add no Torah key: their maftir is read with the week's own parashah, whose key already covers it.
 */
export type CatalogGroup = "Genesis" | "Exodus" | "Leviticus" | "Numbers" | "Deuteronomy" | "special" | "holiday";
export type CatalogEntry = Readonly<{
  kind: "torah" | "haftarah"; readingKey: string; name: string; group: CatalogGroup; verseCount: number; alsoFor: readonly string[];
}>;
export type CatalogUnresolved = Readonly<{ kind: "torah" | "haftarah"; name: string; reason: string }>;

const HOLIDAY_GROUPS = new Set(["festival", "fast"]);

export function guideCatalogEntries(counts: VerseCounts): { entries: CatalogEntry[]; unresolved: CatalogUnresolved[] } {
  const entries: CatalogEntry[] = [], unresolved: CatalogUnresolved[] = [], byKey = new Map<string, { index: number; also: string[] }>();
  for (const reading of NAMED_READINGS) {
    const book = parseRange(reading.passages[0]?.ref ?? "")?.book;
    const group: CatalogGroup = reading.group === "parashah" ? (book as CatalogGroup) : HOLIDAY_GROUPS.has(reading.group) ? "holiday" : "special";
    const torah = reading.passages.filter(p => p.kind === "torah"), haftarah = reading.passages.filter(p => p.kind === "haftarah");
    if (reading.group !== "special" && torah.length) {
      const key = readingKeyFor({ kind: "torah", parashah: reading.name });
      let count = 0;
      try { count = torah.reduce((n, p) => n + expandReadingRanges(readingSegments(p.ref), "torah", counts).length, 0); } catch { count = 0; }
      if (!key) unresolved.push({ kind: "torah", name: reading.name, reason: "no reading key" });
      else if (!count) unresolved.push({ kind: "torah", name: reading.name, reason: "no verses in the catalog" });
      else entries.push(Object.freeze({ kind: "torah", readingKey: key, name: reading.name, group, verseCount: count, alsoFor: Object.freeze([]) }));
    }
    for (const passage of haftarah) {
      const key = readingKeyFor({ kind: "haftarah", haftarahRef: passage.ref });
      const back = key ? haftarahRefForKey(key, counts) : null;
      let count = 0;
      try { count = back ? expandReadingRanges(readingSegments(back), "haftarah", counts).length : 0; } catch { count = 0; }
      if (!key || !back || !count) { unresolved.push({ kind: "haftarah", name: reading.name, reason: !key ? "no reading key" : "haftarahRefForKey does not return verses" }); continue; }
      const seen = byKey.get(key);
      if (seen) { seen.also.push(reading.name); continue; }
      byKey.set(key, { index: entries.length, also: [] });
      entries.push(Object.freeze({ kind: "haftarah", readingKey: key, name: reading.name, group, verseCount: count, alsoFor: Object.freeze([]) }));
    }
  }
  for (const { index, also } of byKey.values()) if (also.length) entries[index] = Object.freeze({ ...entries[index], alsoFor: Object.freeze(also) });
  return { entries, unresolved };
}
