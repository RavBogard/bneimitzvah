/**
 * Daniel's reference-audio listening review (ruling 2026-10-22). A fixed sample, chosen once from the
 * PocketTorah index (playable, single-recording, word-timed verses only) to spread across the five books
 * and the haftarot, short and long verses, and verses whose word or verse boundaries are most likely to
 * be wrong: the closest word onsets, the least or most room after the last word, the first verse of a
 * recording, and written/read (ketiv/qere) words. Selection statistics came from the private index; only
 * the public verse citations are kept here.
 *
 * Source-agnostic: each item names the reference source it plays. A second source (Cantor Finkel's
 * recordings) adds its own items with source "finkel" once its provider is composed; until then those
 * items are listed as not yet available and never counted.
 *
 * Changing the list changes the version, so verdicts given against an older list are not counted.
 */
export const LISTENING_SAMPLE_VERSION = "listening-sample/v1" as const;
export const LISTENING_SOURCES = ["pocket-torah", "finkel"] as const;
export type ListeningSource = (typeof LISTENING_SOURCES)[number];
export const LISTENING_SOURCE_LABELS: Readonly<Record<ListeningSource, string>> = Object.freeze({ "pocket-torah": "PocketTorah", finkel: "Cantor Finkel" });
export type ListeningItem = Readonly<{ id: string; source: ListeningSource; kind: "torah" | "haftarah"; ref: string; why: string }>;

const item = (source: ListeningSource, kind: ListeningItem["kind"], ref: string, why: string): ListeningItem =>
  Object.freeze({ id: `${source === "pocket-torah" ? "pt" : "fj"}-${ref.toLowerCase().replace(/[ :]+/g, "-")}`, source, kind, ref, why });
const torah = (ref: string, why: string) => item("pocket-torah", "torah", ref, why);
const haftarah = (ref: string, why: string) => item("pocket-torah", "haftarah", ref, why);

export const LISTENING_SAMPLE: readonly ListeningItem[] = Object.freeze([
  torah("Genesis 1:1", "First verse of a recording"),
  torah("Genesis 8:17", "A word read differently from how it is written; closely spaced words"),
  torah("Genesis 22:12", "Long verse with very closely spaced words"),
  torah("Genesis 25:14", "Three words"),
  torah("Genesis 28:3", "Least room after the last word in the collection; the next verse follows at once"),
  torah("Genesis 28:4", "Fast words, some only 0.04 seconds apart"),
  torah("Exodus 15:1", "Opening of the Song of the Sea"),
  torah("Exodus 20:2", "Ten Commandments"),
  torah("Exodus 22:17", "Three words"),
  torah("Exodus 28:4", "Little room after the last word"),
  torah("Leviticus 13:38", "Closely spaced words"),
  torah("Leviticus 16:1", "First verse of a recording"),
  torah("Leviticus 19:18", "Familiar verse"),
  torah("Numbers 6:24", "Priestly blessing, three words"),
  torah("Numbers 21:7", "Closely spaced words"),
  torah("Numbers 29:11", "Long pause after the last word"),
  torah("Deuteronomy 4:34", "Very long verse, about 55 seconds"),
  torah("Deuteronomy 6:4", "Sh'ma, slow and emphatic"),
  torah("Deuteronomy 28:27", "Words read differently from how they are written"),
  torah("Deuteronomy 34:12", "Last verse of the Torah; long ending"),
  haftarah("Joshua 2:1", "Long verse"),
  haftarah("Judges 13:11", "The closest word onsets in the collection"),
  haftarah("I Samuel 12:22", "Long pause after the last word"),
  haftarah("II Samuel 22:1", "Opening of David's song"),
  haftarah("I Kings 2:5", "36 words"),
  haftarah("I Kings 19:11", "Very long verse, about 62 seconds"),
  haftarah("II Kings 4:23", "Longest pause after the last word in the collection"),
  haftarah("Isaiah 40:1", "First verse of a recording"),
  haftarah("Isaiah 42:24", "Closely spaced words"),
  haftarah("Jeremiah 46:25", "Little room after the last word"),
  haftarah("Ezekiel 43:11", "Longest verse in the collection, about 65 seconds"),
  haftarah("Amos 3:1", "Closely spaced words"),
  haftarah("Hosea 14:2", "Familiar opening, Shuvah"),
  haftarah("Malachi 1:1", "Short opening verse"),
]);

/** Optional reasons for "Needs work". "Would teach wrong" is the generated-chant gate's own term, so the
 * tally can be read beside that bar; nothing here changes which gate applies to reference audio. */
export const LISTENING_REASONS = ["slow-start", "verse-cut", "highlight-off", "word-drill-off", "sound", "would-teach-wrong"] as const;
export type ListeningReason = (typeof LISTENING_REASONS)[number];
export const LISTENING_REASON_LABELS: Readonly<Record<ListeningReason, string>> = Object.freeze({
  "slow-start": "Slow to start after a tap",
  "verse-cut": "Verse starts or ends in the wrong place",
  "highlight-off": "Word highlighting is out of step",
  "word-drill-off": "A word drill plays the wrong span",
  sound: "Sound quality",
  "would-teach-wrong": "Would teach wrong",
});
export const LISTENING_NOTE_LIMIT = 1000;
export const LISTENING_LATENCY_LIMIT_MS = 60_000;

/** The only numeric bar on record is the generated-chant gate G3 (MISSION ruling 16): at least 95% pass and
 * no "would teach wrong". No bar is set for human reference audio; G3's is shown for comparison only. */
export const LISTENING_COMPARISON_BAR = Object.freeze({ passRate: 0.95, wouldTeachWrong: 0 });

export function listeningItem(id: unknown, sample: readonly ListeningItem[] = LISTENING_SAMPLE): ListeningItem | null {
  return typeof id === "string" && id.length <= 64 ? sample.find(row => row.id === id) ?? null : null;
}
/** Same rules as the database: one-line or multiline text, no angle brackets, controls or hidden marks. */
export function listeningNote(value: unknown): string | null | undefined {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") return undefined;
  const note = value.replace(/\r\n?/g, "\n").trim().normalize("NFC");
  if (!note) return null;
  if (note.length > LISTENING_NOTE_LIMIT || /[<>]/.test(note) || /[\x00-\x09\x0b-\x1f\x7f-\x9f]/.test(note)
    || /[\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180e\u200b-\u200f\u2028-\u202e\u2060-\u2064\u2066-\u206f\u3164\ufe00-\ufe0f\ufeff\uffa0\ufff9-\ufffb]/.test(note)
    || /[\p{Cs}\u{E0001}\u{E0020}-\u{E007F}\u{E0100}-\u{E01EF}]/u.test(note)) return undefined;
  return note;
}
