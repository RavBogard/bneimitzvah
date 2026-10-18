import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import pg from 'pg';
import { sourceAssignmentsReleaseFixture } from '../helpers/release-source-assignments-fixture.mjs';
import { query } from './disposable.mjs';
import { sha } from '../../scripts/release-migrate-support.mjs';
import { executeSourceAssignmentsRelease, captureSourceAssignmentsData } from '../../scripts/release-migrate-source-assignments.mjs';
import { RELEASE_LOCK } from '../../scripts/release-migrate.mjs';

const ledgerCount = async f => (await query(f.owner, 'SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations')).rows[0].count;
const absent = async f => (await query(f.owner, "SELECT to_regclass('public.verse_source_assignment') IS NULL AS absent")).rows[0].absent;
async function existingNames(f) { const names = (await query(f.owner, "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows.map(row => row.tablename); assert.ok(names.includes('student_recording')); return names; }

test('independent0021 actual transport and role identity refusal plus changed source stop before DDL', { timeout: 120000 }, async () => {
  const f = await sourceAssignmentsReleaseFixture({ crlfHistory: true });
  try {
    let migrated = 0;
    const transport = await executeSourceAssignmentsRelease(f.source, f.target, { apply: true, connect: () => new pg.Client(f.target.connection), migrate: async () => { migrated++; } });
    assert.equal(transport.ok, false); assert.equal(transport.phase, 'connection'); assert.equal(transport.outcome, 'not-started'); assert.equal(migrated, 0);
    // This existing disposable helper creates owner/runtime logins with the
    // same synthetic password; the runtime login must not impersonate owner.
    const role = await executeSourceAssignmentsRelease(f.source, f.target, { apply: true, connect: () => new pg.Client({ ...f.target.connection, user: f.target.expected.runtimeRole }), checks: { transport() {} }, migrate: async () => { migrated++; } });
    assert.equal(role.ok, false); assert.equal(role.phase, 'preflight'); assert.equal(role.outcome, 'not-started'); assert.equal(migrated, 0);
    const path = join(f.folder, '0021_verse_source_assignments.sql'), bytes = await readFile(path);
    let snapshots = 0;
    const source = { ...f.source, recheck() { assert.equal(sha(readFileSync(path)), f.source.migrations[21].hash); } };
    try {
      const changed = await executeSourceAssignmentsRelease(source, f.target, { apply: true, connect: () => new pg.Client(f.target.connection), checks: { transport() {}, async data(client, names) { const value = await captureSourceAssignmentsData(client, names); if (++snapshots === 1) await writeFile(path, Buffer.concat([bytes, Buffer.from('\n-- Synthetic changed private fixture\n')])); return value; } }, migrate: async () => { migrated++; } });
      assert.deepEqual(changed, { ok: false, phase: 'preflight', outcome: 'not-started', apply: true }); assert.equal(snapshots, 1); assert.equal(migrated, 0);
    } finally { await writeFile(path, bytes); }
    assert.equal(await ledgerCount(f), 21); assert.equal(await absent(f), true);
  } finally { await f.close(); }
});

test('independent0021 native check/advisory exclusion/apply/already keep old rows and use exactly one migration', { timeout: 120000 }, async () => {
  const f = await sourceAssignmentsReleaseFixture({ crlfHistory: true });
  try {
    const names = await existingNames(f), before = await captureSourceAssignmentsData(f.owner, names);
    let migrated = 0; const operation = async client => { migrated++; await f.operation(client); };
    assert.deepEqual(await f.run(false, operation), { ok: true, phase: 'complete', outcome: 'checked', apply: false, ledgerRows: 21 }); assert.equal(migrated, 0);
    assert.equal((await query(f.owner, 'SELECT pg_try_advisory_lock($1,$2) AS locked', RELEASE_LOCK)).rows[0].locked, true);
    try { const blocked = await f.run(true, operation); assert.equal(blocked.ok, false); assert.equal(blocked.phase, 'lock'); assert.equal(blocked.outcome, 'not-started'); assert.equal(migrated, 0); }
    finally { assert.equal((await query(f.owner, 'SELECT pg_advisory_unlock($1,$2) AS unlocked', RELEASE_LOCK)).rows[0].unlocked, true); }
    assert.deepEqual(await f.run(true, operation), { ok: true, phase: 'complete', outcome: 'applied', apply: true, ledgerRows: 22 });
    assert.deepEqual(await f.run(false, operation), { ok: true, phase: 'complete', outcome: 'already-applied', apply: false, ledgerRows: 22 });
    assert.deepEqual(await f.run(true, operation), { ok: true, phase: 'complete', outcome: 'already-applied', apply: true, ledgerRows: 22 }); assert.equal(migrated, 1);
    assert.deepEqual(await captureSourceAssignmentsData(f.owner, names), before); assert.equal(await ledgerCount(f), 22); assert.equal(await absent(f), false);
    assert.equal((await query(f.owner, 'SELECT NOT EXISTS(SELECT 1 FROM verse_source_assignment) AS clear')).rows[0].clear, true);
  } finally { await f.close(); }
});

test('independent0021 actual rollback and lost COMMIT acknowledgement remain distinct unknown states, reconciled read-only', { timeout: 120000 }, async () => {
  const f = await sourceAssignmentsReleaseFixture({ crlfHistory: true });
  try {
    const names = await existingNames(f), before = await captureSourceAssignmentsData(f.owner, names);
    const path = join(f.folder, '0021_verse_source_assignments.sql'), bytes = await readFile(path);
    // Deliberate fixture-only injected SQL; actual CLI source guard refuses these bytes.
    await writeFile(path, Buffer.concat([bytes, Buffer.from('\n--> statement-breakpoint\nUPDATE public.student SET hebrew_name=\'Synthetic rollback\';\n--> statement-breakpoint\nSELECT 1/0;\n')]));
    const failed = await f.run(true); assert.equal(failed.ok, false); assert.equal(failed.outcome, 'unknown');
    assert.equal(await ledgerCount(f), 21); assert.equal(await absent(f), true); assert.deepEqual(await captureSourceAssignmentsData(f.owner, names), before);
    await writeFile(path, bytes);
    let migrated = 0;
    const unknown = await f.run(true, async client => { migrated++; await f.operation(client); throw Error('Synthetic lost acknowledgement after committed migration'); });
    assert.deepEqual(unknown, { ok: false, phase: 'migration', outcome: 'unknown', apply: true }); assert.equal(migrated, 1); assert.equal(await ledgerCount(f), 22); assert.equal(await absent(f), false); assert.deepEqual(await captureSourceAssignmentsData(f.owner, names), before);
    const reconciled = await f.run(false, async () => { migrated++; throw Error('Synthetic forbidden retry'); }); assert.deepEqual(reconciled, { ok: true, phase: 'complete', outcome: 'already-applied', apply: false, ledgerRows: 22 }); assert.equal(migrated, 1);
  } finally { await f.close(); }
});

test('independent0021 postcommit old-row drift is a verification conflict, never rollback or migration retry', { timeout: 120000 }, async () => {
  const f = await sourceAssignmentsReleaseFixture({ crlfHistory: true });
  try {
    const names = await existingNames(f), before = await captureSourceAssignmentsData(f.owner, names); let migrated = 0;
    const result = await f.run(true, async client => { migrated++; await f.operation(client); await query(client, "UPDATE public.student SET hebrew_name='Synthetic committed drift'"); });
    assert.deepEqual(result, { ok: false, phase: 'verification', outcome: 'committed-verification-conflict', apply: true }); assert.equal(await ledgerCount(f), 22); assert.equal(await absent(f), false); assert.equal(migrated, 1);
    const after = await captureSourceAssignmentsData(f.owner, names);
    assert.notEqual(after.find(row => row.name === 'student').digest, before.find(row => row.name === 'student').digest);
    // This fresh check proves current schema/empty new table, NOT equality to
    // the preserved pre-apply rows or resolution of the earlier conflict.
    assert.deepEqual(await f.run(false, async () => { migrated++; throw Error('Synthetic forbidden replay'); }), { ok: true, phase: 'complete', outcome: 'already-applied', apply: false, ledgerRows: 22 }); assert.equal(migrated, 1);
    assert.deepEqual(await captureSourceAssignmentsData(f.owner, names), after);
  } finally { await f.close(); }
});
