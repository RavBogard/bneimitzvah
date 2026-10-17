import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, expect, test } from "vitest";

const db = new PGlite();
beforeAll(async () => { await migrate(drizzle(db), { migrationsFolder: "src/server/db/migrations" }); });
afterAll(async () => { await db.close(); });
async function tx<T>(action: () => Promise<T>) {
  await db.exec("BEGIN");
  try { const value = await action(); await db.exec("COMMIT"); return value; }
  catch (error) { await db.exec("ROLLBACK"); throw error; }
}
async function fixture(bytes = 1048578, child = false) {
  const student = randomUUID(), id = randomUUID(), asset = randomUUID();
  await db.query("INSERT INTO student(id,tenant_id,first_name,last_name,ceremony_date,parent_email) VALUES($1,'crc','Synthetic','Review','9999-12-31','review@example.test')", [student]);
  await tx(async () => {
    await db.query(`INSERT INTO recording_receipt(id,tenant_id,student_id,request_id,original_recording_id,asset_id,store_generation,actor_user_id,auth_session_id,membership_id,membership_authority_revision,role_grant_id,role_grant_revision,mode,relationship_id,relationship_revision,context_id,context_authority_revision,context_student_revision,student_revision,session_expires_at,context_expires_at,declared_bytes,slot_count,state,revision,retention_ceremony_date)
      VALUES($1,'crc',$2,$3,$4,$5,'review-v1','review-user','review-session',$6,1,$7,1,$8,$9,$10,$11,$12,$13,1,'9999-12-31T00:00:00Z',$14,$15,$16,'receiving',1,'9999-12-31')`,
      [id, student, randomUUID(), randomUUID(), asset, randomUUID(), randomUUID(), child ? "child-practice" : "student", randomUUID(), child ? 1 : null, child ? randomUUID() : null, child ? 1 : null, child ? 1 : null, child ? "9998-12-31T00:00:00Z" : null, bytes, Math.ceil(bytes / 1048576)]);
    for (let i = 0; i < Math.ceil(bytes / 1048576); i++) await db.query("INSERT INTO recording_receipt_slot(tenant_id,receipt_id,slot_index,object_key,expected_bytes,revision,state) VALUES('crc',$1,$2,$3,$4,1,'reserved')", [id, i, `recordings/v1/${asset}/chunk-${String(i).padStart(2, "0")}`, Math.min(1048576, bytes - i * 1048576)]);
  });
  return { id, student };
}
async function snapshot(id: string) { return (await db.query("SELECT to_jsonb(h) AS head,(SELECT jsonb_agg(s ORDER BY slot_index) FROM recording_receipt_slot s WHERE receipt_id=h.id) AS slots FROM recording_receipt h WHERE id=$1", [id])).rows; }
async function retire(id: string) {
  await db.query("UPDATE recording_receipt SET state='retiring',revision=revision+1,retiring_at=clock_timestamp() WHERE id=$1", [id]);
  await db.query("UPDATE recording_receipt_slot SET state='retiring',revision=revision+1 WHERE receipt_id=$1", [id]);
}

test("review freezes every identity/context snapshot and rejects cross-mode nullable authority changes", async () => {
  for (const child of [false, true]) {
    const h = await fixture(46, child), before = await snapshot(h.id);
    const mutations = [
      "student_id=gen_random_uuid()", "request_id=gen_random_uuid()", "original_recording_id=gen_random_uuid()", "asset_id=gen_random_uuid()", "store_generation='other'", "actor_user_id='other'", "auth_session_id='other'", "membership_id=gen_random_uuid()", "membership_authority_revision=2", "role_grant_id=gen_random_uuid()", "role_grant_revision=2", "mode='parent'", "relationship_id=gen_random_uuid()", child ? "relationship_revision=NULL" : "relationship_revision=1", "student_revision=2", "session_expires_at='9998-01-01'", "admitted_at=admitted_at+interval '1 second'", "declared_bytes=48", "slot_count=2", "context_id=gen_random_uuid()", child ? "context_authority_revision=2" : "context_authority_revision=1", child ? "context_student_revision=2" : "context_student_revision=1", child ? "context_expires_at=NULL" : "context_expires_at='9998-01-01'",
    ];
    for (const change of mutations) await expect(db.query(`UPDATE recording_receipt SET ${change},revision=revision+1 WHERE id=$1`, [h.id])).rejects.toThrow();
    expect(await snapshot(h.id)).toEqual(before);
  }
});

test("review preparation accepts strong ASCII only, keeps exact no-ops, and forbids hidden same-state history writes", async () => {
  const h = await fixture(46);
  for (const tag of ['W/"weak"', '"has space"', '"a\r\nb"', '"é"', '"a"tail', '"' + "a".repeat(255) + '"']) await expect(db.query("UPDATE recording_receipt_slot SET state='prepared',revision=2,body_sha256=repeat('a',64),permit_etag=$2 WHERE receipt_id=$1", [h.id, tag])).rejects.toThrow();
  await db.query("UPDATE recording_receipt_slot SET state='prepared',revision=2,body_sha256=repeat('a',64),permit_etag='\"!#~\"' WHERE receipt_id=$1", [h.id]);
  const prepared = await snapshot(h.id);
  await db.query("UPDATE recording_receipt_slot SET state=state,revision=revision,body_sha256=body_sha256,permit_etag=permit_etag WHERE receipt_id=$1", [h.id]);
  expect(await snapshot(h.id)).toEqual(prepared);
  for (const change of ["revision=3", "revision=3,permit_etag='\"changed\"'", "revision=3,body_sha256=repeat('b',64)", "revision=3,open_operation_id=gen_random_uuid()", "revision=3,audio_liability_released=true"]) await expect(db.query(`UPDATE recording_receipt_slot SET ${change} WHERE receipt_id=$1`, [h.id])).rejects.toThrow();
  await db.query("UPDATE recording_receipt_slot SET state='opened',revision=3,ever_upload_opened=true,open_operation_id=gen_random_uuid(),opened_at=clock_timestamp() WHERE receipt_id=$1", [h.id]);
  await tx(() => retire(h.id));
  const opened = await snapshot(h.id);
  await expect(tx(async () => {
    await db.query("UPDATE recording_receipt_slot SET state='never-opened',revision=5,ever_upload_opened=false,open_operation_id=NULL,opened_at=NULL,audio_liability_released=true WHERE receipt_id=$1", [h.id]);
    await db.query("UPDATE recording_receipt SET state='terminal',revision=3,terminal_at=clock_timestamp(),terminal_reason='never-opened',logical_take_released=true WHERE id=$1", [h.id]);
  })).rejects.toThrow();
  expect(await snapshot(h.id)).toEqual(opened);
});

test("review deferred closure permits atomic transient changes but rejects partial release at a forced checkpoint", async () => {
  const h = await fixture(); await tx(() => retire(h.id)); const before = await snapshot(h.id);
  await expect(tx(async () => {
    await db.query("UPDATE recording_receipt_slot SET state='never-opened',revision=3,audio_liability_released=true WHERE receipt_id=$1 AND slot_index=0", [h.id]);
    await db.exec("SET CONSTRAINTS ALL IMMEDIATE");
  })).rejects.toThrow();
  expect(await snapshot(h.id)).toEqual(before);
  await tx(async () => {
    // Head-first is intentionally inconsistent until every slot is closed.
    await db.query("UPDATE recording_receipt SET state='terminal',revision=3,terminal_at=clock_timestamp(),terminal_reason='never-opened',logical_take_released=true WHERE id=$1", [h.id]);
    await db.query("UPDATE recording_receipt_slot SET state='never-opened',revision=3,audio_liability_released=true WHERE receipt_id=$1", [h.id]);
    await db.exec("SET CONSTRAINTS ALL IMMEDIATE");
  });
  const terminal = await snapshot(h.id);
  for (const change of ["state='receiving',retiring_at=NULL,terminal_at=NULL,terminal_reason=NULL,logical_take_released=false", "logical_take_released=false", "terminal_at=terminal_at+interval '1 second'"]) await expect(db.query(`UPDATE recording_receipt SET ${change},revision=4 WHERE id=$1`, [h.id])).rejects.toThrow();
  expect(await snapshot(h.id)).toEqual(terminal);
});

test("review date-only revisions are exact, and due projection rollback and postponement never reduce liabilities", async () => {
  const h = await fixture();
  const initial = await snapshot(h.id);
  await expect(db.query("UPDATE recording_receipt SET revision=2 WHERE id=$1", [h.id])).rejects.toThrow();
  await db.query("UPDATE student SET ceremony_date='9999-12-30',revision=revision+1 WHERE id=$1", [h.student]);
  expect((await db.query("SELECT revision::int,state,retention_ceremony_date::text FROM recording_receipt WHERE id=$1", [h.id])).rows).toEqual([{ revision: 2, state: "receiving", retention_ceremony_date: "9999-12-30" }]);
  const future = await snapshot(h.id);
  await expect(tx(async () => { await db.query("UPDATE student SET ceremony_date='2000-01-01',revision=revision+1 WHERE id=$1", [h.student]); throw Error("Synthetic rollback"); })).rejects.toThrow("Synthetic rollback");
  expect(await snapshot(h.id)).toEqual(future);
  await db.query("UPDATE student SET ceremony_date='2000-01-01',revision=revision+1 WHERE id=$1", [h.student]);
  const latched = (await db.query("SELECT retention_latched_at FROM recording_receipt WHERE id=$1", [h.id])).rows;
  await db.query("UPDATE student SET ceremony_date='9999-12-29',revision=revision+1 WHERE id=$1", [h.student]);
  expect((await db.query("SELECT state,logical_take_released,(SELECT sum(expected_bytes)::int FROM recording_receipt_slot WHERE receipt_id=h.id AND NOT audio_liability_released) AS charged FROM recording_receipt h WHERE id=$1", [h.id])).rows).toEqual([{ state: "retiring", logical_take_released: false, charged: 1048578 }]);
  expect((await db.query("SELECT retention_latched_at FROM recording_receipt WHERE id=$1", [h.id])).rows).toEqual(latched);
  expect(await snapshot(h.id)).not.toEqual(initial);
});
