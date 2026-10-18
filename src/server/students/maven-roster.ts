import { isProxy } from "node:util/types";

/** Pure read contract only. No credentials, transport, StudentInput or identity/apply authority. */
export const MAVEN_ROSTER_LIMITS = Object.freeze({ contacts: 500, queryRows: 501, windowDays: 1830,
  bytes: 1_048_576, nodes: 20_000, depth: 12, string: 8192 });
export type MavenRosterWindow = Readonly<{ start: string; end: string }>;
export type MavenRosterIssueCode = "invalid-window" | "invalid-response" | "source-denied" | "incomplete-response" |
  "unexpected-source" | "too-many-contacts" | "invalid-row" | "duplicate-contact-id" | "outside-window" |
  "missing-first-name" | "missing-last-name" | "student-kind-unresolved" | "service-slot-unresolved" |
  "guardianship-unresolved" | "not-having-recorded" | "household-primary-is-contact";
/** row=0 identifies the envelope/window; contact rows use one-based indices. */
export type MavenRosterIssue = Readonly<{ row: number; code: MavenRosterIssueCode }>;
type Failure = Readonly<{ ok: false; version: 1; issues: readonly MavenRosterIssue[] }>;
export type MavenRosterQuery = Readonly<{ tool: "maven_run_soql"; arguments: Readonly<{ soql: string }> }>;
export type MavenContactFacts = Readonly<{
  sourceRecordId: string; firstName: string | null; lastName: string | null; ceremonyDate: string;
  hebrewName: string | null; notHavingBeitMitzvah: boolean; householdAccountId: string | null;
  contact: Readonly<{ source: "contact"; contactId: string; email: string | null }>;
  householdPrimaryContact: Readonly<{ source: "household-primary-contact"; accountId: string; contactId: string; email: string | null }> | null;
  readiness: Readonly<{ studentKind: "unresolved"; serviceSlot: "unknown"; guardianship: "unresolved" }>;
}>;
export type MavenRosterFactsResult = Failure | Readonly<{ ok: true; version: 1; contacts: readonly MavenContactFacts[]; issues: readonly MavenRosterIssue[] }>;

const columns = Object.freeze(["Id", "FirstName", "LastName", "Beit_Mitzvah_Date__c", "Not_Having_Beit_Mitzvah__c",
  "Hebrew_Name__c", "Email", "AccountId", "Account.npe01__One2OneContact__r.Id", "Account.npe01__One2OneContact__r.Email"]);
const rowKeys = ["Id", "FirstName", "LastName", "Beit_Mitzvah_Date__c", "Not_Having_Beit_Mitzvah__c", "Hebrew_Name__c", "Email", "AccountId", "Account"];
const baseEnvelope = ["status", "completeness", "partialFailures", "countSource", "partialReason", "denied", "tuitionIncluded", "shadowWarning",
  "rows", "rowCount", "count", "pagination", "provenance", "privacy"];
const optionalEnvelope = ["callId", "timing", "recipeRefs", "recipeRun", "fieldNotices"];
const readiness = Object.freeze({ studentKind: "unresolved" as const, serviceSlot: "unknown" as const, guardianship: "unresolved" as const });
const issue = (row: number, code: MavenRosterIssueCode): MavenRosterIssue => Object.freeze({ row, code });
const failure = (code: MavenRosterIssueCode, row = 0): Failure => Object.freeze({ ok: false, version: 1, issues: Object.freeze([issue(row, code)]) });
const reject = (): never => { throw new Error("Invalid Maven source response"); };

// Inspect descriptors before values/JSON accounting: no getters, proxies, toJSON,
// sparse arrays, custom prototypes, symbols, cycles or unbounded nested allocation.
function json(value: unknown) {
  let nodes = 0, bytes = 0;
  const add = (n: number) => { bytes += n; if (bytes > MAVEN_ROSTER_LIMITS.bytes) reject(); };
  function visit(v: unknown, depth: number): void {
    if (++nodes > MAVEN_ROSTER_LIMITS.nodes || depth > MAVEN_ROSTER_LIMITS.depth) reject();
    if (v === null || typeof v === "boolean") { add(v === null ? 4 : v ? 4 : 5); return; }
    if (typeof v === "number") { if (!Number.isFinite(v)) reject(); add(String(v).length); return; }
    if (typeof v === "string") {
      if (v.length > MAVEN_ROSTER_LIMITS.string || !v.isWellFormed()) reject();
      add(Buffer.byteLength(JSON.stringify(v), "utf8")); return;
    }
    if (!v || typeof v !== "object" || isProxy(v)) reject();
    const array = Array.isArray(v), prototype = Object.getPrototypeOf(v);
    if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) reject();
    const descriptors = Object.getOwnPropertyDescriptors(v), keys = Reflect.ownKeys(descriptors);
    if (keys.some(key => typeof key !== "string")) reject();
    if (array) {
      const length = descriptors.length.value as number;
      if (length > MAVEN_ROSTER_LIMITS.queryRows || keys.length !== length + 1) reject();
      add(2 + Math.max(0, length - 1));
      for (let i = 0; i < length; i++) {
        const entry = descriptors[String(i)]; if (!entry || !entry.enumerable || !("value" in entry)) reject();
        visit(entry.value, depth + 1);
      }
    } else {
      if (keys.length > 64) reject(); add(2 + Math.max(0, keys.length - 1));
      for (const key of keys as string[]) {
        const entry = descriptors[key];
        if (!entry.enumerable || !("value" in entry) || ["__proto__", "constructor", "prototype", "toJSON"].includes(key)) reject();
        add(Buffer.byteLength(JSON.stringify(key), "utf8") + 1); visit(entry.value, depth + 1);
      }
    }
  }
  visit(value, 0);
}
function object(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return reject();
  const v = value as Record<string, unknown>;
  if (required.some(key => !Object.hasOwn(v, key)) || Object.keys(v).some(key => !required.includes(key) && !optional.includes(key))) return reject();
  return v;
}
function date(value: unknown): string {
  if (typeof value !== "string" || !/^[1-9]\d{3}-\d\d-\d\d$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) return reject();
  return value;
}
function window(value: unknown): MavenRosterWindow {
  json(value); const v = object(value, ["start", "end"]), start = date(v.start), end = date(v.end);
  if (start > end || (Date.parse(end) - Date.parse(start)) / 86_400_000 + 1 > MAVEN_ROSTER_LIMITS.windowDays) return reject();
  return Object.freeze({ start, end });
}
function query(w: MavenRosterWindow): MavenRosterQuery {
  return Object.freeze({ tool: "maven_run_soql", arguments: Object.freeze({ soql: `SELECT ${columns.join(", ")} FROM Contact WHERE Beit_Mitzvah_Date__c >= ${w.start} AND Beit_Mitzvah_Date__c <= ${w.end} AND npsp__Deceased__c = false ORDER BY Beit_Mitzvah_Date__c ASC, Id ASC LIMIT 501` }) });
}
/** Only validated date literals vary; maximum window is 1830 inclusive days.
 * Callers cannot supply SELECT, source fields or a query. Maven's default 200-row
 * governor can lower 501; it must report completeness, not silently imply all rows.
 */
export function mavenRosterQuery(value: unknown): Readonly<{ ok: true; version: 1; query: MavenRosterQuery }> | Failure {
  try { return Object.freeze({ ok: true, version: 1, query: query(window(value)) }); } catch { return failure("invalid-window"); }
}
function integer(value: unknown, max = 1_000_000): value is number { return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= max; }
function text(value: unknown, max: number, nullable = true): string | null {
  if (value === null && nullable) return null;
  if (typeof value !== "string" || value.length > max || /[\u0000-\u001f\u007f-\u009f]/u.test(value)) return reject();
  return value;
}
function id(value: unknown, nullable = false): string | null {
  if (value === null && nullable) return null;
  if (typeof value !== "string" || !/^[A-Za-z0-9]{18}$/.test(value)) return reject(); return value;
}
function email(value: unknown): string | null {
  const result = text(value, 320);
  if (result !== null && !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/u.test(result)) return reject(); return result;
}
function contact(value: unknown): MavenContactFacts {
  const row = object(value, rowKeys), sourceRecordId = id(row.Id)!, accountId = id(row.AccountId, true);
  if (typeof row.Not_Having_Beit_Mitzvah__c !== "boolean") return reject();
  let primary: MavenContactFacts["householdPrimaryContact"] = null;
  if (row.Account !== null) {
    const account = object(row.Account, ["npe01__One2OneContact__r"]);
    if (!accountId) return reject();
    if (account.npe01__One2OneContact__r !== null) {
      const person = object(account.npe01__One2OneContact__r, ["Id", "Email"]);
      primary = Object.freeze({ source: "household-primary-contact", accountId, contactId: id(person.Id)!, email: email(person.Email) });
    }
  }
  return Object.freeze({ sourceRecordId, firstName: text(row.FirstName, 200), lastName: text(row.LastName, 200),
    ceremonyDate: date(row.Beit_Mitzvah_Date__c), hebrewName: text(row.Hebrew_Name__c, 400),
    notHavingBeitMitzvah: row.Not_Having_Beit_Mitzvah__c, householdAccountId: accountId,
    contact: Object.freeze({ source: "contact", contactId: sourceRecordId, email: email(row.Email) }), householdPrimaryContact: primary, readiness });
}
function metadata(v: Record<string, unknown>) {
  if (v.callId !== undefined && (typeof v.callId !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v.callId))) reject();
  if (v.timing !== undefined) {
    const t = object(v.timing, ["durationMs", "sfRequests", "cacheHits", "cacheLookups"]);
    if (typeof t.durationMs !== "number" || t.durationMs < 0 || t.durationMs > 86_400_000 || ![t.sfRequests, t.cacheHits, t.cacheLookups].every(n => integer(n))) reject();
  }
  if (v.recipeRun !== undefined && v.recipeRun !== null) reject();
  for (const key of ["recipeRefs", "fieldNotices"]) if (v[key] !== undefined && (!Array.isArray(v[key]) || (v[key] as unknown[]).length)) reject();
}

/**
 * Decode structuredContent only, never the MCP text channel. Successful facts
 * are confidential/transient, not log-safe and not a planner or apply input.
 * Maven permits null completeness and fallback pagination.done=true; that cannot
 * prove a complete roster, so this boundary refuses it. The normal composite q0
 * path supplies non-null completeness; its absence is not repaired here.
 * An approved source mode permitting at least 501 rows is needed to cover the
 * planner's full 500-contact bound; no mode or read authority is selected here.
 * privacy.financialIncluded is a principal flag, not a claim of selected money fields.
 */
export function decodeMavenRosterContacts(suppliedWindow: unknown, response: unknown): MavenRosterFactsResult {
  let w: MavenRosterWindow;
  try { w = window(suppliedWindow); } catch { return failure("invalid-window"); }
  try {
    json(response); const v = object(response, baseEnvelope, optionalEnvelope);
    metadata(v);
    if (v.denied === true) return failure("source-denied");
    if (v.denied !== false || typeof v.status !== "string" || !["complete", "no_data", "partial", "error"].includes(v.status)) return failure("invalid-response");
    if (v.status === "partial" || v.status === "error" || v.partialReason !== null || !Array.isArray(v.partialFailures) || v.partialFailures.length) return failure("incomplete-response");
    if (v.count !== null || v.countSource !== "none" || v.tuitionIncluded !== false || v.shadowWarning !== null) return failure("unexpected-source");
    const provenance = object(v.provenance, ["requestedSoql", "executor", "governance"]);
    if (provenance.requestedSoql !== query(w).arguments.soql || provenance.executor !== "compositeBatchQuery" || !Array.isArray(provenance.governance) || provenance.governance.length > 32 || provenance.governance.some(s => typeof s !== "string" || s.length > 128)) return failure("unexpected-source");
    const privacy = object(v.privacy, ["pastoralContext", "financialIncluded"]);
    if (privacy.pastoralContext !== false || typeof privacy.financialIncluded !== "boolean") return failure("unexpected-source");
    if (!Array.isArray(v.rows) || !integer(v.rowCount, MAVEN_ROSTER_LIMITS.queryRows) || v.rowCount !== v.rows.length) return failure("invalid-response");
    if (v.rows.length > MAVEN_ROSTER_LIMITS.contacts) return failure("too-many-contacts");
    if (v.completeness === null || v.pagination === null) return failure("incomplete-response");
    const c = object(v.completeness, ["isComplete", "returned", "total", "truncated"]), p = object(v.pagination, ["totalSize", "returned", "done", "appliedLimit"]);
    if (c.isComplete !== true || c.truncated !== false || p.done !== true || ![c.returned, c.total, p.totalSize, p.returned].every(n => integer(n)) ||
      c.returned !== v.rows.length || c.total !== v.rows.length || p.totalSize !== v.rows.length || p.returned !== v.rows.length ||
      (p.appliedLimit !== null && (!integer(p.appliedLimit, MAVEN_ROSTER_LIMITS.queryRows) || p.appliedLimit < v.rows.length || p.appliedLimit === 0))) return failure("incomplete-response");
    if ((v.rows.length === 0 ? "no_data" : "complete") !== v.status) return failure("invalid-response");
    const contacts: MavenContactFacts[] = [], errors: MavenRosterIssue[] = [], readinessIssues: MavenRosterIssue[] = [], ids = new Map<string, number[]>();
    for (const [index, raw] of v.rows.entries()) {
      const row = index + 1;
      try {
        const facts = contact(raw); contacts.push(facts);
        const repeated = ids.get(facts.sourceRecordId) ?? []; repeated.push(row); ids.set(facts.sourceRecordId, repeated);
        if (facts.ceremonyDate < w.start || facts.ceremonyDate > w.end) errors.push(issue(row, "outside-window"));
        if (!facts.firstName?.trim()) readinessIssues.push(issue(row, "missing-first-name"));
        if (!facts.lastName?.trim()) readinessIssues.push(issue(row, "missing-last-name"));
        readinessIssues.push(issue(row, "student-kind-unresolved"), issue(row, "service-slot-unresolved"), issue(row, "guardianship-unresolved"));
        if (facts.notHavingBeitMitzvah) readinessIssues.push(issue(row, "not-having-recorded"));
        if (facts.householdPrimaryContact?.contactId === facts.sourceRecordId) readinessIssues.push(issue(row, "household-primary-is-contact"));
      } catch { errors.push(issue(row, "invalid-row")); }
    }
    for (const repeated of ids.values()) if (repeated.length > 1) for (const row of repeated) errors.push(issue(row, "duplicate-contact-id"));
    if (errors.length) return Object.freeze({ ok: false, version: 1, issues: Object.freeze(errors.sort((a, b) => a.row - b.row)) });
    return Object.freeze({ ok: true, version: 1, contacts: Object.freeze(contacts), issues: Object.freeze(readinessIssues) });
  } catch { return failure("invalid-response"); }
}
