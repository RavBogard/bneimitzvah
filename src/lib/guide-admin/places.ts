import { NAMED_READINGS } from "../readings/named-readings";
import { readingKeyFor } from "../readings/reading-key";
import { canonicalReadingRef } from "../readings/reading-ref";

/**
 * Where a piece of study content belongs on the admin's Guides page, and where a reader sees it: the named reading (in the catalog's
 * calendar order) and its public Study address. Pure lookups over the shipped catalog; nothing here reads a database.
 */
export type ReadingPlace = Readonly<{ slug: string; name: string; order: number; passage: number }>;

type Kind = "torah" | "haftarah";
let guideKeys: Map<string, ReadingPlace> | null = null;
let verses: Record<Kind, Map<string, ReadingPlace>> | null = null;

function placeOf(index: number, passage: number): ReadingPlace {
  const reading = NAMED_READINGS[index];
  return Object.freeze({ slug: reading.slug, name: reading.name, order: index, passage });
}
function keys(): Map<string, ReadingPlace> {
  if (guideKeys) return guideKeys;
  const map = new Map<string, ReadingPlace>();
  NAMED_READINGS.forEach((reading, index) => {
    reading.passages.forEach((passage, i) => {
      // A special Shabbat's Torah is the week's own parashah, which already owns the key (guide-catalog.ts).
      if (passage.kind === "torah" && reading.group === "special") return;
      const key = passage.kind === "torah" ? readingKeyFor({ kind: "torah", parashah: reading.name }) : readingKeyFor({ kind: "haftarah", haftarahRef: passage.ref });
      if (key && !map.has(`${passage.kind}:${key}`)) map.set(`${passage.kind}:${key}`, placeOf(index, i + 1));
    });
  });
  return guideKeys = map;
}
function verseMaps(): Record<Kind, Map<string, ReadingPlace>> {
  if (verses) return verses;
  const torah = new Map<string, ReadingPlace>(), haftarah = new Map<string, ReadingPlace>();
  NAMED_READINGS.forEach((reading, index) => reading.passages.forEach((passage, i) => {
    const target = passage.kind === "torah" ? torah : haftarah;
    for (const verse of canonicalReadingRef(passage.ref, passage.kind)?.verses ?? []) if (!target.has(verse)) target.set(verse, placeOf(index, i + 1));
  }));
  return verses = { torah, haftarah };
}

/** The reading a base guide's key belongs to: the first catalog reading that reads it. */
export const placeOfGuide = (kind: Kind, readingKey: string): ReadingPlace | null => keys().get(`${kind}:${readingKey}`) ?? null;
/** A portion summary's key is a parashah slug. */
export function placeOfSummary(readingKey: string): ReadingPlace | null {
  const index = NAMED_READINGS.findIndex(reading => reading.slug === readingKey);
  return index < 0 ? null : placeOf(index, 1);
}
/** A discussion belongs to the first reading that holds the verse its first source is anchored to. */
export const placeOfVerse = (kind: Kind, verse: string): ReadingPlace | null => verseMaps()[kind].get(verse) ?? null;
/** The public Study page for that reading's passage. */
export function studyAddress(place: ReadingPlace): string {
  const query = new URLSearchParams({ reading: place.slug });
  if (place.passage !== 1) query.set("passage", String(place.passage));
  query.set("lens", "study");
  return `/read?${query.toString()}`;
}
