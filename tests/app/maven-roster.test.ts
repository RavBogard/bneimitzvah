import { expect, test } from "vitest";
import { decodeMavenRosterContacts as decode, mavenRosterQuery, MAVEN_ROSTER_LIMITS } from "../../src/server/students/maven-roster";

const window = { start: "2027-01-01", end: "2030-12-31" };
const id = (n: number) => String(n).padStart(18, "0");
const row = (patch: Record<string, unknown> = {}) => ({ Id: id(1), FirstName: "Invented", LastName: "Learner", Beit_Mitzvah_Date__c: "2027-04-03",
  Not_Having_Beit_Mitzvah__c: false, Hebrew_Name__c: "שם סינתטי", Email: "Contact@example.test", AccountId: id(90),
  Account: { npe01__One2OneContact__r: { Id: id(91), Email: "primary@example.test" } }, ...patch });
function query(w = window) { const result = mavenRosterQuery(w); if (!result.ok) throw Error("Synthetic window invalid"); return result.query.arguments.soql; }
// Source-shaped synthetic fixture: composite.ts:353-360,474 attaches q0 metadata;
// maven-run-soql.ts:260,329-339,463 projects completeness/pagination/rows.
function envelope(rows: unknown[] = [row()], patch: Record<string, unknown> = {}) {
  return { status: rows.length ? "complete" : "no_data", completeness: { isComplete: true, returned: rows.length, total: rows.length, truncated: false },
    partialFailures: [], countSource: "none", partialReason: null, denied: false, tuitionIncluded: false, shadowWarning: null,
    rows, rowCount: rows.length, count: null, pagination: { totalSize: rows.length, returned: rows.length, done: true, appliedLimit: 501 },
    provenance: { requestedSoql: query(), executor: "compositeBatchQuery", governance: ["object-allow-list", "governor-limit", "structural-validation"] },
    privacy: { pastoralContext: false, financialIncluded: true }, callId: "00000000-0000-4000-8000-000000000001",
    timing: { durationMs: 1.5, sfRequests: 1, cacheHits: 0, cacheLookups: 0 }, ...patch };
}
const bad = (code: string, row = 0) => ({ ok: false, version: 1, issues: [{ row, code }] });

test("fixed SELECT exposes only contact facts, deterministic ordering and a 501 sentinel", () => {
  expect(mavenRosterQuery(window)).toEqual({ ok: true, version: 1, query: { tool: "maven_run_soql", arguments: { soql:
    "SELECT Id, FirstName, LastName, Beit_Mitzvah_Date__c, Not_Having_Beit_Mitzvah__c, Hebrew_Name__c, Email, AccountId, Account.npe01__One2OneContact__r.Id, Account.npe01__One2OneContact__r.Email FROM Contact WHERE Beit_Mitzvah_Date__c >= 2027-01-01 AND Beit_Mitzvah_Date__c <= 2030-12-31 AND npsp__Deceased__c = false ORDER BY Beit_Mitzvah_Date__c ASC, Id ASC LIMIT 501" } } });
});

test("window is at most 1830 inclusive days and accepts real leap dates", () => {
  const end = (days: number) => new Date(Date.parse("2027-01-01") + (days - 1) * 86_400_000).toISOString().slice(0, 10);
  expect(mavenRosterQuery({ start: "2027-01-01", end: end(1830) }).ok).toBe(true);
  expect(mavenRosterQuery({ start: "2027-01-01", end: end(1831) })).toEqual(bad("invalid-window"));
  expect(mavenRosterQuery({ start: "2028-02-29", end: "2028-02-29" }).ok).toBe(true);
  for (const value of [{ start: "2027-02-29", end: "2027-03-01" }, { start: window.end, end: window.start },
    { ...window, soql: "SELECT Id FROM Account" }, { ...window, start: "2027-01-01 LIMIT 1" }, null]) {
    expect(mavenRosterQuery(value)).toEqual(bad("invalid-window"));
  }
});

test("preserves opaque case-sensitive Contact IDs, names and distinct identical households", () => {
  const ids = ["A".repeat(17) + "a", "A".repeat(18)];
  const result = decode(window, envelope(ids.map(Id => row({ Id, FirstName: "  Invented  " }))));
  expect(result.ok).toBe(true); if (!result.ok) return;
  expect(result.contacts.map(c => c.sourceRecordId)).toEqual(ids);
  expect(result.contacts[0].firstName).toBe("  Invented  ");
  expect(result.contacts[0].hebrewName).toBe("שם סינתטי");
  expect(result.contacts.every(c => c.contact.contactId === c.sourceRecordId)).toBe(true);
  expect(result.issues).toHaveLength(6);
});

test("own contact and household-primary provenance never substitute guardianship or email", () => {
  const result = decode(window, envelope([row({ Email: null, Not_Having_Beit_Mitzvah__c: true,
    Account: { npe01__One2OneContact__r: { Id: id(1), Email: "primary@example.test" } } })]));
  expect(result.ok).toBe(true); if (!result.ok) return;
  expect(result.contacts[0]).toMatchObject({ notHavingBeitMitzvah: true, contact: { source: "contact", contactId: id(1), email: null },
    householdPrimaryContact: { source: "household-primary-contact", accountId: id(90), contactId: id(1), email: "primary@example.test" },
    readiness: { studentKind: "unresolved", serviceSlot: "unknown", guardianship: "unresolved" } });
  expect(result.issues.map(i => i.code)).toEqual(["student-kind-unresolved", "service-slot-unresolved", "guardianship-unresolved", "not-having-recorded", "household-primary-is-contact"]);
  expect(result.contacts[0]).not.toHaveProperty("fields");
  expect(result.contacts[0]).not.toHaveProperty("parentEmail");
  expect(Object.isFrozen(result.contacts[0].contact)).toBe(true);
  expect(Object.isFrozen(result.contacts)).toBe(true);
});

test("nullable unavailable names and relationships stay unavailable with readiness issues", () => {
  const input = envelope([row({ FirstName: null, LastName: " ", Hebrew_Name__c: null, Account: null, AccountId: null })]);
  const before = JSON.stringify(input); const result = decode(window, input);
  expect(JSON.stringify(input)).toBe(before); expect(result.ok).toBe(true); if (!result.ok) return;
  expect(result.contacts[0].householdPrimaryContact).toBeNull();
  expect(result.issues.map(i => i.code)).toEqual(["missing-first-name", "missing-last-name", "student-kind-unresolved", "service-slot-unresolved", "guardianship-unresolved"]);
});

test("exact duplicate IDs reject the entire response with both row indices", () => {
  expect(decode(window, envelope([row(), row({ FirstName: "Other" })]))).toEqual({ ok: false, version: 1,
    issues: [{ row: 1, code: "duplicate-contact-id" }, { row: 2, code: "duplicate-contact-id" }] });
});

test.each(["A".repeat(15), "A".repeat(17), "A".repeat(19), "A".repeat(17) + "-", "Ａ".repeat(18), null])("invalid top Contact ID cannot fall back to household identity: %s", Id => {
  expect(decode(window, envelope([row({ Id })]))).toEqual(bad("invalid-row", 1));
});

test("empty fully accounted response is accepted, 500 accepted, 501 rejected, 502 malformed", () => {
  expect(decode(window, envelope([]))).toEqual({ ok: true, version: 1, contacts: [], issues: [] });
  const rows = Array.from({ length: 502 }, (_, n) => row({ Id: id(n + 1) }));
  const accepted = decode(window, envelope(rows.slice(0, 500)));
  expect(accepted.ok).toBe(true); if (accepted.ok) expect(accepted.contacts).toHaveLength(500);
  expect(decode(window, envelope(rows.slice(0, 501)))).toEqual(bad("too-many-contacts"));
  expect(decode(window, envelope(rows))).toEqual(bad("invalid-response"));
  expect(MAVEN_ROSTER_LIMITS.contacts).toBe(500);
});

test.each([
  ["source-denied", { denied: true }], ["incomplete-response", { status: "partial" }], ["incomplete-response", { status: "error" }],
  ["incomplete-response", { partialFailures: ["synthetic failure"] }], ["incomplete-response", { partialReason: "degraded" }],
  ["incomplete-response", { completeness: null }], ["incomplete-response", { pagination: null }],
  ["unexpected-source", { countSource: "exact" }], ["unexpected-source", { count: 1 }], ["unexpected-source", { tuitionIncluded: true }],
  ["unexpected-source", { shadowWarning: { concept: "synthetic" } }], ["invalid-response", { denied: null }],
  ["invalid-response", { rowCount: 2 }], ["invalid-response", { status: "no_data" }],
] as const)("honesty contract rejects %s (%j)", (code, patch) => { expect(decode(window, envelope([row()], patch))).toEqual(bad(code)); });

test("pagination and completeness must independently account for every returned row", () => {
  for (const patch of [{ isComplete: false }, { total: 2 }, { returned: 0 }, { truncated: true }, { total: -1 }]) {
    const e = envelope(); Object.assign(e.completeness, patch); expect(decode(window, e)).toEqual(bad("incomplete-response"));
  }
  for (const patch of [{ done: false }, { totalSize: 2 }, { returned: 0 }, { appliedLimit: 0 }, { appliedLimit: 502 }]) {
    const e = envelope(); Object.assign(e.pagination, patch); expect(decode(window, e)).toEqual(bad("incomplete-response"));
  }
});

test("lower source governor is accepted only when independently fully accounted", () => {
  const e = envelope(); e.pagination.appliedLimit = 200;
  expect(decode(window, e).ok).toBe(true);
  e.completeness.total = 201; e.completeness.isComplete = false; e.completeness.truncated = true;
  e.pagination.totalSize = 201; e.pagination.done = false; e.status = "partial";
  expect(decode(window, e)).toEqual(bad("incomplete-response"));
});

test("requires this exact query, executor, nonpastoral rows and known registrar metadata", () => {
  for (const mutate of [
    (e: ReturnType<typeof envelope>) => { e.provenance.requestedSoql += " "; },
    (e: ReturnType<typeof envelope>) => { e.provenance.executor = "other"; },
    (e: ReturnType<typeof envelope>) => { e.privacy.pastoralContext = true; },
  ]) { const e = envelope(); mutate(e); expect(decode(window, e)).toEqual(bad("unexpected-source")); }
  for (const patch of [{ recipeRefs: ["other"] }, { fieldNotices: ["warning"] }, { recipeRun: {} }, { callId: "invalid" }, { surprise: true }]) {
    expect(decode(window, envelope([row()], patch))).toEqual(bad("invalid-response"));
  }
});

test.each([
  { Fee__c: 42 }, { notes: "invented" }, { Id: undefined }, { FirstName: "bad\nname" }, { Hebrew_Name__c: "\ud800" },
  { Email: "not-an-email" }, { AccountId: id(1).slice(1) }, { Not_Having_Beit_Mitzvah__c: null },
  { Account: { npe01__One2OneContact__r: { Id: id(91), Email: null, guardian: true } } },
])("closed rows reject unexpected or malformed fields (%j)", patch => {
  const result = decode(window, envelope([row(patch)])); expect(result.ok).toBe(false);
  expect(result.issues.every(i => i.code === "invalid-row" || i.code === "invalid-response")).toBe(true);
});

test("dates outside the exact window fail by row without echoing contact facts", () => {
  const result = decode(window, envelope([row({ Beit_Mitzvah_Date__c: "2026-12-31" })]));
  expect(result).toEqual(bad("outside-window", 1));
  const printed = JSON.stringify(result);
  for (const secret of [id(1), "Invented", "example.test", "2026-12-31"]) expect(printed).not.toContain(secret);
});

test("non-JSON objects, getters and proxies are refused without executing input", () => {
  let called = 0; const getter = Object.defineProperty({}, "status", { enumerable: true, get() { called++; throw Error("secret"); } });
  const proxy = new Proxy({}, { ownKeys() { called++; throw Error("secret"); } });
  const cycle: Record<string, unknown> = {}; cycle.cycle = cycle;
  const hidden = Object.defineProperty(envelope(), "hidden", { value: 1 });
  const sparse = envelope(); sparse.rows = Array(1);
  const extra = envelope(); Object.assign(extra.rows, { other: true });
  const symbol = envelope(); Object.assign(symbol, { [Symbol("secret")]: true });
  for (const value of [getter, proxy, new Date(), new Map(), cycle, hidden, sparse, extra, symbol,
    { ...envelope(), toJSON() { called++; return {}; } }, { ...envelope(), rows: [row({ FirstName: "x".repeat(8193) })] }]) {
    expect(decode(window, value)).toEqual(bad("invalid-response"));
  }
  expect(mavenRosterQuery(proxy)).toEqual(bad("invalid-window")); expect(called).toBe(0);
});

test("global byte, node and depth budgets bound malformed responses", () => {
  const oversized = envelope(Array.from({ length: 300 }, (_, n) => row({ Id: id(n + 1), Hebrew_Name__c: "x".repeat(8192) })));
  expect(decode(window, oversized)).toEqual(bad("invalid-response"));
  let deep: unknown = null; for (let n = 0; n < 14; n++) deep = { child: deep };
  expect(decode(window, { ...envelope(), deep })).toEqual(bad("invalid-response"));
  const numerous = Array.from({ length: 100 }, () => Array.from({ length: 300 }, () => null));
  expect(decode(window, { ...envelope(), numerous })).toEqual(bad("invalid-response"));
});

test("structured content is required rather than outer MCP/text or a caller query", () => {
  expect(decode(window, { structuredContent: envelope(), content: [{ type: "text", text: "invented" }] })).toEqual(bad("invalid-response"));
  expect(decode({ ...window, query: query() }, envelope())).toEqual(bad("invalid-window"));
  expect(decode(window, JSON.stringify(envelope()))).toEqual(bad("invalid-response"));
});
