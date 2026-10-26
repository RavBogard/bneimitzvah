import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { sql } from "drizzle-orm";
import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { isolatedEnv } from "../helpers/isolatedEnv.mjs";
import { priorColumns } from "../helpers/prior-columns";
import { accessFixture } from "./access-fixture";
import { withTenantTransaction } from "../../src/server/db/runtime";

// Release 1.9 N21, "Ceremony done": migration 0049. Forced row security; only a live admin grant named in app.ceremony_done_actor
// writes; setting needs no live tutor row; a live state refuses new tutor rows; a reversal restores nothing and is final.
const TAG = "0049_ceremony_done", TABLE = "student_ceremony_done";
const opened: { client: { close(): Promise<void> } }[] = [];
afterEach(async () => { await Promise.all(opened.splice(0).map(f => f.client.close())); });

test("0049 adds only the student_ceremony_done table, two audit actions and its guards, leaves every existing row unchanged, and replays", async () => {
  const isolation = await isolatedEnv(), client = new PGlite();
  try {
    const folder = "src/server/db/migrations", journal = JSON.parse(await readFile(join(folder, "meta/_journal.json"), "utf8"));
    const own = journal.entries.findIndex((e: { tag: string }) => e.tag === TAG);
    expect(journal.entries[own]).toMatchObject({ idx: 49, tag: TAG });
    expect(journal.entries[own].when).toBeGreaterThan(journal.entries.find((e: { tag: string }) => e.tag === "0048_service_part_finished").when);
    const entries = journal.entries.slice(0, own), prior = join(isolation.home, "prior");
    await mkdir(join(prior, "meta"), { recursive: true }); await writeFile(join(prior, "meta/_journal.json"), JSON.stringify({ ...journal, entries }));
    for (const e of entries) await copyFile(join(folder, e.tag + ".sql"), join(prior, e.tag + ".sql"));
    const db = drizzle(client); await migrate(db, { migrationsFolder: prior });
    const member = randomUUID(), grant = randomUUID(), tutorMember = randomUUID(), tutorGrant = randomUUID();
    await client.query("insert into \"user\"(id,name,email,email_verified) values('done-admin','Synthetic admin',$1,true),('done-tutor','Synthetic tutor',$2,true)", [["done-admin", "example.test"].join("@"), ["done-tutor", "example.test"].join("@")]);
    await client.query("insert into membership(id,tenant_id,user_id) values($1,'crc','done-admin'),($2,'crc','done-tutor')", [member, tutorMember]);
    await client.query("insert into role_grant(id,tenant_id,membership_id,role) values($1,'crc',$2,'admin'),($3,'crc',$4,'tutor')", [grant, member, tutorGrant, tutorMember]);
    const [student] = (await client.query<{ id: string }>("insert into student(tenant_id,first_name,last_name,ceremony_date,parent_email) values('crc','Synthetic','Learner','2027-01-02','family@example.test') returning id")).rows;
    await client.query("insert into tutor_student(tenant_id,student_id,tutor_grant_id) values('crc',$1,$2)", [student.id, tutorGrant]);
    const capture = async () => Object.fromEntries(await Promise.all(["student", "membership", "role_grant", "tutor_student", "audit_event", "tenant", "guardian", "student_identity"].map(async t => [t, (await client.query(`select * from ${t} order by 1`)).rows])));
    const before = await capture();
    await migrate(db, { migrationsFolder: folder }); await migrate(db, { migrationsFolder: folder });
    const after = await capture();
    for (const table of Object.keys(before)) expect(priorColumns(after[table], before[table])).toEqual(before[table]);
    expect((await client.query(`select count(*)::int as n from ${TABLE}`)).rows).toEqual([{ n: 0 }]);
    for (const action of ["ceremony-done.set", "ceremony-done.reverse"])
      await client.query("insert into audit_event(tenant_id,actor_user_id,actor_membership_id,mode,acting_student_id,role_grant_id,action,target_type,target_id,request_id) values('crc','done-admin',$1,'admin',$2,$3,$4,'student',$6,$5)", [member, student.id, grant, action, randomUUID(), student.id]);
    await expect(client.query("insert into audit_event(tenant_id,actor_user_id,actor_membership_id,mode,role_grant_id,action,target_type,target_id,request_id) values('crc','done-admin',$1,'admin',$2,'ceremony-done.delete','student','x',$3)", [member, grant, randomUUID()])).rejects.toThrow();

    // The generated snapshot adds the one table and the two audit actions, and changes nothing else.
    const snapshots = (await readdir(join(folder, "meta"))).filter(name => /^\d{4}_snapshot\.json$/.test(name)).sort();
    const at = snapshots.indexOf("0049_snapshot.json");
    expect(at).toBeGreaterThan(0);
    const previous = JSON.parse(await readFile(join(folder, "meta", snapshots[at - 1]), "utf8")), current = JSON.parse(await readFile(join(folder, "meta/0049_snapshot.json"), "utf8"));
    expect(current.prevId).toBe(previous.id);
    const expected = structuredClone(previous.tables);
    expected[`public.${TABLE}`] = current.tables[`public.${TABLE}`];
    const audit = (value: string) => value.match(/'[^']+'/g)!.map(v => v.slice(1, -1));
    expect(audit(current.tables["public.audit_event"].checkConstraints.audit_action_known.value))
      .toEqual([...audit(previous.tables["public.audit_event"].checkConstraints.audit_action_known.value), "ceremony-done.set", "ceremony-done.reverse"]);
    expected["public.audit_event"].checkConstraints.audit_action_known = current.tables["public.audit_event"].checkConstraints.audit_action_known;
    expect(current.tables).toEqual(expected);
    for (const key of ["enums", "schemas", "sequences", "roles", "policies", "views"]) expect(current[key]).toEqual(previous[key]);

    // Row security, grants and triggers are hand-written beside the generated DDL.
    const text = await readFile(join(folder, `${TAG}.sql`), "utf8");
    expect(text).not.toContain("\r");
    expect(text).toMatch(/^[\x09\x0a\x20-\x7e]*$/);
    expect(text).not.toMatch(/GRANT[^;]*(DELETE|TRUNCATE|ALL)[^;]*ON student_ceremony_done/i);
    expect(text).not.toMatch(/DISABLE ROW LEVEL SECURITY|NO FORCE|DROP POLICY|SECURITY DEFINER/i);
    const rls = await client.query("select relname, relrowsecurity, relforcerowsecurity from pg_class where relname = $1 and relkind='r'", [TABLE]);
    expect(rls.rows).toEqual([{ relname: TABLE, relrowsecurity: true, relforcerowsecurity: true }]);
    const policies = await client.query<{ policyname: string; cmd: string; permissive: string; roles: string[]; qual: string | null; with_check: string | null }>("select policyname, cmd, permissive, roles::text[] as roles, qual, with_check from pg_policies where tablename = $1 order by policyname", [TABLE]);
    expect(policies.rows.map(p => [p.policyname, p.cmd, p.permissive, p.roles])).toEqual([
      ["admin_reverser", "UPDATE", "PERMISSIVE", ["portal_runtime"]], ["admin_setter", "INSERT", "PERMISSIVE", ["portal_runtime"]],
      ["tenant_isolation", "ALL", "RESTRICTIVE", ["portal_runtime"]], ["tenant_readers", "SELECT", "PERMISSIVE", ["portal_runtime"]]]);
    for (const needle of ["app.ceremony_done_actor", "'admin'", "revoked_at IS NULL", "disabled_at IS NULL", "tutor_student"]) expect(policies.rows[1].with_check, needle).toContain(needle);
    for (const needle of ["app.ceremony_done_actor", "'admin'", "revoked_at IS NULL", "disabled_at IS NULL"]) expect(policies.rows[0].with_check, needle).toContain(needle);
    expect(policies.rows[0].qual).toContain("reversed_at IS NULL");
    const tableGrants = await client.query("select privilege_type from information_schema.table_privileges where grantee='portal_runtime' and table_name = $1 order by privilege_type", [TABLE]);
    expect(tableGrants.rows).toEqual([{ privilege_type: "SELECT" }]);
    const columns = async (privilege: string) => (await client.query<{ column_name: string }>("select column_name from information_schema.column_privileges where grantee='portal_runtime' and privilege_type=$2 and table_name = $1 order by column_name", [TABLE, privilege])).rows.map(r => r.column_name);
    expect(await columns("INSERT")).toEqual(["set_by_grant_id", "student_id", "tenant_id"]);
    expect(await columns("UPDATE")).toEqual(["reversed_by_grant_id", "reversed_by_role"]);
    expect((await client.query("select count(*)::int as n from information_schema.table_privileges where grantee='PUBLIC' and table_name = $1", [TABLE])).rows).toEqual([{ n: 0 }]);
    const fks = await client.query<{ def: string }>("select pg_get_constraintdef(oid) as def from pg_constraint where contype='f' and conrelid::regclass::text = $1", [TABLE]);
    for (const row of fks.rows) expect(row.def).toMatch(/^FOREIGN KEY \(tenant_id[,)]/);

    // As the owner: a tutor grant cannot be the setter (typed foreign key); the trigger refuses delete, identity changes and a
    // second change; a live state refuses a new tutor row; a reversed row restores none.
    await expect(client.query(`insert into ${TABLE}(tenant_id,student_id,set_by_grant_id,set_by_role) values('crc',$1,$2,'tutor')`, [student.id, tutorGrant])).rejects.toThrow();
    await expect(client.query(`insert into ${TABLE}(tenant_id,student_id,set_by_grant_id) values('crc',$1,$2)`, [student.id, tutorGrant])).rejects.toThrow();
    const [row] = (await client.query<{ id: string }>(`insert into ${TABLE}(tenant_id,student_id,set_by_grant_id) values('crc',$1,$2) returning id`, [student.id, grant])).rows;
    await expect(client.query(`insert into ${TABLE}(tenant_id,student_id,set_by_grant_id) values('crc',$1,$2)`, [student.id, grant])).rejects.toThrow();
    await client.query("update tutor_student set revoked_at = now()");
    await expect(client.query("insert into tutor_student(tenant_id,student_id,tutor_grant_id) values('crc',$1,$2)", [student.id, tutorGrant])).rejects.toThrow(/ceremony done/);
    await expect(client.query(`delete from ${TABLE}`)).rejects.toThrow();
    await expect(client.query(`update ${TABLE} set student_id = student_id, set_at = now() - interval '1 day'`)).rejects.toThrow();
    await client.query(`update ${TABLE} set reversed_by_grant_id = $1, reversed_by_role = 'admin' where id = $2`, [grant, row.id]);
    const [reversed] = (await client.query<{ reversed_at: Date | null }>(`select reversed_at from ${TABLE} where id = $1`, [row.id])).rows;
    expect(reversed.reversed_at).not.toBeNull();
    await expect(client.query(`update ${TABLE} set reversed_by_role = 'admin' where id = $1`, [row.id])).rejects.toThrow();
    expect((await client.query("select count(*)::int as n from tutor_student where revoked_at is null")).rows).toEqual([{ n: 0 }]);
    await client.query("insert into tutor_student(tenant_id,student_id,tutor_grant_id) values('crc',$1,$2)", [student.id, tutorGrant]);
  } finally { await client.close(); await isolation.cleanup(); }
});

async function sqlState(operation: PromiseLike<unknown>) {
  try { await operation; return "accepted"; } catch (error) {
    let value = error as { code?: unknown; cause?: unknown } | undefined;
    for (let depth = 0; value && depth < 4; depth++, value = value.cause as typeof value) if (typeof value.code === "string" && /^[A-Z0-9]{5}$/.test(value.code)) return value.code;
    return "unknown";
  }
}

test("row security as portal_runtime: only a live admin grant of this congregation sets or reverses it, never a tutor, parent or student", async () => {
  const f = await accessFixture(); opened.push(f);
  const [own, sibling, , other] = f.students;
  type Tx = Parameters<Parameters<typeof withTenantTransaction>[2]>[0];
  const as = <T>(tenant: string, actor: string | null, action: (tx: Tx) => Promise<T>) => withTenantTransaction(f.db, { tenantId: tenant }, async tx => {
    if (actor !== null) await tx.execute(sql`select set_config('app.ceremony_done_actor', ${actor}, true)`);
    return action(tx);
  });
  const insert = (actor: string | null, studentId: string, setBy: string, tenant = "crc") => sqlState(as(tenant, actor, tx => tx.execute(sql`insert into student_ceremony_done(tenant_id,student_id,set_by_grant_id) values(${tenant},${studentId},${setBy})`)));
  const reverse = (actor: string | null, by: string) => as("crc", actor, async tx => (await tx.execute(sql`update student_ceremony_done set reversed_by_grant_id = ${by}, reversed_by_role = 'admin' where reversed_at is null returning id`) as unknown as { rows: unknown[] }).rows.length);
  const live = (tenant = "crc") => as(tenant, null, async tx => (await tx.execute(sql`select student_id from student_ceremony_done where reversed_at is null`) as unknown as { rows: { student_id: string }[] }).rows.map(r => r.student_id));

  // Nobody but a live admin grant named as the actor, and naming itself as the setter, may insert.
  for (const actor of [null, "", f.tutorGrant.id, f.parentGrant.id, f.learnerGrant.id]) expect(await insert(actor, sibling.id, actor || f.adminGrant.id), `${actor}`).toBe("42501");
  for (const grant of [f.tutorGrant.id, f.parentGrant.id, f.learnerGrant.id]) expect(await insert(grant, sibling.id, grant), grant).toBe("42501");
  expect(await insert(`${f.adminGrant.id}' or true --`, sibling.id, f.adminGrant.id)).toBe("22P02");
  // Another congregation: neither its student from here, nor this congregation's student from there.
  expect(await insert(f.adminGrant.id, other.id, f.adminGrant.id)).not.toBe("accepted");
  expect(await insert(f.adminGrant.id, sibling.id, f.adminGrant.id, "other")).toBe("42501");
  // While a live tutor row is left the insert is refused: the tutor rows end first, in the same transaction.
  expect(await insert(f.adminGrant.id, own.id, f.adminGrant.id)).toBe("42501");
  expect(await sqlState(as("crc", f.adminGrant.id, async tx => {
    await tx.execute(sql`update tutor_student set revoked_at = now() where student_id = ${own.id} and revoked_at is null`);
    await tx.execute(sql`insert into student_ceremony_done(tenant_id,student_id,set_by_grant_id) values('crc',${own.id},${f.adminGrant.id})`);
  }))).toBe("accepted");
  expect(await sqlState(as("crc", f.adminGrant.id, tx => tx.execute(sql`insert into student_ceremony_done(tenant_id,student_id,set_by_grant_id,set_at) values('crc',${sibling.id},${f.adminGrant.id},now())`)))).toBe("42501");
  // Every reader of the tenant sees the state; another congregation sees none of it.
  expect(await live()).toEqual([own.id]);
  expect(await live("other")).toEqual([]);
  // No new tutor row while it is live, through any path.
  expect(await sqlState(as("crc", null, tx => tx.execute(sql`insert into tutor_student(tenant_id,student_id,tutor_grant_id) values('crc',${own.id},${f.tutorGrant.id})`)))).toBe("23514");
  // Reversal: never by a tutor, parent, student or no actor; nobody deletes or truncates.
  for (const actor of [null, f.tutorGrant.id, f.parentGrant.id, f.learnerGrant.id]) expect(await sqlState(reverse(actor, actor ?? f.adminGrant.id)), `${actor}`).toBe("42501");
  for (const statement of ["delete from student_ceremony_done", "truncate student_ceremony_done", "update student_ceremony_done set reversed_at = now()", "update student_ceremony_done set student_id = student_id"])
    expect(await sqlState(as("crc", f.adminGrant.id, tx => tx.execute(sql.raw(statement)))), statement).toBe("42501");
  expect(await reverse(f.adminGrant.id, f.adminGrant.id)).toBe(1);
  expect(await live()).toEqual([]);
  // The reversal restored no tutor row; a reversed row never changes again.
  expect(await as("crc", null, async tx => (await tx.execute(sql`select count(*)::int as n from tutor_student where student_id = ${own.id} and revoked_at is null`) as unknown as { rows: { n: number }[] }).rows[0].n)).toBe(0);
  expect(await reverse(f.adminGrant.id, f.adminGrant.id)).toBe(0);
  // A revoked admin grant writes nothing.
  await f.owner(() => f.client.query("update role_grant set revoked_at = now() where id = $1", [f.adminGrant.id]));
  expect(await insert(f.adminGrant.id, sibling.id, f.adminGrant.id)).toBe("42501");
});
