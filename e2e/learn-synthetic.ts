import { createHash } from "node:crypto";
import type { Page, Route } from "@playwright/test";
import course from "../src/lib/learn/lessons.json";
import { studyRangePlan } from "../src/components/portal/workspace/study/api";
import { studyEditions } from "../src/components/portal/workspace/study/credits";
import { projectStudyVerse } from "../src/lib/hebrew/study-tokens";
import { expandReadingRanges } from "../src/lib/readings/ranges";
import { TANAKH_VERSE_COUNTS } from "../src/lib/readings/catalog";
import { REFERENCE_ATTRIBUTION } from "../src/lib/reference-audio/contract";
import { SHORT_SOURCE_ATTRIBUTION } from "../src/lib/reference-audio/short-source";

/**
 * Synthetic public data for the course, served by route fulfilment to the built production server.
 * Verses are invented syllables carrying real cantillation codepoints. Where a lessons.json example
 * names a verse, only that example's own edge words (already in lessons.json) are placed at its edges,
 * so the app's drift check keeps the example; every other word is invented. Audio is a generated tone
 * as 8 kHz PCM, served as the short clip; nothing here is a recording or a passage of scripture.
 */
const sha = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const CP: Record<string, string> = { mercha: "֥", munach: "֣", tipcha: "֖", etnachta: "֑", "zakef-katan": "֔", revia: "֗", tevir: "֛", darga: "֧",
  pashta: "֙", mahpach: "֤", segol: "֒", zarka: "֮", pazer: "֡", "telisha-ketana": "֩", kadma: "֨", geresh: "֜", "zakef-gadol": "֕",
  yetiv: "֚", gershayim: "֞", "telisha-gedola": "֠", "munach-legarmeh": "֣" };
const CLOSE: Record<string, string> = { etnachta: CP.etnachta, zakef: CP["zakef-katan"], revia: CP.revia, tevir: CP.tevir, segol: CP.segol, azla: CP.geresh, "telisha-ketana": CP["telisha-ketana"], pazer: CP.pazer, "zakef-gadol": CP["zakef-gadol"] };
const SYL = ["בָּ", "גַ", "דָ", "הַ", "זָ", "חַ", "טָ", "כָּ", "לַ", "מָ", "נַ", "סָ"];
const word = (accent: string, n: number) => `${SYL[n % SYL.length]}${accent}${SYL[(n + 3) % SYL.length]}`;
const ending = (n: number) => `${SYL[n % SYL.length]}ֽ${SYL[(n + 5) % SYL.length]}׃`;
type Example = { ref: string; words: [number, number]; firstWord: string; lastWord: string; tropes?: string[]; phrases?: { family: string; words: [number, number] }[] };

/** The invented text of one verse, consistent with every lessons.json example on it. */
export function syntheticWords(ref: string, kind: string): string[] {
  const examples = (course.lessons as unknown as { melody: string; examples: Example[] }[]).filter(l => l.melody === kind).flatMap(l => l.examples).filter(e => e.ref === ref);
  if (!examples.length) return [word(CP.mercha, 0), word(CP.tipcha, 1), word(CP.mercha, 2), word(CP.etnachta, 3), word(CP.munach, 4), word(CP["zakef-katan"], 5), word(CP.mercha, 6), word(CP.tipcha, 7), ending(8)];
  const units = new Map<number, string>();
  for (const e of examples) { units.set(e.words[0], e.firstWord); units.set(e.words[1], e.lastWord); }
  for (const e of examples) {
    for (let k = e.words[0] + 1; k < e.words[1]; k++) {
      if (units.has(k)) continue;
      const trope = e.tropes?.[k - e.words[0]], end = e.phrases?.find(p => p.words[1] === k);
      units.set(k, word(end ? CLOSE[end.family] ?? CP.mercha : trope && CP[trope] ? CP[trope] : CP.mercha, k));
    }
    if (e.words[0] > 0 && !units.has(e.words[0] - 1)) units.set(e.words[0] - 1, word(CP["zakef-katan"], e.words[0] - 1));
  }
  const count = Math.max(...units.keys()) + 1, out = Array.from({ length: count }, (_, k) => units.get(k) ?? word(CP.mercha, k));
  if (!out.at(-1)!.endsWith("׃")) out.push(word(CP.tipcha, count), ending(count + 1));
  return out;
}
function hebrew(words: string[]) { const text = words.join(" ").normalize("NFC"); return { text, readingText: text, segments: [{ kind: "text" as const, text }], paragraphAfter: null }; }
const RATE = 8000, STEP = 0.4, START = 1;
/** A tone as 16-bit mono PCM WAV: decodable by the browser, a test signal only. */
function tone(frames: number, pitch: number): Buffer {
  const data = Buffer.alloc(44 + frames * 2);
  data.write("RIFF", 0); data.writeUInt32LE(36 + frames * 2, 4); data.write("WAVE", 8); data.write("fmt ", 12); data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
  data.writeUInt32LE(RATE, 24); data.writeUInt32LE(RATE * 2, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34); data.write("data", 36); data.writeUInt32LE(frames * 2, 40);
  for (let i = 0; i < frames; i++) data.writeInt16LE(Math.round(Math.sin(2 * Math.PI * pitch * i / RATE) * 6000), 44 + i * 2);
  return data;
}
const ASSET = "ra_" + "4".repeat(32);
export function syntheticCourseRoutes() {
  const clips = new Map<string, Buffer>(), seen: string[] = [];
  function resolution(ref: string, kind: string) {
    const h = hebrew(syntheticWords(ref, kind)), projection = projectStudyVerse(ref, h);
    if (projection.status !== "ready") throw Error("Synthetic projection refused");
    const count = projection.projection.words.length, end = START + count * STEP + 0.2;
    const first = Math.floor(START * RATE), frames = Math.ceil(end * RATE) - first, bytes = tone(frames, 300 + (sha(ref).charCodeAt(0) % 8) * 20), hash = sha(bytes);
    clips.set(`/reference-audio/short-v1/${hash}.mp3`, bytes);
    const starts = Array.from({ length: count }, (_, i) => START + i * STEP), ends = starts.map(s => s + STEP * 0.9);
    return { h, short: { schema: "reference-resolution/short-v1",
      verse: { schema: "reference-verse/v1", ref, table: kind, playback: { status: "ready", asset: ASSET, clip: { start: START, end } },
        words: { status: "ready", readingTextSha256: sha(h.readingText), starts, ends }, attribution: REFERENCE_ATTRIBUTION },
      source: { schema: "reference-short-source/v1", id: "rs_" + hash, parent: { asset: ASSET, sha256: "b".repeat(64), bytes: 1000 }, sha256: hash, bytes: bytes.length, path: `/reference-audio/short-v1/${hash}.mp3`,
        codec: "mp3", bitrate: 64000, sampleRate: RATE, channels: 1, presentationFrames: frames, origin: { firstFrame: first, parentRate: RATE }, attributionVersion: SHORT_SOURCE_ATTRIBUTION.version } } };
  }
  const json = (route: Route, body: unknown) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  async function install(page: Page, week: { date?: string; torah?: string | null } = {}) {
    await page.route("**/api/public/**", async route => {
      const url = new URL(route.request().url()), q = url.searchParams; seen.push(url.pathname + url.search);
      const kind = q.get("kind") ?? "torah";
      if (url.pathname === "/api/public/reading") {
        const date = q.get("date")!, range = week.torah === undefined ? "Genesis 12:1-8" : week.torah;
        const passage = range && { kind: "torah", ranges: [range], verseCount: expandReadingRanges([range], "torah", TANAKH_VERSE_COUNTS).length, pages: [{ offset: 0, ...(() => { const plan = studyRangePlan([range], "torah", 0); return { first: plan.refs[0], last: plan.refs.at(-1)! }; })() }] };
        return json(route, { date, parashah: "Synthetic", torah: passage, haftarah: null, fetchedAt: 0, listening: { pocketTorah: true } });
      }
      const ref = q.get("ref"); if (!ref) return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
      const offset = Number(q.get("offset")), ranges = ref.split("; "), plan = studyRangePlan(ranges, kind as "torah", offset), total = expandReadingRanges(ranges, kind as "torah", TANAKH_VERSE_COUNTS).length;
      const rows = plan.refs.map(r => resolution(r, kind));
      if (url.pathname === "/api/public/text") return json(route, { kind, ref, offset, nextOffset: plan.nextOffset, totalVerses: total, translation: { key: "jps2023", status: "unavailable" },
        verses: plan.refs.map((r, i) => ({ ref: r, english: null, hebrew: rows[i].h })),
        chapters: plan.chapters.map(c => ({ ref: c.ref, sefariaUrl: c.url, fetchedAt: 0, hash: "c".repeat(64), editions: [studyEditions.mam] })) });
      if (url.pathname === "/api/public/reference/short") return json(route, { kind, ref, page: { offset, nextOffset: plan.nextOffset, totalVerses: total, references: rows.map(r => r.short) } });
      return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
    });
    await page.route("**/reference-audio/short-v1/*", route => {
      const body = clips.get(new URL(route.request().url()).pathname);
      return body ? route.fulfill({ status: 200, headers: { "content-type": "audio/mpeg", "content-length": String(body.length) }, body }) : route.abort();
    });
    await page.addInitScript(() => {
      const target = window as unknown as { learnPlays: string[] }; target.learnPlays = [];
      const play = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function () { if (this.src.startsWith("blob:")) target.learnPlays.push(this.src); return play.call(this); };
    });
  }
  return { install, seen };
}
