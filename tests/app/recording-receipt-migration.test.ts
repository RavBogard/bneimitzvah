import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, expect, test } from "vitest";
import { isolatedEnv } from "../helpers/isolatedEnv.mjs";

const folder = "src/server/db/migrations", client = new PGlite();
beforeAll(async () => { await migrate(drizzle(client), { migrationsFolder: folder }); });
afterAll(async () => { await client.close(); });
async function transaction(action: () => Promise<unknown>) {
  await client.exec("BEGIN");
  try { await action(); await client.exec("COMMIT"); } catch (error) { await client.exec("ROLLBACK"); throw error; }
}
async function student() {
  const id = randomUUID(); await client.query("INSERT INTO student(id,tenant_id,first_name,last_name,ceremony_date,parent_email) VALUES($1,'crc','Synthetic','Receipt','9999-12-31','parent@example.test')", [id]); return id;
}
async function head(studentId: string, bytes = 46, change: Record<string, unknown> = {}) {
  const id = randomUUID(), asset = randomUUID();
  const values = { id, tenant_id: "crc", student_id: studentId, request_id: randomUUID(), original_recording_id: randomUUID(), asset_id: asset, store_generation: "synthetic-v1", actor_user_id: "synthetic-user", auth_session_id: "synthetic-session", membership_id: randomUUID(), membership_authority_revision: 1, role_grant_id: randomUUID(), role_grant_revision: 1, mode: "student", relationship_id: randomUUID(), relationship_revision: null, student_revision: 1, session_expires_at: "9999-12-31T00:00:00Z", declared_bytes: bytes, slot_count: Math.ceil(bytes / 1048576), state: "receiving", revision: 1, retention_ceremony_date: "9999-12-31", ...change };
  const keys = Object.keys(values); await client.query(`INSERT INTO recording_receipt(${keys.join(",")}) VALUES(${keys.map((_, i) => "$" + (i + 1)).join(",")})`, Object.values(values)); return { id, asset, bytes, slots: Math.ceil(bytes / 1048576) };
}
async function slot(h: Awaited<ReturnType<typeof head>>, i: number, change: Record<string, unknown> = {}) {
  const values = { tenant_id: "crc", receipt_id: h.id, slot_index: i, object_key: `recordings/v1/${h.asset}/chunk-${String(i).padStart(2, "0")}`, expected_bytes: Math.min(1048576, h.bytes - i * 1048576), state: "reserved", revision: 1, ...change };
  const keys = Object.keys(values); await client.query(`INSERT INTO recording_receipt_slot(${keys.join(",")}) VALUES(${keys.map((_, n) => "$" + (n + 1)).join(",")})`, Object.values(values));
}
async function receipt(studentId: string, bytes = 46) { let h!: Awaited<ReturnType<typeof head>>; await transaction(async () => { h = await head(studentId, bytes); for (let i = 0; i < h.slots; i++) await slot(h, i); }); return h; }
async function retire(id: string) { await client.query("UPDATE recording_receipt SET state='retiring',revision=revision+1,retiring_at=clock_timestamp() WHERE id=$1", [id]); await client.query("UPDATE recording_receipt_slot SET state='retiring',revision=revision+1 WHERE receipt_id=$1", [id]); }

// Positive historical fixtures are bounded by their journal index, not an old
// release operator's future-migration allowlist.
test("0021 upgrades and replays preserving old rows/snapshots, adding only three empty forced-RLS tables", async () => {
  const isolated = await isolatedEnv(), old = new PGlite();
  try {
    const journal = JSON.parse(await readFile(join(folder, "meta/_journal.json"), "utf8")), entries = journal.entries.filter((entry: { idx: number }) => entry.idx < 21), prior = join(isolated.home, "prior");
    await mkdir(join(prior, "meta"), { recursive: true }); await writeFile(join(prior, "meta/_journal.json"), JSON.stringify({ ...journal, entries }));
    for (const entry of entries) await copyFile(join(folder, entry.tag + ".sql"), join(prior, entry.tag + ".sql"));
    await migrate(drizzle(old), { migrationsFolder: prior });
    const id = randomUUID(); await old.query("INSERT INTO student(id,tenant_id,first_name,last_name,ceremony_date,parent_email) VALUES($1,'crc','Synthetic','Preserved','9999-12-31','parent@example.test')", [id]);
    const before = (await old.query("SELECT * FROM student")).rows;
    await migrate(drizzle(old), { migrationsFolder: folder }); await migrate(drizzle(old), { migrationsFolder: folder });
    expect((await old.query("SELECT * FROM student")).rows).toEqual(before);
    for (const table of ["recording_admission", "recording_receipt", "recording_receipt_slot"]) {
      expect((await old.query(`SELECT count(*)::integer AS n FROM ${table}`)).rows).toEqual([{ n: 0 }]);
      expect((await old.query("SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname=$1", [table])).rows).toEqual([{ relrowsecurity: true, relforcerowsecurity: true }]);
      expect((await old.query("SELECT has_table_privilege('portal_runtime',$1,'DELETE') AS allowed", [table])).rows).toEqual([{ allowed: false }]);
    }
    const previous = JSON.parse(await readFile(join(folder, "meta/0020_snapshot.json"), "utf8")), current = JSON.parse(await readFile(join(folder, "meta/0021_snapshot.json"), "utf8"));
    expect(current.prevId).toBe(previous.id);
    const expected = structuredClone(previous.tables); for (const table of ["recording_admission", "recording_receipt", "recording_receipt_slot"]) expected["public." + table] = current.tables["public." + table];
    expect(current.tables).toEqual(expected);
    for (const key of Object.keys(previous).filter(key => !["id", "prevId", "tables"].includes(key))) expect(current[key]).toEqual(previous[key]);
  } finally { await old.close(); await isolated.cleanup(); }
});

test("complete slots are required at COMMIT; initial/null/wrong-length and missing-set bypasses fail", async () => {
  const id = await student();
  for (const bytes of [46, 1048576, 1048578, 28800044]) { const h = await receipt(id, bytes); expect((await client.query("SELECT count(*)::int AS n,sum(expected_bytes)::int AS bytes FROM recording_receipt_slot WHERE receipt_id=$1", [h.id])).rows).toEqual([{ n: h.slots, bytes }]); }
  await transaction(async () => { const h = await head(id, 46, { mode: "child-practice", relationship_revision: 1, context_id: randomUUID(), context_authority_revision: 1, context_student_revision: 1, context_expires_at: "9998-12-31T00:00:00Z" }); await slot(h, 0); });
  await expect(transaction(async () => { await head(id); })).rejects.toThrow();
  await expect(transaction(async () => { const h = await head(id, 1048578); await slot(h, 0); })).rejects.toThrow();
  for (const change of [{ expected_bytes: 44 }, { slot_index: 1 }, { object_key: "recordings/v1/wrong/chunk-00" }, { state: "opened" }, { audio_liability_released: null }, { ever_upload_opened: null }]) await expect(transaction(async () => { const h = await head(id); await slot(h, 0, change); })).rejects.toThrow();
  for (const change of [{ logical_take_released: null }, { logical_take_released: true }, { state: "terminal" }, { relationship_revision: 1 }, { context_id: randomUUID() }]) await expect(transaction(async () => { const h = await head(id, 46, change); await slot(h, 0); })).rejects.toThrow();
  await expect(transaction(async () => { const h = await head(id); await slot(h, 0); await slot(h, 0); })).rejects.toThrow();
});

test("slot preparation/opening/history is immutable with consecutive revisions; opened work cannot release", async () => {
  const h = await receipt(await student());
  await client.query("UPDATE recording_receipt_slot SET state='prepared',revision=2,body_sha256=$2,permit_etag=$3 WHERE receipt_id=$1", [h.id, "a".repeat(64), '"permit"']);
  for (const sql of ["UPDATE recording_receipt_slot SET revision=3 WHERE receipt_id=$1", "UPDATE recording_receipt_slot SET body_sha256=repeat('b',64),revision=3 WHERE receipt_id=$1", "UPDATE recording_receipt_slot SET state='reserved',revision=3 WHERE receipt_id=$1"]) await expect(client.query(sql, [h.id])).rejects.toThrow();
  await client.query("UPDATE recording_receipt_slot SET state='opened',revision=3,ever_upload_opened=true,open_operation_id=$2,opened_at=clock_timestamp() WHERE receipt_id=$1", [h.id, randomUUID()]);
  await transaction(() => retire(h.id));
  await expect(transaction(async () => { await client.query("UPDATE recording_receipt_slot SET state='never-opened',revision=5,ever_upload_opened=false,audio_liability_released=true WHERE receipt_id=$1", [h.id]); })).rejects.toThrow();
  expect((await client.query("SELECT ever_upload_opened,audio_liability_released,state FROM recording_receipt_slot WHERE receipt_id=$1", [h.id])).rows).toEqual([{ ever_upload_opened: true, audio_liability_released: false, state: "retiring" }]);
  await expect(client.query("DELETE FROM recording_receipt_slot WHERE receipt_id=$1", [h.id])).rejects.toThrow();
  await expect(client.query("UPDATE recording_receipt SET asset_id=$2 WHERE id=$1", [h.id, randomUUID()])).rejects.toThrow();
});

test("never-opened terminal/release is atomic across the complete head and all slots; projection/no-op matrix is exact", async () => {
  const h = await receipt(await student(), 1048578); await transaction(() => retire(h.id));
  await expect(transaction(async () => { await client.query("UPDATE recording_receipt_slot SET state='never-opened',revision=3,audio_liability_released=true WHERE receipt_id=$1 AND slot_index=0", [h.id]); })).rejects.toThrow();
  await expect(transaction(async () => { await client.query("UPDATE recording_receipt SET state='terminal',revision=3,terminal_at=clock_timestamp(),terminal_reason='never-opened',logical_take_released=true WHERE id=$1", [h.id]); })).rejects.toThrow();
  await transaction(async () => {
    await client.query("UPDATE recording_receipt SET state='terminal',revision=3,terminal_at=clock_timestamp(),terminal_reason='never-opened',logical_take_released=true WHERE id=$1", [h.id]);
    await client.query("UPDATE recording_receipt_slot SET state='never-opened',revision=3,audio_liability_released=true WHERE receipt_id=$1", [h.id]);
  });
  await client.query("UPDATE recording_receipt SET revision=revision WHERE id=$1", [h.id]);
  await expect(client.query("UPDATE recording_receipt SET revision=revision+1 WHERE id=$1", [h.id])).rejects.toThrow();
  await expect(client.query("UPDATE recording_receipt SET state='receiving',revision=4,logical_take_released=false,terminal_at=NULL,terminal_reason=NULL,retiring_at=NULL WHERE id=$1", [h.id])).rejects.toThrow();
});

test("ordered date projection stages old ledger and all slots irreversibly without changing liability; rollback stays atomic", async () => {
  const id = await student(), h = await receipt(id, 1048578), ledgerId = randomUUID();
  await client.query("INSERT INTO student_recording(id,tenant_id,student_id,asset_id,content_sha256,media_type,byte_length,duration_ms,state,revision,created_at) VALUES($1,'crc',$2,$3,$4,'audio/webm;codecs=opus',100,100,'private',1,clock_timestamp())", [ledgerId, id, randomUUID(), "b".repeat(64)]);
  const liability = async () => (await client.query("SELECT sum(expected_bytes)::int AS bytes,bool_or(audio_liability_released) AS released FROM recording_receipt_slot WHERE receipt_id=$1", [h.id])).rows;
  const before = await liability();
  await client.exec("BEGIN"); await client.query("UPDATE student SET ceremony_date='2000-01-01',revision=revision+1 WHERE id=$1", [id]); await client.query("UPDATE student SET ceremony_date='9999-12-30',revision=revision+1 WHERE id=$1", [id]); await client.exec("ROLLBACK");
  expect((await client.query("SELECT state,revision FROM recording_receipt WHERE id=$1", [h.id])).rows).toEqual([{ state: "receiving", revision: 1 }]);
  await transaction(async () => { await client.query("UPDATE student SET ceremony_date='2000-01-01',revision=revision+1 WHERE id=$1", [id]); await client.query("UPDATE student SET ceremony_date='9999-12-30',revision=revision+1 WHERE id=$1", [id]); });
  expect((await client.query("SELECT state,logical_take_released,retention_latched_at IS NOT NULL AS latched FROM recording_receipt WHERE id=$1", [h.id])).rows).toEqual([{ state: "retiring", logical_take_released: false, latched: true }]);
  expect((await client.query("SELECT state FROM student_recording WHERE id=$1", [ledgerId])).rows).toEqual([{ state: "deleting" }]);
  expect(await liability()).toEqual(before);
  expect((await client.query("SELECT tgname FROM pg_trigger WHERE tgrelid='student'::regclass AND tgname IN ('recording_ceremony_retention','recording_manifest_ceremony_retention') ORDER BY tgname")).rows).toEqual([{ tgname: "recording_ceremony_retention" }, { tgname: "recording_manifest_ceremony_retention" }]);
  expect((await client.query("SELECT count(*)::int AS n FROM audit_event")).rows).toEqual([{ n: 0 }]);
});
