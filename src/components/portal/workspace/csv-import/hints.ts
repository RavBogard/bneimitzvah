import { parseCeremonyDate } from "../../../../lib/readings/ranges";
import { CSV_ADULT_HEADER, CSV_FULL_ADULT_HEADER, CSV_FULL_HEADER, CSV_HEADER } from "./api";

// Explanations only. The server's preview stays the authority on what can be imported; these
// helpers mirror its rules so a refused row can name the columns to fix. They never echo a cell.
export const CSV_TEMPLATE = CSV_FULL_ADULT_HEADER + "\r\n";
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
    if (full && !["morning", "havdalah", "unknown"].includes(raw.service_slot.trim())) fields.add("service_slot");
    for (const [key, limit] of Object.entries(LIMITS)) if (raw[key] !== undefined && (bytes.encode(raw[key].trim()).length > limit || /[<>]/.test(raw[key]))) fields.add(key);
    const own = raw.ownEmail?.trim().toLowerCase(), same = !blank(own) && [raw.parentEmail, raw.parent2_email].some(value => !blank(value) && value.trim().toLowerCase() === own);
    const named = [...fields].sort((a, b) => header.indexOf(a) - header.indexOf(b)).map(key => COLUMN_NAMES[key] ?? key);
    if (same && !fields.has("ownEmail")) named.push("student email, which must be different from the parent emails");
    if (named.length) hints.set(row, `check the ${join(named)}.`);
  });
  return hints;
}
