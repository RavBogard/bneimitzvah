import { PortalRequestError } from "../api";
import { parseReadingProposal, readingBaseline, type ReadingKind, type StaffMode } from "./reading-proposal";
import { aliyahStarts } from "../../../lib/readings/aliyah-starts";
import { expandReadingRanges } from "../../../lib/readings/ranges";
import { TANAKH_VERSE_COUNTS } from "../../../lib/readings/catalog";

export type BaseMode = "student" | "parent" | "tutor" | "admin";
export type ReadingMode = BaseMode | "child-practice";
export type Student = { id: string; firstName: string; lastName: string; ceremonyDate: string; revision: number; ownAdultHonors?: boolean };
export type ImportMetadata={version:1;parent1Name:string|null;householdPhone:string|null;parent2Name:string|null;parashahLabel:string|null;tutorName:string|null;
  tutorMatch:{status:"matched";grantId:string}|{status:"unmatched"|"ambiguous"}|null;adminNotes:string|null};
export type RosterStudent = Student & { studentKind: "child" | "adult"; serviceSlot: "morning" | "havdalah" | "unknown"; parentEmail: string | null; ownEmail: string | null; disabledAt: string | null;hebrewName?:string|null;secondParentEmail?:string|null;importMetadata?:ImportMetadata|null };
export type StudentInput = Omit<RosterStudent, "id" | "revision" | "disabledAt" | "importMetadata" | "ownAdultHonors">;
export type Context = { id: string; authorityRevision: number; studentId: string; studentRevision: number; expiresAt: string };
export type Selection = { handle: string; context: Context };
export type Reading = { id: string; kind: "torah" | "haftarah"; revision: number; ranges: string[]; verses: string[]; needsReview: boolean; aliyahStarts:string[]|null; readingKey?: string | null;
  source: { status: "available" | "unavailable" | "unknown"; fetchedAt: number | null; date: string | null; calendar: "diaspora" | "israel" | null; attribution: { name: "Hebcal"; url: "https://www.hebcal.com/" } | null }; confirmationDate: string | null; basis: string };
export type Assigned = { student: Student; mode: ReadingMode; context: Context | null; readings: Reading[]; referenceListeningEnabled?: boolean };
const bad = (): never => { throw new PortalRequestError(503); };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function identifier(value: unknown): string { if (typeof value !== "string" || !uuid.test(value)) return bad(); return value; }
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key))) return bad();
  return value as Record<string, unknown>;
}
function text(value: unknown, max = 100): string { if (typeof value !== "string" || !value.trim() || value.length > max || /[\x00-\x1f\x7f]/.test(value)) return bad(); return value; }
function positive(value: unknown): number { if (!Number.isSafeInteger(value) || Number(value) < 1) return bad(); return Number(value); }
function instant(value: unknown): string { if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return bad(); return value; }
function date(value: unknown): string { const s = text(value, 10), parsed = new Date(s + "T00:00:00Z"); if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== s) return bad(); return s; }
const studentKeys = ["id", "firstName", "lastName", "ceremonyDate", "revision"];
function studentFields(row: Record<string, unknown>): Student { return { id: identifier(row.id), firstName: text(row.firstName), lastName: text(row.lastName), ceremonyDate: date(row.ceremonyDate), revision: positive(row.revision) }; }
function intakeText(value:unknown,max:number,multiline=false):string|null {
  if(value===null)return null;
  if(typeof value!=="string" || !value.trim() || value!==value.trim() || new TextEncoder().encode(value).length>max || (multiline?/[\x00-\x09\x0b-\x1f\x7f-\x9f]/:/[\x00-\x1f\x7f-\x9f]/).test(value) || /[<>]/.test(value))return bad();
  return value;
}
function importMetadata(value:unknown):ImportMetadata|null {
  if(value===null)return null;
  const row=object(value,["version","parent1Name","householdPhone","parent2Name","parashahLabel","tutorName","tutorMatch","adminNotes"]);if(row.version!==1)return bad();
  let tutorMatch:ImportMetadata["tutorMatch"]=null;
  if(row.tutorMatch!==null){
    if(!row.tutorMatch || typeof row.tutorMatch!=="object")return bad();
    const match=object(row.tutorMatch,"status" in row.tutorMatch && row.tutorMatch.status==="matched"?["status","grantId"]:["status"]);
    if(match.status==="matched")tutorMatch={status:"matched",grantId:identifier(match.grantId)};
    else if(match.status==="unmatched" || match.status==="ambiguous")tutorMatch={status:match.status};else return bad();
  }
  return {version:1,parent1Name:intakeText(row.parent1Name,400),householdPhone:intakeText(row.householdPhone,100),parent2Name:intakeText(row.parent2Name,400),parashahLabel:intakeText(row.parashahLabel,400),tutorName:intakeText(row.tutorName,400),tutorMatch,adminNotes:intakeText(row.adminNotes,4096,true)};
}
export function parseStudents(value: unknown, roster = false): Student[] | RosterStudent[] {
  const rows = object(value, ["students"]).students;
  if (!Array.isArray(rows) || rows.length > (roster ? 5000 : 100)) return bad();
  const result = rows.map(value => {
    const rich=roster && !!value && typeof value==="object" && Object.hasOwn(value,"importMetadata");
    const eligibility = !roster && !!value && typeof value === "object" && Object.hasOwn(value, "ownAdultHonors");
    const row = object(value, roster ? [...studentKeys, "studentKind", "serviceSlot", "parentEmail", "ownEmail", "disabledAt",...(rich?["hebrewName","secondParentEmail","importMetadata"]:[])] : [...studentKeys, ...(eligibility ? ["ownAdultHonors"] : [])]), student = studentFields(row);
    if (!roster) {
      if (eligibility && typeof row.ownAdultHonors !== "boolean") return bad();
      return eligibility ? { ...student, ownAdultHonors: row.ownAdultHonors as boolean } : student;
    }
    if (row.studentKind !== "child" && row.studentKind !== "adult") return bad();
    const studentKind = row.studentKind;
    if(row.serviceSlot!=="morning" && row.serviceSlot!=="havdalah" && row.serviceSlot!=="unknown")return bad();
    const serviceSlot=row.serviceSlot;
    const mailbox = (value: unknown) => { const result = text(value, 254); if (!/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(result) || result !== result.trim().toLowerCase()) return bad(); return result; };
    const parentEmail = row.parentEmail === null ? null : mailbox(row.parentEmail), ownEmail = row.ownEmail === null ? null : mailbox(row.ownEmail);
    if ((studentKind === "child" && parentEmail === null) || (studentKind === "adult" && ownEmail === null) || (ownEmail !== null && ownEmail === parentEmail)) return bad();
    const intake=rich?{hebrewName:intakeText(row.hebrewName,400),secondParentEmail:row.secondParentEmail===null?null:mailbox(row.secondParentEmail),importMetadata:importMetadata(row.importMetadata)}:{};
    if(ownEmail!==null && intake.secondParentEmail===ownEmail)return bad();
    return { ...student, studentKind, serviceSlot, parentEmail, ownEmail, disabledAt: row.disabledAt === null ? null : instant(row.disabledAt),...intake };
  });
  if (new Set(result.map(row => row.id)).size !== result.length) return bad();
  return result;
}
export function parseContext(value: unknown, studentId: string): Context {
  const row = object(value, ["id", "authorityRevision", "studentId", "studentRevision", "expiresAt"]);
  if (identifier(row.studentId) !== studentId) return bad();
  return { id: identifier(row.id), authorityRevision: positive(row.authorityRevision), studentId, studentRevision: positive(row.studentRevision), expiresAt: instant(row.expiresAt) };
}
export function parseSelection(value: unknown, studentId: string): Selection {
  const row = object(value, ["handle", "context"]);
  if (typeof row.handle !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(row.handle)) return bad();
  return { handle: row.handle, context: parseContext(row.context, studentId) };
}
export function parseAssigned(value: unknown, mode: ReadingMode, studentId: string, selection?: Selection): Assigned {
  const hasListeningHint = !!value && typeof value === "object" && Object.hasOwn(value, "referenceListeningEnabled");
  const row = object(value, ["student", "mode", "context", "readings", ...(hasListeningHint ? ["referenceListeningEnabled"] : [])]), student = studentFields(object(row.student, studentKeys));
  if (hasListeningHint && typeof row.referenceListeningEnabled !== "boolean") return bad();
  if (student.id !== studentId || row.mode !== mode || !Array.isArray(row.readings) || row.readings.length > 2) return bad();
  const context = mode === "child-practice" ? parseContext(row.context, studentId) : null;
  // Student revision is refreshed metadata; the stable authority binding is
  // context ID, membership authority revision, target and expiry.
  if (context ? !selection || context.id !== selection.context.id || context.authorityRevision !== selection.context.authorityRevision || context.studentRevision !== student.revision || context.expiresAt !== selection.context.expiresAt : row.context !== null) return bad();
  const readings: Reading[] = row.readings.map(value => {
    const r = object(value, ["id", "status", "kind", "basis", "revision", "ranges", "verses", "confirmationDate", "needsReview", "source", "aliyahStarts", ...(value && typeof value === "object" && Object.hasOwn(value, "readingKey") ? ["readingKey"] : [])]);
    const readingKey = Object.hasOwn(r, "readingKey") ? r.readingKey : null;
    if (readingKey !== null && (typeof readingKey !== "string" || readingKey.length > 160 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(readingKey))) return bad();
    if (r.status !== "confirmed" || (r.kind !== "torah" && r.kind !== "haftarah") || !["triennial", "selection", "full", "custom"].includes(String(r.basis)) || typeof r.needsReview !== "boolean"
      || !Array.isArray(r.ranges) || r.ranges.length < 1 || r.ranges.length > 32 || !Array.isArray(r.verses) || r.verses.length < 1 || r.verses.length > 1000) return bad();
    const s = object(r.source, ["status", "fetchedAt", "date", "calendar", "attribution"]);
    if (!["available", "unavailable", "unknown"].includes(String(s.status)) || (s.fetchedAt !== null && (typeof s.fetchedAt !== "number" || !Number.isFinite(s.fetchedAt) || s.fetchedAt < 0))
      || ![null, "diaspora", "israel"].includes(s.calendar as string | null)) return bad();
    let attribution = null;
    if (s.attribution !== null) { const a = object(s.attribution, ["name", "url"]); if (a.name !== "Hebcal" || a.url !== "https://www.hebcal.com/") return bad(); attribution = { name: "Hebcal" as const, url: "https://www.hebcal.com/" as const }; }
    const ranges=r.ranges.map(v=>text(v)),verses=r.verses.map(v=>text(v));let cuts:string[]|null;
    try{const expanded=expandReadingRanges(ranges,r.kind as ReadingKind,TANAKH_VERSE_COUNTS);if(expanded.length!==verses.length || expanded.some((ref,i)=>ref!==verses[i]))return bad();cuts=aliyahStarts(r.kind as ReadingKind,r.aliyahStarts,verses);}catch{return bad();}
    return { id: identifier(r.id), kind: r.kind as "torah" | "haftarah", basis: r.basis as string, revision: positive(r.revision), ranges, verses, needsReview: r.needsReview, aliyahStarts:cuts, readingKey: readingKey as string | null,
      confirmationDate: r.confirmationDate === null ? null : date(r.confirmationDate), source: { status: s.status as Reading["source"]["status"], fetchedAt: s.fetchedAt as number | null,
        date: s.date === null ? null : date(s.date), calendar: s.calendar as "diaspora" | "israel" | null, attribution } };
  });
  if (new Set(readings.map(r => r.kind)).size !== readings.length) return bad();
  return { student, mode, context, referenceListeningEnabled: row.referenceListeningEnabled === true, readings: readings.sort((a, b) => a.kind === b.kind ? 0 : a.kind === "torah" ? -1 : 1) };
}

export async function call(path: string, body?: object, handle?: string, signal?: AbortSignal, max = 256 * 1024): Promise<unknown> {
  const controller = new AbortController(), abort = () => controller.abort();
  if (signal?.aborted) abort(); signal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(abort, 12_000);
  try {
    const headers = new Headers({ accept: "application/json" });
    if (body !== undefined) headers.set("content-type", "application/json");
    if (handle !== undefined) headers.set("X-Practice-Context", handle);
    const response = await fetch(path, { method: body === undefined ? "GET" : "POST", body: body === undefined ? undefined : JSON.stringify(body), headers,
      cache: "no-store", credentials: "same-origin", referrerPolicy: "no-referrer", redirect: "error", signal: controller.signal });
    if (!response.ok) throw new PortalRequestError([400, 401, 403, 404, 409, 413, 429, 503].includes(response.status) ? response.status : 503);
    if (!response.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return bad();
    const reader = response.body?.getReader(); if (!reader) return bad();
    const chunks: Uint8Array[] = []; let size = 0;
    try { for (;;) { const next = await reader.read(); if (next.done) break; size += next.value.byteLength; if (size > max) { await reader.cancel(); return bad(); } chunks.push(next.value); } }
    finally { reader.releaseLock(); }
    const data = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(data));
  } catch (error) { if (error instanceof PortalRequestError) throw error; return bad(); }
  finally { clearTimeout(timeout); signal?.removeEventListener("abort", abort); }
}
export const workspaceApi = {
  async students(mode: Exclude<BaseMode, "admin">, afterId?: string, signal?: AbortSignal) {
    if (!["student", "parent", "tutor"].includes(mode)) return bad();
    return parseStudents(await call(`/api/students?mode=${mode}&limit=100${afterId ? `&afterId=${identifier(afterId)}` : ""}`, undefined, undefined, signal)) as Student[];
  },
  async reading(mode: ReadingMode, studentId: string, selection?: Selection, signal?: AbortSignal) {
    if (!["student", "parent", "tutor", "admin", "child-practice"].includes(mode) || (mode === "child-practice") !== Boolean(selection)) return bad();
    const id = identifier(studentId);
    return parseAssigned(await call(`/api/students/${id}/reading?mode=${mode}`, undefined, selection?.handle, signal), mode, id, selection);
  },
  async enter(studentId: string) { const id = identifier(studentId); return parseSelection(await call("/api/practice/enter", { studentId: id }), id); },
  async switch(studentId: string, handle: string) { const id = identifier(studentId); return parseSelection(await call("/api/practice/switch", { studentId: id }, handle), id); },
  async exit(handle: string) { const row = object(await call("/api/practice/exit", {}, handle), ["status", "contextId"]); if (row.status !== "closed") return bad(); return { contextId: identifier(row.contextId) }; },
  async roster(signal?: AbortSignal) { return parseStudents(await call("/api/admin/students", undefined, undefined, signal, 2 * 1024 * 1024), true) as RosterStudent[]; },
  async save(student: StudentInput, current?: { id: string; revision: number }) {
    const value = await call(current ? `/api/admin/students/${identifier(current.id)}/edit` : "/api/admin/students", current ? { expectedRevision: positive(current.revision), student } : { student });
    const row = object(value, current ? ["ok", "id", "revision", "readingNeedsReview"] : ["id", "revision"]);
    if (current && (row.ok !== true || typeof row.readingNeedsReview !== "boolean" || row.id !== current.id || positive(row.revision) <= current.revision)) return bad();
    return { id: identifier(row.id), revision: positive(row.revision), readingNeedsReview: row.readingNeedsReview === true };
  },
  async disable(student: RosterStudent) { const row = object(await call(`/api/admin/students/${identifier(student.id)}/disable`, { expectedRevision: positive(student.revision) }), ["ok", "id", "revision"]); if (row.ok !== true || row.id !== student.id) return bad(); return { id: identifier(row.id), revision: positive(row.revision) }; },
  async prepareReading(mode: StaffMode, baseline: Assigned, kind: ReadingKind, input: { pick?: string; ranges?: string[];aliyahStarts?:string[];preparationMode?:"current-assignment";expectedAssignmentRevision?:number }) {
    if (!["admin", "tutor"].includes(mode) || baseline.mode !== mode || !["torah", "haftarah"].includes(kind) || input.pick !== undefined && input.ranges !== undefined) return bad();
    const id = identifier(baseline.student.id);
    if(kind==="haftarah" && input.aliyahStarts!==undefined || input.preparationMode!==undefined && (kind!=="torah" || input.pick!==undefined || input.ranges!==undefined || !Number.isSafeInteger(input.expectedAssignmentRevision)))return bad();
    const raw = await call(`/api/students/${id}/reading/prepare`, { mode, kind, ...(input.pick === undefined ? {} : { pick: input.pick }), ...(input.ranges === undefined ? {} : { ranges: input.ranges }),
      ...(input.aliyahStarts===undefined?{}:{aliyahStarts:input.aliyahStarts}),...(input.preparationMode===undefined?{}:{preparationMode:input.preparationMode,expectedAssignmentRevision:input.expectedAssignmentRevision}) });
    // Preparation binds the server's live state. Do not show it against an
    // earlier student/date/assignment until a later authoritative read proves
    // the original monotonic baseline still matches.
    const live = parseAssigned(await call(`/api/students/${id}/reading?mode=${mode}`), mode, id);
    if (readingBaseline(live, kind) !== readingBaseline(baseline, kind)) throw new PortalRequestError(409);
    return parseReadingProposal(raw, kind, baseline.student.ceremonyDate);
  },
  async confirmReading(mode: StaffMode, studentId: string, binding: string) {
    if (!["admin", "tutor"].includes(mode) || typeof binding !== "string" || binding.length > 48000 || !/^v1\.[A-Za-z0-9_-]+$/.test(binding)) return bad();
    const row = object(await call(`/api/students/${identifier(studentId)}/reading/confirm`, { mode, binding }), ["ok", "assignmentId", "revision"]);
    if (row.ok !== true) return bad(); return { assignmentId: identifier(row.assignmentId), revision: positive(row.revision) };
  },
};
