import { COMMENTARY_WORKS } from "./commentary";

/**
 * "More on this verse" (1.3): the texts Sefaria links to one verse, grouped and ordered by a curated list
 * kept in code (plan 2026-10-22-shelf-1-3 §3; editing a list is a one-line change). Shared by the server
 * projection, the public route and the browser parser. Titles, categories, dates and citations only: no text.
 */
export type ShelfGroupKey = "commentary" | "midrash" | "halakhah" | "talmud" | "targum" | "other";
export type ShelfItem = Readonly<{ ref: string; segments: number }>;
export type ShelfWork = Readonly<{ title: string; heTitle: string | null; dates: readonly [number, number] | null; category: string; curated: boolean;
  items: readonly ShelfItem[]; more: number }>;
export type ShelfGroup = Readonly<{ key: ShelfGroupKey; label: string; count: number; works: readonly ShelfWork[] }>;
export type ShelfAnswer = Readonly<{ verse: string; sefariaUrl: string; groups: readonly ShelfGroup[] }>;
export const SHELF_LIMITS = Object.freeze({ itemsPerWork: 50, works: 400, responseBytes: 384 * 1024, segments: 1000, title: 256, category: 128, ref: 512 });

type GroupDefinition = Readonly<{ key: ShelfGroupKey; label: string; categories: readonly string[] | null; curated: Readonly<{ torah: readonly string[]; neviim: readonly string[] }> }>;
const both = (names: readonly string[]) => Object.freeze({ torah: Object.freeze([...names]), neviim: Object.freeze([...names]) });
/** In display order; "other" takes every category the others do not. */
export const SHELF_GROUPS: readonly GroupDefinition[] = Object.freeze([
  Object.freeze({ key: "commentary", label: "Commentary", categories: Object.freeze(["Commentary"]), curated: Object.freeze({
    torah: Object.freeze(["Rashi", "Ramban", "Ibn Ezra", "Rashbam", "Sforno", "Chizkuni", "Or HaChaim", "Kli Yakar", "Shadal", "Rav Hirsch", "Radak", "The Torah; A Women's Commentary"]),
    neviim: Object.freeze(["Rashi", "Radak", "Metzudat David", "Metzudat Zion", "Malbim", "Ibn Ezra", "Abarbanel"]) }) }),
  Object.freeze({ key: "midrash", label: "Midrash", categories: Object.freeze(["Midrash"]), curated: both(["Bereshit Rabbah", "Shemot Rabbah", "Vayikra Rabbah", "Bamidbar Rabbah",
    "Devarim Rabbah", "Midrash Tanchuma", "Midrash Tanchuma Buber", "Mekhilta DeRabbi Yishmael", "Mekhilta DeRabbi Shimon Ben Yochai", "Sifra", "Sifrei Bamidbar", "Sifrei Devarim",
    "Pesikta DeRav Kahana", "Pesikta Rabbati", "Pirkei DeRabbi Eliezer"]) }),
  Object.freeze({ key: "halakhah", label: "Halakhah", categories: Object.freeze(["Halakhah"]), curated: both(["Mishneh Torah", "Shulchan Arukh", "Sefer HaChinukh", "Tur",
    "Kitzur Shulchan Arukh", "Arukh HaShulchan", "Sefer HaMitzvot"]) }),
  // Mishnah and Tosefta sit with the Talmud (Decided here 8): the Bavli first, then the Jerusalem Talmud, then Mishnah and Tosefta.
  Object.freeze({ key: "talmud", label: "Talmud", categories: Object.freeze(["Talmud", "Mishnah", "Tosefta"]), curated: both([]) }),
  Object.freeze({ key: "targum", label: "Targum", categories: Object.freeze(["Targum"]), curated: both(["Onkelos", "Targum Jonathan"]) }),
  Object.freeze({ key: "other", label: "Everything else", categories: null, curated: both([]) }),
]);
export const SHELF_GROUP_KEYS: readonly ShelfGroupKey[] = Object.freeze(SHELF_GROUPS.map(group => group.key));
export const shelfGroupLabel = (key: ShelfGroupKey) => SHELF_GROUPS.find(group => group.key === key)!.label;
export function shelfGroupOf(category: string): ShelfGroupKey {
  return SHELF_GROUPS.find(group => group.categories?.includes(category))?.key ?? "other";
}
/** A curated name matches a work's title exactly, or as its leading words ("Mishneh Torah, Sabbath", "Rashi on Genesis"). */
export const curatedMatch = (title: string, name: string) => title === name || title.startsWith(`${name},`) || title.startsWith(`${name} `);

/** Registry works (Study's inline Works) as the shelf names them, so a work already shown inline is not shown twice. */
export function inlineShelfTitles(workKey: string): readonly string[] {
  const work = COMMENTARY_WORKS[workKey];
  if (!work) return [];
  const stem = work.index.replace(/ on \{book\}$|, \{book\}$/, "");
  return [...new Set([work.title, stem, work.indexTitle.replace(/ on \{book\}$|, \{book\}$/, "")])];
}
export const isInlineWork = (shelfTitle: string, inline: readonly string[]) =>
  inline.some(key => inlineShelfTitles(key).some(name => curatedMatch(shelfTitle, name)));

/** "Composed 1246–1270", or "Composed 1270" for one year; BCE years written so. Dates of the work, not its author. */
export function compositionDates(dates: readonly [number, number] | null): string | null {
  if (!dates) return null;
  const year = (value: number) => value < 0 ? `${-value} BCE` : String(value);
  return dates[0] === dates[1] ? `Composed ${year(dates[0])}` : `Composed ${year(dates[0])}–${year(dates[1])}`;
}
/** Sefaria's page for the verse with all its connections open. */
export function shelfSefariaUrl(verse: string): string {
  const at = verse.lastIndexOf(" "), [chapter, number] = verse.slice(at + 1).split(":");
  return `https://www.sefaria.org/${verse.slice(0, at).replaceAll(" ", "_")}.${chapter}.${number}?with=all&lang=bi`;
}

/** Text a shelf item may name: Sefaria's plain citation set, ending in a numeric or daf address. */
export const SOURCE_REF_LIMITS = Object.freeze({ bytes: 256 });
const SOURCE_REF = /^[\p{L}\p{N} ,.'’()\-:;"]+ \d+[ab]?(?::\d+)*(?:-\d+[ab]?(?::\d+)*)?$/u;
export function parseSourceRef(value: unknown): string | null {
  if (typeof value !== "string" || !value || new TextEncoder().encode(value).byteLength > SOURCE_REF_LIMITS.bytes || !value.isWellFormed()) return null;
  if (value !== value.normalize("NFC") || value.trim() !== value || /\s{2}/.test(value) || !SOURCE_REF.test(value)) return null;
  return value;
}
/** Sefaria's page for a citation, optionally in one named edition. Sefaria redirects the encoded ref to its own page. */
export function sourceSefariaUrl(ref: string, edition?: Readonly<{ language: "he" | "en"; title: string }>): string {
  const url = new URL(`https://www.sefaria.org/${encodeURIComponent(ref)}`);
  if (edition) { url.searchParams.set(edition.language === "he" ? "vhe" : "ven", edition.title.replaceAll(" ", "_")); url.searchParams.set("lang", "bi"); }
  return url.href;
}
