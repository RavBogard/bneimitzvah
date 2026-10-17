import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { recordingsReleaseFixture } from "../helpers/release-recordings-fixture.mjs";
import { query } from "./disposable.mjs";
import { sha } from "../../scripts/release-migrate-support.mjs";
import { executeRecordingsRelease, captureRecordingsData } from "../../scripts/release-migrate-recordings.mjs";

// Independent configured clients use only the existing strictly checked
// disposable loopback fixture. Production transport is never overridden by CLI.
test("independent0020 actualCRLF source change after snapshot refuses before DDL on the same configured client", { timeout: 120000 }, async () => {
  const fixture = await recordingsReleaseFixture({ crlfHistory: true });
  try {
    const path = join(fixture.folder, "0020_student_recording_ledger.sql"), bytes = await readFile(path);
    const source = { ...fixture.source, recheck() { assert.equal(sha(readFileSync(path)), fixture.source.migrations[20].hash); } };
    let snapshots = 0, migrated = 0;
    const result = await executeRecordingsRelease(source, fixture.target, {
      apply: true, connect: () => new pg.Client(fixture.target.connection),
      checks: { transport() {}, async data(client, names) {
        const value = await captureRecordingsData(client, names);
        if (++snapshots === 1) await writeFile(path, Buffer.concat([bytes, Buffer.from("\n-- Synthetic post-snapshot change\n")]));
        return value;
      } },
      async migrate(client) { migrated++; await fixture.operation(client); },
    });
    assert.deepEqual(result, { ok: false, phase: "preflight", outcome: "not-started", apply: true });
    assert.equal(snapshots, 1); assert.equal(migrated, 0);
    assert.equal((await query(fixture.owner, "SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations")).rows[0].count, 20);
    assert.equal((await query(fixture.owner, "SELECT to_regclass('public.student_recording') IS NULL AS absent")).rows[0].absent, true);
    await writeFile(path, bytes);
    assert.equal((await fixture.run()).outcome, "checked");
  } finally { await fixture.close(); }
});

test("independent0020 old intake writes roll back with late SQL failure; committed contact drift requires a fresh read without replay", { timeout: 120000 }, async () => {
  const fixture = await recordingsReleaseFixture({ crlfHistory: true });
  try {
    const names = fixture.source.reference.final.tables.map(table => table.name);
    const before = await captureRecordingsData(fixture.owner, names);
    const path = join(fixture.folder, "0020_student_recording_ledger.sql"), bytes = await readFile(path);
    // This deliberate fixture-only fault is inside the migrator's actual SQL
    // transaction. The public operator's source guard would refuse these bytes.
    await writeFile(path, Buffer.concat([bytes, Buffer.from("\n--> statement-breakpoint\nUPDATE public.student SET hebrew_name='Synthetic rollback', second_parent_email='rollback@example.test', import_metadata=jsonb_set(import_metadata,'{adminNotes}','\"Synthetic rollback\"'::jsonb);\n--> statement-breakpoint\nSELECT 1/0;\n")]));
    const failed = await fixture.run(true);
    assert.equal(failed.ok, false); assert.equal(failed.outcome, "unknown");
    assert.equal((await query(fixture.owner, "SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations")).rows[0].count, 20);
    assert.equal((await query(fixture.owner, "SELECT to_regclass('public.student_recording') IS NULL AS absent")).rows[0].absent, true);
    assert.deepEqual(await captureRecordingsData(fixture.owner, names), before);
    await writeFile(path, bytes);
    let calls = 0;
    const committed = await fixture.run(true, async client => {
      calls++; await fixture.operation(client);
      await query(client, "UPDATE public.student SET second_parent_email='changed@example.test'");
    });
    assert.deepEqual(committed, { ok: false, phase: "verification", outcome: "committed-verification-conflict", apply: true });
    assert.equal(calls, 1);
    assert.equal((await query(fixture.owner, "SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations")).rows[0].count, 21);
    const after = await captureRecordingsData(fixture.owner, names);
    assert.deepEqual(after.map(row => ({ name: row.name, count: row.count })), before.map(row => ({ name: row.name, count: row.count })));
    assert.notEqual(after.find(row => row.name === "student").digest, before.find(row => row.name === "student").digest);
    // A subsequent operator check reconciles current valid schema; it must
    // never replay a migration or claim that the earlier data drift rolled back.
    assert.deepEqual(await fixture.run(false, async () => { calls++; throw new Error("Synthetic forbidden replay"); }), { ok: true, phase: "complete", outcome: "already-applied", apply: false, ledgerRows: 21 });
    assert.equal(calls, 1);
  } finally { await fixture.close(); }
});
