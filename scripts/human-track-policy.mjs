import { readFileSync } from "node:fs";

export const HUMAN_TRACKS_FILE = "src/lib/reference-audio/human-tracks.json";
export const HUMAN_TRACKS_REASON = "invalid public human recording metadata";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const counts = new Map([...read("../src/lib/readings/catalog.ts")
  .matchAll(/^\s*"([A-Za-z ]+)": Object\.freeze\(\[([\d,]+)\]\),$/gm)]
  .map(([, book, values]) => [book, values.split(",").map(Number)]));
const portions = new Map([...read("../src/lib/readings/named-readings.ts")
  .matchAll(/\br\("([^"]+)", "([^"]+)", "parashah"/g)].map(([, slug, title]) => [slug, title]));
const finkelServiceTitles = new Set([
  "Ahavah Rabbah", "Blessings after the haftarah", "Blessing before the haftarah", "Kiddush",
  "Kedushah", "L'dor Vador", "Adonai S'fatai Tiftach", "Blessing after the Torah reading",
  "Blessing before the Torah reading", "Torah trope anthem",
]);
const practiceTitle = { torah: "Torah practice", haftarah: "Haftarah practice", megillah: "Megillah practice", other: "Service practice" };
const common = ["id", "voice", "kind", "title", "bytes", "sha256", "durationSec"];
const fields = (obj, keys) => obj && typeof obj === "object" && !Array.isArray(obj)
  && Object.keys(obj).length === keys.length && keys.every(key => Object.hasOwn(obj, key));
const maxBytes = 128 * 1024 * 1024;
const positive = value => Number.isSafeInteger(value) && value > 0;
const verse = (chapters, c, v) => positive(c) && positive(v) && v <= (chapters?.[c - 1] ?? 0);
function validPassage(passage) {
  if (!fields(passage, ["book", "startChapter", "startVerse", "endChapter", "endVerse"])) return false;
  const { book, startChapter, startVerse, endChapter, endVerse } = passage;
  const chapters = counts.get(book);
  return verse(chapters, startChapter, startVerse) && verse(chapters, endChapter, endVerse)
    && (startChapter < endChapter || (startChapter === endChapter && startVerse <= endVerse));
}
function rangeLabels({ book, startChapter, startVerse, endChapter, endVerse }) {
  const start = `${book} ${startChapter}:${startVerse}`;
  const compact = startChapter === endChapter ? String(endVerse) : `${endChapter}:${endVerse}`;
  return startChapter === endChapter && startVerse === endVerse ? [start] : [`${start}–${compact}`, `${start}-${compact}`];
}
function validKaraite(track) {
  const [portion] = track.portions ?? [];
  const name = portions.get(portion);
  if (!name || !Array.isArray(track.portions) || track.portions.length !== 1 || !["torah", "haftarah"].includes(track.kind)
      || track.sourceUrl !== "https://karaites.org/torah-audio/"
      || typeof track.streamUrl !== "string"
      || !/^https:\/\/karaites\.org\/uploads\/7\/4\/1\/3\/7413835\/[a-z0-9_-]{1,140}\.mp3$/i.test(track.streamUrl)) return false;
  const prefix = "karaite-" + portion + "-";
  if (track.id === prefix + "decalogue") {
    return ["yitro", "vaetchanan"].includes(portion) && track.kind === "torah"
      && track.title === name + " Ten Commandments (upper ta’amim)";
  }
  const title = name + (track.kind === "torah" ? " Torah reading" : " haftarah");
  return track.id === prefix + track.kind
    && (track.title === title || (portion === "vaetchanan" && track.kind === "torah" && track.title === title + " (lower ta’amim)"));
}
function validFinkel(track) {
  if (track.id !== "finkel-" + track.sha256.slice(0, 24) || track.audioPath !== "/api/human-tracks/" + track.id) return false;
  const [title, mode, extra] = track.title.split(" · ");
  if (extra !== undefined || !/^(?:Chant|Spoken reading|Chant and repeat|Speak and repeat)(?:, (?:faster|slower))?$/.test(mode)) return false;
  if (!track.passages) return title === practiceTitle[track.kind] || (track.kind === "other" && finkelServiceTitles.has(title));
  const labels = title.split(", ");
  return labels.length === track.passages.length
    && track.passages.every((passage, i) => rangeLabels(passage).includes(labels[i]));
}

export function humanTracksProblem(text) {
  try {
    if (Buffer.byteLength(text) > 1024 * 1024) return HUMAN_TRACKS_REASON;
    const tracks = JSON.parse(text);
    if (!Array.isArray(tracks) || !tracks.length || tracks.length > 1000) return HUMAN_TRACKS_REASON;
    const ids = new Set();
    const hashes = new Set();
    let expectedKeys = 0;
    for (const track of tracks) {
      const karaite = track?.voice === "rotem-cohen";
      const keys = [...common, ...(karaite ? ["portions", "sourceUrl", "streamUrl"] : ["audioPath"])];
      if (track?.passages !== undefined) keys.push("passages");
      if (!fields(track, keys) || (track.voice !== "josh-finkel" && !karaite)
          || !Object.hasOwn(practiceTitle, track.kind) || typeof track.title !== "string"
          || typeof track.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(track.sha256)
          || !positive(track.bytes) || track.bytes > maxBytes || !Number.isFinite(track.durationSec)
          || track.durationSec <= 0 || track.durationSec > 7200 || ids.has(track.id) || hashes.has(track.sha256)) return HUMAN_TRACKS_REASON;
      if (Object.hasOwn(track, "passages") && (!Array.isArray(track.passages) || track.passages.length < 1
          || track.passages.length > 8 || !track.passages.every(validPassage))) return HUMAN_TRACKS_REASON;
      if (!(karaite ? validKaraite(track) : validFinkel(track))) return HUMAN_TRACKS_REASON;
      ids.add(track.id);
      hashes.add(track.sha256);
      expectedKeys += keys.length + 5 * (track.passages?.length ?? 0);
    }
    // A shadowed duplicate member could retain a private value in the raw file.
    const keyCount = (text.match(/"(?:[^"\\]|\\.)*"\s*:/g) ?? []).length;
    if (keyCount !== expectedKeys) return HUMAN_TRACKS_REASON;
  } catch { return HUMAN_TRACKS_REASON; }
}
