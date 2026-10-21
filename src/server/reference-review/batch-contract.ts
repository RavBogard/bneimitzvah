import "server-only";
import { createHash } from "node:crypto";
import { TANAKH_VERSE_COUNTS } from "../../lib/readings/catalog";
import type { FinkelReviewPlan } from "./finkel-import";

export const REVIEW_LIMITS = Object.freeze({ entries: 8, manifestBytes: 128 * 1024, audioBytes: 4 * 1024 * 1024, totalMs: 30000, idleMs: 5000 });
export class ReviewUnavailable extends Error { constructor() { super("Reference review unavailable"); this.name = "ReviewUnavailable"; } }
export class ReviewInvalid extends Error { constructor() { super("Reference review request rejected"); this.name = "ReviewInvalid"; } }
export const reviewHash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
export const reviewDigest = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
export const reviewUuid = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
// BetterAuth's user primary key is text and this app does not override its ID generator.
export const reviewUserId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
export const reviewAsset = (value: unknown): value is string => typeof value === "string" && /^fj_[a-f0-9]{20}$/.test(value);
export function reviewNeed(value: unknown): asserts value { if (!value) throw new ReviewInvalid(); }
export function reviewRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  reviewNeed(value !== null && typeof value === "object" && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value)));
  const descriptors = Object.getOwnPropertyDescriptors(value);
  reviewNeed(Reflect.ownKeys(value).length === keys.length && keys.every(key => Object.hasOwn(descriptors, key) && Object.hasOwn(descriptors[key], "value")));
  return value as Record<string, unknown>;
}
function array(value: unknown, max: number): unknown[] {
  reviewNeed(Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype && value.length > 0 && value.length <= max && Reflect.ownKeys(value).length === value.length + 1);
  for (let i = 0; i < value.length; i++) reviewNeed(Object.hasOwn(Object.getOwnPropertyDescriptor(value, String(i)) ?? {}, "value"));
  return value;
}
export type ReviewerConfig = Readonly<{ tenantId: "crc"; userId: string }>;
export function parseReferenceReviewerConfig(env: Readonly<Record<string, string | undefined>>): ReviewerConfig | undefined {
  const tenantId = env.FINKEL_REVIEW_TENANT_ID, userId = env.FINKEL_REVIEW_REVIEWER_USER_ID;
  if (tenantId === undefined && userId === undefined) return undefined;
  if (tenantId !== "crc" || !reviewUserId(userId)) throw new ReviewUnavailable();
  return Object.freeze({ tenantId, userId });
}
type ReviewText = Readonly<{ ref: string; readingText: string; sha256: string }>;
export type ReviewEntry = Readonly<{
  assetKey: string; identitySha256: string; targetSha256: string; masterSha256: string; textSha256: string;
  readingKind: "torah" | "haftarah"; verses: readonly string[]; mode: "spoken" | "chant"; tempo: null;
  playback: Readonly<{ sha256: string; bytes: number; durationSeconds: number }>;
  text: readonly ReviewText[];
}>;
export type ReviewManifest = Readonly<{ schema: "finkel-private-review/v1"; catalogSha256: string; entries: readonly ReviewEntry[]; studentReady: false; timing: "unavailable" }>;
function canonicalRef(value: unknown, kind: string): value is string {
  if (typeof value !== "string") return false;
  const match = /^(.{1,40}) ([1-9]\d{0,2}):([1-9]\d{0,2})$/.exec(value);
  if (!match || !Object.hasOwn(TANAKH_VERSE_COUNTS, match[1])) return false;
  const chapters = TANAKH_VERSE_COUNTS[match[1]], chapter = Number(match[2]), verse = Number(match[3]);
  const torah = ["Genesis", "Exodus", "Leviticus", "Numbers", "Deuteronomy"].includes(match[1]);
  const prophets = ["Joshua", "Judges", "I Samuel", "II Samuel", "I Kings", "II Kings", "Isaiah", "Jeremiah", "Ezekiel", "Hosea", "Joel", "Amos", "Obadiah", "Jonah", "Micah", "Nahum", "Habakkuk", "Zephaniah", "Haggai", "Zechariah", "Malachi"].includes(match[1]);
  return chapter <= chapters.length && verse <= chapters[chapter - 1] && (kind === "torah" ? torah : prophets);
}
export function parseReviewManifest(bytes: Uint8Array, expectedSha256: string): ReviewManifest {
  try {
    reviewNeed(bytes instanceof Uint8Array && bytes.byteLength > 0 && bytes.byteLength <= REVIEW_LIMITS.manifestBytes && reviewDigest(expectedSha256) && reviewHash(bytes) === expectedSha256);
    const row = reviewRecord(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)), ["schema", "catalogSha256", "entries", "studentReady", "timing"]);
    reviewNeed(row.schema === "finkel-private-review/v1" && reviewDigest(row.catalogSha256) && row.studentReady === false && row.timing === "unavailable");
    const seen = new Set<string>();
    const entries = array(row.entries, REVIEW_LIMITS.entries).map(value => {
      const e = reviewRecord(value, ["assetKey", "identitySha256", "targetSha256", "masterSha256", "textSha256", "readingKind", "verses", "mode", "tempo", "playback", "text"]);
      reviewNeed(reviewAsset(e.assetKey) && !seen.has(e.assetKey)); seen.add(e.assetKey);
      reviewNeed([e.identitySha256, e.targetSha256, e.masterSha256, e.textSha256].every(reviewDigest));
      reviewNeed((e.readingKind === "torah" || e.readingKind === "haftarah") && (e.mode === "spoken" || e.mode === "chant") && e.tempo === null);
      const verses = array(e.verses, 512); reviewNeed(verses.every(ref => canonicalRef(ref, e.readingKind as string)) && new Set(verses).size === verses.length);
      const playback = reviewRecord(e.playback, ["sha256", "bytes", "durationSeconds"]);
      reviewNeed(reviewDigest(playback.sha256) && Number.isSafeInteger(playback.bytes) && Number(playback.bytes) > 0 && Number(playback.bytes) <= REVIEW_LIMITS.audioBytes);
      reviewNeed(typeof playback.durationSeconds === "number" && Number.isFinite(playback.durationSeconds) && playback.durationSeconds > 0 && playback.durationSeconds <= 3600);
      const text = array(e.text, 512).map((value, index) => {
        const t = reviewRecord(value, ["ref", "readingText", "sha256"]);
        reviewNeed(t.ref === verses[index] && typeof t.readingText === "string" && t.readingText.isWellFormed() && t.readingText.length > 0 && t.readingText.length <= 8192 && t.readingText === t.readingText.normalize("NFC") && !/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069\ufeff<>]/u.test(t.readingText));
        reviewNeed(reviewDigest(t.sha256) && reviewHash(t.readingText) === t.sha256);
        return Object.freeze({ ref: t.ref as string, readingText: t.readingText, sha256: t.sha256 });
      });
      reviewNeed(text.length === verses.length && reviewHash(JSON.stringify(text.map(t => ({ ref: t.ref, sha256: t.sha256 })))) === e.textSha256);
      const target = { kind: "scripture", readingKind: e.readingKind, verses, inventoryOnly: false };
      reviewNeed(reviewHash(JSON.stringify({ target, mode: e.mode, tempo: null })) === e.targetSha256);
      reviewNeed(reviewHash(JSON.stringify({ schema: "finkel-review-identity/v1", catalogSha256: row.catalogSha256, assetKey: e.assetKey, masterSha256: e.masterSha256, playbackSha256: playback.sha256, targetSha256: e.targetSha256 })) === e.identitySha256);
      return Object.freeze({ ...e, verses: Object.freeze(verses), text: Object.freeze(text), playback: Object.freeze(playback) }) as ReviewEntry;
    });
    return Object.freeze({ schema: "finkel-private-review/v1", catalogSha256: row.catalogSha256, entries: Object.freeze(entries), studentReady: false, timing: "unavailable" });
  } catch { throw new ReviewUnavailable(); }
}
/** Trusted operator preparation only. Caller supplies exact text snapshots; never infer timings. */
export function buildReviewManifest(plan: FinkelReviewPlan, selected: readonly { assetKey: string; text: readonly { ref: string; readingText: string }[] }[]) {
  reviewNeed(selected.length > 0 && selected.length <= REVIEW_LIMITS.entries);
  const entries = selected.map(selection => {
    const candidate = plan.candidates.find(c => c.assetKey === selection.assetKey);
    reviewNeed(candidate && candidate.disposition === "human-review-candidate" && candidate.target.kind === "scripture" && !candidate.target.inventoryOnly && candidate.tempo === null && ["spoken", "chant"].includes(candidate.mode));
    reviewNeed(candidate.playback.bytes <= REVIEW_LIMITS.audioBytes);
    const text = selection.text.map(t => ({ ref: t.ref, readingText: t.readingText.normalize("NFC"), sha256: reviewHash(t.readingText.normalize("NFC")) }));
    return { assetKey: candidate.assetKey, identitySha256: candidate.identitySha256, targetSha256: candidate.targetSha256, masterSha256: candidate.master.sha256,
      textSha256: reviewHash(JSON.stringify(text.map(t => ({ ref: t.ref, sha256: t.sha256 })))), readingKind: candidate.target.readingKind,
      verses: candidate.target.verses, mode: candidate.mode, tempo: null, playback: candidate.playback, text };
  });
  const bytes = new TextEncoder().encode(JSON.stringify({ schema: "finkel-private-review/v1", catalogSha256: plan.catalogSha256, entries, studentReady: false, timing: "unavailable" }));
  const sha256 = reviewHash(bytes); return Object.freeze({ bytes, sha256, manifest: parseReviewManifest(bytes, sha256) });
}
export const REVIEW_CHECKS = ["privacy", "listening", "exactText", "musicalAccuracy", "rights"] as const;
export type ReviewChecks = Readonly<Record<typeof REVIEW_CHECKS[number], "pass" | "hold">>;
export type DecisionWrite = Readonly<{ requestId: string; generation: number; manifestSha256: string; expectedRevision: number; checks: ReviewChecks }>;
export function parseDecisionWrite(value: unknown): DecisionWrite {
  const row = reviewRecord(value, ["requestId", "generation", "manifestSha256", "expectedRevision", "checks"]);
  reviewNeed(reviewUuid(row.requestId) && reviewDigest(row.manifestSha256) && Number.isSafeInteger(row.generation) && Number(row.generation) > 0 && Number.isSafeInteger(row.expectedRevision) && Number(row.expectedRevision) >= 0);
  const checks = reviewRecord(row.checks, REVIEW_CHECKS); reviewNeed(REVIEW_CHECKS.every(key => checks[key] === "pass" || checks[key] === "hold"));
  return Object.freeze({ requestId: row.requestId, generation: Number(row.generation), manifestSha256: row.manifestSha256, expectedRevision: Number(row.expectedRevision), checks: Object.freeze({ ...checks }) as ReviewChecks });
}
