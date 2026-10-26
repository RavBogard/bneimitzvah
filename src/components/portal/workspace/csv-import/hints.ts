import { parseCeremonyDate } from "../../../../lib/readings/ranges";
import { CSV_ADULT_HEADER, CSV_FULL_ADULT_HEADER, CSV_FULL_HEADER, CSV_HEADER } from "./api";

// Explanations only. The server's preview stays the authority on what can be imported; these
// helpers mirror its rules so a refused row can name the columns to fix. They never echo a cell.
/**
 * The template's example line (G21): a made-up student showing the shape of a row. A draft that still holds it is refused
 * before anything is sent, so the example can never become a record.
 */
export const CSV_EXAMPLE_ROW = ["child", "Example", "Student", "2027-05-08", "parent@example.test", "", "morning", "", "", "", "", "", "", "", "Delete this example line"].join(",");
export const CSV_TEMPLATE = CSV_FULL_ADULT_HEADER + "\r\n" + CSV_EXAMPLE_ROW + "\r\n";
const HEADERS = [CSV_HEADER, CSV_ADULT_HEADER, CSV_FULL_HEADER, CSV_FULL_ADULT_HEADER];
const COLUMN_NAMES: Record<string, string> = {
  studentKind: "student kind (child or adult)", firstName: "first name", lastName: "last name", ceremonyDate: "ceremony date (YYYY-MM-DD, for example 2027-05-08)",
  parentEmail: "parent email", ownEmail: "student email", service_slot: "service slot (morning, havdalah or unknown)", parent2_email: "second parent email",
  parent1_name: "parent name", parent2_name: "second parent name", household_phone: "phone", parashah: "parashah", tutor: "tutor", hebrew_name: "Hebrew name", notes: "notes",
};
const LIMITS: Record<string, number> = { parent1_name: 400, parent2_name: 400, household_phone: 100, parashah: 400, tutor: 400, hebrew_name: 400, notes: 4096 };

/** Splits CSV into records as the server does; null when quoting is malformed. */
export function csvRecords(csv: string): string[][] | null {
  const records: string[][] = []; let row: string[] = [], cell = "", quoted = false, closed = false;
  const finishCell = () => { row.push(cell); cell = ""; closed = false; };
  const finishRow = () => { finishCell(); records.push(row); row = []; };
  for (let i = 0; i < csv.length; i++) {
    const char = csv[i];
    if (quoted) { if (char === '"') { if (csv[i + 1] === '"') { cell += '"'; i++; } else { quoted = false; closed = true; } } else cell += char; continue; }
    if (char === '"') { if (cell !== "" || closed) return null; quoted = true; continue; }
    if (char === ",") { finishCell(); continue; }
    if (char === "\r" || char === "\n") { if (char === "\r" && csv[i + 1] === "\n") i++; finishRow(); continue; }
    if (closed) return null;
    cell += char;
  }
  if (quoted) return null;
  if (cell !== "" || row.length || closed) finishRow();
  return records;
}

/** Why a draft can't be previewed at all, before anything is sent; null when it can. */
export function draftProblem(csv: string): string | null {
  const records = csvRecords(csv);
  if (!records) return "A quoted value isn’t closed. Check for a stray quotation mark, then preview again.";
  if (!HEADERS.includes(records[0]?.join(",") ?? "")) return csv.startsWith("﻿") || records[0]?.join(",").startsWith("﻿")
    ? "The file starts with a hidden byte-order mark. Save it as plain CSV (UTF-8 without BOM) or paste the rows here, then preview again."
    : "The first line must be the column names from the template, exactly as written. Keep the template’s first line and put one student on each line below it.";
  if (records.length < 2) return "Add at least one student below the column names.";
  if (records.slice(1).some(record => record.join(",") === CSV_EXAMPLE_ROW)) return "The template's example line is still in the list. Delete it, then preview again.";
  return null;
}

const join = (items: string[]) => items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
const email = (value: string) => value.length <= 254 && /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(value.trim());
const blank = (value: string | undefined) => value === undefined || !value.trim();

/** One plain sentence per refused row, naming the columns to check. Rows it can't explain are left out. */
export function rowHints(csv: string): Map<number, string> {
  const records = csvRecords(csv), hints = new Map<number, string>();
  if (!records || records.length < 2) return hints;
  const [header, ...rows] = records, full = header.includes("service_slot"), bytes = new TextEncoder();
  rows.forEach((record, index) => {
    const row = index + 2;
    if (record.length !== header.length) { hints.set(row, `this line has ${record.length} ${record.length === 1 ? "column" : "columns"}, but the column names have ${header.length}. Check for a missing or extra comma; put commas inside a value in quotation marks.`); return; }
    const raw = Object.fromEntries(header.map((key, at) => [key, record[at]])), fields = new Set<string>();
    header.forEach((key, at) => { if (key !== "notes" && /[\x00-\x1f\x7f-\x9f]/.test(record[at])) fields.add(key); });
    const kind = raw.studentKind ?? "child";
    if (kind !== "child" && kind !== "adult") fields.add("studentKind");
    for (const key of ["firstName", "lastName"]) if (blank(raw[key]) || raw[key].trim().length > 100 || /[<>]/.test(raw[key])) fields.add(key);
    try { parseCeremonyDate(raw.ceremonyDate); } catch { fields.add("ceremonyDate"); }
    const contact = (key: string, required: boolean) => { if (blank(raw[key])) { if (required) fields.add(key); } else if (!email(raw[key])) fields.add(key); };
    contact("parentEmail", kind === "child"); contact("ownEmail", kind === "adult"); if (full) contact("parent2_email", false);
    // A blank slot imports as unknown, like the other optional columns.
    if (full && !blank(raw.service_slot) && !["morning", "havdalah", "unknown"].includes(raw.service_slot.trim())) fields.add("service_slot");
    for (const [key, limit] of Object.entries(LIMITS)) if (raw[key] !== undefined && (bytes.encode(raw[key].trim()).length > limit || /[<>]/.test(raw[key]))) fields.add(key);
    const own = raw.ownEmail?.trim().toLowerCase(), same = !blank(own) && [raw.parentEmail, raw.parent2_email].some(value => !blank(value) && value.trim().toLowerCase() === own);
    const named = [...fields].sort((a, b) => header.indexOf(a) - header.indexOf(b)).map(key => COLUMN_NAMES[key] ?? key);
    if (same && !fields.has("ownEmail")) named.push("student email, which must be different from the parent emails");
    if (named.length) hints.set(row, `check the ${join(named)}.`);
  });
  return hints;
}

const quoteCell = (cell: string) => /[",\r\n]/.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell;
const serialize = (rows: string[][]) => rows.map(row => row.map(quoteCell).join(",")).join("\r\n") + "\r\n";

/**
 * Splits a reviewed draft in two by spreadsheet row number (the column names are row 1): the rows to import now, and the rest,
 * which stay in the draft to fix. Both keep the column names; blank lines are dropped. Null when the draft can't be read.
 */
export function splitDraft(csv: string, importRows: ReadonlySet<number>): { ready: string; readyCount: number; rest: string } | null {
  const records = csvRecords(csv);
  if (!records || records.length < 2) return null;
  const [header, ...rows] = records, ready: string[][] = [], rest: string[][] = [];
  rows.forEach((record, index) => {
    if (importRows.has(index + 2)) ready.push(record);
    else if (!(record.length === 1 && !record[0].trim())) rest.push(record);
  });
  return { ready: ready.length ? serialize([header, ...ready]) : "", readyCount: ready.length, rest: rest.length ? serialize([header, ...rest]) : "" };
}

/** Every data row's number, in spreadsheet numbering. */
export function dataRowNumbers(csv: string): number[] {
  const records = csvRecords(csv);
  return records ? records.slice(1).map((_, index) => index + 2) : [];
}

type Named = { firstName: string; lastName: string; ceremonyDate: string };
const nameKey = (first: string, last: string, date: string) =>
  [first, last].map(value => value.trim().replace(/\s+/g, " ").toLocaleLowerCase()).concat(date.trim()).join("\u0000");
/**
 * Rows whose first name, last name and ceremony date match a student already on the roster or an earlier row (G21). Exact
 * duplicates and refused rows are the server's to report, so they are skipped here. A warning only: it never blocks an import.
 */
export function sameNameAndDateRows(csv: string, roster: readonly Named[], skip: ReadonlySet<number>): number[] {
  const records = csvRecords(csv);
  if (!records || records.length < 2) return [];
  const [header, ...rows] = records, at = (key: string) => header.indexOf(key);
  const [first, last, date] = [at("firstName"), at("lastName"), at("ceremonyDate")];
  if (first < 0 || last < 0 || date < 0) return [];
  const seen = new Set(roster.map(row => nameKey(row.firstName, row.lastName, row.ceremonyDate))), found: number[] = [];
  rows.forEach((record, index) => {
    if (record.length !== header.length) return;
    const key = nameKey(record[first], record[last], record[date]), row = index + 2;
    if (!skip.has(row) && seen.has(key)) found.push(row);
    seen.add(key);
  });
  return found;
}

/** "Row 3" or "Rows 3, 4 and 7". */
export function rowList(rows: readonly number[]): string {
  return rows.length === 1 ? `Row ${rows[0]}` : `Rows ${join(rows.map(String))}`;
}
