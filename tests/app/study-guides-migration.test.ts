import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { isolatedEnv } from "../helpers/isolatedEnv.mjs";
import { priorColumns } from "../helpers/prior-columns";
import { portalRoutesFixture } from "./portal-routes-fixture";
import * as s from "../../src/server/db/index";
import { validateGuideBody } from "../../src/server/study-guides/validation";
import { additions, guide, note, source, theme } from "../helpers/study-guide-fixture";

const NEW_TABLES = ["study_voice", "study_guide", "study_guide_student", "study_theme_read"];

test("0027 additive migration upgrades and replays, with the generated snapshot limited to the four study tables and the audit action list", async () => {
  const isolation = await isolatedEnv(), client = new PGlite();
  try {
    const folder = "src/server/db/migrations", journal = JSON.parse(await readFile(join(folder, "meta/_journal.json"), "utf8"));
    const entries = journal.entries.filter((e: { idx: number }) => e.idx < 27), prior = join(isolation.home, "prior");
    await mkdir(join(prior, "meta"), { recursive: true }); await writeFile(join(prior, "meta/_journal.json"), JSON.stringify({ ...journal, entries }));
    for (const e of entries) await copyFile(join(folder, e.tag + ".sql"), join(prior, e.tag + ".sql"));
    const db = drizzle(client); await migrate(db, { migrationsFolder: prior });
    await client.query("insert into student(id,tenant_id,first_name,last_name,ceremony_date,parent_email) values($1,'crc','Synthetic','Study','2027-01-02','study@example.test')", [randomUUID()]);
    const before = (await client.query("select * from student")).rows;
    await migrate(db, { migrationsFolder: folder }); await migrate(db, { migrationsFolder: folder });
    expect(priorColumns((await client.query("select * from student")).rows, before)).toEqual(before);
    for (const table of NEW_TABLES) expect((await client.query(`select count(*)::int as n from ${table}`)).rows).toEqual([{ n: 0 }]);
    const previous = JSON.parse(await readFile(join(folder, "meta/0026_snapshot.json"), "utf8")), current = JSON.parse(await readFile(join(folder, "meta/0027_snapshot.json"), "utf8"));
    const expected = structuredClone(previous.tables);
    for (const table of NEW_TABLES) expected[`public.${table}`] = current.tables[`public.${table}`];
    expected["public.audit_event"].checkConstraints.audit_action_known = current.tables["public.audit_event"].checkConstraints.audit_action_known;
    expect(current.prevId).toBe(previous.id); expect(current.tables).toEqual(expected);
    for (const action of ["study-voice.set", "study-guide.set", "study-guide.publish", "study-guide-student.set", "study-theme.read"])
      expect(current.tables["public.audit_event"].checkConstraints.audit_action_known.value).toContain(`'${action}'`);
  } finally { await client.close(); await isolation.cleanup(); }
});

test("the SQL body check accepts every body the TypeScript validator accepts and rejects the same 9-theme body", async () => {
  const client = new PGlite();
  try {
    await migrate(drizzle(client), { migrationsFolder: "src/server/db/migrations" });
    const sql = async (body: unknown, allowOverview: boolean) =>
      (await client.query<{ valid: boolean }>("select portal_study_guide_body_valid($1::jsonb, $2) as valid", [JSON.stringify(body), allowOverview])).rows[0].valid;
    const corpus: [unknown, boolean][] = [
      [guide(), true], [guide({ themes: [] }), true], [additions(), false], [guide(), false], [additions([]), false],
      [guide({ themes: Array.from({ length: 9 }, (_, i) => theme(`t-${i}`)) }), true],
      [guide({ themes: Array.from({ length: 8 }, (_, i) => theme(`t-${i}`)) }), true],
      [guide({ overview: "a".repeat(8192) }), true], [guide({ overview: "a".repeat(8193) }), true],
      [guide({ themes: [theme("t", { title: "ש".repeat(120) })] }), true], [guide({ themes: [theme("t", { title: "ש".repeat(121) })] }), true],
      [guide({ themes: [theme("t", { notes: [note("Exodus 40:34", { body: "ש".repeat(2048) })] })] }), true],
      [guide({ themes: [theme("t", { notes: [note("Exodus 40:34", { body: "ש".repeat(2049) })] })] }), true],
      [guide({ themes: [theme("t", { notes: [note("Exodus 40:34", { sources: ["a", "b", "c", "d"].map(id => source(id)) })] })] }), true],
      [guide({ themes: [theme("t", { notes: [note("Exodus 40:34", { sources: [source("a"), source("a")] })] })] }), true],
      [guide({ themes: [theme("same"), theme("same")] }), true], [guide({ themes: [theme("Bad")] }), true],
      [guide({ overview: "<b>" }), true], [guide({ overview: "hidden\u202emark" }), true], [guide({ overview: "line\nbreak" }), true],
      [guide({ overview: "carriage\r\nreturn" }), true], [guide({ overview: "c1\u0085control" }), true], [guide({ overview: "   \n " }), true],
      [guide({ themes: [theme("t", { notes: [note("Exodus 40")] })] }), true], [{ ...guide(), extra: 1 }, true],
      [guide({ themes: [theme("t", { notes: [note("Exodus 40:34", { sources: [{ ...source(), readable: "yes" } as never] })] })] }), true],
      [guide({ overview: "arabic\u061cmark" }), true], [guide({ overview: "line\u2028sep" }), true], [guide({ overview: "zero\u200bwidth" }), true],
      [guide({ overview: "\u200b\u200b" }), true],
    ];
    for (const [body, allowOverview] of corpus) {
      const ts = validateGuideBody(body, { allowOverview }).ok, db = await sql(body, allowOverview);
      // The database is never stricter than the service: a body the service accepts always stores.
      if (ts) expect(db, JSON.stringify(body).slice(0, 120)).toBe(true);
      else expect(db, JSON.stringify(body).slice(0, 120)).toBe(false);
    }
    expect(await sql(guide({ themes: Array.from({ length: 9 }, (_, i) => theme(`t-${i}`)) }), true)).toBe(false);
    // Link detection is a service rule only; the database is the looser side, never the stricter.
    expect(validateGuideBody(guide({ overview: "see [a][b]" }), { allowOverview: true }).ok).toBe(false);
    expect(await sql(guide({ overview: "see [a][b]" }), true)).toBe(true);
    // The database rejects the disguising characters on its own, whatever the locale's class.
    for (const text of ["arabic\u061cmark", "line\u2028sep", "zero\u200bwidth"]) expect(await sql(guide({ overview: text }), true), text).toBe(false);
    const audit = await client.query<{ ok: boolean }>("select pg_get_constraintdef(oid) like '%study-guide.set%' as ok from pg_constraint where conname='audit_action_known'");
    expect(audit.rows[0].ok).toBe(true);
  } finally { await client.close(); }
});

test("study tables are tenant-isolated, rabbi-only, insert-only, and ticks update only state and version", async () => {
  const f = await portalRoutesFixture();
  try {
    const actor = { actorUserId: f.identities.admin.id, actorMembershipId: f.adminMember.id, roleGrantId: f.adminGrant.id, role: "admin" as const, mode: "admin" as const, channel: "mcp", requestDigest: "a".repeat(64) };
    const row = { tenantId: "crc", kind: "torah" as const, readingKey: "pekudei", version: 1, baseVersion: 0, previousVersion: null, origin: "claude", reviewed: false, hold: false, body: guide(), ...actor };
    await f.owner(async () => { await f.db.insert(s.studyGuide).values({ ...row, mutationId: randomUUID() }); });
    const tutor = { actorUserId: f.identities.multi.id, actorMembershipId: f.multiMember.id, roleGrantId: f.tutorGrant.id, role: "tutor" as const, mode: "tutor" as const };
    for (const bad of [
      { ...row, version: 2, baseVersion: 1, previousVersion: null }, { ...row, version: 3, baseVersion: 2, previousVersion: 2 },
      { ...row, version: 2, baseVersion: 1, previousVersion: 1, ...tutor }, { ...row, version: 2, baseVersion: 1, previousVersion: 1, actorMembershipId: f.multiMember.id },
      { ...row, version: 2, baseVersion: 1, previousVersion: 1, channel: "cookie" }, { ...row, version: 2, baseVersion: 1, previousVersion: 1, origin: "tutor" },
      { ...row, version: 2, baseVersion: 1, previousVersion: 1, readingKey: "Pekudei" }, { ...row, version: 2, baseVersion: 1, previousVersion: 1, kind: "blessing-before" as const },
      { ...row, version: 2, baseVersion: 1, previousVersion: 1, body: guide({ overview: "<b>" }) },
      // The operator bridge may write only Claude-drafted, unreviewed base guides.
      { ...row, version: 2, baseVersion: 1, previousVersion: 1, channel: "operator", origin: "rabbi" },
      { ...row, version: 2, baseVersion: 1, previousVersion: 1, channel: "operator", reviewed: true },
    ]) await expect(f.owner(async () => { await f.db.insert(s.studyGuide).values({ ...bad, mutationId: randomUUID() }); }), JSON.stringify(Object.keys(bad))).rejects.toBeDefined();
    // Triggers refuse even the owner; the runtime role has no UPDATE or DELETE at all.
    await expect(f.owner(() => f.client.exec("update study_guide set hold=true"))).rejects.toBeDefined();
    await expect(f.owner(() => f.client.exec("delete from study_guide"))).rejects.toBeDefined();
    await f.client.exec("select set_config('app.tenant_id','crc',false)");
    await expect(f.client.exec("update study_guide set hold=true")).rejects.toThrow(/permission denied/);
    await expect(f.client.exec("delete from study_theme_read")).rejects.toThrow(/permission denied/);
    await expect(f.client.exec("update study_theme_read set theme_id='other'")).rejects.toThrow(/permission denied/);
    expect((await f.client.query("select count(*)::int n from study_guide")).rows).toEqual([{ n: 1 }]);
    await f.client.exec("select set_config('app.tenant_id','other',false)");
    expect((await f.client.query("select count(*)::int n from study_guide")).rows).toEqual([{ n: 0 }]);
    await f.client.exec("select set_config('app.tenant_id','',false)");
    for (const table of NEW_TABLES) {
      const rights = await f.client.query<{ sel: boolean; ins: boolean; upd: boolean; del: boolean; rls: boolean; force: boolean }>(
        `select has_table_privilege('portal_runtime','${table}','SELECT') sel, has_table_privilege('portal_runtime','${table}','INSERT') ins,
          has_table_privilege('portal_runtime','${table}','UPDATE') upd, has_table_privilege('portal_runtime','${table}','DELETE') del,
          relrowsecurity rls, relforcerowsecurity force from pg_class where relname='${table}'`);
      expect(rights.rows[0], table).toEqual({ sel: true, ins: true, upd: false, del: false, rls: true, force: true });
    }
    const columns = await f.client.query<{ column_name: string }>("select column_name from information_schema.column_privileges where table_name='study_theme_read' and grantee='portal_runtime' and privilege_type='UPDATE' order by column_name");
    expect(columns.rows.map(r => r.column_name)).toEqual(["state", "updated_at", "version"]);
    const tick = { tenantId: "crc", studentId: f.students[0].id, kind: "torah" as const, readingKey: "pekudei", themeId: "finished-work", state: "read", version: 1 };
    await f.owner(async () => { await f.db.insert(s.studyThemeRead).values(tick); });
    await expect(f.owner(() => f.client.exec("update study_theme_read set state='unread'"))).rejects.toBeDefined();
    await f.owner(async () => { const r = await f.client.query("update study_theme_read set state='unread', version=2 returning version"); expect(r.rows).toEqual([{ version: 2 }]); });
    await expect(f.owner(() => f.client.exec("update study_theme_read set theme_id='other', version=3"))).rejects.toBeDefined();
    await expect(f.owner(async () => { await f.db.insert(s.studyThemeRead).values({ ...tick, themeId: "x", state: "maybe" }); })).rejects.toBeDefined();
    await expect(f.owner(async () => { await f.db.insert(s.studyThemeRead).values({ ...tick, themeId: "y", version: 7 }); })).rejects.toBeDefined();
    await expect(f.owner(async () => { await f.db.insert(s.studyVoice).values({ tenantId: "crc", version: 1, baseVersion: 0, previousVersion: null, body: "v", ...actor, channel: "operator", mutationId: randomUUID() }); })).rejects.toBeDefined();
    await f.owner(async () => { await f.db.insert(s.studyGuide).values({ ...row, version: 2, baseVersion: 1, previousVersion: 1, channel: "operator", mutationId: randomUUID() }); });
    const policies = await f.client.query<{ n: number }>(`select count(*)::int n from pg_policies where tablename = any($1) and policyname='tenant_isolation'`, [NEW_TABLES]);
    expect(policies.rows[0].n).toBe(4);
  } finally { await f.client.close(); }
});
