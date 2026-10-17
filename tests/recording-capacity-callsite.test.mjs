import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';

// Narrow source tripwire for reviewed insertion paths, not SQL privilege control.
function bypass(path, text) {
  if (path === 'data/recordings.ts') return /export\s+async\s+function\s+insert\s*</.test(text);
  return (/\binsertWithId\b/.test(text) && path !== 'recordings/registration.ts')
    || /\.insert\s*\(\s*(?:\w+\.)?studentRecording\b|\bINSERT\s+INTO\s+"?student_recording\b/i.test(text);
}
test('recording INSERT application callsites stay behind the guarded registrar', async () => {
  const root = new URL('../src/server/', import.meta.url), problems = [];
  async function visit(base = '') {
    for (const entry of await readdir(new URL(base, root), { withFileTypes: true })) {
      const path = base + entry.name;
      if (entry.isDirectory()) await visit(path + '/');
      else if (path.endsWith('.ts') && bypass(path, await readFile(new URL(path, root), 'utf8'))) problems.push(path);
    }
  }
  await visit(); assert.deepEqual(problems, []);
  const registrar = await readFile(new URL('recordings/registration.ts', root), 'utf8');
  assert.equal((registrar.match(/data\.insertWithId\(/g) ?? []).length, 1);
  assert.equal((registrar.match(/admission\.mutex\(/g) ?? []).length, 2);
});
test('callsite tripwire rejects new helper, direct table and raw SQL bypasses without claiming to sandbox arbitrary SQL', () => {
  for (const source of ['await data.insertWithId(tx, actor, id, descriptor, instant)', 'tx.insert(s.studentRecording)', 'INSERT INTO student_recording (id) VALUES ($1)']) assert.equal(bypass('new-writer.ts', source), true);
  assert.equal(bypass('data/recordings.ts', 'export async function insert<Q>() {}'), true);
  assert.equal(bypass('recordings/registration.ts', 'await data.insertWithId(tx, actor, id, descriptor, instant)'), false);
});
