// Independent contract values, all invented; no licensed rows or corpus.
import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { parseStudyWordDetails, WORD_DETAILS_ATTRIBUTION, type WordDetailsBinding } from "../../src/lib/hebrew/word-details";
import { createSelectedWordDetails } from "../../src/server/study/lexical/word-details";
import { parseTahot } from "../../src/server/study/lexical/step";
import { normalizeHebrew } from "../../src/server/study/normalize";

const words = ["דָּג", "בָּג"].map(value => value.normalize("NFC"));
const hash = createHash("sha256").update(words.join(" ")).digest("hex");
const binding: WordDetailsBinding = { ref: "Genesis 1:1", readingTextSha256: hash, words, wordIndex: 1 };
function value() {
  return { schema: "study-word-details/v1", ref: binding.ref, readingTextSha256: hash, wordCount: 2, wordIndex: 1, status: "ready", attribution: { ...WORD_DETAILS_ATTRIBUTION },
    occurrence: { gloss: "invented occurrence", grammar: { status: "ready", language: "hebrew", morphemes: [{ partOfSpeech: "noun", gender: "masculine", number: "singular", state: "absolute" }] } },
    dictionary: [{ lemma: "H0002", status: "ready", headword: words[1], dictionaryGloss: "invented dictionary sense" }] };
}

it("review independently binds exact selected identity and copies/freezes nested occurrence and dictionary facts", () => {
  const input = value(), parsed = parseStudyWordDetails(input, binding); expect(parsed?.status).toBe("ready"); if (parsed?.status !== "ready") throw 0;
  expect(parsed.occurrence.gloss).toBe("invented occurrence"); expect(parsed.dictionary[0]).toMatchObject({ dictionaryGloss: "invented dictionary sense" });
  expect(Object.isFrozen(parsed) && Object.isFrozen(parsed.occurrence) && Object.isFrozen(parsed.occurrence.grammar) && Object.isFrozen(parsed.dictionary) && Object.isFrozen(parsed.dictionary[0])).toBe(true);
  if (parsed.occurrence.grammar.status !== "ready") throw 0; expect(Object.isFrozen(parsed.occurrence.grammar.morphemes) && Object.isFrozen(parsed.occurrence.grammar.morphemes[0])).toBe(true);
  input.occurrence.gloss = "changed"; input.dictionary[0].dictionaryGloss = "changed"; input.occurrence.grammar.morphemes[0].number = "plural";
  expect(parsed.occurrence.gloss).toBe("invented occurrence"); expect(parsed.dictionary[0]).toMatchObject({ dictionaryGloss: "invented dictionary sense" }); expect(parsed.occurrence.grammar.morphemes[0].number).toBe("singular");
  for (const wrong of [{ ...binding, ref: "Genesis 1:2" }, { ...binding, readingTextSha256: "f".repeat(64) }, { ...binding, words: words.slice(1) }, { ...binding, wordIndex: 0 }]) expect(parseStudyWordDetails(input, wrong)).toBeNull();
});

it("review accessors and foreign fields are refused without evaluating supplied getters at every nested boundary", () => {
  const getter = vi.fn(() => "unexpected");
  for (const path of ["outer", "occurrence", "grammar", "feature", "dictionary", "entry"] as const) {
    const input = value(); const target = path === "outer" ? input : path === "occurrence" ? input.occurrence : path === "grammar" ? input.occurrence.grammar : path === "feature" ? input.occurrence.grammar.morphemes[0] : path === "dictionary" ? input.dictionary : input.dictionary[0];
    Object.defineProperty(target, path === "dictionary" ? "0" : path === "entry" ? "dictionaryGloss" : path === "feature" ? "partOfSpeech" : path === "grammar" ? "status" : path === "occurrence" ? "gloss" : "ref", { get: getter, enumerable: true, configurable: true });
    expect(parseStudyWordDetails(input, binding)).toBeNull();
  }
  expect(getter).not.toHaveBeenCalled();
  for (const field of ["transliteration", "ipa", "sourceRows", "root", "html"]) { const input = value(); Object.defineProperty(input, field, { value: "invented", enumerable: true }); expect(parseStudyWordDetails(input, binding)).toBeNull(); }
  const variant = value(); Object.defineProperty(variant.occurrence.grammar.morphemes[0], "variant", { value: "c", enumerable: true }); expect(parseStudyWordDetails(variant, binding)).toBeNull();
});

it("review UTF8 bounds, malformed Unicode, markup, dictionary duplicates and sparse vectors cannot enter a selected DTO", () => {
  for (const gloss of ["😀".repeat(129), "\ud800", "<b>invented</b>", "hidden\u202evalue"]) { const input = value(); input.dictionary[0].dictionaryGloss = gloss; expect(parseStudyWordDetails(input, binding)).toBeNull(); }
  const longHeadword = value(); longHeadword.dictionary[0].headword = "ד".repeat(65); expect(parseStudyWordDetails(longHeadword, binding)).toBeNull();
  const duplicate = value(); duplicate.dictionary.push({ ...duplicate.dictionary[0] }); expect(parseStudyWordDetails(duplicate, binding)).toBeNull();
  const overflow = value(); overflow.dictionary = Array.from({ length: 17 }, (_, i) => ({ ...overflow.dictionary[0], lemma: `H${String(i).padStart(4, "0")}` })); expect(parseStudyWordDetails(overflow, binding)).toBeNull();
  const sparse = value(); delete sparse.dictionary[0]; expect(parseStudyWordDetails(sparse, binding)).toBeNull();
  const holes = new Array<string>(2); holes[1] = words[1]; expect(parseStudyWordDetails(value(), { ...binding, words: holes })).toBeNull();
});

it("review unknown or cross-category grammar cannot be disguised as factual occurrence grammar", () => {
  for (const feature of [{ partOfSpeech: "noun", stem: "Qal" }, { partOfSpeech: "verb", stem: "invented", form: "perfect" }, { partOfSpeech: "verb", stem: "Qal" }, { partOfSpeech: "verb", stem: "Qal", form: "perfect", person: 4 }]) {
    const input = value(); Object.defineProperty(input.occurrence.grammar, "morphemes", { value: [feature], enumerable: true }); expect(parseStudyWordDetails(input, binding)).toBeNull();
  }
  const input = value(); Object.defineProperty(input.dictionary[0], "grammar", { value: { partOfSpeech: "verb" }, enumerable: true }); expect(parseStudyWordDetails(input, binding)).toBeNull();
});

it("review reconstruction hold contains no fabricated hash/count while all other holds stay bound to actual selected text", () => {
  const reconstruction = { schema: "study-word-details/v1", ref: binding.ref, wordIndex: 1, status: "unavailable", reason: "reconstruction" };
  expect(parseStudyWordDetails(reconstruction, { ref: binding.ref, wordIndex: 1 })).toEqual(reconstruction);
  expect(parseStudyWordDetails({ ...reconstruction, readingTextSha256: hash, wordCount: 2 }, binding)).toBeNull();
  expect(parseStudyWordDetails(reconstruction, { ...binding, wordIndex: 512 })).toBeNull();
  for (const reason of ["source-unavailable", "correspondence", "unsupported-book"]) {
    const held = { schema: "study-word-details/v1", ref: binding.ref, readingTextSha256: hash, wordCount: 2, wordIndex: 1, status: "unavailable", reason, attribution: { ...WORD_DETAILS_ATTRIBUTION } };
    expect(parseStudyWordDetails(held, binding)).toEqual(held); expect(parseStudyWordDetails(held, { ...binding, readingTextSha256: "e".repeat(64) })).toBeNull();
  }
});

it("review qere and maqaf use the actual normalized reading vector, and full-count mismatch never selects a repeated-word fallback", async () => {
  const verse = { ref: "Genesis 1:1", hebrew: normalizeHebrew('דָּג־<span class="mam-kq"><span class="mam-kq-k">זָח</span><span class="mam-kq-q">[בָּג]</span></span>'.normalize("NFD")), english: null };
  const source = (forms: string[]) => ({ book: async () => parseTahot(forms.map((form, i) => `Gen.1.1#${i + 1}=L\t${form}\tDISCARDED\tInvented occurrence ${i}\t{H0002}\tHNcmsa\t`).join("\n"), "Gen"), lexicon: async () => Object.freeze([]) });
  const good = await createSelectedWordDetails(verse, 1, source(["דָּג", "בָּג"]));
  expect(good).toMatchObject({ status: "ready", wordIndex: 1, wordCount: 2, readingTextSha256: createHash("sha256").update(verse.hebrew.readingText.normalize("NFC")).digest("hex"), occurrence: { gloss: "Invented occurrence 1" } });
  expect(await createSelectedWordDetails(verse, 1, source(["דָּג", "זָח"]))).toMatchObject({ status: "unavailable", reason: "correspondence" });
  expect(await createSelectedWordDetails(verse, 1, source(["דָּג", "בָּג", "בָּג"]))).toMatchObject({ status: "unavailable", reason: "correspondence" });
});

it("review projector bounds hold never fabricates canonical identity or starts either STEP source", async () => {
  const source = { book: vi.fn(async () => Object.freeze([])), lexicon: vi.fn(async () => Object.freeze([])) };
  const verse = { ref: "Genesis 1:1", hebrew: normalizeHebrew(Array.from({ length: 513 }, () => "דָּג").join(" ")), english: null };
  // Root's explicit boundary: an unproved vector stays unavailable; only a
  // READY vector can prove that an otherwise syntactically valid index is400.
  expect(await createSelectedWordDetails(verse, 0, source)).toEqual({ schema: "study-word-details/v1", ref: verse.ref, wordIndex: 0, status: "unavailable", reason: "reconstruction" });
  expect(source.book).not.toHaveBeenCalled(); expect(source.lexicon).not.toHaveBeenCalled();
});
