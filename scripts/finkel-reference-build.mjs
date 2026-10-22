// Cantor Finkel's reference recordings: off-repo build, publish and verify.
//
//   node scripts/finkel-reference-build.mjs build   --package <prepared dir> --out <dir> [--hold <file of fj_ asset keys>]
//   node scripts/finkel-reference-build.mjs publish --plan <out>/plan.json --cwd <linked project dir> [--dry-run]
//   node scripts/finkel-reference-build.mjs verify  --plan <out>/plan.json --cwd <linked project dir>
//
// build reads the private prepared package (its catalog and playback MP3s), keeps the machine-verified
// plain chant/spoken Torah and haftarah clips, re-hashes every selected file and writes a
// content-addressed manifest plus an upload plan to an output folder that must be outside every Git
// working tree. It prints counts only: never titles, labels, source IDs, provenance or paths.
// publish/verify drive the Vercel CLI from a linked project directory (the operator's own login; this
// script never reads, prints or passes a token). Audio goes first, the manifest last; nothing is
// overwritten, and every object is downloaded again and re-hashed before it counts.
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import { insideGitWorkingTree } from "./private-paths.mjs";
import { TANAKH_VERSE_COUNTS } from "../src/lib/readings/catalog.ts";

export const FINKEL_BUILD = Object.freeze({
  manifestSchema: "finkel-reference-manifest/v1", planSchema: "finkel-reference-upload-plan/v1",
  catalogSchema: "finkel-prepared-catalog/v1", catalogBytes: 8 * 1024 * 1024, clipBytes: 4 * 1024 * 1024, manifestBytes: 1024 * 1024,
  audioKey: (sha) => `reference-review/finkel/v1/audio/${sha}.mp3`, manifestKey: (sha) => `reference-review/finkel/v1/manifests/${sha}.json`,
});
const TORAH = ["Genesis", "Exodus", "Leviticus", "Numbers", "Deuteronomy"];
const PROPHETS = ["Joshua", "Judges", "I Samuel", "II Samuel", "I Kings", "II Kings", "Isaiah", "Jeremiah", "Ezekiel", "Hosea", "Joel", "Amos", "Obadiah", "Jonah", "Micah", "Nahum", "Habakkuk", "Zephaniah", "Haggai", "Zechariah", "Malachi"];
const BOOKS = [...TORAH, ...PROPHETS];
export class FinkelBuildError extends Error { constructor(code) { super(`Finkel build refused: ${code}`); this.name = "FinkelBuildError"; this.code = code; } }
const need = (value, code) => { if (!value) throw new FinkelBuildError(code); };
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const digest = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

export function verseOrdinal(ref) {
  if (typeof ref !== "string") return null;
  const match = /^(.{1,40}) ([1-9]\d{0,2}):([1-9]\d{0,2})$/.exec(ref);
  if (!match || !BOOKS.includes(match[1]) || !Object.hasOwn(TANAKH_VERSE_COUNTS, match[1])) return null;
  const chapters = TANAKH_VERSE_COUNTS[match[1]], chapter = Number(match[2]), verse = Number(match[3]);
  if (chapter > chapters.length || verse > chapters[chapter - 1]) return null;
  let total = 0; for (let i = 0; i < chapter - 1; i++) total += chapters[i];
  return { book: match[1], chapter, ordinal: total + verse };
}

/** Which prepared assets may play: machine-verified, plain (not drill, not a tempo variant), one
 * scripture passage in one book, at most 4 MiB. Pure; the caller verifies the bytes. */
export function selectFinkelClips(catalog) {
  need(object(catalog) && catalog.schema === FINKEL_BUILD.catalogSchema && Array.isArray(catalog.assets), "catalog");
  const selected = [], skipped = { held: 0, drill: 0, tempo: 0, notScripture: 0, oversize: 0 };
  for (const a of catalog.assets) {
    need(object(a) && typeof a.assetKey === "string" && /^fj_[a-f0-9]{20}$/.test(a.assetKey), "asset");
    if (a.kind !== "torah" && a.kind !== "prophets") { skipped.notScripture++; continue; }
    if (a.review?.machineVerification?.status !== "passed") { skipped.held++; continue; }
    if (a.mode !== "chant" && a.mode !== "spoken") { skipped.drill++; continue; }
    if (a.tempo !== null) { skipped.tempo++; continue; }
    const p = a.playback; need(object(p) && p.codec === "mp3" && digest(p.sha256) && Number.isSafeInteger(p.bytes) && p.bytes > 0
      && typeof p.durationSeconds === "number" && Number.isFinite(p.durationSeconds) && p.durationSeconds > 0 && p.durationSeconds <= 3600, "playback");
    if (p.bytes > FINKEL_BUILD.clipBytes) { skipped.oversize++; continue; }
    need(p.path === `prepared/assets/${a.assetKey}/playback.mp3`, "playback-path");
    need(Array.isArray(a.verses) && a.verses.length > 0 && a.verses.length <= 512, "verses");
    let book = null, previous = 0;
    for (const ref of a.verses) {
      const parsed = verseOrdinal(ref); need(parsed, "verse");
      need((a.kind === "torah" ? TORAH : PROPHETS).includes(parsed.book) && (book === null || parsed.book === book) && parsed.ordinal > previous, "verse-order");
      book = parsed.book; previous = parsed.ordinal;
    }
    selected.push({ asset: a.assetKey, kind: a.kind === "torah" ? "torah" : "haftarah", mode: a.mode, verses: [...a.verses],
      sha256: p.sha256, bytes: p.bytes, durationSeconds: p.durationSeconds, preferred: a.recommendedDefault === true });
  }
  need(selected.length > 0 && selected.length <= 1000, "selection");
  need(new Set(selected.map(c => c.asset)).size === selected.length && new Set(selected.map(c => c.sha256)).size === selected.length, "duplicate");
  // Deterministic order: book order, then first verse, then chant before words, then asset.
  const first = (clip) => verseOrdinal(clip.verses[0]);
  selected.sort((x, y) => BOOKS.indexOf(first(x).book) - BOOKS.indexOf(first(y).book) || first(x).ordinal - first(y).ordinal
    || (x.mode === y.mode ? 0 : x.mode === "chant" ? -1 : 1) || (x.asset < y.asset ? -1 : x.asset > y.asset ? 1 : 0));
  return { clips: selected, skipped };
}
export function buildFinkelManifest(clips) {
  const bytes = new TextEncoder().encode(JSON.stringify({ schema: FINKEL_BUILD.manifestSchema, clips }));
  need(bytes.byteLength <= FINKEL_BUILD.manifestBytes, "manifest-size");
  return { bytes, sha256: sha256(bytes) };
}
/** Aggregate counts only, safe to print and to copy into planning docs. */
export function finkelCoverage(clips) {
  const verses = { torah: new Set(), haftarah: new Set() }, both = { torah: { chant: new Set(), spoken: new Set() }, haftarah: { chant: new Set(), spoken: new Set() } };
  const counts = {}; let bytes = 0, seconds = 0, preferred = 0, single = 0;
  for (const clip of clips) {
    const key = `${clip.kind}-${clip.mode}`; counts[key] = (counts[key] ?? 0) + 1; bytes += clip.bytes; seconds += clip.durationSeconds;
    if (clip.preferred) preferred++; if (clip.verses.length === 1) single++;
    for (const ref of clip.verses) { verses[clip.kind].add(ref); both[clip.kind][clip.mode].add(ref); }
  }
  return { clips: clips.length, byKindMode: counts, preferred, singleVerse: single, bytes, minutes: Math.round(seconds / 6) / 10,
    distinctVerses: { torah: verses.torah.size, haftarah: verses.haftarah.size },
    chantVerses: { torah: both.torah.chant.size, haftarah: both.haftarah.chant.size }, spokenVerses: { torah: both.torah.spoken.size, haftarah: both.haftarah.spoken.size } };
}

async function regularInside(root, path) {
  const info = await lstat(path); need(info.isFile() && !info.isSymbolicLink(), "file-kind");
  const real = await realpath(path), relation = relative(root, real);
  need(relation && !relation.startsWith("..") && !isAbsolute(relation), "containment");
  return info.size;
}
/** Asset keys Daniel's listening review holds back, one per line; they leave the manifest entirely. */
async function readHolds(holdFile) {
  if (holdFile === undefined) return new Set();
  const lines = (await readFile(holdFile, "utf8")).split("\n").map(line => line.trim()).filter(Boolean);
  need(lines.length <= 1000 && lines.every(line => /^fj_[a-f0-9]{20}$/.test(line)), "hold-file");
  return new Set(lines);
}
export async function buildFinkelReference({ packageDir, outDir, holdFile }) {
  need(typeof packageDir === "string" && typeof outDir === "string" && (holdFile === undefined || typeof holdFile === "string"), "arguments");
  const holds = await readHolds(holdFile);
  const root = await realpath(resolve(packageDir)), out = resolve(outDir);
  need(!(await insideGitWorkingTree(root)), "package-inside-git");
  need(!(await insideGitWorkingTree(out)), "output-inside-git");
  const catalogPath = join(root, "catalog.json"); need((await regularInside(root, catalogPath)) <= FINKEL_BUILD.catalogBytes, "catalog-size");
  const catalog = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await readFile(catalogPath)));
  const selection = selectFinkelClips(catalog), objects = [];
  const clips = selection.clips.filter(clip => !holds.has(clip.asset)), skipped = { ...selection.skipped, reviewHeld: selection.clips.length - clips.length };
  need(clips.length > 0, "selection");
  for (const clip of clips) {
    // Catalog paths are package-relative ("prepared/assets/..."); the root is the prepared folder.
    const file = join(root, "assets", clip.asset, "playback.mp3");
    need((await regularInside(root, file)) === clip.bytes, "media-size");
    const bytes = await readFile(file); need(bytes.byteLength === clip.bytes && sha256(bytes) === clip.sha256, "media-hash");
    objects.push({ key: FINKEL_BUILD.audioKey(clip.sha256), file, sha256: clip.sha256, bytes: clip.bytes, contentType: "audio/mpeg" });
  }
  const manifest = buildFinkelManifest(clips);
  await mkdir(out, { recursive: true });
  const manifestFile = join(out, "manifest.json"); await writeFile(manifestFile, manifest.bytes, { flag: "w" });
  objects.push({ key: FINKEL_BUILD.manifestKey(manifest.sha256), file: manifestFile, sha256: manifest.sha256, bytes: manifest.bytes.byteLength, contentType: "application/json" });
  const plan = { schema: FINKEL_BUILD.planSchema, manifestSha256: manifest.sha256, objects };
  await writeFile(join(out, "plan.json"), JSON.stringify(plan, null, 2));
  return { manifestSha256: manifest.sha256, coverage: finkelCoverage(clips), skipped, objects: objects.length };
}

const SAFE_KEY = /^reference-review\/finkel\/v1\/(?:audio\/[a-f0-9]{64}\.mp3|manifests\/[a-f0-9]{64}\.json)$/;
export async function readFinkelPlan(planFile) {
  const plan = JSON.parse(await readFile(planFile, "utf8"));
  need(object(plan) && plan.schema === FINKEL_BUILD.planSchema && digest(plan.manifestSha256) && Array.isArray(plan.objects) && plan.objects.length > 1, "plan");
  plan.objects.forEach((o, i) => {
    need(object(o) && SAFE_KEY.test(o.key) && digest(o.sha256) && o.key.includes(o.sha256) && Number.isSafeInteger(o.bytes) && o.bytes > 0 && typeof o.file === "string", "plan-object");
    need(o.contentType === (o.key.endsWith(".mp3") ? "audio/mpeg" : "application/json"), "plan-type");
    need(o.key.endsWith(".json") === (i === plan.objects.length - 1), "manifest-last");
  });
  need(plan.objects.at(-1).sha256 === plan.manifestSha256, "manifest-binding");
  return plan;
}
/** The default runner: the operator's installed Vercel CLI, no shell, inherited login. */
export function vercelRunner(cwd) {
  return (args) => new Promise((done) => {
    const windows = process.platform === "win32";
    for (const arg of args) need(/^[A-Za-z0-9 :\\/._=-]+$/.test(arg), "cli-argument");
    execFile(windows ? "vercel.cmd" : "vercel", windows ? args.map(arg => /\s/.test(arg) ? `"${arg}"` : arg) : args,
      { cwd, windowsHide: true, shell: windows, timeout: 120000, maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => done({ ok: !error, missing: /not\s*found|404|does not exist|no such blob/i.test(String(stderr) + String(stdout)) }));
  });
}
async function remoteHash(run, o, scratch) {
  const target = join(scratch, `${o.sha256}.download`); await rm(target, { force: true });
  const result = await run(["blob", "get", o.key, "--access", "private", "--output", target]);
  if (!result.ok) { need(result.missing, "get-failed"); return null; }
  const bytes = await readFile(target); await rm(target, { force: true });
  return { sha256: sha256(bytes), bytes: bytes.byteLength };
}
/** Create-only publication. Existing identical objects are reused; a differing one stops the run. */
export async function publishFinkelPlan(plan, run, { dryRun = false, scratch } = {}) {
  const tmp = scratch ?? await mkdtemp(join(tmpdir(), "finkel-publish-")), report = { existing: 0, created: 0, wouldCreate: 0 };
  try {
    for (const o of plan.objects) {
      const local = await readFile(o.file); need(local.byteLength === o.bytes && sha256(local) === o.sha256, "local-hash");
      const before = await remoteHash(run, o, tmp);
      if (before) { need(before.sha256 === o.sha256 && before.bytes === o.bytes, "remote-differs"); report.existing++; continue; }
      if (dryRun) { report.wouldCreate++; continue; }
      // The CLI's documented defaults are no random suffix and no overwrite; passing them as
      // values risks a parser reading "false" as a file. The exact-key readback below proves placement.
      const put = await run(["blob", "put", o.file, "--pathname", o.key, "--access", "private", "--content-type", o.contentType]);
      need(put.ok, "put-failed");
      const after = await remoteHash(run, o, tmp); need(after && after.sha256 === o.sha256 && after.bytes === o.bytes, "readback");
      report.created++;
    }
    return report;
  } finally { if (!scratch) await rm(tmp, { recursive: true, force: true }); }
}
export async function verifyFinkelPlan(plan, run, { scratch } = {}) {
  const tmp = scratch ?? await mkdtemp(join(tmpdir(), "finkel-verify-")); let verified = 0, missing = 0, differing = 0;
  try {
    for (const o of plan.objects) { const remote = await remoteHash(run, o, tmp); if (!remote) missing++; else if (remote.sha256 === o.sha256 && remote.bytes === o.bytes) verified++; else differing++; }
    return { verified, missing, differing, total: plan.objects.length };
  } finally { if (!scratch) await rm(tmp, { recursive: true, force: true }); }
}

function flags(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i]; need(/^--[a-z-]+$/.test(key) && !Object.hasOwn(result, key), "flag");
    if (key === "--dry-run") result[key] = true; else { need(i + 1 < argv.length, "flag-value"); result[key] = argv[++i]; }
  }
  return result;
}
async function main([command, ...rest]) {
  const f = flags(rest);
  if (command === "build") return buildFinkelReference({ packageDir: f["--package"], outDir: f["--out"], holdFile: f["--hold"] });
  need(command === "publish" || command === "verify", "command");
  need(typeof f["--plan"] === "string" && typeof f["--cwd"] === "string", "arguments");
  const plan = await readFinkelPlan(f["--plan"]), run = vercelRunner(resolve(f["--cwd"]));
  return command === "publish" ? { manifestSha256: plan.manifestSha256, ...(await publishFinkelPlan(plan, run, { dryRun: f["--dry-run"] === true })) }
    : { manifestSha256: plan.manifestSha256, ...(await verifyFinkelPlan(plan, run)) };
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).then(result => console.log(JSON.stringify(result, null, 2)),
    error => { console.error(error instanceof FinkelBuildError ? error.message : "Finkel build refused: unexpected error (details withheld)"); process.exitCode = 1; });
}

