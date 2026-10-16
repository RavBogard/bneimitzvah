import { PortalRequestError } from "../../api";
import { identifier } from "../api";
import { adminRequest, flag, invalid, record } from "../relationships/api";

export const CSV_HEADER = "firstName,lastName,ceremonyDate,parentEmail,ownEmail";
export const CSV_ADULT_HEADER = "studentKind,firstName,lastName,ceremonyDate,parentEmail,ownEmail";
export const REVIEW_TTL = 5 * 60_000;
export type Preview = { validRows: number; issues: { row: number; code: "invalid-row" | "invalid-columns" }[]; duplicateRows: number[]; requiresDuplicateConfirmation: boolean; canConfirm: boolean; binding: string | null };
function count(value: unknown, min = 0, max = 500): number { if (!Number.isSafeInteger(value) || Number(value) < min || Number(value) > max) return invalid(); return Number(value); }
export function checkCsvSize(csv: string, allowDuplicates: boolean, binding?: string) {
  if (!csv.length) throw new PortalRequestError(400);
  const bytes = new TextEncoder();
  if (bytes.encode(csv).length > 1024 * 1024 || bytes.encode(JSON.stringify({ csv, allowDuplicates, ...(binding ? { binding } : {}) })).length > 2 * 1024 * 1024) throw new PortalRequestError(413);
}
export function parsePreview(value: unknown, allowDuplicates: boolean): Preview {
  const r = record(value, ["validRows", "issues", "duplicateRows", "requiresDuplicateConfirmation", "canConfirm", "binding"]);
  const validRows = count(r.validRows), requiresDuplicateConfirmation = flag(r.requiresDuplicateConfirmation), canConfirm = flag(r.canConfirm);
  if (!Array.isArray(r.issues) || r.issues.length > 500 || !Array.isArray(r.duplicateRows) || r.duplicateRows.length > validRows) return invalid();
  const issues: Preview["issues"] = r.issues.map(value => { const row = record(value, ["row", "code"]); if (row.code !== "invalid-row" && row.code !== "invalid-columns") return invalid(); return { row: count(row.row, 2, 501), code: row.code }; });
  const duplicateRows = r.duplicateRows.map(value => count(value, 2, 501));
  if (new Set(issues.map(row => row.row)).size !== issues.length || new Set(duplicateRows).size !== duplicateRows.length || duplicateRows.some(row => issues.some(issue => issue.row === row)) || validRows + issues.length < 1 || validRows + issues.length > 500
    || requiresDuplicateConfirmation !== (duplicateRows.length > 0) || canConfirm !== (issues.length === 0 && (!requiresDuplicateConfirmation || allowDuplicates))) return invalid();
  if (canConfirm ? typeof r.binding !== "string" || r.binding.length > 48000 || !/^v1\.[A-Za-z0-9_-]+$/.test(r.binding) : r.binding !== null) return invalid();
  return { validRows, issues, duplicateRows, requiresDuplicateConfirmation, canConfirm, binding: r.binding as string | null };
}
export const csvApi = {
  async preview(csv: string, allowDuplicates: boolean, signal?: AbortSignal) { checkCsvSize(csv, allowDuplicates); return parsePreview(await adminRequest("/api/admin/students/import/preview", { csv, allowDuplicates }, signal), allowDuplicates); },
  async confirm(csv: string, allowDuplicates: boolean, preview: Preview) {
    if (!preview.canConfirm || !preview.binding) throw new PortalRequestError(400);
    checkCsvSize(csv, allowDuplicates, preview.binding);
    const row = record(await adminRequest("/api/admin/students/import/confirm", { csv, allowDuplicates, binding: preview.binding }), ["ok", "ids"]);
    if (row.ok !== true || !Array.isArray(row.ids) || row.ids.length !== preview.validRows) return invalid();
    const ids = row.ids.map(identifier); if (new Set(ids).size !== ids.length) return invalid(); return ids;
  },
};
