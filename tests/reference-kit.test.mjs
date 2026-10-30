// The openly published reference-audio kit: build and install validation, offline only.
// Every fixture is synthetic and lives in a temp folder; no network is used.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { isolatedEnv } from "./helpers/isolatedEnv.mjs";
import { buildReferenceKit } from "../scripts/reference-kit-build.mjs";
import { downloadKit, envLines, parseInstallArgs, storeIdFromToken, uploadKit, verifyKit } from "../scripts/reference-kit-install.mjs";
import { CATALOG_ATTRIBUTION, MANIFEST_ATTRIBUTION, formatSha256Sums, parseSha256Sums } from "../scripts/reference-kit-shared.mjs";

const run = promisify(execFile);
const sha = b => createHash("sha256").update(b).digest("hex");
const BUILD = fileURLToPath(new URL("../scripts/reference-kit-build.mjs", import.meta.url));
const INSTALL = fileURLToPath(new URL("../scripts/reference-kit-install.mjs", import.meta.url));
const TAG = "reference-kit-v1";

function synthetic() {
  const parent = randomBytes(4000), asset = "ra_" + "a".repeat(32);
  const catalog = { schema: "reference-catalog/v1", source: "PockettorahAudioFiles", assets: [{ id: asset, archiveFile: "Synthetic-1.mp3", sha256: sha(parent), bytes: parent.length, verses: [
    { schema: "reference-verse/v1", ref: "Genesis 1:1", table: "torah", playback: { status: "ready", asset, clip: { start: 0.5, end: 3.25 } },
      words: { status: "ready", readingTextSha256: "b".repeat(64), starts: [0.5, 1.5], ends: [1.5, 3.25] }, attribution: { ...CATALOG_ATTRIBUTION } },
    { schema: "reference-verse/v1", ref: "Genesis 1:2", playback: { status: "unavailable", reason: "asset-not-approved" }, words: { status: "unavailable", reason: "no-playback" } },
  ] }] };
  const clips = Array.from({ length: 12 }, (_, i) => randomBytes(700 + i * 37));
  const catalogText = JSON.stringify(catalog);
  const manifest = { schema: "reference-short-manifest/v1", source: "PockettorahAudioFiles", parentCatalogSHA256: sha(catalogText), recipe: "pockettorah-mp3-64k-gapless/v2",
    attribution: { ...MANIFEST_ATTRIBUTION }, entries: clips.map((c, i) => ({ schema: "reference-short-source/v1", id: `rs_${sha(c)}`, parent: { asset, sha256: sha(parent), bytes: parent.length },
      sha256: sha(c), bytes: c.length, path: `/reference-audio/short-v1/${sha(c)}.mp3`, codec: "mp3", bitrate: 64000, sampleRate: 44100, channels: 1, presentationFrames: 1000 + i,
      origin: { firstFrame: i * 100, parentRate: 44100 }, attributionVersion: MANIFEST_ATTRIBUTION.version })) };
  return { catalog, catalogText, manifest, clips };
}

async function inputs(root, { catalog, catalogText, manifest, clips }, change = {}) {
  const dir = join(root, `in-${randomBytes(4).toString("hex")}`), clipDir = join(dir, "clips");
  await mkdir(clipDir, { recursive: true });
  await writeFile(join(dir, "catalog.json"), change.catalogText ?? (change.catalog ? JSON.stringify(change.catalog) : catalogText));
  await writeFile(join(dir, "manifest.json"), JSON.stringify(change.manifest ?? manifest));
  for (const c of change.clips ?? clips) await writeFile(join(clipDir, `${sha(c)}.mp3`), c);
  return { catalog: join(dir, "catalog.json"), manifest: join(dir, "manifest.json"), clips: [clipDir], tag: TAG, out: join(dir, "out") };
}
const refusedWith = code => error => error?.code === code;

async function withHome(fn) { const iso = await isolatedEnv(); try { await fn(iso); } finally { await iso.cleanup(); } }

test("builds a deterministic kit that the installer verifies end to end", () => withHome(async ({ home }) => {
  const data = synthetic();
  const a = await buildReferenceKit(await inputs(home, data)), b = await buildReferenceKit(await inputs(home, data));
  assert.equal(a.sumsSHA256, b.sumsSHA256, "the same inputs build the same kit");
  assert.deepEqual((await readdir(a.dir)).sort(), ["LICENSE-KIT.md", "SHA256SUMS", "clips-0-3.tar", "clips-4-7.tar", "clips-8-b.tar", "clips-c-f.tar",
    `catalog-${a.catalogSHA256}.json`, "kit.json", `manifest-${a.manifestSHA256}.json`].sort());
  const verified = await verifyKit({ dir: a.dir, tag: TAG, sumsSHA256: a.sumsSHA256 });
  assert.equal(verified.entries.size, 12);
  assert.match(await readFile(join(a.dir, "LICENSE-KIT.md"), "utf8"), /CC BY-SA 3\.0/);
  const lines = envLines({ kit: verified.kit, storeId: "store_Synthetic01" });
  assert.ok(lines.includes(`REFERENCE_AUDIO_CATALOG_SHA256=${a.catalogSHA256}`) && lines.includes(`REFERENCE_AUDIO_SHORT_MANIFEST_SHA256=${a.manifestSHA256}`) && lines.includes("BLOB_STORE_ID=store_Synthetic01"));
}));

test("the build refuses anything that is not closed PocketTorah catalog, manifest and clip data", () => withHome(async ({ home }) => {
  const data = synthetic(), bad = structuredClone(data.catalog);
  await assert.rejects(buildReferenceKit(await inputs(home, data, { catalog: { ...data.catalog, schema: "reference-catalog/v2" } })), refusedWith("catalog-schema"));
  bad.assets[0].verses[0].text = "In the beginning";
  await assert.rejects(buildReferenceKit(await inputs(home, data, { catalog: bad })), refusedWith("catalog-schema"), "no verse text may ride along");
  const hebrew = structuredClone(data.catalog); hebrew.assets[0].verses[0].ref = "Genesis 1:1"; hebrew.assets[0].archiveFile = "Synthetic-1.mp3"; hebrew.assets[0].verses[0].playback.review = "א";
  await assert.rejects(buildReferenceKit(await inputs(home, data, { catalog: hebrew })), refusedWith("catalog-content"));
  const credit = structuredClone(data.catalog); credit.assets[0].verses[0].attribution.creator = "Someone else";
  await assert.rejects(buildReferenceKit(await inputs(home, data, { catalog: credit })), refusedWith("catalog-attribution"));
  await assert.rejects(buildReferenceKit(await inputs(home, data, { manifest: { ...data.manifest, parentCatalogSHA256: "c".repeat(64) } })), refusedWith("manifest-parent"));
  await assert.rejects(buildReferenceKit(await inputs(home, data, { manifest: { ...data.manifest, source: "SomethingElse" } })), refusedWith("manifest-schema"));
  await assert.rejects(buildReferenceKit(await inputs(home, data, { clips: data.clips.slice(1) })), refusedWith("clip-missing"));
}));

test("the installer refuses a wrong pin, a tampered file and a wrong kit schema", () => withHome(async ({ home }) => {
  const kit = await buildReferenceKit(await inputs(home, synthetic()));
  await assert.rejects(verifyKit({ dir: kit.dir, tag: TAG, sumsSHA256: "d".repeat(64) }), refusedWith("sums-pin"));
  await assert.rejects(verifyKit({ dir: kit.dir, tag: "reference-kit-v2", sumsSHA256: kit.sumsSHA256 }), refusedWith("kit-schema"));

  const descriptor = JSON.parse(await readFile(join(kit.dir, "kit.json"), "utf8"));
  await writeFile(join(kit.dir, "kit.json"), JSON.stringify({ ...descriptor, schema: "reference-audio-kit/v9" }));
  const sums = parseSha256Sums(await readFile(join(kit.dir, "SHA256SUMS"), "utf8"));
  sums.set("kit.json", sha(await readFile(join(kit.dir, "kit.json"))));
  const resummed = formatSha256Sums([...sums].map(([file, sha256]) => ({ file, sha256 })));
  await writeFile(join(kit.dir, "SHA256SUMS"), resummed);
  await assert.rejects(verifyKit({ dir: kit.dir, tag: TAG, sumsSHA256: sha(resummed) }), refusedWith("kit-schema"), "a re-pinned kit with a wrong schema still refuses");

  const other = await buildReferenceKit(await inputs(home, synthetic()));
  const shard = join(other.dir, "clips-8-b.tar"), bytes = await readFile(shard); bytes[600] ^= 1; await writeFile(shard, bytes);
  await assert.rejects(verifyKit({ dir: other.dir, tag: TAG, sumsSHA256: other.sumsSHA256 }), refusedWith("hash-mismatch"));
}));

test("downloads only through the pinned SHA256SUMS and discards a mismatched asset", () => withHome(async ({ home }) => {
  const kit = await buildReferenceKit(await inputs(home, synthetic()));
  const requested = [];
  const serve = tamper => async url => {
    const name = decodeURIComponent(new URL(url).pathname.split("/").pop()); requested.push(url);
    const bytes = await readFile(join(kit.dir, name)); if (name === tamper) bytes[bytes.length - 1] ^= 1;
    return new Response(bytes);
  };
  const good = join(home, "download-good");
  await downloadKit({ fetchImpl: serve(null), tag: TAG, dir: good, sumsSHA256: kit.sumsSHA256 });
  assert.ok(requested.every(u => u.startsWith(`https://github.com/RavBogard/bneimitzvah/releases/download/${TAG}/`)));
  assert.equal((await verifyKit({ dir: good, tag: TAG, sumsSHA256: kit.sumsSHA256 })).entries.size, 12);

  const bad = join(home, "download-bad");
  await assert.rejects(downloadKit({ fetchImpl: serve("clips-4-7.tar"), tag: TAG, dir: bad, sumsSHA256: kit.sumsSHA256 }), refusedWith("hash-mismatch"));
  assert.ok(!(await readdir(bad)).some(f => f.startsWith("clips-4-7.tar")), "no partial or mismatched file is kept");
  await assert.rejects(downloadKit({ fetchImpl: serve("SHA256SUMS"), tag: TAG, dir: join(home, "download-sums"), sumsSHA256: kit.sumsSHA256 }), refusedWith("hash-mismatch"));
  await assert.rejects(downloadKit({ fetchImpl: async () => new Response(null, { status: 404 }), tag: TAG, dir: join(home, "download-404"), sumsSHA256: kit.sumsSHA256 }), refusedWith("download"));
}));

test("uploads create-only, manifest last, keeps existing objects and stops on a differing one", () => withHome(async ({ home }) => {
  const kit = await buildReferenceKit(await inputs(home, synthetic()));
  const verified = await verifyKit({ dir: kit.dir, tag: TAG, sumsSHA256: kit.sumsSHA256 });
  const store = new Map(), order = [];
  const io = { head: async p => (store.has(p) ? { size: store.get(p).length } : null), put: async (p, bytes) => { assert.ok(!store.has(p), "never overwrites"); store.set(p, bytes); order.push(p); } };
  assert.deepEqual(await uploadKit({ dir: kit.dir, verified, io }), { created: 14, kept: 0 });
  assert.equal(order.at(-1), `reference-audio/short-v1/manifests/${kit.manifestSHA256}.json`);
  assert.equal(order.at(-2), `reference-audio/pockettorah/catalog/${kit.catalogSHA256}.json`);
  for (const [p, bytes] of store) if (p.endsWith(".mp3")) assert.equal(`reference-audio/short-v1/${sha(bytes)}.mp3`, p);
  assert.deepEqual(await uploadKit({ dir: kit.dir, verified, io }), { created: 0, kept: 14 });
  const first = order[0]; store.set(first, Buffer.alloc(1));
  await assert.rejects(uploadKit({ dir: kit.dir, verified, io }), refusedWith("remote-differs"));
  const failing = { head: async () => null, put: async () => { throw new Error("synthetic provider failure"); } };
  await assert.rejects(uploadKit({ dir: kit.dir, verified, io: failing }), /synthetic provider failure/);
}));

test("arguments, pins and token shape are checked before any work", () => {
  assert.throws(() => parseInstallArgs(["--tag", "reference-kit-v7"]), refusedWith("unpinned-tag"));
  assert.throws(() => parseInstallArgs(["--tag"]), refusedWith("arguments"));
  assert.throws(() => parseInstallArgs(["--dry-run", "--dry-run"]), refusedWith("arguments"));
  assert.equal(parseInstallArgs(["--dry-run"]).dryRun, true);
  assert.equal(storeIdFromToken("vercel_blob_" + "rw_" + "Synthetic01_abcDEF123"), "store_Synthetic01");
  assert.throws(() => storeIdFromToken("not-a-token"), refusedWith("token-shape"));
});

test("the CLIs print fixed codes and env names, never the token", () => withHome(async ({ home, env }) => {
  const data = synthetic(), kit = await buildReferenceKit(await inputs(home, data));
  const token = "vercel_blob_" + "rw_" + "Synthetic01_" + "s3cr3t".repeat(4);
  const args = [INSTALL, "--from", kit.dir, "--sums-sha256", kit.sumsSHA256, "--dry-run"];
  const ok = await run(process.execPath, args, { env: { ...env, BLOB_READ_WRITE_TOKEN: token } });
  assert.match(ok.stdout, /BLOB_STORE_ID=store_Synthetic01/);
  assert.match(ok.stdout, new RegExp(`REFERENCE_AUDIO_SHORT_MANIFEST_SHA256=${kit.manifestSHA256}`));
  assert.ok(!ok.stdout.includes(token) && !ok.stderr.includes(token) && !ok.stdout.includes("s3cr3t"));

  const missing = await run(process.execPath, [INSTALL, "--from", kit.dir, "--sums-sha256", kit.sumsSHA256], { env }).catch(e => e);
  assert.equal(missing.code, 1); assert.deepEqual(JSON.parse(missing.stdout), { ok: false, code: "token-missing" });
  const wrong = await run(process.execPath, [INSTALL, "--from", kit.dir, "--sums-sha256", "e".repeat(64), "--dry-run"], { env: { ...env, BLOB_READ_WRITE_TOKEN: token } }).catch(e => e);
  assert.deepEqual(JSON.parse(wrong.stdout), { ok: false, code: "sums-pin" }); assert.ok(!wrong.stdout.includes("s3cr3t"));

  const input = await inputs(home, data, { manifest: { ...data.manifest, schema: "reference-short-manifest/v2" } });
  const build = await run(process.execPath, [BUILD, "--catalog", input.catalog, "--manifest", input.manifest, "--clips", input.clips[0], "--out", input.out], { env }).catch(e => e);
  assert.equal(build.code, 1); assert.deepEqual(JSON.parse(build.stdout), { ok: false, code: "manifest-schema" });
}));
