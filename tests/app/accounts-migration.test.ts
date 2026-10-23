import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { expect, test } from "vitest";
import { isolatedEnv } from "../helpers/isolatedEnv.mjs";
import { priorColumns } from "../helpers/prior-columns";

const TAG = "0038_account_requests";
const TABLES = ["account_approver", "account_request", "tenant_member"];
const NEW_ACTIONS = ["account-request.approve", "account-request.decline", "member.revoke", "approver.designate", "approver.revoke"];
const actions = (value: string) => [...value.matchAll(/'([a-z.-]+)'/g)].map(m => m[1]);
async function sqlState(operation: PromiseLike<unknown>) {
  try { await operation; return "accepted"; } catch (error) {
    let value = error as { code?: unknown; cause?: unknown } | undefined;
    for (let depth = 0; value && depth < 4; depth++, value = value.cause as typeof value) if (typeof value.code === "string" && /^[A-Z0-9]{5}$/.test(value.code)) return value.code;
    return "unknown";
  }
}

test("0038 adds the three account tables, widens only the throttle scopes and the audit actions, keeps existing rows and replays", async () => {
  const isolation = await isolatedEnv(), client = new PGlite();
  try {
    const folder = "src/server/db/migrations", journal = JSON.parse(await readFile(join(folder, "meta/_journal.json"), "utf8"));
    const own = journal.entries.findIndex((e: { tag: string }) => e.tag === TAG);
    expect(journal.entries[own]).toMatchObject({ idx: 38, tag: TAG });
    expect(journal.entries[own].when).toBeGreaterThan(journal.entries[own - 1].when);
    const entries = journal.entries.slice(0, own), prior = join(isolation.home, "prior");
    await mkdir(join(prior, "meta"), { recursive: true }); await writeFile(join(prior, "meta/_journal.json"), JSON.stringify({ ...journal, entries }));
    for (const e of entries) await copyFile(join(folder, e.tag + ".sql"), join(prior, e.tag + ".sql"));
    const db = drizzle(client); await migrate(db, { migrationsFolder: prior });
    const member = randomUUID();
    await client.query("insert into \"user\"(id,name,email,email_verified) values('existing','Synthetic',$1,true)", [["existing", "example.test"].join("@")]);
    await client.query("insert into membership(id,tenant_id,user_id) values($1,'crc','existing')", [member]);
    await client.query("insert into role_grant(id,tenant_id,membership_id,role) values($1,'crc',$2,'tutor')", [randomUUID(), member]);
    await client.query("insert into invitation_throttle(tenant_id,scope,key,bucket_start,count) values('crc','actor',$1,0,1)", ["a".repeat(64)]);
    const capture = async () => Object.fromEntries(await Promise.all(["membership", "role_grant", "audit_event", "invitation_throttle", "saved_reading"].map(async t => [t, (await client.query(`select * from ${t} order by 1`)).rows])));
    const before = await capture();
    await migrate(db, { migrationsFolder: folder }); await migrate(db, { migrationsFolder: folder });
    const after = await capture();
    for (const table of Object.keys(before)) expect(priorColumns(after[table], before[table])).toEqual(before[table]);
    for (const table of TABLES) expect((await client.query(`select count(*)::int as n from ${table}`)).rows).toEqual([{ n: 0 }]);

    // Snapshot: three new tables, and only the two widened checks change elsewhere.
    const snapshots = (await readdir(join(folder, "meta"))).filter(name => /^\d{4}_snapshot\.json$/.test(name)).sort(), at = snapshots.indexOf("0038_snapshot.json");
    expect(at).toBeGreaterThan(0);
    const previous = JSON.parse(await readFile(join(folder, "meta", snapshots[at - 1]), "utf8")), current = JSON.parse(await readFile(join(folder, "meta/0038_snapshot.json"), "utf8"));
    expect(current.prevId).toBe(previous.id);
    const expected = structuredClone(previous.tables);
    for (const table of TABLES) expected[`public.${table}`] = current.tables[`public.${table}`];
    expected["public.audit_event"].checkConstraints.audit_action_known = current.tables["public.audit_event"].checkConstraints.audit_action_known;
    expected["public.invitation_throttle"].checkConstraints.invitation_throttle_scope = current.tables["public.invitation_throttle"].checkConstraints.invitation_throttle_scope;
    expect(current.tables).toEqual(expected);
    for (const key of ["enums", "schemas", "sequences", "roles", "policies", "views"]) expect(current[key]).toEqual(previous[key]);
    const was = actions(previous.tables["public.audit_event"].checkConstraints.audit_action_known.value), now = actions(current.tables["public.audit_event"].checkConstraints.audit_action_known.value);
    expect(now).toEqual([...was, ...NEW_ACTIONS]);
    expect(actions(current.tables["public.invitation_throttle"].checkConstraints.invitation_throttle_scope.value)).toEqual(["actor", "recipient", "account-request", "account-mail"]);

    const text = await readFile(join(folder, `${TAG}.sql`), "utf8");
    expect(text).not.toContain("\r"); expect(text).toMatch(/^[\x09\x0a\x20-\x7e]*$/);
    expect(text).not.toContain("[[:cntrl:]]");
    for (const table of TABLES) for (const line of [`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`, `ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;`, `REVOKE ALL ON ${table} FROM PUBLIC;`, `REVOKE ALL ON ${table} FROM portal_runtime;`]) expect(text).toContain(line);
    expect(text.match(/GRANT[^;]*DELETE[^;]*;/g)).toEqual(["GRANT SELECT, INSERT, DELETE ON account_request TO portal_runtime;"]);
    expect(text).not.toMatch(/GRANT[^;(]*UPDATE ON/); expect(text).not.toMatch(/GRANT\s+(ALL|TRUNCATE)/i);
    // Nothing about role grants changes: no grant on, alteration of or trigger on role_grant.
    expect(text).not.toMatch(/GRANT[^;]*ON "?role_grant|ALTER TABLE "?role_grant|TRIGGER[^;]*ON "?role_grant/i);
    const rls = await client.query("select relname, relrowsecurity, relforcerowsecurity from pg_class where relname = any($1) and relkind='r' order by relname", [TABLES]);
    expect(rls.rows).toEqual(TABLES.map(relname => ({ relname, relrowsecurity: true, relforcerowsecurity: true })));
    const isolation_ = "(tenant_id = NULLIF(current_setting('app.tenant_id'::text, true), ''::text))";
    const policies = await client.query("select tablename, policyname, cmd, roles::text[] as roles, qual, with_check from pg_policies where tablename = any($1) order by tablename", [TABLES]);
    expect(policies.rows).toEqual(TABLES.map(tablename => ({ tablename, policyname: "tenant_isolation", cmd: "ALL", roles: ["portal_runtime"], qual: isolation_, with_check: isolation_ })));
    const tableGrants = await client.query("select table_name, privilege_type from information_schema.table_privileges where grantee='portal_runtime' and table_name = any($1) order by table_name, privilege_type", [TABLES]);
    expect(tableGrants.rows).toEqual([...["INSERT", "SELECT"].map(p => ({ table_name: "account_approver", privilege_type: p })),
      ...["DELETE", "INSERT", "SELECT"].map(p => ({ table_name: "account_request", privilege_type: p })), ...["INSERT", "SELECT"].map(p => ({ table_name: "tenant_member", privilege_type: p }))]);
    const columnGrants = await client.query("select table_name, column_name from information_schema.column_privileges where grantee='portal_runtime' and privilege_type='UPDATE' and table_name = any($1) order by table_name, column_name", [TABLES]);
    expect(columnGrants.rows).toEqual([...["revoked_at", "revoked_by_membership_id"].map(c => ({ table_name: "account_approver", column_name: c })),
      ...["notify_attempted_at", "notify_status"].map(c => ({ table_name: "account_request", column_name: c })),
      ...["revoked_at", "revoked_by_membership_id", "welcome_attempted_at", "welcome_status"].map(c => ({ table_name: "tenant_member", column_name: c }))]);
    const triggers = await client.query("select tgrelid::regclass::text as t, tgname from pg_trigger where tgrelid::regclass::text = any($1) and not tgisinternal order by 1", [TABLES]);
    expect((triggers.rows as { t: string; tgname: string }[]).map(row => `${row.t}.${row.tgname}`).sort()).toEqual(["account_approver.final_account_approver", "account_approver.immutable_account_approver",
      "account_request.final_account_request", "account_request.immutable_account_request", "tenant_member.final_tenant_member", "tenant_member.immutable_tenant_member"]);
    const fks = await client.query<{ def: string }>("select pg_get_constraintdef(oid) as def from pg_constraint where contype='f' and conrelid::regclass::text = any($1)", [TABLES]);
    for (const row of fks.rows) expect(row.def).toMatch(/^FOREIGN KEY \((tenant_id|user_id)[,)]/);
  } finally { await client.close(); await isolation.cleanup(); }
});

test("the account checks refuse spoofing characters, bad shapes and changes to identity, and a revocation is final", async () => {
  const client = new PGlite();
  try {
    await migrate(drizzle(client), { migrationsFolder: "src/server/db/migrations" });
    const admin = randomUUID(), tutor = randomUUID(), adminGrant = randomUUID(), tutorGrant = randomUUID(), adminTutor = randomUUID();
    for (const [id, user] of [[admin, "chk-admin"], [tutor, "chk-tutor"]]) {
      await client.query("insert into \"user\"(id,name,email,email_verified) values($1,'Synthetic',$2,true)", [user, `${user}@example.test`]);
      await client.query("insert into membership(id,tenant_id,user_id) values($1,'crc',$2)", [id, user]);
    }
    await client.query("insert into role_grant(id,tenant_id,membership_id,role) values($1,'crc',$2,'admin'),($3,'crc',$2,'tutor'),($4,'crc',$5,'tutor')", [adminGrant, admin, adminTutor, tutorGrant, tutor]);
    const request = (name: string, purpose: string | null = null, user = "chk-tutor") => client.query("insert into account_request(tenant_id,user_id,display_name,purpose) values('crc',$1,$2,$3) returning id", [user, name, purpose]);
    for (const [name, purpose] of [["Ruth bat Naomi", null], ["רות", "Learning to lein"], ["x".repeat(80), "y".repeat(500)]] as const) { await request(name, purpose); await client.query("delete from account_request"); }
    for (const [name, purpose] of [["", null], [" Padded", null], ["x".repeat(81), null], ["A\u202eB", null], ["A\u2066B", null], ["A\u2028B", null], ["Tab\tName", null], ["Name", "Line\nbreak"], ["Name", ""], ["Name", "z".repeat(501)], ["Name", "A\u202dB"], ["\u3164", null], ["A\u200bB", null], ["A\ufeffB", null], ["A\u00adB", null], ["A\u{e0041}B", null]] as const)
      expect(await sqlState(request(name, purpose)), JSON.stringify([name, purpose])).toBe("23514");
    const [{ id: requestId }] = (await request("Requester")).rows as { id: string }[];
    expect(await sqlState(client.query("insert into account_request(tenant_id,user_id,display_name) values('crc','chk-tutor','Again')"))).toBe("23505");
    for (const statement of ["update account_request set display_name = 'Other'", "update account_request set user_id = 'chk-admin'", "update account_request set purpose = 'Other'"])
      expect(await sqlState(client.query(statement)), statement).toBe("23514");
    expect(await sqlState(client.query("update account_request set notify_status = 'sent'"))).toBe("23514");
    expect(await sqlState(client.query("update account_request set notify_status = 'sent', notify_attempted_at = now() where id = $1", [requestId]))).toBe("accepted");
    for (const statement of ["update account_request set notify_status = 'pending', notify_attempted_at = null", "update account_request set notify_attempted_at = now() + interval '1 day'", "update account_request set notify_status = 'failed'"])
      expect(await sqlState(client.query(statement)), statement).toBe("23514");
    // Members: once per membership while active; identity fixed; ended once and for good.
    const member = async () => (await client.query<{ id: string }>("insert into tenant_member(tenant_id,membership_id,user_id,display_name,approved_by_membership_id) values('crc',$1,'chk-tutor','Requester',$2) returning id", [tutor, admin])).rows[0].id;
    const first = await member();
    expect(await sqlState(member())).toBe("23505");
    for (const statement of ["update tenant_member set display_name = 'X'", "update tenant_member set membership_id = membership_id::text::uuid, user_id = 'chk-admin'", "update tenant_member set approved_by_membership_id = membership_id"])
      expect(await sqlState(client.query(statement)), statement).not.toBe("accepted");
    expect(await sqlState(client.query("update tenant_member set revoked_at = now()"))).toBe("23514");
    await client.query("update tenant_member set revoked_at = now(), revoked_by_membership_id = $1", [admin]);
    expect(await sqlState(client.query("update tenant_member set revoked_at = null, revoked_by_membership_id = null"))).toBe("23514");
    expect(await sqlState(client.query("update tenant_member set revoked_at = now() + interval '1 day'"))).toBe("23514");
    expect(await sqlState(client.query("update tenant_member set revoked_by_membership_id = $1", [tutor]))).toBe("23514");
    expect(await member()).not.toBe(first);
    // Approvers: a tutor grant of that very membership, never an admin grant or another member's grant.
    const designate = (membershipId: string, grantId: string) => client.query("insert into account_approver(tenant_id,membership_id,tutor_grant_id,designated_by_membership_id) values('crc',$1,$2,$3)", [membershipId, grantId, admin]);
    expect(await sqlState(designate(tutor, adminGrant))).toBe("23503");
    expect(await sqlState(designate(admin, tutorGrant))).toBe("23503");
    expect(await sqlState(designate(tutor, tutorGrant))).toBe("accepted");
    expect(await sqlState(designate(tutor, tutorGrant))).toBe("23505");
    expect(await sqlState(client.query("update account_approver set tutor_grant_id = $1", [adminTutor]))).not.toBe("accepted");
    expect(await sqlState(client.query("insert into account_approver(tenant_id,membership_id,tutor_grant_id,role,designated_by_membership_id) values('crc',$1,$2,'admin',$1)", [admin, adminGrant]))).toBe("23514");
    expect(await sqlState(client.query("insert into invitation_throttle(tenant_id,scope,key,bucket_start,count) values('crc','account-mail',$1,0,1)", ["b".repeat(64)]))).toBe("accepted");
    expect(await sqlState(client.query("insert into invitation_throttle(tenant_id,scope,key,bucket_start,count) values('crc','accounts',$1,0,1)", ["c".repeat(64)]))).toBe("23514");
  } finally { await client.close(); }
});
