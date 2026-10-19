#!/usr/bin/env node
// Offline only. Never print private records, paths, audio, stderr or exceptions.
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { readFile, writeFile, open, stat, lstat, realpath, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { pipeline } from "node:stream/promises";
import { Transform, Writable } from "node:stream";
import { dirname, join, resolve, relative, isAbsolute, basename, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { insideGitWorkingTree } from "./private-paths.mjs";
import { isolatedEnv } from "../tests/helpers/isolatedEnv.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), ".."), MiB = 1024 * 1024;
const hash = value => createHash("sha256").update(value).digest("hex"), digest = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const ENTRIES = ["src/server/reference-audio/short-source-build.ts", "src/lib/reference-audio/short-source-tags.ts", "src/server/reference-audio/short-source-body.ts", "src/server/reference-audio/short-source-gapless.ts"];
const REQUIRED = ["scripts/reference-short-build.mjs", "scripts/private-paths.mjs", "tests/helpers/isolatedEnv.mjs", ...ENTRIES];
const fail = code => { throw Object.assign(new Error("Offline short build refused"), { code }); };
const exact = (value, keys) => {
  if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype || Reflect.ownKeys(value).length !== keys.length) fail("configuration");
  const result = {};
  for (const key of keys) { const field = Object.getOwnPropertyDescriptor(value, key); if (!field || !Object.hasOwn(field, "value")) fail("configuration"); result[key] = field.value; }
  return result;
};
const within = (root, path) => { const r = relative(root, path); return r !== "" && !r.startsWith("..") && !isAbsolute(r); };
async function noLinks(path) { if (typeof path !== "string" || resolve(path).startsWith("\\\\")) fail("path"); for (let p = resolve(path); ; p = dirname(p)) { const s = await lstat(p); if (s.isSymbolicLink()) fail("path"); if (dirname(p) === p) break; } }
async function regular(path, cap, external = false, allowEmpty = false) {
  path = resolve(path); await noLinks(path); const s = await lstat(path);
  if (!s.isFile() || s.size < (allowEmpty ? 0 : 1) || s.size > cap || external && await insideGitWorkingTree(path)) fail("path");
  return await realpath(path);
}
async function fileHash(path, cap) {
  const before = await stat(path), sha = createHash("sha256"); let bytes = 0;
  for await (const chunk of createReadStream(path)) { bytes += chunk.length; if (bytes > cap) fail("budget"); sha.update(chunk); }
  const after = await stat(path);
  if (before.size !== bytes || after.size !== bytes || before.ino !== after.ino || before.mtimeMs !== after.mtimeMs) fail("changed-input");
  return { sha256: sha.digest("hex"), bytes };
}
async function readBounded(path, cap) {
  const file = await open(path, "r"), buffer = Buffer.alloc(cap + 1); let size = 0;
  try { while (size <= cap) { const result = await file.read(buffer, size, buffer.length - size, size); if (!result.bytesRead) break; size += result.bytesRead; }
    if (size > cap) fail("budget"); return Buffer.from(buffer.subarray(0, size));
  } finally { await file.close(); }
}
async function inventory(folder) {
  const result = [];
  async function walk(path) { for (const e of await readdir(path, { withFileTypes: true })) { const p = join(path, e.name); if (e.isSymbolicLink()) fail("source-pin"); if (e.isDirectory()) await walk(p); else if (e.isFile()) result.push(p); } }
  await walk(folder); return result;
}
export function shortBuildCompilerArgs(out, listOnly = false) {
  return ["--ignoreConfig", "--module", "node20", "--moduleResolution", "node16", "--target", "es2022", "--esModuleInterop", "--skipLibCheck", "--strict", "--noEmitOnError",
    "--rootDir", ROOT, "--types", "node", "--lib", "ESNext,DOM", ...(listOnly ? ["--listFilesOnly"] : ["--outDir", out, "--listFiles", "--listEmittedFiles"]), ...ENTRIES];
}
async function run(path, args, env, options = {}) {
  const cap = options.cap ?? 512 * 1024; let count = 0, errorBytes = 0, written = 0, child;
  const collected = options.file ? null : Buffer.alloc(cap);
  const collector = new Transform({ transform(chunk, _encoding, done) { count += chunk.length; if (count > cap) return done(new Error("bounded output")); done(null, chunk); } });
  const exited = new Promise((done, reject) => {
    child = spawn(path, args, { cwd: ROOT, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    child.once("error", reject); child.once("exit", (code, signal) => code === 0 && !signal ? done() : reject(new Error("child refused")));
  });
  child.stderr.on("data", value => { errorBytes += value.length; if (errorBytes > 64 * 1024) child.kill(); });
  const timer = setTimeout(() => child.kill(), options.timeout ?? 30000);
  const streamed = options.file ? pipeline(child.stdout, collector, createWriteStream(options.file, { flags: "wx", mode: 0o600 }))
    : pipeline(child.stdout, collector, new Writable({ write(chunk, _encoding, done) { collected.set(chunk, written); written += chunk.length; done(); } }));
  try { await Promise.all([exited, streamed]); return options.file ? { bytes: count } : collected.subarray(0, count); }
  catch { child.kill(); await Promise.allSettled([exited, streamed]); fail("child"); }
  finally { clearTimeout(timer); }
}
async function removeOwned(path, parent) {
  if (!path) return true;
  const physical = await realpath(path); if (!within(await realpath(parent), physical) || physical !== resolve(path) || (await lstat(path)).isSymbolicLink()) fail("cleanup");
  await rm(physical, { recursive: true }); try { await lstat(path); return false; } catch (e) { return e.code === "ENOENT"; }
}

// The same builtin-only preflight runs inside the actual react-server child,
// before any compiled module can evaluate a bare server-only import.
export async function verifyShortBuildServerOnly(importers, expected) {
  for (const importer of importers) {
    const selected = createRequire(importer).resolve("server-only");
    if (resolve(selected) !== expected.emptyFile || await realpath(selected) !== expected.emptyFile || !(await lstat(selected)).isFile()) throw new Error("Server-only resolution refused");
    const packageFile = join(dirname(selected), "package.json");
    if (packageFile !== expected.packageFile || await realpath(packageFile) !== expected.packageFile || !(await lstat(packageFile)).isFile()) throw new Error("Server-only package refused");
    for (const [path, sha] of [[selected, expected.emptySHA256], [packageFile, expected.packageSHA256]]) if (createHash("sha256").update(await readFile(path)).digest("hex") !== sha) throw new Error("Server-only pin refused");
  }
}
export function parseShortBuildSelectionSnapshot(snapshot, expectedSHA256, parentSHA256) {
  if (!(snapshot instanceof Uint8Array) || snapshot.byteLength > 8 * MiB || hash(snapshot) !== expectedSHA256) fail("input-pin");
  const input = exact(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(snapshot)), ["schema", "parentCatalogSHA256", "selections"]);
  if (input.schema !== "reference-short-build-input/v1" || input.parentCatalogSHA256 !== parentSHA256 || !Array.isArray(input.selections) || !input.selections.length || input.selections.length > 10000) fail("selection");
  const unique = new Set(); for (const s of input.selections) { exact(s, ["asset", "ref"]); if (typeof s.asset !== "string" || typeof s.ref !== "string" || unique.has(`${s.asset}\0${s.ref}`)) fail("selection"); unique.add(`${s.asset}\0${s.ref}`); }
  return input;
}
export async function prepareShortBuildOutputPath(path, audioRoot) {
  const output = resolve(path), lexicalParent = dirname(output); await noLinks(lexicalParent);
  if (await realpath(lexicalParent) !== lexicalParent || await insideGitWorkingTree(output) || basename(output).startsWith(".") || output === audioRoot || within(audioRoot, output)) fail("path");
  try { await lstat(output); fail("output-exists"); } catch (e) { if (e.code !== "ENOENT") throw e; }
  return output;
}

// Static trusted bridge: genuine compiled planner/manifest/body modules, real
// server-only condition. No SDK context, alias or public schema reimplementation.
export const SHORT_BUILD_WORKER = String.raw`
import {createRequire} from 'node:module';import{readFile,writeFile,open,realpath,lstat}from'node:fs/promises';import{join,dirname,resolve}from'node:path';import{createHash}from'node:crypto';
const verifyShortBuildServerOnly=${verifyShortBuildServerOnly.toString()};
const r=createRequire(import.meta.url),q=JSON.parse(await readFile(process.argv[1],'utf8')),at=p=>join(q.compiled,p),sha=b=>createHash('sha256').update(b).digest('hex');
async function shortBytes(path){const f=await open(path,'r'),b=Buffer.alloc(1048577);let n=0;try{while(n<b.length){const v=await f.read(b,n,b.length-n,n);if(!v.bytesRead)break;n+=v.bytesRead;}if(n>1048576)throw Error('raw-budget');return b.subarray(0,n);}finally{await f.close();}}
await verifyShortBuildServerOnly(['short-source-build','short-source-manifest','short-source-body','short-source-gapless','catalog'].map(n=>at('src/server/reference-audio/'+n+'.js')),q.serverOnly);
const tags=r(at('src/lib/reference-audio/short-source-tags.js')),core=r(at('src/server/reference-audio/short-source-build.js')),manifest=r(at('src/server/reference-audio/short-source-manifest.js')),body=r(at('src/server/reference-audio/short-source-body.js')),gapless=r(at('src/server/reference-audio/short-source-gapless.js')),catalog=r(at('src/server/reference-audio/catalog.js')),source=r(at('src/lib/reference-audio/short-source.js'));
if(q.mode==='policy'){console.log(JSON.stringify({tagArgs:tags.shortSourceFFmpegMetadataArgs(),recipe:source.SHORT_SOURCE_RECIPE}));}
else if(q.mode==='normalize'){const b=await shortBytes(q.raw);if(b.length!==q.rawBytes||sha(b)!==q.rawSHA)throw Error('raw-pin');const n=gapless.normalizeShortSourceGapless(b,{sampleRate:q.sampleRate,channels:q.channels,physicalFrames:q.physicalFrames});await writeFile(q.normalized,n.bytes,{flag:'wx',mode:0o600});console.log(JSON.stringify({audit:n.audit}));}
else{const parentBytes=await readFile(q.parent);if(sha(parentBytes)!==q.parentSHA)throw Error('pin');
if(q.mode==='select'){const c=catalog.parseReferenceCatalog(JSON.parse(parentBytes));if(!c)throw Error('catalog');const selected=q.selections.map(s=>{const a=c.assets.find(a=>a.id===s.asset),v=a?.verses.find(v=>v.ref===s.ref);if(!a||!v||v.playback.status!=='ready')throw Error('selection');return{asset:a.id,parentSHA256:a.sha256,parentBytes:a.bytes,archiveFile:a.archiveFile,ref:v.ref,clip:v.playback.clip};});console.log(JSON.stringify({selected}));}
else{const plan=await core.planShortSourceBuild({parentCatalogBytes:parentBytes,parentCatalogSHA256:q.parentSHA,facts:q.facts});if(plan.status!=='planned')throw Error('plan');const b=new TextEncoder().encode(plan.manifestJSON),m=await manifest.createShortSourceManifestLoader({sha256:plan.manifestSHA256,parentCatalogSHA256:q.parentSHA,parentCatalogBytes:parentBytes,get:async()=>new ReadableStream({start(c){c.enqueue(b);c.close();}})})();let verified=0;for(const file of q.bodies){const e=manifest.lookupShortSource(m,'rs_'+file.sha256);const proof=body.verifyShortSourceBody(e,new Uint8Array(await readFile(file.path)));body.readVerifiedShortSourceBody(proof);verified++;}console.log(JSON.stringify({manifestJSON:plan.manifestJSON,manifestSHA256:plan.manifestSHA256,verified}));}}
`;

/** Config selects exact public source/tool pins and external private inputs.
 * No automatic source selection, env credentials, network or publication.
 */
export async function buildReferenceShort(supplied) {
  let phase = "configuration", config, iso, runtime, work, output, outputCreated = false, ok = false, code = null;
  let sourcePins, tools, parentInput, selectionInput, compilerFiles = [], policy, selected = [], cuts = [], manifestSHA256, versions;
  const cleanup = { work: true, runtime: true, home: true }; let preserved = false;
  const started = Date.now(), live = () => { if (Date.now() - started > 30 * 60000) fail("deadline"); };
  try {
    config = exact(supplied, ["sourceCommit", "sourcePins", "tools", "parentCatalog", "input", "audioRoot", "outputDir"]);
    if (typeof config.sourceCommit !== "string" || !/^[a-f0-9]{40}$/.test(config.sourceCommit) || !Array.isArray(config.sourcePins) || config.sourcePins.length < REQUIRED.length || config.sourcePins.length > 5000) fail("source-pin");
    sourcePins = new Map();
    for (const raw of config.sourcePins) {
      const p = exact(raw, ["path", "sha256"]); if (typeof p.path !== "string" || isAbsolute(p.path) || !digest(p.sha256) || sourcePins.has(p.path)) fail("source-pin");
      const path = resolve(ROOT, p.path); if (!within(ROOT, path) || relative(ROOT, path).replaceAll("\\", "/") !== p.path) fail("source-pin");
      sourcePins.set(p.path, p.sha256);
    }
    phase = "source-pins";
    const verifySources = async () => { for (const [path, expected] of sourcePins) { const file = await regular(join(ROOT, path), 256 * MiB, false, true); if ((await fileHash(file, 256 * MiB)).sha256 !== expected) fail("source-pin"); } };
    for (const path of REQUIRED) if (!sourcePins.has(path)) fail("source-pin"); await verifySources();
    phase = "tool-pins"; tools = exact(config.tools, ["node", "compiler", "ffmpeg", "ffprobe"]);
    for (const [name, raw] of Object.entries(tools)) {
      const t = exact(raw, ["path", "sha256"]); if (!digest(t.sha256)) fail("tool-pin"); t.path = await regular(t.path, 256 * MiB);
      if ((await fileHash(t.path, 256 * MiB)).sha256 !== t.sha256) fail("tool-pin"); tools[name] = t;
    }
    if (tools.node.path !== await realpath(process.execPath)) fail("tool-pin");
    const nativeFolder = join(ROOT, "node_modules", `@typescript/typescript-${process.platform}-${process.arch}`);
    const nativeCompilers = (await inventory(nativeFolder)).filter(path => basename(path) === (process.platform === "win32" ? "tsc.exe" : "tsc"));
    if (nativeCompilers.length !== 1 || tools.compiler.path !== await realpath(nativeCompilers[0])) fail("tool-pin");
    for (const folder of ["typescript", `@typescript/typescript-${process.platform}-${process.arch}`, "server-only"]) {
      for (const path of await inventory(join(ROOT, "node_modules", folder))) if (!sourcePins.has(relative(ROOT, path).replaceAll("\\", "/"))) fail("source-pin");
    }
    iso = await isolatedEnv({ CI: "1" }); phase = "source-selection";
    const head = () => run("git", ["rev-parse", "HEAD"], iso.env, { cap: 1024, timeout: 10000 });
    if ((await head()).toString().trim() !== config.sourceCommit) fail("source-selection");
    phase = "path";
    const pinnedInput = async raw => { const p = exact(raw, ["path", "sha256"]); if (!digest(p.sha256)) fail("input-pin"); p.path = await regular(p.path, 8 * MiB, true); if ((await fileHash(p.path, 8 * MiB)).sha256 !== p.sha256) fail("input-pin"); return p; };
    parentInput = await pinnedInput(config.parentCatalog); selectionInput = await pinnedInput(config.input);
    const audio = resolve(config.audioRoot); await noLinks(audio); if (!(await lstat(audio)).isDirectory() || await insideGitWorkingTree(audio)) fail("path"); const audioRoot = await realpath(audio);
    output = await prepareShortBuildOutputPath(config.outputDir, audioRoot);
    const selectionSnapshot = await readBounded(selectionInput.path, 8 * MiB);
    const input = parseShortBuildSelectionSnapshot(selectionSnapshot, selectionInput.sha256, parentInput.sha256);
    phase = "compile"; await mkdir(join(ROOT, ".local-logs"), { recursive: true }); await noLinks(join(ROOT, ".local-logs")); runtime = await mkdtemp(join(ROOT, ".local-logs/reference-short-runtime-"));
    const log = (await run(tools.compiler.path, shortBuildCompilerArgs(runtime), iso.env, { timeout: 60000 })).toString();
    compilerFiles = [...new Set(log.split(/\r?\n/).filter(p => /^[A-Za-z]:[\\/]|^\//.test(p)))];
    for (const path of compilerFiles) { const key = relative(ROOT, path).replaceAll("\\", "/"); if (!sourcePins.has(key) || (await fileHash(await regular(path, 256 * MiB, false, true), 256 * MiB)).sha256 !== sourcePins.get(key)) fail("source-pin"); }
    await verifySources();
    await mkdir(output, { mode: 0o700 }); outputCreated = true; work = await mkdtemp(join(output, ".work-"));
    const parentSnapshot = join(work, "parent-catalog.json"); await writeFile(parentSnapshot, await readBounded(parentInput.path, 8 * MiB), { flag: "wx", mode: 0o600 });
    const serverOnly = { emptyFile: await realpath(join(ROOT, "node_modules/server-only/empty.js")), packageFile: await realpath(join(ROOT, "node_modules/server-only/package.json")), emptySHA256: sourcePins.get("node_modules/server-only/empty.js"), packageSHA256: sourcePins.get("node_modules/server-only/package.json") };
    const worker = async request => { live(); const path = join(work, `request-${worker.calls++}.json`); await writeFile(path, JSON.stringify({ ...request, serverOnly, compiled: runtime, parent: parentSnapshot, parentSHA: parentInput.sha256 }), { flag: "wx", mode: 0o600 });
      return JSON.parse((await run(tools.node.path, ["--conditions=react-server", "--input-type=module", "-e", SHORT_BUILD_WORKER, path], iso.env, { cap: 16 * MiB, timeout: 60000 })).toString()); }; worker.calls = 0;
    phase = "selection"; policy = await worker({ mode: "policy" }); if (!Array.isArray(policy.tagArgs) || policy.tagArgs.length > 32) fail("metadata");
    selected = (await worker({ mode: "select", selections: input.selections })).selected;
    versions = { node: process.version, compiler: (await run(tools.compiler.path, ["--version"], iso.env)).toString().trim(), ffmpeg: (await run(tools.ffmpeg.path, ["-version"], iso.env)).toString().split(/\r?\n/)[0], ffprobe: (await run(tools.ffprobe.path, ["-version"], iso.env)).toString().split(/\r?\n/)[0] };
    const grouped = new Map(); for (const s of selected) { if (!grouped.has(s.asset)) grouped.set(s.asset, []); grouped.get(s.asset).push(s); }
    for (const group of grouped.values()) {
      live(); phase = "parent-pin"; const s = group[0], parent = await regular(join(audioRoot, s.archiveFile), 32 * MiB, true);
      if (dirname(parent) !== audioRoot) fail("path"); const original = await fileHash(parent, 32 * MiB); if (original.sha256 !== s.parentSHA256 || original.bytes !== s.parentBytes) fail("parent-pin");
      const parentCopy = join(work, `parent-${cuts.length}.mp3`); await pipeline(createReadStream(parent, { end: original.bytes - 1 }), createWriteStream(parentCopy, { flags: "wx", mode: 0o600 })); if ((await fileHash(parentCopy, 32 * MiB)).sha256 !== s.parentSHA256) fail("parent-pin");
      const probe = JSON.parse((await run(tools.ffprobe.path, ["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=sample_rate,channels", "-of", "json", parentCopy], iso.env)).toString()), rate = Number(probe.streams[0].sample_rate), channels = Number(probe.streams[0].channels);
      if (!Number.isSafeInteger(rate) || rate < 1 || rate > 48000 || ![1, 2].includes(channels)) fail("profile");
      phase = "decode"; const pcm = join(work, `parent-${cuts.length}.pcm`); await run(tools.ffmpeg.path, ["-v", "error", "-i", parentCopy, "-map", "0:a:0", "-f", "s16le", "-c:a", "pcm_s16le", "-"], iso.env, { file: pcm, cap: 512 * MiB, timeout: 120000 });
      const pcmBytes = (await stat(pcm)).size, parentFrames = pcmBytes / (channels * 2); if (!Number.isSafeInteger(parentFrames)) fail("geometry");
      for (const selection of group) {
        live(); phase = "capacity"; const firstFrame = Math.floor(selection.clip.start * rate), lastExclusive = Math.ceil(selection.clip.end * rate), frames = lastExclusive - firstFrame;
        if (!Number.isSafeInteger(firstFrame) || firstFrame < 0 || lastExclusive > parentFrames || frames < 1) fail("capacity"); if (frames > rate * 75) fail("profile");
        const cut = join(work, `cut-${cuts.length}.pcm`); await pipeline(createReadStream(pcm, { start: firstFrame * channels * 2, end: lastExclusive * channels * 2 - 1 }), createWriteStream(cut, { flags: "wx", mode: 0o600 }));
        const canonical = await fileHash(cut, 15 * MiB); if (canonical.bytes !== frames * channels * 2) fail("geometry");
        phase = "encode"; const rawEncoded = join(work, `raw-${cuts.length}.mp3`), encoded = join(work, `cut-${cuts.length}.mp3`);
        await run(tools.ffmpeg.path, ["-v", "error", "-n", "-f", "s16le", "-ar", String(rate), "-ac", String(channels), "-i", cut, "-map_metadata", "-1", "-codec:a", "libmp3lame", "-b:a", "64k", "-id3v2_version", "3", "-write_id3v1", "0", "-write_xing", "1", ...policy.tagArgs, rawEncoded], iso.env);
        const rawFact = await fileHash(rawEncoded, MiB); phase = "normalize";
        const normalized = await worker({ mode: "normalize", raw: rawEncoded, rawSHA: rawFact.sha256, rawBytes: rawFact.bytes, normalized: encoded, sampleRate: rate, channels, physicalFrames: frames });
        const encodedFact = await fileHash(encoded, MiB), audit = normalized.audit;
        if (audit.physicalFrames !== frames || audit.original.sha256 !== rawFact.sha256 || audit.original.bytes !== rawFact.bytes || audit.normalized.sha256 !== encodedFact.sha256 || audit.normalized.bytes !== encodedFact.bytes || audit.normalized.checksum !== "strict") fail("normalization");
        const normalization = Object.freeze({ ...audit, schema: "reference-short-normalization/v1", normalizerSHA256: sourcePins.get("src/server/reference-audio/short-source-gapless.ts"),
          original: Object.freeze({ ...audit.original }), normalized: Object.freeze({ ...audit.normalized }), changedOffsets: Object.freeze([...audit.changedOffsets]) });
        phase = "roundtrip";
        const measured = JSON.parse((await run(tools.ffprobe.path, ["-v", "error", "-select_streams", "a:0", "-show_streams", "-show_format", "-show_packets", "-show_entries", "stream=codec_name,sample_rate,channels,bit_rate:format_tags:packet=side_data_list:packet_side_data=side_data_type,skip_samples,discard_padding", "-of", "json", encoded], iso.env)).toString());
        const stream = measured.streams[0], padding = measured.packets.flatMap(p => p.side_data_list ?? []).filter(p => p.side_data_type === "Skip Samples").map(p => ({ skipSamples: p.skip_samples, discardPadding: p.discard_padding }));
        if (stream.codec_name !== "mp3" || Number(stream.sample_rate) !== rate || stream.channels !== channels || Number(stream.bit_rate) !== 64000 || !padding.some(p => p.skipSamples > 0) || !padding.some(p => p.discardPadding >= 0)) fail("profile");
        const decoded = join(work, `roundtrip-${cuts.length}.f32`); await run(tools.ffmpeg.path, ["-v", "error", "-i", encoded, "-f", "f32le", "-c:a", "pcm_f32le", "-"], iso.env, { file: decoded, cap: 28800000 });
        if ((await stat(decoded)).size !== frames * channels * 4) fail("geometry");
        const destination = join(output, `${encodedFact.sha256}.mp3`); await pipeline(createReadStream(encoded, { end: encodedFact.bytes - 1 }), createWriteStream(destination, { flags: "wx", mode: 0o600 }));
        if ((await fileHash(rawEncoded, MiB)).sha256 !== rawFact.sha256) fail("changed-output");
        cuts.push({ selection, firstFrame, lastExclusive, parentFrames, canonicalPCM16SHA256: canonical.sha256, normalization, padding, body: { path: destination, sha256: encodedFact.sha256 },
          fact: { parentAsset: s.asset, parentSHA256: s.parentSHA256, parentBytes: s.parentBytes, sampleRate: rate, channels, parentFrames, clip: selection.clip,
            encoded: { ...encodedFact, codec: "mp3", bitrate: 64000, sampleRate: rate, channels, presentationFrames: frames, recipe: policy.recipe } } });
        await rm(cut); await rm(rawEncoded); await rm(encoded); await rm(decoded);
      }
      if ((await fileHash(parent, 32 * MiB)).sha256 !== s.parentSHA256) fail("changed-input"); await rm(parentCopy); await rm(pcm);
    }
    phase = "body-validation"; const result = await worker({ mode: "plan", facts: cuts.map(c => c.fact), bodies: cuts.map(c => c.body) }); if (result.verified !== cuts.length) fail("body-validation");
    phase = "final-pins"; await verifySources(); for (const t of Object.values(tools)) if ((await fileHash(t.path, 256 * MiB)).sha256 !== t.sha256) fail("tool-pin");
    if ((await head()).toString().trim() !== config.sourceCommit) fail("source-selection");
    for (const p of [parentInput, selectionInput]) if ((await fileHash(p.path, 8 * MiB)).sha256 !== p.sha256) fail("changed-input");
    for (const c of cuts) if ((await fileHash(c.body.path, MiB)).sha256 !== c.body.sha256) fail("changed-output"); preserved = true;
    manifestSHA256 = result.manifestSHA256;
    await writeFile(join(output, "manifest.json"), result.manifestJSON, { flag: "wx", mode: 0o600 });
    await writeFile(join(output, "private-provenance.json"), JSON.stringify({ sourceCommit: config.sourceCommit, sourcePins: [...sourcePins].map(([path, sha256]) => ({ path, sha256 })), tools, versions, compilerFiles,
      parentCatalogSHA256: parentInput.sha256, inputSHA256: selectionInput.sha256, recipe: policy.recipe, geometry: "floor-start-ceil-exclusive-end/v1", cuts, manifestSHA256, bodyVerifiedCount: result.verified, publication: false }, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    ok = true;
  } catch (error) { code = typeof error?.code === "string" && /^[a-z-]{1,32}$/.test(error.code) ? error.code : phase; }
  finally {
    try { cleanup.work = await removeOwned(work, output); } catch { cleanup.work = false; }
    try { cleanup.runtime = await removeOwned(runtime, join(ROOT, ".local-logs")); } catch { cleanup.runtime = false; }
    try { if (iso) { const path = iso.home; if (await insideGitWorkingTree(path)) fail("cleanup"); await iso.cleanup(); try { await lstat(path); cleanup.home = false; } catch (e) { cleanup.home = e.code === "ENOENT"; } } } catch { cleanup.home = false; }
  }
  if (Object.values(cleanup).some(v => !v)) { ok = false; code = "cleanup"; }
  const report = { ok, code: ok ? null : code, phase, parents: new Set(selected.map(s => s.asset)).size, cuts: cuts.length, manifestSHA256: ok ? manifestSHA256 : null, inputsAndSourcePreserved: preserved, cleanup, publication: false };
  if (outputCreated) { try { await writeFile(join(output, "build-report.json"), JSON.stringify(report) + "\n", { flag: "wx", mode: 0o600 }); } catch { report.ok = false; report.code = "report"; } }
  return Object.freeze(report);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  let report; try { if (process.argv.length !== 4 || process.argv[2] !== "--config") fail("configuration"); const path = await regular(process.argv[3], 2 * MiB, true); report = await buildReferenceShort(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await readBounded(path, 2 * MiB)))); }
  catch { report = { ok: false, code: "configuration", publication: false }; }
  console.log(JSON.stringify(report)); if (!report.ok) process.exitCode = 1;
}
