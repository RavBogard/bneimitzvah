import { test, expect, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { mkdir, copyFile, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { isolatedEnv } from "../helpers/isolatedEnv.mjs";
import { honorsFixture, emptyForm, person } from "./honors-fixture";
import * as s from "../../src/server/db/index";

test("0022 upgrades existing data, replays and changes only honors stream and audit action in generated snapshot", async () => {
  const isolation = await isolatedEnv(), client = new PGlite();
  try {
    const folder = "src/server/db/migrations", journal = JSON.parse(await readFile(join(folder, "meta/_journal.json"), "utf8"));
    expect(journal.entries.find((entry: { idx: number }) => entry.idx === 22)).toMatchObject({ idx: 22, tag: "0022_honors_version" });
    const entries = journal.entries.filter((e: { idx: number }) => e.idx < 22), prior = join(isolation.home, "prior"); await mkdir(join(prior, "meta"), { recursive: true });
    await writeFile(join(prior, "meta/_journal.json"), JSON.stringify({ ...journal, entries }));
    for (const e of entries) await copyFile(join(folder, e.tag + ".sql"), join(prior, e.tag + ".sql"));
    const db = drizzle(client); await migrate(db, { migrationsFolder: prior });
    await client.query("insert into student(id,tenant_id,first_name,last_name,ceremony_date,parent_email) values($1,'crc','Synthetic','Honors','2027-01-02','synthetic@example.test')", [randomUUID()]);
    const before = (await client.query("select * from student")).rows;
    await migrate(db, { migrationsFolder: folder }); await migrate(db, { migrationsFolder: folder }); expect((await client.query("select * from student")).rows).toEqual(before);
    expect((await client.query("select count(*)::int n from honors_version")).rows).toEqual([{ n: 0 }]);
    const prev = JSON.parse(await readFile(join(folder, "meta/0021_snapshot.json"), "utf8")), current = JSON.parse(await readFile(join(folder, "meta/0022_snapshot.json"), "utf8")), expected = structuredClone(prev.tables);
    expected["public.honors_version"] = current.tables["public.honors_version"]; expected["public.audit_event"].checkConstraints.audit_action_known = current.tables["public.audit_event"].checkConstraints.audit_action_known;
    expect(current.prevId).toBe(prev.id); expect(current.tables).toEqual(expected);
  } finally { await client.close(); await isolation.cleanup(); }
});

test("SQL validates closed form/context/mapping, composite guardian attribution, predecessor and immutable restricted stream", async () => {
  const f = await honorsFixture();
  try {
    expect(await f.service.replace(f.req(), f.selected, await f.intent({ ...emptyForm(), openingArk: [person()] }))).toMatchObject({ ok: true });
    const [row] = await f.owner(() => f.db.select().from(s.honorsVersion));
    for (const bad of [ { ...row, version: 2, baseVersion: 1, previousVersion: null }, { ...row, version: 3, baseVersion: 2, previousVersion: 2 },
      { ...row, mode: "student" as const, role: "student" as const }, { ...row, guardianId: f.guardians[1].id }, { ...row, actorMembershipId: f.adminMember.id },
      { ...row, form: { ...emptyForm(), aliyot: [{ startVerse: "Genesis 1:99", participants: [] }] } }, { ...row, reviewedContext: { ...row.reviewedContext, studentId: f.students[1].id } } ]) {
      await expect(f.owner(async () => { await f.db.insert(s.honorsVersion).values({ ...bad, id: randomUUID(), mutationId: randomUUID() }); })).rejects.toBeDefined();
    }
    for (const bad of [ { ...emptyForm(), email: "forbidden" }, { ...emptyForm(), openingArk: [{ ...person(), englishName: "<b>" }] },
      { ...emptyForm(), parentalBlessing: { participation: "no", delivery: "together" } }, { ...emptyForm(), openingArk: Array.from({ length: 33 }, () => person()) } ]) {
      expect((await f.client.query<{ valid: boolean }>("select public.portal_honors_form_valid($1::jsonb) valid", [JSON.stringify(bad)])).rows[0].valid).toBe(false);
    }
    await expect(f.client.exec("update honors_version set request_digest=request_digest")).rejects.toBeDefined(); await expect(f.client.exec("delete from honors_version")).rejects.toBeDefined();
    await expect(f.owner(() => f.client.exec("update honors_version set request_digest=request_digest"))).rejects.toBeDefined();
    const rights = await f.client.query("select has_table_privilege('portal_runtime','honors_version','SELECT') sel,has_table_privilege('portal_runtime','honors_version','INSERT') ins,has_table_privilege('portal_runtime','honors_version','UPDATE') upd,has_table_privilege('portal_runtime','honors_version','DELETE') del,relforcerowsecurity force,relrowsecurity rls from pg_class where relname='honors_version'");
    expect(rights.rows).toEqual([{ sel: true, ins: true, upd: false, del: false, force: true, rls: true }]);
    expect((await f.client.query("select count(*)::int n from honors_version")).rows).toEqual([{ n: 0 }]);
  } finally { await f.client.close(); }
});
