#!/usr/bin/env node
// Rebind the published short-source manifest to a new parent catalog whose verse clips are unchanged
// (catalog v2: refined word timings only). No audio is re-encoded: a short body depends only on its
// parent recording, clip geometry and recipe, never on word timings or the catalog hash.
//
//   node scripts/reference-short-manifest-rebind.mjs --config <private config.json>
//
// config: {oldCatalog, newCatalog, candidate, selection, outputDir} (all private paths outside every Git
// working tree). candidate is the published corpus candidate directory (manifest.json,
// private-provenance.json and the <sha256>.mp3 bodies); selection is its selection.json (capacity holds).
//
// Refuses unless: both catalogs have identical assets and identical verse playback (status, review, clip);
// the old manifest is bound to the old catalog; the corpus build's own worker, compiled from this checkout,
// plans the new manifest from the new catalog and the candidate's measured per-cut facts and verifies every
// candidate body against it; the new manifest equals the old one in every byte of every entry, differing
// only in parentCatalogSHA256; and every body file re-hashes to its name. Writes manifest.json and
// rebind-report.json to outputDir (exclusive create). Nothing is published.
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, mkdtemp, readdir, rm, lstat, realpath } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, join, resolve, basename } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { insideGitWorkingTree } from "./private-paths.mjs";
import { CORPUS_WORKER, CORPUS_CAPACITY, partitionCorpusSelection } from "./reference-short-corpus-build.mjs";
import { isolatedEnv } from "../tests/helpers/isolatedEnv.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), ".."), MiB = 1024 * 1024;
// The corpus build's pinned compiler (scripts/reference-short-corpus-build.mjs TOOL_PINS.compiler).
const COMPILER = Object.freeze({ path: "node_modules/@typescript/typescript-win32-x64/lib/tsc.exe", sha256: "f9ecfbdc93753d2c972d66a8d0d75f5bd737fd4a5f88b422d9091ea282bcb2c7" });
const sha = b => createHash("sha256").update(b).digest("hex");
const fail = code => { throw Object.assign(new Error("Manifest rebind refused"), { code }); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Same assets and same verse playback in both catalogs; only word timings may differ. Returns counts. */
export function compareCatalogGeometry(oldCatalog, newCatalog) {
  if (!Array.isArray(oldCatalog?.assets) || !Array.isArray(newCatalog?.assets) || oldCatalog.assets.length !== newCatalog.assets.length
    || oldCatalog.schema !== newCatalog.schema || oldCatalog.source !== newCatalog.source) fail("catalog-shape");
  let verses = 0, wordsChanged = 0;
  oldCatalog.assets.forEach((a, i) => {
    const b = newCatalog.assets[i];
    if (!b || a.id !== b.id || a.archiveFile !== b.archiveFile || a.sha256 !== b.sha256 || a.bytes !== b.bytes || a.verses.length !== b.verses.length) fail("catalog-asset");
    a.verses.forEach((v, j) => {
      const w = b.verses[j];
      if (!w || v.schema !== w.schema || v.ref !== w.ref || v.table !== w.table || !same(v.playback, w.playback) || !same(v.attribution, w.attribution)
        || v.words.status !== w.words.status || v.words.reason !== w.words.reason || v.words.readingTextSha256 !== w.words.readingTextSha256
        || (v.words.status === "ready" && v.words.starts.length !== w.words.starts.length)) fail("catalog-verse");
      verses++; if (!same(v.words, w.words)) wordsChanged++;
    });
  });
  return { assets: oldCatalog.assets.length, verses, wordsChanged };
}

/** The new manifest must equal the old in every entry; only the parent catalog binding changes. */
export function compareManifests(oldManifest, newManifest, { oldParent, newParent }) {
  if (oldManifest?.parentCatalogSHA256 !== oldParent || newManifest?.parentCatalogSHA256 !== newParent || oldParent === newParent) fail("manifest-parent");
  const strip = m => JSON.stringify({ ...m, parentCatalogSHA256: null });
  if (strip(oldManifest) !== strip(newManifest) || !Array.isArray(newManifest.entries)) fail("manifest-entries");
  return { entries: newManifest.entries.length };
}

async function privateFile(path, cap) {
  const p = resolve(path);
  if (await insideGitWorkingTree(p)) fail("path");
  const s = await lstat(p); if (!s.isFile() || s.isSymbolicLink() || s.size < 1 || s.size > cap) fail("path");
  return readFile(p);
}
function run(path, args, env, cap) {
  return new Promise((ok, no) => {
    const child = spawn(path, args, { cwd: ROOT, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const out = []; let n = 0, errors = 0;
    child.stdout.on("data", b => { n += b.length; if (n > cap) child.kill(); else out.push(b); });
    child.stderr.on("data", b => { errors += b.length; if (errors > 64 * 1024) child.kill(); });
    child.once("error", () => no(fail("child")));
    child.once("close", code => code === 0 && n <= cap ? ok(Buffer.concat(out)) : no(Object.assign(new Error("child"), { code: "child" })));
  });
}

export async function rebindShortManifest(config) {
  const keys = ["oldCatalog", "newCatalog", "candidate", "selection", "outputDir"];
  if (!config || Object.keys(config).length !== keys.length || keys.some(k => typeof config[k] !== "string")) fail("configuration");
  const out = resolve(config.outputDir), candidate = resolve(config.candidate);
  for (const p of [out, candidate, config.oldCatalog, config.newCatalog, config.selection]) if (await insideGitWorkingTree(resolve(p))) fail("path");
  try { await lstat(out); fail("output-exists"); } catch (e) { if (e?.code === "output-exists") throw e; if (e?.code !== "ENOENT") fail("path"); }
  const oldBytes = await privateFile(config.oldCatalog, 8 * MiB), newBytes = await privateFile(config.newCatalog, 8 * MiB);
  const oldParent = sha(oldBytes), newParent = sha(newBytes);
  const geometry = compareCatalogGeometry(JSON.parse(oldBytes), JSON.parse(newBytes));
  const oldManifestBytes = await privateFile(join(candidate, "manifest.json"), 8 * MiB), oldManifest = JSON.parse(oldManifestBytes);
  if (oldManifest.parentCatalogSHA256 !== oldParent) fail("manifest-parent");
  const provenance = JSON.parse(await privateFile(join(candidate, "private-provenance.json"), 32 * MiB));
  const selection = JSON.parse(await privateFile(config.selection, 8 * MiB));
  if (provenance.parentCatalogSHA256 !== oldParent || provenance.manifestSHA256 !== sha(oldManifestBytes) || selection.parentCatalogSHA256 !== oldParent
    || !Array.isArray(provenance.cuts) || provenance.cuts.length !== CORPUS_CAPACITY.selectedCuts || !Array.isArray(selection.held)) fail("provenance");

  // Every body in the candidate re-hashes to its own name; the set is exactly the provenance's bodies.
  const names = (await readdir(candidate)).sort(), bodies = names.filter(n => n.endsWith(".mp3"));
  if (names.length !== bodies.length + 2 || !names.includes("manifest.json") || !names.includes("private-provenance.json")) fail("body-set");
  const bodyHashes = new Set();
  for (const name of bodies) {
    const bytes = await privateFile(join(candidate, name), MiB);
    if (`${sha(bytes)}.mp3` !== name) fail("body-hash");
    bodyHashes.add(sha(bytes));
  }
  const cutHashes = provenance.cuts.map(c => c.body?.sha256);
  if (bodyHashes.size !== cutHashes.length || cutHashes.some(h => !bodyHashes.has(h)) || provenance.cuts.some(c => resolve(c.body.path) !== join(candidate, `${c.body.sha256}.mp3`))) fail("body-set");

  // Plan and verify with the corpus build's own worker, compiled from this checkout by the pinned compiler.
  const compiler = join(ROOT, COMPILER.path);
  if (sha(await readFile(compiler)) !== COMPILER.sha256) fail("tool");
  const { shortBuildCompilerArgs } = await import(pathToFileURL(join(ROOT, "scripts/reference-short-build.mjs")).href);
  const iso = await isolatedEnv({ CI: "1" });
  let runtime, work;
  try {
    await mkdir(join(ROOT, ".local-logs"), { recursive: true });
    const logs = await lstat(join(ROOT, ".local-logs"));
    if (logs.isSymbolicLink() || !logs.isDirectory() || await realpath(join(ROOT, ".local-logs")) !== join(ROOT, ".local-logs")) fail("path");
    runtime = await mkdtemp(join(ROOT, ".local-logs/rebind-runtime-"));
    await run(compiler, shortBuildCompilerArgs(runtime), iso.env, 4 * MiB);
    await mkdir(out, { mode: 0o700 });
    work = await mkdtemp(join(out, ".work-"));
    const parentSnapshot = join(work, "parent.json");
    await writeFile(parentSnapshot, newBytes, { flag: "wx", mode: 0o600 });
    const empty = await realpath(join(ROOT, "node_modules/server-only/empty.js")), pkg = await realpath(join(ROOT, "node_modules/server-only/package.json"));
    const serverOnly = { emptyFile: empty, packageFile: pkg, emptySHA256: sha(await readFile(empty)), packageSHA256: sha(await readFile(pkg)) };
    const cliURL = pathToFileURL(join(ROOT, "scripts/reference-short-build.mjs")).href;
    let calls = 0;
    const worker = async value => {
      const path = join(work, `request-${calls++}.json`);
      await writeFile(path, JSON.stringify({ ...value, compiled: runtime, parent: parentSnapshot, parentSHA: newParent, cliURL, serverOnly }), { flag: "wx", mode: 0o600 });
      return JSON.parse((await run(process.execPath, ["--conditions=react-server", "--input-type=module", "-e", CORPUS_WORKER, path], iso.env, 16 * MiB)).toString());
    };
    const selected = await worker({ mode: "select" });
    const counts = { parents: selected.parents, entries: selected.entries, selected: selected.selected.length, ambiguousRefs: selected.ambiguousRefs, ambiguousReadyEntries: selected.ambiguousReadyEntries, timingHolds: selected.timingHolds };
    if (!same(counts, { parents: 431, entries: 7073, selected: CORPUS_CAPACITY.originalUniqueReadyCuts, ambiguousRefs: 22, ambiguousReadyEntries: 44, timingHolds: 36 })) fail("coverage");
    const partition = partitionCorpusSelection(selected.selected, selection.held);
    if (partition.selected.length !== CORPUS_CAPACITY.selectedCuts || partition.held.length !== CORPUS_CAPACITY.capacityHeld) fail("coverage");
    // Each cut's measured fact must describe exactly the clip the new catalog selects.
    for (const c of provenance.cuts) { const r = partition.selected.find(x => x.asset === c.selection.asset && x.ref === c.selection.ref); if (!r || !same(c.selection, r) || !same(c.fact.clip, r.clip)) fail("cut-selection"); }
    const final = await worker({ mode: "final", rows: partition.selected, holds: partition.held, cuts: provenance.cuts });
    const manifestBytes = Buffer.from(final.manifestJSON);
    if (final.verified !== CORPUS_CAPACITY.selectedCuts || sha(manifestBytes) !== final.manifestSHA256) fail("candidate");
    const newManifest = JSON.parse(manifestBytes);
    const compared = compareManifests(oldManifest, newManifest, { oldParent, newParent });
    if (newManifest.entries.some(e => !bodyHashes.has(e.sha256))) fail("body-set");
    await writeFile(join(out, "manifest.json"), manifestBytes, { flag: "wx", mode: 0o600 });
    const report = { schema: "reference-short-manifest-rebind/v1", ok: true, oldCatalogSHA256: oldParent, newCatalogSHA256: newParent, newCatalogBytes: newBytes.length,
      oldManifestSHA256: sha(oldManifestBytes), newManifestSHA256: final.manifestSHA256, newManifestBytes: manifestBytes.length, entries: compared.entries,
      bodiesVerified: final.verified, bodiesRehashed: bodyHashes.size, entriesIdenticalExceptParent: true, catalog: geometry, capacityHeld: partition.held.length, publication: false };
    await writeFile(join(out, "rebind-report.json"), JSON.stringify(report, null, 1) + "\n", { flag: "wx", mode: 0o600 });
    return report;
  } finally {
    // Remove only real directories directly inside their expected parents (no links, no escapes).
    for (const [path, parent] of [[runtime, join(ROOT, ".local-logs")], [work, out]]) {
      if (!path) continue;
      const s = await lstat(path), real = await realpath(path), home = await realpath(parent);
      if (s.isSymbolicLink() || !s.isDirectory() || real !== resolve(path) || dirname(real) !== home) continue;
      await rm(path, { recursive: true, force: true });
    }
    await iso.cleanup();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 4 || process.argv[2] !== "--config") fail("configuration");
    const config = JSON.parse(await privateFile(process.argv[3], MiB));
    console.log(JSON.stringify(await rebindShortManifest(config), null, 1));
  } catch (e) { console.log(JSON.stringify({ ok: false, code: typeof e?.code === "string" && /^[a-z-]{1,32}$/.test(e.code) ? e.code : "rebind-unavailable", publication: false })); process.exitCode = 1; }
}
