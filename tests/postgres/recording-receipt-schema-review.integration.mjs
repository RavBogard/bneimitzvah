import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { disposableConfig, query } from "./disposable.mjs";

async function fixture() {
  const config = disposableConfig(), suffix = randomBytes(8).toString("hex"), database = `receipt_review_${suffix}`, login = `receipt_review_runtime_${suffix}`, maintenance = `receipt_review_maint_${suffix}`, password = randomBytes(32).toString("hex");
  const anchor = new pg.Client(config), owner = new pg.Client({ ...config, database }), clients = [];
  let madeDatabase = false, madeRuntime = false, madeMaintenance = false;
  async function close() {
    await Promise.all(clients.map(c => c.end().catch(() => {}))); await owner.end().catch(() => {});
    if (madeDatabase) await query(anchor, `DROP DATABASE "${database}"`);
    if (madeRuntime) await query(anchor, `DROP ROLE "${login}"`);
    if (madeMaintenance) await query(anchor, `DROP ROLE "${maintenance}"`);
    await anchor.end();
  }
  try {
    await anchor.connect(); await query(anchor, `CREATE DATABASE "${database}"`); madeDatabase = true; await owner.connect();
    await migrate(drizzle(owner), { migrationsFolder: "src/server/db/migrations" });
    for (const role of [login, maintenance]) {
      await query(anchor, `CREATE ROLE "${role}" LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${password}'`);
      if (role === login) madeRuntime = true; else madeMaintenance = true;
    }
    await query(anchor, `GRANT portal_runtime TO "${login}"`);
    await query(owner, `GRANT CONNECT ON DATABASE "${database}" TO "${maintenance}"`);
    await query(owner, `GRANT USAGE ON SCHEMA public TO "${maintenance}"`);
    await query(owner, `GRANT SELECT ON recording_receipt,recording_receipt_slot TO "${maintenance}"`);
    await query(owner, `GRANT UPDATE(state,revision,terminal_at,terminal_reason,logical_take_released) ON recording_receipt TO "${maintenance}"`);
    await query(owner, `GRANT UPDATE(state,revision,audio_liability_released) ON recording_receipt_slot TO "${maintenance}"`);
    for (const table of ["recording_receipt", "recording_receipt_slot"]) await query(owner, `CREATE POLICY synthetic_review_maintenance ON ${table} TO "${maintenance}" USING(tenant_id='crc' AND session_user='${maintenance}') WITH CHECK(tenant_id='crc' AND session_user='${maintenance}')`);
    async function connect(kind = "owner") {
      const c = new pg.Client({ ...config, database, ...(kind === "owner" ? {} : { user: kind === "runtime" ? login : maintenance, password }) });
      await c.connect(); clients.push(c); return c;
    }
    return { owner, connect, close, login, maintenance };
  } catch (error) { await close(); throw error; }
}
async function tx(c, action) { await query(c, "BEGIN"); try { const value = await action(); await query(c, "COMMIT"); return value; } catch (error) { await query(c, "ROLLBACK"); throw error; } }
async function receipt(f) {
  const student = randomUUID(), id = randomUUID(), asset = randomUUID();
  await query(f.owner, "INSERT INTO student(id,tenant_id,first_name,last_name,ceremony_date,parent_email) VALUES($1,'crc','Synthetic','NativeReview','9999-12-31','review@example.test')", [student]);
  await tx(f.owner, async () => {
    await query(f.owner, `INSERT INTO recording_receipt(id,tenant_id,student_id,request_id,original_recording_id,asset_id,store_generation,actor_user_id,auth_session_id,membership_id,membership_authority_revision,role_grant_id,role_grant_revision,mode,relationship_id,student_revision,session_expires_at,declared_bytes,slot_count,state,revision,retention_ceremony_date)
      VALUES($1,'crc',$2,$3,$4,$5,'review-v1','review-user','review-session',$6,1,$7,1,'student',$8,1,'9999-12-31T00:00:00Z',46,1,'receiving',1,'9999-12-31')`, [id, student, randomUUID(), randomUUID(), asset, randomUUID(), randomUUID(), randomUUID()]);
    await query(f.owner, "INSERT INTO recording_receipt_slot(tenant_id,receipt_id,slot_index,object_key,expected_bytes,revision,state) VALUES('crc',$1,0,$2,46,1,'reserved')", [id, `recordings/v1/${asset}/chunk-00`]);
  }); return { id, student };
}
async function prepare(c, id) { await query(c, "UPDATE recording_receipt_slot SET state='prepared',revision=2,body_sha256=repeat('a',64),permit_etag='\"review\"' WHERE receipt_id=$1", [id]); }
async function retire(c, id) {
  await query(c, "UPDATE recording_receipt SET state='retiring',revision=revision+1,retiring_at=clock_timestamp() WHERE id=$1", [id]);
  await query(c, "UPDATE recording_receipt_slot SET state='retiring',revision=revision+1 WHERE receipt_id=$1", [id]);
}
async function terminal(c, id) {
  await query(c, "UPDATE recording_receipt SET state='terminal',revision=revision+1,terminal_at=clock_timestamp(),terminal_reason='never-opened',logical_take_released=true WHERE id=$1", [id]);
  await query(c, "UPDATE recording_receipt_slot SET state='never-opened',revision=revision+1,audio_liability_released=true WHERE receipt_id=$1", [id]);
}
async function edge(observer, waiter, blocker) {
  const until = Date.now() + 3000;
  while (Date.now() < until) { if ((await query(observer, "SELECT $2::int=ANY(pg_blocking_pids($1::int)) AS blocked", [waiter.processID, blocker.processID])).rows[0].blocked) return; await delay(10); }
  throw Error("Expected independent native blocking edge not observed");
}
async function scoped(c) { await query(c, "SELECT set_config('app.tenant_id','crc',true)"); }

test("review native grants expose only exact update columns and no authority/release escape", { timeout: 30000 }, async () => {
  const f = await fixture();
  try {
    const h = await receipt(f), runtime = await f.connect("runtime"), maint = await f.connect("maintenance");
    const allowed = {
      recording_admission: ["tenant_id"],
      recording_receipt: ["retention_ceremony_date", "retention_latched_at", "retiring_at", "revision", "state"],
      recording_receipt_slot: ["body_sha256", "ever_upload_opened", "open_operation_id", "opened_at", "permit_etag", "revision", "state"],
    };
    for (const [table, expected] of Object.entries(allowed)) {
      const columns = await query(f.owner, "SELECT attname FROM pg_attribute WHERE attrelid=$1::regclass AND attnum>0 AND NOT attisdropped AND has_column_privilege('portal_runtime',$1,attname,'UPDATE') ORDER BY attname", [table]);
      assert.deepEqual(columns.rows.map(r => r.attname), expected);
      assert.equal((await query(f.owner, "SELECT has_table_privilege('portal_runtime',$1,'DELETE') AS allowed", [table])).rows[0].allowed, false);
    }
    assert.equal((await query(runtime, "SELECT count(*)::int AS n FROM recording_receipt")).rows[0].n, 0);
    await tx(runtime, async () => {
      await query(runtime, "SELECT set_config('app.tenant_id','foreign-review',true)");
      assert.equal((await query(runtime, "SELECT count(*)::int AS n FROM recording_receipt_slot")).rows[0].n, 0);
      assert.equal((await query(runtime, "UPDATE recording_receipt SET state='retiring',revision=revision+1,retiring_at=clock_timestamp() WHERE id=$1 RETURNING id", [h.id])).rowCount, 0);
    });
    await assert.rejects(tx(runtime, async () => { await scoped(runtime); await query(runtime, "UPDATE recording_receipt SET actor_user_id='changed' WHERE id=$1", [h.id]); }), { code: "42501" });
    await assert.rejects(tx(maint, () => query(maint, "UPDATE recording_receipt_slot SET body_sha256=repeat('a',64) WHERE receipt_id=$1", [h.id])), { code: "42501" });
    assert.deepEqual((await query(f.owner, "SELECT rolbypassrls,rolsuper FROM pg_roles WHERE rolname=$1", [f.login])).rows, [{ rolbypassrls: false, rolsuper: false }]);
    assert.equal((await query(f.owner, "SELECT count(*)::int AS n FROM student_recording")).rows[0].n, 0);
  } finally { await f.close(); }
});

test("review maintenance-first absent-ledger closure serializes date projection without an admission lock or revival", { timeout: 30000 }, async () => {
  const f = await fixture(); let pending, maint, date, observer, mutex;
  try {
    maint = await f.connect("maintenance"); date = await f.connect(); observer = await f.connect(); mutex = await f.connect();
    const h = await receipt(f); await prepare(f.owner, h.id); await tx(f.owner, () => retire(f.owner, h.id));
    await query(mutex, "BEGIN"); await query(mutex, "INSERT INTO recording_admission(tenant_id) VALUES('crc')"); await query(mutex, "SELECT * FROM recording_admission FOR UPDATE");
    await query(maint, "BEGIN"); await query(maint, "SELECT * FROM recording_receipt WHERE id=$1 FOR UPDATE", [h.id]); await terminal(maint, h.id);
    pending = query(date, "UPDATE student SET ceremony_date='2000-01-01',revision=revision+1 WHERE id=$1", [h.student]); void pending.catch(() => {});
    await edge(observer, date, maint); await query(maint, "COMMIT"); await pending; pending = undefined;
    assert.deepEqual((await query(f.owner, "SELECT state,revision::int,logical_take_released,retention_latched_at IS NOT NULL AS latched FROM recording_receipt WHERE id=$1", [h.id])).rows, [{ state: "terminal", revision: 4, logical_take_released: true, latched: true }]);
    await query(date, "UPDATE student SET ceremony_date='9999-12-30',revision=revision+1 WHERE id=$1", [h.student]);
    assert.deepEqual((await query(f.owner, "SELECT state,ever_upload_opened,audio_liability_released,body_sha256=repeat('a',64) AS retained FROM recording_receipt_slot WHERE receipt_id=$1", [h.id])).rows, [{ state: "never-opened", ever_upload_opened: false, audio_liability_released: true, retained: true }]);
    assert.equal((await query(f.owner, "SELECT count(*)::int AS n FROM student_recording")).rows[0].n, 0);
  } finally {
    if (maint) await query(maint, "ROLLBACK").catch(() => {}); if (mutex) await query(mutex, "ROLLBACK").catch(() => {});
    if (pending) await Promise.allSettled([pending]); await f.close();
  }
});

test("review confirmed opening beats date retirement, while terminal-first can never issue a later opening", { timeout: 30000 }, async () => {
  const f = await fixture(); let pending, runtime, date, observer;
  try {
    runtime = await f.connect("runtime"); date = await f.connect(); observer = await f.connect();
    const h = await receipt(f); await prepare(f.owner, h.id);
    await query(runtime, "BEGIN"); await scoped(runtime); await query(runtime, "SELECT * FROM recording_receipt WHERE id=$1 FOR UPDATE", [h.id]);
    await query(runtime, "UPDATE recording_receipt_slot SET state='opened',revision=3,ever_upload_opened=true,open_operation_id=$2,opened_at=clock_timestamp() WHERE receipt_id=$1", [h.id, randomUUID()]);
    pending = query(date, "UPDATE student SET ceremony_date='2000-01-01',revision=revision+1 WHERE id=$1", [h.student]); void pending.catch(() => {});
    await edge(observer, date, runtime); await query(runtime, "COMMIT"); await pending; pending = undefined;
    const before = (await query(f.owner, "SELECT to_jsonb(s) AS slot FROM recording_receipt_slot s WHERE receipt_id=$1", [h.id])).rows;
    await assert.rejects(tx(f.owner, async () => { await query(f.owner, "UPDATE recording_receipt_slot SET state='never-opened',revision=5,audio_liability_released=true WHERE receipt_id=$1", [h.id]); }), { code: "23514" });
    assert.deepEqual((await query(f.owner, "SELECT to_jsonb(s) AS slot FROM recording_receipt_slot s WHERE receipt_id=$1", [h.id])).rows, before);
    assert.deepEqual((await query(f.owner, "SELECT state,ever_upload_opened,audio_liability_released FROM recording_receipt_slot WHERE receipt_id=$1", [h.id])).rows, [{ state: "retiring", ever_upload_opened: true, audio_liability_released: false }]);
    const closed = await receipt(f); await prepare(f.owner, closed.id); await tx(f.owner, () => retire(f.owner, closed.id)); await tx(f.owner, () => terminal(f.owner, closed.id));
    await tx(runtime, async () => {
      await scoped(runtime);
      assert.equal((await query(runtime, "UPDATE recording_receipt_slot SET state='opened',revision=revision+1,ever_upload_opened=true,open_operation_id=$2,opened_at=clock_timestamp() WHERE receipt_id=$1 AND state='prepared' RETURNING receipt_id", [closed.id, randomUUID()])).rowCount, 0);
    });
    await assert.rejects(tx(runtime, async () => { await scoped(runtime); await query(runtime, "UPDATE recording_receipt_slot SET state='opened',revision=revision+1,ever_upload_opened=true,open_operation_id=$2,opened_at=clock_timestamp() WHERE receipt_id=$1", [closed.id, randomUUID()]); }), { code: "23514" });
    assert.equal((await query(f.owner, "SELECT count(*)::int AS n FROM audit_event")).rows[0].n, 0);
  } finally {
    if (runtime) await query(runtime, "ROLLBACK").catch(() => {}); if (pending) await Promise.allSettled([pending]); await f.close();
  }
});

test("review date-first stages charge before waiting maintenance can perform its separate never-opened closure", { timeout: 30000 }, async () => {
  const f = await fixture(); let pending, date, maint, observer;
  try {
    date = await f.connect(); maint = await f.connect("maintenance"); observer = await f.connect();
    const h = await receipt(f);
    await query(date, "BEGIN");
    await query(date, "UPDATE student SET ceremony_date='2000-01-01',revision=revision+1 WHERE id=$1", [h.student]);
    assert.deepEqual((await query(date, "SELECT state,logical_take_released FROM recording_receipt WHERE id=$1", [h.id])).rows, [{ state: "retiring", logical_take_released: false }]);
    assert.deepEqual((await query(date, "SELECT state,audio_liability_released FROM recording_receipt_slot WHERE receipt_id=$1", [h.id])).rows, [{ state: "retiring", audio_liability_released: false }]);
    await query(maint, "BEGIN");
    pending = query(maint, "SELECT * FROM recording_receipt WHERE id=$1 FOR UPDATE", [h.id]); void pending.catch(() => {});
    await edge(observer, maint, date); await query(date, "COMMIT"); await pending; pending = undefined;
    assert.deepEqual((await query(maint, "SELECT state,retention_latched_at IS NOT NULL AS latched,logical_take_released FROM recording_receipt WHERE id=$1", [h.id])).rows, [{ state: "retiring", latched: true, logical_take_released: false }]);
    await terminal(maint, h.id); await query(maint, "COMMIT");
    assert.deepEqual((await query(f.owner, "SELECT state,logical_take_released FROM recording_receipt WHERE id=$1", [h.id])).rows, [{ state: "terminal", logical_take_released: true }]);
  } finally {
    if (date) await query(date, "ROLLBACK").catch(() => {}); if (maint) await query(maint, "ROLLBACK").catch(() => {});
    if (pending) await Promise.allSettled([pending]); await f.close();
  }
});
