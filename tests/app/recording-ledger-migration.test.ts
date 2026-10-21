import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { expect, test } from "vitest";
import { isolatedEnv } from "../helpers/isolatedEnv.mjs";
import { priorColumns } from "../helpers/prior-columns";

test("0020 upgrades/replays without altering old rows; ceremony trigger stages all recordings irreversibly under old-or-new deadline and rolls back atomically", async () => {
  const isolation = await isolatedEnv(), client = new PGlite();
  try {
    const folder = "src/server/db/migrations", journal = JSON.parse(await readFile(join(folder, "meta/_journal.json"), "utf8"));
    const entries = journal.entries.filter((entry: { idx: number }) => entry.idx < 20), prior = join(isolation.home, "prior");
    await mkdir(join(prior, "meta"), { recursive: true }); await writeFile(join(prior, "meta/_journal.json"), JSON.stringify({ ...journal, entries }));
    for (const entry of entries) await copyFile(join(folder, entry.tag + ".sql"), join(prior, entry.tag + ".sql"));
    const db = drizzle(client); await migrate(db, { migrationsFolder: prior });
    const studentId = randomUUID();
    await client.query("insert into student(id,tenant_id,first_name,last_name,ceremony_date,parent_email) values ($1,'crc','Synthetic','Recording','2000-01-02','parent@example.test')", [studentId]);
    const before = (await client.query("select * from student")).rows;
    await migrate(db, { migrationsFolder: folder }); await migrate(db, { migrationsFolder: folder });
    expect(priorColumns((await client.query("select * from student")).rows, before)).toEqual(before);
    expect((await client.query("select * from student_recording")).rows).toEqual([]);
    const submittedId = randomUUID(), privateId = randomUUID();
    for (const id of [submittedId, privateId]) await client.query("insert into student_recording(id,tenant_id,student_id,asset_id,content_sha256,media_type,byte_length,duration_ms,state,revision,created_at) values ($1,'crc',$2,$3,$4,'audio/webm;codecs=opus',100,100,'private',1,clock_timestamp())", [id, studentId, randomUUID(), "a".repeat(64)]);
    await client.query("update student_recording set state='submitted',revision=2,submitted_at=clock_timestamp() where id=$1", [submittedId]);
    const submission = (await client.query("select submitted_at from student_recording where id=$1", [submittedId])).rows;
    await client.exec("begin");
    await client.query("update student set ceremony_date='9999-01-02',revision=revision+1 where id=$1", [studentId]);
    expect((await client.query("select state,revision from student_recording where id=$1", [submittedId])).rows).toEqual([{ state: "deleting", revision: 3 }]);
    expect((await client.query("select state,revision,submitted_at from student_recording where id=$1", [privateId])).rows).toEqual([{ state: "deleting", revision: 2, submitted_at: null }]);
    await client.exec("rollback");
    expect((await client.query("select state,revision from student_recording where id=$1", [submittedId])).rows).toEqual([{ state: "submitted", revision: 2 }]);
    expect((await client.query("select state,revision,submitted_at from student_recording where id=$1", [privateId])).rows).toEqual([{ state: "private", revision: 1, submitted_at: null }]);
    await client.query("update student set ceremony_date='9999-01-02',revision=revision+1 where id=$1", [studentId]);
    await client.query("update student set ceremony_date='9999-01-03',revision=revision+1 where id=$1", [studentId]);
    expect((await client.query("select state,revision from student_recording where id=$1", [submittedId])).rows).toEqual([{ state: "deleting", revision: 3 }]);
    expect((await client.query("select state,revision,submitted_at from student_recording where id=$1", [privateId])).rows).toEqual([{ state: "deleting", revision: 2, submitted_at: null }]);
    expect((await client.query("select submitted_at from student_recording where id=$1", [submittedId])).rows).toEqual(submission);
    // The NEW-date branch independently stages an otherwise future ceremony.
    const futurePrivate = randomUUID(), futureSubmitted = randomUUID();
    for (const id of [futurePrivate, futureSubmitted]) await client.query("insert into student_recording(id,tenant_id,student_id,asset_id,content_sha256,media_type,byte_length,duration_ms,state,revision,created_at) values ($1,'crc',$2,$3,$4,'audio/webm;codecs=opus',100,100,'private',1,clock_timestamp())", [id, studentId, randomUUID(), "b".repeat(64)]);
    await client.query("update student_recording set state='submitted',revision=2,submitted_at=clock_timestamp() where id=$1", [futureSubmitted]);
    await client.query("update student set ceremony_date='2000-01-02',revision=revision+1 where id=$1", [studentId]);
    expect((await client.query("select state,revision,submitted_at is null as unsent from student_recording where id=$1", [futurePrivate])).rows).toEqual([{ state: "deleting", revision: 2, unsent: true }]);
    expect((await client.query("select state,revision,submitted_at is null as unsent from student_recording where id=$1", [futureSubmitted])).rows).toEqual([{ state: "deleting", revision: 3, unsent: false }]);
    expect((await client.query("select count(*)::int as audits from audit_event")).rows).toEqual([{ audits: 0 }]);
    expect((await client.query("select portal_practice_anniversary_due(date '9999-12-31',timestamptz '9999-12-31 23:59:59+00') as due")).rows).toEqual([{ due: false }]);
    const previous = JSON.parse(await readFile(join(folder, "meta/0019_snapshot.json"), "utf8")), current = JSON.parse(await readFile(join(folder, "meta/0020_snapshot.json"), "utf8"));
    expect(current.prevId).toBe(previous.id);
    const expected = structuredClone(previous.tables); expected["public.student_recording"] = current.tables["public.student_recording"];
    expected["public.audit_event"].checkConstraints.audit_action_known = current.tables["public.audit_event"].checkConstraints.audit_action_known;
    expect(current.tables).toEqual(expected);
  } finally { await client.close(); await isolation.cleanup(); }
});
