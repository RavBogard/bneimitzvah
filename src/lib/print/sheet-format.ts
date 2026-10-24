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
}>;

export const DEFAULT_FORMAT: SheetFormat = Object.freeze({ show: "both", script: "full", size: "standard", aliyot: "marked", numbers: true, notes: "none",
  paper: "letter", orientation: "portrait", spacing: "normal", edition: "jps2023" });

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
] as const);
export const FORMAT_KEYS: readonly string[] = Object.freeze(FIELDS.map(field => field[1]));
export const FORMAT_VALUES: Readonly<Record<keyof SheetFormat, readonly string[]>> = Object.freeze(Object.fromEntries(FIELDS.map(([field, , values]) => [field, values])) as unknown as Record<keyof SheetFormat, readonly string[]>);

const valueOf = (format: SheetFormat, field: keyof SheetFormat) => field === "numbers" ? (format.numbers ? "on" : "off") : String(format[field]);

/** A format from address parameters: unknown or malformed values fall back to the default for that field. */
export function parseFormat(params: URLSearchParams): SheetFormat {
  const out: Record<string, unknown> = { ...DEFAULT_FORMAT };
  for (const [field, key, values] of FIELDS) {
    const raw = params.get(key);
    if (raw === null || !(values as readonly string[]).includes(raw)) continue;
    out[field] = field === "numbers" ? raw === "on" : raw;
  }
  return Object.freeze(out as SheetFormat);
}

/** A format from a loose record (the MCP tool's `format` argument). Returns the problems instead of guessing. */
export function formatFromRecord(value: unknown): { format: SheetFormat; problems: string[] } {
  const problems: string[] = [], out: Record<string, unknown> = { ...DEFAULT_FORMAT };
  if (value === undefined) return { format: DEFAULT_FORMAT, problems };
  if (!value || typeof value !== "object" || Array.isArray(value)) return { format: DEFAULT_FORMAT, problems: ["format must be an object"] };
  for (const [key, raw] of Object.entries(value)) {
    const field = FIELDS.find(row => row[0] === key);
    if (!field) { problems.push(`unknown format field ${key.slice(0, 40)}`); continue; }
    if (field[0] === "numbers") { if (typeof raw === "boolean") out.numbers = raw; else problems.push("format.numbers must be true or false"); continue; }
    if (typeof raw !== "string" || !(field[2] as readonly string[]).includes(raw)) { problems.push(`format.${key} must be one of ${field[2].join(", ")}`); continue; }
    out[field[0]] = raw;
  }
  return { format: Object.freeze(out as SheetFormat), problems };
}

/** The address parameters for a format: only the fields that differ from the default, in fixed order. */
export function formatEntries(format: SheetFormat): [string, string][] {
  return FIELDS.flatMap(([field, key]) => valueOf(format, field) === valueOf(DEFAULT_FORMAT, field) ? [] : [[key, valueOf(format, field)] as [string, string]]);
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
  return `${parts.join(", ")}.`;
}
