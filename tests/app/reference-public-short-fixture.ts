import { createHash } from "node:crypto";
import { REFERENCE_ATTRIBUTION } from "../../src/lib/reference-audio/contract";
import { SHORT_SOURCE_ATTRIBUTION, SHORT_SOURCE_RECIPE } from "../../src/lib/reference-audio/short-source";
import { SHORT_SOURCE_FFMPEG_TAGS } from "../../src/lib/reference-audio/short-source-tags";

export const publicOrigin = "https://beitmitzvah.centralreform.org";
export const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const json = (v: unknown) => new TextEncoder().encode(JSON.stringify(v));
export function publicShortFixture(change?: (body: Uint8Array, info: number) => void) {
  // Synthetic frame structures only; no rendered/real source audio in Git.
  const t = SHORT_SOURCE_FFMPEG_TAGS, fields = [["TIT2", t.title], ["TPE1", t.artist], ["TCOP", t.copyright], ["TXXX", `comment\0${t.comment}`], ["TENC", t.encoded_by], ["TXXX", `source\0${t.source}`], ["TSSE", "Lavf63.1.101"]];
  const set32 = (b: Uint8Array, p: number, v: number) => new DataView(b.buffer).setUint32(p, v);
  const put = (b: Uint8Array, p: number, text: string) => b.set(new TextEncoder().encode(text), p);
  const tags = fields.map(([id, text]) => { const b = new Uint8Array(12 + text.length); put(b, 0, id); set32(b, 4, text.length + 2); put(b, 11, text); return b; });
  const tagSize = tags.reduce((n, b) => n + b.length, 10), start = 10 + tagSize, count = 35, frames = 19200;
  const body = new Uint8Array(start + 192 * (count + 1)); put(body, 0, "ID3"); body[3] = 3; body[8] = tagSize >>> 7; body[9] = tagSize & 127;
  let p = 10; for (const tag of tags) { body.set(tag, p); p += tag.length; }
  for (let i = 0; i <= count; i++) set32(body, start + i * 192, 0xfff384c0);
  const info = start + 13, encoder = info + 120; put(body, info, "Info"); set32(body, info + 4, 15); set32(body, info + 8, count); set32(body, info + 12, body.length - start);
  for (let i = 0; i < 100; i++) body[info + 16 + i] = Math.floor(i * 256 / 100);
  put(body, encoder, "Lavc63.1."); const padding = count * 576 - 576 - frames; body[encoder + 21] = 36; body[encoder + 22] = padding >>> 8; body[encoder + 23] = padding & 255; set32(body, encoder + 28, body.length - start);
  change?.(body, info);
  const asset = `ra_${"1".repeat(32)}`, parentSHA = "a".repeat(64), parent = json({ schema: "reference-catalog/v1", source: "PockettorahAudioFiles", assets: [{ id: asset, archiveFile: "Synthetic-1.mp3", sha256: parentSHA, bytes: 7,
    verses: [{ schema: "reference-verse/v1", ref: "Genesis 1:1", table: "torah", playback: { status: "ready", asset, clip: { start: 0, end: 0.8 } }, words: { status: "unavailable", reason: "no-words" }, attribution: REFERENCE_ATTRIBUTION }] }] });
  const hash = sha(body), parentCatalogSHA256 = sha(parent), source = { schema: "reference-short-source/v1", id: `rs_${hash}`, parent: { asset, sha256: parentSHA, bytes: 7 }, sha256: hash, bytes: body.length, path: `/reference-audio/short-v1/${hash}.mp3`,
    codec: "mp3", bitrate: 64000, sampleRate: 24000, channels: 1, presentationFrames: frames, origin: { firstFrame: 0, parentRate: 24000 }, attributionVersion: SHORT_SOURCE_ATTRIBUTION.version };
  const manifest = json({ schema: "reference-short-manifest/v1", source: "PockettorahAudioFiles", parentCatalogSHA256, recipe: SHORT_SOURCE_RECIPE, attribution: SHORT_SOURCE_ATTRIBUTION, entries: [source] });
  const manifestSHA256 = sha(manifest), parentKey = `reference-audio/pockettorah/catalog/${parentCatalogSHA256}.json`, manifestKey = `reference-audio/short-v1/manifests/${manifestSHA256}.json`, bodyKey = source.path.slice(1);
  const files = new Map([[parentKey, parent], [manifestKey, manifest], [bodyKey, body]]);
  return { parent, manifest, body, hash, source, parentCatalogSHA256, manifestSHA256, parentKey, manifestKey, bodyKey, files, origin: publicOrigin };
}
export const byteStream = (bytes: Uint8Array) => new ReadableStream<Uint8Array>({ start(c) { c.enqueue(bytes); c.close(); } });
