import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createHash } from "node:crypto";
import { createSelectedWordDetails } from "../../src/server/study/lexical/word-details";
import { parseStudyWordDetails, parseWordGrammar, WORD_DETAILS_ATTRIBUTION, WORD_DETAILS_LIMITS, type StudyWordDetails } from "../../src/lib/hebrew/word-details";
import { parseTahot, parseTbesh } from "../../src/server/study/lexical/step";
import type { StepSourceLoader } from "../../src/server/study/lexical/source-loader";
import { normalizeHebrew } from "../../src/server/study/normalize";
import { projectStudyVerse } from "../../src/lib/hebrew/study-tokens";
import type { StudyVerse } from "../../src/server/study/types";
const row = (n: number, text = "בָּג", gloss = "Synthetic occurrence", morph = "HNcmsa", lemma = "{H0001}") => `Gen.1.1#${n}=L\t${text}\tDISCARDED_PRONUNCIATION\t${gloss}\t${lemma}\t${morph}\t`;
const lex = (text = "בָּג", gloss = "Synthetic dictionary sense", morph = "HVqp3ms") => `H0001#1\tH0001\tH0001\t${text}\tDISCARDED_PRONUNCIATION\t${morph}\t${gloss}\tDISCARDED_MEANING`;
const verse = (text = "בָּ֑ג דָּ֖ג׃", ref = "Genesis 1:1"): StudyVerse => ({ ref, hebrew: normalizeHebrew(text), english: null });
function binding(value = verse(), wordIndex = 0) { const p = projectStudyVerse(value.ref, value.hebrew); if (p.status !== "ready") throw new Error("Synthetic projection failed"); return { ref: value.ref, wordIndex, readingTextSha256: createHash("sha256").update(p.projection.readingText.normalize("NFC")).digest("hex"), words: p.projection.words.map(w => w.text) }; }
function source(text = row(1) + "\n" + row(2, "דָּג"), dictionary = lex()): { book: StepSourceLoader["book"]; lexicon: StepSourceLoader["lexicon"] } {
  return { book: vi.fn(async () => parseTahot(text, "Gen")), lexicon: vi.fn(async () => parseTbesh(dictionary)) };
}
async function ready(value = verse(), index = 0, sources = source()) { const result = await createSelectedWordDetails(value, index, sources); if (!result || result.status !== "ready") throw new Error("Synthetic details unavailable"); return result; }

it("separates the selected occurrence sense/grammar from dictionary sense, strips internal codes and deep-freezes the copied DTO", async () => {
  const value = await ready(); expect(value.occurrence).toEqual({ gloss: "Synthetic occurrence", grammar: { status: "ready", language: "hebrew", morphemes: [{ partOfSpeech: "noun", gender: "masculine", number: "singular", state: "absolute" }] } });
  expect(value.dictionary).toEqual([{ lemma: "H0001", status: "ready", headword: "בָּג", dictionaryGloss: "Synthetic dictionary sense" }]);
  expect(value.attribution).toEqual(WORD_DETAILS_ATTRIBUTION);
  expect(JSON.stringify(value)).not.toMatch(/DISCARDED|variant|readingText"|ketiv|lemmas|pronunciation|transliteration|warnings|root/);
  const input = { ...structuredClone(value), dictionary: [...value.dictionary] }, parsed = parseStudyWordDetails(input, binding())!; expect(parsed).toEqual(value); expect(parsed).not.toBe(input);
  expect(parsed.status).toBe("ready"); if (parsed.status !== "ready") throw 0;
  expect(Object.isFrozen(parsed.dictionary) && Object.isFrozen(parsed.dictionary[0]) && Object.isFrozen(parsed.occurrence.grammar)).toBe(true);
  input.dictionary.splice(0); expect(parsed.dictionary).toHaveLength(1);
});

it("binds NFC qere/maqaf read words and the actual full vector, never written ketiv", async () => {
  const input = verse('וְבָּ֑ג־<span class="mam-kq"><span class="mam-kq-k">זָח</span><span class="mam-kq-q">[דָּ֖ג]</span></span>׃'.normalize("NFD"));
  const result = await ready(input, 1, source(row(1, "וְ/בָּג", "Synthetic first", "Hc/Ncmsa", "H9002/{H0001}") + "\n" + row(2, "דָּג", "Synthetic read second")));
  expect(result).toMatchObject({ wordIndex: 1, wordCount: 2, readingTextSha256: binding(input, 1).readingTextSha256, occurrence: { gloss: "Synthetic read second" } });
  expect(parseStudyWordDetails(result, binding(input, 0))).toBeNull(); expect(parseStudyWordDetails(result, binding(verse("וְבָּ֑ג־זָח׃"), 1))).toBeNull();
});

it("requires exact ordered full correspondence even when the requested first word matches or words repeat", async () => {
  expect(await createSelectedWordDetails(verse(), 0, source(row(1) + "\n" + row(2, "זָח")))).toMatchObject({ status: "unavailable", reason: "correspondence" });
  const repeated = verse("בָּ֑ג בָּ֖ג׃"), result = await ready(repeated, 1, source(row(1, "בָּג", "Synthetic first") + "\n" + row(2, "בָּג", "Synthetic second")));
  expect(result.occurrence.gloss).toBe("Synthetic second");
  expect(await createSelectedWordDetails(repeated, 0, source(row(1)))).toMatchObject({ status: "unavailable", reason: "correspondence" });
});

it("distinguishes source-format/missing/bounded dictionary entries without importing dictionary grammar", async () => {
  for (const [dictionary, reason] of [["", "missing"], [lex() + "\n" + lex(), "source-format"], [lex("בָּג".repeat(40)), "bounded"]] as const) {
    const result = await ready(verse(), 0, source(undefined, dictionary)); expect(result.dictionary).toEqual([{ lemma: "H0001", status: "unavailable", reason }]); expect(result.occurrence.grammar).toMatchObject({ status: "ready", morphemes: [{ partOfSpeech: "noun" }] });
  }
  expect((await ready(verse(), 0, source(row(1, "בָּג", "Synthetic occurrence", "HNcmsa", "H0001") + "\n" + row(2, "דָּג")))).dictionary).toEqual([]);
});

it("retains unknown morphology and whole-verse source holds, never guessing a root or stress", async () => {
  expect((await ready(verse(), 0, source(row(1, "בָּג", "Synthetic occurrence", "HZunknown") + "\n" + row(2, "דָּג")))).occurrence.grammar).toEqual({ status: "unavailable", reason: "unrecognized-code" });
  const held = await createSelectedWordDetails(verse(), 0, source(row(1) + "\n" + row(1)));
  expect(held).toMatchObject({ status: "unavailable", reason: "correspondence" });
});

it("checks actual count before source I/O; unsupported and reconstruction outcomes cannot fabricate word identity", async () => {
  const sources = source(); await expect(createSelectedWordDetails(verse(), 2, sources)).rejects.toMatchObject({ code: "invalid-request" });
  for (const index of [-1, 512, NaN, 1.5]) await expect(createSelectedWordDetails(verse(), index, sources)).rejects.toMatchObject({ code: "invalid-request" });
  expect(sources.book).not.toHaveBeenCalled();
  expect(await createSelectedWordDetails(verse("בָּ֑ג׃", "Psalms 1:1"), 0, sources)).toMatchObject({ status: "unavailable", reason: "unsupported-book", wordCount: 1 });
  const broken = verse(); const held = await createSelectedWordDetails({ ...broken, hebrew: { ...broken.hebrew, readingText: "mismatch" } }, 1, sources);
  expect(held).toEqual({ schema: "study-word-details/v1", ref: broken.ref, wordIndex: 1, status: "unavailable", reason: "reconstruction" });
  expect(parseStudyWordDetails(held, { ref: broken.ref, wordIndex: 1 })).toEqual(held);
  expect(parseStudyWordDetails({ ...held, wordCount: 2 }, binding(broken, 1))).toBeNull(); expect(sources.book).not.toHaveBeenCalled();
});

it("sanitizes a failed source but refuses aborted completion and snapshots the actual verse before awaiting", async () => {
  const sources = source(); sources.book = async () => { throw new Error("Synthetic private details"); };
  const unavailable = await createSelectedWordDetails(verse(), 0, sources); expect(unavailable).toMatchObject({ status: "unavailable", reason: "source-unavailable" }); expect(JSON.stringify(unavailable)).not.toContain("Synthetic private");
  const controller = new AbortController(), aborted = source(); aborted.book = async () => { controller.abort(); return []; };
  await expect(createSelectedWordDetails(verse(), 0, aborted, controller.signal)).rejects.toMatchObject({ code: "upstream" });
  const mutable = verse(), changed = source(); changed.book = async () => { (mutable as { ref: string }).ref = "Genesis 1:2"; return parseTahot(row(1) + "\n" + row(2, "דָּג"), "Gen"); };
  expect(await createSelectedWordDetails(mutable, 0, changed)).toMatchObject({ ref: "Genesis 1:1", wordCount: 2 });
});

it("validates full actual binding and closed identity without consulting getters or caller array iterators", async () => {
  const dto = await ready(), actual = binding();
  for (const bad of [{ ...dto, ref: "Genesis 1:2" }, { ...dto, wordCount: 1 }, { ...dto, wordIndex: 1 }, { ...dto, readingTextSha256: "b".repeat(64) }, { ...dto, extra: true }, { ...dto, attribution: { ...dto.attribution, commit: "b".repeat(40) } }]) expect(parseStudyWordDetails(bad, actual)).toBeNull();
  const getter = vi.fn(), hostile = Object.defineProperty({ ...dto }, "occurrence", { get: getter }); expect(parseStudyWordDetails(hostile, actual)).toBeNull(); expect(getter).not.toHaveBeenCalled();
  for (const words of [new Array(2), [...actual.words, "בג"], actual.words.map(w => w.replace("\u05b8\u05bc", "\u05bc\u05b8"))]) expect(parseStudyWordDetails(dto, { ...actual, words })).toBeNull();
  const sparse = { ...dto, dictionary: new Array(1) }; expect(parseStudyWordDetails(sparse, actual)).toBeNull();
});

it("bounds UTF8 glosses, Hebrew headwords and entry/morpheme counts, rejecting HTML and opaque codes", async () => {
  const dto = await ready(), actual = binding(), withGloss = (gloss: string) => ({ ...dto, occurrence: { ...dto.occurrence, gloss } });
  expect(parseStudyWordDetails(withGloss("é".repeat(256)), actual)).not.toBeNull();
  expect(parseStudyWordDetails(withGloss("é".repeat(257)), actual)).toBeNull();
  for (const gloss of ["<b>invented</b>", "\ud800", "x\u202ey"]) expect(parseStudyWordDetails(withGloss(gloss), actual)).toBeNull();
  const maximal = { ...dto, dictionary: Array.from({ length: 16 }, (_, i) => ({ lemma: `H${String(i).padStart(4, "0")}`, status: "ready", headword: "אָ".repeat(32), dictionaryGloss: "Synthetic" })), occurrence: { gloss: null, grammar: { status: "ready", language: "hebrew", morphemes: Array.from({ length: 16 }, () => ({ partOfSpeech: "noun" })) } } };
  expect(parseStudyWordDetails(maximal, actual)).not.toBeNull(); expect(parseStudyWordDetails({ ...maximal, dictionary: [...maximal.dictionary, maximal.dictionary[0]] }, actual)).toBeNull();
  expect(parseWordGrammar({ status: "ready", language: "hebrew", morphemes: [{ partOfSpeech: "noun", variant: "raw-code" }] })).toBeNull();
  expect(parseWordGrammar({ status: "ready", language: "hebrew", morphemes: [{ partOfSpeech: "noun", gender: undefined }] })).toBeNull();
  expect(parseWordGrammar({ status: "ready", language: "hebrew", morphemes: [{ partOfSpeech: "verb", stem: "guessed", form: "perfect" }] })).toBeNull();
  expect(Buffer.byteLength(JSON.stringify(dto))).toBeLessThan(WORD_DETAILS_LIMITS.bytes);
});
