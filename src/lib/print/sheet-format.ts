import { COMMENTARY_WORKS } from "../readings/commentary";

/**
 * The reader's print sheet format (spec 2026-10-23-reader-print-sheet-design.md): a small closed record that
 * lives in the page address, so a link reproduces the sheet exactly, and that the MCP print tool builds.
 * Every field has a default; the address carries only what differs from it, under short fixed keys.
 * Pure and dependency-free: the page, the MCP tool and the tests share it.
 */
export type SheetShow = "both" | "hebrew" | "english";
export type SheetScript = "full" | "vowels" | "letters";
export type SheetSize = "small" | "standard" | "large" | "huge";
export type SheetAliyot = "marked" | "page";
export type SheetNotes = "none" | "lined" | "blank";
export type SheetPaper = "letter" | "a4";
export type SheetOrientation = "portrait" | "landscape";
export type SheetSpacing = "normal" | "standing";
/** The English edition. JPS 2023 is the portal's one full-passage translation (MISSION ruling 12, amended 2026-10-21). */
export type SheetEdition = "jps2023";

export type SheetFormat = Readonly<{
  show: SheetShow; script: SheetScript; size: SheetSize; aliyot: SheetAliyot; numbers: boolean; notes: SheetNotes;
  paper: SheetPaper; orientation: SheetOrientation; spacing: SheetSpacing; edition: SheetEdition;
  /** The commentary works printed after the reading (registry order, no repeats); none by default. Which editions print is the licence filter's (appendix.ts). */
  commentary: readonly string[];
  /** Curated discussions' sources (1.7 M6b) printed in the same appendix, grouped by verse under each discussion's title; off by default. Sefaria editions pass the same licence filter (appendix.ts). */
  discussions: boolean;
}>;
type EnumField = Exclude<keyof SheetFormat, "commentary">;

const NO_WORKS: readonly string[] = Object.freeze([]);
export const DEFAULT_FORMAT: SheetFormat = Object.freeze({ show: "both", script: "full", size: "standard", aliyot: "marked", numbers: true, notes: "none",
  paper: "letter", orientation: "portrait", spacing: "normal", edition: "jps2023", commentary: NO_WORKS, discussions: false });

/** The registered commentary works, in registry order: the only values `commentary` takes. */
export const COMMENTARY_CHOICES: readonly string[] = Object.freeze(Object.keys(COMMENTARY_WORKS));
/** The address key for the commentary works (comma-joined, e.g. `comm=rashi,womens`). */
export const COMMENTARY_PARAM = "comm";
/** Registered works only, in registry order, without repeats. */
export function normalizeCommentary(value: readonly unknown[]): readonly string[] {
  const picked = COMMENTARY_CHOICES.filter(work => value.includes(work));
  return picked.length ? Object.freeze(picked) : NO_WORKS;
}

/** Each field's address key and allowed values, in the order the address writes them. */
const FIELDS = Object.freeze([
  ["show", "show", ["both", "hebrew", "english"]],
  ["script", "script", ["full", "vowels", "letters"]],
  ["size", "size", ["small", "standard", "large", "huge"]],
  ["aliyot", "aliyot", ["marked", "page"]],
  ["numbers", "numbers", ["on", "off"]],
  ["notes", "notes", ["none", "lined", "blank"]],
  ["paper", "paper", ["letter", "a4"]],
  ["orientation", "orient", ["portrait", "landscape"]],
  ["spacing", "spacing", ["normal", "standing"]],
  ["edition", "en", ["jps2023"]],
  ["discussions", "disc", ["on", "off"]],
] as const);
/** The two-valued fields kept as booleans: on or off in the address, true or false in the record. */
const FLAGS: readonly EnumField[] = ["numbers", "discussions"];
export const FORMAT_KEYS: readonly string[] = Object.freeze([...FIELDS.map(field => field[1]), COMMENTARY_PARAM]);
/** The values each enumerated field takes (commentary is a list of works: COMMENTARY_CHOICES). */
export const FORMAT_VALUES: Readonly<Record<EnumField, readonly string[]>> = Object.freeze(Object.fromEntries(FIELDS.map(([field, , values]) => [field, values])) as unknown as Record<EnumField, readonly string[]>);

const valueOf = (format: SheetFormat, field: EnumField) => FLAGS.includes(field) ? (format[field] ? "on" : "off") : String(format[field]);

/** A format from address parameters: unknown or malformed values fall back to the default for that field. */
export function parseFormat(params: URLSearchParams): SheetFormat {
  const out: Record<string, unknown> = { ...DEFAULT_FORMAT };
  for (const [field, key, values] of FIELDS) {
    const raw = params.get(key);
    if (raw === null || !(values as readonly string[]).includes(raw)) continue;
    out[field] = FLAGS.includes(field) ? raw === "on" : raw;
  }
  out.commentary = normalizeCommentary((params.get(COMMENTARY_PARAM) ?? "").split(",").slice(0, COMMENTARY_CHOICES.length * 2));
  return Object.freeze(out as SheetFormat);
}

/** A format from a loose record (the MCP tool's `format` argument). Returns the problems instead of guessing. */
export function formatFromRecord(value: unknown): { format: SheetFormat; problems: string[] } {
  const problems: string[] = [], out: Record<string, unknown> = { ...DEFAULT_FORMAT };
  if (value === undefined) return { format: DEFAULT_FORMAT, problems };
  if (!value || typeof value !== "object" || Array.isArray(value)) return { format: DEFAULT_FORMAT, problems: ["format must be an object"] };
  for (const [key, raw] of Object.entries(value)) {
    if (key === "commentary") {
      if (Array.isArray(raw) && raw.length <= COMMENTARY_CHOICES.length * 2 && raw.every(work => typeof work === "string" && COMMENTARY_CHOICES.includes(work))) out.commentary = normalizeCommentary(raw);
      else problems.push(`format.commentary must be a list of works from ${COMMENTARY_CHOICES.join(", ")}`);
      continue;
    }
    const field = FIELDS.find(row => row[0] === key);
    if (!field) { problems.push(`unknown format field ${key.slice(0, 40)}`); continue; }
    if (FLAGS.includes(field[0])) { if (typeof raw === "boolean") out[field[0]] = raw; else problems.push(`format.${field[0]} must be true or false`); continue; }
    if (typeof raw !== "string" || !(field[2] as readonly string[]).includes(raw)) { problems.push(`format.${key} must be one of ${field[2].join(", ")}`); continue; }
    out[field[0]] = raw;
  }
  return { format: Object.freeze(out as SheetFormat), problems };
}

/** The address parameters for a format: only the fields that differ from the default, in fixed order. */
export function formatEntries(format: SheetFormat): [string, string][] {
  const entries = FIELDS.flatMap(([field, key]) => valueOf(format, field) === valueOf(DEFAULT_FORMAT, field) ? [] : [[key, valueOf(format, field)] as [string, string]]);
  const works = normalizeCommentary(format.commentary);
  return works.length ? [...entries, [COMMENTARY_PARAM, works.join(",")]] : entries;
}

/** Print sizes in points: the Hebrew is always larger than the English, and Huge is the large-print step. */
export const SHEET_TYPE: Readonly<Record<SheetSize, Readonly<{ hebrew: number; english: number }>>> = Object.freeze({
  small: { hebrew: 15, english: 9.5 }, standard: { hebrew: 18, english: 11 }, large: { hebrew: 22, english: 13 }, huge: { hebrew: 28, english: 16 },
});

/** One plain sentence naming a format, for the MCP tool's answer (no text of the reading). */
export function describeFormat(format: SheetFormat): string {
  const script = { full: "vowels and trope", vowels: "vowels only", letters: "letters only" }[format.script];
  const what = format.show === "both" ? `Hebrew (${script}) and English (JPS 2023) side by side, Hebrew on the right`
    : format.show === "hebrew" ? `Hebrew only (${script})` : "English only (JPS 2023)";
  const size = { small: "small type", standard: "standard type", large: "large type", huge: "large print" }[format.size];
  const parts = [what, size, format.numbers ? "verse numbers" : "no verse numbers",
    format.aliyot === "page" ? "each aliyah on a new page" : "aliyot marked in the text",
    format.notes === "none" ? "no notes column" : `a ${format.notes} notes column`,
    `${format.paper === "letter" ? "US Letter" : "A4"} ${format.orientation}`];
  if (format.spacing === "standing") parts.push("extra spacing for reading standing");
  if (format.discussions) parts.push("curated discussions' sources on the same pages (only editions licensed for print, and Claude translations with their credit)");
  if (format.commentary.length) parts.push(`commentary on a new page after the reading (${format.commentary.map(work => COMMENTARY_WORKS[work]?.title ?? work).join(", ")}; only editions licensed for print)`);
  return `${parts.join(", ")}.`;
}
