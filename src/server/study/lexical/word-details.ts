import "server-only";
import { createHash } from "node:crypto";
import { projectStudyVerse } from "../../../lib/hebrew/study-tokens";
import { parseStudyWordDetails, parseWordGrammar, WORD_DETAILS_ATTRIBUTION, WORD_DETAILS_SCHEMA, WORD_DETAILS_LIMITS, wordDetailsPlainText, wordDetailsHeadword,
  type StudyWordDetails, type WordDictionaryEntry, type WordGrammar } from "../../../lib/hebrew/word-details";
import { wordAidRef } from "../../../lib/hebrew/word-aids";
import { alignStepVerse } from "./step";
import type { Morphology } from "./morphology";
import type { StepSourceLoader } from "./source-loader";
import { StudyUnavailable, type StudyVerse } from "../types";

const codes: Readonly<Record<string, string>> = Object.freeze({ Genesis: "Gen", Exodus: "Exo", Leviticus: "Lev", Numbers: "Num", Deuteronomy: "Deu", Joshua: "Jos", Judges: "Jdg",
  "I Samuel": "1Sa", "II Samuel": "2Sa", "I Kings": "1Ki", "II Kings": "2Ki", Isaiah: "Isa", Jeremiah: "Jer", Ezekiel: "Ezk", Hosea: "Hos", Joel: "Jol", Amos: "Amo", Obadiah: "Oba", Jonah: "Jon", Micah: "Mic", Nahum: "Nam", Habakkuk: "Hab", Zephaniah: "Zep", Haggai: "Hag", Zechariah: "Zec", Malachi: "Mal" });
const unknownGrammar: WordGrammar = Object.freeze({ status: "unavailable", reason: "unrecognized-code" });
function occurrenceGrammar(value: Morphology): WordGrammar {
  if (value.status !== "ready") return unknownGrammar;
  const morphemes = value.morphemes.map(part => {
    const { partOfSpeech, stem, form, person, gender, number, state, definite } = part;
    return { partOfSpeech, ...(stem === undefined ? {} : { stem }), ...(form === undefined ? {} : { form }), ...(person === undefined ? {} : { person }),
      ...(gender === undefined ? {} : { gender }), ...(number === undefined ? {} : { number }), ...(state === undefined ? {} : { state }), ...(definite === undefined ? {} : { definite }) };
  });
  return parseWordGrammar({ status: "ready", language: value.language, morphemes }) ?? unknownGrammar;
}

/** Exactly one selected occurrence; this public work conveys no permission. */
export async function createSelectedWordDetails(verse: StudyVerse, suppliedIndex: number, source: StepSourceLoader, signal?: AbortSignal): Promise<StudyWordDetails | null> {
  const wordIndex = suppliedIndex;
  if (!Number.isSafeInteger(wordIndex) || wordIndex < 0 || wordIndex >= WORD_DETAILS_LIMITS.words) throw new StudyUnavailable("invalid-request");
  const connected = () => { if (signal?.aborted) throw new StudyUnavailable("upstream"); }; connected();
  const ref = verse?.ref; if (!wordAidRef(ref)) return null;
  let projected;
  try { projected = projectStudyVerse(ref, verse.hebrew); } catch { projected = { status: "unavailable" as const }; }
  if (projected.status !== "ready") return Object.freeze({ schema: WORD_DETAILS_SCHEMA, ref, wordIndex, status: "unavailable", reason: "reconstruction" });
  // Capture the actual canonical vector and digest before any source await.
  const words = Object.freeze(projected.projection.words.map(word => word.text));
  if (wordIndex >= words.length) throw new StudyUnavailable("invalid-request");
  const readingTextSha256 = createHash("sha256").update(projected.projection.readingText.normalize("NFC")).digest("hex");
  const binding = Object.freeze({ ref, wordIndex, readingTextSha256, words });
  const identity = Object.freeze({ schema: WORD_DETAILS_SCHEMA, ref, wordIndex, readingTextSha256, wordCount: words.length, attribution: WORD_DETAILS_ATTRIBUTION });
  const held = (reason: "unsupported-book" | "source-unavailable" | "correspondence"): StudyWordDetails => Object.freeze({ ...identity, status: "unavailable", reason });
  const name = /^(.+) [0-9]+:[0-9]+$/.exec(ref)![1], code = Object.hasOwn(codes, name) ? codes[name] : undefined;
  if (!code) return held("unsupported-book");
  let book, lexicon;
  try { [book, lexicon] = await Promise.all([source.book(code, signal), source.lexicon(signal)]); }
  catch { connected(); return held("source-unavailable"); }
  connected();
  const candidates = book.filter(row => row.ref === ref);
  if (candidates.length !== 1) return held("correspondence");
  const aligned = alignStepVerse(candidates[0], { ref, words });
  if (aligned.status !== "ready") return held("correspondence");
  const selected = aligned.matches[wordIndex].source, dictionary: WordDictionaryEntry[] = [];
  const identities = new Set<string>();
  for (const lemma of selected.lemmas) {
    if (!lemma.lexical || identities.has(lemma.id)) continue; identities.add(lemma.id);
    if (dictionary.length >= WORD_DETAILS_LIMITS.entries) return held("source-unavailable");
    const matches = lexicon.filter(entry => entry.lemma === lemma.id), entry = matches[0];
    if (matches.length !== 1 || entry.status !== "ready") dictionary.push(Object.freeze({ lemma: lemma.id, status: "unavailable", reason: matches.length === 0 ? "missing" : "source-format" }));
    else if (!wordDetailsHeadword(entry.hebrew) || !wordDetailsPlainText(entry.dictionaryGloss, WORD_DETAILS_LIMITS.glossBytes)) dictionary.push(Object.freeze({ lemma: lemma.id, status: "unavailable", reason: "bounded" }));
    else dictionary.push(Object.freeze({ lemma: lemma.id, status: "ready", headword: entry.hebrew, dictionaryGloss: entry.dictionaryGloss }));
  }
  connected();
  const result = parseStudyWordDetails({ ...identity, status: "ready", occurrence: { gloss: wordDetailsPlainText(selected.sourceGloss, WORD_DETAILS_LIMITS.glossBytes) && selected.sourceGloss ? selected.sourceGloss : null,
    grammar: occurrenceGrammar(selected.morphology) }, dictionary }, binding);
  return result ?? held("source-unavailable");
}
