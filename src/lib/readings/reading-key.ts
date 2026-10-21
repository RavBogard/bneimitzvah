import { parseRange } from "./leyning.mjs";
import { expandReadingRanges, type VerseCounts } from "./ranges";
import type { Snapshot } from "./proposals";

/**
 * The one place a study-guide reading key is made.
 *
 * Torah: the Hebcal English name of the week's reading, slugged with the haftarah library's own
 * rule (site/app/parashot.js `keyOf`), so "Vayakhel-Pekudei" → "vayakhel-pekudei" and
 * "Ha'azinu" → "haazinu" match the library's page keys.
 *
 * Haftarah: the passage actually read, never the parashah, because on special Shabbatot Hebcal
 * returns a different haftarah than the parashah's own. "I Kings 8:1-21" → "i-kings-8-1-8-21";
 * both endpoints are always spelled so one passage has exactly one key.
 */
export type ReadingKeyInput = { kind: "torah"; parashah: string } | { kind: "haftarah"; haftarahRef: string };

const MAX_INPUT = 160;
const slug = (text: string) => text.toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export function readingKeyFor(input: ReadingKeyInput): string | null {
  if (input.kind === "torah") {
    if (typeof input.parashah !== "string" || input.parashah.length > MAX_INPUT) return null;
    const key = slug(input.parashah);
    return key || null;
  }
  if (input.kind !== "haftarah" || typeof input.haftarahRef !== "string" || input.haftarahRef.length > MAX_INPUT) return null;
  const range = parseRange(input.haftarahRef);
  if (!range) return null;
  const [c1, v1] = range.from, [c2, v2] = range.to;
  if (c2 < c1 || (c1 === c2 && v2 < v1)) return null;
  const book = slug(range.book);
  return book ? `${book}-${c1}-${v1}-${c2}-${v2}` : null;
}

/** True when every assigned verse lies inside the passage's ranges. Never throws. */
export function versesInside(assigned: readonly string[], passageRanges: readonly string[], kind: "torah" | "haftarah", counts: VerseCounts): boolean {
  if (!Array.isArray(assigned) || assigned.length === 0 || !Array.isArray(passageRanges) || passageRanges.length === 0) return false;
  let passage: Set<string>;
  try {
    // Aliyot are contiguous within a book but a maftir may sit elsewhere, so expand each range on its own.
    passage = new Set(passageRanges.flatMap(ref => expandReadingRanges([ref], kind, counts)));
  } catch { return false; }
  return assigned.every(verse => passage.has(verse));
}

/**
 * The key a confirmed assignment carries: set only when the snapshot has a calendar reading and every
 * assigned verse is inside that week's passage (all Torah aliyot including maftir, or the haftarah
 * actually read). Otherwise null: no base guide, nothing said.
 */
export function assignmentReadingKey(snapshot: Snapshot | null | undefined, kind: "torah" | "haftarah", verses: readonly string[], counts: VerseCounts): string | null {
  if (!snapshot || typeof snapshot !== "object") return null;
  if (kind === "torah") {
    const reading = snapshot.reading;
    if (!reading || !Array.isArray(reading.aliyot)) return null;
    const ranges = reading.aliyot.map(row => row?.ref).filter((ref): ref is string => typeof ref === "string");
    if (ranges.length !== reading.aliyot.length || !versesInside(verses, ranges, "torah", counts)) return null;
    return readingKeyFor({ kind: "torah", parashah: reading.parashah });
  }
  if (kind !== "haftarah" || typeof snapshot.haftarah !== "string" || !versesInside(verses, [snapshot.haftarah], "haftarah", counts)) return null;
  return readingKeyFor({ kind: "haftarah", haftarahRef: snapshot.haftarah });
}
