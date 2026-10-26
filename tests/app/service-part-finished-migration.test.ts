import { createHash, randomUUID } from "node:crypto";
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

// Release 2.0 SC5: the per-part finished mark (A4 9), migration 0048. Staff-readable as ruled, insert-only, forced row security:
// a restrictive tenant_isolation policy, one SELECT policy for the ruled readers and one INSERT policy for the student alone.
const TAG = "0048_service_part_finished", TABLE = "service_part_finished";
const opened: { client: { close(): Promise<void> } }[] = [];
afterEach(async () => { await Promise.all(opened.splice(0).map(f => f.client.close())); });

test("0048 adds only the service_part_finished table and one audit action, leaves every existing row unchanged, and replays", async () => {
  const isolation = await isolatedEnv(), client = new PGlite();
  try {
    const folder = "src/server/db/migrations", journal = JSON.parse(await readFile(join(folder, "meta/_journal.json"), "utf8"));
    const own = journal.entries.findIndex((e: { tag: string }) => e.tag === TAG);
    expect(journal.entries[own]).toMatchObject({ idx: 48, tag: TAG });
    expect(journal.entries[own].when).toBeGreaterThan(journal.entries.find((e: { tag: string }) => e.tag === "0047_verse_review").when);
    const entries = journal.entries.slice(0, own), prior = join(isolation.home, "prior");
    await mkdir(join(prior, "meta"), { recursive: true }); await writeFile(join(prior, "meta/_journal.json"), JSON.stringify({ ...journal, entries }));
    for (const e of entries) await copyFile(join(folder, e.tag + ".sql"), join(prior, e.tag + ".sql"));
    const db = drizzle(client); await migrate(db, { migrationsFolder: prior });
    const member = randomUUID(), grant = randomUUID();
    await client.query("insert into \"user\"(id,name,email,email_verified) values('finished-existing','Synthetic learner',$1,true)", [["finished-existing", "example.test"].join("@")]);
    await client.query("insert into membership(id,tenant_id,user_id) values($1,'crc','finished-existing')", [member]);
    await client.query("insert into role_grant(id,tenant_id,membership_id,role) values($1,'crc',$2,'student')", [grant, member]);
    const [student] = (await client.query<{ id: string }>("insert into student(tenant_id,first_name,last_name,ceremony_date,parent_email) values('crc','Synthetic','Learner','2027-01-02','family@example.test') returning id")).rows;
    await client.query("insert into audit_event(tenant_id,actor_user_id,actor_membership_id,mode,role_grant_id,action,target_type,target_id,request_id) values('crc','finished-existing',$1,'student',$2,'service-plan.set','service-plan','x',$3)", [member, grant, randomUUID()]);
    await client.query("insert into service_course_progress(tenant_id,membership_id,user_id,progress) values('crc',$1,'finished-existing',$2::jsonb)", [member, JSON.stringify({ schema: "service-course-progress/v1", lessons: { shma: { done: "2026-10-20T10:00:00.000Z" } }, cards: {} })]);
    const capture = async () => Object.fromEntries(await Promise.all(["student", "membership", "role_grant", "audit_event", "tenant", "service_course_progress", "verse_review", "student_service_plan", "practice_event"].map(async t => [t, (await client.query(`select * from ${t} order by 1`)).rows])));
    const before = await capture();
    await migrate(db, { migrationsFolder: folder }); await migrate(db, { migrationsFolder: folder });
    const after = await capture();
    for (const table of Object.keys(before)) expect(priorColumns(after[table], before[table])).toEqual(before[table]);
    expect((await client.query(`select count(*)::int as n from ${TABLE}`)).rows).toEqual([{ n: 0 }]);
    // The new audit action is accepted; an unknown one still is not.
    await client.query("insert into audit_event(tenant_id,actor_user_id,actor_membership_id,mode,acting_student_id,role_grant_id,action,target_type,target_id,request_id) values('crc','finished-existing',$1,'student',$2,$3,'service-part.finish','service-part','shma',$4)", [member, student.id, grant, randomUUID()]);
    await expect(client.query("insert into audit_event(tenant_id,actor_user_id,actor_membership_id,mode,role_grant_id,action,target_type,target_id,request_id) values('crc','finished-existing',$1,'student',$2,'service-part.unfinish','service-part','x',$3)", [member, grant, randomUUID()])).rejects.toThrow();

    // The generated snapshot adds the one table and the one audit action, and changes nothing else.
    const snapshots = (await readdir(join(folder, "meta"))).filter(name => /^\d{4}_snapshot\.json$/.test(name)).sort();
    const at = snapshots.indexOf("0048_snapshot.json");
    expect(at).toBeGreaterThan(0);
    const previous = JSON.parse(await readFile(join(folder, "meta", snapshots[at - 1]), "utf8")), current = JSON.parse(await readFile(join(folder, "meta/0048_snapshot.json"), "utf8"));
    expect(current.prevId).toBe(previous.id);
    const expected = structuredClone(previous.tables);
    expected[`public.${TABLE}`] = current.tables[`public.${TABLE}`];
    const audit = (value: string) => value.match(/'[^']+'/g)!.map(v => v.slice(1, -1));
    const was = audit(previous.tables["public.audit_event"].checkConstraints.audit_action_known.value), now = audit(current.tables["public.audit_event"].checkConstraints.audit_action_known.value);
    expect(now).toEqual([...was, "service-part.finish"]);
    expected["public.audit_event"].checkConstraints.audit_action_known = current.tables["public.audit_event"].checkConstraints.audit_action_known;
    expect(current.tables).toEqual(expected);
    for (const key of ["enums", "schemas", "sequences", "roles", "policies", "views"]) expect(current[key]).toEqual(previous[key]);

    // Row security, grants and the trigger are hand-written beside the generated DDL.
    const text = await readFile(join(folder, `${TAG}.sql`), "utf8");
    expect(text).not.toContain("\r");
    expect(text).toMatch(/^[\x09\x0a\x20-\x7e]*$/);
    for (const line of [`ALTER TABLE ${TABLE} ENABLE ROW LEVEL SECURITY;`, `ALTER TABLE ${TABLE} FORCE ROW LEVEL SECURITY;`, `REVOKE ALL ON ${TABLE} FROM PUBLIC;`, `REVOKE ALL ON ${TABLE} FROM portal_runtime;`,
      `GRANT SELECT ON ${TABLE} TO portal_runtime;`, `GRANT INSERT (tenant_id, student_id, lesson_id) ON ${TABLE} TO portal_runtime;`,
      `CREATE TRIGGER immutable_service_part_finished BEFORE UPDATE OR DELETE ON ${TABLE} FOR EACH ROW EXECUTE FUNCTION portal_immutable_audit();`]) expect(text).toContain(line);
    expect(text).not.toMatch(/GRANT[^;]*(UPDATE|DELETE|TRUNCATE|ALL)[^;]*ON service_part_finished/i);
    expect(text).not.toMatch(/DISABLE ROW LEVEL SECURITY|NO FORCE|DROP POLICY|app\.saved_owner|app\.course_owner|app\.service_course_owner|app\.verse_review_owner/i);
    const rls = await client.query("select relname, relrowsecurity, relforcerowsecurity from pg_class where relname = $1 and relkind='r'", [TABLE]);
    expect(rls.rows).toEqual([{ relname: TABLE, relrowsecurity: true, relforcerowsecurity: true }]);
    const policies = await client.query<{ policyname: string; cmd: string; permissive: string; roles: string[]; qual: string | null; with_check: string | null }>("select policyname, cmd, permissive, roles::text[] as roles, qual, with_check from pg_policies where tablename = $1 order by policyname", [TABLE]);
    expect(policies.rows.map(p => [p.policyname, p.cmd, p.permissive, p.roles])).toEqual([
      ["ruled_readers", "SELECT", "PERMISSIVE", ["portal_runtime"]], ["student_writer", "INSERT", "PERMISSIVE", ["portal_runtime"]], ["tenant_isolation", "ALL", "RESTRICTIVE", ["portal_runtime"]]]);
    const tenant = "(tenant_id = NULLIF(current_setting('app.tenant_id'::text, true), ''::text))";
    expect(policies.rows[2]).toMatchObject({ qual: tenant, with_check: tenant });
    expect(policies.rows[0].with_check).toBeNull(); expect(policies.rows[1].qual).toBeNull();
    for (const needle of ["app.service_part_reader", "'admin'", "'tutor'", "tutor_student", "'student'", "student_identity", "'parent'", "practice_context", "app.service_part_context", "'child-practice'", "now()", "disabled_at IS NULL", "revoked_at IS NULL"])
      expect(policies.rows[0].qual, needle).toContain(needle);
    for (const needle of ["app.service_part_reader", "'student'", "student_identity", "disabled_at IS NULL"]) expect(policies.rows[1].with_check, needle).toContain(needle);
    for (const absent of ["'admin'", "'tutor'", "'parent'", "practice_context"]) expect(policies.rows[1].with_check, absent).not.toContain(absent);
    const tableGrants = await client.query("select privilege_type from information_schema.table_privileges where grantee='portal_runtime' and table_name = $1 order by privilege_type", [TABLE]);
    expect(tableGrants.rows).toEqual([{ privilege_type: "SELECT" }]);
    const columnGrants = await client.query("select column_name from information_schema.column_privileges where grantee='portal_runtime' and privilege_type='INSERT' and table_name = $1 order by column_name", [TABLE]);
    expect(columnGrants.rows).toEqual(["lesson_id", "student_id", "tenant_id"].map(column_name => ({ column_name })));
    expect((await client.query("select count(*)::int as n from information_schema.column_privileges where grantee='portal_runtime' and privilege_type in ('UPDATE','REFERENCES') and table_name = $1", [TABLE])).rows).toEqual([{ n: 0 }]);
    expect((await client.query("select count(*)::int as n from information_schema.table_privileges where grantee='PUBLIC' and table_name = $1", [TABLE])).rows).toEqual([{ n: 0 }]);
    const fks = await client.query<{ def: string }>("select pg_get_constraintdef(oid) as def from pg_constraint where contype='f' and conrelid::regclass::text = $1", [TABLE]);
    for (const row of fks.rows) expect(row.def).toMatch(/^FOREIGN KEY \(tenant_id[,)]/);
    // The owner can neither change nor remove a mark: insert-only by trigger as well as by grant.
    await client.query(`insert into ${TABLE}(tenant_id,student_id,lesson_id) values('crc',$1,'shma')`, [student.id]);
    await expect(client.query(`update ${TABLE} set finished_at = now()`)).rejects.toThrow();
    await expect(client.query(`delete from ${TABLE}`)).rejects.toThrow();
    for (const bad of ["shma@bm-shacharit", "Shma", "", "-x", "a".repeat(65)]) await expect(client.query(`insert into ${TABLE}(tenant_id,student_id,lesson_id) values('crc',$1,$2)`, [student.id, bad]), bad).rejects.toThrow();
    await expect(client.query(`insert into ${TABLE}(tenant_id,student_id,lesson_id) values('crc',$1,'shma')`, [student.id])).rejects.toThrow();
    await expect(client.query(`insert into ${TABLE}(tenant_id,student_id,lesson_id) values('other',$1,'vahavta')`, [student.id])).rejects.toThrow();
    expect(createHash("sha256").update(text).digest("hex")).toMatch(/^[a-f0-9]{64}$/);
  } finally { await client.close(); await isolation.cleanup(); }
});

async function sqlState(operation: PromiseLike<unknown>) {
  try { await operation; return "accepted"; } catch (error) {
    let value = error as { code?: unknown; cause?: unknown } | undefined;
    for (let depth = 0; value && depth < 4; depth++, value = value.cause as typeof value) if (typeof value.code === "string" && /^[A-Z0-9]{5}$/.test(value.code)) return value.code;
    return "unknown";
  }
}

test("row security as portal_runtime: each ruled reader sees exactly their own students' marks, positive controls included, and only the student writes", async () => {
  const f = await accessFixture(); opened.push(f);
  const [own, sibling, unrelated, other] = f.students;
  // A live child-practice context for the parent (multi) acting as Sibling A, and one for Sibling B.
  const contexts = await f.owner(async () => {
    for (const [student, lesson] of [[own, "shma"], [own, "vahavta"], [sibling, "shma"], [unrelated, "shma"], [other, "shma"]] as const)
      await f.client.query("insert into service_part_finished(tenant_id,student_id,lesson_id) values($1,$2,$3)", [student.tenantId, student.id, lesson]);
    const out: string[] = [];
    // The third has already expired (expiry is immutable once written, so it is written expired).
    for (const [index, student, guardian, created, expires] of [[0, own, 0, "0 seconds", "1 hour"], [1, sibling, 1, "0 seconds", "1 hour"], [2, own, 0, "2 hours", "-1 hour"]] as const) {
      const [row] = (await f.client.query<{ id: string }>(`insert into practice_context(tenant_id,token_hash,auth_session_id,actor_user_id,actor_membership_id,role_grant_id,role,mode,acting_student_id,guardian_id,authority_revision,created_at,expires_at)
        values('crc',$1,$2,$3,$4,$5,'parent','child-practice',$6,$7,1,now() - $8::interval,now() + $9::interval) returning id`, [createHash("sha256").update(`synthetic-${index}-${randomUUID()}`).digest("hex"), f.identities.multi.sessionId, f.identities.multi.id, f.multiMember.id, f.parentGrant.id, student.id, f.guardians[guardian].id, created, expires])).rows;
      out.push(row.id);
    }
    return out;
  });
  type Tx = Parameters<Parameters<typeof withTenantTransaction>[2]>[0];
  type Result = { rows: Record<string, unknown>[]; affectedRows?: number };
  const run = async (tx: Tx, statement: ReturnType<typeof sql>) => (await tx.execute(statement)) as unknown as Result;
  const as = <T>(tenant: string, reader: string | null, context: string | null, action: (tx: Tx) => Promise<T>) => withTenantTransaction(f.db, { tenantId: tenant }, async tx => {
    if (reader !== null) await tx.execute(sql`select set_config('app.service_part_reader', ${reader}, true)`);
    if (context !== null) await tx.execute(sql`select set_config('app.service_part_context', ${context}, true)`);
    return action(tx);
  });
  const seen = (tenant: string, reader: string | null, context: string | null = null) => as(tenant, reader, context, async tx =>
    (await run(tx, sql`select student_id, lesson_id from service_part_finished order by student_id, lesson_id`)).rows.map(r => `${r.student_id === own.id ? "own" : r.student_id === sibling.id ? "sibling" : "else"}:${r.lesson_id}`).sort());
  const insert = (reader: string | null, studentId: string, lesson: string, tenant = "crc") => sqlState(as(tenant, reader, null, tx => tx.execute(sql`insert into service_part_finished(tenant_id,student_id,lesson_id) values(${tenant},${studentId},${lesson})`)));

  // No reader (every staff list, MCP, cron, Sheet and notification path) sees nothing; a garbage reader fails closed.
  for (const reader of [null, ""]) expect(await seen("crc", reader)).toEqual([]);
  for (const garbage of ["not-a-uuid", `${f.adminGrant.id}' or true --`]) expect(await sqlState(seen("crc", garbage))).toBe("22P02");
  // Admin (rabbis are admins): every student of this congregation, never another congregation's.
  expect(await seen("crc", f.adminGrant.id)).toEqual(["else:shma", "own:shma", "own:vahavta", "sibling:shma"]);
  expect(await seen("other", f.adminGrant.id)).toEqual([]);
  // The tutor with a live tutor_student row sees that one student only (positive control), and nothing once the row is revoked.
  expect(await seen("crc", f.tutorGrant.id)).toEqual(["own:shma", "own:vahavta"]);
  // The student sees their own marks only.
  expect(await seen("crc", f.learnerGrant.id)).toEqual(["own:shma", "own:vahavta"]);
  // The parent grant in parent view (no context) sees nothing; in child practice, only the child the context names.
  expect(await seen("crc", f.parentGrant.id)).toEqual([]);
  expect(await seen("crc", f.parentGrant.id, contexts[0])).toEqual(["own:shma", "own:vahavta"]);
  expect(await seen("crc", f.parentGrant.id, contexts[1])).toEqual(["sibling:shma"]);
  // A context is not a reader of its own: under another grant (the tutor's, the admin's) it adds nothing.
  expect(await seen("crc", f.tutorGrant.id, contexts[1])).toEqual(["own:shma", "own:vahavta"]);
  expect(await seen("crc", null, contexts[0])).toEqual([]);

  // Only the student writes, and only for their own student; nobody updates or deletes.
  expect(await insert(f.learnerGrant.id, own.id, "torah-before")).toBe("accepted");
  for (const [reader, student] of [[f.learnerGrant.id, sibling.id], [f.adminGrant.id, own.id], [f.tutorGrant.id, own.id], [f.parentGrant.id, own.id], [null, own.id]] as const)
    expect(await insert(reader, student, "torah-after"), `${reader}`).toBe("42501");
  expect(await insert(f.learnerGrant.id, own.id, "torah-after", "other")).toBe("42501");
  expect(await sqlState(as("crc", f.learnerGrant.id, null, tx => tx.execute(sql`insert into service_part_finished(tenant_id,student_id,lesson_id,finished_at) values('crc',${own.id},'haftarah-before',now())`)))).toBe("42501");
  for (const statement of ["update service_part_finished set finished_at = now()", "update service_part_finished set lesson_id = lesson_id", "delete from service_part_finished", "truncate service_part_finished"])
    expect(await sqlState(as("crc", f.adminGrant.id, null, tx => tx.execute(sql.raw(statement)))), statement).toBe("42501");

  // Revocations take effect at once: the tutor link, the parent's context, the student's link, a disabled student, a disabled membership.
  await f.owner(() => f.client.query("update tutor_student set revoked_at = now() where id = $1", [f.tutorLink.id]));
  expect(await seen("crc", f.tutorGrant.id)).toEqual([]);
  await f.owner(() => f.client.query("update practice_context set revoked_at = now() where id = $1", [contexts[0]]));
  expect(await seen("crc", f.parentGrant.id, contexts[0])).toEqual([]);
  expect(await seen("crc", f.parentGrant.id, contexts[2])).toEqual([]);
  await f.owner(() => f.client.query("update guardian set practice_enabled = false where id = $1", [f.guardians[1].id]));
  expect(await seen("crc", f.parentGrant.id, contexts[1])).toEqual([]);
  await f.owner(() => f.client.query("update student_identity set revoked_at = now() where id = $1", [f.learnerLink.id]));
  expect(await seen("crc", f.learnerGrant.id)).toEqual([]);
  expect(await insert(f.learnerGrant.id, own.id, "haftarah-after")).toBe("42501");
  await f.owner(() => f.client.query("update role_grant set revoked_at = now() where id = $1", [f.adminGrant.id]));
  expect(await seen("crc", f.adminGrant.id)).toEqual([]);
  expect(await as("crc", null, null, async tx => (await run(tx, sql`select coalesce(current_setting('app.service_part_reader', true), '') as v`)).rows[0].v)).toBe("");
});
