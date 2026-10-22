import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { FINKEL_BUILD, FinkelBuildError, buildFinkelManifest, buildFinkelReference, finkelCoverage, publishFinkelPlan, readFinkelPlan, selectFinkelClips, verifyFinkelPlan } from "../scripts/finkel-reference-build.mjs";
import { entryProblems } from "../scripts/repo-policy.mjs";
import { privateBenchmarkProblem, PRIVATE_REFERENCE_INDEX_REASON as PRIVATE } from "../scripts/private-benchmark-policy.mjs";

// Synthetic package only: invented keys, bytes and hashes; no real titles, labels or audio.
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const audio = (n) => new TextEncoder().encode(`synthetic-mp3-${n}`);
function asset(n, overrides = {}) {
  const bytes = audio(n), key = `fj_${String(n).padStart(20, "0")}`;
  return { assetKey: key, kind: "torah", mode: "chant", tempo: null, verses: ["Genesis 22:1", "Genesis 22:2"], recommendedDefault: true,
    review: { machineVerification: { status: "passed" } }, title: "PRIVATE-TITLE", labelHe: "PRIVATE-LABEL", derivedFrom: { catalogId: "JF-0001", path: "PRIVATE-PATH" },
    playback: { codec: "mp3", sha256: sha(bytes), bytes: bytes.byteLength, durationSeconds: 12.5, path: `prepared/assets/${key}/playback.mp3` }, ...overrides };
}
const catalog = (assets) => ({ schema: FINKEL_BUILD.catalogSchema, sources: [{ originalTitle: "PRIVATE-SOURCE" }], assets });

test("selection keeps machine-verified plain Torah and haftarah clips and drops held, drills, tempo variants and non-scripture", () => {
  const { clips, skipped } = selectFinkelClips(catalog([
    asset(1), asset(2, { mode: "spoken", recommendedDefault: false }), asset(3, { kind: "prophets", verses: ["Isaiah 40:27", "Isaiah 40:28"] }),
    asset(4, { review: { machineVerification: { status: "failed" } } }), asset(5, { mode: "chant-drill" }), asset(6, { tempo: "faster" }),
    asset(7, { kind: "service-part", verses: [] }), asset(8, { kind: "megillah", verses: ["Esther 1:1"] }),
  ]));
  assert.deepEqual(clips.map(c => [c.asset.slice(-1), c.kind, c.mode, c.preferred]), [["1", "torah", "chant", true], ["2", "torah", "spoken", false], ["3", "haftarah", "chant", true]]);
  assert.deepEqual(skipped, { held: 1, drill: 1, tempo: 1, notScripture: 2, oversize: 0 });
  // The manifest carries no private fields.
  const text = new TextDecoder().decode(buildFinkelManifest(clips).bytes);
  for (const word of ["PRIVATE", "JF-", "prepared/", "title", "label"]) assert.ok(!text.includes(word), word);
  assert.deepEqual(Object.keys(JSON.parse(text).clips[0]), ["asset", "kind", "mode", "verses", "sha256", "bytes", "durationSeconds", "preferred"]);
  assert.deepEqual(finkelCoverage(clips).distinctVerses, { torah: 2, haftarah: 2 });
});

test("selection refuses malformed, out-of-order, cross-book and duplicate declarations instead of repairing them", () => {
  for (const bad of [{ verses: ["Genesis 22:2", "Genesis 22:1"] }, { verses: ["Genesis 50:26", "Exodus 1:1"] }, { verses: ["Genesis 51:1"] }, { verses: ["Isaiah 1:1"] },
    { playback: { codec: "mp3", sha256: "x", bytes: 1, durationSeconds: 1, path: "p" } }, { assetKey: "fj_bad" }]) {
    assert.throws(() => selectFinkelClips(catalog([asset(1, bad)])), FinkelBuildError);
  }
  assert.throws(() => selectFinkelClips(catalog([asset(1), asset(1)])), FinkelBuildError);
  assert.throws(() => selectFinkelClips({ schema: "other", assets: [] }), FinkelBuildError);
});

test("build hashes every selected file, writes a manifest-last plan outside Git and refuses output inside a working tree", async () => {
  const root = await mkdtemp(join(tmpdir(), "finkel-build-")), pkg = join(root, "prepared"), out = join(root, "out");
  try {
    const assets = [asset(1), asset(2, { mode: "spoken" })];
    for (const [i, a] of assets.entries()) { await mkdir(join(pkg, "assets", a.assetKey), { recursive: true }); await writeFile(join(pkg, "assets", a.assetKey, "playback.mp3"), audio(i + 1)); }
    await writeFile(join(pkg, "catalog.json"), JSON.stringify(catalog(assets)));
    const result = await buildFinkelReference({ packageDir: pkg, outDir: out });
    assert.equal(result.objects, 3); assert.equal(result.coverage.clips, 2);
    const plan = await readFinkelPlan(join(out, "plan.json")), manifest = await readFile(join(out, "manifest.json"));
    assert.equal(sha(manifest), result.manifestSha256); assert.equal(plan.objects.at(-1).key, FINKEL_BUILD.manifestKey(result.manifestSha256));
    assert.ok(plan.objects.slice(0, -1).every(o => o.key === FINKEL_BUILD.audioKey(o.sha256) && o.contentType === "audio/mpeg"));
    // Generated private outputs would be refused if they were ever staged in the repository.
    assert.ok(entryProblems("tests/fixtures/portal/manifest.json", manifest.toString("utf8")).includes(PRIVATE));
    assert.ok(entryProblems("tests/fixtures/portal/plan.json", await readFile(join(out, "plan.json"), "utf8")).includes(PRIVATE));
    // Clips the listening review holds back leave the manifest entirely.
    await writeFile(join(root, "holds.txt"), `${assets[1].assetKey}\r\n`);
    const held = await buildFinkelReference({ packageDir: pkg, outDir: join(root, "out-held"), holdFile: join(root, "holds.txt") });
    assert.equal(held.coverage.clips, 1); assert.equal(held.skipped.reviewHeld, 1); assert.equal(held.objects, 2);
    await writeFile(join(root, "bad-holds.txt"), "not-an-asset\n");
    await assert.rejects(buildFinkelReference({ packageDir: pkg, outDir: join(root, "out-bad"), holdFile: join(root, "bad-holds.txt") }), { code: "hold-file" });
    // A changed file is caught by its hash.
    await writeFile(join(pkg, "assets", assets[0].assetKey, "playback.mp3"), audio(9));
    await assert.rejects(buildFinkelReference({ packageDir: pkg, outDir: out }), { code: "media-hash" });
    const repository = fileURLToPath(new URL("..", import.meta.url));
    await assert.rejects(buildFinkelReference({ packageDir: pkg, outDir: join(repository, ".local-logs", "finkel-out") }), { code: "output-inside-git" });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("publish is create-only and manifest-last, reuses identical objects, stops on a differing one and re-hashes every upload", async () => {
  const root = await mkdtemp(join(tmpdir(), "finkel-publish-test-"));
  try {
    const files = [audio(1), audio(2)], objects = [];
    for (const [i, bytes] of files.entries()) { const file = join(root, `a${i}.mp3`); await writeFile(file, bytes); objects.push({ key: FINKEL_BUILD.audioKey(sha(bytes)), file, sha256: sha(bytes), bytes: bytes.byteLength, contentType: "audio/mpeg" }); }
    const manifest = new TextEncoder().encode("{}"), mfile = join(root, "manifest.json"); await writeFile(mfile, manifest);
    objects.push({ key: FINKEL_BUILD.manifestKey(sha(manifest)), file: mfile, sha256: sha(manifest), bytes: manifest.byteLength, contentType: "application/json" });
    const plan = { schema: FINKEL_BUILD.planSchema, manifestSha256: sha(manifest), objects };
    await writeFile(join(root, "plan.json"), JSON.stringify(plan)); assert.deepEqual(await readFinkelPlan(join(root, "plan.json")), plan);
    const store = new Map([[objects[0].key, files[0]]]), calls = [];
    const run = async (args) => {
      calls.push(args.slice(0, 2).join(" ") + " " + (args[1] === "get" ? args[2] : args[args.indexOf("--pathname") + 1]));
      if (args[1] === "get") { const bytes = store.get(args[2]); if (!bytes) return { ok: false, missing: true }; await writeFile(args[args.indexOf("--output") + 1], bytes); return { ok: true, missing: false }; }
      assert.equal(args[args.indexOf("--access") + 1], "private");
      assert.ok(!args.some(arg => arg === "false" || arg === "true" || arg === "--allow-overwrite" || arg === "--add-random-suffix"), "documented defaults only: no suffix, no overwrite");
      if (store.has(args[args.indexOf("--pathname") + 1])) return { ok: false, missing: false };
      store.set(args[args.indexOf("--pathname") + 1], await readFile(args[2])); return { ok: true, missing: false };
    };
    assert.deepEqual(await publishFinkelPlan(plan, run, { dryRun: true, scratch: root }), { existing: 1, created: 0, wouldCreate: 2 });
    assert.equal(store.size, 1);
    calls.length = 0;
    assert.deepEqual(await publishFinkelPlan(plan, run, { scratch: root }), { existing: 1, created: 2, wouldCreate: 0 });
    assert.equal(calls.filter(c => c.startsWith("blob put")).at(-1), `blob put ${objects[2].key}`, "manifest goes last");
    assert.deepEqual(await verifyFinkelPlan(plan, run, { scratch: root }), { verified: 3, missing: 0, differing: 0, total: 3 });
    store.set(objects[1].key, audio(7));
    await assert.rejects(publishFinkelPlan(plan, run, { scratch: root }), { code: "remote-differs" });
    assert.deepEqual(await verifyFinkelPlan(plan, run, { scratch: root }), { verified: 2, missing: 0, differing: 1, total: 3 });
    await assert.rejects(publishFinkelPlan(plan, async () => ({ ok: false, missing: false }), { scratch: root }), { code: "get-failed" });
    await assert.rejects(readFinkelPlan(join(root, "a0.mp3")));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Finkel catalog, manifest and plan schemas are private data wherever they appear as JSON", () => {
  for (const schema of ["finkel-prepared-catalog/v1", "finkel-reference-manifest/v1", "finkel-reference-upload-plan/v1"]) {
    const value = JSON.stringify({ schema, clips: [] });
    assert.equal(privateBenchmarkProblem(value, true), PRIVATE); assert.equal(privateBenchmarkProblem(value, false), PRIVATE);
    assert.ok(entryProblems("src/synthetic.json", value).includes(PRIVATE));
    // Source code may still name the schema.
    assert.deepEqual(entryProblems("src/synthetic.ts", `export const schema = ${JSON.stringify(schema)};`), []);
  }
});
