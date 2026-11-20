import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { expect, test } from "vitest";
import { isolatedEnv } from "../helpers/isolatedEnv.mjs";

test("0059 preserves claims, revocations and RLS while permitting one active claim per tutor and learner; migration replays", async () => {
  const isolation = await isolatedEnv(), client = new PGlite();
  try {
    const folder = "src/server/db/migrations", journal = JSON.parse(await readFile(join(folder, "meta/_journal.json"), "utf8"));
    const own = journal.entries.findIndex((entry: { tag: string }) => entry.tag === "0059_multiple_learner_tutors");
    const entries = journal.entries.slice(0, own), prior = join(isolation.home, "prior");
    await mkdir(join(prior, "meta"), { recursive: true });
    await writeFile(join(prior, "meta/_journal.json"), JSON.stringify({ ...journal, entries }));
    for (const entry of entries) await copyFile(join(folder, entry.tag + ".sql"), join(prior, entry.tag + ".sql"));
    const db = drizzle(client); await migrate(db, { migrationsFolder: prior });
    const members = [randomUUID(), randomUUID(), randomUUID()], grants = [randomUUID(), randomUUID()];
    for (const [index, member] of members.entries()) {
      const user = `multi-tutor-${index}`;
      await client.query(`insert into "user"(id,name,email,email_verified) values($1,'Synthetic person',$2,true)`, [user, [user, "example.test"].join("@")]);
      await client.query("insert into membership(id,tenant_id,user_id) values($1,'crc',$2)", [member, user]);
      if (index > 0) await client.query("insert into role_grant(id,tenant_id,membership_id,role) values($1,'crc',$2,'tutor')", [grants[index - 1], member]);
    }
    await client.query("insert into learner_claim(tenant_id,learner_membership_id,tutor_grant_id) values('crc',$1,$2)", [members[0], grants[0]]);
    const before = (await client.query("select * from learner_claim order by id")).rows;
    const policies = (await client.query("select * from pg_policies where tablename = 'learner_claim'")).rows;
    await migrate(db, { migrationsFolder: folder }); await migrate(db, { migrationsFolder: folder });
    expect((await client.query("select * from learner_claim order by id")).rows).toEqual(before);
    expect((await client.query("select * from pg_policies where tablename = 'learner_claim'")).rows).toEqual(policies);
    await client.query("insert into learner_claim(tenant_id,learner_membership_id,tutor_grant_id) values('crc',$1,$2)", [members[0], grants[1]]);
    await expect(client.query("insert into learner_claim(tenant_id,learner_membership_id,tutor_grant_id) values('crc',$1,$2)", [members[0], grants[0]])).rejects.toMatchObject({ code: "23505" });
    await client.query("update learner_claim set revoked_at = now(), revoked_by = 'learner', revoked_by_membership_id = $1 where tutor_grant_id = $2", [members[0], grants[0]]);
    await client.query("insert into learner_claim(tenant_id,learner_membership_id,tutor_grant_id) values('crc',$1,$2)", [members[0], grants[0]]);
    expect((await client.query("select count(*)::integer as count from learner_claim where revoked_at is null")).rows[0]).toEqual({ count: 2 });
  } finally { await client.close(); await isolation.cleanup(); }
});
