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

// 1.9 N19: a student's own verse cards, on Learn progress's model (course-progress-migration.test.ts) with its own owner setting.
const TAG = "0047_verse_review", TABLE = "verse_review";
const opened: { client: { close(): Promise<void> } }[] = [];
afterEach(async () => { await Promise.all(opened.splice(0).map(f => f.client.close())); });
const doc = (extra: Record<string, unknown> = {}) => JSON.stringify({ schema: "learn-verses/v1", cards: {}, ...extra });

test("0047 adds only the verse_review table, leaves existing rows and the audit list unchanged, and replays", async () => {
  const isolation = await isolatedEnv(), client = new PGlite();
  try {
    const folder = "src/server/db/migrations", journal = JSON.parse(await readFile(join(folder, "meta/_journal.json"), "utf8"));
    const own = journal.entries.findIndex((e: { tag: string }) => e.tag === TAG);
    expect(own).toBeGreaterThan(0);
    expect(journal.entries[own].idx).toBe(own);
    expect(journal.entries[own].when).toBeGreaterThan(journal.entries.find((e: { tag: string }) => e.tag === "0046_service_course_progress").when);
    const entries = journal.entries.slice(0, own), prior = join(isolation.home, "prior");
    await mkdir(join(prior, "meta"), { recursive: true }); await writeFile(join(prior, "meta/_journal.json"), JSON.stringify({ ...journal, entries }));
    for (const e of entries) await copyFile(join(folder, e.tag + ".sql"), join(prior, e.tag + ".sql"));
    const db = drizzle(client); await migrate(db, { migrationsFolder: prior });
    const member = randomUUID();
    await client.query("insert into \"user\"(id,name,email,email_verified) values('verse-existing','Synthetic learner',$1,true)", [["verse-existing", "example.test"].join("@")]);
    await client.query("insert into membership(id,tenant_id,user_id) values($1,'crc','verse-existing')", [member]);
    await client.query("insert into role_grant(id,tenant_id,membership_id,role) values($1,'crc',$2,'student')", [randomUUID(), member]);
    await client.query("insert into course_progress(tenant_id,membership_id,user_id,progress) values('crc',$1,'verse-existing',$2::jsonb)", [member, JSON.stringify({ schema: "learn-progress/v1", lessons: {}, cards: {} })]);
    const capture = async () => Object.fromEntries(await Promise.all(["student", "membership", "role_grant", "audit_event", "tenant", "course_progress", "verse_self_check", "verse_assessment"].map(async t => [t, (await client.query(`select * from ${t} order by 1`)).rows])));
    const before = await capture();
    await migrate(db, { migrationsFolder: folder }); await migrate(db, { migrationsFolder: folder });
    const after = await capture();
    for (const table of Object.keys(before)) expect(priorColumns(after[table], before[table])).toEqual(before[table]);
    expect((await client.query(`select count(*)::int as n from ${TABLE}`)).rows).toEqual([{ n: 0 }]);

    // The generated snapshot adds the one table and changes nothing else.
    const snapshots = (await readdir(join(folder, "meta"))).filter(name => /^\d{4}_snapshot\.json$/.test(name)).sort();
    const at = snapshots.indexOf("0047_snapshot.json");
    expect(at).toBeGreaterThan(0);
    const current = JSON.parse(await readFile(join(folder, "meta/0047_snapshot.json"), "utf8"));
    const previous = JSON.parse(await readFile(join(folder, "meta/0046_snapshot.json"), "utf8"));
    expect(current.prevId).toBe(previous.id);
    const expected = structuredClone(previous.tables);
    expected[`public.${TABLE}`] = current.tables[`public.${TABLE}`];
    expect(current.tables).toEqual(expected);
    for (const key of ["enums", "schemas", "sequences", "roles", "policies", "views"]) expect(current[key]).toEqual(previous[key]);

    // Row security and grants are hand-written beside the generated DDL: forced, one policy, column UPDATE only, no DELETE.
    const text = await readFile(join(folder, `${TAG}.sql`), "utf8");
    expect(text).not.toContain("\r");
    for (const line of [`ALTER TABLE ${TABLE} ENABLE ROW LEVEL SECURITY;`, `ALTER TABLE ${TABLE} FORCE ROW LEVEL SECURITY;`, `REVOKE ALL ON ${TABLE} FROM PUBLIC;`, `REVOKE ALL ON ${TABLE} FROM portal_runtime;`,
      `GRANT SELECT, INSERT ON ${TABLE} TO portal_runtime;`, `GRANT UPDATE (review, version, updated_at) ON ${TABLE} TO portal_runtime;`]) expect(text).toContain(line);
    expect(text).not.toMatch(/GRANT[^;(]*UPDATE ON/); expect(text).not.toMatch(/GRANT\s+(ALL|TRUNCATE)/i); expect(text).not.toMatch(/GRANT[^;]*DELETE/);
    expect(text).toMatch(/^[\x09\x0a\x20-\x7e]*$/);
    expect(text).not.toMatch(/audit_event|DISABLE ROW LEVEL SECURITY|NO FORCE|DROP POLICY|tenant_isolation|app\.saved_owner|app\.course_owner|app\.service_course_owner/i);
    const rls = await client.query("select relname, relrowsecurity, relforcerowsecurity from pg_class where relname = $1 and relkind='r'", [TABLE]);
    expect(rls.rows).toEqual([{ relname: TABLE, relrowsecurity: true, relforcerowsecurity: true }]);
    const owner = "((tenant_id = NULLIF(current_setting('app.tenant_id'::text, true), ''::text)) AND (membership_id = (NULLIF(current_setting('app.verse_review_owner'::text, true), ''::text))::uuid))";
    const policies = await client.query("select tablename, policyname, cmd, permissive, roles::text[] as roles, qual, with_check from pg_policies where tablename = $1", [TABLE]);
    expect(policies.rows).toEqual([{ tablename: TABLE, policyname: "owner_only", cmd: "ALL", permissive: "PERMISSIVE", roles: ["portal_runtime"], qual: owner, with_check: owner }]);
    const tableGrants = await client.query("select privilege_type from information_schema.table_privileges where grantee='portal_runtime' and table_name = $1 order by privilege_type", [TABLE]);
    expect(tableGrants.rows).toEqual([{ privilege_type: "INSERT" }, { privilege_type: "SELECT" }]);
    const columnGrants = await client.query("select column_name from information_schema.column_privileges where grantee='portal_runtime' and privilege_type='UPDATE' and table_name = $1 order by column_name", [TABLE]);
    expect(columnGrants.rows).toEqual(["review", "updated_at", "version"].map(column_name => ({ column_name })));
    expect((await client.query("select count(*)::int as n from information_schema.table_privileges where grantee='PUBLIC' and table_name = $1", [TABLE])).rows).toEqual([{ n: 0 }]);
    const fks = await client.query<{ def: string }>("select pg_get_constraintdef(oid) as def from pg_constraint where contype='f' and conrelid::regclass::text = $1", [TABLE]);
    for (const row of fks.rows) expect(row.def).toMatch(/^FOREIGN KEY \(tenant_id[,)]/);
  } finally { await client.close(); await isolation.cleanup(); }
});

test("the document checks refuse what is not a learn-verses/v1 outline, or is too large, and the key holds one document per member", async () => {
  const client = new PGlite();
  try {
    await migrate(drizzle(client), { migrationsFolder: "src/server/db/migrations" });
    await client.query("insert into \"user\"(id,name,email,email_verified) values('verse-check','Synthetic',$1,true)", [["verse-check", "example.test"].join("@")]);
    const member = randomUUID(); await client.query("insert into membership(id,tenant_id,user_id) values($1,'crc','verse-check')", [member]);
    const insert = (review: string, version = 1) => client.query("insert into verse_review(tenant_id,membership_id,user_id,review,version) values('crc',$1,'verse-check',$2::jsonb,$3)", [member, review, version]);
    for (const bad of ["[]", "\"x\"", JSON.stringify({ schema: "learn-progress/v1", lessons: {}, cards: {} }), JSON.stringify({ schema: "learn-verses/v1", cards: [] }),
      JSON.stringify({ schema: "learn-verses/v1" }), doc({ padding: "x".repeat(50_000) })]) await expect(insert(bad), bad.slice(0, 60)).rejects.toThrow();
    await expect(insert(doc(), 0)).rejects.toThrow();
    await insert(doc());
    await expect(insert(doc())).rejects.toThrow();
    // The member FK carries the user: a row cannot name another person's user id.
    await expect(client.query("insert into verse_review(tenant_id,membership_id,user_id,review) values('crc',$1,'someone-else',$2::jsonb)", [randomUUID(), doc()])).rejects.toThrow();
  } finally { await client.close(); }
});

async function sqlState(operation: PromiseLike<unknown>) {
  try { await operation; return "accepted"; } catch (error) {
    let value = error as { code?: unknown; cause?: unknown } | undefined;
    for (let depth = 0; value && depth < 4; depth++, value = value.cause as typeof value) if (typeof value.code === "string" && /^[A-Z0-9]{5}$/.test(value.code)) return value.code;
    return "unknown";
  }
}

test("row security as portal_runtime: no owner sees nothing, Learn's and the saved layer's owners see nothing, one owner never reaches another's cards, and a garbage owner fails closed", async () => {
  const f = await accessFixture(); opened.push(f);
  const A = f.learnerMember, B = f.adminMember;
  await f.owner(async () => {
    for (const [member, user] of [[A.id, f.identities.learner.id], [B.id, f.identities.admin.id]] as const)
      await f.client.query("insert into verse_review(tenant_id,membership_id,user_id,review) values('crc',$1,$2,$3::jsonb)", [member, user, doc()]);
  });
  type Tx = Parameters<Parameters<typeof withTenantTransaction>[2]>[0];
  type Result = { rows: Record<string, unknown>[]; affectedRows?: number };
  const run = async (tx: Tx, statement: ReturnType<typeof sql>) => (await tx.execute(statement)) as unknown as Result;
  const as = <T>(tenant: string, owner: string | null, action: (tx: Tx) => Promise<T>, setting = "app.verse_review_owner") =>
    withTenantTransaction(f.db, { tenantId: tenant }, async tx => { if (owner !== null) await tx.execute(sql`select set_config(${setting}, ${owner}, true)`); return action(tx); });
  const count = async (tx: Tx) => Number((await run(tx, sql`select count(*)::int as n from verse_review`)).rows[0].n);
  const affected = (tenant: string, owner: string | null, statement: ReturnType<typeof sql>) => as(tenant, owner, async tx => (await run(tx, statement)).affectedRows ?? 0);
  // The tenant alone (every tutor, parent, admin, MCP, cron and Sheet path) sees nothing and writes nothing.
  for (const owner of [null, ""]) {
    expect(await as("crc", owner, count)).toBe(0);
    expect(await sqlState(as("crc", owner, tx => tx.execute(sql`insert into verse_review(tenant_id,membership_id,user_id,review) values('crc',${f.multiMember.id},${f.identities.multi.id},${doc()}::jsonb)`)))).toBe("42501");
    expect(await affected("crc", owner, sql`update verse_review set version = version + 1`)).toBe(0);
  }
  for (const setting of ["app.course_owner", "app.saved_owner", "app.service_course_owner"]) expect(await as("crc", A.id, count, setting), setting).toBe(0);
  // Each owner sees exactly their own document, and cannot touch the other's.
  expect(await as("crc", A.id, count)).toBe(1);
  expect(await as("crc", A.id, async tx => (await run(tx, sql`select membership_id from verse_review`)).rows.map(r => r.membership_id))).toEqual([A.id]);
  expect(await affected("crc", A.id, sql`update verse_review set version = version + 1 where membership_id = ${B.id}`)).toBe(0);
  expect(await sqlState(as("crc", A.id, tx => tx.execute(sql`insert into verse_review(tenant_id,membership_id,user_id,review) values('crc',${B.id},${f.identities.admin.id},${doc()}::jsonb)`)))).toBe("42501");
  // Ownership never changes, nothing is deleted, nothing truncated.
  for (const statement of ["update verse_review set membership_id = membership_id", "update verse_review set tenant_id = tenant_id", "update verse_review set user_id = user_id",
    "update verse_review set created_at = created_at", "delete from verse_review", "truncate verse_review"])
    expect(await sqlState(as("crc", A.id, tx => tx.execute(sql.raw(statement)))), statement).toBe("42501");
  for (const garbage of ["not-a-uuid", `${A.id}' or true --`]) expect(await sqlState(as("crc", garbage, count))).toBe("22P02");
  expect(await as("other", A.id, count)).toBe(0);
  expect(await affected("crc", A.id, sql`update verse_review set review = ${doc()}::jsonb, version = version + 1`)).toBe(1);
  expect(await as("crc", null, async tx => (await run(tx, sql`select coalesce(current_setting('app.verse_review_owner', true), '') as v`)).rows[0].v)).toBe("");
});
