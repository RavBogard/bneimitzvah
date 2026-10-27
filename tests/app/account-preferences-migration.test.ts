import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { and, eq, sql } from "drizzle-orm";
import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { isolatedEnv } from "../helpers/isolatedEnv.mjs";
import { priorColumns } from "../helpers/prior-columns";
import { accessFixture } from "./access-fixture";
import { withTenantTransaction } from "../../src/server/db/runtime";
import * as s from "../../src/server/db/index";

// Release 1.7 M3b: a member's own preferred commentaries and reading settings, on the 0036 saved layer's owner binding.
const TAG = "0041_account_preferences", TABLE = "account_preference";
const opened: { client: { close(): Promise<void> } }[] = [];
afterEach(async () => { await Promise.all(opened.splice(0).map(f => f.client.close())); });
const doc = (extra: Record<string, unknown> = {}) => JSON.stringify({ version: 1, ...extra });

test("0041 adds only the account_preference table, leaves existing rows and the audit list unchanged, and replays", async () => {
  const isolation = await isolatedEnv(), client = new PGlite();
  try {
    const folder = "src/server/db/migrations", journal = JSON.parse(await readFile(join(folder, "meta/_journal.json"), "utf8"));
    const own = journal.entries.findIndex((e: { tag: string }) => e.tag === TAG);
    expect(journal.entries[own]).toMatchObject({ idx: 41, tag: TAG });
    expect(journal.entries[own - 1]).toMatchObject({ idx: 40, tag: "0040_saved_reading_ranges" });
    expect(journal.entries[own].when).toBeGreaterThan(journal.entries[own - 1].when);
    const entries = journal.entries.slice(0, own), prior = join(isolation.home, "prior");
    await mkdir(join(prior, "meta"), { recursive: true }); await writeFile(join(prior, "meta/_journal.json"), JSON.stringify({ ...journal, entries }));
    for (const e of entries) await copyFile(join(folder, e.tag + ".sql"), join(prior, e.tag + ".sql"));
    const db = drizzle(client); await migrate(db, { migrationsFolder: prior });
    const member = randomUUID();
    await client.query("insert into \"user\"(id,name,email,email_verified) values('prefs-existing','Synthetic reader',$1,true)", [["prefs-existing", "example.test"].join("@")]);
    await client.query("insert into membership(id,tenant_id,user_id) values($1,'crc','prefs-existing')", [member]);
    await client.query("insert into role_grant(id,tenant_id,membership_id,role) values($1,'crc',$2,'tutor')", [randomUUID(), member]);
    const capture = async () => Object.fromEntries(await Promise.all(["membership", "role_grant", "audit_event", "tenant", "saved_reading", "course_progress", "starred_comment"]
      .map(async t => [t, (await client.query(`select * from ${t} order by 1`)).rows])));
    const before = await capture();
    await migrate(db, { migrationsFolder: folder }); await migrate(db, { migrationsFolder: folder });
    const after = await capture();
    for (const table of Object.keys(before)) expect(priorColumns(after[table], before[table])).toEqual(before[table]);
    expect((await client.query(`select count(*)::int as n from ${TABLE}`)).rows).toEqual([{ n: 0 }]);

    // The generated snapshot adds the one table and changes nothing else (0040 was grant-only, with no snapshot).
    const snapshots = (await readdir(join(folder, "meta"))).filter(name => /^\d{4}_snapshot\.json$/.test(name)).sort();
    const at = snapshots.indexOf("0041_snapshot.json");
    expect(at).toBeGreaterThan(0);
    const previous = JSON.parse(await readFile(join(folder, "meta", snapshots[at - 1]), "utf8")), current = JSON.parse(await readFile(join(folder, "meta/0041_snapshot.json"), "utf8"));
    expect(current.prevId).toBe(previous.id);
    const expected = structuredClone(previous.tables);
    expected[`public.${TABLE}`] = current.tables[`public.${TABLE}`];
    expect(current.tables).toEqual(expected);
    for (const key of ["enums", "schemas", "sequences", "roles", "policies", "views"]) expect(current[key]).toEqual(previous[key]);

    // Row security and grants are hand-written beside the generated DDL: forced, one policy, column UPDATE only, no DELETE.
    const text = await readFile(join(folder, `${TAG}.sql`), "utf8");
    expect(text).not.toContain("\r");
    for (const line of [`ALTER TABLE ${TABLE} ENABLE ROW LEVEL SECURITY;`, `ALTER TABLE ${TABLE} FORCE ROW LEVEL SECURITY;`, `REVOKE ALL ON ${TABLE} FROM PUBLIC;`, `REVOKE ALL ON ${TABLE} FROM portal_runtime;`,
      `GRANT SELECT, INSERT ON ${TABLE} TO portal_runtime;`, `GRANT UPDATE (preferences, revision, updated_at) ON ${TABLE} TO portal_runtime;`]) expect(text).toContain(line);
    expect(text).not.toMatch(/GRANT[^;(]*UPDATE ON/); expect(text).not.toMatch(/GRANT\s+(ALL|TRUNCATE)/i); expect(text).not.toMatch(/GRANT[^;]*DELETE/);
    expect(text).toMatch(/^[\x09\x0a\x20-\x7e]*$/);
    expect(text).not.toMatch(/audit_event|DISABLE ROW LEVEL SECURITY|NO FORCE|DROP POLICY|tenant_isolation|app\.course_owner|saved_reading|course_progress/i);
    // Only this table is touched: every statement names account_preference.
    for (const statement of text.split("--> statement-breakpoint").map(part => part.replace(/^--.*$/gm, "").trim()).filter(Boolean)) expect(statement).toMatch(/account_preference/);
    const rls = await client.query("select relname, relrowsecurity, relforcerowsecurity from pg_class where relname = $1 and relkind='r'", [TABLE]);
    expect(rls.rows).toEqual([{ relname: TABLE, relrowsecurity: true, relforcerowsecurity: true }]);
    const owner = "((tenant_id = NULLIF(current_setting('app.tenant_id'::text, true), ''::text)) AND (membership_id = (NULLIF(current_setting('app.saved_owner'::text, true), ''::text))::uuid))";
    const policies = await client.query("select tablename, policyname, cmd, permissive, roles::text[] as roles, qual, with_check from pg_policies where tablename = $1", [TABLE]);
    expect(policies.rows).toEqual([{ tablename: TABLE, policyname: "owner_only", cmd: "ALL", permissive: "PERMISSIVE", roles: ["portal_runtime"], qual: owner, with_check: owner }]);
    // The same policy text as the saved readings' own owner_only (0036); 0054's read-only staff_read and directory_read sit beside it and are pinned by their own test.
    const saved = await client.query("select qual, with_check from pg_policies where tablename = 'saved_reading' and policyname = 'owner_only'");
    expect(saved.rows).toEqual([{ qual: owner, with_check: owner }]);
    const tableGrants = await client.query("select privilege_type from information_schema.table_privileges where grantee='portal_runtime' and table_name = $1 order by privilege_type", [TABLE]);
    expect(tableGrants.rows).toEqual([{ privilege_type: "INSERT" }, { privilege_type: "SELECT" }]);
    const columnGrants = await client.query("select column_name from information_schema.column_privileges where grantee='portal_runtime' and privilege_type='UPDATE' and table_name = $1 order by column_name", [TABLE]);
    expect(columnGrants.rows).toEqual(["preferences", "revision", "updated_at"].map(column_name => ({ column_name })));
    expect((await client.query("select count(*)::int as n from information_schema.table_privileges where grantee='PUBLIC' and table_name = $1", [TABLE])).rows).toEqual([{ n: 0 }]);
    const fks = await client.query<{ def: string }>("select pg_get_constraintdef(oid) as def from pg_constraint where contype='f' and conrelid::regclass::text = $1", [TABLE]);
    expect(fks.rows.length).toBe(2);
    for (const row of fks.rows) expect(row.def).toMatch(/^FOREIGN KEY \(tenant_id[,)]/);
  } finally { await client.close(); await isolation.cleanup(); }
});

test("the CHECKs refuse anything but a small version-1 document of allow-listed fields and values, and the key holds one document per member", async () => {
  const client = new PGlite();
  try {
    await migrate(drizzle(client), { migrationsFolder: "src/server/db/migrations" });
    await client.query("insert into \"user\"(id,name,email,email_verified) values('prefs-check','Synthetic',$1,true)", [["prefs-check", "example.test"].join("@")]);
    const member = randomUUID(); await client.query("insert into membership(id,tenant_id,user_id) values($1,'crc','prefs-check')", [member]);
    const insert = (preferences: string, revision = 1) => client.query("insert into account_preference(tenant_id,membership_id,user_id,preferences,revision) values('crc',$1,'prefs-check',$2::jsonb,$3)", [member, preferences, revision]);
    for (const bad of ["[]", "\"x\"", "1", "{}", JSON.stringify({ version: 2 }), JSON.stringify({ version: "1" }), doc({ note: "free text" }), doc({ works: "rashi" }), doc({ works: {} }),
      doc({ works: ["a", "b", "c", "d"] }), doc({ works: [1] }), doc({ works: ["Rashi"] }), doc({ works: ["x".repeat(40)] }), doc({ works: [null] }), doc({ colors: "yes" }), doc({ colors: null }),
      doc({ studyEnglish: 1 }), doc({ translation: [] }), doc({ size: "giant" }), doc({ size: 2 }), doc({ size: null }), doc({ tikkunView: "on" }), doc({ tikkunView: true })]) {
      await expect(insert(bad), bad.slice(0, 60)).rejects.toThrow();
    }
    await expect(insert(doc(), 0)).rejects.toThrow();
    await insert(doc({ works: ["rashi", "womens"], studyEnglish: false, colors: false, translation: true, size: "huge", tikkunView: "only" }));
    await expect(insert(doc())).rejects.toThrow();
    // Every commentary off is a choice the table keeps.
    await client.query("update account_preference set preferences = $1::jsonb, revision = 2 where membership_id = $2", [doc({ works: [] }), member]);
    expect((await client.query("select preferences from account_preference")).rows).toEqual([{ preferences: { version: 1, works: [] } }]);
    // The member FK carries the user: a row cannot name another person's user id.
    await expect(client.query("insert into account_preference(tenant_id,membership_id,user_id,preferences) values('crc',$1,'someone-else',$2::jsonb)", [randomUUID(), doc()])).rejects.toThrow();
  } finally { await client.close(); }
});

async function sqlState(operation: PromiseLike<unknown>) {
  try { await operation; return "accepted"; } catch (error) {
    let value = error as { code?: unknown; cause?: unknown } | undefined;
    for (let depth = 0; value && depth < 4; depth++, value = value.cause as typeof value) if (typeof value.code === "string" && /^[A-Z0-9]{5}$/.test(value.code)) return value.code;
    return "unknown";
  }
}

test("row security as portal_runtime: no owner (every staff path) sees nothing, one owner never reaches another member's or another congregation's document, and a garbage owner fails closed", async () => {
  const f = await accessFixture(); opened.push(f);
  const A = f.multiMember, B = f.adminMember;
  const otherTenant = await f.owner(async () => (await f.db.select().from(s.membership).where(and(eq(s.membership.tenantId, "other"), eq(s.membership.userId, f.identities.multi.id))))[0]);
  await f.owner(async () => {
    for (const [tenant, member, user] of [["crc", A.id, f.identities.multi.id], ["crc", B.id, f.identities.admin.id], ["other", otherTenant.id, f.identities.multi.id]] as const)
      await f.client.query("insert into account_preference(tenant_id,membership_id,user_id,preferences) values($1,$2,$3,$4::jsonb)", [tenant, member, user, doc({ colors: false })]);
  });
  type Tx = Parameters<Parameters<typeof withTenantTransaction>[2]>[0];
  type Result = { rows: Record<string, unknown>[]; affectedRows?: number };
  const run = async (tx: Tx, statement: ReturnType<typeof sql>) => (await tx.execute(statement)) as unknown as Result;
  const as = <T>(tenant: string, owner: string | null, action: (tx: Tx) => Promise<T>, setting = "app.saved_owner") =>
    withTenantTransaction(f.db, { tenantId: tenant }, async tx => { if (owner !== null) await tx.execute(sql`select set_config(${setting}, ${owner}, true)`); return action(tx); });
  const count = async (tx: Tx) => Number((await run(tx, sql`select count(*)::int as n from account_preference`)).rows[0].n);
  const affected = (tenant: string, owner: string | null, statement: ReturnType<typeof sql>) => as(tenant, owner, async tx => (await run(tx, statement)).affectedRows ?? 0);
  // The tenant alone (every staff, admin, MCP, cron and Sheet path) sees nothing and writes nothing, in either congregation.
  for (const tenant of ["crc", "other"]) for (const owner of [null, ""]) {
    expect(await as(tenant, owner, count)).toBe(0);
    expect(await sqlState(as(tenant, owner, tx => tx.execute(sql`insert into account_preference(tenant_id,membership_id,user_id,preferences) values('crc',${f.learnerMember.id},${f.identities.learner.id},${doc()}::jsonb)`)))).toBe("42501");
    expect(await affected(tenant, owner, sql`update account_preference set revision = revision + 1`)).toBe(0);
  }
  // Learn to lein's owner setting is a different binding and reaches nothing here.
  expect(await as("crc", A.id, count, "app.course_owner")).toBe(0);
  // Each owner sees exactly their own document, and cannot read, change or create the other's (staff included: B is an admin).
  expect(await as("crc", A.id, count)).toBe(1);
  expect(await as("crc", A.id, async tx => (await run(tx, sql`select membership_id from account_preference`)).rows.map(r => r.membership_id))).toEqual([A.id]);
  expect(await as("crc", B.id, async tx => (await run(tx, sql`select membership_id from account_preference`)).rows.map(r => r.membership_id))).toEqual([B.id]);
  expect(await affected("crc", B.id, sql`update account_preference set preferences = ${doc({ colors: true })}::jsonb where membership_id = ${A.id}`)).toBe(0);
  expect(await affected("crc", A.id, sql`update account_preference set revision = revision + 1 where membership_id = ${B.id}`)).toBe(0);
  expect(await sqlState(as("crc", A.id, tx => tx.execute(sql`insert into account_preference(tenant_id,membership_id,user_id,preferences) values('crc',${f.learnerMember.id},${f.identities.learner.id},${doc()}::jsonb)`)))).toBe("42501");
  // Across congregations: the same person's other-congregation membership is a different owner, and neither tenant reaches the other's row.
  expect(await as("crc", otherTenant.id, count)).toBe(0);
  expect(await as("other", A.id, count)).toBe(0);
  expect(await as("other", otherTenant.id, count)).toBe(1);
  expect(await sqlState(as("crc", otherTenant.id, tx => tx.execute(sql`insert into account_preference(tenant_id,membership_id,user_id,preferences) values('other',${otherTenant.id},${f.identities.multi.id},${doc()}::jsonb)`)))).toBe("42501");
  // Ownership never changes, nothing is deleted, nothing truncated.
  for (const statement of ["update account_preference set membership_id = membership_id", "update account_preference set tenant_id = tenant_id", "update account_preference set user_id = user_id",
    "update account_preference set created_at = created_at", "delete from account_preference", "truncate account_preference"])
    expect(await sqlState(as("crc", A.id, tx => tx.execute(sql.raw(statement)))), statement).toBe("42501");
  for (const garbage of ["not-a-uuid", `${A.id}' or true --`]) expect(await sqlState(as("crc", garbage, count))).toBe("22P02");
  expect(await affected("crc", A.id, sql`update account_preference set preferences = ${doc({ colors: true })}::jsonb, revision = revision + 1`)).toBe(1);
  // The CHECKs hold for the runtime too.
  expect(await sqlState(as("crc", A.id, tx => tx.execute(sql`update account_preference set preferences = ${doc({ note: "x" })}::jsonb`)))).toBe("23514");
  expect(await as("crc", null, async tx => (await run(tx, sql`select coalesce(current_setting('app.saved_owner', true), '') as v`)).rows[0].v)).toBe("");
});
