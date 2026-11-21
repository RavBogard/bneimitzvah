import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { expect, it } from "vitest";
import { isolatedEnv } from "../helpers/isolatedEnv.mjs";
import { MIGRATIONS_FOLDER } from "../helpers/migrated-pglite";

it("adds student ownership without moving legacy documents and accepts the previous app's next version during rollout", async () => {
  const environment = await isolatedEnv(), client = new PGlite();
  try {
    const journal = JSON.parse(await readFile(join(MIGRATIONS_FOLDER, "meta/_journal.json"), "utf8"));
    const tag = "0062_student_learning", index = journal.entries.findIndex((entry: { tag: string }) => entry.tag === tag);
    expect(index).toBeGreaterThan(0);
    const prior = join(environment.home, "prior"), entries = journal.entries.slice(0, index);
    await mkdir(join(prior, "meta"), { recursive: true });
    await writeFile(join(prior, "meta/_journal.json"), JSON.stringify({ ...journal, entries }));
    await Promise.all(entries.map((entry: { tag: string }) => copyFile(join(MIGRATIONS_FOLDER, entry.tag + ".sql"), join(prior, entry.tag + ".sql"))));
    const db = drizzle(client);
    await migrate(db, { migrationsFolder: prior });
    const membership = randomUUID(), grant = randomUUID(), student = randomUUID(), sibling = randomUUID(), user = "synthetic-learning-rollout";
    const original = { schema: "learn-progress/v1", lessons: { "intro-phrases": { done: "2026-11-10T12:00:00.000Z" } }, cards: {} };
    await client.query('INSERT INTO "user" (id,name,email,email_verified) VALUES ($1,\'Synthetic learner\',$2,true)', [user, `${user}@example.test`]);
    await client.query("INSERT INTO membership (tenant_id,id,user_id) VALUES ('crc',$1,$2)", [membership, user]);
    await client.query("INSERT INTO role_grant (tenant_id,id,membership_id,role) VALUES ('crc',$1,$2,'student')", [grant, membership]);
    await client.query("INSERT INTO student (tenant_id,id,first_name,last_name,ceremony_date,parent_email) VALUES ('crc',$1,'Synthetic','Learner','2027-01-02','family@example.test'),('crc',$2,'Synthetic','Sibling','2027-01-02','family@example.test')", [student, sibling]);
    await client.query("INSERT INTO student_identity (tenant_id,student_id,role_grant_id) VALUES ('crc',$1,$2)", [student, grant]);
    await client.query("INSERT INTO course_progress (tenant_id,membership_id,user_id,progress,version) VALUES ('crc',$1,$2,$3::jsonb,6)", [membership, user, JSON.stringify(original)]);
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    expect((await client.query("SELECT student_id, membership_id FROM student_learning_legacy")).rows).toEqual([{ student_id: student, membership_id: membership }]);
    expect((await client.query("SELECT progress, version FROM course_progress")).rows).toEqual([{ progress: original, version: 6 }]);

    const next = { ...original, lessons: { ...original.lessons, "torah-etnachta": { done: "2026-11-20T12:00:00.000Z" } } };
    await client.exec("CREATE ROLE learning_rollout LOGIN; GRANT portal_runtime TO learning_rollout; SET SESSION AUTHORIZATION learning_rollout; SET ROLE portal_runtime; BEGIN");
    await client.query("SELECT set_config('app.tenant_id', 'crc', true), set_config('app.course_owner', $1, true)", [membership]);
    await client.query("UPDATE course_progress SET progress = $1::jsonb, version = 7 WHERE membership_id = $2 AND version = 6", [JSON.stringify(next), membership]);
    expect((await client.query("SELECT progress, version FROM course_progress")).rows).toEqual([{ progress: next, version: 7 }]);
    await client.exec("COMMIT; BEGIN");
    await client.query("SELECT set_config('app.tenant_id', 'crc', true), set_config('app.learning_student', $1, true), set_config('app.learning_kind', 'learn', true)", [sibling]);
    await client.query("INSERT INTO student_learning (tenant_id,student_id,kind,document) VALUES ('crc',$1,'learn',$2::jsonb)", [sibling, JSON.stringify(original)]);
    expect((await client.query("SELECT student_id FROM student_learning")).rows).toEqual([{ student_id: sibling }]);
    expect((await client.query("SELECT student_id FROM student_learning_legacy")).rows).toEqual([]);
    expect((await client.query("SELECT membership_id FROM course_progress")).rows).toEqual([]);
    await client.exec("COMMIT; BEGIN");
    await client.query("SELECT set_config('app.tenant_id', 'crc', true), set_config('app.learning_student', $1, true), set_config('app.learning_kind', 'verses', true)", [sibling]);
    expect((await client.query("SELECT student_id FROM student_learning")).rows).toEqual([]);
    await client.exec("ROLLBACK");
  } finally { await client.close(); await environment.cleanup(); }
});
