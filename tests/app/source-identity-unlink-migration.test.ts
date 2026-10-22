import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { expect, test } from "vitest";
import { isolatedEnv } from "../helpers/isolatedEnv.mjs";

const TAG = "0033_source_identity_unlink";
const PRIOR_ACTIONS = ["student.create", "tenant-settings.set", "study-theme.read", "honoree.reissue", "invite.delivery-failed", "source-assignment.set"];

test("0033 makes Maven links revocable once, keeps every existing link current and unchanged, and replays", async () => {
  const isolation = await isolatedEnv(), client = new PGlite();
  try {
    const folder = "src/server/db/migrations", journal = JSON.parse(await readFile(join(folder, "meta/_journal.json"), "utf8"));
    // Everything before this migration: a later one applied first would make the migrator skip this one as already past.
    const own = journal.entries.findIndex((e: { tag: string }) => e.tag === TAG);
    expect(own).toBeGreaterThan(0);
    const entries = journal.entries.slice(0, own), prior = join(isolation.home, "prior");
    await mkdir(join(prior, "meta"), { recursive: true }); await writeFile(join(prior, "meta/_journal.json"), JSON.stringify({ ...journal, entries }));
    for (const e of entries) await copyFile(join(folder, e.tag + ".sql"), join(prior, e.tag + ".sql"));
    const db = drizzle(client); await migrate(db, { migrationsFolder: prior });
    // A production-shaped link made by an admin's apply through Claude.
    const student = randomUUID(), member = randomUUID(), grant = randomUUID(), connection = randomUUID();
    await client.query("insert into student(id,tenant_id,first_name,last_name,ceremony_date,parent_email) values($1,'crc','Synthetic','Linked','2027-01-02','linked@example.test')", [student]);
    await client.query("insert into \"user\"(id,name,email,email_verified) values('admin-a','Synthetic admin',$1,true)", [["admin-a", "example.test"].join("@")]);
    await client.query("insert into membership(id,tenant_id,user_id) values($1,'crc','admin-a')", [member]);
    await client.query("insert into role_grant(id,tenant_id,membership_id,role) values($1,'crc',$2,'admin')", [grant, member]);
    await client.query(`insert into mcp_connection(id,tenant_id,user_id,membership_id,role_grant_id,role,role_grant_revision,authority_revision,scope,unattended,client_name,client_hash,redirect_uri,expires_at)
      values($1,'crc','admin-a',$2,$3,'admin',1,1,'portal:read portal:roster',false,'Claude',$4,'https://claude.ai/api/mcp/auth_callback',now()+interval '30 days')`, [connection, member, grant, "a".repeat(64)]);
    await client.query(`insert into student_source_identity(tenant_id,source_namespace,source_record_id,student_id,created_by_user_id,created_by_membership_id,role_grant_id,role,mcp_connection_id,link_kind)
      values('crc','maven','SYN000000000000001',$1,'admin-a',$2,$3,'admin',$4,'created')`, [student, member, grant, connection]);
    const before = (await client.query("select * from student_source_identity")).rows as Record<string, unknown>[];
    const audits = (await client.query("select count(*)::int n from audit_event")).rows;
    await migrate(db, { migrationsFolder: folder }); await migrate(db, { migrationsFolder: folder });
    const after = (await client.query("select * from student_source_identity")).rows as Record<string, unknown>[];
    // Every existing value is untouched; the new revocation columns are all empty, so the link stays current.
    expect(after.map(row => Object.fromEntries(Object.keys(before[0]).map(key => [key, row[key]])))).toEqual(before);
    for (const key of ["revoked_at", "revoked_by_user_id", "revoked_by_membership_id", "revoked_role_grant_id", "revoked_role", "revoked_channel", "revoked_mcp_connection_id"]) expect(after[0][key]).toBeNull();
    expect((await client.query("select count(*)::int n from audit_event")).rows).toEqual(audits);
    // The generated snapshot changes only this table and the audit action list, which keeps every earlier action.
    const snapshot = (tag: string) => join(folder, `meta/${String(journal.entries.find((e: { tag: string }) => e.tag === tag).idx).padStart(4, "0")}_snapshot.json`);
    const previous = JSON.parse(await readFile(snapshot(journal.entries[own - 1].tag), "utf8")), current = JSON.parse(await readFile(snapshot(TAG), "utf8"));
    const expected = structuredClone(previous.tables);
    expected["public.student_source_identity"] = current.tables["public.student_source_identity"];
    expected["public.audit_event"].checkConstraints.audit_action_known = current.tables["public.audit_event"].checkConstraints.audit_action_known;
    expect(current.prevId).toBe(previous.id); expect(current.tables).toEqual(expected);
    const actions = (value: string) => [...value.matchAll(/'([a-z.-]+)'/g)].map(m => m[1]);
    const was = actions(previous.tables["public.audit_event"].checkConstraints.audit_action_known.value), now = actions(current.tables["public.audit_event"].checkConstraints.audit_action_known.value);
    for (const action of [...was, ...PRIOR_ACTIONS]) expect(now).toContain(action);
    for (const action of ["mcp-connection.revoke", "source-identity.revoke", "notification-preference.set", "notification.unsubscribe"]) expect(now).toContain(action);
    const table = current.tables["public.student_source_identity"];
    expect(table.uniqueConstraints).toEqual({});
    expect(Object.keys(table.indexes).sort()).toEqual(["student_source_identity_record_current", "student_source_identity_student_current"]);
    for (const name of Object.keys(table.indexes)) expect(table.indexes[name]).toMatchObject({ isUnique: true, where: "\"student_source_identity\".\"revoked_at\" is null" });
    // Row security, the trigger and the runtime's column grant are hand-written beside the generated DDL; nothing wider.
    const sql = await readFile(join(folder, `${TAG}.sql`), "utf8");
    expect(sql).toContain("GRANT UPDATE (revoked_at, revoked_by_user_id, revoked_by_membership_id, revoked_role_grant_id, revoked_role, revoked_channel, revoked_mcp_connection_id) ON student_source_identity TO portal_runtime;");
    expect(sql).toContain("CREATE TRIGGER student_source_identity_revoke_once BEFORE UPDATE ON student_source_identity");
    expect(sql).not.toMatch(/GRANT\s+(ALL|DELETE|TRUNCATE|UPDATE\s+ON)/i);
    expect(sql).not.toMatch(/(DISABLE|NO FORCE) ROW LEVEL SECURITY|DROP POLICY|CREATE POLICY/i);
    const security = await client.query("select relrowsecurity rls, relforcerowsecurity force from pg_class where relname='student_source_identity'");
    expect(security.rows).toEqual([{ rls: true, force: true }]);
    const policy = await client.query<{ policyname: string; cmd: string; roles: string[] }>("select policyname, cmd, roles::text[] as roles from pg_policies where tablename='student_source_identity'");
    expect(policy.rows).toEqual([{ policyname: "tenant_isolation", cmd: "ALL", roles: ["portal_runtime"] }]);
    const triggers = await client.query("select tgname from pg_trigger where tgrelid='student_source_identity'::regclass and not tgisinternal");
    expect(triggers.rows).toEqual([{ tgname: "student_source_identity_revoke_once" }]);
  } finally { await client.close(); await isolation.cleanup(); }
});
