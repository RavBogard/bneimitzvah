import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile, readFile, mkdir, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { isolatedEnv } from "./helpers/isolatedEnv.mjs";
import { compileReferenceCatalog, compileReferenceCatalogFiles } from "../scripts/reference-catalog-compile.mjs";
const audio = Buffer.from("synthetic non-audio proof bytes"), digest = (algorithm, body) => createHash(algorithm).update(body).digest("hex");
function inputs() {
  return { index: { schema: "pockettorah-verse-index/v1", recordings: [{ key: "Alpha-1", parsha: "Alpha", part: "1", table: "torah", ref: "Genesis 1:1-1:1", archiveFile: "Alpha-1.mp3", seconds: 4, wordLabelsMatched: false,
    verses: [{ ref: "Genesis 1:1", start: 1, end: 3, words: [{ he: "אב", start: 1 }, { he: "ג׃", start: 2 }] }] }] },
  portalWords: { verses: { "Genesis 1:1": { status: "ready", readingText: "אב ג׃", words: ["אב", "ג"] } } },
  archiveMetadata: { metadata: { identifier: "PockettorahAudioFiles" }, files: [{ name: "Alpha-1.mp3", size: String(audio.length), md5: digest("md5", audio) }] },
  audioFacts: new Map([["Alpha-1.mp3", { bytes: audio.length, md5: digest("md5", audio), sha256: digest("sha256", audio) }]]) };
}
test("pure compile is deterministic opaque IDs/no Hebrew; review holds and word mismatch survive", () => {
  const a = compileReferenceCatalog(inputs()), b = compileReferenceCatalog(inputs());
  assert.equal(a.text, b.text); assert.equal(a.summary.assets, 1); assert.equal(a.summary.cuts, 1); assert.equal(a.summary.catalogSha256, digest("sha256", a.text));
  assert.match(a.catalog.assets[0].id, /^ra_[a-f0-9]{32}$/); assert.notEqual(a.catalog.assets[0].id, "ra_" + "0".repeat(32)); assert.doesNotMatch(a.text, /[\u0590-\u05ff]/u);
  const held = inputs(); held.index.recordings[0].verses[0].review = "start moved earlier to pitched sound before the aligned first word";
  assert.equal(compileReferenceCatalog(held).catalog.assets[0].verses[0].playback.review, "start-moved");
  const mismatch = inputs(); mismatch.portalWords.verses["Genesis 1:1"].words = ["ד", "ה"]; mismatch.portalWords.verses["Genesis 1:1"].readingText = "ד ה׃";
  const result = compileReferenceCatalog(mismatch); assert.equal(result.catalog.assets[0].verses[0].playback.status, "needs-review");
});
test("invalid index/path/size/digest/archive mismatch fails with fixed errors", () => {
  for (const mutate of [x => x.archiveMetadata.metadata.identifier = "other-item", x => delete x.archiveMetadata.metadata, x => x.index.recordings[0].archiveFile = "../bad.mp3", x => x.archiveMetadata.files[0].md5 = "0".repeat(32), x => x.audioFacts.get("Alpha-1.mp3").bytes = 33554433, x => x.audioFacts.get("Alpha-1.mp3").sha256 = "A".repeat(64), x => x.archiveMetadata.files.push(x.archiveMetadata.files[0]), x => x.index.recordings[0].verses[0].ref = "Genesis 1:32" ]) {
    const x = inputs(); mutate(x); assert.throws(() => compileReferenceCatalog(x), /^Error: Reference catalog compilation failed$/);
  }
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "reference-compile-")), input = inputs(), audioDir = join(root, "audio"); await mkdir(audioDir);
  const args = [];
  for (const [flag, value] of [["--index", input.index], ["--portal-words", input.portalWords], ["--archive-metadata", input.archiveMetadata]]) { const path = join(root, flag.slice(2) + ".json"); await writeFile(path, JSON.stringify(value)); args.push(flag, path); }
  await writeFile(join(audioDir, "Alpha-1.mp3"), audio); const out = join(root, "catalog.json"); args.push("--audio", audioDir, "--out", out); return { root, input, args, out };
}
test("CLI file seam hashes original bytes before exclusive output and never overwrites", async () => {
  const f = await fixture(); try {
    const result = await compileReferenceCatalogFiles(f.args); assert.equal(result.ok, true); assert.equal(digest("sha256", await readFile(f.out)), result.catalogSha256);
    await assert.rejects(compileReferenceCatalogFiles(f.args), /^Error: Reference catalog compilation failed$/);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
test("bad audio yields no output; Git lexical/resolved inputs and output refuse; CLI closes stdout", async () => {
  const f = await fixture(), isolated = await isolatedEnv(); try {
    await writeFile(join(f.root, "audio", "Alpha-1.mp3"), "different");
    await assert.rejects(compileReferenceCatalogFiles(f.args)); await assert.rejects(access(f.out));
    const child = spawnSync(process.execPath, ["scripts/reference-catalog-compile.mjs", ...f.args], { env: isolated.env, encoding: "utf8" });
    assert.equal(child.status, 1); assert.equal(child.stderr, ""); assert.deepEqual(JSON.parse(child.stdout), { ok: false, code: "reference-catalog-unavailable" });
    const inside = [...f.args]; inside[inside.indexOf("--out") + 1] = join(process.cwd(), "never-created-reference.json");
    await assert.rejects(compileReferenceCatalogFiles(inside)); await assert.rejects(access(inside[inside.indexOf("--out") + 1]));
    await mkdir(join(f.root, ".git")); await assert.rejects(compileReferenceCatalogFiles(f.args));
  } finally { await isolated.cleanup(); await rm(f.root, { recursive: true, force: true }); }
});
test("a v2 index compiles only beside the v1 index it was refined from; ends reach the DTO", () => {
  const v2 = inputs(), v1 = inputs().index;
  v2.index = { ...v1, schema: "pockettorah-verse-index/v2", recordings: v1.recordings.map(r => ({ ...r, verses: r.verses.map(v => ({ ...v, words: [{ he: "אב", start: 1, end: 1.9, ctcStart: 1 }, { he: "ג׃", start: 1.98, end: 3, ctcStart: 2 }] })) })) };
  assert.throws(() => compileReferenceCatalog(v2), /^Error: Reference catalog compilation failed$/);
  const result = compileReferenceCatalog({ ...v2, v1Index: v1 });
  assert.deepEqual(result.catalog.assets[0].verses[0].words.starts, [1, 1.98]);
  assert.deepEqual(result.catalog.assets[0].verses[0].words.ends, [1.9, 3]);
  assert.deepEqual(result.catalog.assets[0].verses[0].playback, compileReferenceCatalog(inputs()).catalog.assets[0].verses[0].playback);
  const shifted = JSON.parse(JSON.stringify(v2.index)); shifted.recordings[0].verses[0].words[1].ctcStart = 2.05;
  assert.throws(() => compileReferenceCatalog({ ...v2, index: shifted, v1Index: v1 }), /^Error: Reference catalog compilation failed$/);
  assert.throws(() => compileReferenceCatalog({ ...inputs(), v1Index: v1 }), /^Error: Reference catalog compilation failed$/);
});
