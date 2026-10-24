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
import { name as validName, text as validText } from "../../src/server/saved/validation";

const TAG = "0036_saved_layer";
const TABLES = ["saved_reading", "saved_verse_mark", "saved_verse_work", "starred_comment"];
const opened: { client: { close(): Promise<void> } }[] = [];
afterEach(async () => { await Promise.all(opened.splice(0).map(f => f.client.close())); });

test("0036 adds only the four saved tables, leaves existing rows and the audit list unchanged, and replays", async () => {
  const isolation = await isolatedEnv(), client = new PGlite();
  try {
    const folder = "src/server/db/migrations", journal = JSON.parse(await readFile(join(folder, "meta/_journal.json"), "utf8"));
    const own = journal.entries.findIndex((e: { tag: string }) => e.tag === TAG);
    expect(journal.entries[own]).toMatchObject({ idx: 36, tag: TAG });
    expect(journal.entries[own].when).toBeGreaterThan(journal.entries.find((e: { tag: string }) => e.tag === "0035_crc_torah_product_name").when);
    const entries = journal.entries.slice(0, own), prior = join(isolation.home, "prior");
    await mkdir(join(prior, "meta"), { recursive: true }); await writeFile(join(prior, "meta/_journal.json"), JSON.stringify({ ...journal, entries }));
    for (const e of entries) await copyFile(join(folder, e.tag + ".sql"), join(prior, e.tag + ".sql"));
    const db = drizzle(client); await migrate(db, { migrationsFolder: prior });
    const member = randomUUID();
    await client.query("insert into student(id,tenant_id,first_name,last_name,ceremony_date,parent_email) values($1,'crc','Synthetic','Existing','2027-01-02','existing@example.test')", [randomUUID()]);
    await client.query("insert into \"user\"(id,name,email,email_verified) values('saved-existing','Synthetic parent',$1,true)", [["saved-existing", "example.test"].join("@")]);
    await client.query("insert into membership(id,tenant_id,user_id) values($1,'crc','saved-existing')", [member]);
    await client.query("insert into role_grant(id,tenant_id,membership_id,role) values($1,'crc',$2,'parent')", [randomUUID(), member]);
    const capture = async () => Object.fromEntries(await Promise.all(["student", "membership", "role_grant", "audit_event", "tenant"].map(async t => [t, (await client.query(`select * from ${t} order by 1`)).rows])));
    const before = await capture();
    await migrate(db, { migrationsFolder: folder }); await migrate(db, { migrationsFolder: folder });
    const after = await capture();
    for (const table of Object.keys(before)) expect(priorColumns(after[table], before[table])).toEqual(before[table]);
    for (const table of TABLES) expect((await client.query(`select count(*)::int as n from ${table}`)).rows).toEqual([{ n: 0 }]);

    // The generated snapshot adds the four tables and changes nothing else (0034 and 0035 were data-only, without snapshots).
    const snapshots = (await readdir(join(folder, "meta"))).filter(name => /^\d{4}_snapshot\.json$/.test(name)).sort();
    // Later migrations add their own snapshots; 0036's is compared with the one just before it.
    const at = snapshots.indexOf("0036_snapshot.json");
    expect(at).toBeGreaterThan(0);
    const previous = JSON.parse(await readFile(join(folder, "meta", snapshots[at - 1]), "utf8")), current = JSON.parse(await readFile(join(folder, "meta/0036_snapshot.json"), "utf8"));
    expect(current.prevId).toBe(previous.id);
    const expected = structuredClone(previous.tables);
    for (const table of TABLES) expected[`public.${table}`] = current.tables[`public.${table}`];
    expect(current.tables).toEqual(expected);
    for (const key of ["enums", "schemas", "sequences", "roles", "policies", "views"]) expect(current[key]).toEqual(previous[key]);
    expect(current.tables["public.audit_event"]).toEqual(previous.tables["public.audit_event"]);

    // Row security and grants are hand-written beside the generated DDL: forced, one policy, column UPDATE only, DELETE only on a member's own readings and stars.
    const text = await readFile(join(folder, `${TAG}.sql`), "utf8");
    expect(text).not.toContain("\r");
    for (const table of TABLES) for (const line of [`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`, `ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;`,
      `REVOKE ALL ON ${table} FROM PUBLIC;`, `REVOKE ALL ON ${table} FROM portal_runtime;`]) expect(text).toContain(line);
    for (const line of ["GRANT SELECT, INSERT, DELETE ON saved_reading TO portal_runtime;", "GRANT UPDATE (name, reading_date, revision, updated_at) ON saved_reading TO portal_runtime;",
      "GRANT SELECT, INSERT ON saved_verse_work TO portal_runtime;", "GRANT UPDATE (text, version, updated_at) ON saved_verse_work TO portal_runtime;",
      "GRANT SELECT, INSERT ON saved_verse_mark TO portal_runtime;", "GRANT UPDATE (state, version, updated_at) ON saved_verse_mark TO portal_runtime;",
      "GRANT SELECT, INSERT, DELETE ON starred_comment TO portal_runtime;"]) expect(text).toContain(line);
    expect(text).not.toMatch(/GRANT[^;(]*UPDATE ON/); expect(text).not.toMatch(/GRANT\s+(ALL|TRUNCATE)/i);
    expect(text.match(/GRANT[^;]*DELETE[^;]*;/g)).toEqual(["GRANT SELECT, INSERT, DELETE ON saved_reading TO portal_runtime;", "GRANT SELECT, INSERT, DELETE ON starred_comment TO portal_runtime;"]);
    expect(text).not.toMatch(/GRANT[^;]*ON starred_comment[^;]*UPDATE|GRANT UPDATE[^;]*ON starred_comment/);
    // Control characters are an explicit, locale-independent class (the app's own), never [[:cntrl:]].
    expect(text).not.toContain("[[:cntrl:]]");
    expect(text).toContain(String.raw`!~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f\x2028\x2029]'`);
    expect(text).toContain(String.raw`!~ '[\x01-\x1f\x7f-\x9f\x2028\x2029]'`);
    expect(text).toMatch(/^[\x09\x0a\x20-\x7e]*$/);
    expect(text).not.toMatch(/audit_event|DISABLE ROW LEVEL SECURITY|NO FORCE|DROP POLICY|tenant_isolation/i);
    const rls = await client.query("select relname, relrowsecurity, relforcerowsecurity from pg_class where relname = any($1) and relkind='r' order by relname", [TABLES]);
    expect(rls.rows).toEqual(TABLES.map(relname => ({ relname, relrowsecurity: true, relforcerowsecurity: true })));
    const owner = "((tenant_id = NULLIF(current_setting('app.tenant_id'::text, true), ''::text)) AND (membership_id = (NULLIF(current_setting('app.saved_owner'::text, true), ''::text))::uuid))";
    const policies = await client.query("select tablename, policyname, cmd, permissive, roles::text[] as roles, qual, with_check from pg_policies where tablename = any($1) order by tablename", [TABLES]);
    expect(policies.rows).toEqual(TABLES.map(tablename => ({ tablename, policyname: "owner_only", cmd: "ALL", permissive: "PERMISSIVE", roles: ["portal_runtime"], qual: owner, with_check: owner })));
    const tableGrants = await client.query("select table_name, privilege_type from information_schema.table_privileges where grantee='portal_runtime' and table_name = any($1) order by table_name, privilege_type", [TABLES]);
    expect(tableGrants.rows).toEqual([...["DELETE", "INSERT", "SELECT"].map(p => ({ table_name: "saved_reading", privilege_type: p })),
      ...["INSERT", "SELECT"].map(p => ({ table_name: "saved_verse_mark", privilege_type: p })), ...["INSERT", "SELECT"].map(p => ({ table_name: "saved_verse_work", privilege_type: p })),
      ...["DELETE", "INSERT", "SELECT"].map(p => ({ table_name: "starred_comment", privilege_type: p }))]);
    const columnGrants = await client.query("select table_name, column_name from information_schema.column_privileges where grantee='portal_runtime' and privilege_type='UPDATE' and table_name = any($1) order by table_name, column_name", [TABLES]);
    // After every migration: 0040 adds ranges and verse_count (a member revises their own reading's verses); nothing else widens.
    expect(columnGrants.rows).toEqual([...["name", "ranges", "reading_date", "revision", "updated_at", "verse_count"].map(c => ({ table_name: "saved_reading", column_name: c })),
      ...["state", "updated_at", "version"].map(c => ({ table_name: "saved_verse_mark", column_name: c })), ...["text", "updated_at", "version"].map(c => ({ table_name: "saved_verse_work", column_name: c }))]);
    expect((await client.query("select count(*)::int as n from information_schema.table_privileges where grantee='PUBLIC' and table_name = any($1)", [TABLES])).rows).toEqual([{ n: 0 }]);
    // Every composite key and FK carries the tenant.
    const fks = await client.query<{ conname: string; def: string }>("select conname, pg_get_constraintdef(oid) as def from pg_constraint where contype='f' and conrelid::regclass::text = any($1) order by conname", [TABLES]);
    for (const row of fks.rows) expect(row.def).toMatch(/^FOREIGN KEY \(tenant_id[,)]/);
    expect(fks.rows.filter(row => row.def.includes("ON DELETE CASCADE")).map(row => row.conname)).toEqual(["saved_verse_mark_reading_fk", "saved_verse_work_reading_fk"]);
  } finally { await client.close(); await isolation.cleanup(); }
});

test("the ranges, name, text and shape checks refuse what the app refuses", async () => {
  const client = new PGlite();
  try {
    await migrate(drizzle(client), { migrationsFolder: "src/server/db/migrations" });
    await client.query("insert into \"user\"(id,name,email,email_verified) values('check-user','Synthetic',$1,true)", [["check-user", "example.test"].join("@")]);
    const member = randomUUID(); await client.query("insert into membership(id,tenant_id,user_id) values($1,'crc','check-user')", [member]);
    const insert = (name: string, ranges: string, verses = 3, kind = "torah") => client.query("insert into saved_reading(tenant_id,membership_id,user_id,name,kind,ranges,verse_count) values('crc',$1,'check-user',$2,$3,$4,$5) returning id", [member, name, kind, ranges, verses]);
    for (const ranges of ["Genesis 1:1-3", "Genesis 1:1", "Isaiah 27:6-28:13; Isaiah 29:22-23", "I Samuel 20:18-42", Array(32).fill("Genesis 1:1").join("; ")]) await insert("Reading", ranges);
    for (const ranges of ["", "Genesis 1:1;Genesis 1:2", "Genesis 1:1; ", "Genesis 1:1;  Genesis 1:2", "Genesis 1:1-", Array(33).fill("Genesis 1:1").join("; "), "Genesis 1:1; ".repeat(80) + "Genesis 1:1"])
      await expect(insert("Reading", ranges), ranges).rejects.toThrow();
    for (const name of ["", " Padded", "Padded ", "x".repeat(81), "Tab\tname", "Line\nname"]) await expect(insert(name, "Genesis 1:1"), JSON.stringify(name)).rejects.toThrow();
    await insert("x".repeat(80), "Genesis 1:1");
    for (const [verses, kind] of [[0, "torah"], [1001, "torah"], [3, "ketuvim"]] as const) await expect(insert("Reading", "Genesis 1:1-3", verses, kind)).rejects.toThrow();
    const [{ id }] = (await insert("Parent", "Genesis 1:1-3")).rows as { id: string }[];
    const work = (text: string, stream = "note", ref = "Genesis 1:1") => client.query("insert into saved_verse_work(tenant_id,membership_id,saved_reading_id,verse_ref,stream,text,version) values('crc',$1,$2,$3,$4,$5,1)", [member, id, ref, stream, text]);
    await work("A note\twith a tab\nand a line.");
    for (const bad of ["line\u2028sep", "para\u2029sep", "next\u0085line", "esc\u001b"]) await expect(work(bad, "translation", "Genesis 1:3"), JSON.stringify(bad)).rejects.toThrow();
    for (const bad of ["a\u2028b", "a\u0085b"]) await expect(insert(bad, "Genesis 1:1"), JSON.stringify(bad)).rejects.toThrow();
    // The CHECKs and the app refuse exactly the same code points, whatever the database's locale: the app always refuses first.
    const refused = async (column: "name" | "text") => new Set((await client.query<{ cp: number }>(column === "name"
      ? String.raw`select cp from generate_series(1, 12288) cp where chr(cp) ~ '[\x01-\x1f\x7f-\x9f\x2028\x2029]' and cp not between 55296 and 57343`
      : String.raw`select cp from generate_series(1, 12288) cp where chr(cp) ~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f\x2028\x2029]' and cp not between 55296 and 57343`)).rows.map(row => row.cp));
    const appRefuses = (check: (value: unknown) => string, cp: number) => { try { check(`a${String.fromCodePoint(cp)}b`); return false; } catch { return true; } };
    for (const [column, check] of [["name", validName], ["text", validText]] as const) {
      const db = await refused(column);
      for (let cp = 1; cp <= 12288; cp++) {
        if (cp >= 55296 && cp <= 57343) continue;
        // Carriage return is normalized to a newline by the app before it is stored.
        if (column === "text" && cp === 13) { expect(db.has(cp)).toBe(false); continue; }
        expect(appRefuses(check, cp), `${column} U+${cp.toString(16)}`).toBe(db.has(cp));
      }
    }
    for (const [text, stream, ref] of [["x".repeat(4097), "translation", "Genesis 1:2"], ["bell\u0007", "translation", "Genesis 1:2"], ["ok", "draft", "Genesis 1:2"], ["ok", "translation", "Genesis 1"], ["ok", "translation", "Genesis 1:0"]])
      await expect(work(text, stream, ref)).rejects.toThrow();
    await expect(client.query("insert into saved_verse_mark(tenant_id,membership_id,saved_reading_id,verse_ref,state,version) values('crc',$1,$2,'Genesis 1:1','done',1)", [member, id])).rejects.toThrow();
    for (const [work_, index] of [["Rashi", 1], ["rashi", 0], ["rashi", 61]] as const)
      await expect(client.query("insert into starred_comment(tenant_id,membership_id,user_id,work,verse_ref,comment_index) values('crc',$1,'check-user',$2,'Genesis 1:1',$3)", [member, work_, index])).rejects.toThrow();
    // A child row can only point at a reading of its own member: the FK carries the membership.
    const stranger = randomUUID();
    await client.query("insert into \"user\"(id,name,email,email_verified) values('check-other','Synthetic',$1,true)", [["check-other", "example.test"].join("@")]);
    await client.query("insert into membership(id,tenant_id,user_id) values($1,'crc','check-other')", [stranger]);
    await expect(client.query("insert into saved_verse_work(tenant_id,membership_id,saved_reading_id,verse_ref,stream,text,version) values('crc',$1,$2,'Genesis 1:3','note','x',1)", [stranger, id])).rejects.toThrow();
  } finally { await client.close(); }
});

async function sqlState(operation: PromiseLike<unknown>) {
  try { await operation; return "accepted"; } catch (error) {
    let value = error as { code?: unknown; cause?: unknown } | undefined;
    for (let depth = 0; value && depth < 4; depth++, value = value.cause as typeof value) if (typeof value.code === "string" && /^[A-Z0-9]{5}$/.test(value.code)) return value.code;
    return "unknown";
  }
}

test("row security as portal_runtime: no owner sees nothing, one owner never reaches another's rows, and a garbage owner fails closed", async () => {
  const f = await accessFixture(); opened.push(f);
  const A = f.multiMember, B = f.adminMember;
  const seed = await f.owner(async () => {
    const rows: Record<string, string> = {};
    for (const [key, member, user] of [["a", A.id, f.identities.multi.id], ["b", B.id, f.identities.admin.id]] as const) {
      const { rows: [reading] } = await f.client.query<{ id: string }>("insert into saved_reading(tenant_id,membership_id,user_id,name,kind,ranges,verse_count) values('crc',$1,$2,'Synthetic','torah','Genesis 1:1-3',3) returning id", [member, user]);
      rows[key] = reading.id;
      await f.client.query("insert into saved_verse_work(tenant_id,membership_id,saved_reading_id,verse_ref,stream,text,version) values('crc',$1,$2,'Genesis 1:1','note','private',1)", [member, reading.id]);
      await f.client.query("insert into saved_verse_mark(tenant_id,membership_id,saved_reading_id,verse_ref,state,version) values('crc',$1,$2,'Genesis 1:1','working',1)", [member, reading.id]);
      await f.client.query("insert into starred_comment(tenant_id,membership_id,user_id,work,verse_ref,comment_index) values('crc',$1,$2,'rashi','Genesis 1:1',1)", [member, user]);
    }
    return rows;
  });
  type Tx = Parameters<Parameters<typeof withTenantTransaction>[2]>[0];
  type Result = { rows: Record<string, unknown>[]; affectedRows?: number };
  const run = async (tx: Tx, statement: ReturnType<typeof sql>) => (await tx.execute(statement)) as unknown as Result;
  const as = <T>(tenant: string, owner: string | null, action: (tx: Tx) => Promise<T>) =>
    withTenantTransaction(f.db, { tenantId: tenant }, async tx => { if (owner !== null) await tx.execute(sql`select set_config('app.saved_owner', ${owner}, true)`); return action(tx); });
  const counts = (tx: Tx) => Promise.all(TABLES.map(async t => Number((await run(tx, sql.raw(`select count(*)::int as n from ${t}`))).rows[0].n)));
  const affected = (tenant: string, owner: string | null, statement: ReturnType<typeof sql>) => as(tenant, owner, async tx => (await run(tx, statement)).affectedRows ?? 0);
  const newReading = (member: string, user: string) => sql`insert into saved_reading(tenant_id,membership_id,user_id,name,kind,ranges,verse_count) values('crc',${member},${user},'X','torah','Genesis 1:1',1)`;
  // The tenant alone (every staff, MCP, cron and Sheet path) sees nothing and can write nothing.
  for (const owner of [null, ""]) {
    expect(await as("crc", owner, counts)).toEqual([0, 0, 0, 0]);
    expect(await sqlState(as("crc", owner, tx => tx.execute(newReading(A.id, f.identities.multi.id))))).toBe("42501");
    expect(await affected("crc", owner, sql`delete from saved_reading`)).toBe(0);
    expect(await affected("crc", owner, sql`update saved_verse_work set text = 'x'`)).toBe(0);
  }
  // Each owner sees exactly their own rows.
  expect(await as("crc", A.id, counts)).toEqual([1, 1, 1, 1]);
  expect(await as("crc", A.id, async tx => (await run(tx, sql`select id from saved_reading`)).rows.map(r => r.id))).toEqual([seed.a]);
  // Owner A cannot update or delete B's rows, insert rows for B, or point a child row at B's reading.
  for (const statement of [sql`update saved_reading set name = 'Taken' where id = ${seed.b}`, sql`delete from saved_reading where id = ${seed.b}`,
    sql`update saved_verse_work set text = 'Taken' where saved_reading_id = ${seed.b}`, sql`update saved_verse_mark set state = 'got-it' where saved_reading_id = ${seed.b}`,
    sql`delete from starred_comment where membership_id = ${B.id}`]) expect(await affected("crc", A.id, statement)).toBe(0);
  expect(await sqlState(as("crc", A.id, tx => tx.execute(newReading(B.id, f.identities.admin.id))))).toBe("42501");
  expect(await sqlState(as("crc", A.id, tx => tx.execute(sql`insert into saved_verse_work(tenant_id,membership_id,saved_reading_id,verse_ref,stream,text,version) values('crc',${B.id},${seed.b},'Genesis 1:2','note','x',1)`)))).toBe("42501");
  expect(await sqlState(as("crc", A.id, tx => tx.execute(sql`insert into saved_verse_work(tenant_id,membership_id,saved_reading_id,verse_ref,stream,text,version) values('crc',${A.id},${seed.b},'Genesis 1:2','note','x',1)`)))).toBe("23503");
  expect(await sqlState(as("crc", A.id, tx => tx.execute(sql`insert into starred_comment(tenant_id,membership_id,user_id,work,verse_ref,comment_index) values('crc',${B.id},${f.identities.admin.id},'rashi','Genesis 1:2',1)`)))).toBe("42501");
  // Since 0040 an owner may revise the ranges and verse count of their own reading only: another member's row is out of reach.
  expect(await affected("crc", A.id, sql`update saved_reading set ranges = 'Genesis 1:1', verse_count = 1 where id = ${seed.b}`)).toBe(0);
  for (const owner of [null, ""]) expect(await affected("crc", owner, sql`update saved_reading set ranges = 'Genesis 1:1', verse_count = 1`)).toBe(0);
  expect(await affected("other", A.id, sql`update saved_reading set ranges = 'Genesis 1:1', verse_count = 1`)).toBe(0);
  expect(await as("crc", B.id, async tx => (await run(tx, sql`select ranges, verse_count from saved_reading`)).rows)).toEqual([{ ranges: "Genesis 1:1-3", verse_count: 3 }]);
  // Ownership and identity columns never change, and child rows are never deleted directly.
  for (const statement of ["update saved_reading set membership_id = membership_id", "update saved_reading set tenant_id = tenant_id", "update saved_reading set kind = 'haftarah'",
    "update saved_reading set user_id = user_id", "update saved_reading set created_at = now()", "update saved_verse_work set membership_id = membership_id", "update saved_verse_work set saved_reading_id = saved_reading_id",
    "update saved_verse_work set stream = 'translation'", "update saved_verse_mark set verse_ref = verse_ref", "update starred_comment set work = work", "update starred_comment set membership_id = membership_id",
    "update starred_comment set comment_index = 2", "delete from saved_verse_work", "delete from saved_verse_mark", "truncate saved_reading cascade", "truncate starred_comment"])
    expect(await sqlState(as("crc", A.id, tx => tx.execute(sql.raw(statement)))), statement).toBe("42501");
  // A malformed owner throws instead of matching; an owner from another congregation matches nothing.
  for (const garbage of ["not-a-uuid", `${A.id}' or true --`]) expect(await sqlState(as("crc", garbage, counts))).toBe("22P02");
  expect(await as("other", A.id, counts)).toEqual([0, 0, 0, 0]);
  // The owner's own delete cascades as the table owner, though the runtime has no DELETE on the children.
  expect(await affected("crc", A.id, sql`delete from saved_reading where id = ${seed.a}`)).toBe(1);
  expect(await as("crc", A.id, counts)).toEqual([0, 0, 0, 1]);
  expect(await as("crc", B.id, counts)).toEqual([1, 1, 1, 1]);
  // Unstarring is the owner's own delete: an unscoped delete removes only the owner's stars.
  expect(await affected("crc", A.id, sql`delete from starred_comment`)).toBe(1);
  expect(await as("crc", B.id, counts)).toEqual([1, 1, 1, 1]);
  // The setting is transaction-local: the next transaction on the same connection has no owner.
  expect(await as("crc", null, async tx => (await run(tx, sql`select coalesce(current_setting('app.saved_owner', true), '') as v`)).rows[0].v)).toBe("");
});
