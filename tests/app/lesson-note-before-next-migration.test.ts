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

// Release 1.9 N12: the optional "Before next time" line, migration 0045 on lesson_log. Synthetic text only.
// One column on the note's own table: the same forced tenant_isolation policy and table grants, so the same readers.
const TAG = "0045_lesson_note_before_next", TABLE = "lesson_log";
const opened: { client: { close(): Promise<void> } }[] = [];
afterEach(async () => { await Promise.all(opened.splice(0).map(f => f.client.close())); });

test("0045 adds only the nullable before_next column and its CHECK to lesson_log, keeps every note, policy and table grant, adds only the column UPDATE grant, and replays", async () => {
  const isolation = await isolatedEnv(), client = new PGlite();
  try {
    const folder = "src/server/db/migrations", journal = JSON.parse(await readFile(join(folder, "meta/_journal.json"), "utf8"));
    const own = journal.entries.findIndex((e: { tag: string }) => e.tag === TAG);
    // 0045, merged before SC4 (which renumbers after it); every check below is relative to the entry before it.
    expect(own).toBeGreaterThan(0);
    expect(journal.entries[own]).toMatchObject({ idx: own, tag: TAG });
    expect(journal.entries[own].when).toBeGreaterThan(journal.entries[own - 1].when);
    const entries = journal.entries.slice(0, own), prior = join(isolation.home, "prior"), through = join(isolation.home, "through");
    for (const [dir, list] of [[prior, entries], [through, journal.entries.slice(0, own + 1)]] as const) {
      await mkdir(join(dir, "meta"), { recursive: true }); await writeFile(join(dir, "meta/_journal.json"), JSON.stringify({ ...journal, entries: list }));
      for (const e of list) await copyFile(join(folder, e.tag + ".sql"), join(dir, e.tag + ".sql"));
    }
    const db = drizzle(client); await migrate(db, { migrationsFolder: prior });
    // An existing live note and an existing tombstone survive the upgrade unchanged, with no Before next time line.
    const member = randomUUID(), student = randomUUID(), live = randomUUID(), gone = randomUUID();
    await client.query("insert into \"user\"(id,name,email,email_verified) values('lesson-existing','Synthetic tutor',$1,true)", [["lesson-existing", "example.test"].join("@")]);
    await client.query("insert into membership(id,tenant_id,user_id) values($1,'crc','lesson-existing')", [member]);
    await client.query("insert into student(id,tenant_id,first_name,last_name,ceremony_date,parent_email) values($1,'crc','Synthetic','Existing','2027-01-02',$2)", [student, ["parent", "example.test"].join("@")]);
    for (const [entry, summary] of [[live, "Synthetic existing lesson"], [gone, "Synthetic deleted lesson"]]) {
      await client.query("insert into lesson_log(tenant_id,student_id,entry_id,creator_membership_id,creator_user_id,lesson_date,summary,version) values('crc',$1,$2,$3,'lesson-existing','2026-10-16',$4,1)", [student, entry, member, summary]);
    }
    await client.query("update lesson_log set summary='', deleted=true, version=2 where entry_id=$1", [gone]);
    const capture = async () => Object.fromEntries(await Promise.all(["lesson_log", "membership", "role_grant", "audit_event", "tenant", "student", "guardian", "tutor_student"]
      .map(async t => [t, (await client.query(`select * from ${t} order by 1, 2, 3`)).rows])));
    const policies = async () => (await client.query("select tablename, policyname, cmd, permissive, roles::text[] as roles, qual, with_check from pg_policies order by 1, 2")).rows;
    const tableGrants = async () => (await client.query("select table_name, grantee, privilege_type from information_schema.table_privileges where grantee in ('portal_runtime','PUBLIC') order by 1, 2, 3")).rows;
    const columnGrants = async () => (await client.query<{ table_name: string; column_name: string; privilege_type: string }>("select table_name, column_name, privilege_type from information_schema.column_privileges where grantee in ('portal_runtime','PUBLIC') and table_name = $1 order by 1, 2, 3", [TABLE])).rows;
    const triggers = async () => (await client.query("select tgname from pg_trigger where tgrelid = 'lesson_log'::regclass and not tgisinternal order by 1")).rows;
    const before = { rows: await capture(), policies: await policies(), tableGrants: await tableGrants(), columnGrants: await columnGrants(), triggers: await triggers() };
    await migrate(db, { migrationsFolder: through }); await migrate(db, { migrationsFolder: through });
    const after = await capture();
    for (const table of Object.keys(before.rows)) expect(priorColumns(after[table], before.rows[table])).toEqual(before.rows[table]);
    expect((await client.query("select entry_id, before_next from lesson_log order by entry_id")).rows).toEqual([live, gone].sort().map(entry_id => ({ entry_id, before_next: null })));

    // Readers unchanged: every policy (lesson_log's one tenant_isolation included) and every table grant is as before.
    expect(await policies()).toEqual(before.policies);
    expect(await tableGrants()).toEqual(before.tableGrants);
    expect(await triggers()).toEqual(before.triggers);
    const isolation_ = "(tenant_id = NULLIF(current_setting('app.tenant_id'::text, true), ''::text))";
    expect((await client.query("select policyname, cmd, roles::text[] as roles, qual, with_check from pg_policies where tablename = $1", [TABLE])).rows)
      .toEqual([{ policyname: "tenant_isolation", cmd: "ALL", roles: ["portal_runtime"], qual: isolation_, with_check: isolation_ }]);
    expect((await client.query("select relrowsecurity, relforcerowsecurity from pg_class where relname = $1 and relkind = 'r'", [TABLE])).rows).toEqual([{ relrowsecurity: true, relforcerowsecurity: true }]);
    expect((await client.query("select privilege_type from information_schema.table_privileges where grantee = 'portal_runtime' and table_name = $1 order by 1", [TABLE])).rows)
      .toEqual([{ privilege_type: "INSERT" }, { privilege_type: "SELECT" }]);
    // The one new privilege is UPDATE on the new column, beside the note's own updatable columns.
    const added = (await columnGrants()).filter(row => !before.columnGrants.some(old => JSON.stringify(old) === JSON.stringify(row)));
    const selectAdded = added.filter(row => row.privilege_type !== "UPDATE");
    expect(added.filter(row => row.privilege_type === "UPDATE")).toEqual([{ table_name: TABLE, column_name: "before_next", privilege_type: "UPDATE" }]);
    // information_schema lists a table-wide grant per column, so the new column also shows the table's own INSERT and SELECT.
    expect(selectAdded.map(row => `${row.column_name}:${row.privilege_type}`).sort()).toEqual(["before_next:INSERT", "before_next:SELECT"]);
    expect((await client.query("select count(*)::int as n from information_schema.table_privileges where grantee = 'PUBLIC' and table_name = $1", [TABLE])).rows).toEqual([{ n: 0 }]);

    // The generated snapshot adds the one column and the one CHECK to lesson_log and changes nothing else.
    const snapshots = (await readdir(join(folder, "meta"))).filter(name => /^\d{4}_snapshot\.json$/.test(name)).sort();
    const at = snapshots.indexOf("0045_snapshot.json");
    expect(snapshots[at - 1]).toBe(`${journal.entries[own - 1].tag.slice(0, 4)}_snapshot.json`);
    const previous = JSON.parse(await readFile(join(folder, "meta", snapshots[at - 1]), "utf8")), current = JSON.parse(await readFile(join(folder, "meta/0045_snapshot.json"), "utf8"));
    expect(current.prevId).toBe(previous.id);
    const expected = structuredClone(previous.tables), log = expected[`public.${TABLE}`];
    expect(log.columns.before_next).toBeUndefined();
    log.columns = Object.fromEntries(Object.entries(log.columns).flatMap(([name, column]) => name === "summary" ? [[name, column], ["before_next", current.tables[`public.${TABLE}`].columns.before_next]] : [[name, column]]));
    log.checkConstraints = { ...log.checkConstraints, lesson_log_before_next: current.tables[`public.${TABLE}`].checkConstraints.lesson_log_before_next };
    expect(current.tables).toEqual(expected);
    expect(current.tables[`public.${TABLE}`].columns.before_next).toEqual({ name: "before_next", type: "text", primaryKey: false, notNull: false });
    for (const key of ["enums", "schemas", "sequences", "roles", "policies", "views"]) expect(current[key]).toEqual(previous[key]);

    // The hand-written part is one column GRANT; nothing drops, disables or re-creates a policy, and no text reaches the audit.
    const text = await readFile(join(folder, `${TAG}.sql`), "utf8");
    expect(text).not.toContain("\r");
    expect(text).toMatch(/^[\x09\x0a\x20-\x7e]*$/);
    const statements = text.split("--> statement-breakpoint").map(part => part.replace(/^--.*$/gm, "").trim()).filter(Boolean);
    expect(statements.join("\n")).not.toMatch(/DISABLE ROW LEVEL SECURITY|NO FORCE|POLICY|DROP |audit_event|SECURITY DEFINER|REVOKE|PUBLIC/i);
    expect(statements).toHaveLength(3);
    for (const statement of statements) expect(statement).toMatch(/lesson_log/);
    const grants = statements.filter(statement => /^GRANT\b/i.test(statement));
    expect(grants).toEqual(["GRANT UPDATE (before_next) ON lesson_log TO portal_runtime;"]);
  } finally { await client.close(); await isolation.cleanup(); }
});

async function sqlState(operation: PromiseLike<unknown>) {
  try { await operation; return "accepted"; } catch (error) {
    let value = error as { code?: unknown; cause?: unknown } | undefined;
    for (let depth = 0; value && depth < 4; depth++, value = value.cause as typeof value) if (typeof value.code === "string" && /^[A-Z0-9]{5}$/.test(value.code)) return value.code;
    return "unknown";
  }
}

test("as portal_runtime the CHECK holds the line to 1024 bytes of non-blank text, a tombstone keeps none, and another congregation sees no line", async () => {
  const f = await accessFixture(); opened.push(f);
  const student = f.students[0].id, entry = randomUUID();
  type Tx = Parameters<Parameters<typeof withTenantTransaction>[2]>[0];
  const as = <T>(tenant: string, action: (tx: Tx) => Promise<T>) => withTenantTransaction(f.db, { tenantId: tenant }, action);
  const state = (tenant: string, statement: ReturnType<typeof sql>) => sqlState(as(tenant, tx => tx.execute(statement)));
  const insert = (id: string, next: string | null) => sql`insert into lesson_log(tenant_id,student_id,entry_id,creator_membership_id,creator_user_id,lesson_date,summary,version,before_next)
    values('crc',${student},${id},${f.multiMember.id},${f.identities.multi.id},'2026-10-16','Synthetic lesson',1,${next})`;
  // Blank is held as the summary's own CHECK holds it (spaces); the application also refuses every other blank.
  for (const bad of ["", "   ", "x".repeat(1025), "א".repeat(513)]) expect(await state("crc", insert(randomUUID(), bad)), `${bad.length}`).toBe("23514");
  expect(await state("crc", insert(randomUUID(), "x".repeat(1024)))).toBe("accepted");
  expect(await state("crc", insert(randomUUID(), "א".repeat(512)))).toBe("accepted");
  expect(await state("crc", insert(entry, "When I get home from school, I will chant verse one twice."))).toBe("accepted");
  // The runtime may change the line on a live note, as it may the summary, and only through the version rule.
  expect(await state("crc", sql`update lesson_log set before_next = 'When it is Sunday, I will review the blessing.', version = 2 where entry_id = ${entry}`)).toBe("accepted");
  expect(await state("crc", sql`update lesson_log set before_next = ${"x".repeat(1025)}, version = 3 where entry_id = ${entry}`)).toBe("23514");
  // A tombstone clears the line with the summary; one that keeps it is refused.
  expect(await state("crc", sql`update lesson_log set summary = '', deleted = true, version = 3 where entry_id = ${entry}`)).toBe("23514");
  expect(await state("crc", sql`update lesson_log set summary = '', before_next = null, deleted = true, version = 3 where entry_id = ${entry}`)).toBe("accepted");
  // Another congregation reads no row of this one, so no line.
  expect(await as("other", async tx => ((await tx.execute(sql`select count(*)::int as n from lesson_log where before_next is not null`)) as unknown as { rows: { n: number }[] }).rows)).toEqual([{ n: 0 }]);
  expect(await as("crc", async tx => ((await tx.execute(sql`select count(*)::int as n from lesson_log where before_next is not null`)) as unknown as { rows: { n: number }[] }).rows)).toEqual([{ n: 2 }]);
});
