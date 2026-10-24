import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { entryProblems, inspectRepository, repositoryGit } from "../scripts/repo-policy.mjs";
import { isolatedEnv } from "./helpers/isolatedEnv.mjs";

test("policy rejects prohibited filenames regardless of location and case", () => {
  for (const file of ["recording.MP3", "trope/cells/model.safetensors", ".env.local", "nested/.env.example", "auth.local.json", "server.pem", "id_ed25519", "family.csv"]) {
    assert.ok(entryProblems(file).length > 0, file);
  }
  assert.deepEqual(entryProblems(".env.example", "# names only\nDATABASE_URL=\n"), []);
  assert.ok(entryProblems(".env.example", "BETTER_AUTH_SECRET=" + "filled-value").length > 0);
});

test("private chant-benchmark records are rejected even under the engine and fixture allow-lists", () => {
  for (const schema of ["chant-human-alignment/v1", "chant-human-retime-map/v1", "chant-benchmark-run/v1", "chant-listening-key/v1", "chant-benchmark-identity/v1", "chant-benchmark-pack/v1"]) {
    for (const file of ["trope/private.json", "tests/fixtures/trope/private.json"]) assert.ok(entryProblems(file, `{
  "schema": "${schema}"
}`).includes("private chant-benchmark record"), `${file} ${schema}`);
  }
  assert.deepEqual(entryProblems("trope/human-alignment.mjs", 'export const ALIGNMENT_SCHEMA = "chant-human-alignment/v1";'), []);
});

test("private reference-index JSON is rejected through allow-lists, escaped keys, arrays, BOM and source extensions", () => {
  const record = { schema: "pockettorah-verse-index/v1", recordings: [] };
  const variants = [JSON.stringify(record), JSON.stringify({ nested: [record] }), '\uFEFF' + JSON.stringify(record), '{"sch\\u0065ma":"pockettorah-verse-index\\/v1","recordings":[]}'];
  for (const file of ["trope/synthetic.json", "tests/fixtures/trope/synthetic.json", "tests/fixtures/portal/synthetic.json", "src/synthetic.ts"]) {
    for (const content of variants) assert.ok(entryProblems(file, content).includes("private reference-audio index"), file);
  }
  assert.ok(entryProblems("tests/fixtures/portal/synthetic.jsonl", 'not JSON\n' + JSON.stringify(record)).includes("private reference-audio index"));
  assert.ok(entryProblems("tests/fixtures/portal/synthetic.json", '{"schema":"pockettorah-verse-index/v1",').includes("private reference-audio index"));
  // v2 (refined word boundaries) carries the same source text and is equally private.
  const v2 = { schema: "pockettorah-verse-index/v2", recordings: [] };
  for (const file of ["trope/synthetic.json", "tests/fixtures/portal/synthetic.json", "src/synthetic.ts"]) {
    for (const content of [JSON.stringify(v2), JSON.stringify({ nested: [v2] }), '﻿' + JSON.stringify(v2)]) assert.ok(entryProblems(file, content).includes("private reference-audio index"), `${file} v2`);
  }
  assert.ok(entryProblems("tests/fixtures/portal/synthetic.json", '{"schema":"pockettorah-verse-index/v2",').includes("private reference-audio index"));
  assert.deepEqual(entryProblems("scripts/reference-synthetic.mjs", 'export const INDEX_SCHEMA_V2 = "pockettorah-verse-index/v2";'), []);
});

test("public source strings naming the reference-index schema are code rather than private records", () => {
  for (const source of ['export const INDEX_SCHEMA = "pockettorah-verse-index/v1";', 'const synthetic = { schema: "pockettorah-verse-index/v1", recordings: [] };', 'const example = \'{"schema":"pockettorah-verse-index/v1"}\';', '// {"schema":"pockettorah-verse-index/v1"}\nexport {};']) {
    assert.deepEqual(entryProblems("scripts/reference-synthetic.mjs", source), []);
  }
  assert.deepEqual(entryProblems("tests/fixtures/portal/synthetic.json", JSON.stringify({ code: '{"schema":"pockettorah-verse-index/v1"}' })), []);
  assert.deepEqual(entryProblems("tests/fixtures/portal/synthetic.json", JSON.stringify({ schema: "reference-verse/v1" })), []);
});

test("staged reference-index JSON is rejected even after its working copy has been replaced with safe synthetic data", async () => {
  const isolation = await isolatedEnv(), root = await mkdtemp(join(tmpdir(), "portal-reference-policy-"));
  const git = (...args) => execFileSync("git", args, { cwd: root, env: isolation.env, stdio: "pipe" });
  try {
    git("init", "-b", "main"); await mkdir(join(root, "tests", "fixtures", "portal"), { recursive: true });
    const file = "tests/fixtures/portal/synthetic-reference.json";
    await writeFile(join(root, file), JSON.stringify({ schema: "pockettorah-verse-index/v1", recordings: [] })); git("add", file);
    await writeFile(join(root, file), '{"synthetic":true}');
    const result = await inspectRepository(root, isolation.env);
    assert.ok(result.findings.includes(`${file} (index): private reference-audio index`));
    assert.ok(!result.findings.includes(`${file}: private reference-audio index`));
  } finally { await rm(root, { recursive: true, force: true }); await isolation.cleanup(); }
});

test("reviewed config and synthetic fixture paths do not bypass content checks", () => {
  assert.deepEqual(entryProblems(".impeccable/config.json", '{"version":1}'), []);
  assert.deepEqual(entryProblems("tests/fixtures/portal/student.json", '{"email":"fixture@example.test"}'), []);
  const samples = [
    "vercel_blob_" + "rw_" + "syntheticToken",
    "GOC" + "SPX-" + "syntheticToken",
    "re_" + "x".repeat(24),
    "sk-" + "ant-" + "syntheticToken",
    "-----BEGIN " + "PRIVATE KEY-----",
    "postgresql://" + "fixture:synthetic-password" + "@" + "db.invalid/db",
    "BETTER_AUTH_SECRET=" + "synthetic-long-value",
    "person@" + "private.invalid",
    "THE " + "JPS TANAKH",
  ];
  for (const content of samples) {
    assert.ok(entryProblems("tests/fixtures/portal/data.json", content).length > 0, "sensitive synthetic fixture rejected");
  }
  assert.ok(entryProblems("src/leak.ts", samples[0]).includes("credential pattern"));
});

test("only the exact course data file is allowed, and never with fields derived from the private index", () => {
  const path = "src/lib/learn/lessons.json";
  const course = JSON.stringify({ schema: "learn-to-lein-course/v1", lessons: [{ id: "torah-sof-pasuk", examples: [{ ref: "Genesis 1:1", words: [3, 6] }] }] });
  assert.deepEqual(entryProblems(path, course), []);
  for (const neighbor of ["src/lib/learn/lessons-full.json", "src/lib/learn/other.json", "src/lib/learn/nested/lessons.json", "src/lessons.json"]) {
    assert.ok(entryProblems(neighbor, course).includes("data file outside reviewed allow-list"));
  }
  for (const field of ["alignScore", "recording", "indexWords"]) {
    assert.ok(entryProblems(path, JSON.stringify({ lessons: [{ examples: [{ [field]: 1 }] }] })).includes("private index field in course data"), field);
  }
  assert.ok(entryProblems(path, JSON.stringify({ notes: "C:/private/pockettorah/x" })).includes("private index field in course data"));
  assert.ok(entryProblems(path, JSON.stringify({ token: "vercel_blob_" + "rw_" + "syntheticMetadataToken" })).includes("credential pattern"));
});

test("the service course data files are allowed by exact path, with Hebrew only in the alphabet table and none in a congregation file", () => {
  const course = "src/lib/service-course/course.json", tenant = "src/lib/service-course/tenants/crc.json";
  const alef = String.fromCharCode(0x05d0), shma = [0x05e9, 0x05de, 0x05e2].map(code => String.fromCharCode(code)).join("");
  const clean = JSON.stringify({ schema: "service-course/v1", lessons: [{ id: "shma", title: "Sh’ma" }], alphabet: { letters: [{ id: "alef", name: "Alef", char: alef }] } });
  assert.deepEqual(entryProblems(course, clean), []);
  assert.deepEqual(entryProblems(tenant, JSON.stringify({ tenant: "crc", lessons: { shma: { teaching: { text: "A teaching in Latin letters.", approved: "2026-10-24" } } } })), []);
  // A prayer word outside the alphabet table is refused, as a value, a key, escaped, or shadowed by a duplicate key.
  for (const bad of [JSON.stringify({ lessons: [{ title: shma }], alphabet: {} }), JSON.stringify({ [shma]: 1, alphabet: {} }),
    `{"lessons":[{"title":"x"}],"alphabet":{},"note":"\\u05e9\\u05de\\u05e2"}`, `{"title":"${shma}","title":"x","alphabet":{}}`]) {
    assert.ok(entryProblems(course, bad).some(problem => /Hebrew|escaped/.test(problem)), bad.slice(0, 40));
  }
  for (const bad of [JSON.stringify({ lessons: { shma: { teaching: { text: shma } } } }), `{"text":"\\u05e9"}`, `{"text":"${shma}","text":"x"}`]) assert.ok(entryProblems(tenant, bad).some(problem => /Hebrew|escaped/.test(problem)), bad.slice(0, 40));
  assert.ok(entryProblems(course, "{not json").includes("service course data is not valid JSON"));
  for (const neighbor of ["src/lib/service-course/other.json", "src/lib/service-course/tenants/nested/crc.json", "src/lib/service-course/tenants/CRC.json", "src/service-course/course.json"]) {
    assert.ok(entryProblems(neighbor, clean).includes("data file outside reviewed allow-list"), neighbor);
  }
  assert.ok(entryProblems(course, JSON.stringify({ note: "The JPS Tanakh", alphabet: {} })).some(problem => /licensed-text/.test(problem)));
  assert.ok(entryProblems(tenant, JSON.stringify({ token: "vercel_blob_" + "rw_" + "syntheticMetadataToken" })).includes("credential pattern"));
});

test("no siddur build reaches the repo: not dist-app, not a feed by name, and not a feed's shape or a licensed lane inside an allowed data file (2.0 SC2)", () => {
  for (const path of ["dist-app/legacy-beit-mitzvah-feed.json", "nested/dist-app/books.json", "DIST-APP/x.md", "src/lib/service-course/shabbat-shacharit-feed.json", "tests/fixtures/portal/feeds.json", "x/legacy-beit-mitzvah-feed.json"]) {
    assert.ok(entryProblems(path, "{}").includes("siddur build artifact"), path);
  }
  const feed = JSON.stringify({ schemaVersion: 1, volume: "shabbat-shacharit", printing: {}, units: [], pageIndex: {} });
  for (const allowed of ["tests/fixtures/portal/synthetic.json", "trope/data/synthetic.json", "src/server/db/migrations/meta/0099_snapshot.json"]) {
    assert.ok(entryProblems(allowed, feed).includes("siddur feed content"), allowed);
    assert.ok(entryProblems(allowed, JSON.stringify({ source: { lane: "licensed" } })).includes("licensed siddur lane marker"), allowed);
    assert.ok(entryProblems(allowed, JSON.stringify({ sourceGitSha: "edfef85-LICENSED" })).includes("licensed siddur lane marker"), allowed);
    assert.ok(entryProblems(allowed, JSON.stringify({ laneWhy: "x" })).includes("licensed siddur lane marker"), allowed);
  }
  // Code that names the fields is code, not a feed; a lone pageIndex key is not a feed's shape.
  assert.ok(!entryProblems("src/server/service-course/public-feed.ts", `object(x, ["printing", "units", "pageIndex"])`).some(problem => /siddur/.test(problem)));
  assert.ok(!entryProblems("tests/fixtures/portal/synthetic.json", JSON.stringify({ pageIndex: 1 })).some(problem => /siddur/.test(problem)));
});

test("only exact design token metadata is allowed while credential, email and binary checks remain active", () => {
  const path = ".impeccable/design.json";
  const tokens = JSON.stringify({ colors: { paper: "#fffdf8", ink: "#252520" }, fonts: { body: "system-ui" }, tokens: { space: 8 } });
  assert.deepEqual(entryProblems(path, tokens), []);
  for (const neighbor of [".impeccable/design-backup.json", ".impeccable/other.json", ".impeccable/nested/design.json", "nested/.impeccable/design.json"]) {
    assert.ok(entryProblems(neighbor, tokens).includes("data file outside reviewed allow-list"));
  }
  assert.ok(entryProblems(path, JSON.stringify({ token: "vercel_blob_" + "rw_" + "syntheticMetadataToken" })).includes("credential pattern"));
  assert.ok(entryProblems(path, JSON.stringify({ contact: "person" + "@" + "private.invalid" })).includes("non-synthetic email address"));
  assert.ok(entryProblems(path, tokens + "\u0000").includes("unreviewed binary content"));
});

test("private remote attachment paths are prohibited independently of extension, content, case or separators", () => {
  for (const file of [".codex-remote-attachments", ".codex-remote-attachments/innocent.ts", ".codex-remote-attachments/image.jpg",
    "nested/.CODEX-REMOTE-ATTACHMENTS/allowed.md", "nested\\.codex-remote-attachments\\empty.svg"]) {
    for (const content of ["", "export {};", "\u0000synthetic"]) assert.deepEqual(entryProblems(file, content), ["private remote attachment directory"]);
  }
  assert.deepEqual(entryProblems("src/.codex-remote-attachments-example.ts", "export {};"), []);
});

test("private remote attachments remain local when ignored and are rejected when untracked or force indexed without echoing filenames", async () => {
  const { env, cleanup } = await isolatedEnv();
  const root = await mkdtemp(join(tmpdir(), "portal-attachment-policy-"));
  const git = (...args) => execFileSync("git", args, { cwd: root, env, stdio: "pipe" });
  const directory = ".codex-remote-attachments", filename = "synthetic-private-name.ts";
  try {
    git("init", "-b", "main");
    await writeFile(join(root, "README.md"), "Synthetic fixture repository\n");
    git("add", "README.md");
    await mkdir(join(root, directory));
    await writeFile(join(root, directory, filename), "export {};\n");
    const untracked = await inspectRepository(root, env);
    assert.ok(untracked.findings.includes("private remote attachment directory: prohibited publish candidate"));
    assert.ok(!JSON.stringify(untracked).includes(filename));
    await writeFile(join(root, ".gitignore"), `${directory}/\n`);
    git("add", ".gitignore");
    assert.deepEqual((await inspectRepository(root, env)).findings, [], "ignored private attachments remain on disk but aren't candidates");
    git("add", "-f", `${directory}/${filename}`);
    const forced = await inspectRepository(root, env);
    assert.ok(forced.findings.includes("private remote attachment directory (index): prohibited publish candidate"));
    assert.ok(!JSON.stringify(forced).includes(filename));
    await rm(join(root, directory, filename));
    const indexOnly = await inspectRepository(root, env);
    assert.ok(indexOnly.findings.includes("private remote attachment directory (index): prohibited publish candidate"));
    assert.ok(!JSON.stringify(indexOnly).includes(filename));
  } finally {
    await rm(root, { recursive: true, force: true });
    await cleanup();
  }
});

test("Markdown code delimiters do not turn Python decorators into email addresses", () => {
  assert.deepEqual(entryProblems("docs/research.md", "Use `@spaces.GPU` and `@spaces.GPU(duration=20)`."), []);
  assert.ok(entryProblems("docs/research.md", "Contact `person" + "@" + "private.invalid`.").includes("non-synthetic email address"));
  assert.deepEqual(entryProblems("tests/fixtures/portal/student.json", '{"email":"fixture@example.test"}'), []);
});

test("only named Drizzle metadata shapes are permitted and all content checks remain active", () => {
  const journal = { version: "7", dialect: "postgresql", entries: [] };
  const snapshot = { version: "7", dialect: "postgresql", id: "synthetic", prevId: "synthetic", tables: {} };
  const journalPath = "src/server/db/migrations/meta/_journal.json";
  const snapshotPath = "src/server/db/migrations/meta/0001_snapshot.json";
  assert.deepEqual(entryProblems(journalPath, JSON.stringify(journal)), []);
  assert.deepEqual(entryProblems(snapshotPath, JSON.stringify(snapshot)), []);
  for (const path of ["src/server/db/migrations/meta/students.json", "src/server/db/migrations/meta/nested/0001_snapshot.json", "src/server/db/migrations/0001_snapshot.json"]) {
    assert.ok(entryProblems(path, JSON.stringify(snapshot)).includes("data file outside reviewed allow-list"));
  }
  assert.ok(entryProblems(snapshotPath, '{"student":"synthetic"}').includes("invalid Drizzle migration metadata shape"));
  assert.ok(entryProblems(journalPath, "not JSON").includes("invalid Drizzle migration metadata shape"));
  const samples = [
    ["credential pattern", "vercel_blob_" + "rw_" + "syntheticMetadataToken"],
    ["non-synthetic email address", "person" + "@" + "private.invalid"],
    ["licensed-text publisher/version marker; manual licence review required", "THE " + "JPS TANAKH"],
  ];
  for (const [reason, content] of samples) {
    for (const [path, valid] of [[journalPath, journal], [snapshotPath, snapshot]]) {
      assert.ok(entryProblems(path, JSON.stringify({ ...valid, sensitive: content })).includes(reason));
    }
  }
});

test("git integration detects untracked, force-staged ignored, and index-only sensitive files without echoing contents", async () => {
  const { env, cleanup } = await isolatedEnv();
  const root = await mkdtemp(join(tmpdir(), "portal-policy-"));
  const git = (...args) => execFileSync("git", args, { cwd: root, env, stdio: "pipe" });
  try {
    git("init", "-b", "main");
    await writeFile(join(root, ".gitignore"), ".env.local\n");
    await writeFile(join(root, "README.md"), "Synthetic fixture repository\n");
    git("add", "README.md", ".gitignore");
    assert.deepEqual((await inspectRepository(root, env)).findings, []);
    await writeFile(join(root, "untracked.csv"), "synthetic\n");
    assert.ok((await inspectRepository(root, env)).findings.some(x => x.startsWith("untracked.csv:")));
    await rm(join(root, "untracked.csv"));
    await writeFile(join(root, ".env.local"), "LOCAL_VALUE=synthetic\n");
    assert.deepEqual((await inspectRepository(root, env)).findings, [], "ignored local files aren't publish candidates");
    git("add", "-f", ".env.local");
    assert.ok((await inspectRepository(root, env)).findings.some(x => x.startsWith(".env.local")));
    git("rm", "--cached", ".env.local");
    const sentinel = "vercel_blob_" + "rw_" + "uniqueSyntheticSentinel";
    await writeFile(join(root, "staged.ts"), sentinel);
    git("add", "staged.ts");
    await writeFile(join(root, "staged.ts"), "export {};\n");
    const result = await inspectRepository(root, env);
    assert.ok(result.findings.includes("staged.ts (index): credential pattern"));
    assert.ok(!JSON.stringify(result).includes(sentinel), "diagnostics must not expose matching content");
  } finally {
    await rm(root, { recursive: true, force: true });
    await cleanup();
  }
});

test("git failure errors with sensitive arguments discard command output and original error details", async () => {
  const { env, cleanup } = await isolatedEnv();
  try {
    const sentinel = "synthetic-sensitive-invalid-object";
    await assert.rejects(
      repositoryGit(["cat-file", "blob", sentinel], { env, encoding: "utf8" }),
      error => {
        assert.equal(error.message, "Repository policy: git cat-file failed; output withheld");
        assert.equal(error.cause, undefined);
        assert.equal(error.stdout, undefined);
        assert.equal(error.stderr, undefined);
        assert.ok(!String(error.stack).includes(sentinel));
        return true;
      },
    );
  } finally { await cleanup(); }
});
