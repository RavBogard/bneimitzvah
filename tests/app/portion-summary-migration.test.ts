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
import { readApprovedPortionSummary } from "../../src/server/portion-summary/public";

// Release 1.9 N6: portion summaries (decision 4, "Claude drafts, you approve"), migration 0044. Synthetic text only.
const TAG = "0044_portion_summary", TABLE = "portion_summary", VIEW = "portion_summary_public";
const DIGEST = "b".repeat(64);
const OUTLINE = Array.from({ length: 7 }, (_, i) => `Synthetic aliyah ${i + 1} line.`);
const opened: { client: { close(): Promise<void> } }[] = [];
afterEach(async () => { await Promise.all(opened.splice(0).map(f => f.client.close())); });

test("0044 adds only the portion summary table and its approved-only public view, forced and tenant-isolated, never readable for a membership or grant, and replays", async () => {
  const isolation = await isolatedEnv(), client = new PGlite();
  try {
    const folder = "src/server/db/migrations", journal = JSON.parse(await readFile(join(folder, "meta/_journal.json"), "utf8"));
    const own = journal.entries.findIndex((e: { tag: string }) => e.tag === TAG);
    // 0044, after SC2's 0043_course_text_catalog (whichever merges second renumbers): every check below is relative to the entry before it.
    expect(journal.entries[own]).toMatchObject({ idx: own, tag: TAG });
    expect(journal.entries[own - 1]).toMatchObject({ idx: own - 1, tag: "0043_course_text_catalog" });
    expect(journal.entries[own].when).toBeGreaterThan(journal.entries[own - 1].when);
    const entries = journal.entries.slice(0, own), prior = join(isolation.home, "prior"), through = join(isolation.home, "through");
    for (const [dir, list] of [[prior, entries], [through, journal.entries.slice(0, own + 1)]] as const) {
      await mkdir(join(dir, "meta"), { recursive: true }); await writeFile(join(dir, "meta/_journal.json"), JSON.stringify({ ...journal, entries: list }));
      for (const e of list) await copyFile(join(folder, e.tag + ".sql"), join(dir, e.tag + ".sql"));
    }
    const db = drizzle(client); await migrate(db, { migrationsFolder: prior });
    await client.query("insert into \"user\"(id,name,email,email_verified) values('summary-existing','Synthetic',$1,true)", [["summary-existing", "example.test"].join("@")]);
    await client.query("insert into membership(id,tenant_id,user_id) values($1,'crc','summary-existing')", [randomUUID()]);
    const capture = async () => Object.fromEntries(await Promise.all(["membership", "role_grant", "audit_event", "tenant", "study_guide", "curated_discussion", "course_text_catalog", "course_text_lifecycle"]
      .map(async t => [t, (await client.query(`select * from ${t} order by 1`)).rows])));
    const policies = async () => (await client.query("select tablename, policyname, cmd, roles::text[] as roles, qual, with_check from pg_policies where tablename <> $1 order by 1, 2", [TABLE])).rows;
    const before = { rows: await capture(), policies: await policies() };
    await migrate(db, { migrationsFolder: through }); await migrate(db, { migrationsFolder: through });
    const after = await capture();
    for (const table of Object.keys(before.rows)) expect(priorColumns(after[table], before.rows[table])).toEqual(before.rows[table]);
    expect(await policies()).toEqual(before.policies);

    // The snapshot adds exactly the one table (the function, view, trigger and grants are hand-written around the generated DDL).
    const snapshots = (await readdir(join(folder, "meta"))).filter(name => /^\d{4}_snapshot\.json$/.test(name)).sort();
    const at = snapshots.indexOf("0044_snapshot.json");
    expect(snapshots[at - 1]).toBe(`${journal.entries[own - 1].tag.slice(0, 4)}_snapshot.json`);
    const previous = JSON.parse(await readFile(join(folder, "meta", snapshots[at - 1]), "utf8")), current = JSON.parse(await readFile(join(folder, "meta/0044_snapshot.json"), "utf8"));
    expect(current.prevId).toBe(previous.id);
    const expected = structuredClone(previous.tables);
    expected[`public.${TABLE}`] = current.tables[`public.${TABLE}`];
    expect(current.tables).toEqual(expected);
    for (const key of ["enums", "schemas", "sequences", "roles", "policies", "views"]) expect(current[key]).toEqual(previous[key]);

    const text = await readFile(join(folder, `${TAG}.sql`), "utf8");
    expect(text).not.toContain("\r");
    expect(text).toMatch(/^[\x09\x0a\x20-\x7e]*$/);
    expect(text).not.toMatch(/DISABLE ROW LEVEL SECURITY|NO FORCE|DROP |audit_event|SECURITY DEFINER/i);
    // Every GRANT statement, comments and breakpoints aside, grants no DELETE, TRUNCATE or ALL.
    const grants = text.replace(/--[^\n]*/g, "").split(";").map(statement => statement.trim()).filter(statement => /^GRANT\b/i.test(statement));
    expect(grants.length).toBeGreaterThan(3);
    for (const statement of grants) expect(statement).not.toMatch(/\b(ALL|TRUNCATE|DELETE)\b/i);
    const rls = await client.query("select relname, relrowsecurity, relforcerowsecurity from pg_class where relname = $1 and relkind='r'", [TABLE]);
    expect(rls.rows).toEqual([{ relname: TABLE, relrowsecurity: true, relforcerowsecurity: true }]);
    const isolation_ = "(tenant_id = NULLIF(current_setting('app.tenant_id'::text, true), ''::text))";
    const own_ = await client.query("select tablename, policyname, cmd, roles::text[] as roles, qual, with_check from pg_policies where tablename = $1", [TABLE]);
    expect(own_.rows).toEqual([{ tablename: TABLE, policyname: "tenant_isolation", cmd: "ALL", roles: ["portal_runtime"], qual: isolation_, with_check: isolation_ }]);
    const tableGrants = await client.query("select table_name, grantee, privilege_type from information_schema.table_privileges where grantee in ('portal_runtime','PUBLIC') and table_name = any($1) order by 1, 2, 3", [[TABLE, VIEW]]);
    expect(tableGrants.rows).toEqual([{ table_name: TABLE, grantee: "portal_runtime", privilege_type: "INSERT" }, { table_name: VIEW, grantee: "portal_runtime", privilege_type: "SELECT" }]);
    const columnGrants = async (privilege: string) => (await client.query<{ column_name: string }>("select column_name from information_schema.column_privileges where grantee='portal_runtime' and table_name=$1 and privilege_type=$2 order by 1", [TABLE, privilege])).rows.map(r => r.column_name);
    expect(await columnGrants("UPDATE")).toEqual(["approved_at", "approved_by", "approved_grant_id", "approved_role", "credit", "status", "updated_at", "withdrawn_at"]);
    const readable = await columnGrants("SELECT");
    for (const hidden of ["drafted_by", "approved_by", "approved_grant_id"]) expect(readable).not.toContain(hidden);
    expect(readable).toEqual(expect.arrayContaining(["summary", "outline", "status", "revision", "credit"]));
    const viewColumns = (await client.query<{ column_name: string }>("select column_name from information_schema.columns where table_name=$1 order by ordinal_position", [VIEW])).rows.map(r => r.column_name);
    expect(viewColumns).toEqual(["tenant_id", "reading_key", "revision", "summary", "outline", "credit", "approved_at"]);
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

test("as portal_runtime: a draft is never public, only a live admin grant approves, words never change, withdrawn is final and nothing is deleted", async () => {
  const f = await accessFixture(); opened.push(f);
  const other = await f.owner(async () => (await f.client.query<{ id: string }>("select id from membership where tenant_id='other' limit 1")).rows[0].id);
  // The other congregation's rabbi: an admin there, nothing at CRC. A second CRC admin, later disabled.
  const otherGrant = randomUUID(), second = { user: "summary-second", member: randomUUID(), grant: randomUUID() };
  await f.owner(async () => {
    await f.client.query("insert into role_grant(id,tenant_id,membership_id,role) values($1,'other',$2,'admin')", [otherGrant, other]);
    await f.client.query("insert into \"user\"(id,name,email,email_verified) values($1,'Synthetic',$2,true)", [second.user, [second.user, "example.test"].join("@")]);
    await f.client.query("insert into membership(id,tenant_id,user_id) values($1,'crc',$2)", [second.member, second.user]);
    await f.client.query("insert into role_grant(id,tenant_id,membership_id,role) values($1,'crc',$2,'admin')", [second.grant, second.member]);
  });
  type Tx = Parameters<Parameters<typeof withTenantTransaction>[2]>[0];
  type Result = { rows: Record<string, unknown>[] };
  const as = <T>(tenant: string, action: (tx: Tx) => Promise<T>) => withTenantTransaction(f.db, { tenantId: tenant }, action);
  const rows = (tenant: string, statement: string) => as(tenant, async tx => ((await tx.execute(sql.raw(statement))) as unknown as Result).rows);
  const state = (tenant: string, statement: string) => sqlState(as(tenant, tx => tx.execute(sql.raw(statement))));
  const outline = `array[${OUTLINE.map(line => `'${line}'`).join(",")}]::text[]`;
  const draft = (tenant: string, reading: string, revision: number, member: string, summary = "A synthetic summary.") =>
    `insert into portion_summary(tenant_id,reading_key,revision,status,summary,outline,drafted_by,mutation_id,request_digest) values('${tenant}','${reading}',${revision},'draft','${summary}',${outline},'${member}','${randomUUID()}','${DIGEST}')`;
  const CREDIT = "Rabbi Daniel Bogard";
  const approve = (reading: string, revision: number, member: string, grant: string, extra = "", credit = CREDIT) =>
    `update portion_summary set status='approved', approved_by='${member}', approved_grant_id='${grant}', approved_role='admin', approved_at=now(), credit='${credit}'${extra} where reading_key='${reading}' and revision=${revision}`;
  // The database's credit is the tenant's own column: none until an operator sets it, then exactly that text; other congregations have none.
  expect(await rows("crc", "select public.portal_portion_summary_credit('crc') as crc")).toEqual([{ crc: null }]);
  expect(await state("crc", "update tenant set summary_credit='Someone Else' where id='crc'")).toBe("42501"); // the runtime role cannot set it
  await f.owner(async () => { await f.client.query("update tenant set summary_credit=$1 where id='crc'", [CREDIT]); });
  expect(await rows("crc", "select public.portal_portion_summary_credit('crc') as crc")).toEqual([{ crc: CREDIT }]);
  expect(await rows("other", "select public.portal_portion_summary_credit('other') as other")).toEqual([{ other: null }]);
  const admin = f.adminMember.id, grant = f.adminGrant.id;

  expect(await state("crc", draft("crc", "vayera", 1, admin))).toBe("accepted");
  expect(await state("other", draft("other", "bereshit", 1, other))).toBe("accepted");
  // The draft is in the table for the tenant's own staff tools, never in the public view or the public read.
  expect(await rows("crc", "select reading_key, revision, status from portion_summary")).toEqual([{ reading_key: "vayera", revision: 1, status: "draft" }]);
  expect(await rows("crc", "select * from portion_summary_public")).toEqual([]);
  expect(await as("crc", tx => readApprovedPortionSummary(tx as never, "crc", "vayera"))).toBeNull();
  // A tenant cannot read or write another's rows.
  expect(await rows("other", "select tenant_id from portion_summary")).toEqual([{ tenant_id: "other" }]);
  expect(await state("crc", draft("other", "noach", 1, other))).toMatch(/^(42501|23514)$/);

  // A draft starts as a draft at the next revision, with no approval; content is plain and bounded.
  expect(await state("crc", draft("crc", "vayera", 3, admin))).toBe("23514");
  expect(await state("crc", draft("crc", "vayera", 1, admin))).toBe("23514");
  expect(await state("crc", `insert into portion_summary(tenant_id,reading_key,revision,status,summary,outline,drafted_by,mutation_id,request_digest) values('crc','noach',1,'approved','Synthetic.',${outline},'${admin}','${randomUUID()}','${DIGEST}')`)).toBe("23514");
  expect(await state("crc", draft("crc", "noach", 1, admin, "<b>Synthetic</b>"))).toBe("23514");
  expect(await state("crc", `insert into portion_summary(tenant_id,reading_key,revision,status,summary,outline,drafted_by,mutation_id,request_digest) values('crc','noach',1,'draft','Synthetic.',array['One','Two']::text[],'${admin}','${randomUUID()}','${DIGEST}')`)).toBe("23514");
  expect(await state("crc", `insert into portion_summary(tenant_id,reading_key,revision,status,summary,outline,drafted_by,mutation_id,request_digest) values('crc','noach',1,'draft','Synthetic.',array['1','2','3','4','5','6','<b>7</b>']::text[],'${admin}','${randomUUID()}','${DIGEST}')`)).toBe("23514");

  // Only a live admin grant approves: a tutor's or parent's grant, someone else's grant, or a revoked grant is refused.
  expect(await state("crc", approve("vayera", 1, f.multiMember.id, f.tutorGrant.id))).toMatch(/^(23503|23514)$/);
  expect(await state("crc", approve("vayera", 1, f.multiMember.id, f.parentGrant.id))).toMatch(/^(23503|23514)$/);
  expect(await state("crc", approve("vayera", 1, f.multiMember.id, grant))).toMatch(/^(23503|23514)$/);
  expect(await state("crc", `update portion_summary set status='approved', approved_by='${f.multiMember.id}', approved_grant_id='${f.tutorGrant.id}', approved_role='tutor', approved_at=now(), credit='Synthetic Credit' where reading_key='vayera'`)).toMatch(/^(23503|23514)$/);
  expect(await state("crc", approve("vayera", 1, admin, grant, ", approved_at = now() - interval '1 day'").replace(", approved_at=now()", ""))).toBe("23514");
  // The credit is exactly the congregation's: a hand-picked one is refused, even under the rabbi's own live grant.
  expect(await state("crc", approve("vayera", 1, admin, grant, "", "Someone Else"))).toBe("23514");
  // A disabled membership approves nothing, even with a live admin grant.
  await f.owner(() => f.client.query("update membership set disabled_at = now() where id = $1", [second.member]));
  expect(await state("crc", approve("vayera", 1, second.member, second.grant))).toBe("23514");
  // Only a live admin drafts: never a tutor, parent or student, nor a disabled membership.
  for (const member of [f.multiMember.id, f.learnerMember.id, second.member]) expect(await state("crc", draft("crc", "noach", 1, member)), member).toBe("23514");
  // Another congregation's admin can neither see nor approve nor withdraw a CRC revision, even as a raw UPDATE under its own setting.
  for (const statement of [approve("vayera", 1, other, otherGrant), "update portion_summary set status='withdrawn', withdrawn_at=now() where reading_key='vayera'"])
    expect(await rows("other", `${statement} returning reading_key`), statement).toEqual([]);
  expect(await rows("crc", "select status from portion_summary")).toEqual([{ status: "draft" }]);
  // Naming a CRC row while running as the other congregation is refused outright.
  expect(await state("other", `update portion_summary set status='approved', approved_by='${other}', approved_grant_id='${otherGrant}', approved_role='admin', approved_at=now(), credit='${CREDIT}', tenant_id='crc'`)).toMatch(/^(42501|23514)$/);
  // And with no configured credit, that congregation cannot approve its own revision at all.
  expect(await state("other", approve("bereshit", 1, other, otherGrant, "", CREDIT))).toBe("23514");
  // Approval and content change never ride together, and the drafter never changes.
  expect(await state("crc", approve("vayera", 1, admin, grant).replace(" where", ", summary='Changed.' where"))).toBe("42501");
  expect(await state("crc", "update portion_summary set summary='Changed.'")).toBe("42501");
  expect(await state("crc", `update portion_summary set drafted_by='${admin}'`)).toBe("42501");
  // The membership and grant ids are never readable back.
  for (const statement of ["select drafted_by from portion_summary", "select approved_by from portion_summary", "select approved_grant_id from portion_summary", "select * from portion_summary"])
    expect(await state("crc", statement), statement).toBe("42501");
  // Nothing is ever deleted or truncated.
  for (const statement of ["delete from portion_summary", "truncate portion_summary"]) expect(await state("crc", statement), statement).toBe("42501");

  // The rabbi approves: the public view and the public read show it with its credit, and nothing names a person.
  expect(await state("crc", approve("vayera", 1, admin, grant))).toBe("accepted");
  expect(await rows("crc", "select reading_key, revision, credit from portion_summary_public")).toEqual([{ reading_key: "vayera", revision: 1, credit: CREDIT }]);
  const shown = await as("crc", tx => readApprovedPortionSummary(tx as never, "crc", "vayera"));
  expect(shown).toMatchObject({ reading: "vayera", revision: 1, summary: "A synthetic summary.", credit: CREDIT, outline: OUTLINE.map((line, i) => ({ aliyah: i + 1, line })) });
  expect(JSON.stringify(shown)).not.toContain(admin);
  expect(await rows("other", "select * from portion_summary_public")).toEqual([]);
  // At most one approved revision per parashah; approved never returns to draft; a re-approval is refused.
  expect(await state("crc", draft("crc", "vayera", 2, admin, "A second synthetic summary."))).toBe("accepted");
  expect(await state("crc", approve("vayera", 2, admin, grant))).toBe("23505");
  expect(await state("crc", "update portion_summary set status='draft', approved_by=null, approved_grant_id=null, approved_role=null, approved_at=null, credit=null where revision=1")).toBe("23514");
  // A withdrawal keeps the approval and is stamped now; then the view is empty, and withdrawn is final.
  expect(await state("crc", "update portion_summary set status='withdrawn', withdrawn_at=now(), credit='Other Credit' where revision=1")).toBe("23514");
  expect(await state("crc", "update portion_summary set status='withdrawn', withdrawn_at=now() - interval '1 hour' where revision=1")).toBe("23514");
  expect(await state("crc", "update portion_summary set status='withdrawn', withdrawn_at=now() where revision=1")).toBe("accepted");
  expect(await rows("crc", "select * from portion_summary_public")).toEqual([]);
  expect(await as("crc", tx => readApprovedPortionSummary(tx as never, "crc", "vayera"))).toBeNull();
  expect(await state("crc", approve("vayera", 1, admin, grant))).toBe("23514");
  expect(await state("crc", approve("vayera", 2, admin, grant))).toBe("accepted");
  // A revoked admin grant approves nothing more (the trigger checks the grant is live, not only that it exists).
  expect(await state("crc", draft("crc", "noach", 1, admin))).toBe("accepted");
  await f.owner(() => f.client.query("update role_grant set revoked_at = now() where id = $1", [grant]));
  expect(await state("crc", approve("noach", 1, admin, grant))).toBe("23514");
  expect(await state("crc", draft("crc", "noach", 2, admin))).toBe("23514");
  // Even the owner cannot delete or rewrite.
  for (const statement of ["delete from portion_summary", "update portion_summary set summary = 'Changed.'"])
    expect(await f.owner(() => sqlState(f.client.query(statement))), statement).toBe("23514");
});
