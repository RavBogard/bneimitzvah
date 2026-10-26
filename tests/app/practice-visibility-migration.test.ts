import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { expect, test } from "vitest";
import { isolatedEnv } from "../helpers/isolatedEnv.mjs";

// Release 1.9 N23, migration 0052 (numbered after production's 0051; journal idx 51): the mark column on verse_self_check, its
// trigger, the reader function, three security-barrier views and one SELECT policy on course_progress. Existing rows are unchanged.
const TAG = "0052_practice_visibility";

test("0052 follows 0051, keeps existing rows, adds only the mark columns to the schema, and replays", async () => {
  const isolation = await isolatedEnv(), client = new PGlite();
  try {
    const folder = "src/server/db/migrations", journal = JSON.parse(await readFile(join(folder, "meta/_journal.json"), "utf8"));
    const own = journal.entries.findIndex((e: { tag: string }) => e.tag === TAG);
    expect(journal.entries[own]).toMatchObject({ idx: 51, tag: TAG });
    expect(journal.entries[own - 1].tag).toBe("0051_invitation_copy");
    expect(journal.entries[own].when).toBeGreaterThan(journal.entries[own - 1].when);
    const entries = journal.entries.slice(0, own), prior = join(isolation.home, "prior");
    await mkdir(join(prior, "meta"), { recursive: true }); await writeFile(join(prior, "meta/_journal.json"), JSON.stringify({ ...journal, entries }));
    for (const e of entries) await copyFile(join(folder, e.tag + ".sql"), join(prior, e.tag + ".sql"));
    const db = drizzle(client); await migrate(db, { migrationsFolder: prior });
    const member = randomUUID(), student = randomUUID(), assignment = randomUUID();
    await client.query("insert into \"user\"(id,name,email,email_verified) values('mark-admin','Synthetic admin',$1,true)", [["mark-admin", "example.test"].join("@")]);
    await client.query("insert into membership(id,tenant_id,user_id) values($1,'crc','mark-admin')", [member]);
    await client.query("insert into student(id,tenant_id,first_name,last_name,ceremony_date,parent_email) values($1,'crc','Synthetic','Existing','2027-01-02',$2)", [student, ["parent", "example.test"].join("@")]);
    await client.query("insert into assignment(id,tenant_id,student_id,kind,basis,ref,status,revision,set_by_membership_id) values($1,'crc',$2,'torah','custom','Genesis 1:1','confirmed',1,$3)", [assignment, student, member]);
    await client.query("insert into verse_self_check(tenant_id,student_id,assignment_id,verse_ref,state,version) values('crc',$1,$2,'Genesis 1:1','got-it',1)", [student, assignment]);
    await client.query("insert into course_progress(tenant_id,membership_id,user_id,progress) values('crc',$1,'mark-admin',$2::jsonb)", [member, JSON.stringify({ schema: "learn-progress/v1", lessons: {}, cards: {} })]);
    const capture = async () => JSON.stringify(await Promise.all(["verse_self_check", "course_progress", "practice_event", "audit_event"].map(async t =>
      (await client.query(`select ${t === "verse_self_check" ? "id,tenant_id,student_id,assignment_id,verse_ref,state,version" : "*"} from ${t} order by 1`)).rows)));
    const before = await capture();
    await migrate(db, { migrationsFolder: folder }); await migrate(db, { migrationsFolder: folder });
    expect(await capture()).toBe(before);
    // An existing mark keeps no source and no instant: it was made before 0052 recorded them.
    expect((await client.query("select source_mode, marked_at from verse_self_check")).rows).toEqual([{ source_mode: null, marked_at: null }]);
    // A changed state with a source is stamped by the server; a source without its instant, or an unknown source, is refused.
    await client.query("update verse_self_check set state='working', version=2, source_mode='student'");
    expect((await client.query<{ ok: boolean }>("select marked_at is not null as ok from verse_self_check")).rows).toEqual([{ ok: true }]);
    await expect(client.query("update verse_self_check set state='got-it', version=3, source_mode='parent'")).rejects.toThrow();

    // Catalog: forced RLS kept, the views are security-barrier and security-invoker, and portal_runtime may only SELECT them.
    const views = await client.query<{ relname: string; options: string[] }>("select relname, reloptions as options from pg_class where relkind='v' and relname like 'practice_visibility_%' order by 1");
    expect(views.rows.map(v => v.relname)).toEqual(["practice_visibility_learn", "practice_visibility_marks", "practice_visibility_opened"]);
    for (const view of views.rows) expect([...view.options].sort(), view.relname).toEqual(["security_barrier=true", "security_invoker=true"]);
    const viewGrants = await client.query("select table_name, privilege_type, grantee from information_schema.table_privileges where table_name like 'practice_visibility_%' and grantee in ('portal_runtime','PUBLIC') order by 1, 2");
    expect(viewGrants.rows).toEqual(views.rows.map(v => ({ table_name: v.relname, privilege_type: "SELECT", grantee: "portal_runtime" })));
    const columns = await client.query<{ table_name: string; column_name: string }>("select table_name, column_name from information_schema.columns where table_name like 'practice_visibility_%' order by table_name, ordinal_position");
    expect(columns.rows.map(c => `${c.table_name}.${c.column_name}`)).toEqual([
      "practice_visibility_learn.tenant_id", "practice_visibility_learn.student_id", "practice_visibility_learn.lessons", "practice_visibility_learn.boxes",
      "practice_visibility_marks.tenant_id", "practice_visibility_marks.student_id", "practice_visibility_marks.assignment_id", "practice_visibility_marks.verse_ref", "practice_visibility_marks.state", "practice_visibility_marks.source_mode", "practice_visibility_marks.marked_day",
      "practice_visibility_opened.tenant_id", "practice_visibility_opened.student_id", "practice_visibility_opened.practice_day", "practice_visibility_opened.kind", "practice_visibility_opened.assignment_id", "practice_visibility_opened.verse_ref"]);
    const rls = await client.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>("select relname, relrowsecurity, relforcerowsecurity from pg_class where relname in ('course_progress','verse_self_check','practice_event') and relkind='r' order by 1");
    expect(rls.rows.every(row => row.relrowsecurity === true && row.relforcerowsecurity === true)).toBe(true);
    expect((await client.query("select policyname, cmd, permissive, roles::text[] as roles from pg_policies where tablename='course_progress' order by 1")).rows).toEqual([
      { policyname: "assigned_tutor_reader", cmd: "SELECT", permissive: "PERMISSIVE", roles: ["portal_runtime"] }, { policyname: "owner_only", cmd: "ALL", permissive: "PERMISSIVE", roles: ["portal_runtime"] }]);
    expect((await client.query<{ column_name: string }>("select column_name from information_schema.column_privileges where grantee='portal_runtime' and privilege_type='UPDATE' and table_name='verse_self_check' order by 1")).rows.map(r => r.column_name))
      .toEqual(["source_mode", "state", "version"]);
    const executors = await client.query("select grantee from information_schema.routine_privileges where routine_name='portal_practice_reader_sees' and privilege_type='EXECUTE' and grantee in ('portal_runtime','PUBLIC')");
    expect(executors.rows).toEqual([{ grantee: "portal_runtime" }]);

    // The generated snapshot adds the two columns and two checks to verse_self_check, and nothing else.
    const snapshots = (await readdir(join(folder, "meta"))).filter(name => /^\d{4}_snapshot\.json$/.test(name)).sort();
    const at = snapshots.indexOf("0052_snapshot.json");
    const previous = JSON.parse(await readFile(join(folder, "meta", snapshots[at - 1]), "utf8")), current = JSON.parse(await readFile(join(folder, "meta/0052_snapshot.json"), "utf8"));
    expect(snapshots[at - 1]).toBe("0051_snapshot.json"); expect(current.prevId).toBe(previous.id);
    const expected = structuredClone(previous.tables), table = current.tables["public.verse_self_check"];
    expected["public.verse_self_check"].columns.source_mode = table.columns.source_mode; expected["public.verse_self_check"].columns.marked_at = table.columns.marked_at;
    expected["public.verse_self_check"].checkConstraints.verse_self_check_source_mode = table.checkConstraints.verse_self_check_source_mode;
    expected["public.verse_self_check"].checkConstraints.verse_self_check_marked = table.checkConstraints.verse_self_check_marked;
    expect(current.tables).toEqual(expected);
    const text = await readFile(join(folder, `${TAG}.sql`), "utf8");
    expect(text).not.toContain("\r");
    expect(text).toMatch(/^[\x09\x0a\x20-\x7e]*$/);
    expect(text).not.toMatch(/DISABLE ROW LEVEL SECURITY|NO FORCE|DROP POLICY|SECURITY DEFINER|BYPASSRLS|app\.course_owner|GRANT\s+(ALL|INSERT|UPDATE|DELETE|TRUNCATE)\b[^;]*practice_visibility/i);
    expect(text).not.toMatch(/received_at|'play'|'record'/);
  } finally { await client.close(); await isolation.cleanup(); }
});
