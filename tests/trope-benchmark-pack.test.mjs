import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, mkdir, readFile, writeFile, lstat, rm, symlink, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { isolatedEnv } from "./helpers/isolatedEnv.mjs";
import { BENCHMARK_LIMITS, BenchmarkPackError, buildBenchmarkPack, benchmarkIdentityMap, canonicalJson, sha256 } from "../trope/benchmark-pack.mjs";
import { privateBenchmarkDestination, writeBenchmarkPack } from "../scripts/trope-benchmark-pack.mjs";

const repository = fileURLToPath(new URL("../", import.meta.url));
const script = fileURLToPath(new URL("../scripts/trope-benchmark-pack.mjs", import.meta.url));
const run = promisify(execFile), clone = value => structuredClone(value);
const load = path => readFileSync(new URL(path, import.meta.url), "utf8");
const profileJson = load("../trope/pronunciation.json"), profile = JSON.parse(profileJson).profiles["israeli-v1"];
function passage(he = "בָ֑ גָֽ׃", extra = {}) {
  return { id: "P01", ref: "Genesis 1:1", he, textSha256: sha256(he), flags: { final: false, endOfAliyah: false, endOfBook: false, special: null }, ...extra };
}
function input(rows = [passage()], table = "torah", style = "v2") {
  return { schema: "chant-benchmark-input/v1", benchmarkId: "synthetic-benchmark", source: { edition: "Synthetic source", sourceRecordId: "source-test", rightsRecordId: "rights-test", approvalRecordId: "approval-test" },
    pronunciation: { profile: "israeli-v1", confirmationRecordId: "pronunciation-test", divineNames: "ceremony-adonai-elohim" },
    performance: { key: "D3", tempo: 96, table, style }, passages: rows };
}
function assets(table = "torah") {
  return { tableJson: load(`../trope/cells/${table}.json`), pronunciationJson: profileJson,
    code: { revision: "a".repeat(40), files: { "trope/benchmark-pack.mjs": "synthetic-code", "scripts/trope-benchmark-pack.mjs": "synthetic-cli-code" } }, inputFileSha256: null };
}
const build = value => buildBenchmarkPack(value, assets(value.performance.table));
const artifact = (pack, name) => JSON.parse(pack.artifacts[`P01/${name}.json`]);
async function scratch(action) {
  const root = await mkdtemp(join(tmpdir(), "chant-target-synthetic-"));
  try { return await action(root); }
  finally { if (!resolve(root).startsWith(`${resolve(tmpdir())}${sep}`)) throw Error("Synthetic cleanup target escaped temp root"); await rm(root, { recursive: true, force: true }); }
}
function rejects(value, code) { assert.throws(() => build(value), error => error instanceof BenchmarkPackError && (!code || error.code === code)); }

test("private pack bytes, hashes and coordinate IDs are deterministic and never infer approval", () => {
  const value = input([passage("בָ־גָ֑ דָֽ׃")]), before = canonicalJson(value), a = build(value), b = build(clone(value));
  assert.deepEqual(a.artifacts, b.artifacts); assert.equal(canonicalJson(value), before);
  assert.equal(a.manifest.releaseStatus, "private-unreleased"); assert.equal(a.manifest.targetReview, "pending");
  assert.equal(a.manifest.passages[0].targetReview, "pending"); assert.match(a.manifest.provenance.verification, /do not establish approval/);
  assert.equal(a.manifest.f0Parity, "not-claimed"); assert.match(a.manifest.lanes.B.f0, /not-emitted/);
  assert.equal(sha256(a.artifacts["manifest.json"]), a.manifestSha256);
  for (const [path, record] of Object.entries(a.manifest.artifacts)) { assert.equal(sha256(a.artifacts[path]), record.sha256); assert.equal(Buffer.byteLength(a.artifacts[path]), record.bytes); }
  const ids = artifact(a, "identity-map");
  assert.equal(ids.words.length, 3); assert.deepEqual(ids.words.map(w => [w.unit, w.word]), [[0, 0], [0, 1], [1, 0]]);
  assert.equal(new Set(ids.words.map(w => w.id)).size, 3);
  assert.ok(ids.syllables.every(s => s.id.startsWith(`${ids.targetHash}:P01:`) && ids.words.some(w => w.id === s.wordId)));
  assert.equal(ids.parity.noteCount, artifact(a, "score").events.length);
  assert.ok(ids.notes.filter(n => !n.rest).every(n => ids.syllables.some(s => s.id === n.syllableId && s.noteIds.includes(n.id))));
});

test("strict provenance, flags, hashes, IDs and bounds are rejected before target creation", () => {
  for (const field of ["edition", "sourceRecordId", "rightsRecordId", "approvalRecordId"]) { const v = input(); delete v.source[field]; rejects(v, "schema"); }
  for (const field of ["final", "endOfAliyah", "endOfBook", "special"]) { const v = input(); delete v.passages[0].flags[field]; rejects(v, "schema"); }
  for (const bad of ["../P01", "P01/escape", "CON", ".", "p 1"]) { const v = input(); v.passages[0].id = bad; rejects(v, "identifier"); }
  const duplicate = input([passage(), passage(undefined, { id: "p01" })]); rejects(duplicate, "identifier");
  const changed = input(); changed.passages[0].he += " דָ"; rejects(changed, "text-hash");
  const blank = input(); blank.passages[0].he = ""; rejects(blank, "text");
  const invalid = input(); invalid.passages[0].he += "\ud800"; rejects(invalid, "text");
  const huge = input([passage("בָ ".repeat(3000))]); rejects(huge, "bounds");
  const words = input([passage("בָ ".repeat(513))]); rejects(words, "bounds");
  const rows = input(Array.from({ length: BENCHMARK_LIMITS.passages + 1 }, (_, i) => passage(undefined, { id: `P${i}` }))); rejects(rows, "bounds");
  const uncuttable = input([passage("בָ".repeat(100) + "בָֽ׃")]); rejects(uncuttable, "segment-bounds");
  const style = input(); style.performance.style = "imagined"; rejects(style, "performance");
  const profile = input(); profile.pronunciation.profile = "custom"; rejects(profile, "profile");
  const divine = input(); divine.pronunciation.divineNames = "custom"; rejects(divine, "profile");
  const unknown = input(); unknown.source.extra = "unreviewed"; rejects(unknown, "schema");
});

test("Torah, haftarah and book/aliyah flags remain explicit and cannot silently use the wrong table", () => {
  const ordinary = build(input([passage(), passage(undefined, { id: "P02", ref: "Genesis 1:2" })]));
  assert.equal(JSON.parse(ordinary.artifacts["P02/score.json"]).flags.final, false);
  const final = input(); final.passages[0].flags.final = true; rejects(final, "flags-table");
  const wrongBook = input([passage(undefined, { ref: "Isaiah 1:1" })]); rejects(wrongBook, "reference-table");
  const wrongTable = input([passage()], "haftarah"); rejects(wrongTable, "reference-table");
  const inconsistent = input(); inconsistent.passages[0].flags.endOfBook = true; rejects(inconsistent, "flags-book");
  const aliyah = input(); aliyah.passages[0].flags.endOfAliyah = true;
  const book = clone(aliyah); book.passages[0].flags.endOfBook = true;
  assert.notDeepEqual(artifact(build(aliyah), "score").units.map(u => u.cell.id), artifact(build(book), "score").units.map(u => u.cell.id));
  const prophetic = input([passage(undefined, { ref: "Isaiah 1:1" })], "haftarah");
  const haftarahFinal = clone(prophetic); haftarahFinal.passages[0].flags.final = true;
  assert.notDeepEqual(artifact(build(prophetic), "score").units.map(u => u.cell.id), artifact(build(haftarahFinal), "score").units.map(u => u.cell.id));
  prophetic.passages[0].flags.endOfAliyah = true; rejects(prophetic, "flags-table");
  const special = input(); special.passages[0].flags.special = "journeys"; rejects(special, "special-unavailable");
  const unknownSpecial = input(); unknownSpecial.passages[0].flags.special = "unknown"; rejects(unknownSpecial, "flags");
});

test("current permitted long and melismatic fixtures preserve executed parity over split boundaries", () => {
  const corpus = JSON.parse(load("./fixtures/trope/calibration-torah.json")).verses;
  for (const ref of ["Deuteronomy 1:21", "Genesis 24:12", "Numbers 35:5"]) {
    const row = corpus.find(v => v.ref === ref); assert.ok(row);
    const value = input([passage(row.he, { ref, flags: { final: false, endOfAliyah: row.endOfAliyah === true, endOfBook: row.endOfBook === true, special: row.special ?? null } })]);
    const pack = build(value), map = artifact(pack, "identity-map"), plan = artifact(pack, "b-speech-plan");
    assert.ok(map.segments.length > 1); assert.ok(map.notes.some(n => n.slur));
    assert.equal(map.segments.at(-1).endMs, Math.round(plan.seconds * 1000));
    assert.equal(map.notes.filter(n => !n.rest).length, artifact(pack, "score").events.length);
    map.segments.forEach((segment, i) => { assert.ok(segment.endMs - segment.startMs <= 30000); if (i) assert.equal(segment.startMs, map.segments[i - 1].endMs); });
  }
});

test("parity rejects changed pitch, order/slur, syllable labels, counts and B timing", () => {
  const pack = build(input()), args = { passageId: "P01", targetHash: pack.manifest.passages[0].targetHash,
    units: artifact(pack, "units"), score: artifact(pack, "score"), segments: artifact(pack, "a-soulx-target"), plan: artifact(pack, "b-speech-plan"), profile, style: { stress: "lexical" } };
  const corruptions = [
    v => { v.plan.notes.find(n => !n.rest).midi++; },
    v => { v.score.events[0].midi++; },
    v => { v.score.events[0].slur = !v.score.events[0].slur; },
    v => { v.segments[0].text = v.segments[0].text.replace("בָ֑", "דָ֑"); },
    v => { v.plan.notes.pop(); },
    v => { v.plan.notes[0].t += 0.01; },
    v => { v.plan.phrases[0].syllables[0].syllable++; },
  ];
  for (const corrupt of corruptions) { const altered = clone(args); corrupt(altered); assert.throws(() => benchmarkIdentityMap(altered), BenchmarkPackError); }
});

test("private writer refuses repository paths, existing destinations, alias escapes and tampered packs before writes", async () => scratch(async root => {
  const destination = join(root, "pack"), pack = build(input());
  await assert.rejects(privateBenchmarkDestination(join(repository, ".local-logs", basename(root))), BenchmarkPackError);
  const alias = join(root, "checkout-alias"); await symlink(repository, alias, "junction");
  try { await assert.rejects(writeBenchmarkPack(pack, join(alias, basename(root))), BenchmarkPackError); }
  finally { await unlink(alias); }
  const altered = { ...pack, artifacts: { ...pack.artifacts, "../escaped.json": "{}" } };
  await assert.rejects(writeBenchmarkPack(altered, destination), BenchmarkPackError);
  await assert.rejects(lstat(destination), { code: "ENOENT" });
  const tooLarge = clone(pack), large = " ".repeat(BENCHMARK_LIMITS.outputBytes);
  tooLarge.artifacts["P01/units.json"] = large;
  tooLarge.manifest.artifacts["P01/units.json"] = { bytes: large.length, sha256: sha256(large) };
  tooLarge.artifacts["manifest.json"] = canonicalJson(tooLarge.manifest); tooLarge.manifestSha256 = sha256(tooLarge.artifacts["manifest.json"]);
  await assert.rejects(writeBenchmarkPack(tooLarge, destination), BenchmarkPackError); await assert.rejects(lstat(destination), { code: "ENOENT" });
  await mkdir(destination); await writeFile(join(destination, "marker"), "synthetic retained marker");
  await assert.rejects(writeBenchmarkPack(pack, destination), BenchmarkPackError);
  assert.equal(await readFile(join(destination, "marker"), "utf8"), "synthetic retained marker");
  const fresh = join(root, "fresh"); await writeBenchmarkPack(pack, fresh);
  assert.equal(sha256(await readFile(join(fresh, "manifest.json"))), pack.manifestSha256);
  for (const [path, data] of Object.entries(pack.artifacts)) assert.equal(await readFile(join(fresh, path), "utf8"), data);
}));

test("CLI checks the frozen input checksum, writes one private pack and returns sanitized failures", async () => scratch(async root => {
  const { env, cleanup } = await isolatedEnv();
  try {
    const inputPath = join(root, "synthetic-private-input.json"), data = canonicalJson(input()), destination = join(root, "prepared");
    await writeFile(inputPath, data);
    const call = async (digest, out = destination) => {
      try { const result = await run(process.execPath, [script, "--input", inputPath, "--input-sha256", digest, "--out", out], { cwd: repository, env, windowsHide: true, timeout: 20000, maxBuffer: 4096 }); return { code: 0, ...result }; }
      catch (error) { return { code: error.code, stdout: error.stdout ?? "", stderr: error.stderr ?? "" }; }
    };
    const invalid = await call("0".repeat(64)); assert.equal(invalid.code, 1);
    assert.ok(!invalid.stderr.includes(root) && !invalid.stderr.includes(input().passages[0].he));
    await assert.rejects(lstat(destination), { code: "ENOENT" });
    const valid = await call(sha256(data)); assert.equal(valid.code, 0, valid.stderr);
    const manifest = JSON.parse(await readFile(join(destination, "manifest.json"), "utf8"));
    assert.equal(manifest.input.fileSha256, sha256(data)); assert.equal(manifest.targetReview, "pending");
    for (const path of ["trope/text.mjs", "trope/benchmark-pack.mjs", "scripts/trope-benchmark-pack.mjs"]) assert.equal(manifest.code.fileHashes[path], sha256(await readFile(join(repository, path))));
    assert.ok(Object.keys(manifest.code.fileHashes).some(path => path.includes("vendor/havarotjs/")));
    assert.ok(Object.keys(manifest.code.fileHashes).every(path => !/python|\.py$|melody.*json/.test(path)));
    const again = await call(sha256(data)); assert.equal(again.code, 1); assert.ok(!again.stderr.includes(root));
    const missing = input(); delete missing.source.rightsRecordId; const invalidData = canonicalJson(missing); await writeFile(inputPath, invalidData);
    const refused = await call(sha256(invalidData), join(root, "invalid-provenance")); assert.equal(refused.code, 1); await assert.rejects(lstat(join(root, "invalid-provenance")), { code: "ENOENT" });
  } finally { await cleanup(); }
}));

test("measured timing keeps notes, order and text while each syllable lasts its full measured time, with emitter breaths added on top", () => {
  const row = JSON.parse(load("./fixtures/trope/calibration-torah.json")).verses.find(v => v.ref === "Genesis 24:12");
  const base = input([passage(row.he, { ref: row.ref })]), engine = build(base);
  const score = artifact(engine, "score"), engineSyllables = artifact(engine, "identity-map").syllables;
  // Invented durations; a melisma gets at least 80 ms per note, as a sung one would.
  const measured = engineSyllables.map((s, k) => Math.max(150 + (k % 4) * 90 + (k % 7 === 6 ? 700 : 0), 80 * s.noteIds.length));
  const timedInput = clone(base); timedInput.passages[0].timing = { source: "measured", recordId: "timing-test", syllableMs: measured };
  const timed = build(timedInput), tScore = artifact(timed, "score"), map = artifact(timed, "identity-map");
  assert.notEqual(timed.manifest.passages[0].targetHash, engine.manifest.passages[0].targetHash);
  assert.equal(timed.manifest.passages[0].timing.source, "measured"); assert.equal(engine.manifest.passages[0].timing, "engine");
  assert.deepEqual(tScore.events.map(e => [e.unit, e.syllable, e.midi, e.slur]), score.events.map(e => [e.unit, e.syllable, e.midi, e.slur]));
  assert.equal(tScore.tempo, 60);
  // Each syllable's sung notes add up to exactly its measured time.
  const notes = new Map(map.notes.map(n => [n.id, n]));
  map.syllables.forEach((s, k) => {
    const own = s.noteIds.map(id => notes.get(id));
    assert.equal(own.reduce((t, n) => t + n.durationMs, 0), measured[k], `syllable ${k}`);
  });
  assert.equal(map.parity.executedTiming, true);
  assert.ok(timed.manifest.passages[0].timing.emitterBreathMsAdded > 0, "this verse has emitter breaths");
  const short = clone(timedInput); short.passages[0].timing.syllableMs.pop(); rejects(short, "timing-syllable-count");
  const tiny = clone(timedInput); tiny.passages[0].timing.syllableMs[0] = 10; rejects(tiny, "timing-bounds");
  const wrong = clone(timedInput); wrong.passages[0].timing.source = "guess"; rejects(wrong, "timing");
  const extra = clone(timedInput); extra.passages[0].timing.note = "x"; rejects(extra, "schema");
  const badId = clone(timedInput); badId.passages[0].timing.recordId = "../x"; rejects(badId, "identifier");
});

test("under style v1 measured timing adds no emitter breath time and says word gaps are carved from the syllable", () => {
  const he = "בָ־גָ֑ דָֽ׃", v1 = input([passage(he)], "torah", "v1"), base = build(v1);
  const n = artifact(base, "identity-map").syllables.length;
  v1.passages[0].timing = { source: "measured", recordId: "timing-test", syllableMs: Array(n).fill(300) };
  const t = build(v1).manifest.passages[0].timing;
  assert.equal(t.emitterBreathMsAdded, 0); assert.match(t.wordGaps, /carves/);
});
