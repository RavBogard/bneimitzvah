import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { isolatedEnv } from "../helpers/isolatedEnv.mjs";
import { priorColumns } from "../helpers/prior-columns";

// Readings for everyone (Daniel, 2026-10-27), migration 0054: the learner_claim table (one tutor at a time per learner, revoked whole),
// a link request's target student, two audit actions, and the saved layer's two read-only policies (staff_read on each saved table for
// the one learner named by app.saved_viewer; directory_read on saved_reading alone while app.saved_directory is 'on'). The owner_only
// policies of 0036 are untouched. Nothing existing changes, and it replays.
const TAG = "0054_readings_for_everyone", TABLE = "learner_claim", SAVED = ["saved_reading", "saved_verse_mark", "saved_verse_work", "starred_comment"];
const tenant = "(tenant_id = NULLIF(current_setting('app.tenant_id'::text, true), ''::text))";
const viewer = `(${tenant} AND (membership_id = (NULLIF(current_setting('app.saved_viewer'::text, true), ''::text))::uuid))`;
const directory = `(${tenant} AND (current_setting('app.saved_directory'::text, true) = 'on'::text))`;

test("0054 adds learner_claim, the link request's student, two audit actions and the saved layer's read-only policies; nothing existing changes; it replays", async () => {
  const isolation = await isolatedEnv(), client = new PGlite();
  try {
    const folder = "src/server/db/migrations", journal = JSON.parse(await readFile(join(folder, "meta/_journal.json"), "utf8"));
    const own = journal.entries.findIndex((e: { tag: string }) => e.tag === TAG);
    expect(journal.entries[own]).toMatchObject({ idx: 53, tag: TAG });
    expect(journal.entries[own].when).toBeGreaterThan(journal.entries.find((e: { tag: string }) => e.tag === "0053_tutor_invite_hold").when);
    const entries = journal.entries.slice(0, own), prior = join(isolation.home, "prior");
    await mkdir(join(prior, "meta"), { recursive: true }); await writeFile(join(prior, "meta/_journal.json"), JSON.stringify({ ...journal, entries }));
    for (const e of entries) await copyFile(join(folder, e.tag + ".sql"), join(prior, e.tag + ".sql"));
    const db = drizzle(client); await migrate(db, { migrationsFolder: prior });
    // Synthetic people: a learner with a shelf, a second member with a shelf, a rabbi who is also a tutor, and a learner in another congregation.
    await client.query("insert into tenant(id,name,product_name) values('other','Synthetic other','Synthetic')");
    const people: Record<string, { user: string; member: string }> = {};
    for (const [key, tenantId] of [["learner", "crc"], ["second", "crc"], ["rabbi", "crc"], ["away", "other"]] as const) {
      const user = `claim-${key}`, member = randomUUID();
      await client.query("insert into \"user\"(id,name,email,email_verified) values($1,'Synthetic person',$2,true)", [user, [user, "example.test"].join("@")]);
      await client.query("insert into membership(id,tenant_id,user_id) values($1,$2,$3)", [member, tenantId, user]);
      people[key] = { user, member };
    }
    const adminGrant = randomUUID(), tutorGrant = randomUUID(), parentGrant = randomUUID(), awayTutor = randomUUID();
    await client.query("insert into role_grant(id,tenant_id,membership_id,role) values($1,'crc',$2,'admin'),($3,'crc',$2,'tutor'),($4,'crc',$5,'parent'),($6,'other',$7,'tutor')",
      [adminGrant, people.rabbi.member, tutorGrant, parentGrant, people.second.member, awayTutor, people.away.member]);
    const [student] = (await client.query<{ id: string }>("insert into student(tenant_id,first_name,last_name,ceremony_date,parent_email) values('crc','Synthetic','Claimed','2027-01-02','family@example.test') returning id")).rows;
    const [awayStudent] = (await client.query<{ id: string }>("insert into student(tenant_id,first_name,last_name,ceremony_date,parent_email) values('other','Synthetic','Away','2027-01-02','family@example.test') returning id")).rows;
    const [link] = (await client.query<{ id: string }>("insert into tutor_student(tenant_id,student_id,tutor_grant_id) values('crc',$1,$2) returning id", [student.id, tutorGrant])).rows;
    const readings: Record<string, string> = {};
    for (const key of ["learner", "second"] as const) {
      const { user, member } = people[key];
      readings[key] = (await client.query<{ id: string }>("insert into saved_reading(tenant_id,membership_id,user_id,name,kind,ranges,verse_count) values('crc',$1,$2,'Synthetic','torah','Genesis 1:1-3',3) returning id", [member, user])).rows[0].id;
      await client.query("insert into saved_verse_work(tenant_id,membership_id,saved_reading_id,verse_ref,stream,text,version) values('crc',$1,$2,'Genesis 1:1','note','private',1)", [member, readings[key]]);
      await client.query("insert into saved_verse_mark(tenant_id,membership_id,saved_reading_id,verse_ref,state,version) values('crc',$1,$2,'Genesis 1:1','working',1)", [member, readings[key]]);
      await client.query("insert into starred_comment(tenant_id,membership_id,user_id,work,verse_ref,comment_index) values('crc',$1,$2,'rashi','Genesis 1:1',1)", [member, user]);
    }
    await client.query("insert into account_request(tenant_id,user_id,display_name) values('crc',$1,'Synthetic asker')", [people.learner.user]);
    const audit = (action: string) => client.query("insert into audit_event(tenant_id,actor_user_id,actor_membership_id,mode,role_grant_id,action,target_type,target_id,request_id) values('crc',$1,$2,'tutor',$3,$4,'learner_claim',$5,$6)",
      [people.rabbi.user, people.rabbi.member, tutorGrant, action, randomUUID(), randomUUID()]);
    await audit("tutor.assign");
    // Before 0054: no claim table, no target student, neither action.
    await expect(audit("learner.claim")).rejects.toThrow();
    await expect(client.query("select student_id from account_request")).rejects.toThrow();
    await expect(client.query(`select count(*) from ${TABLE}`)).rejects.toThrow();
    const tables = ["student", "membership", "role_grant", "tutor_student", "account_request", "audit_event", "tenant", ...SAVED];
    const capture = async () => Object.fromEntries(await Promise.all(tables.map(async t => [t, (await client.query(`select * from ${t} order by 1`)).rows])));
    const before = await capture();
    await migrate(db, { migrationsFolder: folder }); await migrate(db, { migrationsFolder: folder });
    const after = await capture();
    for (const table of tables) expect(priorColumns(after[table], before[table])).toEqual(before[table]);
    expect((await client.query(`select count(*)::int as n from ${TABLE}`)).rows).toEqual([{ n: 0 }]);
    // The link request's target: empty for a request made before, a student of this congregation only.
    expect((await client.query("select student_id from account_request")).rows).toEqual([{ student_id: null }]);
    await expect(client.query("update account_request set student_id = $1", [awayStudent.id])).rejects.toThrow();
    await client.query("update account_request set student_id = $1", [student.id]);
    await audit("learner.claim"); await audit("learner.unclaim");
    await expect(audit("learner.unknown")).rejects.toThrow();

    // The generated snapshot adds the one table, the one column with its FK and the two actions, and changes nothing else.
    const snapshots = (await readdir(join(folder, "meta"))).filter(name => /^\d{4}_snapshot\.json$/.test(name)).sort();
    const at = snapshots.indexOf("0054_snapshot.json");
    expect(at).toBeGreaterThan(0);
    const previous = JSON.parse(await readFile(join(folder, "meta", snapshots[at - 1]), "utf8")), current = JSON.parse(await readFile(join(folder, "meta/0054_snapshot.json"), "utf8"));
    expect(current.prevId).toBe(previous.id);
    const actions = (value: string) => value.match(/'[^']+'/g)!.map(v => v.slice(1, -1));
    expect(actions(current.tables["public.audit_event"].checkConstraints.audit_action_known.value)).toEqual([...actions(previous.tables["public.audit_event"].checkConstraints.audit_action_known.value), "learner.claim", "learner.unclaim"]);
    const expected = structuredClone(previous.tables);
    expected[`public.${TABLE}`] = current.tables[`public.${TABLE}`];
    expected["public.account_request"].columns.student_id = current.tables["public.account_request"].columns.student_id;
    expected["public.account_request"].foreignKeys.account_request_student_fk = current.tables["public.account_request"].foreignKeys.account_request_student_fk;
    expected["public.audit_event"].checkConstraints.audit_action_known = current.tables["public.audit_event"].checkConstraints.audit_action_known;
    expect(current.tables).toEqual(expected);
    expect(current.tables["public.account_request"].columns.student_id).toMatchObject({ type: "uuid", notNull: false });
    for (const key of ["enums", "schemas", "sequences", "roles", "policies", "views"]) expect(current[key]).toEqual(previous[key]);

    // Row security and grants are hand-written beside the generated DDL; the file never names the owner setting.
    const text = await readFile(join(folder, `${TAG}.sql`), "utf8");
    expect(text).not.toContain("\r");
    expect(text).toMatch(/^[\x09\x0a\x20-\x7e]*$/);
    expect(text).not.toContain("app.saved_" + "owner");
    for (const line of [`ALTER TABLE ${TABLE} ENABLE ROW LEVEL SECURITY;`, `ALTER TABLE ${TABLE} FORCE ROW LEVEL SECURITY;`, `REVOKE ALL ON ${TABLE} FROM PUBLIC;`, `REVOKE ALL ON ${TABLE} FROM portal_runtime;`,
      `GRANT SELECT ON ${TABLE} TO portal_runtime;`, `GRANT INSERT (tenant_id, learner_membership_id, tutor_grant_id, tutor_link_id) ON ${TABLE} TO portal_runtime;`,
      `GRANT UPDATE (revoked_at, revoked_by, revoked_by_membership_id) ON ${TABLE} TO portal_runtime;`]) expect(text).toContain(line);
    const code = text.split("\n").filter(line => !line.trim().startsWith("--")).join("\n");
    expect(code).not.toMatch(/GRANT[^;]*(DELETE|TRUNCATE|ALL)[^;]*ON learner_claim/i);
    expect(code).not.toMatch(/GRANT[^;]*ON (saved_reading|saved_verse_work|saved_verse_mark|starred_comment)/i);
    expect(code).not.toMatch(/DISABLE ROW LEVEL SECURITY|NO FORCE|DROP POLICY|DROP TABLE|ALTER POLICY|ALTER TABLE "?(saved_reading|saved_verse_work|saved_verse_mark|starred_comment|student|membership|role_grant|tutor_student)"? /i);
    expect(code.match(/CREATE POLICY/g)).toHaveLength(6);
    expect(code.match(/FOR SELECT/g)).toHaveLength(5);
    const rls = await client.query("select relname, relrowsecurity, relforcerowsecurity from pg_class where relname = any($1) and relkind='r' order by relname", [[TABLE, ...SAVED]]);
    expect(rls.rows).toEqual([TABLE, ...SAVED].sort().map(relname => ({ relname, relrowsecurity: true, relforcerowsecurity: true })));
    const policies = await client.query<{ tablename: string; policyname: string; cmd: string; permissive: string; roles: string[]; qual: string | null; with_check: string | null }>(
      "select tablename, policyname, cmd, permissive, roles::text[] as roles, qual, with_check from pg_policies where tablename = any($1) order by tablename, policyname", [[TABLE, ...SAVED]]);
    const owner = "((tenant_id = NULLIF(current_setting('app.tenant_id'::text, true), ''::text)) AND (membership_id = (NULLIF(current_setting('app.saved_" + "owner'::text, true), ''::text))::uuid))";
    const ownerOnly = (tablename: string) => ({ tablename, policyname: "owner_only", cmd: "ALL", permissive: "PERMISSIVE", roles: ["portal_runtime"], qual: owner, with_check: owner });
    const staffRead = (tablename: string) => ({ tablename, policyname: "staff_read", cmd: "SELECT", permissive: "PERMISSIVE", roles: ["portal_runtime"], qual: viewer, with_check: null });
    expect(policies.rows).toEqual([
      { tablename: TABLE, policyname: "tenant_isolation", cmd: "ALL", permissive: "PERMISSIVE", roles: ["portal_runtime"], qual: tenant, with_check: tenant },
      { tablename: "saved_reading", policyname: "directory_read", cmd: "SELECT", permissive: "PERMISSIVE", roles: ["portal_runtime"], qual: directory, with_check: null },
      ownerOnly("saved_reading"), staffRead("saved_reading"), ownerOnly("saved_verse_mark"), staffRead("saved_verse_mark"), ownerOnly("saved_verse_work"), staffRead("saved_verse_work"),
      ownerOnly("starred_comment"), staffRead("starred_comment")]);
    expect((await client.query("select privilege_type from information_schema.table_privileges where grantee='portal_runtime' and table_name = $1 order by privilege_type", [TABLE])).rows).toEqual([{ privilege_type: "SELECT" }]);
    expect((await client.query("select column_name from information_schema.column_privileges where grantee='portal_runtime' and privilege_type='INSERT' and table_name = $1 order by column_name", [TABLE])).rows)
      .toEqual(["learner_membership_id", "tenant_id", "tutor_grant_id", "tutor_link_id"].map(column_name => ({ column_name })));
    expect((await client.query("select column_name from information_schema.column_privileges where grantee='portal_runtime' and privilege_type='UPDATE' and table_name = $1 order by column_name", [TABLE])).rows)
      .toEqual(["revoked_at", "revoked_by", "revoked_by_membership_id"].map(column_name => ({ column_name })));
    expect((await client.query("select count(*)::int as n from information_schema.table_privileges where grantee='PUBLIC' and table_name = $1", [TABLE])).rows).toEqual([{ n: 0 }]);
    // The saved tables' grants are exactly what 0036 and 0040 gave: a read-only policy widens no write.
    const savedGrants = await client.query("select table_name, privilege_type from information_schema.table_privileges where grantee='portal_runtime' and table_name = any($1) order by table_name, privilege_type", [SAVED]);
    expect(savedGrants.rows).toEqual([...["DELETE", "INSERT", "SELECT"].map(p => ({ table_name: "saved_reading", privilege_type: p })), ...["INSERT", "SELECT"].map(p => ({ table_name: "saved_verse_mark", privilege_type: p })),
      ...["INSERT", "SELECT"].map(p => ({ table_name: "saved_verse_work", privilege_type: p })), ...["DELETE", "INSERT", "SELECT"].map(p => ({ table_name: "starred_comment", privilege_type: p }))]);
    const fks = await client.query<{ def: string }>("select pg_get_constraintdef(oid) as def from pg_constraint where contype='f' and conrelid::regclass::text = $1", [TABLE]);
    expect(fks.rows).toHaveLength(5);
    for (const row of fks.rows) expect(row.def).toMatch(/^FOREIGN KEY \(tenant_id[,)]/);

    // The claim's own rules, as the owner: a tutor grant only, one live claim per learner, a whole revocation, nothing rewritten.
    const claim = (learner: string, grant: string, tenantId = "crc", linkId: string | null = null) => client.query<{ id: string }>(`insert into ${TABLE}(tenant_id,learner_membership_id,tutor_grant_id,tutor_link_id) values($1,$2,$3,$4) returning id`, [tenantId, learner, grant, linkId]);
    await expect(claim(people.learner.member, parentGrant)).rejects.toThrow();
    await expect(claim(people.learner.member, adminGrant)).rejects.toThrow();
    await expect(claim(people.away.member, tutorGrant)).rejects.toThrow();
    await expect(claim(people.learner.member, awayTutor)).rejects.toThrow();
    const first = (await claim(people.learner.member, tutorGrant, "crc", link.id)).rows[0].id;
    await expect(claim(people.learner.member, tutorGrant)).rejects.toThrow();
    await expect(client.query(`update ${TABLE} set revoked_at = now() where id = $1`, [first])).rejects.toThrow();
    await expect(client.query(`update ${TABLE} set revoked_at = now(), revoked_by = 'rabbi', revoked_by_membership_id = $2 where id = $1`, [first, people.rabbi.member])).rejects.toThrow();
    await expect(client.query(`update ${TABLE} set learner_membership_id = $2 where id = $1`, [first, people.second.member])).rejects.toThrow();
    await client.query(`update ${TABLE} set revoked_at = now(), revoked_by = 'learner', revoked_by_membership_id = $2 where id = $1`, [first, people.learner.member]);
    const second = (await claim(people.learner.member, tutorGrant)).rows[0].id;
    expect(second).not.toBe(first);

    // As portal_runtime: the tenant scopes claims; the viewer and directory settings open reads only, and nothing without them.
    await client.exec("CREATE ROLE claim_login LOGIN; GRANT portal_runtime TO claim_login; SET SESSION AUTHORIZATION claim_login; SET ROLE portal_runtime");
    const set = (name: string, value: string | null) => client.query("select set_config($1, $2, false)", [name, value ?? ""]);
    const count = async (table: string) => (await client.query<{ n: number }>(`select count(*)::int as n from ${table}`)).rows[0].n;
    await set("app.tenant_id", "crc");
    expect(await count(TABLE)).toBe(2);
    await expect(client.query(`delete from ${TABLE}`)).rejects.toThrow();
    await expect(client.query(`update ${TABLE} set tutor_grant_id = $1`, [awayTutor])).rejects.toThrow();
    await client.query(`update ${TABLE} set revoked_at = now(), revoked_by = 'tutor', revoked_by_membership_id = $2 where id = $1`, [second, people.rabbi.member]);
    await expect(claim(people.learner.member, tutorGrant, "other")).rejects.toThrow();
    await claim(people.learner.member, tutorGrant);
    await set("app.tenant_id", "other");
    expect(await count(TABLE)).toBe(0);
    await set("app.tenant_id", "crc");
    for (const table of SAVED) expect(await count(table), table).toBe(0);
    await set("app.saved_viewer", people.learner.member);
    for (const table of SAVED) expect(await count(table), table).toBe(1);
    expect((await client.query("select id from saved_reading")).rows).toEqual([{ id: readings.learner }]);
    await expect(client.query("insert into saved_reading(tenant_id,membership_id,user_id,name,kind,ranges,verse_count) values('crc',$1,$2,'X','torah','Genesis 1:1',1)", [people.learner.member, people.learner.user])).rejects.toThrow();
    expect((await client.query("update saved_reading set name = 'Taken'")).affectedRows ?? 0).toBe(0);
    expect((await client.query("delete from saved_reading")).affectedRows ?? 0).toBe(0);
    expect((await client.query("update saved_verse_mark set state = 'got-it'")).affectedRows ?? 0).toBe(0);
    await set("app.saved_viewer", people.away.member);
    for (const table of SAVED) expect(await count(table), table).toBe(0);
    await set("app.saved_viewer", null);
    await set("app.saved_directory", "on");
    expect(await count("saved_reading")).toBe(2);
    for (const table of ["saved_verse_mark", "saved_verse_work", "starred_comment"]) expect(await count(table), table).toBe(0);
    await expect(client.query("insert into saved_reading(tenant_id,membership_id,user_id,name,kind,ranges,verse_count) values('crc',$1,$2,'X','torah','Genesis 1:1',1)", [people.learner.member, people.learner.user])).rejects.toThrow();
    await set("app.saved_directory", "off");
    expect(await count("saved_reading")).toBe(0);
    await set("app.saved_directory", "on"); await set("app.tenant_id", "other");
    expect(await count("saved_reading")).toBe(0);
  } finally { await client.close(); await isolation.cleanup(); }
});
