import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { eq } from "drizzle-orm";
import * as s from "../../src/server/db/index";
import { mavenRosterQuery } from "../../src/server/students/maven-roster";
import { claudeConnectionsRouteMethods } from "../../src/server/http/claude-connections";
import { ORIGIN, closeMcpFixtures, mcpFixture } from "./mcp-fixture";

afterEach(async () => { vi.restoreAllMocks(); await closeMcpFixtures(); });

// Synthetic Maven only: invented names, 18-character ids and addresses assembled at run time.
const WINDOW = { start: "2027-01-01", end: "2028-12-31" };
const mail = (local: string) => [local, "example.test"].join("@");
const sfid = (n: number) => `SYN${String(n).padStart(15, "0")}`;
type Row = Record<string, unknown>;
const contact = (n: number, patch: Row = {}): Row => ({ Id: sfid(n), FirstName: "Invented", LastName: `Learner ${n}`, Beit_Mitzvah_Date__c: "2027-03-06",
  Not_Having_Beit_Mitzvah__c: false, Hebrew_Name__c: null, Email: mail(`own${n}`), AccountId: sfid(900 + n),
  Account: { npe01__One2OneContact__r: { Id: sfid(500 + n), Email: mail(`family${n}`) } }, ...patch });
// The fixture's third crc student is "Synthetic Unrelated", ceremony 2027-01-02.
const unrelated = (n = 1) => contact(n, { FirstName: "Synthetic", LastName: "Unrelated", Beit_Mitzvah_Date__c: "2027-01-02" });
function envelope(rows: Row[]) {
  const built = mavenRosterQuery(WINDOW); if (!built.ok) throw Error("Synthetic window invalid");
  return { status: rows.length ? "complete" : "no_data", completeness: { isComplete: true, returned: rows.length, total: rows.length, truncated: false },
    partialFailures: [], countSource: "none", partialReason: null, denied: false, tuitionIncluded: false, shadowWarning: null,
    rows, rowCount: rows.length, count: null, pagination: { totalSize: rows.length, returned: rows.length, done: true, appliedLimit: 501 },
    provenance: { requestedSoql: built.query.arguments.soql, executor: "compositeBatchQuery", governance: ["object-allow-list"] },
    privacy: { pastoralContext: false, financialIncluded: false } };
}
const ALL = "portal:read portal:study portal:roster";

async function setup() {
  const t = await mcpFixture();
  await t.google("admin");
  const admin = (await t.connect("admin", { scope: ALL })).access_token as string;
  const propose = async (rows: Row[]) => (await t.call(admin, "propose_roster_changes", { ...WINDOW, mavenResult: envelope(rows) })).json();
  const apply = async (rows: Row[], planToken: string, choices: unknown[]) => (await t.call(admin, "apply_roster_changes", { ...WINDOW, mavenResult: envelope(rows), planToken, choices })).json();
  const unlink = async (studentId: string, mavenContactId: string, token = admin) => (await t.call(token, "unlink_maven_record", { studentId, mavenContactId })).json();
  const owner = <T>(action: () => Promise<T>) => t.f.owner(action);
  const identities = () => owner(() => t.f.db.select().from(s.studentSourceIdentity).orderBy(s.studentSourceIdentity.createdAt, s.studentSourceIdentity.id));
  const audits = () => owner(() => t.f.db.select().from(s.auditEvent).where(eq(s.auditEvent.action, "source-identity.revoke")).orderBy(s.auditEvent.createdAt));
  const connectionId = async () => (await owner(() => t.f.db.select({ id: s.mcpConnection.id }).from(s.mcpConnection)))[0].id;
  // Link Maven row 1 to the fixture's "Synthetic Unrelated" (its name-and-date suggestion).
  const linkUnrelated = async () => {
    const rows = [unrelated(1)], plan = await propose(rows);
    expect(plan.rows[0]).toMatchObject({ row: 1, change: "reconcile" });
    expect((await apply(rows, plan.planToken, [{ row: 1, action: "link", studentId: t.f.students[2].id }])).rows[0].outcome).toBe("linked");
  };
  return { t, admin, propose, apply, unlink, owner, identities, audits, connectionId, linkUnrelated };
}

describe("undoing a wrong Maven link", () => {
  it("unlinks through Claude only for the exact current pair, audits it, and lets the record be linked again without reviving the old link", async () => {
    const { t, propose, apply, unlink, identities, audits, connectionId, linkUnrelated } = await setup();
    await linkUnrelated();
    const wrong = t.f.students[2].id, rows = [unrelated(1)];
    // A plan made while the link stood: the row is unchanged.
    const stale = await propose(rows);
    expect(stale.unchangedRows).toEqual([1]);
    // Only the exact current pair is unlinked; anything else changes nothing and says what is linked now.
    expect(await unlink(wrong, sfid(9))).toMatchObject({ ok: false, code: "not-linked", currentRecordId: sfid(1) });
    expect(await unlink(t.f.students[0].id, sfid(1))).toMatchObject({ ok: false, code: "not-linked", currentRecordId: null });
    expect(await audits()).toHaveLength(0);
    const done = await unlink(wrong, sfid(1));
    expect(done).toMatchObject({ ok: true, studentId: wrong, mavenContactId: sfid(1) });
    const [first] = await identities();
    expect(first).toMatchObject({ sourceRecordId: sfid(1), studentId: wrong, linkKind: "linked", revokedByUserId: t.f.identities.admin.id, revokedByMembershipId: t.f.adminMember.id,
      revokedRoleGrantId: t.f.adminGrant.id, revokedRole: "admin", revokedChannel: "mcp", revokedMcpConnectionId: await connectionId() });
    expect(first.revokedAt!.toISOString()).toBe(done.unlinkedAt);
    const [audit] = await audits();
    expect(audit).toMatchObject({ actorUserId: t.f.identities.admin.id, roleGrantId: t.f.adminGrant.id, mode: "admin", actingStudentId: wrong, targetType: "student_source_identity", targetId: first.id });
    // Unlinking again changes nothing.
    expect(await unlink(wrong, sfid(1))).toMatchObject({ ok: false, code: "not-linked", currentRecordId: null });
    expect(await audits()).toHaveLength(1);
    // The plan made before the unlink is refused as changed; nothing is written and the link does not come back.
    const replay = await apply(rows, stale.planToken, [{ row: 1, action: "update" }]);
    expect(replay).toMatchObject({ ok: false, code: "conflict" });
    expect(await identities()).toHaveLength(1);
    // Proposed again, the row is open: the rabbi says it is a new student this time.
    const fresh = await propose(rows);
    expect(fresh.rows[0]).toMatchObject({ row: 1, change: "reconcile" });
    expect(fresh.rows[0].suggestions[0]).toMatchObject({ studentId: wrong });
    expect(fresh.rows[0].suggestions[0].blocked).toBeUndefined();
    const created = await apply(rows, fresh.planToken, [{ row: 1, action: "create", studentKind: "child", serviceSlot: "unknown" }]);
    expect(created.rows[0].outcome).toBe("created");
    const relinked = await identities();
    expect(relinked.map(r => [r.studentId, r.linkKind, r.revokedAt === null])).toEqual([[wrong, "linked", false], [created.rows[0].studentId, "created", true]]);
    // A stale request naming the old pair never touches the new link.
    expect(await unlink(wrong, sfid(1))).toMatchObject({ ok: false, currentRecordId: null });
    // The same pair can be linked again too: a third row, while both earlier rows stay as they were.
    expect((await unlink(created.rows[0].studentId, sfid(1))).ok).toBe(true);
    const again = await propose(rows);
    expect((await apply(rows, again.planToken, [{ row: 1, action: "link", studentId: wrong }])).rows[0].outcome).toBe("linked");
    const final = await identities();
    expect(final.map(r => [r.studentId, r.revokedAt === null])).toEqual([[wrong, false], [created.rows[0].studentId, false], [wrong, true]]);
    expect(final[0].revokedAt).toEqual(first.revokedAt);
    expect(await audits()).toHaveLength(2);
    expect((await propose(rows)).unchangedRows).toEqual([1]);
  });

  it("is an attended admin roster tool only: study, read-only, tutor and routine connections neither see nor reach it", async () => {
    const { t, linkUnrelated, identities } = await setup();
    await linkUnrelated();
    await t.google("multi");
    const tokens = [(await t.connect("admin", { scope: "portal:read portal:study" })).access_token, (await t.connect("admin", { unattended: true })).access_token, (await t.connect("multi", { scope: ALL })).access_token];
    for (const token of tokens) {
      expect((await t.rpc(token, "tools/list")).body.result.tools.map((x: { name: string }) => x.name)).not.toContain("unlink_maven_record");
      expect((await t.rpc(token, "tools/call", { name: "unlink_maven_record", arguments: { studentId: t.f.students[2].id, mavenContactId: sfid(1) } })).body.error.code).toBe(-32602);
    }
    expect((await identities()).every(r => r.revokedAt === null)).toBe(true);
  });

  it("shows the link in the admin roster and unlinks it there, for the admin alone and only within the congregation", async () => {
    const { t, identities, audits, linkUnrelated } = await setup();
    await linkUnrelated();
    const student = t.f.students[2].id, cookie = (who: "admin" | "multi" | "learner") => ({ cookie: t.f.identities[who].cookie });
    const read = (who: "admin" | "multi" | "learner", id = student) => t.dispatch(new Request(`${ORIGIN}/api/admin/maven-link?studentId=${id}`, { headers: cookie(who) }));
    const post = (who: "admin" | "multi" | "learner", body: unknown, headers: Record<string, string> = {}) => t.postJson("/api/admin/maven-link/unlink", body, { ...cookie(who), origin: ORIGIN, "sec-fetch-site": "same-origin", ...headers });
    const shown = await read("admin");
    expect(shown.status).toBe(200); expect(shown.headers.get("cache-control")).toContain("no-store");
    const [row] = await identities();
    expect(await shown.json()).toEqual({ ok: true, link: { mavenContactId: sfid(1), linkKind: "linked", linkedAt: row.createdAt.toISOString() } });
    expect(await (await read("admin", t.f.students[0].id)).json()).toEqual({ ok: true, link: null });
    // Another congregation's student looks unlinked; tutors, parents, students and strangers are refused.
    expect(await (await read("admin", t.f.students[3].id)).json()).toEqual({ ok: true, link: null });
    expect((await read("multi")).status).toBe(403);
    expect((await read("learner")).status).toBe(403);
    expect((await t.dispatch(new Request(`${ORIGIN}/api/admin/maven-link?studentId=${student}`))).status).toBe(401);
    expect((await t.dispatch(new Request(`${ORIGIN}/api/admin/maven-link?studentId=nope`, { headers: cookie("admin") }))).status).toBe(404);
    expect((await t.dispatch(new Request(`${ORIGIN}/api/admin/maven-link`, { headers: cookie("admin") }))).status).toBe(404);
    expect((await t.dispatch(new Request(`${ORIGIN}/api/admin/maven-link?studentId=${student}&x=1`, { headers: cookie("admin") }))).status).toBe(400);
    expect(claudeConnectionsRouteMethods("/api/admin/maven-link")).toEqual(["GET"]);
    expect(claudeConnectionsRouteMethods("/api/admin/maven-link/unlink")).toEqual(["POST"]);
    // Refused unlinks change nothing.
    expect((await post("multi", { studentId: student, mavenContactId: sfid(1) })).status).toBe(403);
    expect((await post("admin", { studentId: student, mavenContactId: sfid(1) }, { origin: "https://evil.example" })).status).toBe(403);
    expect((await post("admin", { studentId: student, mavenContactId: "short" })).status).toBe(404);
    expect((await post("admin", { studentId: student, mavenContactId: sfid(1), extra: true })).status).toBe(400);
    const foreign = await post("admin", { studentId: t.f.students[3].id, mavenContactId: sfid(1) });
    expect(foreign.status).toBe(409); expect(await foreign.json()).toEqual({ ok: false, code: "not-linked" });
    expect((await identities())[0].revokedAt).toBeNull();
    const done = await post("admin", { studentId: student, mavenContactId: sfid(1) });
    expect(done.status).toBe(200); expect((await done.json()).ok).toBe(true);
    expect((await identities())[0]).toMatchObject({ revokedChannel: "web", revokedMcpConnectionId: null, revokedByUserId: t.f.identities.admin.id, revokedRoleGrantId: t.f.adminGrant.id });
    expect((await audits())[0]).toMatchObject({ actingStudentId: student, targetId: row.id, mode: "admin" });
    expect(await (await read("admin")).json()).toEqual({ ok: true, link: null });
    expect((await post("admin", { studentId: student, mavenContactId: sfid(1) })).status).toBe(409);
    expect(await audits()).toHaveLength(1);
  });

  it("lets the runtime set only the revocation, once, inside its own congregation, and keeps one current link per record and per student", async () => {
    const { t, owner, identities, linkUnrelated, connectionId } = await setup();
    await linkUnrelated();
    const [row] = await identities(), admin = [t.f.identities.admin.id, t.f.adminMember.id, t.f.adminGrant.id];
    const code = async (action: () => Promise<unknown>) => { try { await action(); return ""; } catch (error) { return String((error as { code?: string }).code); } };
    const revoke = (extra = "", values: unknown[] = [...admin, row.id]) => t.f.client.query(`update student_source_identity set revoked_at=now(), revoked_by_user_id=$1, revoked_by_membership_id=$2, revoked_role_grant_id=$3, revoked_role='admin', revoked_channel='web'${extra} where id=$4`, values);
    const privileges = await t.f.client.query<{ column_name: string; upd: boolean }>(`select column_name::text, has_column_privilege('portal_runtime','student_source_identity',column_name,'UPDATE') upd
      from information_schema.columns where table_name='student_source_identity' order by column_name`);
    expect(privileges.rows.filter(r => r.upd).map(r => r.column_name)).toEqual(["revoked_at", "revoked_by_membership_id", "revoked_by_user_id", "revoked_channel", "revoked_mcp_connection_id", "revoked_role", "revoked_role_grant_id"].sort());
    const table = await t.f.client.query("select has_table_privilege('portal_runtime','student_source_identity','UPDATE') upd, has_table_privilege('portal_runtime','student_source_identity','DELETE') del, relforcerowsecurity force from pg_class where relname='student_source_identity'");
    expect(table.rows[0]).toEqual({ upd: false, del: false, force: true });
    await t.f.client.exec("select set_config('app.tenant_id','crc',false)");
    await expect(t.f.client.exec(`update student_source_identity set student_id='${t.f.students[0].id}'`)).rejects.toThrow(/permission denied/);
    await expect(t.f.client.exec("delete from student_source_identity")).rejects.toThrow(/permission denied/);
    // Half a revocation, or a web revocation naming a connection, is refused by the check.
    expect(await code(() => t.f.client.query("update student_source_identity set revoked_at=now() where id=$1", [row.id]))).toBe("23514");
    expect(await code(() => revoke(", revoked_mcp_connection_id=$5", [...admin, row.id, row.id]))).not.toBe("");
    expect(await code(() => t.f.client.query(`update student_source_identity set revoked_at=now(), revoked_by_user_id=$1, revoked_by_membership_id=$2, revoked_role_grant_id=$3, revoked_role='admin', revoked_channel='mcp' where id=$4`, [...admin, row.id]))).toBe("23514");
    // A tutor grant cannot be the revoker: the admin role is bound to the grant by foreign key.
    expect(await code(() => revoke("", [t.f.identities.multi.id, t.f.multiMember.id, t.f.tutorGrant.id, row.id]))).toBe("23503");
    // Another congregation's scope sees no row to revoke.
    await t.f.client.exec("select set_config('app.tenant_id','other',false)");
    expect((await revoke()).affectedRows ?? 0).toBe(0);
    await t.f.client.exec("select set_config('app.tenant_id','crc',false)");
    expect((await revoke()).affectedRows).toBe(1);
    // Once revoked, nothing about the row may change again: not a second revocation, not a revival.
    expect(await code(() => revoke())).toBe("23514");
    expect(await code(() => t.f.client.query("update student_source_identity set revoked_at=null, revoked_by_user_id=null, revoked_by_membership_id=null, revoked_role_grant_id=null, revoked_role=null, revoked_channel=null where id=$1", [row.id]))).toBe("23514");
    await t.f.client.exec("select set_config('app.tenant_id','',false)");
    // The owner is held to the same once-only rule.
    expect(await code(() => owner(() => t.f.client.query("update student_source_identity set revoked_at=null where id=$1", [row.id])))).toBe("23514");
    // Current links stay one-to-one; history does not count.
    const connection = await connectionId();
    const insert = (studentId: string) => owner(() => t.f.client.query(`insert into student_source_identity(tenant_id,source_namespace,source_record_id,student_id,created_by_user_id,created_by_membership_id,role_grant_id,role,mcp_connection_id,link_kind)
      values('crc','maven',$1,$2,$3,$4,$5,'admin',$6,'linked')`, [sfid(1), studentId, ...admin, connection]));
    expect(await code(() => insert(t.f.students[2].id))).toBe("");
    expect(await code(() => insert(t.f.students[1].id))).toBe("23505");
    expect((await identities()).map(r => r.revokedAt === null)).toEqual([false, true]);
  });
});
