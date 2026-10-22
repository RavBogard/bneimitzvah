#!/usr/bin/env node
// Private-input compiler. Never emit corpus records, paths or exception messages.
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, lstat, realpath, open } from "node:fs/promises";
import { resolve, join, dirname, basename } from "node:path";
import { pathToFileURL } from "node:url";
import { validateIndex, buildVerseDto, checkV2AgainstV1, INDEX_SCHEMA_V2 } from "./reference-index-contract.mjs";
import { verseCountsFrom } from "./reference-index-check.mjs";
import { insideGitWorkingTree } from "./private-paths.mjs";

const MAX_AUDIO = 32 * 1024 * 1024, MAX_CATALOG = 8 * 1024 * 1024;
const failure = () => new Error("Reference catalog compilation failed");
const plain = v => v && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype;
/** Pure conversion over independently measured audio facts. The CLI below measures
 * every original file itself; callers must not treat unverified facts as provenance. */
export function compileReferenceCatalog({ index, portalWords, archiveMetadata, audioFacts, v1Index = null }) {
  try {
    // A v2 index (refined word times) compiles only beside the v1 index it was refined from, so every
    // start's move window is measured from the real CTC onset.
    if (index?.schema === INDEX_SCHEMA_V2 ? !v1Index || !validateIndex(v1Index, { verseCounts: verseCountsFrom(portalWords) }).ok || checkV2AgainstV1(v1Index, index).length : v1Index !== null) throw failure();
    const validation = validateIndex(index, { verseCounts: verseCountsFrom(portalWords) });
    if (!validation.ok || validation.recordings.size > 600 || !plain(portalWords?.verses) || archiveMetadata?.metadata?.identifier !== "PockettorahAudioFiles" || !Array.isArray(archiveMetadata?.files) || !(audioFacts instanceof Map)) throw failure();
    const archive = new Map();
    for (const f of archiveMetadata.files) {
      if (!plain(f) || typeof f.name !== "string") continue;
      if (archive.has(f.name)) throw failure(); archive.set(f.name, f);
    }
    let cuts = 0;
    const assets = [...validation.recordings.values()].sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0).map(r => {
      const measured = audioFacts.get(r.archiveFile), original = archive.get(r.archiveFile);
      const bytes = typeof original?.size === "string" && /^(0|[1-9]\d*)$/.test(original.size) ? Number(original.size) : original?.size;
      if (!plain(measured) || !original || !Number.isSafeInteger(measured.bytes) || measured.bytes <= 0 || measured.bytes > MAX_AUDIO
        || measured.bytes !== bytes || !/^[a-f0-9]{64}$/.test(measured.sha256) || !/^[a-f0-9]{32}$/.test(measured.md5)
        || typeof original.md5 !== "string" || original.md5.toLowerCase() !== measured.md5) throw failure();
      const id = "ra_" + createHash("sha256").update(`${r.key}\0${r.archiveFile}\0${measured.sha256}`).digest("hex").slice(0, 32);
      const verses = r.verses.map(verse => {
        if (++cuts > 10000) throw failure();
        const p = Object.hasOwn(portalWords.verses, verse.ref) ? portalWords.verses[verse.ref] : null;
        return buildVerseDto({ recording: r, verse, asset: { approved: true, assetId: id },
          portal: plain(p) && p.status === "ready" ? { status: "ready", words: p.words, readingText: p.readingText } : { status: "unavailable" } });
      });
      return { id, archiveFile: r.archiveFile, sha256: measured.sha256, bytes: measured.bytes, verses };
    });
    const catalog = { schema: "reference-catalog/v1", source: "PockettorahAudioFiles", assets };
    const text = JSON.stringify(catalog);
    if (Buffer.byteLength(text) > MAX_CATALOG || /[\u0590-\u05ff]/u.test(text)) throw failure();
    return { catalog, text, summary: { ok: true, assets: assets.length, cuts, bytes: Buffer.byteLength(text), catalogSha256: createHash("sha256").update(text).digest("hex") } };
  } catch { throw failure(); }
}
export function parseCompileArgs(args) {
  // --v1-index is required with a v2 index and refused with a v1 index (compileReferenceCatalog).
  const names = ["--index", "--portal-words", "--archive-metadata", "--audio", "--out", "--v1-index"], result = {};
  if (args.length !== 10 && args.length !== 12) throw failure();
  for (let i = 0; i < args.length; i += 2) { if (!names.includes(args[i]) || Object.hasOwn(result, args[i]) || !args[i + 1] || args[i + 1].startsWith("--")) throw failure(); result[args[i]] = resolve(args[i + 1]); }
  if (names.slice(0, 5).some(n => !Object.hasOwn(result, n))) throw failure();
  return result;
}
async function privateRegular(path, cap) {
  if (await insideGitWorkingTree(path)) throw failure();
  const stat = await lstat(path); if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0 || stat.size > cap) throw failure();
  return path;
}
export async function compileReferenceCatalogFiles(args) {
  try {
    const paths = parseCompileArgs(args);
    for (const path of Object.values(paths)) if (await insideGitWorkingTree(path)) throw failure();
    const audio = paths["--audio"], out = paths["--out"];
    const stat = await lstat(audio); if (!stat.isDirectory() || stat.isSymbolicLink()) throw failure();
    const resolvedAudio = await realpath(audio), parent = await realpath(dirname(out));
    if (await insideGitWorkingTree(parent) || basename(out) === ".git") throw failure();
    const json = async (path, cap) => { await privateRegular(path, cap); const bytes = await readFile(path); if (bytes.length > cap) throw failure(); return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/, "")); };
    const index = await json(paths["--index"], 32 * 1024 * 1024), portalWords = await json(paths["--portal-words"], 32 * 1024 * 1024), archiveMetadata = await json(paths["--archive-metadata"], 8 * 1024 * 1024);
    const v1Index = paths["--v1-index"] ? await json(paths["--v1-index"], 32 * 1024 * 1024) : null;
    const v = validateIndex(index, { verseCounts: verseCountsFrom(portalWords) }); if (!v.ok || v.recordings.size > 600) throw failure();
    const audioFacts = new Map();
    for (const r of v.recordings.values()) {
      const path = join(resolvedAudio, r.archiveFile); await privateRegular(path, MAX_AUDIO);
      if (dirname(await realpath(path)) !== resolvedAudio) throw failure();
      const before = await lstat(path), sha = createHash("sha256"), md5 = createHash("md5"); let bytes = 0;
      for await (const chunk of createReadStream(path)) { bytes += chunk.length; if (bytes > MAX_AUDIO) throw failure(); sha.update(chunk); md5.update(chunk); }
      const after = await lstat(path);
      if (before.size !== bytes || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ino !== before.ino) throw failure();
      audioFacts.set(r.archiveFile, { bytes, sha256: sha.digest("hex"), md5: md5.digest("hex") });
    }
    const result = compileReferenceCatalog({ index, portalWords, archiveMetadata, audioFacts, v1Index });
    // Exclusive create only after ALL inputs, hashes, crosswalks and bounds pass.
    const file = await open(out, "wx", 0o600); try { await file.writeFile(result.text, "utf8"); } finally { await file.close(); }
    return result.summary;
  } catch { throw failure(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { console.log(JSON.stringify(await compileReferenceCatalogFiles(process.argv.slice(2)))); }
  catch { console.log(JSON.stringify({ ok: false, code: "reference-catalog-unavailable" })); process.exitCode = 1; }
}
