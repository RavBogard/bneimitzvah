import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isolatedEnv } from './helpers/isolatedEnv.mjs';

test('alignment window overlap preserves every native frame once, including shifted inference', async () => {
  const { env, cleanup } = await isolatedEnv();
  try {
    execFileSync(process.platform === 'win32' ? 'python' : 'python3', ['-B', fileURLToPath(new URL('./shermet_alignment_test.py', import.meta.url))], { env, windowsHide: true, stdio: 'pipe' });
    execFileSync(process.platform === 'win32' ? 'python' : 'python3', ['-B', fileURLToPath(new URL('./shermet_word_rescue_test.py', import.meta.url))], { env, windowsHide: true, stdio: 'pipe' });
  } finally { await cleanup(); }
});
