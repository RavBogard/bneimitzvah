import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { isolatedEnv, isolationProblems, CLEARED } from "./helpers/isolatedEnv.mjs";

// Spelled in pieces so this file's own source does not look like a spawning test.
const CP = "node:child" + "_process";
const BUILD = "build" + "Fixture";

test("every test that starts another program takes its environment from isolatedEnv", async () => {
  const dir = fileURLToPath(new URL(".", import.meta.url));
  const bad = [];
  const files = await readdir(dir, { recursive: true });
  for (const f of files.filter(f => /\.test\.(?:mjs|[cm]?ts|tsx)$/.test(f))) {
    for (const p of isolationProblems(await readFile(join(dir, f), "utf8"))) bad.push(`${f}: ${p}`);
  }
  assert.deepEqual(bad, []);
});

test("isolationProblems catches a missing helper, a missing call, and a leaked process.env", () => {
  const ok = `import { execFile } from "${CP}";\nimport { isolatedEnv } from "./helpers/isolatedEnv.mjs";\nconst { env } = await isolatedEnv();`;
  assert.deepEqual(isolationProblems(ok), []);
  assert.deepEqual(isolationProblems(`import { spawn } from "${CP}";`), [
    "spawns a process but does not import ./helpers/isolatedEnv.mjs",
    "spawns a process but never calls isolatedEnv()",
  ]);
  assert.deepEqual(isolationProblems(`${ok}\nrun(x, { env: { ...process.env } });`), ["reads process.env; a spawned child must get isolatedEnv's env only"]);
  assert.deepEqual(isolationProblems(`await ${BUILD}(dir);`).length, 2);
  assert.deepEqual(isolationProblems("const x = process.env.HOME;"), [], "a file that spawns nothing is not this rule's business");
});

test("isolatedEnv: a temp home, config paths that do not exist, and no credentials", async () => {
  const saved = Object.fromEntries(CLEARED.map(k => [k, process.env[k]]));
  for (const k of CLEARED) process.env[k] = `leak-${k}`;
  try {
    const { env, home, cleanup } = await isolatedEnv({ EXTRA: "1" });
    try {
      assert.equal(env.HOME, home);
      assert.equal(env.USERPROFILE, home);
      assert.ok(env.HAFTARAH_DROPBOX_CONFIG.startsWith(home));
      assert.ok(env.HAFTARAH_WEB_CONFIG.startsWith(home));
      for (const k of CLEARED) assert.equal(env[k], undefined, k);
      assert.equal(env.NODE_OPTIONS, undefined, "parent Node hooks cannot run inside the child");
      assert.equal(env.GIT_CONFIG_GLOBAL, undefined, "parent git configuration is not inherited");
      assert.ok(!JSON.stringify(env).includes("leak-"));
      assert.equal(env.EXTRA, "1");
      assert.ok(env.PATH || env.Path, "PATH is kept so node can start");
    } finally { await cleanup(); }
  } finally {
    for (const [k, v] of Object.entries(saved)) { if (v == null) delete process.env[k]; else process.env[k] = v; }
  }
});
