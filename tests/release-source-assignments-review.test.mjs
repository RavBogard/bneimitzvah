import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { RELEASE_BASE, sha, parseTarget } from '../scripts/release-migrate-support.mjs';
import { ROSTER_REFERENCE, validateRosterReference } from '../scripts/release-migrate-roster-support.mjs';
import { RECORDINGS_REFERENCE, validateRecordingsReference } from '../scripts/release-migrate-recordings-support.mjs';
import { SOURCE_ASSIGNMENTS_REFERENCE, validateSourceAssignmentsReference, checkSourceAssignmentsLedger, selectedSourceAssignmentsReference } from '../scripts/release-migrate-source-assignments-support.mjs';
import { executeSourceAssignmentsRelease, runSourceAssignmentsRelease } from '../scripts/release-migrate-source-assignments.mjs';

const json = path => JSON.parse(readFileSync(new URL('../' + path, import.meta.url)));
function source() {
  const reference = json('tests/fixtures/portal/release-migrate-reference.json'), roster = json(ROSTER_REFERENCE), recordings = json(RECORDINGS_REFERENCE), next = json(SOURCE_ASSIGNMENTS_REFERENCE);
  const migrations = Array.from({ length: 22 }, (_, index) => ({ index, hash: sha(`independent-LF-${index}`), historicalAllowed: [sha(`independent-LF-${index}`)], createdAt: 1000 + index }));
  migrations[19].hash = roster.migrationSHA256; migrations[20].hash = recordings.migrationSHA256; migrations[21].hash = next.migrationSHA256;
  const value = { migrations, reference, historicalFunctions: reference.historicalFunctions, studentAfter: validateRosterReference(roster, reference, roster.migrationSHA256), recheck() {} };
  value.recordingsAfter = validateRecordingsReference(recordings, value);
  value.sourceAssignmentsAfter = validateSourceAssignmentsReference(next, value);
  return value;
}
function target(s) {
  const url = new URL('postgresql://ep-synthetic.neon.tech/synthetic?sslmode=require'); url.username = 'release_owner'; url.password = 'synthetic-password';
  return parseTarget({ version: 1, migrationUrl: url.href, expected: { hostname: url.hostname, database: 'synthetic', owner: 'release_owner', ownerOid: '501', runtimeRole: 'release_runtime', serverMajor: 18, tenantId: 'crc', canonicalOrigin: 'https://beitmitzvah.centralreform.org' }, historicalPrefix: s.migrations.slice(0, 15).map((row, n) => ({ id: n + 1, hash: row.hash, createdAt: row.createdAt })), provenance: { sourceCommit: RELEASE_BASE, method: 'owner-readonly', observedAt: '2026-10-17T00:00:00.000Z' } }, s);
}
const ledger = (s, count) => s.migrations.slice(0, count).map((row, n) => ({ id: n + 1, hash: row.hash, created_at: String(row.createdAt) }));
function harness(options = {}) {
  const s = source(), t = target(s), queries = []; let count = options.already ? 22 : 21, calls = 0, ended = 0, reads = 0, checks = 0;
  const client = Object.assign(new EventEmitter(), {
    async connect() {}, async end() { ended++; },
    async query(text) {
      queries.push(text);
      if (text.includes('pg_try_advisory_lock')) return { rows: [{ locked: !options.locked }] };
      if (text.includes('pg_advisory_unlock')) return { rows: [{ unlocked: !options.unlockFailure }] };
      if (text.includes('FROM drizzle.__drizzle_migrations')) return { rows: ledger(s, count) };
      if (text.includes('SELECT NOT EXISTS')) return { rows: [{ clear: !options.nonempty }] };
      return { rows: [] };
    },
  });
  s.recheck = () => { checks++; if (options.sourceAt === checks) throw Error('Synthetic source drift'); };
  const predicates = {
    transport() { if (options.transport) throw Error('Synthetic transport failure'); },
    async identity() { if (options.identity) throw Error('Synthetic identity failure'); },
    async catalog() { if (options.catalog) throw Error('Synthetic catalog conflict'); return selectedSourceAssignmentsReference(s, t, count); },
    verifyCatalog(actual, expected) { assert.deepEqual(actual, expected); },
    async roles() { return ['unchanged-role-authority']; },
    async data() {
      reads++; if (options.idleError) client.emit('error', Error('Synthetic withheld provider failure'));
      return [{ name: 'student_recording', count: 1, digest: options.preDrift && reads === 2 || options.postDrift && count === 22 ? 'changed' : 'same' }];
    },
  };
  const migrate = async value => {
    assert.equal(value, client); calls++;
    if (options.beforeCommit) throw Error('Synthetic pre-ack failure');
    count = 22;
    if (options.lostAck) throw Error('Synthetic lost acknowledgement after committed DDL');
  };
  const run = (apply = true) => executeSourceAssignmentsRelease(s, t, { apply, checks: predicates, connect: () => client, migrate });
  return { s, t, client, queries, run, get count() { return count; }, get calls() { return calls; }, get ended() { return ended; } };
}

test('independent0021 source refusal happens before target file access, connection or migration capability', async () => {
  let targetReads = 0, connects = 0;
  const result = await runSourceAssignmentsRelease(['--expected-commit', 'a'.repeat(40), '--target', 'synthetic-private.json', '--apply'], { source() { throw Error('Synthetic private source failure'); }, readTarget() { targetReads++; }, execution: { connect() { connects++; throw 0; } } });
  assert.deepEqual(result, { ok: false, phase: 'source', outcome: 'not-started', apply: true }); assert.equal(targetReads, 0); assert.equal(connects, 0);
});

test('independent0021 ledger accepts exactly21 or22 and refuses tail identity/hash/order drift', () => {
  const s = source(), t = target(s); assert.equal(checkSourceAssignmentsLedger(ledger(s, 21), s, t).length, 21); assert.equal(checkSourceAssignmentsLedger(ledger(s, 22), s, t).length, 22);
  for (const bad of [ledger(s, 20), [...ledger(s, 22), { id: 23 }], ledger(s, 22).map((r, n) => n === 21 ? { ...r, hash: sha('other') } : r), ledger(s, 22).map((r, n) => n === 21 ? { ...r, id: 21 } : r), ledger(s, 22).map((r, n) => n === 21 ? { ...r, created_at: '1' } : r), ledger(s, 21).map((r, n) => n === 20 ? { ...r, hash: sha('other-old-migration') } : r)]) assert.throws(() => checkSourceAssignmentsLedger(bad, s, t));
});

test('independent0021 check/apply/already applied are closed single-migrator outcomes with cleanup', async () => {
  for (const [options, apply, outcome, calls] of [[{}, false, 'checked', 0], [{}, true, 'applied', 1], [{ already: true }, false, 'already-applied', 0], [{ already: true }, true, 'already-applied', 0]]) {
    const h = harness(options), result = await h.run(apply); assert.deepEqual(result, { ok: true, phase: 'complete', outcome, apply, ledgerRows: calls || options.already ? 22 : 21 }); assert.equal(h.calls, calls); assert.equal(h.ended, 1); assert.equal(h.client.listenerCount('error'), 0);
    assert.ok(h.queries.some(text => text.includes('pg_try_advisory_lock'))); assert.ok(h.queries.some(text => text.includes('pg_advisory_unlock')));
  }
});

test('independent0021 identity/transport/lock/catalog/source/data failures refuse before any DDL', async () => {
  for (const options of [{ transport: true }, { identity: true }, { locked: true }, { catalog: true }, { sourceAt: 1 }, { sourceAt: 2 }, { sourceAt: 3 }, { idleError: true }, { preDrift: true }]) {
    const h = harness(options), result = await h.run(); assert.equal(result.ok, false); assert.equal(result.outcome, 'not-started'); assert.equal(h.calls, 0); assert.equal(h.count, 21); assert.equal(h.ended, options.sourceAt === 1 ? 0 : 1); assert.equal(h.client.listenerCount('error'), 0); assert.doesNotMatch(JSON.stringify(result), /Synthetic|private|provider|password|queries/);
  }
});

test('independent0021 acknowledgement uncertainty remains unknown even when fake DDL actually committed', async () => {
  for (const options of [{ beforeCommit: true }, { lostAck: true }]) {
    const h = harness(options), result = await h.run(); assert.deepEqual(result, { ok: false, phase: 'migration', outcome: 'unknown', apply: true }); assert.equal(h.calls, 1); assert.equal(h.count, options.lostAck ? 22 : 21); assert.equal(h.ended, 1);
  }
});

test('independent0021 postcommit verification conflict never pretends to roll back committed migration', async () => {
  for (const options of [{ postDrift: true }, { nonempty: true }, { sourceAt: 4 }]) {
    const h = harness(options), result = await h.run(); assert.equal(result.ok, false); assert.equal(result.outcome, 'committed-verification-conflict'); assert.equal(h.calls, 1); assert.equal(h.count, 22); assert.equal(h.ended, 1);
  }
});

test('independent0021 unlock failure preserves applied outcome but never returns successful release', async () => {
  const h = harness({ unlockFailure: true }), result = await h.run(); assert.deepEqual(result, { ok: false, phase: 'cleanup', outcome: 'applied', apply: true }); assert.equal(h.calls, 1); assert.equal(h.count, 22); assert.equal(h.ended, 1); assert.equal(h.client.listenerCount('error'), 0);
});

test('independent0021 exact catalog delta rejects authority/data-shape changes outside the additive contract', () => {
  const s = source(), reference = json(SOURCE_ASSIGNMENTS_REFERENCE); assert.ok(validateSourceAssignmentsReference(reference, s));
  for (const mutate of [r => { r.extra = true; }, r => { r.migrationSHA256 = sha('wrong-migration'); }, r => { r.after.tables.find(t => t.name === 'verse_source_assignment').force_rls = false; }, r => { r.after.functions[0].security_definer = true; }, r => { r.after.types[0].owner = 'PUBLIC'; }, r => { r.after.tables.find(t => t.name === 'audit_event').constraints.find(c => c.name === 'audit_action_known').definition = 'CHECK (true)'; }]) {
    const bad = structuredClone(reference); mutate(bad); assert.throws(() => validateSourceAssignmentsReference(bad, s));
  }
});

test('independent0021 preserves exclusive historical-function selection without widening new migration hashes', () => {
  const s = source(), t = target(s), lf = selectedSourceAssignmentsReference(s, t, 22);
  const crlfHash = sha('independent-historical-CRLF2'); s.migrations[2].historicalAllowed.push(crlfHash); t.prefix[2].hash = crlfHash;
  const crlf = selectedSourceAssignmentsReference(s, t, 22); assert.deepEqual(lf.tables, crlf.tables); assert.deepEqual(lf.types, crlf.types);
  const historical = ledger(s, 22); historical[2].hash = crlfHash;
  assert.equal(checkSourceAssignmentsLedger(historical, s, t).length, 22);
  assert.throws(() => checkSourceAssignmentsLedger(historical.map((row, n) => n === 21 ? { ...row, hash: crlfHash } : row), s, t));
});
