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
import { publicDiscussionRows } from "../../src/server/discussions/data";

// Release 1.7 M6: curated discussions and Claude translations (spec 2026-10-24-curated-discussions-design), migration 0042.
const TAG = "0042_curated_discussions", TABLES = ["curated_discussion", "curated_discussion_source", "source_translation"], VIEW = "curated_discussion_public";
const DIGEST = "a".repeat(64);
const opened: { client: { close(): Promise<void> } }[] = [];
afterEach(async () => { await Promise.all(opened.splice(0).map(f => f.client.close())); });

test("0042 adds only the three discussion tables and the public view, forced and tenant-isolated, never readable for selected_by, and replays", async () => {
  const isolation = await isolatedEnv(), client = new PGlite();
  try {
    const folder = "src/server/db/migrations", journal = JSON.parse(await readFile(join(folder, "meta/_journal.json"), "utf8"));
    const own = journal.entries.findIndex((e: { tag: string }) => e.tag === TAG);
    expect(journal.entries[own]).toMatchObject({ idx: 42, tag: TAG });
    expect(journal.entries[own - 1]).toMatchObject({ idx: 41, tag: "0041_account_preferences" });
    expect(journal.entries[own].when).toBeGreaterThan(journal.entries[own - 1].when);
    const entries = journal.entries.slice(0, own), prior = join(isolation.home, "prior");
    await mkdir(join(prior, "meta"), { recursive: true }); await writeFile(join(prior, "meta/_journal.json"), JSON.stringify({ ...journal, entries }));
    for (const e of entries) await copyFile(join(folder, e.tag + ".sql"), join(prior, e.tag + ".sql"));
    const db = drizzle(client); await migrate(db, { migrationsFolder: prior });
    await client.query("insert into \"user\"(id,name,email,email_verified) values('discussion-existing','Synthetic',$1,true)", [["discussion-existing", "example.test"].join("@")]);
    await client.query("insert into membership(id,tenant_id,user_id) values($1,'crc','discussion-existing')", [randomUUID()]);
    const capture = async () => Object.fromEntries(await Promise.all(["membership", "role_grant", "audit_event", "tenant", "study_guide", "account_preference"]
      .map(async t => [t, (await client.query(`select * from ${t} order by 1`)).rows])));
    const policies = async () => (await client.query("select tablename, policyname, cmd, roles::text[] as roles, qual, with_check from pg_policies where tablename <> all($1) order by 1, 2", [TABLES])).rows;
    const before = { rows: await capture(), policies: await policies() };
    await migrate(db, { migrationsFolder: folder }); await migrate(db, { migrationsFolder: folder });
    const after = await capture();
    for (const table of Object.keys(before.rows)) expect(priorColumns(after[table], before.rows[table])).toEqual(before.rows[table]);
    expect(await policies()).toEqual(before.policies);

    // The snapshot adds exactly the three tables (the view, triggers and grants are hand-written below the generated DDL).
    const snapshots = (await readdir(join(folder, "meta"))).filter(name => /^\d{4}_snapshot\.json$/.test(name)).sort();
    const at = snapshots.indexOf("0042_snapshot.json");
    expect(snapshots[at - 1]).toBe("0041_snapshot.json");
    const previous = JSON.parse(await readFile(join(folder, "meta", snapshots[at - 1]), "utf8")), current = JSON.parse(await readFile(join(folder, "meta/0042_snapshot.json"), "utf8"));
    expect(current.prevId).toBe(previous.id);
    const expected = structuredClone(previous.tables);
    for (const table of TABLES) expected[`public.${table}`] = current.tables[`public.${table}`];
    expect(current.tables).toEqual(expected);
    for (const key of ["enums", "schemas", "sequences", "roles", "policies", "views"]) expect(current[key]).toEqual(previous[key]);
    for (const table of TABLES) expect(Object.keys(current.tables[`public.${table}`].columns)).not.toEqual(expect.arrayContaining(["intro"]));
    // No introduction, essay, summary or note column exists anywhere in the feature.
    const columns = (await client.query<{ column_name: string }>("select column_name from information_schema.columns where table_name = any($1)", [[...TABLES, VIEW]])).rows.map(r => r.column_name);
    expect(columns.filter(name => /intro|essay|summary|note|synthesis|overview/i.test(name))).toEqual([]);

    const text = await readFile(join(folder, `${TAG}.sql`), "utf8");
    expect(text).not.toContain("\r");
    expect(text).toMatch(/^[\x09\x0a\x20-\x7e]*$/);
    expect(text).not.toMatch(/GRANT\s+(ALL|TRUNCATE)|GRANT[^;]*DELETE|DISABLE ROW LEVEL SECURITY|NO FORCE|DROP |audit_event|SECURITY DEFINER/i);
    const rls = await client.query("select relname, relrowsecurity, relforcerowsecurity from pg_class where relname = any($1) and relkind='r' order by 1", [TABLES]);
    expect(rls.rows).toEqual(TABLES.map(relname => ({ relname, relrowsecurity: true, relforcerowsecurity: true })));
    const isolation_ = "(tenant_id = NULLIF(current_setting('app.tenant_id'::text, true), ''::text))";
    const own_ = await client.query("select tablename, policyname, cmd, roles::text[] as roles, qual, with_check from pg_policies where tablename = any($1) order by 1", [TABLES]);
    expect(own_.rows).toEqual(TABLES.map(tablename => ({ tablename, policyname: "tenant_isolation", cmd: "ALL", roles: ["portal_runtime"], qual: isolation_, with_check: isolation_ })));
    const tableGrants = await client.query("select table_name, grantee, privilege_type from information_schema.table_privileges where grantee in ('portal_runtime','PUBLIC') and table_name = any($1) order by 1, 2, 3", [[...TABLES, VIEW]]);
    expect(tableGrants.rows).toEqual([...TABLES.map(table_name => ({ table_name, grantee: "portal_runtime", privilege_type: "INSERT" })), { table_name: VIEW, grantee: "portal_runtime", privilege_type: "SELECT" }]
      .sort((a, b) => a.table_name < b.table_name ? -1 : a.table_name > b.table_name ? 1 : a.privilege_type < b.privilege_type ? -1 : 1));
    const columnGrants = async (table: string, privilege: string) => (await client.query<{ column_name: string }>("select column_name from information_schema.column_privileges where grantee='portal_runtime' and table_name=$1 and privilege_type=$2 order by 1", [table, privilege])).rows.map(r => r.column_name);
    expect(await columnGrants("curated_discussion", "UPDATE")).toEqual(["revision", "status", "title", "updated_at"]);
    expect(await columnGrants("curated_discussion_source", "UPDATE")).toEqual([]);
    expect(await columnGrants("source_translation", "UPDATE")).toEqual([]);
    for (const table of TABLES) {
      const readable = await columnGrants(table, "SELECT");
      expect(readable, table).not.toContain("selected_by");
      expect(readable.length, table).toBeGreaterThan(5);
    }
    const viewColumns = (await client.query<{ column_name: string }>("select column_name from information_schema.columns where table_name=$1", [VIEW])).rows.map(r => r.column_name);
    expect(viewColumns).not.toContain("selected_by"); expect(viewColumns).not.toContain("mutation_id"); expect(viewColumns).not.toContain("status");
    const options = (await client.query<{ reloptions: string[] }>("select reloptions from pg_class where relname=$1", [VIEW])).rows[0].reloptions;
    expect(options).toEqual(expect.arrayContaining(["security_invoker=true", "security_barrier=true"]));
  } finally { await client.close(); await isolation.cleanup(); }
});

async function sqlState(operation: PromiseLike<unknown>) {
  try { await operation; return "accepted"; } catch (error) {
    let value = error as { code?: unknown; cause?: unknown } | undefined;
    for (let depth = 0; value && depth < 4; depth++, value = value.cause as typeof value) if (typeof value.code === "string" && /^[A-Z0-9]{5}$/.test(value.code)) return value.code;
    return "unknown";
  }
}

test("as portal_runtime: tenants never meet, the public view shows published rows only, selected_by is never readable, and nothing is deleted or rewritten", async () => {
  const f = await accessFixture(); opened.push(f);
  const otherMember = (await f.owner(async () => (await f.client.query<{ id: string }>("select id from membership where tenant_id='other' limit 1")).rows[0])).id;
  const ids = { published: randomUUID(), withdrawn: randomUUID(), other: randomUUID(), translation: randomUUID() };
  await f.owner(async () => {
    await f.client.query("insert into source_translation(id,tenant_id,original_ref,original_edition,body,selected_by,mutation_id,request_digest) values($1,'crc','Synthetic Mishnah 1:14','Synthetic Hebrew Edition','Synthetic translation.',$2,$3,$4)",
      [ids.translation, f.adminMember.id, randomUUID(), DIGEST]);
    for (const [id, tenant, slug, member] of [[ids.published, "crc", "published-one", f.adminMember.id], [ids.withdrawn, "crc", "withdrawn-one", f.adminMember.id], [ids.other, "other", "other-one", otherMember]]) {
      await f.client.query("insert into curated_discussion(id,tenant_id,slug,title,kind,status,selected_by,mutation_id,request_digest) values($1,$2,$3,'Synthetic question','torah','published',$4,$5,$6)", [id, tenant, slug, member, randomUUID(), DIGEST]);
      await f.client.query("insert into curated_discussion_source(tenant_id,discussion_id,revision,position,ref,anchor_ref,edition,selected_by) values($1,$2,1,1,'Synthetic Commentator on Genesis 12:1:1','Genesis 12:1','Synthetic English Edition',$3)", [tenant, id, member]);
    }
    await f.client.query("insert into curated_discussion_source(tenant_id,discussion_id,revision,position,ref,anchor_ref,translation_id,selected_by) values('crc',$1,1,2,'Synthetic Mishnah 1:14','Genesis 12:2',$2,$3)", [ids.published, ids.translation, f.adminMember.id]);
    await f.client.query("update curated_discussion set status='withdrawn', revision=2 where id=$1", [ids.withdrawn]);
  });
  type Tx = Parameters<Parameters<typeof withTenantTransaction>[2]>[0];
  type Result = { rows: Record<string, unknown>[]; affectedRows?: number };
  const as = <T>(tenant: string, action: (tx: Tx) => Promise<T>) => withTenantTransaction(f.db, { tenantId: tenant }, action);
  const rows = (tenant: string, statement: string) => as(tenant, async tx => ((await tx.execute(sql.raw(statement))) as unknown as Result).rows);
  const state = (tenant: string, statement: string) => sqlState(as(tenant, tx => tx.execute(sql.raw(statement))));

  // Tenant isolation, both ways; the view shows only published discussions with their current sources, in order.
  expect((await rows("crc", "select slug from curated_discussion order by slug")).map(r => r.slug)).toEqual(["published-one", "withdrawn-one"]);
  expect((await rows("other", "select slug from curated_discussion")).map(r => r.slug)).toEqual(["other-one"]);
  expect(await rows("crc", "select slug, position, anchor_ref, translation_body from curated_discussion_public order by slug, position")).toEqual([
    { slug: "published-one", position: 1, anchor_ref: "Genesis 12:1", translation_body: null }, { slug: "published-one", position: 2, anchor_ref: "Genesis 12:2", translation_body: "Synthetic translation." }]);
  expect((await rows("other", "select slug from curated_discussion_public")).map(r => r.slug)).toEqual(["other-one"]);
  expect(await rows("other", "select id from source_translation")).toEqual([]);
  const read = await as("crc", tx => publicDiscussionRows(tx as never, "crc", ["Genesis 12:1", "Genesis 12:2"], 8));
  expect(read.map(row => [row.slug, row.position])).toEqual([["published-one", 1], ["published-one", 2]]);
  expect(JSON.stringify(read)).not.toContain(f.adminMember.id);
  expect(await as("crc", tx => publicDiscussionRows(tx as never, "other", ["Genesis 12:1"], 8))).toEqual([]);
  // A tenant cannot write into another's rows.
  expect(await state("crc", `insert into curated_discussion(tenant_id,slug,title,kind,status,selected_by,mutation_id,request_digest) values('other','x','X','torah','published','${otherMember}','${randomUUID()}','${DIGEST}')`)).toBe("42501");

  // selected_by is never readable by the runtime, through any table or the view.
  for (const statement of ["select selected_by from curated_discussion", "select selected_by from curated_discussion_source", "select selected_by from source_translation",
    "select * from curated_discussion", "select * from source_translation", "select selected_by from curated_discussion_public"])
    expect(await state("crc", statement), statement).toMatch(/^(42501|42703)$/);
  // No DELETE, no TRUNCATE, no UPDATE of identity, sources or a translation's text.
  for (const statement of ["delete from curated_discussion", "delete from curated_discussion_source", "delete from source_translation", "truncate curated_discussion",
    `update curated_discussion set selected_by = '${f.adminMember.id}'`, "update curated_discussion set slug = 'x'", "update curated_discussion set kind = 'haftarah'",
    "update curated_discussion_source set ref = 'x'", "update source_translation set body = 'Changed.'"])
    expect(await state("crc", statement), statement).toBe("42501");
  // The runtime's one change: the next revision of a published discussion. Withdrawn is final; a revision never skips.
  expect(await state("crc", `update curated_discussion set title = 'Revised', revision = 2, updated_at = now() where id = '${ids.published}'`)).toBe("accepted");
  expect(await state("crc", `update curated_discussion set title = 'Skip', revision = 9 where id = '${ids.published}'`)).toBe("23514");
  expect(await state("crc", `update curated_discussion set status = 'published', revision = 3 where id = '${ids.withdrawn}'`)).toBe("23514");
  expect(await state("crc", `insert into curated_discussion(tenant_id,slug,title,kind,status,selected_by,mutation_id,request_digest,revision) values('crc','late','Late','torah','withdrawn','${f.adminMember.id}','${randomUUID()}','${DIGEST}',1)`)).toBe("23514");
  // Sources only for a published discussion's current revision; exactly one of edition or translation; no hidden HTML in a title.
  expect(await state("crc", `insert into curated_discussion_source(tenant_id,discussion_id,revision,position,ref,anchor_ref,edition,selected_by) values('crc','${ids.published}',1,3,'Synthetic Commentator on Genesis 12:2:1','Genesis 12:2','Synthetic English Edition','${f.adminMember.id}')`)).toBe("23514");
  expect(await state("crc", `insert into curated_discussion_source(tenant_id,discussion_id,revision,position,ref,anchor_ref,edition,selected_by) values('crc','${ids.withdrawn}',2,1,'Synthetic Commentator on Genesis 12:2:1','Genesis 12:2','Synthetic English Edition','${f.adminMember.id}')`)).toBe("23514");
  expect(await state("crc", `insert into curated_discussion_source(tenant_id,discussion_id,revision,position,ref,anchor_ref,selected_by) values('crc','${ids.published}',2,1,'Synthetic Commentator on Genesis 12:2:1','Genesis 12:2','${f.adminMember.id}')`)).toBe("23514");
  expect(await state("crc", `insert into curated_discussion_source(tenant_id,discussion_id,revision,position,ref,anchor_ref,translation_id,selected_by) values('crc','${ids.published}',2,1,'Synthetic Commentator on Genesis 12:2:1','Genesis 12:2','${ids.translation}','${f.adminMember.id}')`)).toBe("23503");
  expect(await state("crc", `insert into curated_discussion(tenant_id,slug,title,kind,status,selected_by,mutation_id,request_digest) values('crc','tagged','<b>Bold</b>','torah','published','${f.adminMember.id}','${randomUUID()}','${DIGEST}')`)).toBe("23514");
  expect(await state("crc", `insert into source_translation(tenant_id,original_ref,original_edition,body,selected_by,mutation_id,request_digest) values('crc','Synthetic Mishnah 1:14','Synthetic Hebrew Edition','<script>x</script>','${f.adminMember.id}','${randomUUID()}','${DIGEST}')`)).toBe("23514");
  // Even the owner cannot rewrite or delete: the triggers hold.
  for (const statement of ["update source_translation set body = 'Changed.'", "delete from source_translation", "delete from curated_discussion_source", "delete from curated_discussion"])
    expect(await f.owner(() => sqlState(f.client.query(statement))), statement).toBe("23514");
});
