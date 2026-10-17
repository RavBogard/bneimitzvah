import { PortalRequestError } from "../../api";
import { identifier, type ReadingMode, type Selection } from "../api";
import type { PracticeTarget } from "../../../../lib/practice-calendar/types";

// Dates only: the calendar never asks for raw practice events, and never sends a play or record report.
export type PracticeDates = { studentId: string; mode: ReadingMode; serverDay: string; fromDate: string; throughDate: string; dates: string[] };
export type PracticeOperation = { type: "calendar"; fromDate: string; throughDate: string }
  | { type: "visit"; eventId: string; expectedDay: string; target: PracticeTarget };
export type PracticeAck = { practiceDay: string };
export class PracticeCalendarError extends PortalRequestError {
  constructor(status: number, public readonly code?: "stale-day" | "stale-material" | "retention-expired") { super(status); }
}
const bad = (): never => { throw new PracticeCalendarError(503); };
function object(value: unknown, keys: string[]) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key))) return bad();
  return value as Record<string, unknown>;
}

/** Whole days since 1970-01-01 for a valid YYYY-MM-DD in years 0001–9999. setUTCFullYear avoids the 0–99 year shortcut. */
export function dayOrdinal(value: unknown): number {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return bad();
  const [year, month, day] = value.split("-").map(Number); if (year < 1) return bad();
  const date = new Date(0); date.setUTCFullYear(year, month - 1, day);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return bad();
  return Math.round(date.getTime() / 86_400_000);
}
export function dayString(ordinal: number): string {
  const date = new Date(ordinal * 86_400_000), year = date.getUTCFullYear();
  if (!Number.isSafeInteger(ordinal) || year < 1 || year > 9999) return bad();
  return `${String(year).padStart(4, "0")}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

export function parsePracticeDates(value: unknown, mode: ReadingMode, studentId: string, fromDate: string, throughDate: string): PracticeDates {
  const row = object(value, ["ok", "studentId", "mode", "serverDay", "dates"]);
  if (row.ok !== true || row.studentId !== studentId || row.mode !== mode || !Array.isArray(row.dates) || row.dates.length > 366) return bad();
  const today = dayOrdinal(row.serverDay), from = dayOrdinal(fromDate), through = dayOrdinal(throughDate);
  let previous = -Infinity;
  const dates = row.dates.map(date => { const ordinal = dayOrdinal(date); if (ordinal <= previous || ordinal < from || ordinal > through || ordinal > today) return bad(); previous = ordinal; return date as string; });
  return { studentId, mode, serverDay: row.serverDay as string, fromDate, throughDate, dates };
}
export function parsePracticeAck(value: unknown, expectedDay: string): PracticeAck {
  const row = object(value, ["ok", "practiceDay"]);
  if (row.ok !== true || row.practiceDay !== expectedDay) return bad();
  return { practiceDay: expectedDay };
}

export async function fetchPracticeCalendar(mode: ReadingMode, studentId: string, operation: PracticeOperation, signal: AbortSignal, selection?: Selection): Promise<PracticeDates | PracticeAck> {
  if ((mode === "child-practice") !== Boolean(selection) || selection && selection.context.studentId !== studentId) return bad();
  const write = operation.type === "visit"; if (write && mode !== "student" && mode !== "child-practice") return bad();
  const base = `/api/students/${identifier(studentId)}`;
  const url = write ? `${base}/practice-events` : `${base}/practice-calendar?${new URLSearchParams({ mode, fromDate: operation.fromDate, throughDate: operation.throughDate })}`;
  const controller = new AbortController(), abort = () => controller.abort();
  if (signal.aborted) abort(); signal.addEventListener("abort", abort, { once: true }); const timer = setTimeout(abort, 12_000);
  try {
    const headers = new Headers({ accept: "application/json" }); if (selection) headers.set("X-Practice-Context", selection.handle);
    if (write) headers.set("content-type", "application/json");
    const body = write ? JSON.stringify({ mode, eventId: identifier(operation.eventId), expectedDay: operation.expectedDay, action: "visit", target: operation.target }) : undefined;
    const response = await fetch(url, { method: write ? "POST" : "GET", headers, body, signal: controller.signal, credentials: "same-origin", redirect: "error", cache: "no-store", referrerPolicy: "no-referrer" });
    if (!response.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new PracticeCalendarError(response.ok ? 503 : response.status);
    const text = await response.text(); if (text.length > 128 * 1024) return bad();
    const value: unknown = JSON.parse(text); if (controller.signal.aborted) return bad();
    if (response.status === 409) {
      const failure = object(value, ["ok", "code"]);
      if (failure.ok !== false || (failure.code !== "stale-day" && failure.code !== "stale-material" && failure.code !== "retention-expired")) return bad();
      throw new PracticeCalendarError(409, failure.code);
    }
    if (!response.ok) throw new PracticeCalendarError([401, 403, 404, 429].includes(response.status) ? response.status : 503);
    return write ? parsePracticeAck(value, operation.expectedDay) : parsePracticeDates(value, mode, studentId, operation.fromDate, operation.throughDate);
  } catch (error) { if (error instanceof PortalRequestError) throw error; return bad(); }
  finally { clearTimeout(timer); signal.removeEventListener("abort", abort); }
}
