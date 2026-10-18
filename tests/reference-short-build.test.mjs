import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile, readdir, mkdir, mkdtemp, realpath, lstat, rm, symlink } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, join, relative, basename } from "node:path";
import { tmpdir } from "node:os";
import { isolatedEnv } from "./helpers/isolatedEnv.mjs";
import { insideGitWorkingTree } from "../scripts/private-paths.mjs";
import { buildReferenceShort, shortBuildCompilerArgs, parseShortBuildSelectionSnapshot, prepareShortBuildOutputPath } from "../scripts/reference-short-build.mjs";

const ROOT = resolve("."), sha = value => createHash("sha256").update(value).digest("hex"), bytes = value => Buffer.from(JSON.stringify(value));
async function command(path, args, env) {
  try { return (await promisify(execFile)(path, args, { cwd: ROOT, env, windowsHide: true, timeout: 30000, maxBuffer: 512 * 1024, encoding: "buffer" })).stdout; }
  catch { throw new Error("Synthetic offline fixture command refused; details withheld"); }
}
async function files(folder) {
  const paths = []; async function walk(path) { for (const e of await readdir(path, { withFileTypes: true })) { const p = join(path, e.name); assert.equal(e.isSymbolicLink(), false); if (e.isDirectory()) await walk(p); else if (e.isFile()) paths.push(p); } }
  await walk(folder); return paths;
}
async function absent(path) { try { await lstat(path); return false; } catch (e) { return e.code === "ENOENT"; } }
async function resolverControlHome(parent) {
  await mkdir(parent, { recursive: true });
  return mkdtemp(join(parent, "reference-short-resolver-control-"));
}

const syntheticToolsPath = process.argv.length === 4 && process.argv[2] === "--synthetic-tools" ? process.argv[3] : null;
if (process.argv.length > 2 && !syntheticToolsPath) throw new Error("Unsupported synthetic proof selection");

test("offline compiler arguments retain genuine closure, strict checks and no emit escape", () => {
  const args = shortBuildCompilerArgs("code-only-output");
  for (const required of ["--strict", "--noEmitOnError", "--listFiles", "--listEmittedFiles", "node20", "node16", "src/server/reference-audio/short-source-build.ts", "src/lib/reference-audio/short-source-tags.ts", "src/server/reference-audio/short-source-body.ts"]) assert.equal(args.includes(required), true);
  assert.equal(args.includes("--noCheck"), false); assert.equal(args.includes("--paths"), false);
  const list = shortBuildCompilerArgs("unused", true); assert.equal(list.includes("--listFilesOnly"), true); assert.equal(list.includes("--outDir"), false);
});

test("exact empty source pins are accepted but empty executable tools remain refused", async () => {
  const home = await mkdtemp(join(tmpdir(), "short-build-empty-control-"));
  try {
    const empty = join(home, "empty-tool"); await writeFile(empty, "", { flag: "wx" });
    const paths = ["scripts/reference-short-build.mjs", "scripts/private-paths.mjs", "tests/helpers/isolatedEnv.mjs", "src/server/reference-audio/short-source-build.ts", "src/lib/reference-audio/short-source-tags.ts", "src/server/reference-audio/short-source-body.ts", "node_modules/server-only/empty.js"];
    const sourcePins = await Promise.all(paths.map(async path => ({ path, sha256: sha(await readFile(join(ROOT, path))) })));
    const tool = { path: empty, sha256: sha(Buffer.alloc(0)) }, config = { sourceCommit: "0".repeat(40), sourcePins, tools: { node: tool, compiler: tool, ffmpeg: tool, ffprobe: tool }, parentCatalog: {}, input: {}, audioRoot: home, outputDir: join(home, "out") };
    const result = await buildReferenceShort(config); assert.equal(result.ok, false); assert.equal(result.phase, "tool-pins"); assert.equal(result.code, "path");
    const bad = await buildReferenceShort({ ...config, sourcePins: sourcePins.map(p => p.path.endsWith("empty.js") ? { ...p, sha256: "0".repeat(64) } : p) });
    assert.equal(bad.code, "source-pin"); assert.equal(bad.phase, "source-pins");
    assert.equal(await absent(config.outputDir), true);
  } finally { assert.equal(await insideGitWorkingTree(home), false); assert.equal(await realpath(home), resolve(home)); await rm(home, { recursive: true }); }
});

test("selection parsing hashes the exact snapshot, not a separately checked pathname", () => {
  const value = { schema: "reference-short-build-input/v1", parentCatalogSHA256: "1".repeat(64), selections: [{ asset: "synthetic", ref: "synthetic" }] }, snapshot = bytes(value), expected = sha(snapshot);
  assert.deepEqual(parseShortBuildSelectionSnapshot(snapshot, expected, value.parentCatalogSHA256), value);
  const changed = bytes({ ...value, selections: [{ asset: "other", ref: "synthetic" }] });
  assert.throws(() => parseShortBuildSelectionSnapshot(changed, expected, value.parentCatalogSHA256), e => e.code === "input-pin");
  assert.throws(() => parseShortBuildSelectionSnapshot(snapshot, expected, "2".repeat(64)), e => e.code === "selection");
});

test("output lexical junction ancestors are refused before any output creation", async () => {
  const home = await mkdtemp(join(tmpdir(), "short-build-output-control-"));
  try {
    assert.equal(await insideGitWorkingTree(home), false); assert.equal(await realpath(home), resolve(home));
    const actual = join(home, "actual"), alias = join(home, "alias"); await mkdir(actual); await symlink(actual, alias, process.platform === "win32" ? "junction" : "dir");
    assert.equal(await prepareShortBuildOutputPath(join(actual, "new"), join(home, "audio")), join(actual, "new"));
    await assert.rejects(prepareShortBuildOutputPath(join(alias, "new"), join(home, "audio")), e => e.code === "path");
    assert.equal(await absent(join(actual, "new")), true);
  } finally { await rm(home, { recursive: true }); }
});

test("resolver control creates its missing code-only parent on a clean checkout", async () => {
  const iso = await isolatedEnv({ CI: "1" });
  try {
    const parent = join(iso.home, "absent-local-logs"); assert.equal(await absent(parent), true);
    const home = await resolverControlHome(parent);
    assert.equal(await realpath(home), resolve(home)); assert.equal((await lstat(home)).isDirectory(), true);
    assert.deepEqual(await readdir(home), []);
    await rm(home, { recursive: true }); assert.equal(await absent(home), true);
  } finally { await iso.cleanup(); }
});

test("actual react-server importer resolution rejects a nearer server-only shadow before evaluation", async () => {
  const iso = await isolatedEnv({ CI: "1" }), home = await resolverControlHome(join(ROOT, ".local-logs"));
  try {
    const expected = { emptyFile: await realpath(join(ROOT, "node_modules/server-only/empty.js")), packageFile: await realpath(join(ROOT, "node_modules/server-only/package.json")) };
    expected.emptySHA256 = sha(await readFile(expected.emptyFile)); expected.packageSHA256 = sha(await readFile(expected.packageFile));
    const importer = join(home, "module.js"), marker = join(home, "must-not-exist"); await writeFile(importer, "// code-only importer", { flag: "wx" });
    const script = `import{verifyShortBuildServerOnly}from${JSON.stringify(new URL("../scripts/reference-short-build.mjs", import.meta.url).href)};try{await verifyShortBuildServerOnly([${JSON.stringify(importer)}],${JSON.stringify(expected)});console.log('accepted')}catch{console.log('refused')}`;
    const run = () => command(process.execPath, ["--conditions=react-server", "--input-type=module", "-e", script], iso.env);
    assert.equal((await run()).toString().trim(), "accepted");
    const shadow = join(home, "node_modules/server-only"); await mkdir(shadow, { recursive: true });
    await writeFile(join(shadow, "package.json"), JSON.stringify({ name: "server-only", exports: { "react-server": "./empty.js", default: "./empty.js" } }), { flag: "wx" });
    await writeFile(join(shadow, "empty.js"), `require('node:fs').writeFileSync(${JSON.stringify(marker)},'executed')`, { flag: "wx" });
    assert.equal((await run()).toString().trim(), "refused"); assert.equal(await absent(marker), true);
    await rm(join(home, "node_modules"), { recursive: true });
    const wrong = { ...expected, packageSHA256: "0".repeat(64) }, mismatch = script.replace(JSON.stringify(expected), JSON.stringify(wrong));
    assert.equal((await command(process.execPath, ["--conditions=react-server", "--input-type=module", "-e", mismatch], iso.env)).toString().trim(), "refused");
  } finally { assert.equal(await realpath(home), resolve(home)); await rm(home, { recursive: true }); await iso.cleanup(); }
});

test("finite synthetic offline batch proves reproducible tagged mono/stereo cuts, real body receipts and fail-closed paths/pins/capacity", { timeout: 240000, skip: syntheticToolsPath ? false : "explicit pinned synthetic tools required; no codec proof in ordinary npm test" }, async () => {
  const iso = await isolatedEnv({ CI: "1" }); let home;
  const aggregate = { syntheticOnly: true, realCorpusRead: false, publication: false, cleanup: false };
  try {
    home = await mkdtemp(join(tmpdir(), "reference-short-builder-fixture-")); assert.equal(await insideGitWorkingTree(home), false); const physical = await realpath(home); assert.equal(physical, resolve(home));
    assert.equal(await insideGitWorkingTree(syntheticToolsPath), false);
    const tools = JSON.parse(await readFile(syntheticToolsPath, "utf8"));
    assert.deepEqual(Object.keys(tools).sort(), ["compiler", "ffmpeg", "ffprobe", "node"]);
    for (const t of Object.values(tools)) { assert.deepEqual(Object.keys(t).sort(), ["path", "sha256"]); assert.equal(sha(await readFile(t.path)), t.sha256, "selected tool pin"); }
    const compilerList = (await command(tools.compiler.path, shortBuildCompilerArgs("", true), iso.env)).toString().split(/\r?\n/).filter(path => /^[A-Za-z]:[\\/]|^\//.test(path));
    const pinPaths = new Set([...compilerList, ...["scripts/reference-short-build.mjs", "scripts/private-paths.mjs", "tests/helpers/isolatedEnv.mjs"].map(path => join(ROOT, path))].map(path => resolve(path)));
    for (const folder of ["typescript", `@typescript/typescript-${process.platform}-${process.arch}`, "server-only"]) for (const path of await files(join(ROOT, "node_modules", folder))) pinPaths.add(resolve(path));
    const sourcePins = await Promise.all([...pinPaths].sort().map(async path => ({ path: relative(ROOT, path).replaceAll("\\", "/"), sha256: sha(await readFile(path)) })));
    const sourceCommit = (await command("git", ["rev-parse", "HEAD"], iso.env)).toString().trim();
    const audioRoot = join(home, "audio"); await mkdir(audioRoot); const assets = [];
    const attribution = { title: "PocketTorah Audio Files", creator: "not-a-box media lab", license: "CC BY-SA 3.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0/", changes: "Cut into single verses with computed word timings." };
    for (const [i, rate, channels, duration] of [[0, 24000, 1, 4], [1, 44100, 2, 5]]) {
      const name = `Synthetic-${i}.mp3`, path = join(audioRoot, name);
      await command(tools.ffmpeg.path, ["-v", "error", "-n", "-f", "lavfi", "-i", `sine=frequency=${440 + i * 220}:sample_rate=${rate}:duration=${duration}`, "-ac", String(channels), "-c:a", "libmp3lame", "-b:a", "64k", "-write_xing", "1", path], iso.env);
      const body = await readFile(path), id = `ra_${String(i + 1).repeat(32)}`, clip = i ? { start: 1.00002, end: 3.00001 } : { start: .50002, end: 2.00001 };
      assets.push({ id, archiveFile: name, sha256: sha(body), bytes: body.length, verses: [{ schema: "reference-verse/v1", ref: `Genesis 1:${i + 1}`, table: "torah", playback: { status: "ready", asset: id, clip }, words: { status: "unavailable", reason: "no-words" }, attribution }] });
    }
    const catalog = { schema: "reference-catalog/v1", source: "PockettorahAudioFiles", assets }, parentPath = join(home, "catalog.json"), inputPath = join(home, "input.json"), catalogBytes = bytes(catalog);
    await writeFile(parentPath, catalogBytes, { flag: "wx" });
    const selection = { schema: "reference-short-build-input/v1", parentCatalogSHA256: sha(catalogBytes), selections: assets.map(a => ({ asset: a.id, ref: a.verses[0].ref })) };
    const selectionBytes = bytes(selection); await writeFile(inputPath, selectionBytes, { flag: "wx" });
    const config = { sourceCommit, sourcePins, tools, parentCatalog: { path: parentPath, sha256: sha(catalogBytes) }, input: { path: inputPath, sha256: sha(selectionBytes) }, audioRoot, outputDir: join(home, "first") };
    const first = await buildReferenceShort(config); assert.equal(first.ok, true, JSON.stringify(first)); assert.equal(first.cuts, 2); assert.equal(first.inputsAndSourcePreserved, true); assert.deepEqual(first.cleanup, { work: true, runtime: true, home: true });
    const second = await buildReferenceShort({ ...config, outputDir: join(home, "second") }); assert.equal(second.ok, true, JSON.stringify(second)); assert.equal(first.manifestSHA256, second.manifestSHA256);
    const manifest = await readFile(join(home, "first/manifest.json")); assert.deepEqual(manifest, await readFile(join(home, "second/manifest.json")));
    const entries = JSON.parse(manifest).entries; for (const entry of entries) {
      assert.ok(entry.bytes <= 1024 * 1024); assert.equal(entry.codec, "mp3"); assert.equal(entry.bitrate, 64000);
      const body = await readFile(join(home, "first", `${entry.sha256}.mp3`)); assert.equal(sha(body), entry.sha256); assert.deepEqual(body, await readFile(join(home, "second", `${entry.sha256}.mp3`)));
    }
    const provenance = JSON.parse(await readFile(join(home, "first/private-provenance.json"))); assert.equal(provenance.bodyVerifiedCount, 2);
    aggregate.positive = { parents: first.parents, cuts: first.cuts, manifestSHA256: first.manifestSHA256, entries: entries.map(e => ({ sha256: e.sha256, bytes: e.bytes, rate: e.sampleRate, channels: e.channels, frames: e.presentationFrames })), tools, versions: provenance.versions, sourcePinCount: sourcePins.length, reproducible: true };
    const failures = [];
    for (const [name, change, expected] of [
      ["source", { sourcePins: sourcePins.map((p, i) => i ? p : { ...p, sha256: "0".repeat(64) }) }, "source-pin"],
      ["tool", { tools: { ...tools, ffmpeg: { ...tools.ffmpeg, sha256: "0".repeat(64) } } }, "tool-pin"],
      ["input", { parentCatalog: { ...config.parentCatalog, sha256: "0".repeat(64) } }, "input-pin"],
      ["git-output", { outputDir: join(ROOT, ".local-logs/forbidden-short-output") }, "path"],
      ["existing", { outputDir: config.outputDir }, "output-exists"],
    ]) { const result = await buildReferenceShort({ ...config, outputDir: join(home, `negative-${name}`), ...change }); assert.equal(result.ok, false); assert.equal(result.code, expected, JSON.stringify(result)); assert.deepEqual(result.cleanup, { work: true, runtime: true, home: true }); failures.push(expected); }
    assert.equal(await absent(join(ROOT, ".local-logs/forbidden-short-output")), true);
    const overrun = structuredClone(catalog); overrun.assets[0].verses[0].playback.clip.end = 96001 / 24000; assert.equal(Math.ceil(overrun.assets[0].verses[0].playback.clip.end * 24000), 96001);
    const badParent = join(home, "overrun-catalog.json"), badInput = join(home, "overrun-input.json"), badBytes = bytes(overrun); await writeFile(badParent, badBytes, { flag: "wx" });
    const badSelection = { ...selection, parentCatalogSHA256: sha(badBytes), selections: selection.selections.slice(0, 1) }, badSelectionBytes = bytes(badSelection); await writeFile(badInput, badSelectionBytes, { flag: "wx" });
    const held = await buildReferenceShort({ ...config, parentCatalog: { path: badParent, sha256: sha(badBytes) }, input: { path: badInput, sha256: sha(badSelectionBytes) }, outputDir: join(home, "overrun") });
    assert.equal(held.ok, false); assert.equal(held.code, "capacity", JSON.stringify(held)); assert.equal(await absent(join(home, "overrun/manifest.json")), true); assert.deepEqual(held.cleanup, { work: true, runtime: true, home: true });
    for (const a of assets) assert.equal(sha(await readFile(join(audioRoot, a.archiveFile))), a.sha256);
    aggregate.negative = { refused: [...failures, "capacity"], noOverrunManifest: true, originalsPreserved: true };
  } finally {
    if (home) { assert.equal(await insideGitWorkingTree(home), false); assert.equal(await realpath(home), resolve(home)); await rm(home, { recursive: true }); assert.equal(await absent(home), true); }
    await iso.cleanup(); aggregate.cleanup = true;
    await writeFile(join(ROOT, ".local-logs/reference-short-build-synthetic-v2-result.json"), JSON.stringify(aggregate, null, 2) + "\n", { flag: "wx" });
  }
});
