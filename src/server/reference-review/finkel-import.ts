import "server-only";
import { createHash } from "node:crypto";
import { TANAKH_VERSE_COUNTS } from "../../lib/readings/catalog";

export const FINKEL_REVIEW_LIMITS = Object.freeze({ bytes: 4 * 1024 * 1024, sources: 1000, assets: 1000, verses: 512, mediaBytes: 256 * 1024 * 1024, seconds: 3600 });
const SYMBOLS = ["sfatai", "ahavah-rabbah", "torah-blessing-after", "torah-blessing-before", "haftarah-blessing-before", "haftarah-blessing-after", "kedusha", "kiddush", "ldor-vador", "trope-anthem"] as const;
type Symbol = typeof SYMBOLS[number];
type Mode = "spoken" | "chant" | "spoken-drill" | "chant-drill";
type Tempo = "faster" | "slower" | null;
type Target = Readonly<{ kind: "scripture"; readingKind: "torah" | "haftarah" | "inventory-only"; verses: readonly string[]; inventoryOnly: boolean }>
  | Readonly<{ kind: "provisional"; symbols: readonly Symbol[]; mapping: "unresolved"; inventoryOnly: true }>
  | Readonly<{ kind: "unresolved"; reason: "unknown-provisional-symbol"; inventoryOnly: true }>;
const TORAH = new Set(["Genesis", "Exodus", "Leviticus", "Numbers", "Deuteronomy"]);
const MEGILLAH = new Set(["Esther", "Ruth", "Song of Songs", "Ecclesiastes", "Lamentations"]);
const PROPHETS = new Set(["Joshua", "Judges", "I Samuel", "II Samuel", "I Kings", "II Kings", "Isaiah", "Jeremiah", "Ezekiel", "Hosea", "Joel", "Amos", "Obadiah", "Jonah", "Micah", "Nahum", "Habakkuk", "Zephaniah", "Haggai", "Zechariah", "Malachi"]);
type Code = "input" | "encoding" | "json" | "schema" | "identity" | "binding" | "media" | "release" | "machine" | "target";
export class FinkelReviewImportError extends Error {
  constructor(readonly code: Code) { super("Finkel review import rejected"); this.name = "FinkelReviewImportError"; }
}
function need(value: unknown, code: Code): asserts value { if (!value) throw new FinkelReviewImportError(code); }
function record(value: unknown, code: Code): Record<string, unknown> { need(value !== null && typeof value === "object" && !Array.isArray(value), code); return value as Record<string, unknown>; }
function list(value: unknown, max: number, code: Code): unknown[] { need(Array.isArray(value) && value.length <= max, code); return value; }
function digest(value: unknown): string { need(typeof value === "string" && /^[a-f0-9]{64}$/.test(value), "media"); return value; }
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
function media(value: unknown, asset: string, name: "master.flac" | "playback.mp3") {
  const row = record(value, "media");
  need(row.path === `prepared/assets/${asset}/${name}`, "media");
  need(row.codec === (name === "master.flac" ? "flac" : "mp3"), "media");
  need(Number.isSafeInteger(row.bytes) && Number(row.bytes) > 0 && Number(row.bytes) <= FINKEL_REVIEW_LIMITS.mediaBytes, "media");
  need(typeof row.durationSeconds === "number" && Number.isFinite(row.durationSeconds) && row.durationSeconds > 0 && row.durationSeconds <= FINKEL_REVIEW_LIMITS.seconds, "media");
  return Object.freeze({ sha256: digest(row.sha256), bytes: Number(row.bytes), durationSeconds: row.durationSeconds });
}
function target(row: Record<string, unknown>): Target {
  if (row.kind === "service-part" || row.kind === "trope-instruction") {
    need(list(row.verses, FINKEL_REVIEW_LIMITS.verses, "target").length === 0, "target");
    const symbols = row.serviceParts === null ? [] : list(row.serviceParts, 32, "target");
    need(symbols.every(s => typeof s === "string" && s.length <= 128) && new Set(symbols).size === symbols.length, "target");
    if (!symbols.length || symbols.some(s => !SYMBOLS.includes(s as Symbol))) return Object.freeze({ kind: "unresolved", reason: "unknown-provisional-symbol", inventoryOnly: true });
    return Object.freeze({ kind: "provisional", symbols: Object.freeze([...symbols] as Symbol[]), mapping: "unresolved", inventoryOnly: true });
  }
  need(typeof row.kind === "string" && ["torah", "prophets", "megillah"].includes(row.kind), "target");
  need(row.serviceParts === null || (Array.isArray(row.serviceParts) && row.serviceParts.length === 0), "target");
  const raw = list(row.verses, FINKEL_REVIEW_LIMITS.verses, "target"); need(raw.length > 0, "target");
  const verses: string[] = []; let previous: { book: string; chapter: number; verse: number } | null = null;
  for (const value of raw) {
    need(typeof value === "string" && value.length <= 80, "target");
    const match = /^(.{1,40}) ([1-9]\d{0,2}):([1-9]\d{0,2})$/.exec(value); need(match && Object.hasOwn(TANAKH_VERSE_COUNTS, match[1]), "target");
    const book = match[1], chapter = Number(match[2]), verse = Number(match[3]), chapters = TANAKH_VERSE_COUNTS[book];
    need(chapter <= chapters.length && verse <= chapters[chapter - 1], "target");
    need(row.kind === "torah" ? TORAH.has(book) : row.kind === "prophets" ? PROPHETS.has(book) : MEGILLAH.has(book), "target");
    need(!previous || (book === previous.book && (chapter > previous.chapter || (chapter === previous.chapter && verse > previous.verse))), "target");
    verses.push(value); previous = { book, chapter, verse };
  }
  return Object.freeze({ kind: "scripture", readingKind: row.kind === "torah" ? "torah" : row.kind === "prophets" ? "haftarah" : "inventory-only", verses: Object.freeze(verses), inventoryOnly: row.kind === "megillah" });
}
const pendingReview = () => Object.freeze({ humanListening: "pending" as const, privacy: "pending" as const, exactText: "pending" as const, musicalAccuracy: "pending" as const, thirdPartyRights: "pending" as const });
const unavailableTiming = () => Object.freeze({ verse: "unavailable" as const, phrase: "unavailable" as const, word: "unavailable" as const });
/** Declaration-only review plan. No filesystem, storage, access grant, media or approval work. */
export function planFinkelReviewImport(input: Uint8Array) {
  need(input instanceof Uint8Array && input.byteLength > 0 && input.byteLength <= FINKEL_REVIEW_LIMITS.bytes, "input");
  const bytes = Uint8Array.from(input), catalogSha256 = hash(bytes); let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { throw new FinkelReviewImportError("encoding"); }
  let parsed: unknown; try { parsed = JSON.parse(text); } catch { throw new FinkelReviewImportError("json"); }
  const catalog = record(parsed, "schema"); need(catalog.schema === "finkel-prepared-catalog/v1", "schema");
  const sources = list(catalog.sources, FINKEL_REVIEW_LIMITS.sources, "identity"), assets = list(catalog.assets, FINKEL_REVIEW_LIMITS.assets, "identity"); need(sources.length > 0 && assets.length > 0, "identity");
  const sourceIds = new Set<string>(), owners = new Map<string, string>(), sourceRows = new Map<string, Record<string, unknown>>(), sourceHashes = new Map<string, string>();
  for (const value of sources) {
    const source = record(value, "identity"); need(typeof source.catalogId === "string" && /^JF-\d{4}$/.test(source.catalogId) && !sourceIds.has(source.catalogId), "identity"); sourceIds.add(source.catalogId); sourceRows.set(source.catalogId, source);
    for (const key of list(source.assets, FINKEL_REVIEW_LIMITS.assets, "binding")) {
      need(typeof key === "string" && /^fj_[a-f0-9]{20}$/.test(key) && !owners.has(key), "binding"); owners.set(key, source.catalogId);
      need(owners.size <= FINKEL_REVIEW_LIMITS.assets, "binding");
    }
  }
  const seen = new Set<string>();
  const candidates = assets.map(value => {
    const row = record(value, "identity"); need(typeof row.assetKey === "string" && /^fj_[a-f0-9]{20}$/.test(row.assetKey) && !seen.has(row.assetKey), "identity"); const assetKey = row.assetKey; seen.add(assetKey);
    const derived = record(row.derivedFrom, "binding"); need(typeof derived.catalogId === "string" && sourceIds.has(derived.catalogId) && owners.get(assetKey) === derived.catalogId, "binding");
    if (!sourceHashes.has(derived.catalogId)) {
      const representations = list(sourceRows.get(derived.catalogId)!.representations, 32, "binding").map(value => record(value, "binding"));
      const originals = representations.filter(value => value.kind === "original");
      need(originals.length === 1 && typeof originals[0].sha256 === "string" && /^[a-f0-9]{64}$/.test(originals[0].sha256), "binding");
      sourceHashes.set(derived.catalogId, originals[0].sha256);
    }
    need(typeof derived.sha256 === "string" && /^[a-f0-9]{64}$/.test(derived.sha256) && derived.sha256 === sourceHashes.get(derived.catalogId), "binding");
    const review = record(row.review, "release"), capabilities = record(row.capabilities, "release"), timing = record(row.timing, "release");
    need(row.studentReady === false && review.humanListening === "pending" && review.musicalAccuracy === "pending" && timing.validated === null, "release");
    need(capabilities.phrase === "unavailable" && capabilities.word === "unavailable" && typeof capabilities.verse === "string" && ["unavailable", "candidate-pending-review"].includes(capabilities.verse), "release");
    const verification = record(review.machineVerification, "machine"), passed = verification.status === "passed";
    need(passed || verification.status === "failed" || verification.status === "not-run", "machine");
    need(capabilities.wholeClip === (passed ? "ready-for-human-review" : verification.status === "failed" ? "held-machine-check-failed" : "held-not-verified"), "machine");
    need(passed || capabilities.verse === "unavailable", "machine");
    need(typeof row.recommendedDefault === "boolean" && (!row.recommendedDefault || passed), "machine");
    need(typeof row.mode === "string" && ["spoken", "chant", "spoken-drill", "chant-drill"].includes(row.mode) && (row.tempo === null || row.tempo === "faster" || row.tempo === "slower"), "target");
    const mode = row.mode as Mode, tempo = row.tempo as Tempo, canonicalTarget = target(row), master = media(row.master, assetKey, "master.flac"), playback = media(row.playback, assetKey, "playback.mp3");
    const targetSha256 = hash(JSON.stringify({ target: canonicalTarget, mode, tempo }));
    const identitySha256 = hash(JSON.stringify({ schema: "finkel-review-identity/v1", catalogSha256, assetKey, masterSha256: master.sha256, playbackSha256: playback.sha256, targetSha256 }));
    return Object.freeze({ assetKey, identitySha256, targetSha256, target: canonicalTarget, mode, tempo, master, playback,
      disposition: passed ? "human-review-candidate" as const : "held" as const,
      advisoryDefault: passed && !canonicalTarget.inventoryOnly && row.recommendedDefault,
      mediaIntegrity: "unchecked" as const, review: pendingReview(), studentReady: false as const, timing: unavailableTiming() });
  });
  need(owners.size === seen.size && [...owners.keys()].every(key => seen.has(key)), "binding");
  return Object.freeze({ schema: "finkel-review-plan/v1" as const, catalogSha256, sourceCount: sources.length, assetCount: candidates.length,
    candidateCount: candidates.filter(c => c.disposition === "human-review-candidate").length, heldCount: candidates.filter(c => c.disposition === "held").length,
    studentReady: false as const, mediaIntegrity: "unchecked" as const, candidates: Object.freeze(candidates) });
}
export type FinkelReviewPlan = ReturnType<typeof planFinkelReviewImport>;
