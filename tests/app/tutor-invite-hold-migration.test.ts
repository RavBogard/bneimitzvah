import { createHash, randomUUID } from "node:crypto";
import { copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { isolatedEnv } from "../helpers/isolatedEnv.mjs";
import { priorColumns } from "../helpers/prior-columns";

// Students held for a tutor invitation (Daniel, 2026-10-26), migration 0053: one new table, insert-only, forced row security with a
// restrictive tenant_isolation, one SELECT policy and one INSERT policy tied to a live admin grant, a live tutor invitation and an
// enabled student. Nothing existing changes.
const TAG = "0053_tutor_invite_hold", TABLE = "tutor_invite_hold";

test("0053 adds only the tutor_invite_hold table, leaves every existing row unchanged, replays, and holds its row security", async () => {
  const isolation = await isolatedEnv(), client = new PGlite();
  try {
    const folder = "src/server/db/migrations", journal = JSON.parse(await readFile(join(folder, "meta/_journal.json"), "utf8"));
    const own = journal.entries.findIndex((e: { tag: string }) => e.tag === TAG);
    expect(journal.entries[own]).toMatchObject({ idx: 52, tag: TAG });
    expect(journal.entries[own].when).toBeGreaterThan(journal.entries.find((e: { tag: string }) => e.tag === "0052_practice_visibility").when);
    const entries = journal.entries.slice(0, own), prior = join(isolation.home, "prior");
    await mkdir(join(prior, "meta"), { recursive: true }); await writeFile(join(prior, "meta/_journal.json"), JSON.stringify({ ...journal, entries }));
    for (const e of entries) await copyFile(join(folder, e.tag + ".sql"), join(prior, e.tag + ".sql"));
    const db = drizzle(client); await migrate(db, { migrationsFolder: prior });
    const adminMember = randomUUID(), adminGrant = randomUUID(), tutorGrant = randomUUID();
    await client.query("insert into \"user\"(id,name,email,email_verified) values('hold-admin','Synthetic rabbi',$1,true)", [["hold-admin", "example.test"].join("@")]);
    await client.query("insert into membership(id,tenant_id,user_id) values($1,'crc','hold-admin')", [adminMember]);
    await client.query("insert into role_grant(id,tenant_id,membership_id,role) values($1,'crc',$2,'admin')", [adminGrant, adminMember]);
    await client.query("insert into role_grant(id,tenant_id,membership_id,role) values($1,'crc',$2,'tutor')", [tutorGrant, adminMember]);
    const [student] = (await client.query<{ id: string }>("insert into student(tenant_id,first_name,last_name,ceremony_date,parent_email) values('crc','Synthetic','Held','2027-01-02','family@example.test') returning id")).rows;
    const [disabled] = (await client.query<{ id: string }>("insert into student(tenant_id,first_name,last_name,ceremony_date,parent_email,disabled_at) values('crc','Synthetic','Gone','2027-01-02','family@example.test',now()) returning id")).rows;
    const invite = async (role: string, extra = "") => (await client.query<{ id: string }>(`insert into invite(tenant_id,token_hash,email,role,student_id,inviter_membership_id,expires_at${extra ? "," + extra.split("=")[0] : ""})
      values('crc',$1,'tutor@example.test',$2,$3,$4,now() + interval '7 days'${extra ? "," + extra.split("=")[1] : ""}) returning id`, [createHash("sha256").update(randomUUID()).digest("hex"), role, role === "tutor" ? null : student.id, adminMember])).rows[0].id;
    const liveInvite = await invite("tutor"), revokedInvite = await invite("tutor", "revoked_at=now()"), parentInvite = await invite("parent");
    const expiredInvite = (await client.query<{ id: string }>(`insert into invite(tenant_id,token_hash,email,role,inviter_membership_id,created_at,expires_at)
      values('crc',$1,'tutor@example.test','tutor',$2,now() - interval '10 days',now() - interval '1 day') returning id`, [createHash("sha256").update(randomUUID()).digest("hex"), adminMember])).rows[0].id;
    const capture = async () => Object.fromEntries(await Promise.all(["student", "membership", "role_grant", "invite", "tutor_student", "audit_event", "tenant"].map(async t => [t, (await client.query(`select * from ${t} order by 1`)).rows])));
    const before = await capture();
    await migrate(db, { migrationsFolder: folder }); await migrate(db, { migrationsFolder: folder });
    const after = await capture();
    for (const table of Object.keys(before)) expect(priorColumns(after[table], before[table])).toEqual(before[table]);
    expect((await client.query(`select count(*)::int as n from ${TABLE}`)).rows).toEqual([{ n: 0 }]);

    // The generated snapshot adds the one table and changes nothing else.
    const snapshots = (await readdir(join(folder, "meta"))).filter(name => /^\d{4}_snapshot\.json$/.test(name)).sort();
    const at = snapshots.indexOf("0053_snapshot.json");
    expect(at).toBeGreaterThan(0);
    const previous = JSON.parse(await readFile(join(folder, "meta", snapshots[at - 1]), "utf8")), current = JSON.parse(await readFile(join(folder, "meta/0053_snapshot.json"), "utf8"));
    expect(current.prevId).toBe(previous.id);
    const expected = structuredClone(previous.tables);
    expected[`public.${TABLE}`] = current.tables[`public.${TABLE}`];
    expect(current.tables).toEqual(expected);
    for (const key of ["enums", "schemas", "sequences", "roles", "policies", "views"]) expect(current[key]).toEqual(previous[key]);

    // Row security and grants are hand-written beside the generated DDL.
    const text = await readFile(join(folder, `${TAG}.sql`), "utf8");
    expect(text).not.toContain("\r");
    expect(text).toMatch(/^[\x09\x0a\x20-\x7e]*$/);
    for (const line of [`ALTER TABLE ${TABLE} ENABLE ROW LEVEL SECURITY;`, `ALTER TABLE ${TABLE} FORCE ROW LEVEL SECURITY;`, `REVOKE ALL ON ${TABLE} FROM PUBLIC;`, `REVOKE ALL ON ${TABLE} FROM portal_runtime;`,
      `GRANT SELECT ON ${TABLE} TO portal_runtime;`, `GRANT INSERT (tenant_id, invite_id, student_id, held_by_grant_id) ON ${TABLE} TO portal_runtime;`]) expect(text).toContain(line);
    // The statements alone, without their comments (whose prose would match these words).
    const code = text.split("\n").filter(line => !line.trim().startsWith("--")).join("\n");
    expect(code).not.toMatch(/GRANT[^;]*(UPDATE|DELETE|TRUNCATE|ALL)[^;]*ON tutor_invite_hold/i);
    expect(code).not.toMatch(/DISABLE ROW LEVEL SECURITY|NO FORCE|DROP POLICY|DROP TABLE|ALTER TABLE "(student|invite|tutor_student|role_grant)"/i);
    const rls = await client.query("select relname, relrowsecurity, relforcerowsecurity from pg_class where relname = $1 and relkind='r'", [TABLE]);
    expect(rls.rows).toEqual([{ relname: TABLE, relrowsecurity: true, relforcerowsecurity: true }]);
    const policies = await client.query<{ policyname: string; cmd: string; permissive: string; roles: string[]; qual: string | null; with_check: string | null }>("select policyname, cmd, permissive, roles::text[] as roles, qual, with_check from pg_policies where tablename = $1 order by policyname", [TABLE]);
    expect(policies.rows.map(p => [p.policyname, p.cmd, p.permissive, p.roles])).toEqual([
      ["admin_holder", "INSERT", "PERMISSIVE", ["portal_runtime"]], ["tenant_isolation", "ALL", "RESTRICTIVE", ["portal_runtime"]], ["tenant_readers", "SELECT", "PERMISSIVE", ["portal_runtime"]]]);
    const tenant = "(tenant_id = NULLIF(current_setting('app.tenant_id'::text, true), ''::text))";
    expect(policies.rows[1]).toMatchObject({ qual: tenant, with_check: tenant });
    for (const needle of ["app.tutor_hold_actor", "'admin'", "revoked_at IS NULL", "disabled_at IS NULL", "'tutor'", "accepted_at IS NULL", "expires_at > now()"]) expect(policies.rows[0].with_check, needle).toContain(needle);
    const tableGrants = await client.query("select privilege_type from information_schema.table_privileges where grantee='portal_runtime' and table_name = $1 order by privilege_type", [TABLE]);
    expect(tableGrants.rows).toEqual([{ privilege_type: "SELECT" }]);
    const columnGrants = await client.query("select column_name from information_schema.column_privileges where grantee='portal_runtime' and privilege_type='INSERT' and table_name = $1 order by column_name", [TABLE]);
    expect(columnGrants.rows).toEqual(["held_by_grant_id", "invite_id", "student_id", "tenant_id"].map(column_name => ({ column_name })));
    expect((await client.query("select count(*)::int as n from information_schema.column_privileges where grantee='portal_runtime' and privilege_type in ('UPDATE','REFERENCES') and table_name = $1", [TABLE])).rows).toEqual([{ n: 0 }]);
    expect((await client.query("select count(*)::int as n from information_schema.table_privileges where grantee='PUBLIC' and table_name = $1", [TABLE])).rows).toEqual([{ n: 0 }]);
    const fks = await client.query<{ def: string }>("select pg_get_constraintdef(oid) as def from pg_constraint where contype='f' and conrelid::regclass::text = $1", [TABLE]);
    expect(fks.rows).toHaveLength(4);
    for (const row of fks.rows) expect(row.def).toMatch(/^FOREIGN KEY \(tenant_id[,)]/);

    // As portal_runtime: the policy admits a live admin grant, a live tutor invitation and an enabled student in its own tenant only.
    await client.exec("CREATE ROLE hold_login LOGIN; GRANT portal_runtime TO hold_login; SET SESSION AUTHORIZATION hold_login; SET ROLE portal_runtime");
    const hold = async (tenant: string, inviteId: string, studentId: string, grantId: string, holder: string | null = grantId) => {
      await client.query("select set_config('app.tenant_id', $1, false)", [tenant]);
      await client.query("select set_config('app.tutor_hold_actor', $1, false)", [holder ?? ""]);
      try { await client.query(`insert into ${TABLE}(tenant_id,invite_id,student_id,held_by_grant_id) values($1,$2,$3,$4)`, [tenant, inviteId, studentId, grantId]); return "ok"; } catch { return "refused"; }
    };
    expect(await hold("crc", liveInvite, student.id, tutorGrant)).toBe("refused");
    // The writer must be the grant the session named: unset, or naming another grant, is refused.
    expect(await hold("crc", liveInvite, student.id, adminGrant, null)).toBe("refused");
    expect(await hold("crc", liveInvite, student.id, adminGrant, tutorGrant)).toBe("refused");
    expect(await hold("crc", revokedInvite, student.id, adminGrant)).toBe("refused");
    expect(await hold("crc", expiredInvite, student.id, adminGrant)).toBe("refused");
    expect(await hold("crc", parentInvite, student.id, adminGrant)).toBe("refused");
    expect(await hold("crc", liveInvite, disabled.id, adminGrant)).toBe("refused");
    expect(await hold("other", liveInvite, student.id, adminGrant)).toBe("refused");
    expect(await hold("crc", liveInvite, student.id, adminGrant)).toBe("ok");
    expect(await hold("crc", liveInvite, student.id, adminGrant)).toBe("refused");
    await expect(client.query(`update ${TABLE} set student_id = $1`, [disabled.id])).rejects.toThrow();
    await expect(client.query(`delete from ${TABLE}`)).rejects.toThrow();
    expect((await client.query(`select count(*)::int as n from ${TABLE}`)).rows).toEqual([{ n: 1 }]);
    await client.query("select set_config('app.tenant_id', 'other', false)");
    expect((await client.query(`select count(*)::int as n from ${TABLE}`)).rows).toEqual([{ n: 0 }]);
  } finally { await client.close(); await isolation.cleanup(); }
});
