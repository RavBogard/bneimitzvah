import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { and, eq } from "drizzle-orm";
import * as s from "../../src/server/db/index";
import { mavenRosterQuery } from "../../src/server/students/maven-roster";
import { defaultMavenWindow } from "../../src/server/students/maven-intake";
import { closeMcpFixtures, mcpFixture } from "./mcp-fixture";

afterEach(async () => { vi.restoreAllMocks(); await closeMcpFixtures(); });

// Synthetic Maven only: invented names, 18-character ids and addresses assembled at run time.
const WINDOW = { start: "2027-01-01", end: "2028-12-31" };
const mail = (local: string) => [local, "example.test"].join("@");
const sfid = (n: number) => `SYN${String(n).padStart(15, "0")}`;
type Row = Record<string, unknown>;
const contact = (n: number, patch: Row = {}): Row => ({ Id: sfid(n), FirstName: "Invented", LastName: `Learner ${n}`, Beit_Mitzvah_Date__c: "2027-03-06",
  Not_Having_Beit_Mitzvah__c: false, Hebrew_Name__c: null, Email: mail(`own${n}`), AccountId: sfid(900 + n),
  Account: { npe01__One2OneContact__r: { Id: sfid(500 + n), Email: mail(`family${n}`) } }, ...patch });
function envelope(rows: Row[], window = WINDOW) {
  const built = mavenRosterQuery(window); if (!built.ok) throw Error("Synthetic window invalid");
  return { status: rows.length ? "complete" : "no_data", completeness: { isComplete: true, returned: rows.length, total: rows.length, truncated: false },
    partialFailures: [], countSource: "none", partialReason: null, denied: false, tuitionIncluded: false, shadowWarning: null,
    rows, rowCount: rows.length, count: null, pagination: { totalSize: rows.length, returned: rows.length, done: true, appliedLimit: 501 },
    provenance: { requestedSoql: built.query.arguments.soql, executor: "compositeBatchQuery", governance: ["object-allow-list"] },
    privacy: { pastoralContext: false, financialIncluded: false } };
}
const TOOLS = ["get_maven_roster_query", "propose_roster_changes", "apply_roster_changes"];

async function setup(now?: () => number) {
  const t = await mcpFixture(true, now);
  await t.google("admin");
  const admin = (await t.connect("admin")).access_token as string;
  const texts: string[] = [];
  const call = async (token: string, name: string, args: Record<string, unknown>) => { const r = await t.call(token, name, args); texts.push(r.text); return r; };
  const propose = async (rows: Row[], token = admin) => (await call(token, "propose_roster_changes", { ...WINDOW, mavenResult: envelope(rows) })).json();
  const apply = async (rows: Row[], planToken: string, choices: unknown[], token = admin) => (await call(token, "apply_roster_changes", { ...WINDOW, mavenResult: envelope(rows), planToken, choices })).json();
  const owner = <T>(action: () => Promise<T>) => t.f.owner(action);
  const identities = () => owner(() => t.f.db.select().from(s.studentSourceIdentity).orderBy(s.studentSourceIdentity.sourceRecordId));
  const students = () => owner(() => t.f.db.select().from(s.student).where(eq(s.student.tenantId, "crc")).orderBy(s.student.createdAt, s.student.lastName));
  return { t, admin, texts, call, propose, apply, owner, identities, students };
}
// The fixture's third crc student is "Synthetic Unrelated", ceremony 2027-01-02.
const unrelated = (n = 1, patch: Row = {}) => contact(n, { FirstName: "Synthetic", LastName: "Unrelated", Beit_Mitzvah_Date__c: "2027-01-02", ...patch });

describe("Maven roster intake through the portal MCP", () => {
  it("is the admin's alone; a read-only admin connection can query and propose but not apply", async () => {
    const { t, admin } = await setup();
    const names = async (token: string) => (await t.rpc(token, "tools/list")).body.result.tools.map((x: { name: string }) => x.name);
    expect(await names(admin)).toEqual(expect.arrayContaining(TOOLS));
    const readOnly = (await t.connect("admin", { scope: "portal:read" })).access_token;
    expect(await names(readOnly)).toEqual(expect.arrayContaining(TOOLS.slice(0, 2)));
    expect(await names(readOnly)).not.toContain("apply_roster_changes");
    await t.google("multi");
    const tutor = (await t.connect("multi")).access_token;
    for (const name of TOOLS) {
      expect(await names(tutor)).not.toContain(name);
      expect((await t.rpc(tutor, "tools/call", { name, arguments: {} })).body.error.code).toBe(-32602);
    }
    expect((await t.rpc(readOnly, "tools/call", { name: "apply_roster_changes", arguments: {} })).body.error.code).toBe(-32602);
  });

  it("gives the exact SOQL for the default or a chosen window and refuses a bad one", async () => {
    const { admin, call } = await setup();
    const fallback = (await call(admin, "get_maven_roster_query", {})).json(), window = defaultMavenWindow(Date.now());
    expect(fallback).toMatchObject({ ok: true, window, tool: "maven_run_soql", arguments: (mavenRosterQuery(window) as { query: { arguments: unknown } }).query.arguments });
    expect((Date.parse(window.end) - Date.parse(window.start)) / 86_400_000).toBe(730);
    expect((await call(admin, "get_maven_roster_query", WINDOW)).json()).toMatchObject({ ok: true, window: WINDOW });
    expect((await call(admin, "get_maven_roster_query", { start: "2027-01-01" })).json()).toMatchObject({ ok: false, code: "invalid-window" });
    expect((await call(admin, "get_maven_roster_query", { start: "2027-01-01", end: "2035-01-01" })).json()).toMatchObject({ ok: false, code: "invalid-window" });
    expect((await call(admin, "get_maven_roster_query", { start: "2027-01-01 OR 1=1", end: "2028-01-01" })).isError).toBe(true);
  });

  it("proposes without writing, applies only the chosen rows once, sends nothing and never returns an address", async () => {
    const { t, admin, texts, propose, apply, identities, students, owner } = await setup();
    const rows = [
      unrelated(1),
      contact(2, { FirstName: "Invented", LastName: "Newcomer" }),
      contact(3, { LastName: "Adult", Account: { npe01__One2OneContact__r: { Id: sfid(3), Email: mail("own3") } } }),
      contact(4, { FirstName: null }),
      contact(5, { LastName: "Unreachable", Email: null, AccountId: null, Account: null }),
      contact(6, { LastName: "Not chosen" }),
    ];
    const before = await students();
    const plan = await propose(rows);
    expect(plan).toMatchObject({ ok: true, mavenRows: 6, unchangedRows: [], counts: { reconcile: 1, new: 3, "not-importable": 2 } });
    expect(plan.rows.map((r: { row: number; change: string }) => [r.row, r.change])).toEqual([[1, "reconcile"], [2, "new"], [3, "new"], [4, "not-importable"], [5, "not-importable"], [6, "new"]]);
    expect(plan.rows[0].suggestions).toEqual([{ studentId: t.f.students[2].id, name: "Synthetic Unrelated", ceremonyDate: "2027-01-02", changedFields: [] }]);
    expect(plan.rows[1]).toMatchObject({ name: "Invented Newcomer", canCreateAs: ["child", "adult"], contacts: { contactEmailOnFile: true, householdPrimaryEmailOnFile: true, householdPrimaryIsStudent: false } });
    expect(plan.rows[2]).toMatchObject({ canCreateAs: ["adult"], contacts: { householdPrimaryEmailOnFile: false, householdPrimaryIsStudent: true } });
    expect(plan.rows[3]).toMatchObject({ reason: "missing-name" });
    expect(plan.rows[4]).toMatchObject({ reason: "no-email-on-file" });
    expect(await students()).toEqual(before);

    // A child needs a parent address; this row has only the student's own.
    const adultOnly = await apply(rows, plan.planToken, [{ row: 3, action: "create", studentKind: "child", serviceSlot: "morning" }]);
    expect(adultOnly).toMatchObject({ ok: false, code: "invalid-choices", rows: [{ row: 3, outcome: "invalid-choice", reason: "no-parent-email-on-file-for-a-child" }] });
    expect((await apply(rows, plan.planToken, [{ row: 2, action: "create", studentKind: "child" }])).code).toBe("invalid-choices");
    expect((await apply(rows, plan.planToken, [{ row: 4, action: "update" }])).rows[0]).toMatchObject({ outcome: "invalid-choice", reason: "nothing-to-apply" });
    expect((await apply(rows, plan.planToken, [{ row: 1, action: "link", studentId: t.f.students[0].id }])).rows[0]).toMatchObject({ reason: "not-a-suggested-student" });
    expect(await identities()).toEqual([]);

    const choices = [{ row: 1, action: "link", studentId: t.f.students[2].id }, { row: 2, action: "create", studentKind: "child", serviceSlot: "morning" },
      { row: 3, action: "create", studentKind: "adult", serviceSlot: "havdalah" }];
    const applied = await apply(rows, plan.planToken, choices);
    expect(applied).toMatchObject({ ok: true, applied: 3, alreadyApplied: 0, invitationsSent: 0 });
    expect(applied.rows.map((r: { outcome: string }) => r.outcome)).toEqual(["linked", "created", "created"]);
    const created = (await students()).filter(st => !before.some(b => b.id === st.id)).sort((a, b) => b.lastName.localeCompare(a.lastName));
    expect(created.map(st => [st.lastName, st.studentKind, st.serviceSlot, st.parentEmail, st.ownEmail])).toEqual([
      ["Newcomer", "child", "morning", mail("family2"), null], ["Adult", "adult", "havdalah", null, mail("own3")]]);
    const links = await identities();
    expect(links.map(l => [l.sourceRecordId, l.studentId])).toEqual([[sfid(1), t.f.students[2].id], [sfid(2), created[0].id], [sfid(3), created[1].id]]);
    expect(links.every(l => l.sourceNamespace === "maven" && l.createdByMembershipId === t.f.adminMember.id && l.roleGrantId === t.f.adminGrant.id && l.role === "admin")).toBe(true);
    const audits = await owner(() => t.f.db.select().from(s.auditEvent).where(eq(s.auditEvent.action, "student.import")));
    expect(audits.map(a => a.targetId).sort()).toEqual(created.map(st => st.id).sort());
    // Linking with nothing changed writes no student revision.
    expect((await students()).find(st => st.id === t.f.students[2].id)?.revision).toBe(1);
    // No invitation, no mail: inviting families stays a separate step in the portal.
    expect(await owner(() => t.f.db.select().from(s.invite))).toEqual([]);

    // Re-applying the same plan is reported, not written twice.
    const again = await apply(rows, plan.planToken, choices);
    expect(again).toMatchObject({ ok: true, applied: 0, alreadyApplied: 3 });
    expect((await students()).length).toBe(before.length + 2);
    expect((await identities()).length).toBe(3);
    const next = await propose(rows);
    expect(next.unchangedRows).toEqual([1, 2, 3]);
    expect(next.rows.map((r: { row: number }) => r.row)).toEqual([4, 5, 6]);
    for (const text of texts) expect(text).not.toContain("@");
  });

  it("refuses the whole apply with per-row conflicts when a chosen student changed, and writes nothing", async () => {
    const { t, propose, apply, students, owner, identities } = await setup();
    const first = [unrelated(1), contact(2, { LastName: "Moving" })];
    const setupPlan = await propose(first);
    await apply(first, setupPlan.planToken, [{ row: 1, action: "link", studentId: t.f.students[2].id }, { row: 2, action: "create", studentKind: "child", serviceSlot: "morning" }]);
    const moved = [unrelated(1, { LastName: "Unrelated-Renamed", Hebrew_Name__c: "שם סינתטי" }), contact(2, { LastName: "Moving", Beit_Mitzvah_Date__c: "2027-04-03" })];
    const plan = await propose(moved);
    expect(plan.rows.map((r: { change: string; changedFields: string[] }) => [r.change, r.changedFields])).toEqual([["update", ["lastName", "hebrewName"]], ["update", ["ceremonyDate"]]]);
    const snapshot = await students();
    // Someone edits the first student in the portal after the proposal.
    await owner(() => t.f.db.update(s.student).set({ revision: 2, firstName: "Edited" }).where(eq(s.student.id, t.f.students[2].id)));
    const stale = await apply(moved, plan.planToken, [{ row: 1, action: "update" }, { row: 2, action: "update" }]);
    expect(stale).toMatchObject({ ok: false, code: "conflict", rows: [{ row: 1, outcome: "conflict", reason: "changed-since-proposal" }, { row: 2, outcome: "not-applied" }] });
    const after = await students();
    expect(after.find(st => st.lastName === "Moving")).toEqual(snapshot.find(st => st.lastName === "Moving"));
    expect(await owner(() => t.f.db.select().from(s.auditEvent).where(eq(s.auditEvent.action, "student.update")))).toEqual([]);
    // Proposing again and applying lands both, through the portal's update path and its audit.
    const fresh = await propose(moved);
    expect((await apply(moved, fresh.planToken, [{ row: 1, action: "update" }, { row: 2, action: "update" }])).rows.map((r: { outcome: string; readingsSentToReview: boolean }) => [r.outcome, r.readingsSentToReview]))
      .toEqual([["updated", false], ["updated", true]]);
    const updated = await students();
    expect(updated.find(st => st.id === t.f.students[2].id)).toMatchObject({ firstName: "Synthetic", lastName: "Unrelated-Renamed", hebrewName: "שם סינתטי", revision: 3, parentEmail: t.f.students[2].parentEmail });
    expect(updated.find(st => st.lastName === "Moving")).toMatchObject({ ceremonyDate: "2027-04-03", revision: 2 });
    expect((await owner(() => t.f.db.select().from(s.auditEvent).where(eq(s.auditEvent.action, "student.update")))).length).toBe(2);
    expect((await identities()).length).toBe(2);
    // A disabled linked student is reported, never revived or rewritten.
    await owner(() => t.f.db.update(s.student).set({ disabledAt: new Date(), revision: 4 }).where(eq(s.student.id, t.f.students[2].id)));
    const disabled = await propose(moved);
    expect(disabled.rows[0]).toMatchObject({ row: 1, change: "linked-student-disabled", studentId: t.f.students[2].id });
    expect((await apply(moved, disabled.planToken, [{ row: 1, action: "update" }])).rows[0]).toMatchObject({ outcome: "invalid-choice", reason: "nothing-to-apply" });
  });

  it("refuses a tampered, expired, foreign or mismatched plan token", async () => {
    let offset = 0;
    const { t, admin, propose, apply, identities, students } = await setup(() => Date.now() + offset);
    const rows = [contact(2, { LastName: "Newcomer" })], choice = [{ row: 1, action: "create", studentKind: "child", serviceSlot: "morning" }];
    const plan = await propose(rows), token = plan.planToken as string, before = await students();
    const [kind, body, mac] = token.split(".");
    const flip = (value: string, at: number) => value.slice(0, at) + (value[at] === "A" ? "B" : "A") + value.slice(at + 1);
    for (const forged of [`${kind}.${flip(body, 10)}.${mac}`, `${kind}.${body}.${flip(mac, 5)}`, `mr.${body}.${mac}`, "", token.slice(0, -1)])
      expect((await apply(rows, forged, choice)).code).toBe("plan-token-refused");
    // Another connection of the same admin cannot use it.
    const other = (await t.connect("admin")).access_token;
    expect((await apply(rows, token, choice, other)).code).toBe("plan-token-refused");
    // A different Maven result or window than the one proposed.
    expect((await apply([contact(2, { LastName: "Changed" })], token, choice)).code).toBe("plan-token-refused");
    expect((await t.call(admin, "apply_roster_changes", { start: "2027-01-01", end: "2028-12-30", mavenResult: envelope(rows, { start: "2027-01-01", end: "2028-12-30" }), planToken: token, choices: choice })).json().code).toBe("plan-token-refused");
    // Thirty minutes later the token has expired.
    offset = 31 * 60_000;
    expect((await apply(rows, token, choice)).code).toBe("plan-token-refused");
    offset = 0;
    expect(await students()).toEqual(before);
    expect(await identities()).toEqual([]);
    expect((await apply(rows, token, choice)).ok).toBe(true);
  });

  it("never lets a scheduled routine apply roster changes", async () => {
    const t = await mcpFixture();
    await t.google("admin");
    const routine = (await t.connect("admin", { unattended: true })).access_token;
    const rows = [contact(2)];
    const plan = (await t.call(routine, "propose_roster_changes", { ...WINDOW, mavenResult: envelope(rows) })).json();
    expect(plan.ok).toBe(true);
    const refused = (await t.call(routine, "apply_roster_changes", { ...WINDOW, mavenResult: envelope(rows), planToken: plan.planToken, choices: [{ row: 1, action: "create", studentKind: "child", serviceSlot: "morning" }] })).json();
    expect(refused).toMatchObject({ ok: false, code: "channel-not-permitted" });
    expect(await t.f.owner(() => t.f.db.select().from(s.studentSourceIdentity))).toEqual([]);
  });

  it("refuses a Maven result that is partial or not from the exact query, naming only row numbers and codes", async () => {
    const { admin, call } = await setup();
    const partial = { ...envelope([contact(1)]), completeness: { isComplete: false, returned: 1, total: 2, truncated: true } };
    const refused = (await call(admin, "propose_roster_changes", { ...WINDOW, mavenResult: partial })).json();
    expect(refused).toMatchObject({ ok: false, code: "maven-result-refused", issues: [{ row: 0, code: "incomplete-response" }] });
    const drift = { ...envelope([contact(1)]), provenance: { requestedSoql: "SELECT Id FROM Contact", executor: "compositeBatchQuery", governance: [] } };
    expect((await call(admin, "propose_roster_changes", { ...WINDOW, mavenResult: drift })).json().issues).toEqual([{ row: 0, code: "unexpected-source" }]);
    const outside = (await call(admin, "propose_roster_changes", { ...WINDOW, mavenResult: envelope([contact(1, { Beit_Mitzvah_Date__c: "2030-01-05" })]) })).json();
    expect(outside.issues).toEqual([{ row: 1, code: "outside-window" }]);
    expect(JSON.stringify(outside)).not.toContain("@");
  });

  it("keeps student_source_identity tenant-isolated, insert-only for the runtime and one-to-one", async () => {
    const { t, owner } = await setup();
    const row = (patch: Partial<typeof s.studentSourceIdentity.$inferInsert> = {}) => ({ tenantId: "crc", sourceNamespace: "maven", sourceRecordId: sfid(1), studentId: t.f.students[0].id,
      createdByUserId: t.f.identities.admin.id, createdByMembershipId: t.f.adminMember.id, roleGrantId: t.f.adminGrant.id, role: "admin" as const,
      mcpConnectionId: "", ...patch });
    const [connection] = await owner(() => t.f.db.select({ id: s.mcpConnection.id }).from(s.mcpConnection).limit(1));
    await owner(async () => { await t.f.db.insert(s.studentSourceIdentity).values(row({ mcpConnectionId: connection.id })); });
    const code = async (action: () => Promise<unknown>) => { try { await action(); return ""; } catch (error) { return String((error as { cause?: { code?: string }; code?: string }).cause?.code ?? (error as { code?: string }).code); } };
    const insert = (patch: Partial<typeof s.studentSourceIdentity.$inferInsert>) => owner(async () => { await t.f.db.insert(s.studentSourceIdentity).values(row({ mcpConnectionId: connection.id, ...patch })); });
    expect(await code(() => insert({ studentId: t.f.students[1].id }))).toBe("23505");
    expect(await code(() => insert({ sourceRecordId: sfid(2) }))).toBe("23505");
    expect(await code(() => insert({ sourceRecordId: "short", studentId: t.f.students[1].id }))).toBe("23514");
    expect(await code(() => insert({ sourceNamespace: "csv", sourceRecordId: sfid(3), studentId: t.f.students[1].id }))).toBe("23514");
    expect(await code(() => insert({ sourceRecordId: sfid(4), studentId: t.f.students[3].id }))).toBe("23503");
    expect(await code(() => insert({ sourceRecordId: sfid(5), studentId: t.f.students[1].id, role: "tutor", roleGrantId: t.f.tutorGrant.id, createdByMembershipId: t.f.multiMember.id, createdByUserId: t.f.identities.multi.id }))).toBe("23514");
    const rights = await t.f.client.query<{ sel: boolean; ins: boolean; upd: boolean; del: boolean; rls: boolean; force: boolean }>(
      `select has_table_privilege('portal_runtime','student_source_identity','SELECT') sel, has_table_privilege('portal_runtime','student_source_identity','INSERT') ins,
        has_table_privilege('portal_runtime','student_source_identity','UPDATE') upd, has_table_privilege('portal_runtime','student_source_identity','DELETE') del,
        relrowsecurity rls, relforcerowsecurity force from pg_class where relname='student_source_identity'`);
    expect(rights.rows[0]).toEqual({ sel: true, ins: true, upd: false, del: false, rls: true, force: true });
    await t.f.client.exec("select set_config('app.tenant_id','crc',false)");
    expect((await t.f.client.query("select count(*)::int n from student_source_identity")).rows).toEqual([{ n: 1 }]);
    await expect(t.f.client.exec("update student_source_identity set source_record_id='SYN000000000000009'")).rejects.toThrow(/permission denied/);
    await expect(t.f.client.exec("delete from student_source_identity")).rejects.toThrow(/permission denied/);
    await t.f.client.exec("select set_config('app.tenant_id','other',false)");
    expect((await t.f.client.query("select count(*)::int n from student_source_identity")).rows).toEqual([{ n: 0 }]);
    await expect(t.f.client.query(`insert into student_source_identity(tenant_id,source_namespace,source_record_id,student_id,created_by_user_id,created_by_membership_id,role_grant_id,role,mcp_connection_id)
      values('crc','maven','SYN000000000000007',$1,$2,$3,$4,'admin',$5)`, [t.f.students[1].id, t.f.identities.admin.id, t.f.adminMember.id, t.f.adminGrant.id, connection.id])).rejects.toThrow(/row-level security/);
    await t.f.client.exec("select set_config('app.tenant_id','',false)");
    expect((await t.f.client.query("select count(*)::int n from student_source_identity")).rows).toEqual([{ n: 0 }]);
    expect(await owner(() => t.f.db.select({ n: s.studentSourceIdentity.id }).from(s.studentSourceIdentity).where(and(eq(s.studentSourceIdentity.tenantId, "crc"))))).toHaveLength(1);
  });
});
