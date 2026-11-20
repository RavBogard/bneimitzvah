import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

export const SHERMET_LIBRARY_FILE = "src/server/shermet-audio/nonverse-catalog.json";
export const SHERMET_METADATA_REASON = "invalid Shermet public recording metadata";
// Read numeric structure from our trusted source module without evaluating it.
// This keeps corpus bounds identical to the reader, including the megillot.
const countsSource = readFileSync(new URL("../src/lib/readings/catalog.ts", import.meta.url), "utf8");
const counts = new Map([...countsSource.matchAll(/^\s*"([A-Za-z ]+)": Object\.freeze\(\[([\d,]+)\]\),$/gm)].map(match => [match[1], match[2].split(",").map(Number)]));
const TORAH = new Set(["Genesis", "Exodus", "Leviticus", "Numbers", "Deuteronomy"]);
const NEVIIM = new Set(["Joshua", "Judges", "I Samuel", "II Samuel", "I Kings", "II Kings", "Isaiah", "Jeremiah", "Ezekiel", "Hosea", "Joel", "Amos", "Obadiah", "Jonah", "Micah", "Nahum", "Habakkuk", "Zephaniah", "Haggai", "Zechariah", "Malachi"]);
const MEGILLOT = new Set(["Esther", "Song of Songs", "Lamentations", "Ecclesiastes", "Ruth"]);
const CATEGORIES = new Set(["blessing", "holiday-variant", "lesson", "megillah", "festival-song", "source-conflict", "unclassified"]);
const ITEM_KEYS = new Set(["id", "category", "title", "label", "pageUrl", "recordings", "status", "ref", "kind", "reason"]);
const RECORDING_KEYS = "bytes,duration,mimeType,sha256,sourceId";
const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
const label = (value, limit) => typeof value === "string" && value.length > 0 && value.length <= limit
  && /^[A-Za-z0-9 .,:'’();&/?!+–-]+$/.test(value) && !/https?:|www\.|data:|base64|[A-Za-z]:[\\/]|\.(?:mp3|wav|json|exe)\b/i.test(value)
  && !/\S{49}/.test(value);
function validRef(ref, kind) {
  if (typeof ref !== "string" || ref.length > 60) return false;
  const match = /^([A-Za-z ]+) ([1-9]\d{0,2}):([1-9]\d{0,2})$/.exec(ref);
  const corpus = kind === "torah" ? TORAH : kind === "haftarah" ? NEVIIM : kind === "megillah" ? MEGILLOT : null;
  if (!match || !corpus?.has(match[1])) return false;
  const chapters = counts.get(match[1]);
  return Boolean(chapters && Number(match[2]) <= chapters.length && Number(match[3]) <= chapters[Number(match[2]) - 1]);
}
/** A single exact metadata exception; ordinary privacy, credentials, licensed
 * text and binary checks still run on raw bytes in entryProblems afterwards. */
export function shermetMetadataProblem(text) {
  try {
    if (Buffer.byteLength(text) > 8 * 1024 * 1024) return SHERMET_METADATA_REASON;
    const value = JSON.parse(text);
    if (!record(value) || Object.keys(value).sort().join() !== "items,version" || value.version !== 1 || !Array.isArray(value.items) || value.items.length > 10000) return SHERMET_METADATA_REASON;
    let expectedKeys = 2;
    const ids = new Set();
    for (const item of value.items) {
      if (!record(item) || Object.keys(item).some(key => !ITEM_KEYS.has(key))) return SHERMET_METADATA_REASON;
      const required = ["id", "category", "title", "label", "pageUrl", "recordings", "status"];
      if (!required.every(key => Object.hasOwn(item, key)) || !/^sr_[a-f0-9]{32}$/.test(item.id) || ids.has(item.id) || !CATEGORIES.has(item.category)
        || !label(item.title, 100) || !label(item.label, 120) || typeof item.pageUrl !== "string" || !/^https:\/\/www\.templeisraelomaha\.com\/[a-z0-9][a-z0-9-]{0,119}(?:\.html)?$/.test(item.pageUrl)
        || !["available", "pending", "missing"].includes(item.status) || !Array.isArray(item.recordings) || item.recordings.length > 20) return SHERMET_METADATA_REASON;
      if (Object.hasOwn(item, "ref") !== Object.hasOwn(item, "kind") || Object.hasOwn(item, "ref") && !validRef(item.ref, item.kind)) return SHERMET_METADATA_REASON;
      if (item.id !== "sr_" + createHash("sha256").update(item.pageUrl + "\n" + item.label).digest("hex").slice(0, 32)) return SHERMET_METADATA_REASON;
      if (Object.hasOwn(item, "reason") && (item.reason !== "book-mismatch" || item.category !== "source-conflict")) return SHERMET_METADATA_REASON;
      if (item.kind === "megillah" && item.category !== "megillah") return SHERMET_METADATA_REASON;
      if ((item.status === "available") !== (item.recordings.length > 0)) return SHERMET_METADATA_REASON;
      ids.add(item.id); expectedKeys += Object.keys(item).length;
      const recordings = new Set();
      for (const audio of item.recordings) {
        if (!record(audio) || Object.keys(audio).sort().join() !== RECORDING_KEYS || !Number.isSafeInteger(audio.sourceId) || audio.sourceId < 1 || audio.sourceId > 1_000_000_000
          || typeof audio.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(audio.sha256) || !Number.isSafeInteger(audio.bytes) || audio.bytes < 1 || audio.bytes > 20 * 1024 * 1024
          || !Number.isFinite(audio.duration) || audio.duration <= 0 || audio.duration > 3600 || !["audio/mpeg", "audio/wav"].includes(audio.mimeType) || recordings.has(audio.sourceId)) return SHERMET_METADATA_REASON;
        recordings.add(audio.sourceId); expectedKeys += 5;
      }
    }
    // JSON.parse otherwise hides a shadowed duplicate member. Count all raw
    // property tokens, including escaped keys; every accepted field is scalar
    // or one of the bounded arrays above, so the count must agree exactly.
    const keyCount = (text.match(/"(?:[^"\\]|\\.)*"\s*:/g) ?? []).length;
    if (keyCount !== expectedKeys) return SHERMET_METADATA_REASON;
  } catch { return SHERMET_METADATA_REASON; }
}
