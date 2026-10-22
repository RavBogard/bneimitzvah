import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
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
import * as s from "../../src/server/db/index";
import { validateSettings } from "../../src/server/settings/validation";

const TAG = "0032_notifications";
const PRIOR_ACTIONS = ["student.create", "student.update", "student.import", "grant.issue", "grant.revoke", "guardian.link", "guardian.revoke", "guardian.practice-set", "tutor.cantor-set", "tutor.assign", "tutor.revoke",
  "invite.issue", "invite.accept", "invite.revoke", "invite.delivery-sent", "invite.delivery-failed", "context.enter", "context.exit", "reading.set", "identity.link", "identity.revoke", "draft.append", "note.append",
  "service-plan.set", "progress.self-check.set", "progress.assessment.set", "lesson-log.create", "lesson-log.edit", "lesson-log.delete", "recording.create", "recording.submit", "recording.delete-request",
  "source-assignment.set", "honors.set", "honoree.issue", "honoree.revoke", "honoree.reissue", "study-voice.set", "study-guide.set", "study-guide.publish", "study-guide-student.set", "study-theme.read", "tenant-settings.set"];
const opened: { client: { close(): Promise<void> } }[] = [];
afterEach(async () => { await Promise.all(opened.splice(0).map(f => f.client.close())); });

test("0032 adds only the two notification tables, two audit actions and the settings field, leaves existing rows unchanged and replays", async () => {
  const isolation = await isolatedEnv(), client = new PGlite();
  try {
    const folder = "src/server/db/migrations", journal = JSON.parse(await readFile(join(folder, "meta/_journal.json"), "utf8"));
    const entry = journal.entries.find((e: { tag: string }) => e.tag === TAG);
    expect(entry).toMatchObject({ idx: 32 });
    const entries = journal.entries.filter((e: { idx: number }) => e.idx < entry.idx), prior = join(isolation.home, "prior");
    await mkdir(join(prior, "meta"), { recursive: true }); await writeFile(join(prior, "meta/_journal.json"), JSON.stringify({ ...journal, entries }));
    for (const e of entries) await copyFile(join(folder, e.tag + ".sql"), join(prior, e.tag + ".sql"));
    const db = drizzle(client); await migrate(db, { migrationsFolder: prior });
    await client.query("insert into student(id,tenant_id,first_name,last_name,ceremony_date,parent_email) values($1,'crc','Synthetic','Existing','2027-01-02','existing@example.test')", [randomUUID()]);
    await client.query("insert into tenant_settings(tenant_id,version,base_version,body,channel,mutation_id,request_digest) values('crc',1,0,'{}','operator',$1,$2)", [randomUUID(), "a".repeat(64)]);
    const before = { students: (await client.query("select * from student")).rows, settings: (await client.query("select * from tenant_settings")).rows, audits: (await client.query("select * from audit_event")).rows };
    await migrate(db, { migrationsFolder: folder }); await migrate(db, { migrationsFolder: folder });
    expect(priorColumns((await client.query("select * from student")).rows, before.students)).toEqual(before.students);
    expect((await client.query("select * from tenant_settings")).rows).toEqual(before.settings);
    expect((await client.query("select * from audit_event")).rows).toEqual(before.audits);
    for (const table of ["notification_preference", "notification_delivery"]) expect((await client.query(`select count(*)::int as n from ${table}`)).rows).toEqual([{ n: 0 }]);
    const previous = JSON.parse(await readFile(join(folder, `meta/${String(entry.idx - 1).padStart(4, "0")}_snapshot.json`), "utf8"));
    const current = JSON.parse(await readFile(join(folder, `meta/${String(entry.idx).padStart(4, "0")}_snapshot.json`), "utf8"));
    const expected = structuredClone(previous.tables);
    for (const table of ["public.notification_preference", "public.notification_delivery"]) expected[table] = current.tables[table];
    const audit = current.tables["public.audit_event"].checkConstraints.audit_action_known;
    expected["public.audit_event"].checkConstraints.audit_action_known = audit;
    expect(current.prevId).toBe(previous.id); expect(current.tables).toEqual(expected);
    // The prior action list is kept whole; only the two notification actions are added.
    for (const action of [...PRIOR_ACTIONS, "notification-preference.set", "notification.unsubscribe"]) expect(audit.value).toContain(`'${action}'`);
    expect(audit.value.match(/'[a-z.-]+'/g)).toHaveLength(PRIOR_ACTIONS.length + 2);
    const text = await readFile(join(folder, `${TAG}.sql`), "utf8");
    for (const line of ["ALTER TABLE notification_preference FORCE ROW LEVEL SECURITY;", "ALTER TABLE notification_delivery FORCE ROW LEVEL SECURITY;",
      "REVOKE ALL ON notification_preference FROM portal_runtime;", "REVOKE ALL ON notification_delivery FROM portal_runtime;",
      "GRANT SELECT, INSERT ON notification_preference TO portal_runtime;", "GRANT SELECT, INSERT ON notification_delivery TO portal_runtime;",
      "GRANT UPDATE (enabled, weekday, revision, updated_via, updated_at) ON notification_preference TO portal_runtime;",
      "GRANT UPDATE (status, attempts, attempted_at, finished_at) ON notification_delivery TO portal_runtime;"]) expect(text).toContain(line);
    expect(text).not.toMatch(/GRANT[^;]*DELETE/); expect(text).not.toMatch(/GRANT[^;(]*UPDATE ON/);
    const policies = await client.query<{ tablename: string; qual: string; with_check: string; roles: string[] }>("select tablename, qual, with_check, roles::text[] as roles from pg_policies where tablename like 'notification_%' order by tablename");
    const isolation_ = "(tenant_id = NULLIF(current_setting('app.tenant_id'::text, true), ''::text))";
    expect(policies.rows).toEqual(["notification_delivery", "notification_preference"].map(tablename => ({ tablename, qual: isolation_, with_check: isolation_, roles: ["portal_runtime"] })));
    const rls = await client.query("select relname, relrowsecurity, relforcerowsecurity from pg_class where relname like 'notification_%' and relkind='r' order by relname");
    expect(rls.rows).toEqual([{ relname: "notification_delivery", relrowsecurity: true, relforcerowsecurity: true }, { relname: "notification_preference", relrowsecurity: true, relforcerowsecurity: true }]);
    const columnGrants = await client.query("select table_name, column_name from information_schema.column_privileges where grantee='portal_runtime' and privilege_type='UPDATE' and table_name like 'notification_%' order by table_name, column_name");
    expect(columnGrants.rows).toEqual([...["attempted_at", "attempts", "finished_at", "status"].map(c => ({ table_name: "notification_delivery", column_name: c })),
      ...["enabled", "revision", "updated_at", "updated_via", "weekday"].map(c => ({ table_name: "notification_preference", column_name: c }))]);
  } finally { await client.close(); await isolation.cleanup(); }
});

test("the replaced settings check keeps every earlier rule and agrees with the TypeScript validator on notifications", async () => {
  const client = new PGlite();
  try {
    await migrate(drizzle(client), { migrationsFolder: "src/server/db/migrations" });
    const valid = async (body: unknown) => (await client.query<{ valid: boolean }>("select portal_tenant_settings_valid($1::jsonb) as valid", [JSON.stringify(body)])).rows[0].valid;
    for (const body of [{}, { rabbiDisplayName: "Rabbi Daniel" }, { notifications: { tutorDraft: true } }, { notifications: { weeklyDigest: false, digestWeekday: 0 } },
      { notifications: { tutorDraft: true, weeklyDigest: true, studentReminder: true, digestWeekday: 6 }, services: { morning: { label: "Morning", start: "10:00" } } }]) {
      expect(await valid(body)).toBe(true); expect(validateSettings(body).ok).toBe(true);
    }
    for (const body of [{ notifications: {} }, { notifications: { tutorDraft: "true" } }, { notifications: { digestWeekday: 7 } }, { notifications: { digestWeekday: 1.5 } },
      { notifications: { digestWeekday: "1" } }, { notifications: { digestWeekday: -1 } }, { notifications: { recordings: true } }, { notifications: [] }, { notifications: null },
      { services: {} }, { rabbiDisplayName: "x".repeat(81) }, { unknown: 1 }]) {
      expect(await valid(body)).toBe(false); expect(validateSettings(body).ok).toBe(false);
    }
  } finally { await client.close(); }
});

test("row security: another congregation sees and writes nothing, and the runtime cannot rewrite who, what or when, or delete", async () => {
  const f = await accessFixture(); opened.push(f);
  const row = { tenantId: "crc", membershipId: f.multiMember.id, userId: f.identities.multi.id, roleGrantId: f.parentGrant.id, role: "parent" as const, kind: "weekly-digest" as const, periodKey: "2026-10-25", studentId: null, status: "sending" as const, attempts: 1 };
  const [inserted] = await withTenantTransaction(f.db, { tenantId: "crc" }, tx => tx.insert(s.notificationDelivery).values(row).returning());
  await withTenantTransaction(f.db, { tenantId: "crc" }, tx => tx.insert(s.notificationPreference).values({ tenantId: "crc", membershipId: f.multiMember.id, userId: f.identities.multi.id, kind: "weekly-digest", enabled: false, updatedVia: "web" }));
  // The same period cannot be claimed twice.
  expect(await withTenantTransaction(f.db, { tenantId: "crc" }, tx => tx.insert(s.notificationDelivery).values(row).onConflictDoNothing().returning())).toEqual([]);
  expect(await withTenantTransaction(f.db, { tenantId: "other" }, async tx => [await tx.select().from(s.notificationDelivery), await tx.select().from(s.notificationPreference)])).toEqual([[], []]);
  await expect(withTenantTransaction(f.db, { tenantId: "other" }, tx => tx.insert(s.notificationDelivery).values({ ...row, periodKey: "2026-11-01" }))).rejects.toThrow();
  await expect(withTenantTransaction(f.db, { tenantId: "other" }, tx => tx.insert(s.notificationPreference).values({ tenantId: "crc", membershipId: f.multiMember.id, userId: f.identities.multi.id, kind: "tutor-draft", enabled: false, updatedVia: "web" }))).rejects.toThrow();
  expect(await withTenantTransaction(f.db, { tenantId: "other" }, tx => tx.update(s.notificationDelivery).set({ status: "sent" }).returning())).toEqual([]);
  for (const forbidden of [sql`update notification_delivery set kind = 'practice-reminder'`, sql`update notification_delivery set period_key = '2026-11-01'`, sql`update notification_delivery set membership_id = membership_id`,
    sql`delete from notification_delivery`, sql`update notification_preference set kind = 'tutor-draft'`, sql`update notification_preference set membership_id = membership_id`, sql`delete from notification_preference`])
    await expect(withTenantTransaction(f.db, { tenantId: "crc" }, tx => tx.execute(forbidden))).rejects.toThrow();
  expect(await withTenantTransaction(f.db, { tenantId: "crc" }, tx => tx.update(s.notificationDelivery).set({ status: "sent", finishedAt: new Date() }).returning({ id: s.notificationDelivery.id }))).toEqual([{ id: inserted.id }]);
  // Shapes the ledger refuses: a draft notice to a parent, a digest tied to a student, an unknown status.
  for (const bad of [{ ...row, kind: "tutor-draft" as const, periodKey: `${f.students[0].id}:2026-10-25`, studentId: f.students[0].id }, { ...row, periodKey: "2026-10-26", studentId: f.students[0].id },
    { ...row, periodKey: "2026-10-27", status: "queued" as never }, { ...row, periodKey: "next week" }])
    await expect(withTenantTransaction(f.db, { tenantId: "crc" }, tx => tx.insert(s.notificationDelivery).values(bad))).rejects.toThrow();
});
